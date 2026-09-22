import { createHmac, timingSafeEqual } from "node:crypto";
import { clean, json } from "./_gateway.js";
import { assignment, FEATURE_META, TRAFFIC_CLASSES } from "./_event.js";

const CATALOG = {
  classprofiles: { cost: 2, scope: "feature" },
  correlation: { cost: 2, scope: "pair" },
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
const featureLabel = feature => FEATURE_META[feature]?.label || String(feature).replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
const classLabel = label => String(label).replaceAll("_", " ");
function median(values) { const ordered = [...values].sort((a, b) => a - b), n = ordered.length; return n ? (n % 2 ? ordered[(n - 1) / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2) : NaN; }
function quantile(values, q) { const ordered = [...values].sort((a, b) => a - b); if (!ordered.length) return NaN; const position = (ordered.length - 1) * q, low = Math.floor(position), high = Math.ceil(position); return low === high ? ordered[low] : ordered[low] + (ordered[high] - ordered[low]) * (position - low); }
function ranks(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value), result = Array(values.length);
  for (let start = 0; start < indexed.length;) { let end = start + 1; while (end < indexed.length && indexed[end].value === indexed[start].value) end++; const rank = (start + end - 1) / 2 + 1; for (let i = start; i < end; i++) result[indexed[i].index] = rank; start = end; }
  return result;
}
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
export function spearmanCorrelation(rows, a, b) {
  const pairs = rows.filter(row => Number.isFinite(Number(row[a])) && Number.isFinite(Number(row[b]))).map(row => [Number(row[a]), Number(row[b])]);
  if (pairs.length < 2) return null;
  const rankedA = ranks(pairs.map(pair => pair[0])), rankedB = ranks(pairs.map(pair => pair[1]));
  const rankedRows = rankedA.map((value, index) => ({ a: value, b: rankedB[index] }));
  return correlation(rankedRows, "a", "b");
}
function classProfileResult(rows, feature, corruptionLog) {
  const classes = TRAFFIC_CLASSES.map(label => ({ label, ...summary(rows.filter(row => row.target === label), feature, corruptionLog) }));
  const medians = classes.map(item => item.median).filter(Number.isFinite), values = numeric(rows.map(row => row[feature]));
  const spread = medians.length ? Math.max(...medians) - Math.min(...medians) : 0, iqr = quantile(values, 0.75) - quantile(values, 0.25), separation = round(iqr > 0 ? spread / iqr : 0) ?? 0;
  const highest = classes.reduce((best, item) => !best || (item.median ?? -Infinity) > (best.median ?? -Infinity) ? item : best, null), lowest = classes.reduce((best, item) => !best || (item.median ?? Infinity) < (best.median ?? Infinity) ? item : best, null), name = featureLabel(feature);
  let level, explanation;
  if (separation >= 1) { level = "clear"; explanation = `${name} changes a lot between the traffic classes. ${classLabel(highest.label)} usually has much higher typical readings than ${classLabel(lowest.label)}. This sensor can help tell one traffic situation from another.`; }
  else if (separation >= 0.5) { level = "noticeable"; explanation = `${name} changes noticeably between some traffic classes. ${classLabel(highest.label)} tends to have higher typical readings than ${classLabel(lowest.label)}. This sensor may help distinguish some traffic situations.`; }
  else if (separation >= 0.25) { level = "small"; explanation = `${name} shows some differences between the traffic classes, but the typical readings are not very far apart. It may add useful information, but it is unlikely to separate the classes by itself.`; }
  else { level = "little"; explanation = `${name} stays fairly similar across the traffic classes. Because the typical readings barely change between situations, this sensor may not help much in telling the classes apart.`; }
  return { kind: "classprofiles", feature, classes, evidence: { method: "median spread divided by overall IQR", separation, level }, explanation };
}
function correlationResult(rows, feature, secondFeature) {
  const coefficient = spearmanCorrelation(rows, feature, secondFeature), pearson = correlation(rows, feature, secondFeature), magnitude = Math.abs(coefficient ?? 0), a = featureLabel(feature), b = featureLabel(secondFeature);
  let strength, opening, movement, advice;
  if (magnitude >= 0.7) { strength = "strong"; opening = `${a} and ${b} are strongly connected.`; advice = "Because their readings are closely linked, they may provide some repeated information. If you have only 10 slots, think about whether you need both."; }
  else if (magnitude >= 0.45) { strength = "clear"; opening = `${a} and ${b} show a clear connection.`; advice = "Because their readings are related, they may provide some repeated information. If you have only 10 slots, think about whether both deserve a place."; }
  else if (magnitude >= 0.25) { strength = "some"; opening = `${a} and ${b} show some connection.`; advice = "They may share some information, but each could still add something different. Check their Class Profiles before deciding whether both deserve a slot."; }
  else { strength = "little"; opening = `${a} and ${b} show very little connection.`; advice = "They appear to provide different information, but check each sensor's Class Profile before deciding whether either deserves a slot."; }
  if (magnitude < 0.25) movement = "Changes in one do not consistently match changes in the other.";
  else if ((coefficient ?? 0) > 0) movement = `When ${a} increases, ${b} often tends to increase too.`;
  else movement = `When ${a} increases, ${b} often tends to decrease.`;
  return { kind: "correlation", feature, secondFeature, coefficient, pearson, evidence: { method: "Spearman rank correlation", strength, direction: magnitude < 0.25 ? "none" : coefficient > 0 ? "same" : "opposite" }, explanation: `${opening} ${movement} ${advice}` };
}
function analyze(type, rows, features, feature, secondFeature, corruptionLog) {
  if (type === "classprofiles") return classProfileResult(rows, feature, corruptionLog);
  if (type === "correlation") return correlationResult(rows, feature, secondFeature);
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
