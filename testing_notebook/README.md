# Round 5 notebook benchmark

Organizer-only scratch space. **Do not commit this folder.**

`benchmark_models.py` compares all ten generated notebook model families against
the hidden `data/traffic/test_truth.csv` using Macro F1 as the primary metric.
It uses one identical 10-feature set and one identical median + IQR-clip repair
policy for every model. The benchmark tuning space is the current UI's default
balanced setting (the first two values of each slider), so each model receives
the same participant-visible tuning breadth rather than organizer-only tuning.

Outputs:

- `benchmark_results.csv` — one-row-per-model comparison.
- `benchmark_details.json` — selected parameters, per-class metrics, confusion
  matrices, and CV trials.

The participant notebooks and live application never import this folder.
