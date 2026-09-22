// Self-contained Python embedded in the downloaded Round 4 notebook.
export const TRAINING_CODE = String.raw`
import platform
import time
from pathlib import Path
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import (RandomForestClassifier, ExtraTreesClassifier, GradientBoostingClassifier,
    HistGradientBoostingClassifier, VotingClassifier, StackingClassifier)
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import ParameterGrid, StratifiedKFold, train_test_split
from threadpoolctl import threadpool_limits

def find_data(filename):
    for directory in [Path.cwd(), Path.cwd() / 'data', Path.cwd() / 'data' / 'traffic']:
        if (directory / filename).is_file():
            return directory / filename
    hosted_input = Path('/') / ('ka' + 'ggle') / 'input'
    matches = sorted(hosted_input.rglob(filename)) if hosted_input.exists() else []
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f'Multiple copies of {filename}; put the intended pair in the working directory.')
    raise FileNotFoundError(f'Attach the participant dataset containing {filename}, or place it beside this notebook.')

train_path = Path(TRAIN_FILE)
test_path = Path(TEST_FILE)
train_df = pd.read_csv("train_16.csv").copy() if TRAIN_FILE == "train_16.csv" and train_path.is_file() else pd.read_csv(find_data(TRAIN_FILE)).copy()
test_df = pd.read_csv("test_16.csv").copy() if TEST_FILE == "test_16.csv" and test_path.is_file() else pd.read_csv(find_data(TEST_FILE)).copy()
for frame, required in [(train_df, FEATURES + ['label']), (test_df, FEATURES + ['event_id'])]:
    absent = set(required) - set(frame.columns)
    if absent:
        raise ValueError(f'Missing required columns: {sorted(absent)}')
if test_df['event_id'].isna().any() or test_df['event_id'].duplicated().any():
    raise ValueError('Test event_id values must be unique and nonempty.')
if train_df['label'].isna().any():
    raise ValueError('Training labels must be nonempty.')
X = train_df[FEATURES].copy()
y = train_df['label'].astype(str)
X_test = test_df[FEATURES].copy()
X = X.apply(pd.to_numeric, errors='coerce').replace([np.inf, -np.inf], np.nan)
X_test = X_test.apply(pd.to_numeric, errors='coerce').replace([np.inf, -np.inf], np.nan)
X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, stratify=y, random_state=RANDOM_STATE)
if y_train.value_counts().min() < CV_FOLDS:
    raise ValueError('Not enough examples per class for the selected cross-validation folds.')

class RepairedClassifier(ClassifierMixin, BaseEstimator):
    # Learn repairs on training folds only. Never drop test rows.
    def __init__(self, classifier):
        self.classifier = classifier

    def fit(self, X, y):
        frame = X.copy()
        keep = pd.Series(True, index=frame.index)
        self.fills_, self.bounds_ = {}, {}
        for name in FEATURES:
            values = frame[name]
            method = REPAIR_METHODS['missing'].get(name)
            if method == 'drop':
                keep &= values.notna()
            if method == 'mean':
                fill = values.mean()
            elif method == 'mode':
                modes = values.mode()
                fill = modes.iloc[0] if len(modes) else 0.0
            elif method in ('median', 'drop'):
                fill = values.median()
            else:
                fill = 0.0
            self.fills_[name] = float(fill) if pd.notna(fill) else 0.0
            outlier = REPAIR_METHODS['outlier'].get(name)
            if outlier:
                q1, q3 = values.quantile([0.25, 0.75])
                iqr = q3 - q1
                low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                median = values.median()
                self.bounds_[name] = (low, high, median if pd.notna(median) else 0.0)
                if outlier == 'iqr_remove':
                    keep &= values.isna() | values.between(low, high)
        retained_y = y.loc[keep]
        if set(retained_y.unique()) != set(y.unique()) or retained_y.value_counts().min() < 3:
            raise ValueError('Row-removal repairs leave too few rows in a class. Choose imputation or clipping instead.')
        self.classifier_ = clone(self.classifier)
        self.classifier_.fit(self._transform(frame.loc[keep]), retained_y)
        self.classes_ = self.classifier_.classes_
        return self

    def _transform(self, X):
        frame = X.copy()
        for name in FEATURES:
            frame[name] = frame[name].fillna(self.fills_[name])
            if name in self.bounds_:
                low, high, median = self.bounds_[name]
                method = REPAIR_METHODS['outlier'][name]
                if method == 'iqr_clip':
                    frame[name] = frame[name].clip(low, high)
                elif method == 'median_clip':
                    frame.loc[~frame[name].between(low, high), name] = median
        return frame

    def predict(self, X):
        return self.classifier_.predict(self._transform(X))

# SELECTED_CLASSIFIER
# JSON does not distinguish 1 from 1.0. These controls represent fractions;
# an integer 1 would instead select ONE sample/feature in bagging and forests.
for parameter_name in PARAMETERS:
    if parameter_name.split('__')[-1] in {'max_samples', 'max_features', 'subsample'}:
        PARAMETERS[parameter_name] = [float(value) for value in PARAMETERS[parameter_name]]
grid = list(ParameterGrid(PARAMETERS))
rng = np.random.default_rng(RANDOM_STATE)
records, aggregates, fit_estimates = [], {}, {}
best_params, best_mean = None, -1.0
cycle, trial = 0, 0
started = time.monotonic()
print(f'{MODEL_NAME}: {len(grid)} configurations, {CV_FOLDS} folds, target {TARGET_SECONDS / 60:.1f} minutes.', flush=True)
print('Runtime is a target: the current CV trial and final refit must finish. Faster CPUs evaluate more trials.', flush=True)
with threadpool_limits(limits=1):
    while True:
        # New shuffled folds each cycle provide stability evidence for singleton ranges, too.
        cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE + cycle)
        splits = list(cv.split(X_train, y_train))
        for index in rng.permutation(len(grid)):
            params = grid[int(index)]
            fold_scores, fit_seconds = [], []
            trial_start = time.monotonic()
            for train_index, valid_index in splits:
                candidate = RepairedClassifier(clone(classifier).set_params(**params))
                fit_start = time.monotonic()
                candidate.fit(X_train.iloc[train_index], y_train.iloc[train_index])
                fold_scores.append(f1_score(y_train.iloc[valid_index], candidate.predict(X_train.iloc[valid_index]), average='macro', zero_division=0))
                fit_seconds.append(time.monotonic() - fit_start)
            trial += 1
            key = json.dumps(params, sort_keys=True)
            aggregates.setdefault(key, []).extend(fold_scores)
            fit_estimates[key] = max(fit_seconds)
            # Recompute all means so a lucky first trial cannot keep a stale best score.
            winner = max(aggregates, key=lambda item: float(np.mean(aggregates[item])))
            best_params, best_mean = json.loads(winner), float(np.mean(aggregates[winner]))
            elapsed = time.monotonic() - started
            records.append({'trial': trial, 'cycle': cycle + 1, 'params': key, 'cv_mean_macro_f1': float(np.mean(fold_scores)),
                            'cv_std_macro_f1': float(np.std(fold_scores)), 'seconds': time.monotonic() - trial_start, 'elapsed_seconds': elapsed})
            print(f'Trial {trial}: CV {np.mean(fold_scores):.4f}; best mean {best_mean:.4f}; {elapsed:.0f}/{TARGET_SECONDS}s', flush=True)
            # Reserve held-out evaluation and a full-data refit; never truncate a fit.
            reserve = min(TARGET_SECONDS * 0.2, fit_estimates[winner] * 3.5)
            if elapsed >= TARGET_SECONDS - reserve:
                break
        if time.monotonic() - started >= TARGET_SECONDS - reserve:
            break
        cycle += 1
    chosen = RepairedClassifier(clone(classifier).set_params(**best_params))
    chosen.fit(X_train, y_train)
    validation_predictions = chosen.predict(X_valid)
    heldout_f1 = f1_score(y_valid, validation_predictions, average='macro', zero_division=0)
    print(classification_report(y_valid, validation_predictions, zero_division=0))
    final_model = RepairedClassifier(clone(classifier).set_params(**best_params))
    final_model.fit(X, y)
    predictions = final_model.predict(X_test)

submission = pd.DataFrame({'event_id': test_df['event_id'], 'prediction': predictions})
assert len(submission) == len(test_df) and submission.notna().all().all()
assert set(submission['prediction']).issubset(set(y))
submission.to_csv("submission.csv", index=False)
pd.DataFrame(records).to_csv('randomized_search_results.csv', index=False)
evaluation = {'model': MODEL_NAME, 'features': FEATURES, 'repairs': REPAIRS, 'repair_methods': REPAIR_METHODS,
    'parameter_ranges': PARAMETERS, 'best_parameters': best_params, 'search_credits': SEARCH_CREDITS,
    'target_seconds': TARGET_SECONDS, 'elapsed_seconds': time.monotonic() - started,
    'completed_trials': trial, 'completed_cv_fits': trial * CV_FOLDS, 'cv_folds': CV_FOLDS,
    'best_search_macro_f1': best_mean, 'holdout_macro_f1': float(heldout_f1),
    'random_state': RANDOM_STATE, 'submission_rows': len(submission),
    'python_version': platform.python_version(), 'sklearn_version': sklearn.__version__,
    'note': 'Search CV is selection-biased. Holdout is evaluated once before full-data refit. Timed trial counts depend on hardware.'}
Path('best_model_evaluation.json').write_text(json.dumps(evaluation, indent=2), encoding='utf-8')
print(f"Completed {trial} trials in {evaluation['elapsed_seconds'] / 60:.2f} minutes. submission.csv is ready for the competition.")
try:
    from IPython.display import FileLink, display
    for filename in ['submission.csv', 'randomized_search_results.csv', 'best_model_evaluation.json']:
        display(FileLink(filename))
except ImportError:
    print('Output files saved in', Path.cwd())
`;
