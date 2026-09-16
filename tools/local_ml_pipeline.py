import base64
import csv
import hashlib
import hmac
import io
import json
import math
import os
import sqlite3
from functools import lru_cache
from pathlib import Path

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier


# Deliberately local-only: this evaluator exercises the real scikit-learn
# pipeline during development. Production exports a Kaggle training cell.
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "traffic"
DB_PATH = Path(os.getenv("CLEARWAY_DB_PATH", ROOT / "data" / "clearway.sqlite"))
TRAFFIC_CLASSES = ["Free_Flow", "Heavy_Traffic", "Pedestrian_Event", "Incident", "Low_Activity"]
FEATURE_RANGES = {
    "vehicle_count": (0, 90), "avg_vehicle_speed_kmph": (0, 90), "road_occupancy_pct": (0, 100), "pedestrian_count": (0, 70),
    "time_of_day_hr": (0, 24), "visibility_m": (25, 3000), "rain_intensity_mmhr": (0, 45), "signal_wait_time_s": (0, 200),
    "road_wetness_pct": (0, 100), "incident_distance_m": (1, 500), "noise_level_db": (35, 100), "ambient_temperature_c": (2, 45),
    "humidity_pct": (15, 100), "camera_exposure_score": (0, 100), "camera_focus_score": (0, 100), "lane_marking_visibility_pct": (0, 100),
}
APPROVED_MODELS = {
    "Decision Tree": lambda: DecisionTreeClassifier(max_depth=8, min_samples_leaf=4, class_weight="balanced", random_state=42),
    "Logistic Regression": lambda: LogisticRegression(max_iter=1200, class_weight="balanced", random_state=42),
    "K-Nearest Neighbors": lambda: KNeighborsClassifier(n_neighbors=9, weights="distance"),
    "Random Forest": lambda: RandomForestClassifier(n_estimators=180, max_depth=12, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=1, random_state=42),
    "Support Vector Machine": lambda: SVC(C=2.0, gamma="scale", class_weight="balanced", random_state=42),
}
EMERGENCY_MAX_STRONG_CHANNELS = 4
EMERGENCY_QUALITY_SCORE = 35
EMERGENCY_FINAL_MODEL_CAP = 70


def _decode_segment(segment):
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def verify_state(token, kind, room, player):
    try:
        payload, signature = str(token or "").split(".", 1)
        secret = os.getenv("CLEARWAY_STATE_SECRET") or os.getenv("MATCH_GATEWAY_SECRET") or "clearway-local-state"
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        received = _decode_segment(signature)
        if not hmac.compare_digest(expected, received):
            raise ValueError
        state = json.loads(_decode_segment(payload))
        if state.get("kind") != kind or state.get("room") != room or state.get("player") != player:
            raise ValueError
        return state
    except Exception as error:
        raise ValueError("INVALID_STATE") from error


def _read_csv(name, numeric=False):
    with (DATA_DIR / name).open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if numeric:
        for row in rows:
            for feature in FEATURE_RANGES:
                if feature in row:
                    row[feature] = float(row[feature]) if row[feature] != "" else math.nan
    return rows


@lru_cache(maxsize=1)
def load_data():
    with (DATA_DIR / "backup_feature_list.json").open("r", encoding="utf-8") as stream:
        backup_features = json.load(stream)["backup_features"]
    return {
        "train": _read_csv("train_16.csv", numeric=True),
        "test": _read_csv("test_16.csv", numeric=True),
        "train_backup": _read_csv("train_backup_10.csv", numeric=True),
        "test_backup": _read_csv("test_backup_10.csv", numeric=True),
        "truth": {row["event_id"]: row["label"] for row in _read_csv("test_truth.csv")},
        "log": _read_csv("corruption_log.csv"),
        "backup_features": backup_features,
    }


def apply_quality(state):
    data = load_data()
    if state.get("emergencyFeed"):
        features = data["backup_features"]
        rows = [dict(row) for row in data["train_backup"]]
        return features, rows, data["test_backup"], data["truth"]

    features = list(state["features"])
    repairs = state["repairs"]
    removed = set(repairs["duplicateGroups"])
    label_repairs = set(repairs["labelRecords"])
    missing_repairs = set(repairs["missingColumns"])
    outlier_repairs = set(repairs["outlierColumns"])
    label_truth = {item["event_id"]: item["original_value"] for item in data["log"] if item["problem"] == "wrong_label"}
    rows = [dict(row) for row in data["train"] if row["event_id"] not in removed]
    for row in rows:
        if row["event_id"] in label_repairs and row["event_id"] in label_truth:
            row["label"] = label_truth[row["event_id"]]
    medians = {}
    for feature in features:
        low, high = FEATURE_RANGES[feature]
        valid = [float(row[feature]) for row in rows if math.isfinite(float(row[feature])) and low <= float(row[feature]) <= high]
        medians[feature] = float(np.median(valid))
    for row in rows:
        for feature in features:
            low, high = FEATURE_RANGES[feature]
            value = float(row[feature])
            if not math.isfinite(value):
                row[feature] = medians[feature] if feature in missing_repairs else low - (high - low) * 0.25
            elif feature in outlier_repairs:
                row[feature] = min(high, max(low, value))
    return features, rows, data["test"], data["truth"]


def build_pipeline(model_name):
    if model_name not in APPROVED_MODELS:
        raise ValueError("Choose one approved model.")
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("classifier", APPROVED_MODELS[model_name]()),
    ])


def _matrix(rows, features):
    return np.asarray([[float(row[feature]) for feature in features] for row in rows], dtype=float)


def evaluate_pipeline(model_name, features, rows):
    X = _matrix(rows, features)
    y = np.asarray([row["label"] for row in rows])
    splitter = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    out_of_fold = np.empty(y.shape, dtype=object)
    fold_scores = []
    for train_index, validation_index in splitter.split(X, y):
        pipeline = clone(build_pipeline(model_name))
        pipeline.fit(X[train_index], y[train_index])
        predicted = pipeline.predict(X[validation_index])
        out_of_fold[validation_index] = predicted
        fold_scores.append(float(f1_score(y[validation_index], predicted, labels=TRAFFIC_CLASSES, average="macro", zero_division=0)))
    precision, recall, f1, _ = precision_recall_fscore_support(y, out_of_fold, labels=TRAFFIC_CLASSES, zero_division=0)
    per_class = [{"label": label, "precision": round(float(precision[i]), 3), "recall": round(float(recall[i]), 3), "f1": round(float(f1[i]), 3)} for i, label in enumerate(TRAFFIC_CLASSES)]
    score = float(np.mean(fold_scores))
    return {
        "score": score,
        "stability": float(np.std(fold_scores)),
        "foldScores": fold_scores,
        "perClass": per_class,
        "weakestClass": min(per_class, key=lambda item: item["f1"])["label"],
        "confusion": confusion_matrix(y, out_of_fold, labels=TRAFFIC_CLASSES).tolist(),
    }


def final_prediction(model_name, features, rows, test_rows, truth):
    pipeline = build_pipeline(model_name)
    pipeline.fit(_matrix(rows, features), np.asarray([row["label"] for row in rows]))
    predictions = pipeline.predict(_matrix(test_rows, features)).tolist()
    actual = [truth[row["event_id"]] for row in test_rows]
    return predictions, float(f1_score(actual, predictions, labels=TRAFFIC_CLASSES, average="macro", zero_division=0)), pipeline


def _consume_evaluation(room, player):
    if not DB_PATH.exists():
        return None
    with sqlite3.connect(DB_PATH) as connection:
        row = connection.execute("SELECT status FROM game_rooms WHERE pin = ? AND expires_at > ?", (room, int(__import__("time").time() * 1000))).fetchone()
        if not row or row[0] != "started":
            return None
        connection.execute("INSERT OR IGNORE INTO game_evaluations (room_pin, player_name, used) VALUES (?, ?, 0)", (room, player))
        connection.execute("UPDATE game_evaluations SET used = used + 1 WHERE room_pin = ? AND player_name = ? AND used < 8", (room, player))
        used = connection.execute("SELECT used FROM game_evaluations WHERE room_pin = ? AND player_name = ?", (room, player)).fetchone()[0]
        if used > 8:
            raise RuntimeError("Evaluation limit reached")
        return used


def _outcome(score, emergency_feed=False):
    if emergency_feed:
        return {"tier": "silver", "code": "FALLBACK ROUTE STABILIZED", "title": "The backup feed kept CLEARWAY operational.", "body": "The recovery route prevented a total loss, but its score ceiling keeps it out of contention for the top result."}
    if score >= 0.78:
        return {"tier": "gold", "code": "CLEARWAY RESTORED", "title": "The grid is classifying live traffic again.", "body": "The repaired archive and final channel set hold on the sealed feed. CLEARWAY returns to service before the next control cycle."}
    if score >= 0.66:
        return {"tier": "silver", "code": "CONTROL DEGRADED", "title": "The live feed is usable, but not yet stable.", "body": "The model restores partial coverage. Operators keep manual oversight on the weakest traffic class while the next calibration window opens."}
    return {"tier": "red", "code": "RESTORE FAILED", "title": "The next packet breaks the model.", "body": "The hidden feed exposes an unstable pipeline. CLEARWAY stays in Manual Override while the archive and channel choices are audited again."}


def run_request(body):
    room = str(body.get("room", ""))[:16]
    player = str(body.get("player", ""))[:20]
    action = str(body.get("action", ""))[:12]
    model_name = str(body.get("model", ""))
    if not room or not player or model_name not in APPROVED_MODELS:
        return 400, {"error": "Choose one approved model."}
    if action not in {"evaluate", "submit"}:
        return 400, {"error": "Choose evaluate or submit."}
    try:
        manual = verify_state(body.get("manualState"), "manual", room, player)
        feature = verify_state(body.get("featureState"), "features", room, player)
        quality = verify_state(body.get("qualityState"), "quality", room, player)
        if quality.get("emergencyFeed"):
            if (feature.get("strongCount", 99) > EMERGENCY_MAX_STRONG_CHANNELS or
                    quality.get("features") != load_data()["backup_features"] or
                    quality.get("featureScore") != 0 or
                    quality.get("qualityScore") != EMERGENCY_QUALITY_SCORE):
                raise ValueError("INVALID_STATE")
        elif quality.get("featureScore") != feature.get("score") or quality.get("features") != feature.get("selected"):
            raise ValueError("INVALID_STATE")
        features, rows, test_rows, truth = apply_quality(quality)
        reserved = _consume_evaluation(room, player)
        local_used = max(1, min(8, int(body.get("evaluationsUsed", 1) or 1)))
        used = reserved if reserved is not None else local_used
        validation = evaluate_pipeline(model_name, features, rows)
        common = {
            "model": model_name,
            "backend": "scikit-learn",
            "pipelineSteps": ["SimpleImputer", "StandardScaler", type(APPROVED_MODELS[model_name]()).__name__],
            "metric": "Macro F1",
            "validationProtocol": "StratifiedKFold(n_splits=5, shuffle=True, random_state=42)",
            "validationReproducible": True,
            "trainingRecords": len(rows),
            "usedEvaluations": used,
            "evaluationLimit": 8,
        }
        if action == "evaluate":
            return 200, {**common, "score": round(validation["score"], 3), "stability": round(validation["stability"], 3), "folds": 5, "foldScores": [round(value, 3) for value in validation["foldScores"]], "weakestClass": validation["weakestClass"], "perClass": validation["perClass"], "confusion": {"labels": TRAFFIC_CLASSES, "matrix": validation["confusion"]}}
        predictions, hidden_score, _ = final_prediction(model_name, features, rows, test_rows, truth)
        efficiency = round(max(0, (8 - used) / 7) * 100, 1)
        model_score = round(hidden_score * 100, 1)
        if quality.get("emergencyFeed"):
            model_score = min(model_score, EMERGENCY_FINAL_MODEL_CAP)
        components = {"manual": manual["score"], "features": quality["featureScore"], "quality": quality["qualityScore"], "evaluationEfficiency": efficiency, "finalModel": model_score}
        overall = round(components["manual"] * 0.2 + components["features"] * 0.2 + components["quality"] * 0.2 + components["evaluationEfficiency"] * 0.1 + components["finalModel"] * 0.3, 1)
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["event_id", "prediction"])
        writer.writerows((row["event_id"], predictions[index]) for index, row in enumerate(test_rows))
        return 200, {**common, "validationScore": round(validation["score"], 3), "validationStability": round(validation["stability"], 3), "finalScore": round(hidden_score, 3), "overallScore": overall, "components": components, "emergencyFeed": bool(quality.get("emergencyFeed")), "outcome": _outcome(hidden_score, quality.get("emergencyFeed")), "csv": output.getvalue()}
    except (ValueError, KeyError, TypeError) as error:
        message = "One or more sealed event states could not be verified. Reload the mission." if str(error) == "INVALID_STATE" else str(error)
        return 409, {"error": message}
    except RuntimeError as error:
        message = "You have used all 8 shared evaluations/submissions." if "EVALUATION_LIMIT" in str(error) else "Game is not active." if "GAME_NOT_ACTIVE" in str(error) else str(error)
        return 409, {"error": message}
