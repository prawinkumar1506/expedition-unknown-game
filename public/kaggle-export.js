import { MODEL_CATALOG, searchPlan } from "./round4-config.js";
import { TRAINING_CODE } from "./round4-training.js";

export function normalizeTuning(raw = {}) {
  const seed = Number(raw.randomState ?? 42);
  return { randomState: Number.isFinite(seed) ? Math.max(0, Math.min(999999, Math.floor(seed))) : 42, ranges: raw.ranges || {} };
}
export function kaggleFilename(model, extension = "ipynb") {
  const slug = String(model).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  const legacy = new Set(["decision-tree", "logistic-regression", "k-nearest-neighbors", "support-vector-machine"]);
  return `${slug}-${legacy.has(slug) ? "randomized" : "ensemble"}-search.${extension}`;
}
const pythonJSON = value => `json.loads(${JSON.stringify(JSON.stringify(value))})`;

export function buildKaggleScript({ model, features, emergencyFeed = false, repairs = {}, tuning = {}, notebook = false }) {
  const legacySvm = model === "Support Vector Machine";
  const plan = legacySvm
    ? { parameters: { C: [0.1, 1, 10], gamma: ["scale", "auto"] }, targetSeconds: 150, folds: 3, cost: 8 }
    : searchPlan(model, tuning.ranges);
  const settings = normalizeTuning(tuning);
  if (!Array.isArray(features) || features.length !== 10 || new Set(features).size !== 10 || features.some(name => !/^[a-z][a-z0-9_]*$/i.test(name))) throw new Error("The notebook requires exactly ten locked features.");
  const selected = { missingColumns: [], outlierColumns: [] }, methods = { missing: {}, outlier: {} };
  if (!emergencyFeed) for (const [kind, key, allowed, fallback] of [["missing", "missingColumns", ["median", "mean", "mode", "drop"], "median"], ["outlier", "outlierColumns", ["iqr_clip", "iqr_remove", "median_clip"], "iqr_clip"]]) {
    selected[key] = [...new Set(repairs[key] || [])];
    for (const name of selected[key]) {
      if (!features.includes(name)) throw new Error("Repairs must use locked features.");
      const method = tuning.repairMethods?.[kind]?.[name] || fallback;
      if (!allowed.includes(method)) throw new Error(`Invalid ${kind} repair method.`);
      methods[kind][name] = method;
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
TRAIN_FILE = ${JSON.stringify(emergencyFeed ? "train_backup_10.csv" : "train_16.csv")}
TEST_FILE = ${JSON.stringify(emergencyFeed ? "test_backup_10.csv" : "test_16.csv")}
`;
  const classifier = legacySvm
    ? "SVC(kernel='rbf', probability=True, class_weight='balanced', random_state=RANDOM_STATE)"
    : MODEL_CATALOG[model].classifier;
  const code = configuration + TRAINING_CODE.replace("# SELECTED_CLASSIFIER", `classifier = ${classifier}`);
  if (!notebook) return code;
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5,
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
    cells: [
      { cell_type: "markdown", id: "round4-guide", metadata: {}, source: [
        `# Round 4 · ${model}\n`,
        `Target: **${(plan.targetSeconds / 60).toFixed(1)} minutes** · ${plan.cost} search credits · ${plan.folds}-fold Macro F1 search.\n`,
        "\nAttach only the participant train/test dataset in Kaggle, or put both CSVs beside this notebook. Use a CPU session. Requires Python 3.10+, scikit-learn 1.2+, pandas and threadpoolctl; these are included in Kaggle's standard image.\n",
        "\nRun the next cell. It searches for the allotted time, evaluates the chosen configuration on a held-out split, and refits on all training data. Slow machines may overrun while a trial finishes.\n",
        "\nOnly selected repairs are applied. Unselected missing cells receive zero as a baseline. All repair statistics are learned on training folds. Row-removal methods affect training only; all test IDs are preserved. Source CSVs are never overwritten.\n",
        "\nDownload **submission.csv** and upload it to the organizer's Kaggle competition. Retain the search CSV and evaluation JSON for review. Generating this notebook does not submit predictions to Kaggle.\n"
      ] },
      { cell_type: "code", id: "round4-search", metadata: {}, execution_count: null, outputs: [], source: code.split("\n").map(line => `${line}\n`) }
    ] }, null, 2);
}
