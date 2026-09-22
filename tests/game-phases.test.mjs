import test from "node:test";
import assert from "node:assert/strict";
import { assignment, manualClass, MANUAL_CLASSES } from "../api/_event.js";
import missionHandler from "../api/mission.js";
import labelsHandler from "../api/labels.js";
import analyzeHandler from "../api/analyze.js";
import featuresHandler from "../api/features.js";
import qualityHandler, { buildQualityPlan, scoreRepairPlan } from "../api/quality.js";
import datasetHandler from "../api/dataset.js";
import cameraHandler from "../api/camera.js";
import recoveryHandler from "../api/recovery.js";
import { buildKaggleScript, kaggleFilename, normalizeTuning } from "../public/kaggle-export.js";

const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; } });
const invoke = async (handler, body, query) => { const res = response(); await handler({ method: "POST", body, query }, res); return res; };

async function sealedFlow(room = "731904", player = "grid-cell") {
  const event = assignment(room), labels = Object.fromEntries(event.manualRows.map(row => [row.manual_id, manualClass(row)]));
  const manual = await invoke(labelsHandler, { room, player, labels });
  const selected = event.features.slice(0, 10), features = await invoke(featuresHandler, { room, player, features: selected });
  const planResponse = await invoke(qualityHandler, { room, player, action: "plan", featureState: features.body.featureState });
  const plan = planResponse.body.plan, repairs = { missingColumns: plan.missingColumns.slice(0, 3).map(item => item.feature), outlierColumns: plan.outlierColumns.slice(0, 2).map(item => item.feature), labelRecords: [], duplicateGroups: [] };
  const quality = await invoke(qualityHandler, { room, player, action: "seal", featureState: features.body.featureState, repairs });
  return { event, manual: manual.body, features: features.body, plan, quality: quality.body };
}

test("the supplied package loads the exact event-scale train/test tiers", async () => {
  const event = assignment("100001"), mission = await invoke(missionHandler, { room: "100001", player: "auditor" });
  assert.equal(event.trainDamaged.length, 2000);
  assert.equal(event.trainClean.length, event.trainDamaged.length);
  assert.equal(event.test.length, 500);
  assert.equal(event.features.length, 21);
  assert.equal(event.manualRows.length, 50);
  assert.deepEqual(Object.keys(event.test[0]).filter(key => key !== "event_id"), event.features);
  assert.ok(event.test.every(row => !("label" in row)));
  assert.equal(mission.body.mission.scope, "Events 2–5");
  assert.deepEqual(mission.body.submissionSchema, ["event_id", "prediction"]);
});

test("Event 1 recovery validates the required archive bundle and marks timeout failures", async () => {
  const room = "100001", player = "archive-team";
  const valid = await invoke(recoveryHandler, { room, player, files: [
    "JTU7_stream_A_core_20260314_0314_gen3.csv",
    "JTU7_stream_B_context_20260314_0314_gen3.csv",
    "JTU7_stream_C_labels_20260314_0314_gen3.csv"
  ], timeTakenSeconds: 420 });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.passed, true);
  assert.equal(valid.body.status, "completed");
  const invalid = await invoke(recoveryHandler, { room, player, files: ["wrong.csv", "JTU7_stream_B_context_20260314_0314_gen3.csv"], timeTakenSeconds: 120 });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /required archive bundle/i);
  const timeout = await invoke(recoveryHandler, { room, player, files: [], timeTakenSeconds: 900 });
  assert.equal(timeout.statusCode, 200);
  assert.equal(timeout.body.passed, false);
  assert.equal(timeout.body.status, "failed");
});

test("Manual Override uses QuickRead answer keys and scores only correct answers", async () => {
  const room = "200002", player = "paper-team", event = assignment(room); 
  assert.ok(event.manualRows.length > 0); assert.ok(event.manualRows.every(row => row.manual_id.startsWith("QR_")));
  assert.equal(event.quickreadAnswerKey.length, event.manualRows.length);
  assert.deepEqual(event.quickreadAnswerKey.map(row => row.correct_answer), event.manualRows.map(row => manualClass(row)));
  assert.equal(manualClass({ incident_distance_m: 49.9, avg_vehicle_speed_kmph: 29.9, vehicle_count: 70, road_occupancy_pct: 0, pedestrian_count: 30 }), "Accident");
  assert.equal(manualClass({ incident_distance_m: 99.9, avg_vehicle_speed_kmph: 9.9, vehicle_count: 0, road_occupancy_pct: 0, pedestrian_count: 0 }), "Accident");
  assert.equal(manualClass({ incident_distance_m: 100, avg_vehicle_speed_kmph: 19.9, vehicle_count: 24, road_occupancy_pct: 70, pedestrian_count: 0 }), "Heavy_Traffic");
  assert.equal(manualClass({ incident_distance_m: 100, avg_vehicle_speed_kmph: 24.9, vehicle_count: 25, road_occupancy_pct: 0, pedestrian_count: 30 }), "Heavy_Traffic");
  assert.equal(manualClass({ incident_distance_m: 100, avg_vehicle_speed_kmph: 50, vehicle_count: 14, road_occupancy_pct: 0, pedestrian_count: 6 }), "Pedestrian_Crossing");
  assert.equal(manualClass({ incident_distance_m: 100, avg_vehicle_speed_kmph: 50, vehicle_count: 15, road_occupancy_pct: 0, pedestrian_count: 9 }), "Normal_Traffic");
  const labels = {};
  event.manualRows.slice(0, 10).forEach(row => labels[row.manual_id] = row.correct_answer || manualClass(row));
  event.manualRows.slice(10, 15).forEach(row => labels[row.manual_id] = MANUAL_CLASSES.find(label => label !== (row.correct_answer || manualClass(row))));
  const res = await invoke(labelsHandler, { room, player, labels });
  assert.equal(res.statusCode, 200); assert.equal(res.body.correct, 10); assert.equal(res.body.wrong, 5); assert.equal(res.body.blank, 35); assert.equal(res.body.points, 10); assert.equal(res.body.score, 20); assert.ok(res.body.manualState);
});

test("Feature Hunt spends a signed 10-credit ledger and locks exactly ten channels", async () => {
  const room = "300003", player = "feature-team", event = assignment(room);
  const blocked = await invoke(analyzeHandler, { room, player, type: "importance" });
    assert.equal(blocked.statusCode, 400);
  const profiles = await invoke(analyzeHandler, { room, player, type: "classprofiles", feature: event.features[0] });
  assert.equal(profiles.body.creditsRemaining, 8);
  const correlation = await invoke(analyzeHandler, { room, player, type: "correlation", feature: event.features[0], secondFeature: event.features[1], analysisState: profiles.body.analysisState });
  assert.equal(correlation.body.creditsRemaining, 6);
  const completed = await invoke(featuresHandler, { room, player, features: event.features.slice(0, 9), analysisState: correlation.body.analysisState });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.selected.length, 10);
  assert.equal(completed.body.autoSelected.length, 1);
  assert.equal(completed.body.penalty, 2);
  const strongSelection = [...event.features.filter(feature => event.featureStrength[feature]?.intended_strength === "strong"), ...event.features.filter(feature => event.featureStrength[feature]?.intended_strength === "moderate").slice(0, 4)];
  const sealed = await invoke(featuresHandler, { room, player, features: strongSelection, analysisState: correlation.body.analysisState });
  assert.equal(sealed.statusCode, 200); assert.equal(sealed.body.selected.length, 10); assert.equal(sealed.body.strongCount + sealed.body.moderateCount + sealed.body.weakCount, 10); assert.ok(sealed.body.featureState);
});

test("Event 3 exposes only class profiles and correlation analysis", async () => {
  const event = assignment("350005"), feature = event.features[0];
  const profiles = await invoke(analyzeHandler, { room: "350005", player: "profiles-team", type: "classprofiles", feature });
  assert.equal(profiles.statusCode, 200);
  assert.equal(profiles.body.result.kind, "classprofiles");
  assert.equal(profiles.body.result.classes.length, 5);
  assert.ok(Object.hasOwn(profiles.body.result.classes[0], "missingPct"));
  assert.equal(profiles.body.result.evidence.method, "median spread divided by overall IQR");
  assert.match(profiles.body.result.explanation, /traffic|sensor|class/i);
  const related = await invoke(analyzeHandler, { room: "350006", player: "correlation-team", type: "correlation", feature: "rain_intensity_mmhr", secondFeature: "road_wetness_pct" });
  assert.equal(related.statusCode, 200);
  assert.equal(related.body.result.evidence.method, "Spearman rank correlation");
  assert.equal(related.body.result.evidence.strength, "strong");
  assert.ok(related.body.result.coefficient > 0.7);
  assert.match(related.body.result.explanation, /strongly connected/i);
  const unrelated = await invoke(analyzeHandler, { room: "350007", player: "correlation-team-2", type: "correlation", feature: "vehicle_count", secondFeature: "rain_intensity_mmhr" });
  assert.equal(unrelated.body.result.evidence.strength, "little");
  assert.match(unrelated.body.result.explanation, /very little connection/i);
  const relationship = await invoke(analyzeHandler, { room: "350008", player: "removed-tool-team", type: "relationship", feature: "vehicle_count", secondFeature: "avg_vehicle_speed_kmph" });
  assert.equal(relationship.statusCode, 400);
  const removed = await invoke(analyzeHandler, { room: "350005", player: "profiles-team", type: "stats", feature });
  assert.equal(removed.statusCode, 400);
});

test("Feature Hunt rejects channels outside the original telemetry set", async () => {
  const room = "360009", player = "original-only-team", event = assignment(room);
  const selected = [...event.features.slice(0, 9), "drv_fake_feature"];
  const lock = await invoke(featuresHandler, { room, player, features: selected });
  assert.equal(lock.statusCode, 400);
  assert.match(lock.body.error, /unavailable telemetry channel/i);
});

test("Feature Hunt scores strong channels at 2 points, moderate at 1, and weak at 0 out of 20", async () => {
  const room = "300010", player = "score-team", event = assignment(room);
  const profiles = await invoke(analyzeHandler, { room, player, type: "classprofiles", feature: event.features[0] });
  const correlation = await invoke(analyzeHandler, { room, player, type: "correlation", feature: event.features[0], secondFeature: event.features[1], analysisState: profiles.body.analysisState });
  const selected = [...event.features].slice(0, 10);
  const result = await invoke(featuresHandler, { room, player, features: selected, analysisState: correlation.body.analysisState });
  const total = selected.reduce((sum, feature) => {
    const strength = event.featureStrength[feature]?.intended_strength || "weak";
    return sum + (strength === "strong" ? 2 : strength === "moderate" ? 1 : 0);
  }, 0);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.pointsEarned, total);
  assert.equal(result.body.maxPoints, 20);
  assert.equal(result.body.score, Number(((total / 20) * 100).toFixed(1)));
  assert.equal(result.body.strongCount + result.body.moderateCount + result.body.weakCount, 10);
});

test("Data Quality Lab prices typed repair choices at 3 credits per column", async () => {
  const flow = await sealedFlow(), scored = scoreRepairPlan(flow.plan, flow.quality.qualityState ? { missingColumns: flow.plan.missingColumns.slice(0, 3).map(item => item.feature), outlierColumns: flow.plan.outlierColumns.slice(0, 2).map(item => item.feature), labelRecords: [], duplicateGroups: [] } : {});
  assert.equal(flow.quality.repairSpend, 15); assert.ok(flow.quality.qualityScore > 0); assert.ok(scored > 0);
    assert.equal(flow.quality.sealed, true);
});

test("Event 4 reports credit spend and elapsed time in the sealed quality payload", async () => {
  const room = "400005", player = "quality-team";
  const event = assignment(room);
  const featureLock = await invoke(featuresHandler, { room, player, features: event.features.slice(0, 10) });
  const planResponse = await invoke(qualityHandler, { room, player, action: "plan", featureState: featureLock.body.featureState });
  const plan = planResponse.body.plan;
  const repairs = {
    missingColumns: plan.missingColumns.slice(0, 3).map(item => item.feature),
    outlierColumns: plan.outlierColumns.slice(0, 2).map(item => item.feature),
    labelRecords: [],
    duplicateGroups: []
  };
  const result = await invoke(qualityHandler, { room, player, action: "seal", featureState: featureLock.body.featureState, repairs, timeTakenSeconds: 273 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.repairSpend, 15);
  assert.equal(result.body.timeTakenSeconds, 273);
});

test("feature and quality choices are baked into prepared train/test datasets", async () => {
  const room = "450005", player = "prepared-data-team", event = assignment(room), selected = event.features.slice(0, 10);
  const featureLock = await invoke(featuresHandler, { room, player, features: selected });
  assert.equal(featureLock.statusCode, 200);
  const featureDataset = await invoke(datasetHandler, { room, player, stage: "features", featureState: featureLock.body.featureState });
  assert.equal(featureDataset.statusCode, 200);
  assert.deepEqual(featureDataset.body.summary.features, selected);
  assert.equal(featureDataset.body.summary.trainRows, 2000);
  assert.equal(featureDataset.body.summary.testRows, 500);
  const planResponse = await invoke(qualityHandler, { room, player, action: "plan", featureState: featureLock.body.featureState });
  const missingFeature = planResponse.body.plan.missingColumns.find(item => item.issueCount > 0)?.feature;
  const outlierFeature = planResponse.body.plan.outlierColumns.find(item => item.issueCount > 0)?.feature;
  const repairs = { missingColumns: missingFeature ? [missingFeature] : [], outlierColumns: outlierFeature ? [outlierFeature] : [] };
  const quality = await invoke(qualityHandler, { room, player, action: "seal", featureState: featureLock.body.featureState, repairs, missingMethods: missingFeature ? { [missingFeature]: "median" } : {}, outlierMethods: outlierFeature ? { [outlierFeature]: "iqr_clip" } : {} });
  assert.equal(quality.statusCode, 200);
  const prepared = await invoke(datasetHandler, { room, player, stage: "quality", qualityState: quality.body.qualityState, includeContent: true });
  assert.equal(prepared.statusCode, 200);
  assert.equal(prepared.body.trainFilename, "train_ready.csv");
  assert.equal(prepared.body.testFilename, "test_ready.csv");
  if (missingFeature) assert.ok(prepared.body.summary.missingTrain < featureDataset.body.summary.missingTrain);
  assert.equal(prepared.body.trainCsv.split("\n", 1)[0], ["event_id", ...selected, "label"].join(","));
  assert.equal(prepared.body.testCsv.split("\n", 1)[0], ["event_id", ...selected].join(","));
  assert.ok(!prepared.body.trainCsv.split("\n", 1)[0].includes(event.features[10]));
});

test("Round 4 notebook reuses unchanged source datasets and carries feature/repair decisions", () => {
  const tuning = normalizeTuning({ randomState: 90210, ranges: { n_estimators: 2, max_depth: 2, min_samples_leaf: 2, max_features: 2 } });
  const selected = assignment("500005").features.slice(0, 10);
  const notebook = JSON.parse(buildKaggleScript({ model: "Random Forest", features: selected, repairs: { missingColumns: [selected[0]], outlierColumns: [selected[1]] }, tuning: { ...tuning, repairMethods: { missing: { [selected[0]]: "median" }, outlier: { [selected[1]]: "iqr_clip" } } }, notebook: true }));
  const code = notebook.cells.find(cell => cell.cell_type === "code").source.join("");
  assert.equal(notebook.nbformat, 4);
  assert.match(code, /TRAIN_FILE = "train_16\.csv"/);
  assert.match(code, /TEST_FILE = "test_16\.csv"/);
  assert.match(code, /REPAIRS = json\.loads/);
  assert.match(code, /REPAIR_METHODS = json\.loads/);
  assert.match(code, /find_data/);
  assert.match(code, /RepairedClassifier/);
  assert.match(code, /classification_report/);
  assert.match(code, /randomized_search_results\.csv/);
  assert.match(code, /best_model_evaluation\.json/);
  assert.match(code, /submission\.to_csv\("submission\.csv", index=False\)/);
  assert.doesNotMatch(code, /train_ready|test_ready|test_truth|train_clean/);
  assert.equal(kaggleFilename("Decision Tree", "ipynb"), "decision-tree-regular-search.ipynb");
});

test("Round 4 lasts 90 minutes and completion opens after 60 minutes", async () => {
  const { ROUND4 } = await import("../public/round4-config.js");
  assert.equal(ROUND4.durationSeconds, 90 * 60);
  assert.equal(ROUND4.minimumSeconds, 60 * 60);
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../public/game.js", import.meta.url), "utf8");
  assert.match(source, /QUALITY_TIMEOUT_SECONDS\s*=\s*ROUND4\.durationSeconds/);
  assert.match(source, /round4Elapsed\(\) < ROUND4\.minimumSeconds/);
  assert.match(source, /round4Closed\(\) \|\| generatingNotebook/);
});

test("the retired camera route states that Event 2 is tabular", () => {
  const res = response(); cameraHandler({}, res); assert.equal(res.statusCode, 410); assert.match(res.body, /tabular junction readings/);
});
