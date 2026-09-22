// The Round 4 UI and exported notebook share this catalog and pricing policy.
export const ROUND4 = Object.freeze({ durationSeconds: 90 * 60, minimumSeconds: 60 * 60, repairBudget: 50, searchBudget: 150 });
const parameter = (label, values) => ({ label, values });
export const MODEL_CATALOG = {
  "Random Forest": { family: "Bagging", description: "Balanced bootstrapped trees. A strong starting point for noisy telemetry.", classifier: "RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1, class_weight='balanced_subsample')", parameters: {
    n_estimators: parameter("Trees", [200, 400, 700, 1000, 1500]), max_depth: parameter("Tree depth", [6, 10, 16, 24, null]), min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]), max_features: parameter("Features per split", [0.4, 0.55, 0.7, 0.85, 1.0]) } },
  "Extra Trees": { family: "Randomized ensemble", description: "Randomized splits explore different boundaries with less correlated trees.", classifier: "ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1, class_weight='balanced')", parameters: {
    n_estimators: parameter("Trees", [250, 500, 800, 1200, 1800]), max_depth: parameter("Tree depth", [6, 10, 16, 24, null]), min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]), max_features: parameter("Features per split", [0.4, 0.55, 0.7, 0.85, 1.0]) } },
  "Gradient Boosting": { family: "Sequential boosting", description: "Successive trees correct earlier errors. Depth and learning rate matter.", classifier: "GradientBoostingClassifier(random_state=RANDOM_STATE)", parameters: {
    n_estimators: parameter("Boosting rounds", [100, 180, 280, 380, 500]), max_depth: parameter("Tree depth", [1, 2, 3, 4, 5]), learning_rate: parameter("Learning rate", [0.03, 0.05, 0.1, 0.15, 0.2]), subsample: parameter("Training fraction", [0.6, 0.7, 0.8, 0.9, 1.0]) } },
  "Histogram Boosting": { family: "Binned boosting", description: "Fast binned trees trade split precision for more search experiments.", classifier: "HistGradientBoostingClassifier(random_state=RANDOM_STATE, early_stopping=False)", parameters: {
    max_iter: parameter("Boosting rounds", [150, 300, 500, 750, 1000]), max_leaf_nodes: parameter("Leaf nodes", [7, 15, 31, 47, 63]), learning_rate: parameter("Learning rate", [0.03, 0.05, 0.1, 0.15, 0.2]), l2_regularization: parameter("L2 regularization", [0, 0.1, 1, 5, 10]) } },
  "AdaBoost": { family: "Adaptive boosting", description: "Focus on difficult readings with a sequence of shallow decision trees.", classifier: "AdaBoostClassifier(estimator=DecisionTreeClassifier(random_state=RANDOM_STATE), random_state=RANDOM_STATE)", parameters: {
    n_estimators: parameter("Boosting rounds", [150, 300, 500, 800, 1200]), estimator__max_depth: parameter("Base tree depth", [1, 2, 3, 4, 5]), learning_rate: parameter("Learning rate", [0.03, 0.1, 0.3, 0.6, 1.0]), estimator__min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]) } },
  "Bagged Trees": { family: "Bootstrap ensemble", description: "Resample rows and channels to reduce the variance of deep trees.", classifier: "BaggingClassifier(estimator=DecisionTreeClassifier(random_state=RANDOM_STATE, class_weight='balanced'), random_state=RANDOM_STATE, n_jobs=1)", parameters: {
    n_estimators: parameter("Bagged estimators", [100, 200, 400, 600, 900]), estimator__max_depth: parameter("Base tree depth", [6, 10, 16, 24, null]), max_samples: parameter("Rows per estimator", [0.5, 0.65, 0.75, 0.9, 1.0]), max_features: parameter("Channels per estimator", [0.5, 0.65, 0.75, 0.9, 1.0]) } },
  "Soft Voting": { family: "Mixed ensemble", description: "Average probabilities from a forest, extra trees, and histogram boosting.", classifier: "VotingClassifier(estimators=[('forest', RandomForestClassifier(n_estimators=160, random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(n_estimators=200, random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(max_iter=120, early_stopping=False, random_state=RANDOM_STATE))], voting='soft', n_jobs=1)", parameters: {
    forest__n_estimators: parameter("Forest trees", [160, 240, 340, 430, 520]), extra__n_estimators: parameter("Extra trees", [200, 300, 420, 520, 650]), boost__max_iter: parameter("Boosting rounds", [120, 180, 260, 340, 420]), boost__learning_rate: parameter("Boosting learning rate", [0.03, 0.05, 0.1, 0.15, 0.2]) } },
  "Stacked Ensemble": { family: "Out-of-fold stacking", description: "A logistic meta-model learns how to combine three complementary ensembles.", classifier: "StackingClassifier(estimators=[('forest', RandomForestClassifier(n_estimators=80, random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(n_estimators=100, random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(max_iter=60, early_stopping=False, random_state=RANDOM_STATE))], final_estimator=LogisticRegression(max_iter=2000), cv=2, n_jobs=1)", parameters: {
    forest__n_estimators: parameter("Forest trees", [80, 120, 170, 230, 300]), extra__n_estimators: parameter("Extra trees", [100, 150, 220, 300, 400]), boost__max_iter: parameter("Boosting rounds", [60, 90, 130, 180, 240]), final_estimator__C: parameter("Meta-model C", [0.01, 0.1, 1, 10, 100]) } }
};

export function searchPlan(model, ranges = {}) {
  const catalog = MODEL_CATALOG[model];
  if (!catalog) throw new Error("Choose one of the eight Round 4 ensembles.");
  const levels = {}, parameters = {};
  for (const [key, parameter] of Object.entries(catalog.parameters)) {
    const raw = Number(ranges[key] ?? 2);
    const level = Math.max(1, Math.min(parameter.values.length, Number.isFinite(raw) ? Math.round(raw) : 2));
    levels[key] = level;
    parameters[key] = parameter.values.slice(0, level);
  }
  const breadth = Object.entries(levels).reduce((sum, [key, level]) => sum + (level - 1) / (catalog.parameters[key].values.length - 1), 0) / Object.keys(levels).length;
  return { levels, parameters, cost: 8 + Math.ceil(42 * breadth), targetSeconds: Math.round(150 + 900 * breadth ** 1.3), folds: 3 + Math.floor(2 * breadth), combinations: Object.values(parameters).reduce((n, values) => n * values.length, 1) };
}
