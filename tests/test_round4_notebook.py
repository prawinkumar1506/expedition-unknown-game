"""Execute exported Round 4 Python, including actual ensemble endpoints.

The export smoke test reduces only the time budget to keep CI bounded.
Production timing is checked separately with unmodified downloaded code.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Round4NotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = """
import fs from 'node:fs';
import { MODEL_CATALOG } from './public/round4-config.js';
import { buildKaggleScript } from './public/kaggle-export.js';
const features = fs.readFileSync('data/traffic/train_16.csv','utf8').split('\\n')[0].trim().split(',').filter(key => !['event_id','label'].includes(key)).slice(0,10);
const codes = Object.fromEntries(Object.entries(MODEL_CATALOG).map(([model, config]) => [model, buildKaggleScript({model, features, tuning: {ranges: Object.fromEntries(Object.keys(config.parameters).map(key => [key, 5]))}})]));
const backup = JSON.parse(fs.readFileSync('data/traffic/backup_feature_list.json','utf8'));
console.log(JSON.stringify({codes, features}));
"""
        result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True)
        cls.generated = json.loads(result.stdout)

    def run_in_dataset(self, source):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        old_directory = Path.cwd()
        try:
            os.chdir(directory.name)
            for name in ["train_16.csv", "test_16.csv"]:
                Path(name).write_bytes((ROOT / "data" / "traffic" / name).read_bytes())
            namespace = {"__name__": "__main__"}
            with contextlib.redirect_stdout(io.StringIO()):
                exec(compile(source, "<exported-round4-notebook>", "exec"), namespace)
            return namespace, Path(directory.name)
        finally:
            os.chdir(old_directory)

    def test_all_eight_models_fit_at_both_real_slider_endpoints(self):
        for model, code in self.generated["codes"].items():
            with self.subTest(model=model):
                # Load the actual export's data handling, repairs, classifier and typed ranges.
                namespace, _ = self.run_in_dataset(code.split("\ngrid = list(ParameterGrid(PARAMETERS))")[0])
                X, _, y, _ = namespace["train_test_split"](namespace["X"], namespace["y"], train_size=300, stratify=namespace["y"], random_state=42)
                with namespace["threadpool_limits"](limits=1):
                    for endpoint in [0, -1]:
                        params = {key: values[endpoint] for key, values in namespace["PARAMETERS"].items()}
                        classifier = namespace["clone"](namespace["classifier"]).set_params(**params)
                        estimator = namespace["RepairedClassifier"](classifier).fit(X, y)
                        predictions = estimator.predict(namespace["X_test"].iloc[:15])
                        self.assertEqual(len(predictions), 15)
                        self.assertTrue(set(predictions).issubset(set(y)))
                        if model == "Bagged Trees" and endpoint == -1:
                            self.assertEqual(estimator.classifier_._max_samples, len(X))
                            self.assertEqual(estimator.classifier_._max_features, len(X.columns))

    def test_export_writes_three_valid_outputs_without_modifying_inputs(self):
        code = self.generated["codes"]["Random Forest"]
        code = code.replace("TARGET_SECONDS = 1050", "TARGET_SECONDS = 0.01")
        namespace, directory = self.run_in_dataset(code)
        pd = namespace["pd"]
        submission = pd.read_csv(directory / "submission.csv")
        self.assertEqual(list(submission.columns), ["event_id", "prediction"])
        self.assertEqual(len(submission), 500)
        self.assertEqual(submission["event_id"].tolist(), namespace["test_df"]["event_id"].tolist())
        self.assertFalse(submission.isna().any().any())
        evaluation = json.loads((directory / "best_model_evaluation.json").read_text())
        self.assertGreaterEqual(evaluation["completed_trials"], 1)
        self.assertEqual(evaluation["completed_cv_fits"], evaluation["completed_trials"] * 5)
        self.assertTrue(0 <= evaluation["holdout_macro_f1"] <= 1)
        self.assertEqual(len(pd.read_csv(directory / "randomized_search_results.csv")), evaluation["completed_trials"])
        for name in ["train_16.csv", "test_16.csv"]:
            self.assertEqual(hashlib.sha256((directory / name).read_bytes()).digest(), hashlib.sha256((ROOT / "data" / "traffic" / name).read_bytes()).digest())

    def test_repairs_are_fold_local_and_median_only_replaces_outliers(self):
        namespace, _ = self.run_in_dataset(self.generated["codes"]["Random Forest"].split("\ngrid = list(ParameterGrid(PARAMETERS))")[0])
        pd, np = namespace["pd"], namespace["np"]
        first, second = namespace["FEATURES"][:2]
        frame = pd.DataFrame({name: [10.0] * 20 for name in namespace["FEATURES"]})
        frame[first] = [1.0, 2.0, 3.0, 4.0] * 5
        frame.loc[0, first] = 1000.0
        frame.loc[1, second] = np.nan
        y = pd.Series(["a"] * 10 + ["b"] * 10)
        namespace["REPAIR_METHODS"] = {"missing": {}, "outlier": {first: "median_clip"}}
        fitted = namespace["RepairedClassifier"](namespace["DecisionTreeClassifier"]()).fit(frame, y)
        self.assertEqual(fitted.fills_[second], 0)
        repaired = fitted._transform(frame)
        self.assertEqual(repaired.loc[2, first], 3)
        self.assertNotEqual(repaired.loc[0, first], 1000)
        for method in ["mean", "median", "mode", "drop"]:
            namespace["REPAIR_METHODS"] = {"missing": {second: method}, "outlier": {first: "iqr_remove"}}
            fitted = namespace["RepairedClassifier"](namespace["DecisionTreeClassifier"]()).fit(frame, y)
            self.assertEqual(fitted.fills_[second], 10)
            test = frame.copy()
            test[second] = 99999
            self.assertEqual(len(fitted.predict(test)), len(frame))
            self.assertEqual(fitted.fills_[second], 10)


if __name__ == "__main__":
    unittest.main()
