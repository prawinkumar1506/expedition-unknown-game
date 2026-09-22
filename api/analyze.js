import { createHmac, timingSafeEqual } from "node:crypto";
import { clean, json } from "./_gateway.js";
import { assignment, TRAFFIC_CLASSES } from "./_event.js";

const CATALOG = {
  classprofiles: { cost: 2, scope: "feature" },
  correlation: { cost: 2, scope: "global" },
  relationship: { cost: 2, scope: "pair" }
};
const BUDGET = 10;
export const CLASS_PROFILE_EXPLANATIONS = {
  vehicle_count: "Vehicle Count changes a lot between the different traffic classes. Heavy Traffic usually has many more vehicles, while Low Activity has far fewer. This sensor can help tell one traffic situation from another.",
  avg_vehicle_speed_kmph: "Average Vehicle Speed changes clearly between traffic classes. Free Flow is usually much faster, while Heavy Traffic and Incidents are much slower. This sensor can help separate different traffic conditions.",
  road_occupancy_pct: "Road Occupancy changes a lot across the traffic classes. Heavy Traffic and Incidents usually cover much more of the road, while Low Activity covers much less. This sensor can help identify the traffic situation.",
  pedestrian_count: "Pedestrian Count changes strongly in some traffic classes. Pedestrian Events and Low Activity periods can show many more people than Incidents or Free Flow. This sensor can be useful for spotting situations where pedestrian activity matters.",
  time_of_day_hr: "Time of Day does not change much between most traffic classes. It may give some useful context, but it probably cannot identify the traffic condition by itself.",
  visibility_m: "Visibility changes in some traffic situations, especially around Incidents and Low Activity periods. It may be useful as extra information, but the classes are not always clearly separated by visibility alone.",
  rain_intensity_mmhr: "Rain Intensity looks fairly similar across most traffic classes. It may still help in certain weather-related situations, but it is unlikely to tell the classes apart by itself.",
  signal_wait_time_s: "Signal Wait Time changes clearly between traffic classes. Heavy Traffic and Pedestrian Events often have longer waits, while Low Activity usually has much shorter waits. This sensor can help distinguish different traffic conditions.",
  road_wetness_pct: "Road Wetness stays fairly similar across most traffic classes. It may provide useful weather context, but it does not clearly separate the traffic situations on its own.",
  incident_distance_m: "Incident Distance behaves very differently during Incidents. When an incident is present, the nearest obstruction is usually much closer than in the other traffic classes. This sensor can be very useful for identifying incident-related situations.",
  noise_level_db: "Noise Level changes only a little between the traffic classes. Since most situations produce similar noise readings, this sensor may not help much when trying to tell the classes apart.",
  ambient_temperature_c: "Ambient Temperature does not follow a clear traffic pattern. A few unusual readings can make some classes look different, but temperature is not a dependable way to identify the traffic condition.",
  humidity_pct: "Humidity can change with the weather, but it does not follow the traffic classes consistently. It may add some context, but it is not a dependable sensor for telling the traffic situations apart.",
  camera_exposure_score: "Camera Exposure changes mainly because of lighting conditions rather than the traffic situation itself. It may look different at certain times of day, but it is not a strong clue for identifying the traffic class.",
  camera_focus_score: "Camera Focus stays almost the same across all traffic classes. Since the readings barely change, this sensor is unlikely to help distinguish one traffic situation from another.",
  lane_marking_visibility_pct: "Lane Marking Visibility stays very similar across most traffic classes. Because the readings barely change between situations, this sensor may provide very little help in identifying the traffic class.",
  driver_fatigue_index: "Driver Fatigue Index stays fairly similar across the traffic classes and does not follow a clear traffic pattern. This sensor is unlikely to help much when choosing between the different situations.",
  brake_response_time_ms: "Brake Response Time is very similar across the traffic classes. The small changes do not form a clear pattern, so this sensor is unlikely to be useful for telling the classes apart.",
  road_surface_friction_coeff: "Road Surface Friction is almost constant across all traffic classes. Because the value barely changes, this sensor gives very little information about which traffic situation is happening.",
  collision_risk_score: "Collision Risk Score looks almost the same across the traffic classes. It comes from an older system and does not clearly follow the current traffic labels, so it may not help much here.",
  near_miss_count: "Near Miss Count is usually very low and looks similar across the traffic classes. Since the value rarely changes, it provides little help in identifying the current traffic situation."
};
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
  if (type === "classprofiles") return { kind: type, feature, explanation: CLASS_PROFILE_EXPLANATIONS[feature] || "This sensor shows some differences across the traffic classes. Compare the typical readings and decide whether it gives you a useful view of the traffic situation.", classes: TRAFFIC_CLASSES.map(label => ({ label, ...summary(rows.filter(row => row.target === label), feature, corruptionLog) })) };
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
