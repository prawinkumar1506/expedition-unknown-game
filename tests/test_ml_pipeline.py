import base64
import hashlib
import hmac
import json
import os
import unittest

from tools.local_ml_pipeline import APPROVED_MODELS, build_pipeline, load_data, run_request


def pack_state(kind, **state):
    payload = json.dumps({"kind": kind, **state}, separators=(",", ":")).encode()
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    signature = hmac.new(b"clearway-local-state", encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.room = "731904"
        self.player = "python-test"
        self.features = list(load_data()["train"][0].keys())[1:11]
        self.manual = pack_state("manual", room=self.room, player=self.player, score=100, correct=50, wrong=0, blank=0, points=50)
        self.feature = pack_state("features", room=self.room, player=self.player, selected=self.features, score=100, strongCount=10, spent=10)
        self.quality = pack_state("quality", room=self.room, player=self.player, features=self.features, featureScore=100, qualityScore=75, emergencyFeed=False, repairs={"missingColumns": [], "outlierColumns": [], "labelRecords": [], "duplicateGroups": []}, repairSpend=0)

    def body(self, action="evaluate", model="Decision Tree"):
        return {"room": self.room, "player": self.player, "action": action, "model": model, "manualState": self.manual, "featureState": self.feature, "qualityState": self.quality, "evaluationsUsed": 1}

    def test_every_approved_model_is_a_real_sklearn_pipeline(self):
        for name in APPROVED_MODELS:
            pipeline = build_pipeline(name)
            self.assertEqual(list(pipeline.named_steps), ["imputer", "scaler", "classifier"])
            self.assertEqual(pipeline.named_steps["classifier"].__class__, APPROVED_MODELS[name]().__class__)

    def test_evaluate_returns_reproducible_five_fold_diagnostics(self):
        status, result = run_request(self.body())
        self.assertEqual(status, 200)
        self.assertEqual(result["backend"], "scikit-learn")
        self.assertEqual(result["folds"], 5)
        self.assertEqual(len(result["foldScores"]), 5)
        self.assertEqual(len(result["perClass"]), 5)
        self.assertTrue(result["validationReproducible"])

    def test_submit_emits_exactly_500_hidden_predictions(self):
        status, result = run_request(self.body(action="submit", model="Random Forest"))
        self.assertEqual(status, 200)
        self.assertEqual(result["csv"].splitlines()[0], "event_id,prediction")
        self.assertEqual(len(result["csv"].splitlines()), 501)
        self.assertGreaterEqual(result["finalScore"], 0)
        self.assertLessEqual(result["finalScore"], 1)

    def test_emergency_feed_is_only_a_bounded_recovery_route(self):
        data = load_data()
        poor_features = list(data["train"][0].keys())[1:5] + list(data["train"][0].keys())[-6:]
        poor_feature_state = pack_state("features", room=self.room, player=self.player, selected=poor_features, score=34, strongCount=4, spent=0)
        emergency_quality = pack_state("quality", room=self.room, player=self.player, features=data["backup_features"], featureScore=0, qualityScore=35, emergencyFeed=True, repairs={"missingColumns": [], "outlierColumns": [], "labelRecords": [], "duplicateGroups": []}, repairSpend=0)
        body = self.body(action="submit", model="Random Forest")
        body.update(featureState=poor_feature_state, qualityState=emergency_quality)
        status, result = run_request(body)
        self.assertEqual(status, 200)
        self.assertTrue(result["emergencyFeed"])
        self.assertLessEqual(result["components"]["finalModel"], 70)
        self.assertLessEqual(result["overallScore"], 58)
        self.assertEqual(result["outcome"]["code"], "FALLBACK ROUTE STABILIZED")

    def test_tampered_node_style_state_is_rejected(self):
        body = self.body()
        body["manualState"] += "x"
        status, result = run_request(body)
        self.assertEqual(status, 409)
        self.assertIn("sealed event states", result["error"])


if __name__ == "__main__":
    unittest.main()
