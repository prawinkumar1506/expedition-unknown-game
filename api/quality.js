import { clean, json } from "./_gateway.js";
import { assignment, hash } from "./_event.js";
import { materializeDerivedRows } from "./_derived.js";
import { packState, verifyState } from "./_state.js";

const COSTS = { missing: 3, outlier: 3 };
const LIMITS = { missing: 10, outlier: 10 };
const BUDGET = 50;
export const EMERGENCY_REPAIR_COST = 30;
// This is a recovery route, not an alternate optimal build. Four or fewer
// strong channels means the locked selection cannot outperform the fixed backup.
export const EMERGENCY_MAX_STRONG_CHANNELS = 4;
export const EMERGENCY_QUALITY_SCORE = 35;
const unique = values => [...new Set(Array.isArray(values) ? values.map(value => String(value || "").slice(0, 64)) : [])];

export function buildQualityPlan(event, features, room = "fixed", derivedFeatures = []) {
  const logs = event.corruptionLog;
  const derivedIds = new Set(derivedFeatures.map(item => item.id)), materialized = materializeDerivedRows(event.trainDamaged, derivedFeatures);
  const countDerivedMissing = feature => materialized.filter(row => row[feature] === null || row[feature] === undefined || row[feature] === "" || !Number.isFinite(Number(row[feature]))).length;
  const countDerivedOutliers = feature => {
    const values = materialized.map(row => Number(row[feature])).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length < 4) return 0;
    const pick = q => { const p = (values.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return lo === hi ? values[lo] : values[lo] + (values[hi] - values[lo]) * (p - lo); };
    const q1 = pick(0.25), q3 = pick(0.75), iqr = q3 - q1, low = q1 - 1.5 * iqr, high = q3 + 1.5 * iqr;
    return values.filter(value => value < low || value > high).length;
  };
  const countBy = problem => features.map(feature => ({
    feature,
    issueCount: derivedIds.has(feature) ? (problem === "missing_value" ? countDerivedMissing(feature) : countDerivedOutliers(feature)) : logs.filter(item => item.problem === problem && item.column === feature).length
  })).sort((a, b) => b.issueCount - a.issueCount || a.feature.localeCompare(b.feature));
  const damagedById = new Map(event.trainDamaged.map(row => [row.event_id, row]));
  return {
    missingColumns: countBy("missing_value"),
    outlierColumns: countBy("outlier"),
    missingMethods: ["median", "mean", "mode"],
    outlierMethods: ["iqr_clip", "median_replace"],
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
    const plan = buildQualityPlan(event, featureState.selected, room, featureState.derivedFeatures || []);
    const timeTakenSeconds = Number(req.body?.timeTakenSeconds || 0);
    if (action === "plan") return json(res, 200, { plan, lockedFeatures: featureState.selected, emergencyFeatures: event.backupFeatures });
    if (action !== "seal") return json(res, 400, { error: "Choose plan or seal." });
    const emergencyFeed = Boolean(req.body?.emergencyFeed);
    if (emergencyFeed) {
      if (featureState.strongCount > EMERGENCY_MAX_STRONG_CHANNELS) throw new Error(`Emergency Feed is available only after a failed Feature Hunt lock (${EMERGENCY_MAX_STRONG_CHANNELS} or fewer strong channels).`);
      const repairs = { missingColumns: [], outlierColumns: [] }, methods = { missing: {}, outlier: {} }, derivedFeatures = [];
      const qualityState = packState("quality", { room, player, features: event.backupFeatures, derivedFeatures, featureScore: 0, qualityScore: EMERGENCY_QUALITY_SCORE, emergencyFeed: true, repairs, methods, repairSpend: EMERGENCY_REPAIR_COST, timeTakenSeconds });
      return json(res, 200, { sealed: true, emergencyFeed: true, features: event.backupFeatures, derivedFeatures, repairs, methods, sourceFiles: { train: "train_backup_10.csv", test: "test_backup_10.csv" }, featureScore: 0, qualityScore: EMERGENCY_QUALITY_SCORE, repairSpend: EMERGENCY_REPAIR_COST, repairBudget: BUDGET, timeTakenSeconds, qualityState, message: `Emergency Telemetry Feed locked. ${EMERGENCY_REPAIR_COST} repair credits were charged; Event 3 is forfeited and Event 4 is capped at 35/100.` });
    }
    const { repairs, methods, spend } = validateRepairs(plan, req.body?.repairs), qualityScore = scoreRepairPlan(plan, repairs);
    const derivedFeatures = featureState.derivedFeatures || [];
    const qualityState = packState("quality", { room, player, features: featureState.selected, derivedFeatures, featureScore: featureState.score, qualityScore, emergencyFeed: false, repairs, methods, repairSpend: spend, timeTakenSeconds });
    return json(res, 200, { sealed: true, emergencyFeed: false, features: featureState.selected, derivedFeatures, repairs, sourceFiles: { train: "train_16.csv", test: "test_16.csv" }, featureScore: featureState.score, qualityScore, repairSpend: spend, repairBudget: BUDGET, methods, timeTakenSeconds, qualityState, message: `Cleaning plan sealed: ${spend}/${BUDGET} repair credits spent, repair effectiveness ${qualityScore}/100.` });
  } catch (error) {
    const message = ["STATE_REQUIRED", "INVALID_STATE"].includes(error.message) ? "The Feature Hunt seal could not be verified. Reload the mission." : error.message;
    return json(res, 409, { error: message });
  }
}
