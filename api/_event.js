import { existsSync, readFileSync } from "node:fs";

export const SOURCE_PACKAGE = "traffic_competition_package.zip";
export const TRAFFIC_CLASSES = ["Free_Flow", "Heavy_Traffic", "Pedestrian_Event", "Incident", "Low_Activity"];
export const MANUAL_CLASSES = ["Normal_Traffic", "Heavy_Traffic", "Pedestrian_Crossing", "Accident"];
export const FEATURE_RANGES = {
  vehicle_count: [0, 90], avg_vehicle_speed_kmph: [0, 90], road_occupancy_pct: [0, 100], pedestrian_count: [0, 70],
  time_of_day_hr: [0, 24], visibility_m: [25, 3000], rain_intensity_mmhr: [0, 45], signal_wait_time_s: [0, 200],
  road_wetness_pct: [0, 100], incident_distance_m: [1, 500], noise_level_db: [35, 100], ambient_temperature_c: [2, 45],
  humidity_pct: [15, 100], camera_exposure_score: [0, 100], camera_focus_score: [0, 100], lane_marking_visibility_pct: [0, 100]
};
export const FEATURE_META = {
  vehicle_count: { label: "Vehicle count", unit: "vehicles", family: "traffic" },
  avg_vehicle_speed_kmph: { label: "Average vehicle speed", unit: "km/h", family: "traffic" },
  road_occupancy_pct: { label: "Road occupancy", unit: "%", family: "traffic" },
  pedestrian_count: { label: "Pedestrian count", unit: "people", family: "traffic" },
  time_of_day_hr: { label: "Time of day", unit: "hour", family: "context" },
  visibility_m: { label: "Visibility", unit: "m", family: "weather" },
  rain_intensity_mmhr: { label: "Rain intensity", unit: "mm/h", family: "weather" },
  signal_wait_time_s: { label: "Signal wait time", unit: "s", family: "signal" },
  road_wetness_pct: { label: "Road wetness", unit: "%", family: "weather" },
  incident_distance_m: { label: "Incident distance", unit: "m", family: "incident" },
  noise_level_db: { label: "Noise level", unit: "dB", family: "legacy" },
  ambient_temperature_c: { label: "Ambient temperature", unit: "°C", family: "legacy" },
  humidity_pct: { label: "Humidity", unit: "%", family: "legacy" },
  camera_exposure_score: { label: "Camera exposure", unit: "score", family: "camera" },
  camera_focus_score: { label: "Camera focus", unit: "score", family: "camera" },
  lane_marking_visibility_pct: { label: "Lane-marking visibility", unit: "%", family: "camera" }
};

export const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };

function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const [header, ...records] = rows.filter(parts => parts.some(value => value !== ""));
  return records.map(parts => Object.fromEntries(header.map((name, index) => [name, parts[index] ?? ""])));
}

const readCsv = name => parseCsv(readFileSync(new URL(`../data/traffic/${name}`, import.meta.url), "utf8")).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ["event_id", "label", "target", "record_id", "manual_id"].includes(key) ? value : (value === "" ? null : Number.isNaN(Number(value)) ? value : Number(value))])));
const readOptionalCsv = (name, fallback) => existsSync(new URL(`../data/traffic/${name}`, import.meta.url)) ? readCsv(name) : fallback;

const numericColumns = new Set(Object.keys(FEATURE_META));
const coerce = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numericColumns.has(key) ? (value === "" ? null : Number(value)) : value]));
let cache;
function loadData() {
  if (cache) return cache;
  const trainDamaged = readCsv("train_16.csv"), test = readCsv("test_16.csv"), strengthRows = readCsv("feature_strength_table.csv");
  cache = {
    trainDamaged,
    trainClean: readOptionalCsv("train_clean_16.csv", trainDamaged),
    test,
    truth: new Map(readCsv("test_truth.csv").map(row => [row.event_id, row.label])),
    corruptionLog: readCsv("corruption_log.csv"),
    featureStrength: Object.fromEntries(strengthRows.map(row => [row.feature, row])),
    metadata: JSON.parse(readFileSync(new URL("../data/traffic/generation_metadata.json", import.meta.url), "utf8")),
    features: Object.keys(trainDamaged[0]).filter(key => !["event_id", "label"].includes(key))
  };
  return cache;
}

export function manualClass(row) {
  const incidentDistance = Number(row.incident_distance_m);
  const avgSpeed = Number(row.avg_vehicle_speed_kmph);
  const vehicleCount = Number(row.vehicle_count);
  const roadOccupancy = Number(row.road_occupancy_pct);
  const pedestrianCount = Number(row.pedestrian_count);
  if ((incidentDistance < 50 && avgSpeed < 30) || (incidentDistance < 100 && avgSpeed < 10)) return "Accident";
  if ((vehicleCount >= 25 && avgSpeed < 25) || (roadOccupancy >= 70 && avgSpeed < 20)) return "Heavy_Traffic";
  if (pedestrianCount >= 10 || (pedestrianCount >= 6 && vehicleCount < 15)) return "Pedestrian_Crossing";
  return "Normal_Traffic";
}

export function assignment(room = "fixed") {
  const data = loadData();
  const participantRows = readCsv("quickread_participant.csv");
  const answerKeyRows = readCsv("quickread_answer_key.csv");
  const manualRows = participantRows.slice(0, 50).map(row => ({
    manual_id: row.record_id,
    vehicle_count: row.vehicle_count,
    avg_vehicle_speed_kmph: row.avg_vehicle_speed_kmph,
    road_occupancy_pct: row.road_occupancy_pct,
    pedestrian_count: row.pedestrian_count,
    incident_distance_m: row.incident_distance_m,
    correct_answer: manualClass(row)
  }));
  return { room, ...data, quickreadAnswerKey: answerKeyRows, manualRows };
}

export const withoutLabel = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "label"));
