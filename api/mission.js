import { clean, json } from "./_gateway.js";
import { assignment, FEATURE_META, MANUAL_CLASSES, SOURCE_PACKAGE, TRAFFIC_CLASSES } from "./_event.js";

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20);
  if (!room || !player) return json(res, 400, { error: "room and player are required" });
  const event = assignment(room);
  const featureMeta = Object.fromEntries(event.features.map(name => [name, FEATURE_META[name] || { label: name.replaceAll("_", " "), unit: "value", family: "telemetry" }]));
  return json(res, 200, {
    mission: {
      id: "operation-clearway",
      title: "SIGNAL LOST: OPERATION CLEARWAY",
      sourcePackage: SOURCE_PACKAGE,
      scope: "Events 2–5",
      featureLimit: 10,
      featureCredits: 10,
      repairCredits: 15,
      metric: "Macro F1",
      backend: "Kaggle RandomizedSearchCV handoff",
      tuningDefaults: { trials: 25, folds: 5, randomState: 42 },
      durations: { manual: 15, features: 20, quality: 20, forecast: 60 },
      weights: { manual: 20, features: 20, quality: 20, evaluationEfficiency: 10, finalModel: 30 }
    },
    manualRows: event.manualRows,
    manualClasses: MANUAL_CLASSES,
    manualRules: [
      { priority: 1, label: "Accident", test: "incident_distance_m < 50 AND avg_vehicle_speed_kmph < 30\nOR\nincident_distance_m < 100 AND avg_vehicle_speed_kmph < 10" },
      { priority: 2, label: "Heavy_Traffic", test: "vehicle_count ≥ 25 AND avg_vehicle_speed_kmph < 25\nOR\nroad_occupancy_pct ≥ 70 AND avg_vehicle_speed_kmph < 20" },
      { priority: 3, label: "Pedestrian_Crossing", test: "pedestrian_count ≥ 10\nOR\npedestrian_count ≥ 6 AND vehicle_count < 15" },
      { priority: 4, label: "Normal_Traffic", test: "Fallback — applies only if none of Rules 1–3 fired." }
    ],
    features: event.features,
    featureMeta,
    trafficClasses: TRAFFIC_CLASSES,
    classDefinitions: [
      { name: "Free_Flow", cue: "Normal speed, lower occupancy, moderate volume." },
      { name: "Heavy_Traffic", cue: "High volume and occupancy with reduced speed." },
      { name: "Pedestrian_Event", cue: "Elevated pedestrian activity dominates the junction." },
      { name: "Incident", cue: "Disruption associated with a nearby flagged obstruction." },
      { name: "Low_Activity", cue: "Very little traffic or pedestrian activity." }
    ],
    trainPreview: event.trainDamaged.slice(0, 8),
    recordCounts: { manual: 50, trainingDelivered: event.trainDamaged.length, trainingCanonical: event.trainClean.length, finalTest: event.test.length },
    corruptionCounts: event.metadata.injected_problems,
    submissionSchema: ["event_id", "prediction"]
  });
}
