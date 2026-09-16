import { createHmac, timingSafeEqual } from "node:crypto";
import { clean, json } from "./_gateway.js";
import { assignment, TRAFFIC_CLASSES } from "./_event.js";

const CATALOG = {
  classprofiles: { cost: 2, scope: "feature" },
  correlation: { cost: 2, scope: "global" },
  relationship: { cost: 2, scope: "pair" }
};
const BUDGET = 10;
const secret = () => process.env.MATCH_GATEWAY_SECRET || "expedition-local-analysis-state";
const sign = payload => createHmac("sha256", secret()).update(payload).digest("base64url");
function pack(state) { const payload = Buffer.from(JSON.stringify(state)).toString("base64url"); return `${payload}.${sign(payload)}`; }
export function verifyAnalysisState(token, room, player) {
  if (!token) return { room, player, spent: 0, purchases: [] };
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) throw new Error("INVALID_ANALYSIS_STATE");
  const expected = sign(payload), left = Buffer.from(signature), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("INVALID_ANALYSIS_STATE");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (state.room !== room || state.player !== player || !Array.isArray(state.purchases)) throw new Error("INVALID_ANALYSIS_STATE");
  return state;
}
export function evidenceKey(type, scope, cohort, feature, secondFeature) { return scope === "global" ? `${cohort}:${type}` : scope === "pair" ? `${cohort}:${type}:${feature}:${secondFeature}` : `${cohort}:${type}:${feature}`; }
const round = value => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
const numeric = values => values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
function summary(rows, feature, corruptionLog = []) {
  const loggedMissing = new Set(corruptionLog.filter(item => item.problem === "missing_value" && item.column === feature).map(item => item.event_id));
  const missingRows = rows.filter(row => loggedMissing.has(row.event_id) || row[feature] === null || row[feature] === undefined || row[feature] === "");
  const values = numeric(rows.filter(row => !loggedMissing.has(row.event_id)).map(row => row[feature])).sort((a, b) => a - b), average = mean(values);
  const variance = values.length ? mean(values.map(value => (value - average) ** 2)) : NaN;
  return { count: rows.length, missingCount: missingRows.length, missingPct: round(missingRows.length * 100 / rows.length), mean: round(average), median: round(values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2), variance: round(variance), stdDev: round(Math.sqrt(variance)), min: round(values[0]), max: round(values.at(-1)), range: round(values.at(-1) - values[0]) };
}
export function correlation(rows, a, b) {
  const pairs = rows.filter(row => Number.isFinite(Number(row[a])) && Number.isFinite(Number(row[b]))).map(row => [Number(row[a]), Number(row[b])]);
  if (pairs.length < 2) return null;
  const ma = mean(pairs.map(pair => pair[0])), mb = mean(pairs.map(pair => pair[1]));
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - ma) * (pair[1] - mb), 0), da = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - ma) ** 2, 0)), db = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[1] - mb) ** 2, 0));
  return round(da && db ? numerator / (da * db) : 0);
}
function analyze(type, rows, features, feature, secondFeature, corruptionLog) {
  if (type === "classprofiles") return { kind: type, feature, classes: TRAFFIC_CLASSES.map(label => ({ label, ...summary(rows.filter(row => row.target === label), feature, corruptionLog) })) };
  if (type === "correlation") return { kind: type, features, matrix: features.map(a => features.map(b => correlation(rows, a, b))) };
  const coefficient = correlation(rows, feature, secondFeature), ordered = numeric(rows.map(row => row[feature])).sort((a, b) => a - b), bins = [];
  for (let i = 0; i < 5; i++) { const low = ordered[Math.floor((ordered.length - 1) * i / 5)], high = ordered[Math.floor((ordered.length - 1) * (i + 1) / 5)], values = numeric(rows.filter(row => Number(row[feature]) >= low && Number(row[feature]) <= high).map(row => row[secondFeature])); bins.push({ from: round(low), to: round(high), mean: round(mean(values)), count: values.length }); }
  return { kind: type, feature, secondFeature, coefficient, bins };
}

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), type = clean(req.body?.type, 20), cohort = "training", feature = clean(req.body?.feature, 48), secondFeature = clean(req.body?.secondFeature, 48), config = CATALOG[type];
  if (!room || !player) return json(res, 400, { error: "Room and player are required." });
  if (!config) return json(res, 400, { error: `Unsupported investigation: ${type || "(missing)"}. Choose Class Profiles, Correlation Analysis, or Channel Relationship View.` });
  const event = assignment(room), features = event.features;
  if (config.scope !== "global" && !features.includes(feature)) return json(res, 400, { error: "Choose a valid feature to investigate." });
  if (config.scope === "pair" && (!features.includes(secondFeature) || feature === secondFeature)) return json(res, 400, { error: "Choose two different valid features." });
  try {
    const state = verifyAnalysisState(req.body?.analysisState, room, player), key = evidenceKey(type, config.scope, cohort, feature, secondFeature), alreadyPurchased = state.purchases.includes(key);
    if (!alreadyPurchased && state.spent + config.cost > BUDGET) return json(res, 409, { error: `This investigation costs ${config.cost} credits; only ${BUDGET - state.spent} remain.` });
    const working = event.trainDamaged.map(row => ({ ...row, target: row.label }));
    const next = alreadyPurchased ? state : { ...state, spent: state.spent + config.cost, purchases: [...state.purchases, key] };
    return json(res, 200, { result: { ...analyze(type, working, features, feature, secondFeature, event.corruptionLog), cohort, recordCount: working.length }, cost: alreadyPurchased ? 0 : config.cost, replayed: alreadyPurchased, creditsRemaining: BUDGET - next.spent, spent: next.spent, purchases: next.purchases, analysisState: pack(next) });
  } catch (error) { return json(res, 409, { error: error.message === "INVALID_ANALYSIS_STATE" ? "Investigation ledger could not be verified. Reload the mission." : error.message }); }
}
