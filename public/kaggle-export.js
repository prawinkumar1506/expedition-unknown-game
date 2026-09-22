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

const safeDerivedDefinitions = values => (Array.isArray(values) ? values : []).filter(item =>
  item && identifiers([item.id, item.left, item.right]).length === 3 && item.operation === "product"
).map(item => ({ id: item.id, operation: "product", left: item.left, right: item.right }));

const safeRepairConfig = (repairs = {}, methods = {}, features = []) => {
  const allowed = new Set(features);
  const missingColumns = repairIds(repairs.missingColumns).filter(id => allowed.has(id));
  const outlierColumns = repairIds(repairs.outlierColumns).filter(id => allowed.has(id));
  const missing = Object.fromEntries(missingColumns.map(id => [id, ["median", "mean", "mode"].includes(methods?.missing?.[id]) ? methods.missing[id] : "median"]));
  const outlier = Object.fromEntries(outlierColumns.map(id => [id, ["iqr_clip", "median_replace"].includes(methods?.outlier?.[id]) ? methods.outlier[id] : "iqr_clip"]));
  return { repairs: { missingColumns, outlierColumns }, methods: { missing, outlier } };
};

function buildPythonProgram({ model, features, trainFile, testFile, derivedFeatures = [], repairs = {}, repairMethods = {}, tuning = {} }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The local model handoff requires exactly ten locked features.");
  const safeDerived = safeDerivedDefinitions(derivedFeatures).filter(item => safeFeatures.includes(item.id));
  const safeRepairs = safeRepairConfig(repairs, repairMethods, safeFeatures);
  const settings = normalizeTuning(tuning);
  const chosenParameters = tuning.hyperparameters && typeof tuning.hyperparameters === "object" ? tuning.hyperparameters : {};
  const parameterSpace = Object.fromEntries(Object.entries(chosenParameters).map(([key, value]) => [`classifier__${key}`, Array.isArray(value) ? value : [value]]));

  return [
    "import json",
    "import time",
    "from pathlib import Path",
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
    `TRAIN_FILE = ${JSON.stringify(trainFile)}`,
    `TEST_FILE = ${JSON.stringify(testFile)}`,
    `DERIVED_FEATURES = json.loads(${JSON.stringify(JSON.stringify(safeDerived))})`,
    `SELECTED_REPAIRS = json.loads(${JSON.stringify(JSON.stringify(safeRepairs.repairs))})`,
    `REPAIR_METHODS = json.loads(${JSON.stringify(JSON.stringify(safeRepairs.methods))})`,
    `N_ITER = ${settings.trials}`,
    `CV_FOLDS = ${settings.folds}`,
    `RANDOM_STATE = ${settings.randomState}`,
    "",
    "def log(stage, message):",
    "    print(f'[{datetime.now().strftime(\"%H:%M:%S\")}] {stage:<18} | {message}', flush=True)",
    "",
    "def resolve_source_file(filename):",
    "    candidates = [Path.cwd() / filename, Path.cwd() / 'data' / filename, Path.cwd() / 'data' / 'traffic' / filename]",
    "    for candidate in candidates:",
    "        if candidate.exists():",
    "            return candidate",
    "    kaggle_root = Path('/kaggle/input')",
    "    if kaggle_root.exists():",
    "        matches = list(kaggle_root.rglob(filename))",
    "        if matches:",
    "            return matches[0]",
    "    raise FileNotFoundError(f'Could not find {filename}. Keep the source CSV beside the notebook, under data/, under data/traffic/, or attach it as a Kaggle input dataset.')",
    "",
    "def materialize_derived(frame):",
    "    frame = frame.copy()",
    "    for definition in DERIVED_FEATURES:",
    "        if definition.get('operation') != 'product':",
    "            raise ValueError(f\"Unsupported derived operation: {definition.get('operation')}\")",
    "        left = definition['left']",
    "        right = definition['right']",
    "        if left not in frame.columns or right not in frame.columns:",
    "            raise ValueError(f'Derived feature requires missing source columns: {left}, {right}')",
    "        frame[definition['id']] = pd.to_numeric(frame[left], errors='coerce') * pd.to_numeric(frame[right], errors='coerce')",
    "    return frame",
    "",
    "def replacement_value(series, method):",
    "    numeric = pd.to_numeric(series, errors='coerce')",
    "    if method == 'mean':",
    "        return numeric.mean()",
    "    if method == 'mode':",
    "        values = numeric.dropna().mode()",
    "        return values.iloc[0] if len(values) else float('nan')",
    "    return numeric.median()",
    "",
    "def apply_missing_repairs(train_frame, test_frame):",
    "    for feature in SELECTED_REPAIRS['missingColumns']:",
    "        method = REPAIR_METHODS['missing'].get(feature, 'median')",
    "        replacement = replacement_value(train_frame[feature], method)",
    "        if pd.isna(replacement):",
    "            raise ValueError(f'Cannot compute {method} replacement for {feature}')",
    "        train_frame[feature] = pd.to_numeric(train_frame[feature], errors='coerce').fillna(replacement)",
    "        test_frame[feature] = pd.to_numeric(test_frame[feature], errors='coerce').fillna(replacement)",
    "        log('REPAIR MISSING', f'{feature}: {method} -> {replacement:.6g}')",
    "",
    "def apply_outlier_repairs(train_frame, test_frame):",
    "    for feature in SELECTED_REPAIRS['outlierColumns']:",
    "        method = REPAIR_METHODS['outlier'].get(feature, 'iqr_clip')",
    "        source = pd.to_numeric(train_frame[feature], errors='coerce')",
    "        q1 = source.quantile(0.25)",
    "        q3 = source.quantile(0.75)",
    "        middle = source.median()",
    "        if pd.isna(q1) or pd.isna(q3) or pd.isna(middle):",
    "            raise ValueError(f'Cannot compute outlier thresholds for {feature}')",
    "        iqr = q3 - q1",
    "        low = q1 - 1.5 * iqr",
    "        high = q3 + 1.5 * iqr",
    "        def repair_series(series):",
    "            numeric = pd.to_numeric(series, errors='coerce')",
    "            if method == 'median_replace':",
    "                mask = (numeric < low) | (numeric > high)",
    "                numeric = numeric.copy()",
    "                numeric.loc[mask] = middle",
    "                return numeric",
    "            return numeric.clip(lower=low, upper=high)",
    "        train_frame[feature] = repair_series(train_frame[feature])",
    "        test_frame[feature] = repair_series(test_frame[feature])",
    "        log('REPAIR OUTLIER', f'{feature}: {method} | bounds=({low:.6g}, {high:.6g})')",
    "",
    "run_started = time.perf_counter()",
    "log('START', 'Operation Clearway model run started')",
    "log('CONFIG', f'Model={MODEL_NAME} | trials={N_ITER} | CV folds={CV_FOLDS} | random_state={RANDOM_STATE}')",
    "log('CONFIG', f'Locked features ({len(FEATURES)}): {FEATURES}')",
    "log('CONFIG', f'Missing repairs={SELECTED_REPAIRS[\"missingColumns\"]} | outlier repairs={SELECTED_REPAIRS[\"outlierColumns\"]}')",
    "",
    "train_path = resolve_source_file(TRAIN_FILE)",
    "test_path = resolve_source_file(TEST_FILE)",
    "log('LOAD DATA', f'Reading unchanged source files: {train_path} and {test_path}')",
    "train_source = pd.read_csv(train_path).copy()",
    "test_source = pd.read_csv(test_path).copy()",
    "log('LOAD DATA', f'Source train shape={train_source.shape} | Source test shape={test_source.shape}')",
    "",
    "log('DERIVED FEATURES', f'Materializing {len(DERIVED_FEATURES)} evaluated derived feature(s)')",
    "train_source = materialize_derived(train_source)",
    "test_source = materialize_derived(test_source)",
    "required_train = ['event_id', *FEATURES, 'label']",
    "required_test = ['event_id', *FEATURES]",
    "missing_train_columns = [name for name in required_train if name not in train_source.columns]",
    "missing_test_columns = [name for name in required_test if name not in test_source.columns]",
    "if missing_train_columns or missing_test_columns:",
    "    raise ValueError(f'Source dataset is missing required columns. train={missing_train_columns}, test={missing_test_columns}')",
    "train_df = train_source[required_train].copy()",
    "test_df = test_source[required_test].copy()",
    "log('FEATURE LOCK', 'Projected source data to the 10 locked features')",
    "",
    "apply_missing_repairs(train_df, test_df)",
    "apply_outlier_repairs(train_df, test_df)",
    "",
    "X = train_df[FEATURES].copy()",
    "y = train_df['label'].astype(str).copy()",
    "X_test = test_df[FEATURES].copy()",
    "log('VALIDATE', 'Checking notebook-applied feature selection and repairs')",
    "if X.isna().any().any() or X_test.isna().any().any():",
    "    train_missing = X.isna().sum()[lambda s: s > 0].to_dict()",
    "    test_missing = X_test.isna().sum()[lambda s: s > 0].to_dict()",
    "    raise ValueError(f'Unresolved missing values remain. train={train_missing}, test={test_missing}. Select the required repairs in Data Quality Lab and generate a new notebook.')",
    "log('VALIDATE', 'Schema OK | no unresolved missing values found')",
    "log('VALIDATE', f'Class distribution: {y.value_counts().to_dict()}')",
    "",
    "log('SPLIT', 'Creating stratified 80/20 train-validation split')",
    "X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)",
    "log('SPLIT', f'Train rows={len(X_train)} | Validation rows={len(X_valid)}')",
    "",
    "log('PIPELINE', f'Creating {MODEL_NAME} with StandardScaler')",
    `model = ${config.classifier}`,
    "pipeline = Pipeline([",
    "    ('scaler', StandardScaler()),",
    "    ('classifier', model),",
    "])",
    "log('PIPELINE', f'Pipeline={pipeline}')",
    `param_space = json.loads(${JSON.stringify(JSON.stringify(parameterSpace))}) if ${Object.keys(parameterSpace).length ? "True" : "False"} else ${config.space}`,
    "log('TUNING SETUP', f'Parameter space={param_space}')",
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
    "log('FINAL TRAIN', f'Training the selected best pipeline on all {len(X)} repaired training rows')",
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
    "submission.to_csv('submission.csv', index=False)",
    "log('WRITE OUTPUT', f'submission.csv written successfully with {len(submission)} rows')",
    "print('\\n=== SUBMISSION PREVIEW ===', flush=True)",
    "print(submission.head(10).to_string(index=False))",
    "log('COMPLETE', f'Entire run finished in {time.perf_counter() - run_started:.2f}s')"
  ];
}

function buildNotebookPayload(options) {
  const safeFeatures = identifiers(options.features);
  const code = buildPythonProgram(options);
  const notebook = {
    cells: [
      {
        cell_type: "markdown",
        metadata: { id: "clearway-overview", language: "markdown" },
        source: [
          "# Operation Clearway — Local model notebook\n",
          "\n",
          "The CSV files are the unchanged source of truth. This notebook contains the current game decisions: locked features, evaluated derived features, missing-value repairs, outlier repairs, tuning settings, and model choice.\n",
          `- Model: ${options.model}\n`,
          `- Features: ${safeFeatures.join(", ")}\n`,
          `- Source train: ${options.trainFile}\n`,
          `- Source test: ${options.testFile}\n`,
          "- If you change a repair or model setting in the website, download a new notebook only. Do not replace the source CSVs.\n"
        ]
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: { id: "clearway-training", language: "python" },
        outputs: [],
        source: code.map(line => `${line}\n`)
      },
      {
        cell_type: "markdown",
        metadata: { id: "clearway-notes", language: "markdown" },
        source: [
          "## Notes\n",
          "- Keep the source CSV files unchanged so every run starts from the same data.\n",
          "- The notebook applies your current feature and repair decisions in memory before training.\n",
          "- The generated prediction file is saved as `submission.csv`.\n"
        ]
      }
    ],
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "Python", version: "3.x" }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
  return JSON.stringify(notebook, null, 2);
}

export function buildKaggleScript({
  model,
  features,
  trainFile = "train_16.csv",
  testFile = "test_16.csv",
  derivedFeatures = [],
  repairs = {},
  repairMethods = {},
  tuning = {},
  notebook = false
}) {
  const options = { model, features, trainFile, testFile, derivedFeatures, repairs, repairMethods, tuning };
  const program = buildPythonProgram(options);
  return notebook ? buildNotebookPayload(options) : program.join("\n") + "\n";
}
