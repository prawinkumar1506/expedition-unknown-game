"""Offline Round 5 benchmark.

This file is for organizer reference only. It intentionally uses test_truth.csv
to measure final hidden-test performance. Nothing in this folder is used by the
participant notebooks or the live competition app.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
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
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)
from sklearn.model_selection import ParameterGrid, StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "traffic"
OUT = Path(__file__).resolve().parent
RANDOM_STATE = 42

# One identical feature set for every model. These are the 10 telemetry channels
# with the strongest intended signal in the dataset package.
FEATURES = [
    "vehicle_count",
    "avg_vehicle_speed_kmph",
    "road_occupancy_pct",
    "pedestrian_count",
    "time_of_day_hr",
    "visibility_m",
    "rain_intensity_mmhr",
    "signal_wait_time_s",
    "road_wetness_pct",
    "incident_distance_m",
]

# Organizer benchmark uses one neutral, deterministic repair policy for every
# model so model choice, not preprocessing differences, drives the comparison.
MISSING_METHOD = "median"
OUTLIER_METHOD = "iqr_clip"


PARAMETERS = {
    "Support Vector Machine": {
        "svc__C": [0.1, 0.3],
        "svc__gamma": [0.0003, 0.001],
        "svc__tol": [0.01, 0.003],
        "svc__kernel": ["rbf", "poly"],
    },
    "Random Forest": {
        "n_estimators": [200, 400],
        "max_depth": [6, 10],
        "min_samples_leaf": [1, 2],
        "max_features": [0.4, 0.55],
    },
    "Soft Voting": {
        "forest__n_estimators": [160, 240],
        "extra__n_estimators": [200, 300],
        "boost__max_iter": [120, 180],
        "boost__learning_rate": [0.03, 0.05],
    },
    "Decision Tree": {
        "max_depth": [4, 8],
        "min_samples_split": [2, 5],
        "min_samples_leaf": [1, 2],
        "max_features": [0.4, 0.55],
    },
    "Logistic Regression": {
        "logisticregression__C": [0.03, 0.1],
        "logisticregression__solver": ["lbfgs", "liblinear"],
        "logisticregression__tol": [0.01, 0.003],
        "logisticregression__max_iter": [200, 400],
    },
    "Gradient Boosting": {
        "n_estimators": [100, 180],
        "max_depth": [1, 2],
        "learning_rate": [0.03, 0.05],
        "subsample": [0.6, 0.7],
    },
    "K-Nearest Neighbors": {
        "kneighborsclassifier__n_neighbors": [3, 5],
        "kneighborsclassifier__leaf_size": [15, 25],
        "kneighborsclassifier__p": [1, 1.25],
        "kneighborsclassifier__metric": ["euclidean", "manhattan"],
    },
    "Stacked Ensemble": {
        "forest__n_estimators": [80, 120],
        "extra__n_estimators": [100, 150],
        "boost__max_iter": [60, 90],
        "final_estimator__C": [0.01, 0.1],
    },
    "Extra Trees": {
        "n_estimators": [250, 500],
        "max_depth": [6, 10],
        "min_samples_leaf": [1, 2],
        "max_features": [0.4, 0.55],
    },
    "SGD Classifier": {
        "sgdclassifier__loss": ["hinge", "log_loss"],
        "sgdclassifier__alpha": [0.000001, 0.00001],
        "sgdclassifier__l1_ratio": [0.05, 0.15],
        "sgdclassifier__max_iter": [500, 1000],
    },
}


def make_models():
    """Clean notebook-core model definitions; no hidden class weighting."""
    return {
        "Support Vector Machine": make_pipeline(StandardScaler(), SVC(random_state=RANDOM_STATE)),
        "Random Forest": RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1),
        "Soft Voting": VotingClassifier(
            estimators=[
                ("forest", RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1)),
                ("extra", ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=-1)),
                ("boost", HistGradientBoostingClassifier(random_state=RANDOM_STATE)),
            ],
            voting="soft",
            n_jobs=-1,
        ),
        "Decision Tree": DecisionTreeClassifier(random_state=RANDOM_STATE),
        "Logistic Regression": make_pipeline(
            StandardScaler(), LogisticRegression(random_state=RANDOM_STATE)
        ),
        "Gradient Boosting": GradientBoostingClassifier(random_state=RANDOM_STATE),
        "K-Nearest Neighbors": make_pipeline(StandardScaler(), KNeighborsClassifier(n_jobs=-1)),
        "Stacked Ensemble": StackingClassifier(
            estimators=[
                ("forest", RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1)),
                ("extra", ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=-1)),
                ("boost", HistGradientBoostingClassifier(random_state=RANDOM_STATE)),
            ],
            final_estimator=LogisticRegression(max_iter=1000, random_state=RANDOM_STATE),
            n_jobs=-1,
        ),
        "Extra Trees": ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=-1),
        "SGD Classifier": make_pipeline(
            StandardScaler(), SGDClassifier(random_state=RANDOM_STATE, penalty="elasticnet")
        ),
    }


class RepairedClassifier(ClassifierMixin, BaseEstimator):
    def __init__(self, classifier):
        self.classifier = classifier

    def fit(self, X, y):
        frame = X.copy()
        self.fills_ = {}
        self.bounds_ = {}
        for feature in FEATURES:
            values = frame[feature]
            median = values.median()
            self.fills_[feature] = float(median) if pd.notna(median) else 0.0
            q1, q3 = values.quantile([0.25, 0.75])
            iqr = q3 - q1
            self.bounds_[feature] = (float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr))
        self.classifier_ = clone(self.classifier)
        self.classifier_.fit(self._transform(frame), y)
        self.classes_ = self.classifier_.classes_
        return self

    def _transform(self, X):
        frame = X.copy()
        for feature in FEATURES:
            frame[feature] = frame[feature].fillna(self.fills_[feature])
            low, high = self.bounds_[feature]
            frame[feature] = frame[feature].clip(low, high)
        return frame

    def predict(self, X):
        return self.classifier_.predict(self._transform(X))


def choose_params(model, X, y):
    """Use the current UI default/balanced ranges: first two values per slider."""
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)
    best_score = -1.0
    best_params = None
    trials = []
    for params in ParameterGrid(PARAMETERS[model]):
        scores = []
        for train_idx, valid_idx in cv.split(X, y):
            estimator = RepairedClassifier(clone(make_models()[model]).set_params(**params))
            estimator.fit(X.iloc[train_idx], y.iloc[train_idx])
            pred = estimator.predict(X.iloc[valid_idx])
            scores.append(f1_score(y.iloc[valid_idx], pred, average="macro", zero_division=0))
        mean_score = float(np.mean(scores))
        trials.append({"params": params, "macro_f1": mean_score})
        if mean_score > best_score:
            best_score = mean_score
            best_params = params
    return best_params, best_score, trials


def main():
    train = pd.read_csv(DATA / "train_16.csv")
    test = pd.read_csv(DATA / "test_16.csv")
    truth = pd.read_csv(DATA / "test_truth.csv")
    truth_map = truth.set_index("event_id")["label"]

    X = train[FEATURES].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    y = train["label"].astype(str)
    X_test = test[FEATURES].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    y_test = test["event_id"].map(truth_map).astype(str)
    if y_test.isna().any():
        raise ValueError("test_truth.csv does not cover every test event_id")

    labels = sorted(y_test.unique())
    rows = []
    details = {}

    for name, base_model in make_models().items():
        started = time.perf_counter()
        params, cv_macro_f1, trials = choose_params(name, X, y)
        model = RepairedClassifier(clone(base_model).set_params(**params))
        model.fit(X, y)
        pred = model.predict(X_test)

        macro_precision, macro_recall, macro_f1, _ = precision_recall_fscore_support(
            y_test, pred, average="macro", zero_division=0
        )
        weighted_precision, weighted_recall, weighted_f1, _ = precision_recall_fscore_support(
            y_test, pred, average="weighted", zero_division=0
        )
        per_p, per_r, per_f1, per_support = precision_recall_fscore_support(
            y_test, pred, labels=labels, zero_division=0
        )

        row = {
            "model": name,
            "macro_f1": float(macro_f1),
            "accuracy": float(accuracy_score(y_test, pred)),
            "macro_precision": float(macro_precision),
            "macro_recall": float(macro_recall),
            "weighted_f1": float(weighted_f1),
            "weighted_precision": float(weighted_precision),
            "weighted_recall": float(weighted_recall),
            "cv_macro_f1": float(cv_macro_f1),
            "runtime_seconds": float(time.perf_counter() - started),
        }
        for label, score in zip(labels, per_f1):
            row[f"f1_{label}"] = float(score)
        rows.append(row)

        details[name] = {
            "best_parameters": params,
            "cv_macro_f1": cv_macro_f1,
            "test_metrics": row,
            "per_class": {
                label: {
                    "precision": float(p),
                    "recall": float(r),
                    "f1": float(f),
                    "support": int(s),
                }
                for label, p, r, f, s in zip(labels, per_p, per_r, per_f1, per_support)
            },
            "confusion_matrix": confusion_matrix(y_test, pred, labels=labels).tolist(),
            "labels": labels,
            "search_trials": trials,
        }

    results = pd.DataFrame(rows).sort_values("macro_f1", ascending=False).reset_index(drop=True)
    results.to_csv(OUT / "benchmark_results.csv", index=False)
    (OUT / "benchmark_details.json").write_text(json.dumps(details, indent=2), encoding="utf-8")
    print(results.to_string(index=False))
    print(f"\nSaved results to: {OUT}")


if __name__ == "__main__":
    main()
