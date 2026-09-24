import { clean, json } from "./_gateway.js";
import { assignment, hash } from "./_event.js";
import { packState, verifyState } from "./_state.js";
import { ROUND4, searchPlan } from "../public/round4-config.js";

const COSTS = { missing: 3, outlier: 3 };
const LIMITS = { missing: 10, outlier: 10 };
const BUDGET = ROUND4.creditBudget;
const unique = values => [...new Set(Array.isArray(values) ? values.map(value => String(value || "").slice(0, 64)) : [])];

export function buildQualityPlan(event, features, room = "fixed") {
  const logs = event.corruptionLog;
  const countBy = problem => features.map(feature => ({
    feature,
    issueCount: logs.filter(item => item.problem === problem && item.column === feature).length
  })).sort((a, b) => b.issueCount - a.issueCount || a.feature.localeCompare(b.feature));
  const damagedById = new Map(event.trainDamaged.map(row => [row.event_id, row]));
  return {
    missingColumns: countBy("missing_value"),
    outlierColumns: countBy("outlier"),
    missingMethods: ["median", "mean", "mode", "drop"],
    outlierMethods: ["iqr_clip", "iqr_remove", "median_clip"],
    costs: COSTS,
    limits: LIMITS,
    budget: BUDGET
  };
}

function repairOptions(plan) {
  const topMissing = plan.missingColumns.slice(0, LIMITS.missing).reduce((sum, item) => sum + item.issueCount, 0) || 1;
  const topOutliers = plan.outlierColumns.slice(0, LIMITS.outlier).reduce((sum, item) => sum + item.issueCount, 0) || 1;
  return [
    ...plan.missingColumns.map(item => ({ kind: "missing", id: item.feature, cost: COSTS.missing, gain: 35 * item.issueCount / topMissing })),
    ...plan.outlierColumns.map(item => ({ kind: "outlier", id: item.feature, cost: COSTS.outlier, gain: 25 * item.issueCount / topOutliers }))
  ];
}

function maxGain(options) {
  let states = new Map([["0:0:0", 0]]);
  for (const option of options) {
    const next = new Map(states);
    for (const [key, gain] of states) {
      const [cost, missing, outlier] = key.split(":").map(Number);
      const counts = { missing, outlier };
      if (cost + option.cost > BUDGET || counts[option.kind] >= LIMITS[option.kind]) continue;
      counts[option.kind]++;
      const nextKey = `${cost + option.cost}:${counts.missing}:${counts.outlier}`;
      next.set(nextKey, Math.max(next.get(nextKey) || 0, gain + option.gain));
    }
    states = next;
  }
  return Math.max(...states.values());
}

export function scoreRepairPlan(plan, repairs) {
  const selected = new Map([...repairs.missingColumns.map(id => [`missing:${id}`, true]), ...repairs.outlierColumns.map(id => [`outlier:${id}`, true])]);
  const options = repairOptions(plan), gain = options.filter(option => selected.has(`${option.kind}:${option.id}`)).reduce((sum, option) => sum + option.gain, 0);
  return Number((gain / (maxGain(options) || 1) * 100).toFixed(1));
}

function validateRepairs(plan, body) {
  const repairs = {
    missingColumns: unique(body?.missingColumns),
    outlierColumns: unique(body?.outlierColumns)
  };
  const methods = { missing: body?.missingMethods || {}, outlier: body?.outlierMethods || {} };
  const allowed = {
    missingColumns: new Set(plan.missingColumns.map(item => item.feature)),
    outlierColumns: new Set(plan.outlierColumns.map(item => item.feature))
  };
  for (const [key, values] of Object.entries(repairs)) {
    const limit = { missingColumns: LIMITS.missing, outlierColumns: LIMITS.outlier }[key];
    if (values.length > limit || values.some(value => !allowed[key].has(value))) throw new Error(`Invalid ${key} repair selection.`);
  }
  for (const feature of repairs.missingColumns) if (!plan.missingMethods.includes(methods.missing[feature] || "median")) throw new Error(`Invalid missing-value method for ${feature}.`);
  for (const feature of repairs.outlierColumns) if (!plan.outlierMethods.includes(methods.outlier[feature] || "iqr_clip")) throw new Error(`Invalid outlier method for ${feature}.`);
  const spend = repairs.missingColumns.length * COSTS.missing + repairs.outlierColumns.length * COSTS.outlier;
  if (spend > BUDGET) throw new Error(`Repair plan costs ${spend}; Event 4 allows ${BUDGET}.`);
  return { repairs, methods, spend };
}

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), action = clean(req.body?.action, 16);
  if (!room || !player) return json(res, 400, { error: "Room and player are required." });
  try {
    const featureState = verifyState(req.body?.featureState, "features", room, player), event = assignment(room);
    const plan = buildQualityPlan(event, featureState.selected, room);
    const timeTakenSeconds = Number(req.body?.timeTakenSeconds || 0);
    if (action === "plan") return json(res, 200, { plan, lockedFeatures: featureState.selected });
    if (!["seal", "charge"].includes(action)) return json(res, 400, { error: "Choose plan, seal, or charge." });
    const { repairs, methods, spend } = validateRepairs(plan, { ...req.body?.repairs, missingMethods: req.body?.missingMethods, outlierMethods: req.body?.outlierMethods }), qualityScore = scoreRepairPlan(plan, repairs);
    const qualityState = packState("quality", { room, player, features: featureState.selected, featureScore: featureState.score, qualityScore, repairs, methods, repairSpend: spend, timeTakenSeconds });
    const base = { sealed: true, features: featureState.selected, featureScore: featureState.score, qualityScore, repairSpend: spend, creditBudget: BUDGET, methods, timeTakenSeconds, qualityState, message: `Cleaning plan sealed: ${spend} credits assigned to repairs, repair effectiveness ${qualityScore}/100.` };
    if (action === "seal") return json(res, 200, base);

    const model = String(req.body?.model || ""), search = searchPlan(model, req.body?.ranges || {});
    const ledger = req.body?.round4CreditState ? verifyState(req.body.round4CreditState, "round4credits", room, player) : { spent: 0, purchases: 0 };
    const previousSpent = Number(ledger.spent || 0), experimentSpend = spend + search.cost;
    if (!Number.isFinite(previousSpent) || previousSpent < 0 || previousSpent > BUDGET) throw new Error("INVALID_STATE");
    if (previousSpent + experimentSpend > BUDGET) throw new Error(`This experiment costs ${experimentSpend} credits, but only ${BUDGET - previousSpent} remain in the shared Round 4 wallet.`);
    const creditsSpent = previousSpent + experimentSpend, purchases = Number(ledger.purchases || 0) + 1;
    const round4CreditState = packState("round4credits", { room, player, spent: creditsSpent, purchases });
    return json(res, 200, { ...base, searchSpend: search.cost, experimentSpend, creditsSpent, creditsRemaining: BUDGET - creditsSpent, round4CreditState });
  } catch (error) {
    const message = ["STATE_REQUIRED", "INVALID_STATE"].includes(error.message) ? "The signed round state could not be verified. Reload the mission." : error.message;
    return json(res, 409, { error: message });
  }
}
