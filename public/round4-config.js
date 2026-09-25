// The Round 4 UI and exported notebook share this catalog and pricing policy.
export const ROUND4 = Object.freeze({ durationSeconds: 90 * 60, minimumSeconds: 0, creditBudget: 200 });
const parameter = (label, values) => ({ label, values });
const SEARCH_PROFILES = Object.freeze({
  ensemble: Object.freeze({ minSeconds: 150, maxSeconds: 1050, minCost: 8, maxCost: 50 }),
  regular: Object.freeze({ minSeconds: 90, maxSeconds: 570, minCost: 5, maxCost: 28 })
});
export const MODEL_CATALOG = {
  "Support Vector Machine": { kind: "regular", family: "Kernel method", description: "A scaled SVM explores margin strength, kernel width, convergence tolerance, and kernel family.", classifier: "make_pipeline(StandardScaler(), SVC(class_weight='balanced', random_state=RANDOM_STATE))", parameters: {
    svc__C: parameter("Margin penalty C", [0.1, 0.3, 1, 3, 10]), svc__gamma: parameter("Kernel gamma", [0.0003, 0.001, 0.003, 0.01, "scale"]), svc__tol: parameter("Tolerance", [0.01, 0.003, 0.001, 0.0003, 0.0001]), svc__kernel: parameter("Kernel", ["rbf", "poly", "sigmoid", "linear"]) } },
  "Random Forest": { kind: "ensemble", family: "Bagging", description: "Balanced bootstrapped trees. A strong starting point for noisy telemetry.", classifier: "RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1, class_weight='balanced_subsample')", parameters: {
    n_estimators: parameter("Trees", [200, 400, 700, 1000, 1500]), max_depth: parameter("Tree depth", [6, 10, 16, 24, null]), min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]), max_features: parameter("Features per split", [0.4, 0.55, 0.7, 0.85, 1.0]) } },
  "Soft Voting": { kind: "ensemble", family: "Mixed voting", description: "Average probabilities from a forest, extra trees, and histogram boosting.", classifier: "VotingClassifier(estimators=[('forest', RandomForestClassifier(n_estimators=160, random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(n_estimators=200, random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(max_iter=120, early_stopping=False, random_state=RANDOM_STATE))], voting='soft', n_jobs=1)", parameters: {
    forest__n_estimators: parameter("Forest trees", [160, 240, 340, 430, 520]), extra__n_estimators: parameter("Extra trees", [200, 300, 420, 520, 650]), boost__max_iter: parameter("Boosting rounds", [120, 180, 260, 340, 420]), boost__learning_rate: parameter("Boosting learning rate", [0.03, 0.05, 0.1, 0.15, 0.2]) } },
  "Decision Tree": { kind: "regular", family: "Single tree", description: "One interpretable tree; depth, split size, leaf size, and feature sampling control its bias and variance.", classifier: "DecisionTreeClassifier(random_state=RANDOM_STATE, class_weight='balanced')", parameters: {
    max_depth: parameter("Tree depth", [4, 8, 12, 20, null]), min_samples_split: parameter("Minimum split samples", [2, 5, 10, 20, 40]), min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]), max_features: parameter("Features per split", [0.4, 0.55, 0.7, 0.85, 1.0]) } },
  "Logistic Regression": { kind: "regular", family: "Linear classifier", description: "A scaled linear baseline with regularization strength, solver, tolerance, and iteration budget to explore.", classifier: "make_pipeline(StandardScaler(), LogisticRegression(random_state=RANDOM_STATE, class_weight='balanced'))", parameters: {
    logisticregression__C: parameter("Inverse regularization", [0.03, 0.1, 0.3, 1, 3]), logisticregression__solver: parameter("Solver", ["lbfgs", "liblinear", "newton-cg", "sag", "saga"]), logisticregression__tol: parameter("Tolerance", [0.01, 0.003, 0.001, 0.0003, 0.0001]), logisticregression__max_iter: parameter("Iteration cap", [200, 400, 800, 1600, 3000]) } },
  "Gradient Boosting": { kind: "ensemble", family: "Sequential boosting", description: "Successive trees correct earlier errors. Depth and learning rate matter.", classifier: "GradientBoostingClassifier(random_state=RANDOM_STATE)", parameters: {
    n_estimators: parameter("Boosting rounds", [100, 180, 280, 380, 500]), max_depth: parameter("Tree depth", [1, 2, 3, 4, 5]), learning_rate: parameter("Learning rate", [0.03, 0.05, 0.1, 0.15, 0.2]), subsample: parameter("Training fraction", [0.6, 0.7, 0.8, 0.9, 1.0]) } },
  "K-Nearest Neighbors": { kind: "regular", family: "Instance based", description: "Scaled nearest-neighbor classification. Search neighborhood size, tree leaf size, distance power, and distance metric.", classifier: "make_pipeline(StandardScaler(), KNeighborsClassifier(n_jobs=1))", parameters: {
    kneighborsclassifier__n_neighbors: parameter("Neighbors", [3, 5, 9, 15, 25]), kneighborsclassifier__leaf_size: parameter("Leaf size", [15, 25, 35, 50, 75]), kneighborsclassifier__p: parameter("Minkowski power", [1, 1.25, 1.5, 1.75, 2]), kneighborsclassifier__metric: parameter("Distance metric", ["euclidean", "manhattan", "chebyshev", "minkowski", "canberra"]) } },
  "Stacked Ensemble": { kind: "ensemble", family: "Out-of-fold stacking", description: "A logistic meta-model learns how to combine three complementary ensembles.", classifier: "StackingClassifier(estimators=[('forest', RandomForestClassifier(n_estimators=80, random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(n_estimators=100, random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(max_iter=60, early_stopping=False, random_state=RANDOM_STATE))], final_estimator=LogisticRegression(max_iter=2000), cv=2, n_jobs=1)", parameters: {
    forest__n_estimators: parameter("Forest trees", [80, 120, 170, 230, 300]), extra__n_estimators: parameter("Extra trees", [100, 150, 220, 300, 400]), boost__max_iter: parameter("Boosting rounds", [60, 90, 130, 180, 240]), final_estimator__C: parameter("Meta-model C", [0.01, 0.1, 1, 10, 100]) } },
  "Extra Trees": { kind: "ensemble", family: "Randomized trees", description: "Randomized splits explore different boundaries with less correlated trees.", classifier: "ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1, class_weight='balanced')", parameters: {
    n_estimators: parameter("Trees", [250, 500, 800, 1200, 1800]), max_depth: parameter("Tree depth", [6, 10, 16, 24, null]), min_samples_leaf: parameter("Minimum leaf samples", [1, 2, 4, 8, 16]), max_features: parameter("Features per split", [0.4, 0.55, 0.7, 0.85, 1.0]) } },
  "SGD Classifier": { kind: "regular", family: "Stochastic linear", description: "A scaled elastic-net linear model that explores loss functions and optimization strength over repeated CV cycles.", classifier: "make_pipeline(StandardScaler(), SGDClassifier(random_state=RANDOM_STATE, class_weight='balanced', penalty='elasticnet'))", parameters: {
    sgdclassifier__loss: parameter("Loss", ["hinge", "log_loss", "modified_huber", "squared_hinge", "perceptron"]), sgdclassifier__alpha: parameter("Regularization alpha", [0.000001, 0.00001, 0.0001, 0.001, 0.01]), sgdclassifier__l1_ratio: parameter("Elastic-net L1 ratio", [0.05, 0.15, 0.3, 0.5, 0.8]), sgdclassifier__max_iter: parameter("Iteration cap", [500, 1000, 2000, 4000, 8000]) } }
};

export function searchPlan(model, ranges = {}) {
  const catalog = MODEL_CATALOG[model];
  if (!catalog) throw new Error("Choose one of the ten Round 4 models.");
  const levels = {}, parameters = {};
  for (const [key, parameter] of Object.entries(catalog.parameters)) {
    const raw = Number(ranges[key] ?? 2);
    const level = Math.max(1, Math.min(parameter.values.length, Number.isFinite(raw) ? Math.round(raw) : 2));
    levels[key] = level;
    parameters[key] = parameter.values.slice(0, level);
  }
  const breadth = Object.entries(levels).reduce((sum, [key, level]) => sum + (level - 1) / (catalog.parameters[key].values.length - 1), 0) / Object.keys(levels).length;
  const profile = SEARCH_PROFILES[catalog.kind];
  return { kind: catalog.kind, levels, parameters,
    cost: profile.minCost + Math.ceil((profile.maxCost - profile.minCost) * breadth),
    targetSeconds: Math.round(profile.minSeconds + (profile.maxSeconds - profile.minSeconds) * breadth ** 1.3),
    folds: 3 + Math.floor(2 * breadth), combinations: Object.values(parameters).reduce((n, values) => n * values.length, 1) };
}
