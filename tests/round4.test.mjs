import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG, ROUND4, searchPlan } from "../public/round4-config.js";
import { buildKaggleScript, normalizeTuning } from "../public/kaggle-export.js";
import { assignment } from "../api/_event.js";
import featuresHandler from "../api/features.js";
import qualityHandler from "../api/quality.js";
import { verifyState } from "../api/_state.js";

const features = assignment("round4-test").features.slice(0, 10);
test("all eight ensembles price wider ranges monotonically with bounded runtime targets", () => {
  assert.equal(Object.keys(MODEL_CATALOG).length, 8);
  for (const [name, config] of Object.entries(MODEL_CATALOG)) {
    let previous;
    for (let level = 1; level <= 5; level++) {
      const plan = searchPlan(name, Object.fromEntries(Object.keys(config.parameters).map(key => [key, level])));
      assert.equal(plan.combinations, level ** 4);
      if (previous) { assert.ok(plan.cost > previous.cost); assert.ok(plan.targetSeconds > previous.targetSeconds); }
      previous = plan;
      if (level === 1) { assert.equal(plan.cost, 8); assert.equal(plan.targetSeconds, 150); assert.equal(plan.folds, 3); }
      if (level === 5) { assert.equal(plan.cost, 50); assert.equal(plan.targetSeconds, 1050); assert.equal(plan.folds, 5); }
    }
    assert.equal(searchPlan(name).cost, 19);
    assert.ok(Math.abs(searchPlan(name).targetSeconds - 300) < 5);
    const code = buildKaggleScript({ model: name, features });
    assert.ok(code.includes(config.classifier));
    assert.ok(code.includes('PARAMETERS = json.loads('));
  }
  // A feasible 60+ minute search schedule, with a separate repair allowance.
  assert.ok(3 * 50 + 2 * 19 <= ROUND4.searchBudget);
  assert.ok(3 * 1050 + 2 * 298 >= 60 * 60);
  assert.equal(ROUND4.repairBudget, 50);
});

test("normalization cannot lower timed work below its floor and seed zero is preserved", () => {
  const plan = searchPlan("Random Forest", { n_estimators: -100, max_depth: Infinity, min_samples_leaf: 99, max_features: "bad" });
  assert.equal(plan.levels.n_estimators, 1);
  assert.equal(plan.levels.max_depth, 2);
  assert.equal(plan.levels.min_samples_leaf, 5);
  assert.equal(plan.levels.max_features, 2);
  assert.equal(normalizeTuning({ randomState: 0 }).randomState, 0);
  assert.throws(() => searchPlan("Decision Tree"), /eight/);
  assert.throws(() => buildKaggleScript({ model: "Random Forest", features: features.slice(0, 9) }), /ten/);
  assert.throws(() => buildKaggleScript({ model: "Random Forest", features, repairs: { missingColumns: ["not_locked"] } }), /locked/);
});

test("notebook repairs ignore stale methods on deselected columns and clear for emergency feed", () => {
  const args = { model: "Extra Trees", features, repairs: { missingColumns: [features[0]] }, tuning: { repairMethods: { missing: { [features[0]]: "mode", [features[1]]: "drop" }, outlier: { [features[2]]: "iqr_remove" } } } };
  const configLine = buildKaggleScript(args).split("\n").find(line => line.startsWith("REPAIR_METHODS ="));
  assert.ok(configLine.includes("mode"));
  assert.ok(!configLine.includes("drop"));
  assert.ok(!configLine.includes("iqr_remove"));
  const emergencyLine = buildKaggleScript({ ...args, emergencyFeed: true }).split("\n").find(line => line.startsWith("REPAIR_METHODS ="));
  assert.ok(!emergencyLine.includes("mode"));
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
