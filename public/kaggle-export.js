import { MODEL_CATALOG, searchPlan } from "./round4-config.js";
import { TRAINING_CODE } from "./round4-training.js";

export function normalizeTuning(raw = {}) {
  const seed = Number(raw.randomState ?? 42);
  return {
    randomState: Number.isFinite(seed) ? Math.max(0, Math.min(999999, Math.floor(seed))) : 42,
    ranges: raw.ranges || {}
  };
}

const modelSlug = model => String(model)
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, "_")
  .replaceAll(/^_+|_+$/g, "");

export function submissionFilename(model) {
  if (!MODEL_CATALOG[model]) throw new Error("Choose one of the ten Round 4 models.");
  return `submission_${modelSlug(model)}.csv`;
}

export function kaggleFilename(model, extension = "ipynb") {
  const slug = String(model).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  const kind = MODEL_CATALOG[model]?.kind || "model";
  return `${slug}-${kind}-search.${extension}`;
}

const pythonJSON = value => `json.loads(${JSON.stringify(JSON.stringify(value))})`;

// The UI owns the tuning ranges. These definitions only remove hidden model
// boosts that are not participant-controlled (for example class weights).
// Every parameter exposed in the UI still applies through set_params().
const BASELINE_CLASSIFIERS = Object.freeze({
  "Support Vector Machine": "make_pipeline(StandardScaler(), SVC(random_state=RANDOM_STATE))",
  "Random Forest": "RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1)",
  "Soft Voting": "VotingClassifier(estimators=[('forest', RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(random_state=RANDOM_STATE))], voting='soft', n_jobs=1)",
  "Decision Tree": "DecisionTreeClassifier(random_state=RANDOM_STATE)",
  "Logistic Regression": "make_pipeline(StandardScaler(), LogisticRegression(random_state=RANDOM_STATE))",
  "Gradient Boosting": "GradientBoostingClassifier(random_state=RANDOM_STATE)",
  "K-Nearest Neighbors": "make_pipeline(StandardScaler(), KNeighborsClassifier(n_jobs=1))",
  "Stacked Ensemble": "StackingClassifier(estimators=[('forest', RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1)), ('extra', ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1)), ('boost', HistGradientBoostingClassifier(random_state=RANDOM_STATE))], final_estimator=LogisticRegression(max_iter=1000, random_state=RANDOM_STATE), n_jobs=1)",
  "Extra Trees": "ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1)",
  "SGD Classifier": "make_pipeline(StandardScaler(), SGDClassifier(random_state=RANDOM_STATE, penalty='elasticnet'))"
});

const codeCell = source => ({
  cell_type: "code",
  execution_count: null,
  metadata: {},
  outputs: [],
  source: source.trim().split("\n").map(line => `${line}\n`)
});

export function buildKaggleScript({ model, features, repairs = {}, tuning = {}, notebook = false }) {
  const catalog = MODEL_CATALOG[model];
  if (!catalog) throw new Error("Choose one of the ten Round 4 models.");
  if (!Array.isArray(features) || features.length !== 10 || new Set(features).size !== 10 || features.some(name => !/^[a-z][a-z0-9_]*$/i.test(name))) {
    throw new Error("The notebook requires exactly ten locked features.");
  }

  const plan = searchPlan(model, tuning.ranges);
  const settings = normalizeTuning(tuning);
  const selected = { missingColumns: [], outlierColumns: [] };
  const methods = { missing: {}, outlier: {} };

  for (const [kind, key, allowed, fallback] of [
    ["missing", "missingColumns", ["median", "mean", "mode", "drop"], "median"],
    ["outlier", "outlierColumns", ["iqr_clip", "iqr_remove", "median_clip"], "iqr_clip"]
  ]) {
    selected[key] = [...new Set(repairs[key] || [])];
    for (const feature of selected[key]) {
      if (!features.includes(feature)) throw new Error("Repairs must use locked features.");
      const method = tuning.repairMethods?.[kind]?.[feature] || fallback;
      if (!allowed.includes(method)) throw new Error(`Invalid ${kind} repair method.`);
      methods[kind][feature] = method;
    }
  }

  const configuration = `import json
MODEL_NAME = ${JSON.stringify(model)}
FEATURES = ${pythonJSON(features)}
REPAIRS = ${pythonJSON(selected)}
REPAIR_METHODS = ${pythonJSON(methods)}
PARAMETERS = ${pythonJSON(plan.parameters)}
TARGET_SECONDS = ${plan.targetSeconds}
CV_FOLDS = ${plan.folds}
RANDOM_STATE = ${settings.randomState}
SEARCH_CREDITS = ${plan.cost}
TRAIN_FILE = "train_16.csv"
TEST_FILE = "test_16.csv"
SUBMISSION_FILE = ${JSON.stringify(submissionFilename(model))}`;

  const [setupCode, trainingCode] = TRAINING_CODE.split("# SELECTED_CLASSIFIER");
  if (trainingCode === undefined) throw new Error("Notebook training template is missing the classifier marker.");

  const classifierCode = [
    `# Classic ${model} model.`,
    "# Only the parameters selected in the competition UI are searched below.",
    `classifier = ${BASELINE_CLASSIFIERS[model]}`
  ].join("\n");

  const fullCode = `${configuration}\n\n${setupCode.trim()}\n\n${classifierCode}\n${trainingCode}`;
  if (!notebook) return fullCode;

  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" }
    },
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          `# Round 5 · ${model}\n`,
          "\n",
          "This notebook uses the selected model in its standard scikit-learn form. The only model tuning performed is the parameter search configured by your choices in the competition UI.\n",
          "\n",
          `Search target: **${(plan.targetSeconds / 60).toFixed(1)} minutes** · **${plan.cost} credits** · **${plan.folds}-fold Macro F1**.\n`,
          "\n",
          "The same locked features and data-quality repair choices are used throughout. Repair statistics are learned from training folds only, and the hidden test labels are never read.\n",
          "\n",
          `Final submission: **${submissionFilename(model)}**\n`
        ]
      },
      codeCell("%pip install -q pandas numpy scikit-learn threadpoolctl"),
      codeCell(`# Competition configuration\n${configuration}`),
      codeCell(setupCode),
      codeCell(classifierCode),
      codeCell(trainingCode)
    ]
  }, null, 2);
}
