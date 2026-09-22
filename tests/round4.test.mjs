import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG, ROUND4, searchPlan } from "../public/round4-config.js";
import { buildKaggleScript, normalizeTuning } from "../public/kaggle-export.js";
import { assignment } from "../api/_event.js";
import featuresHandler from "../api/features.js";
import qualityHandler from "../api/quality.js";
import { verifyState } from "../api/_state.js";

const features = assignment("round4-test").features.slice(0, 10);
test("Round 4 exposes five ensemble and five regular models with proportional time and credit budgets", () => {
  assert.equal(Object.keys(MODEL_CATALOG).length, 10);
  assert.equal(Object.values(MODEL_CATALOG).filter(config => config.kind === "ensemble").length, 5);
  assert.equal(Object.values(MODEL_CATALOG).filter(config => config.kind === "regular").length, 5);
  assert.deepEqual(Object.keys(MODEL_CATALOG), ["Support Vector Machine", "Random Forest", "Soft Voting", "Decision Tree", "Logistic Regression", "Gradient Boosting", "K-Nearest Neighbors", "Stacked Ensemble", "Extra Trees", "SGD Classifier"]);
  for (const [name, config] of Object.entries(MODEL_CATALOG)) {
    let previous;
    for (let level = 1; level <= 5; level++) {
      const plan = searchPlan(name, Object.fromEntries(Object.keys(config.parameters).map(key => [key, level])));
      assert.equal(plan.combinations, Object.values(plan.parameters).reduce((count, values) => count * values.length, 1));
      if (previous) { assert.ok(plan.cost > previous.cost); assert.ok(plan.targetSeconds > previous.targetSeconds); }
      previous = plan;
      if (level === 1 && config.kind === "ensemble") { assert.equal(plan.cost, 8); assert.equal(plan.targetSeconds, 150); assert.equal(plan.folds, 3); }
      if (level === 1 && config.kind === "regular") { assert.equal(plan.cost, 5); assert.equal(plan.targetSeconds, 90); assert.equal(plan.folds, 3); }
    }
    const full = searchPlan(name, Object.fromEntries(Object.keys(config.parameters).map(key => [key, 99])));
    if (config.kind === "ensemble") { assert.equal(full.cost, 50); assert.equal(full.targetSeconds, 1050); }
    else { assert.equal(full.cost, 28); assert.equal(full.targetSeconds, 570); }
    const code = buildKaggleScript({ model: name, features });
    assert.ok(code.includes(config.classifier));
    assert.ok(code.includes('PARAMETERS = json.loads('));
  }
  assert.ok(570 >= 1050 / 2);
  assert.ok(90 >= 150 / 2);
  assert.equal(ROUND4.searchBudget, 150);
  assert.ok(3 * 50 <= ROUND4.searchBudget);
  assert.equal(ROUND4.repairBudget, 50);
});

test("normalization cannot lower timed work below its floor and seed zero is preserved", () => {
  const plan = searchPlan("Random Forest", { n_estimators: -100, max_depth: Infinity, min_samples_leaf: 99, max_features: "bad" });
  assert.equal(plan.levels.n_estimators, 1);
  assert.equal(plan.levels.max_depth, 2);
  assert.equal(plan.levels.min_samples_leaf, 5);
  assert.equal(plan.levels.max_features, 2);
  assert.equal(normalizeTuning({ randomState: 0 }).randomState, 0);
  assert.throws(() => searchPlan("Unknown Model"), /ten/);
  assert.throws(() => buildKaggleScript({ model: "Random Forest", features: features.slice(0, 9) }), /ten/);
  assert.throws(() => buildKaggleScript({ model: "Random Forest", features, repairs: { missingColumns: ["not_locked"] } }), /locked/);
});

test("notebook repairs ignore stale methods on deselected columns", () => {
  const args = { model: "Extra Trees", features, repairs: { missingColumns: [features[0]] }, tuning: { repairMethods: { missing: { [features[0]]: "mode", [features[1]]: "drop" }, outlier: { [features[2]]: "iqr_remove" } } } };
  const configLine = buildKaggleScript(args).split("\n").find(line => line.startsWith("REPAIR_METHODS ="));
  assert.ok(configLine.includes("mode"));
  assert.ok(!configLine.includes("drop"));
  assert.ok(!configLine.includes("iqr_remove"));
});

test("Round 4 API validates and seals actual selected repair methods", async () => {
  const invoke = async (handler, body) => {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: "POST", body }, res); return res;
  };
  const room = "740004", player = "round4-methods";
  const lock = await invoke(featuresHandler, { room, player, features });
  const base = { room, player, action: "seal", featureState: lock.body.featureState, repairs: { missingColumns: [features[0]], outlierColumns: [features[1]] } };
  const good = await invoke(qualityHandler, { ...base, missingMethods: { [features[0]]: "mean" }, outlierMethods: { [features[1]]: "median_clip" } });
  assert.equal(good.code, 200);
  const sealed = verifyState(good.body.qualityState, "quality", room, player);
  assert.equal(sealed.methods.missing[features[0]], "mean");
  assert.equal(sealed.methods.outlier[features[1]], "median_clip");
  assert.equal(good.body.repairSpend, 6);
  const bad = await invoke(qualityHandler, { ...base, missingMethods: { [features[0]]: "invalid" } });
  assert.equal(bad.code, 409);
  const over = await invoke(qualityHandler, { ...base, repairs: { missingColumns: features, outlierColumns: features } });
  assert.equal(over.code, 409);
});
