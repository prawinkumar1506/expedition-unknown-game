const MODEL_CONFIGS = {
  "Decision Tree": {
    classifier: "DecisionTreeClassifier(random_state=RANDOM_STATE)",
    space: `{
    "classifier__criterion": ["gini", "entropy", "log_loss"],
    "classifier__max_depth": [4, 6, 8, 12, None],
    "classifier__min_samples_split": randint(2, 25),
    "classifier__min_samples_leaf": randint(1, 12),
    "classifier__class_weight": [None, "balanced"],
}`
  },
  "Logistic Regression": {
    classifier: "LogisticRegression(max_iter=2500, random_state=RANDOM_STATE)",
    space: `{
    "classifier__C": loguniform(1e-3, 1e2),
    "classifier__solver": ["lbfgs", "saga"],
    "classifier__penalty": ["l2"],
    "classifier__class_weight": [None, "balanced"],
}`
  },
  "K-Nearest Neighbors": {
    classifier: "KNeighborsClassifier()",
    space: `{
    "classifier__n_neighbors": randint(3, 55),
    "classifier__weights": ["uniform", "distance"],
    "classifier__p": [1, 2],
    "classifier__leaf_size": randint(15, 61),
}`
  },
  "Random Forest": {
    classifier: "RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1)",
    space: `{
    "classifier__n_estimators": randint(200, 701),
    "classifier__max_depth": [6, 10, 16, 24, None],
    "classifier__min_samples_split": randint(2, 21),
    "classifier__min_samples_leaf": randint(1, 9),
    "classifier__max_features": ["sqrt", "log2", None],
    "classifier__class_weight": [None, "balanced", "balanced_subsample"],
}`
  },
  "Support Vector Machine": {
    classifier: "SVC(kernel=\"rbf\", random_state=RANDOM_STATE)",
    space: `{
    "classifier__C": loguniform(1e-3, 1e2),
    "classifier__gamma": loguniform(1e-4, 1e0),
    "classifier__class_weight": [None, "balanced"],
}`
  }
};

const FEATURE_RANGES = {
  vehicle_count: [0, 90], avg_vehicle_speed_kmph: [0, 90], road_occupancy_pct: [0, 100], pedestrian_count: [0, 70],
  time_of_day_hr: [0, 24], visibility_m: [25, 3000], rain_intensity_mmhr: [0, 45], signal_wait_time_s: [0, 200],
  road_wetness_pct: [0, 100], incident_distance_m: [1, 500], noise_level_db: [35, 100], ambient_temperature_c: [2, 45],
  humidity_pct: [15, 100], camera_exposure_score: [0, 100], camera_focus_score: [0, 100], lane_marking_visibility_pct: [0, 100]
};

const clampInt = (value, fallback, low, high) => Math.max(low, Math.min(high, Number.parseInt(value, 10) || fallback));
const identifiers = values => [...new Set(Array.isArray(values) ? values : [])].filter(value => typeof value === "string" && /^[a-z][a-z0-9_]*$/i.test(value));
const repairIds = values => [...new Set(Array.isArray(values) ? values : [])].filter(value => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value));

export function normalizeTuning(raw = {}) {
  return {
    trials: clampInt(raw.trials, 25, 5, 100),
    folds: clampInt(raw.folds, 5, 3, 10),
    randomState: clampInt(raw.randomState, 42, 0, 999999)
  };
}

export function kaggleFilename(model, extension = "ipynb") {
  const stem = String(model).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || "model";
  return `${stem}-randomized-search.${extension}`;
}

function buildNotebookPayload({ model, features, trainFile = "train_ready.csv", testFile = "test_ready.csv", tuning = {} }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The local notebook requires exactly ten locked features.");
  const settings = normalizeTuning(tuning);
  const chosenParameters = tuning.hyperparameters && typeof tuning.hyperparameters === "object" ? tuning.hyperparameters : {};
  const parameterSpace = Object.fromEntries(Object.entries(chosenParameters).map(([key, value]) => [`classifier__${key}`, Array.isArray(value) ? value : [value]]));
  const notebookCode = [
    "import json",
    "import time",
    "from datetime import datetime",
    "",
    "import pandas as pd",
    "from scipy.stats import randint, loguniform",
    "from sklearn.ensemble import RandomForestClassifier",
    "from sklearn.linear_model import LogisticRegression",
    "from sklearn.metrics import classification_report, f1_score",
    "from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split",
    "from sklearn.neighbors import KNeighborsClassifier",
    "from sklearn.pipeline import Pipeline",
    "from sklearn.preprocessing import StandardScaler",
    "from sklearn.svm import SVC",
    "from sklearn.tree import DecisionTreeClassifier",
    "",
    `MODEL_NAME = ${JSON.stringify(model)}`,
    `FEATURES = ${JSON.stringify(safeFeatures)}`,
    `N_ITER = ${settings.trials}`,
    `CV_FOLDS = ${settings.folds}`,
    `RANDOM_STATE = ${settings.randomState}`,
    "",
    "def log(stage, message):",
    "    print(f'[{datetime.now().strftime(\"%H:%M:%S\")}] {stage:<18} | {message}', flush=True)",
    "",
    "run_started = time.perf_counter()",
    "log('START', 'Operation Clearway model run started')",
    "log('CONFIG', f'Model={MODEL_NAME} | trials={N_ITER} | CV folds={CV_FOLDS} | random_state={RANDOM_STATE}')",
    "log('CONFIG', f'Locked features ({len(FEATURES)}): {FEATURES}')",
    "",
    `log('LOAD DATA', 'Reading ${trainFile} and ${testFile}')`,
    `train_df = pd.read_csv(${JSON.stringify(trainFile)}).copy()`,
    `test_df = pd.read_csv(${JSON.stringify(testFile)}).copy()`,
    "log('LOAD DATA', f'Train shape={train_df.shape} | Test shape={test_df.shape}')",
    "log('LOAD DATA', f'Train columns={list(train_df.columns)}')",
    "log('LOAD DATA', f'Test columns={list(test_df.columns)}')",
    "",
    "log('PREPARE', 'Separating identifiers/label from model inputs')",
    "X = train_df.drop(columns=['event_id', 'label']).copy()",
    "y = train_df['label'].astype(str).copy()",
    "X_test = test_df.drop(columns=['event_id']).copy()",
    "log('VALIDATE', 'Checking prepared dataset schema and missing values')",
    "if list(X.columns) != FEATURES or list(X_test.columns) != FEATURES:",
    "    raise ValueError('Prepared CSV columns do not match the locked feature set.')",
    "if X.isna().any().any() or X_test.isna().any().any():",
    "    raise ValueError('Prepared datasets still contain missing values. Return to Data Quality Lab and repair them before training.')",
    "log('VALIDATE', 'Schema OK | no unresolved missing values found')",
    "log('VALIDATE', f'Class distribution: {y.value_counts().to_dict()}')",
    "",
    "log('SPLIT', 'Creating stratified 80/20 train-validation split')",
    "X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)",
    "log('SPLIT', f'Train rows={len(X_train)} | Validation rows={len(X_valid)}')",
    "",
    "log('PIPELINE', f'Creating {MODEL_NAME} with StandardScaler')",
    `model = ${config.classifier}`,
    "",
    "pipeline = Pipeline([",
    "    ('scaler', StandardScaler()),",
    "    ('classifier', model),",
    "])",
    "log('PIPELINE', f'Pipeline={pipeline}')",
    "",
    `param_space = json.loads(${JSON.stringify(JSON.stringify(parameterSpace))}) if ${Object.keys(parameterSpace).length ? "True" : "False"} else ${config.space}`,
    "log('TUNING SETUP', f'Parameter space={param_space}')",
    "",
    "cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)",
    "total_fits = N_ITER * CV_FOLDS",
    "log('TRAIN/TUNE SETUP', f'RandomizedSearchCV will train {N_ITER} candidate configurations x {CV_FOLDS} folds = {total_fits} model fits')",
    "search = RandomizedSearchCV(",
    "    estimator=pipeline,",
    "    param_distributions=param_space,",
    "    n_iter=N_ITER,",
    "    scoring='f1_macro',",
    "    cv=cv,",
    "    random_state=RANDOM_STATE,",
    "    refit=True,",
    "    n_jobs=-1,",
    "    verbose=2,",
    ")",
    "log('TRAIN/TUNE START', f'Starting {total_fits} training fits on the training split; each CV fit will be logged below')",
    "tuning_started = time.perf_counter()",
    "search.fit(X_train, y_train)",
    "log('TRAIN/TUNE DONE', f'All candidate training fits completed in {time.perf_counter() - tuning_started:.2f}s')",
    "log('BEST CV', f'Best macro F1={search.best_score_:.4f}')",
    "log('BEST PARAMS', json.dumps(search.best_params_, indent=2, default=str))",
    "",
    "log('VALIDATION', 'Evaluating best tuned model on the held-out validation set')",
    "valid_pred = search.predict(X_valid)",
    "valid_f1 = f1_score(y_valid, valid_pred, average='macro')",
    "log('VALIDATION', f'Held-out macro F1={valid_f1:.4f}')",
    "print('\\n=== VALIDATION CLASSIFICATION REPORT ===', flush=True)",
    "print(classification_report(y_valid, valid_pred))",
    "",
    "log('FINAL TRAIN', f'Training the selected best pipeline on all {len(X)} prepared training rows')",
    "final_model = search.best_estimator_",
    "final_fit_started = time.perf_counter()",
    "final_model.fit(X, y)",
    "log('FINAL TRAIN', f'Final model training completed in {time.perf_counter() - final_fit_started:.2f}s')",
    "",
    "log('PREDICT TEST', f'Generating predictions for {len(X_test)} unseen test rows')",
    "test_predictions = final_model.predict(X_test)",
    "prediction_counts = pd.Series(test_predictions).value_counts().to_dict()",
    "log('PREDICT TEST', f'Prediction distribution={prediction_counts}')",
    "submission = pd.DataFrame({'event_id': test_df['event_id'], 'prediction': test_predictions})",
    "log('WRITE OUTPUT', 'Writing submission.csv')",
    "submission.to_csv(\"submission.csv\", index=False)",
    "log('WRITE OUTPUT', f'submission.csv written successfully with {len(submission)} rows')",
    "print('\\n=== SUBMISSION PREVIEW ===', flush=True)",
    "print(submission.head(10).to_string(index=False))",
    "log('COMPLETE', f'Entire run finished in {time.perf_counter() - run_started:.2f}s')",
  ];

  const notebook = {
    cells: [
      {
        cell_type: "markdown",
        metadata: { id: "clearway-overview", language: "markdown" },
        source: [
          "# Operation Clearway — Local model notebook\n",
          "\n",
          "Feature selection and data-quality repairs have already been applied to the prepared CSV files. This notebook only evaluates, scales, tunes, trains, and predicts.\n",
          `- Model: ${model}\n`,
          `- Features: ${safeFeatures.join(", ")}\n`,
          `- Train file: ${trainFile}\n`,
          `- Test file: ${testFile}\n`
        ]
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: { id: "clearway-training", language: "python" },
        outputs: [],
        source: notebookCode.map(line => `${line}\n`)
      },
      {
        cell_type: "markdown",
        metadata: { id: "clearway-notes", language: "markdown" },
        source: [
          "## Notes\n",
          "- Do not replace the prepared CSV files with the original source files; your game decisions are already baked into them.\n",
          "- The generated submission file is saved locally as `submission.csv`.\n"
        ]
      }
    ],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3"
      },
      language_info: { name: "python", version: "3.x" }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
  return JSON.stringify(notebook, null, 2);
}

export function buildKaggleScript({ model, features, trainFile = "train_ready.csv", testFile = "test_ready.csv", tuning = {}, notebook = false }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The local model handoff requires exactly ten locked features.");
  const settings = normalizeTuning(tuning);
  if (notebook) return buildNotebookPayload({ model, features: safeFeatures, trainFile, testFile, tuning: { ...settings, hyperparameters: tuning.hyperparameters } });

  return `# Operation Clearway — local notebook cell
# Feature selection and repairs are already baked into the prepared CSV files.
# This file only scales, tunes, trains, evaluates, and predicts with ${model}.

import json
import time
from pathlib import Path
from datetime import datetime

import pandas as pd
from scipy.stats import randint, loguniform
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

MODEL_NAME = ${JSON.stringify(model)}
FEATURES = ${JSON.stringify(safeFeatures, null, 2)}
N_ITER = ${settings.trials}
CV_FOLDS = ${settings.folds}
RANDOM_STATE = ${settings.randomState}
TRAIN_FILE = ${JSON.stringify(trainFile)}
TEST_FILE = ${JSON.stringify(testFile)}

def log(stage, message):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {stage:<18} | {message}', flush=True)

run_started = time.perf_counter()
log("START", "Operation Clearway model run started")
log("CONFIG", f"Model={MODEL_NAME} | trials={N_ITER} | CV folds={CV_FOLDS} | random_state={RANDOM_STATE}")
log("CONFIG", f"Locked features ({len(FEATURES)}): {FEATURES}")

base_dir = Path.cwd()
train_path = base_dir / "data" / TRAIN_FILE
if not train_path.exists():
    train_path = base_dir / TRAIN_FILE
test_path = base_dir / "data" / TEST_FILE
if not test_path.exists():
    test_path = base_dir / TEST_FILE

log("LOAD DATA", f"Reading {train_path} and {test_path}")
train_df = pd.read_csv(train_path).copy()
test_df = pd.read_csv(test_path).copy()
log("LOAD DATA", f"Train shape={train_df.shape} | Test shape={test_df.shape}")
log("LOAD DATA", f"Train columns={list(train_df.columns)}")
log("LOAD DATA", f"Test columns={list(test_df.columns)}")

log("PREPARE", "Separating identifiers/label from model inputs")
X = train_df.drop(columns=["event_id", "label"]).copy()
y = train_df["label"].astype(str)
X_test = test_df.drop(columns=["event_id"]).copy()
log("VALIDATE", "Checking prepared dataset schema and missing values")
if list(X.columns) != FEATURES or list(X_test.columns) != FEATURES:
    raise ValueError("Prepared CSV columns do not match the locked feature set.")
if X.isna().any().any() or X_test.isna().any().any():
    raise ValueError("Prepared datasets still contain missing values. Return to Data Quality Lab and repair them before training.")
log("VALIDATE", "Schema OK | no unresolved missing values found")
log("VALIDATE", f"Class distribution: {y.value_counts().to_dict()}")

log("SPLIT", "Creating stratified 80/20 train-validation split")
X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)
log("SPLIT", f"Train rows={len(X_train)} | Validation rows={len(X_valid)}")

classifier = ${config.classifier}
pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("classifier", classifier),
])
log("PIPELINE", f"Pipeline={pipeline}")
param_distributions = ${config.space}
log("TUNING SETUP", f"Parameter space={param_distributions}")
cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)
total_fits = N_ITER * CV_FOLDS
log("TRAIN/TUNE SETUP", f"RandomizedSearchCV will train {N_ITER} candidate configurations x {CV_FOLDS} folds = {total_fits} model fits")

search = RandomizedSearchCV(
    estimator=pipeline,
    param_distributions=param_distributions,
    n_iter=N_ITER,
    scoring="f1_macro",
    cv=cv,
    random_state=RANDOM_STATE,
    refit=True,
    n_jobs=-1,
    verbose=2,
)
log("TRAIN/TUNE START", f"Starting {total_fits} training fits on the training split; each CV fit will be logged below")
tuning_started = time.perf_counter()
search.fit(X_train, y_train)
log("TRAIN/TUNE DONE", f"All candidate training fits completed in {time.perf_counter() - tuning_started:.2f}s")
log("BEST CV", f"Best macro F1={search.best_score_:.4f}")
log("BEST PARAMS", json.dumps(search.best_params_, indent=2, default=str))

log("VALIDATION", "Evaluating best tuned model on the held-out validation set")
valid_pred = search.predict(X_valid)
valid_f1 = f1_score(y_valid, valid_pred, average="macro")
log("VALIDATION", f"Held-out macro F1={valid_f1:.4f}")
print("\n=== VALIDATION CLASSIFICATION REPORT ===", flush=True)
print(classification_report(y_valid, valid_pred))

log("FINAL TRAIN", f"Training the selected best pipeline on all {len(X)} prepared training rows")
final_model = search.best_estimator_
final_fit_started = time.perf_counter()
final_model.fit(X, y)
log("FINAL TRAIN", f"Final model training completed in {time.perf_counter() - final_fit_started:.2f}s")
log("PREDICT TEST", f"Generating predictions for {len(X_test)} unseen test rows")
submission = pd.DataFrame({"event_id": test_df["event_id"], "prediction": final_model.predict(X_test)})
log("PREDICT TEST", f"Prediction distribution={submission['prediction'].value_counts().to_dict()}")
log("WRITE OUTPUT", "Writing submission.csv")
submission.to_csv("submission.csv", index=False)
log("WRITE OUTPUT", f"submission.csv written successfully with {len(submission)} rows")
print("\n=== SUBMISSION PREVIEW ===", flush=True)
print(submission.head(10).to_string(index=False))
log("COMPLETE", f"Entire run finished in {time.perf_counter() - run_started:.2f}s")
`;
}
