// Shared Python for every generated Round 5 notebook.
// The UI supplies the model-specific parameter ranges. This file keeps the
// data handling, validation, repair logic and search procedure identical.
export const TRAINING_CODE = String.raw`
import platform
import time
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    RandomForestClassifier,
    StackingClassifier,
    VotingClassifier,
)
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import ParameterGrid, StratifiedKFold, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from threadpoolctl import threadpool_limits


def find_data(filename):
    """Find exactly one copy of a competition CSV."""
    for directory in [Path.cwd(), Path.cwd() / "data", Path.cwd() / "data" / "traffic"]:
        candidate = directory / filename
        if candidate.is_file():
            return candidate

    kaggle_input = Path("/kaggle/input")
    matches = sorted(kaggle_input.rglob(filename)) if kaggle_input.exists() else []
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f"Found multiple copies of {filename}. Attach only the intended dataset.")
    raise FileNotFoundError(f"Could not find {filename}. Attach the participant dataset and run again.")


# Load only the participant train/test files. Hidden labels are never used.
train_df = pd.read_csv(find_data(TRAIN_FILE)).copy()
test_df = pd.read_csv(find_data(TEST_FILE)).copy()

required_train = set(FEATURES + ["label"])
required_test = set(FEATURES + ["event_id"])
missing_train = required_train - set(train_df.columns)
missing_test = required_test - set(test_df.columns)
if missing_train:
    raise ValueError(f"Training data is missing columns: {sorted(missing_train)}")
if missing_test:
    raise ValueError(f"Test data is missing columns: {sorted(missing_test)}")
if train_df["label"].isna().any():
    raise ValueError("Training labels must be non-empty.")
if test_df["event_id"].isna().any() or test_df["event_id"].duplicated().any():
    raise ValueError("Test event_id values must be unique and non-empty.")

X = train_df[FEATURES].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
y = train_df["label"].astype(str)
X_test = test_df[FEATURES].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)


class RepairedClassifier(ClassifierMixin, BaseEstimator):
    """Apply the team's selected repairs using training-fold statistics only."""

    def __init__(self, classifier):
        self.classifier = classifier

    def fit(self, X, y):
        frame = X.copy()
        keep = pd.Series(True, index=frame.index)
        self.fills_ = {}
        self.bounds_ = {}

        for feature in FEATURES:
            values = frame[feature]
            missing_method = REPAIR_METHODS["missing"].get(feature)

            if missing_method == "drop":
                keep &= values.notna()

            if missing_method == "mean":
                fill_value = values.mean()
            elif missing_method == "mode":
                modes = values.mode()
                fill_value = modes.iloc[0] if len(modes) else 0.0
            elif missing_method in {"median", "drop"}:
                fill_value = values.median()
            else:
                # Unselected missing-value repairs use the competition baseline.
                fill_value = 0.0

            self.fills_[feature] = float(fill_value) if pd.notna(fill_value) else 0.0

            outlier_method = REPAIR_METHODS["outlier"].get(feature)
            if outlier_method:
                q1, q3 = values.quantile([0.25, 0.75])
                iqr = q3 - q1
                low = q1 - 1.5 * iqr
                high = q3 + 1.5 * iqr
                median = values.median()
                self.bounds_[feature] = (
                    float(low),
                    float(high),
                    float(median) if pd.notna(median) else 0.0,
                )
                if outlier_method == "iqr_remove":
                    keep &= values.isna() | values.between(low, high)

        retained_y = y.loc[keep]
        if set(retained_y.unique()) != set(y.unique()) or retained_y.value_counts().min() < 3:
            raise ValueError("The selected row-removal repairs leave too few examples in a class.")

        self.classifier_ = clone(self.classifier)
        self.classifier_.fit(self._transform(frame.loc[keep]), retained_y)
        self.classes_ = self.classifier_.classes_
        return self

    def _transform(self, X):
        frame = X.copy()
        for feature in FEATURES:
            frame[feature] = frame[feature].fillna(self.fills_[feature])

            if feature not in self.bounds_:
                continue

            low, high, median = self.bounds_[feature]
            outlier_method = REPAIR_METHODS["outlier"][feature]
            if outlier_method == "iqr_clip":
                frame[feature] = frame[feature].clip(low, high)
            elif outlier_method == "median_clip":
                outside = ~frame[feature].between(low, high)
                frame.loc[outside, feature] = median

        return frame

    def predict(self, X):
        return self.classifier_.predict(self._transform(X))


# SELECTED_CLASSIFIER


# Values such as max_features=1.0 are fractions, not integer counts.
for parameter_name in PARAMETERS:
    if parameter_name.split("__")[-1] in {"max_samples", "max_features", "subsample"}:
        PARAMETERS[parameter_name] = [float(value) for value in PARAMETERS[parameter_name]]

parameter_grid = list(ParameterGrid(PARAMETERS))
if not parameter_grid:
    raise ValueError("The selected tuning range produced no valid parameter combinations.")


# Keep one untouched validation split for the final comparison. Parameter
# selection happens only inside X_train with stratified cross-validation.
X_train, X_valid, y_train, y_valid = train_test_split(
    X,
    y,
    test_size=0.20,
    stratify=y,
    random_state=RANDOM_STATE,
)
if y_train.value_counts().min() < CV_FOLDS:
    raise ValueError("Not enough examples per class for the selected number of folds.")


rng = np.random.default_rng(RANDOM_STATE)
records = []
aggregated_scores = {}
fit_estimates = {}
best_params = None
best_mean = -1.0
cycle = 0
trial = 0
started = time.monotonic()

print(
    f"{MODEL_NAME}: {len(parameter_grid)} allowed configurations, "
    f"{CV_FOLDS}-fold Macro F1, target {TARGET_SECONDS / 60:.1f} minutes."
)

with threadpool_limits(limits=1):
    while True:
        cv = StratifiedKFold(
            n_splits=CV_FOLDS,
            shuffle=True,
            random_state=RANDOM_STATE + cycle,
        )
        splits = list(cv.split(X_train, y_train))

        for grid_index in rng.permutation(len(parameter_grid)):
            params = parameter_grid[int(grid_index)]
            fold_scores = []
            fit_seconds = []
            trial_started = time.monotonic()

            for train_index, valid_index in splits:
                candidate_model = clone(classifier).set_params(**params)
                candidate = RepairedClassifier(candidate_model)

                fit_started = time.monotonic()
                candidate.fit(X_train.iloc[train_index], y_train.iloc[train_index])
                predictions = candidate.predict(X_train.iloc[valid_index])
                fit_seconds.append(time.monotonic() - fit_started)
                fold_scores.append(
                    f1_score(
                        y_train.iloc[valid_index],
                        predictions,
                        average="macro",
                        zero_division=0,
                    )
                )

            trial += 1
            params_key = json.dumps(params, sort_keys=True)
            aggregated_scores.setdefault(params_key, []).extend(fold_scores)
            fit_estimates[params_key] = max(fit_seconds)

            best_key = max(
                aggregated_scores,
                key=lambda key: float(np.mean(aggregated_scores[key])),
            )
            best_params = json.loads(best_key)
            best_mean = float(np.mean(aggregated_scores[best_key]))
            elapsed = time.monotonic() - started

            records.append({
                "trial": trial,
                "cycle": cycle + 1,
                "params": params_key,
                "cv_mean_macro_f1": float(np.mean(fold_scores)),
                "cv_std_macro_f1": float(np.std(fold_scores)),
                "seconds": time.monotonic() - trial_started,
                "elapsed_seconds": elapsed,
            })

            print(
                f"Trial {trial}: CV {np.mean(fold_scores):.4f} | "
                f"best {best_mean:.4f} | {elapsed:.0f}/{TARGET_SECONDS}s"
            )

            # Always finish the current fit, then reserve enough time for the
            # held-out evaluation and final full-data refit.
            reserve = min(TARGET_SECONDS * 0.20, fit_estimates[best_key] * 3.5)
            if elapsed >= TARGET_SECONDS - reserve:
                break

        if time.monotonic() - started >= TARGET_SECONDS - reserve:
            break
        cycle += 1


# Evaluate the selected configuration once on data that was never used by the
# parameter search, then refit exactly that configuration on all training rows.
selected_model = clone(classifier).set_params(**best_params)
validation_model = RepairedClassifier(selected_model)
validation_model.fit(X_train, y_train)
validation_predictions = validation_model.predict(X_valid)
heldout_f1 = f1_score(y_valid, validation_predictions, average="macro", zero_division=0)

print("\nSelected parameters:")
print(best_params)
print(f"Held-out Macro F1: {heldout_f1:.4f}\n")
print(classification_report(y_valid, validation_predictions, zero_division=0))

final_model = RepairedClassifier(clone(classifier).set_params(**best_params))
final_model.fit(X, y)
test_predictions = final_model.predict(X_test)

submission = pd.DataFrame({
    "event_id": test_df["event_id"],
    "prediction": test_predictions,
})
assert len(submission) == len(test_df)
assert submission.notna().all().all()
assert set(submission["prediction"]).issubset(set(y))
submission.to_csv(SUBMISSION_FILE, index=False)

pd.DataFrame(records).to_csv("randomized_search_results.csv", index=False)
evaluation = {
    "model": MODEL_NAME,
    "features": FEATURES,
    "repairs": REPAIRS,
    "repair_methods": REPAIR_METHODS,
    "parameter_ranges": PARAMETERS,
    "best_parameters": best_params,
    "search_credits": SEARCH_CREDITS,
    "target_seconds": TARGET_SECONDS,
    "elapsed_seconds": time.monotonic() - started,
    "completed_trials": trial,
    "completed_cv_fits": trial * CV_FOLDS,
    "cv_folds": CV_FOLDS,
    "best_search_macro_f1": best_mean,
    "holdout_macro_f1": float(heldout_f1),
    "random_state": RANDOM_STATE,
    "submission_file": SUBMISSION_FILE,
    "submission_rows": len(submission),
    "python_version": platform.python_version(),
    "sklearn_version": sklearn.__version__,
    "note": "Search CV selects parameters; the held-out split is evaluated once before the final full-data refit.",
}
Path("best_model_evaluation.json").write_text(json.dumps(evaluation, indent=2), encoding="utf-8")

print(f"\nSaved {SUBMISSION_FILE} with {len(submission)} predictions.")
try:
    from IPython.display import FileLink, display
    for filename in [SUBMISSION_FILE, "randomized_search_results.csv", "best_model_evaluation.json"]:
        display(FileLink(filename))
except ImportError:
    pass
`;
