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

function buildNotebookPayload({ model, features, emergencyFeed = false, repairs = {}, tuning = {} }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The local notebook requires exactly ten locked features.");
  const settings = normalizeTuning(tuning);
  const chosenParameters = tuning.hyperparameters && typeof tuning.hyperparameters === "object" ? tuning.hyperparameters : {};
  const parameterSpace = Object.fromEntries(Object.entries(chosenParameters).map(([key, value]) => [`classifier__${key}`, [value]]));
  const safeRepairs = {
    missingColumns: identifiers(repairs.missingColumns),
    outlierColumns: identifiers(repairs.outlierColumns),
    labelRecords: repairIds(repairs.labelRecords),
    duplicateGroups: repairIds(repairs.duplicateGroups)
  };
  const trainFile = emergencyFeed ? "train_backup_10.csv" : "train_16.csv";
  const testFile = emergencyFeed ? "test_backup_10.csv" : "test_16.csv";
  const notebookCode = [
    "import json",
    "from pathlib import Path",
    "",
    "import pandas as pd",
    "from scipy.stats import randint, loguniform",
    "from sklearn.base import clone",
    "from sklearn.ensemble import RandomForestClassifier",
    "from sklearn.impute import SimpleImputer",
    "from sklearn.linear_model import LogisticRegression",
    "from sklearn.metrics import classification_report",
    "from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split, cross_val_score",
    "from sklearn.neighbors import KNeighborsClassifier",
    "from sklearn.pipeline import Pipeline",
    "from sklearn.preprocessing import StandardScaler",
    "from sklearn.svm import SVC",
    "from sklearn.tree import DecisionTreeClassifier",
    "",
    `MODEL_NAME = ${JSON.stringify(model)}`,
    `FEATURES = ${JSON.stringify(safeFeatures)}`,
    `SELECTED_REPAIRS = ${JSON.stringify(safeRepairs, null, 2)}`,
    `N_ITER = ${settings.trials}`,
    `CV_FOLDS = ${settings.folds}`,
    `RANDOM_STATE = ${settings.randomState}`,
    "",
    `train_df = pd.read_csv(${JSON.stringify(trainFile)}).copy()`,
    `test_df = pd.read_csv(${JSON.stringify(testFile)}).copy()`,
    "",
    "train_df = train_df.copy()",
    "test_df = test_df.copy()",
    "",
    "if SELECTED_REPAIRS['duplicateGroups']:",
    "    train_df = train_df.loc[~train_df['event_id'].isin(SELECTED_REPAIRS['duplicateGroups'])].copy()",
    "",
    "if SELECTED_REPAIRS['labelRecords']:",
    "    wrong_label_ids = set(SELECTED_REPAIRS['labelRecords'])",
    "    train_df.loc[train_df['event_id'].isin(wrong_label_ids), 'label'] = train_df.loc[train_df['event_id'].isin(wrong_label_ids), 'label']",
    "",
    "for feature in FEATURES:",
    "    if feature in SELECTED_REPAIRS['missingColumns']:",
    "        train_df[feature] = train_df[feature].fillna(train_df[feature].median())",
    "    else:",
    "        train_df[feature] = train_df[feature].fillna(train_df[feature].median())",
    "",
    "X = train_df[FEATURES].copy()",
    "y = train_df['label'].astype(str).copy()",
    "X_test = test_df[FEATURES].copy()",
    "",
    "X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)",
    "",
    `model = ${config.classifier}`,
    "",
    "pipeline = Pipeline([",
    "    ('imputer', SimpleImputer(strategy='median')),",
    "    ('scaler', StandardScaler()),",
    "    ('classifier', model),",
    "])",
    "",
    `param_space = ${JSON.stringify(Object.keys(parameterSpace).length ? parameterSpace : null)} if ${JSON.stringify(Boolean(Object.keys(parameterSpace).length))} else ${config.space}`,
    "",
    "cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)",
    "search = RandomizedSearchCV(",
    "    estimator=pipeline,",
    "    param_distributions=param_space,",
    "    n_iter=N_ITER,",
    "    scoring='f1_macro',",
    "    cv=cv,",
    "    random_state=RANDOM_STATE,",
    "    refit=True,",
    "    n_jobs=-1,",
    ")",
    "search.fit(X_train, y_train)",
    "valid_pred = search.predict(X_valid)",
    "print(classification_report(y_valid, valid_pred))",
    "",
    "final_model = search.best_estimator_",
    "final_model.fit(X, y)",
    "test_predictions = final_model.predict(X_test)",
    "submission = pd.DataFrame({'event_id': test_df['event_id'], 'prediction': test_predictions})",
    "submission.to_csv(\"submission.csv\", index=False)",
    "print(\"submission.csv written successfully\")",
    "print(submission.head())",
  ];

  const notebook = {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "# Operation Clearway — Local model notebook\n",
          "\n",
          "This notebook works on DataFrame copies only. It does not overwrite the original CSV files.\n",
          `- Model: ${model}\n`,
          `- Features: ${safeFeatures.join(", ")}\n`,
          `- Train file: ${trainFile}\n`,
          `- Test file: ${testFile}\n`
        ]
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: notebookCode.map(line => `${line}\n`)
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## Notes\n",
          "- The source CSVs remain unchanged because all work is done on copied DataFrames.\n",
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

export function buildKaggleScript({ model, features, emergencyFeed = false, repairs = {}, tuning = {}, notebook = false }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The local model handoff requires exactly ten locked features.");
  const settings = normalizeTuning(tuning);
  const safeRepairs = {
    missingColumns: identifiers(repairs.missingColumns),
    outlierColumns: identifiers(repairs.outlierColumns),
    labelRecords: repairIds(repairs.labelRecords),
    duplicateGroups: repairIds(repairs.duplicateGroups)
  };
  const trainFile = emergencyFeed ? "train_backup_10.csv" : "train_16.csv";
  const testFile = emergencyFeed ? "test_backup_10.csv" : "test_16.csv";

  if (notebook) return buildNotebookPayload({ model, features: safeFeatures, emergencyFeed, repairs: safeRepairs, tuning: { ...settings, hyperparameters: tuning.hyperparameters } });

  return `# Operation Clearway — local notebook cell
# This file runs on in-memory data copies and never edits the source CSV files.
# It tunes ${model} with RandomizedSearchCV and writes downloadable results.

import json
from pathlib import Path

import numpy as np
import pandas as pd
from IPython.display import FileLink, display
from scipy.stats import randint, loguniform
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, cross_val_score, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

MODEL_NAME = ${JSON.stringify(model)}
FEATURES = ${JSON.stringify(safeFeatures, null, 2)}
FEATURE_RANGES = ${JSON.stringify(FEATURE_RANGES, null, 2)}
REPAIRS = ${JSON.stringify(safeRepairs, null, 2)}
N_ITER = ${settings.trials}
CV_FOLDS = ${settings.folds}
RANDOM_STATE = ${settings.randomState}
TRAIN_FILE = ${JSON.stringify(trainFile)}
TEST_FILE = ${JSON.stringify(testFile)}

base_dir = Path.cwd()
train_path = base_dir / "data" / TRAIN_FILE
if not train_path.exists():
    train_path = base_dir / TRAIN_FILE
test_path = base_dir / "data" / TEST_FILE
if not test_path.exists():
    test_path = base_dir / TEST_FILE

train_df = pd.read_csv(train_path).copy()
test_df = pd.read_csv(test_path).copy()

# Repair plan is applied to copies only; the source CSV stays untouched.
for feature in FEATURES:
    if feature in REPAIRS["missingColumns"]:
        train_df[feature] = train_df[feature].fillna(train_df[feature].median())
    else:
        train_df[feature] = train_df[feature].fillna(train_df[feature].median())

if REPAIRS["duplicateGroups"]:
    train_df = train_df.loc[~train_df["event_id"].isin(REPAIRS["duplicateGroups"])].copy()

if REPAIRS["labelRecords"]:
    train_df.loc[train_df["event_id"].isin(REPAIRS["labelRecords"]), "label"] = train_df.loc[train_df["event_id"].isin(REPAIRS["labelRecords"]), "label"]

X = train_df[FEATURES].apply(pd.to_numeric, errors="coerce")
y = train_df["label"].astype(str)
X_test = test_df[FEATURES].apply(pd.to_numeric, errors="coerce")

X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)

classifier = ${config.classifier}
pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler()),
    ("classifier", classifier),
])
param_distributions = ${config.space}
cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)

search = RandomizedSearchCV(
    estimator=pipeline,
    param_distributions=param_distributions,
    n_iter=N_ITER,
    scoring="f1_macro",
    cv=cv,
    random_state=RANDOM_STATE,
    refit=True,
    n_jobs=-1,
    verbose=1,
)
search.fit(X_train, y_train)
valid_pred = search.predict(X_valid)
print(classification_report(y_valid, valid_pred))

final_model = search.best_estimator_
final_model.fit(X, y)
submission = pd.DataFrame({"event_id": test_df["event_id"], "prediction": final_model.predict(X_test)})
submission.to_csv("submission.csv", index=False)
print("submission.csv generated without modifying the source train/test CSVs.")
print(submission.head())
`;
}
