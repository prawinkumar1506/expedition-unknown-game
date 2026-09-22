# Signal Lost: Operation Clearway

An interface-driven multiplayer data-science game for **Events 2–5** of Operation Clearway. A host opens a room, teams join, and every decision carries into a final 500-row traffic forecast.

The UI is adapted from **Adminator 4.3.0**, an MIT-licensed dashboard template. Vendored assets and the upstream license live in `public/vendor/adminator/`.

For the full module map, request/response responsibilities, state flow, Kaggle export contract, data boundaries, and operational checklist, see [the implementation guide](docs/IMPLEMENTATION.md).

## Event flow

### Event 2 — Manual Override

Teams classify 50 tabular junction readings using the ordered paper protocol from `QuickRead_Briefing.pdf`:

1. `incident_distance_m < 50` → `Accident`
2. otherwise, `vehicle_count >= 25` and `avg_vehicle_speed_kmph < 25` → `Heavy_Traffic`
3. otherwise, `pedestrian_count >= 10` → `Pedestrian_Crossing`
4. otherwise → `Normal_Traffic`

The first matching rule wins. Scoring is +1 correct, −1 wrong, and 0 blank. Event 2 uses numbers only—there are no images.

### Event 3 — Feature Hunt

The supplied damaged training archive exposes 16 telemetry channels. Teams spend from a signed 10-credit investigation ledger, then lock exactly 10 channels. Available investigations are deliberately diagnostic rather than answer-revealing: basic statistics, missing-value analysis, class-wise distributions, correlations, and pair relationships.

### Event 4 — Data Quality Lab

Teams spend at most 15 repair credits within their locked feature set:

- Missing values: 3 credits per column, maximum 3 columns
- Outliers: 3 credits per column, maximum 2 columns
- Suspicious labels: 1 credit per record, maximum 6 records
- Duplicate removal: 2 credits per group, maximum 4 groups

The server applies the selected repairs to the supplied damaged archive and seals a scored repair plan. Teams keep the exact ten features they locked in Event 3; there is no fallback feature set in the final round.

### Event 5 — Kaggle Forecast Handoff

Teams select Decision Tree, Logistic Regression, K-Nearest Neighbors, Random Forest, or Support Vector Machine, then provide a random-search trial count, stratified-CV fold count, and random seed. The app generates a model-specific Kaggle Python cell rather than training inside Vercel.

The cell reproduces the sealed feature and repair decisions, builds a real scikit-learn `Pipeline` (`SimpleImputer` → `StandardScaler` → selected classifier), tunes its model-specific distributions with `RandomizedSearchCV` using Macro F1, refits the best configuration, and then evaluates that selected estimator with a second cross-validation. That final figure is clearly marked as post-tuning; use nested CV if an unbiased selection estimate is required.

After running in Kaggle, the cell writes direct notebook download links for:

```csv
submission.csv
randomized_search_results.csv
best_model_evaluation.json
```

Upload the supplied traffic CSV files as a Kaggle Dataset before running the cell. `test_truth.csv` is not read by the generated code.

## Supplied data

`data/traffic/` contains the package files used by the server:

- `train_16.csv`: 2,000 delivered rows, 16 features, deliberately damaged
- `train_clean_16.csv`: organizer-side 2,000-row canonical archive
- `test_16.csv`: clean 500-row hidden feed without labels
- `test_truth.csv`: server-side final answer key
- corruption, feature-strength, and generation metadata

Organizer truth files are not exposed by a public HTTP route. For a real competition, keep the repository/private deployment boundary appropriate so participants cannot read organizer assets from source control.

## Architecture

```text
Player / host browser
        │
        ├── Vercel static client
        └── Vercel API routes
              ├── SQLite rooms and game admission
              ├── signed Event 2 / 3 / 4 state seals
              ├── server-side dataset diagnostics and repairs
              └── client-side Kaggle RandomizedSearchCV handoff
```

The earlier weighted admission-router prototype remains in `/api/join` and `/api/heartbeat`; the current room flow uses a SQLite database owned by the LAN server.

## Local setup

Requirements: Node.js 22.5+ and Python 3.12 only when running the local evaluator.

```bash
npm install
python -m pip install -r requirements-local.txt
npm run dev
```

Create a room at `/host.html`, join from `/`, and start the room from the host console.

The server creates `data/clearway.sqlite` automatically. Set `CLEARWAY_DB_PATH` to place it elsewhere, and set `CLEARWAY_STATE_SECRET` so signed progression tokens remain stable across restarts. Give clients the server computer's LAN address, for example `http://192.168.1.20:3000/`.

## Validation

```bash
npm test
python -m unittest discover -s tests -p "test_*.py" -v
node --check public/game.js
python -m py_compile tools/local_ml_pipeline.py
```

The tests cover dataset scale/parity, Manual Override priority/scoring, signed Feature Hunt state, repair-budget enforcement, the emergency feed, Kaggle code generation for the approved models, and the admission router. The local evaluator remains available for development-only scikit-learn checks; it is not deployed to Vercel.
