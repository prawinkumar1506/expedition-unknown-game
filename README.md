# Signal Lost: Operation Clearway

An interface-driven multiplayer data-science game for Operation Clearway. A host opens a room, teams join, and every decision carries through Archive Reconstruction, Manual Override, Feature Hunt, and the final Repair + Model Handoff.

The UI is adapted from **Adminator 4.3.0**, an MIT-licensed dashboard template. Vendored assets and the upstream license live in `public/vendor/adminator/`.

For the full module map, request/response responsibilities, state flow, Kaggle export contract, data boundaries, and operational checklist, see [the implementation guide](docs/IMPLEMENTATION.md).

## Event flow

### Event 2 — Manual Override

Teams classify 50 tabular junction readings using the ordered paper protocol from `QuickRead_Briefing.pdf`:

1. (`incident_distance_m < 50` and `avg_vehicle_speed_kmph < 30`) **or** (`incident_distance_m < 100` and `avg_vehicle_speed_kmph < 10`) → `Accident`
2. otherwise, (`vehicle_count >= 25` and `avg_vehicle_speed_kmph < 25`) **or** (`road_occupancy_pct >= 70` and `avg_vehicle_speed_kmph < 20`) → `Heavy_Traffic`
3. otherwise, `pedestrian_count >= 10` **or** (`pedestrian_count >= 6` and `vehicle_count < 15`) → `Pedestrian_Crossing`
4. otherwise → `Normal_Traffic`

The first matching rule wins. Scoring is +1 correct and 0 for wrong or blank answers. Event 2 uses numbers only—there are no images.

### Event 3 — Feature Hunt

The supplied damaged training archive exposes 21 telemetry channels. Teams spend from a signed 10-credit investigation ledger, then lock exactly 10 channels. The two investigations are Class Profiles and pairwise Correlation Analysis; answer-revealing feature importance and derived features are intentionally absent.

### Event 4 — Repair + Model Handoff

Round 4 is a 90-minute final lab; completion opens after 60 minutes. It uses two cumulative wallets:

- Repair wallet: 50 credits. Missing-value or outlier treatment costs 3 credits per selected column/operation.
- Search wallet: 150 credits. Wider model-search ranges cost more credits and target longer real CV runtimes.

The original `train_16.csv` and `test_16.csv` remain unchanged. Each generated notebook carries the team's locked features, current repair plan, repair methods, model, search ranges, and random seed. Repair statistics are learned inside training folds so validation data is not used to choose imputation or outlier thresholds.

Teams can explore ten approved models—five ensemble and five regular estimators. The generated notebook performs real timed cross-validation work, records the search results, evaluates the selected configuration on a held-out split, refits on all training data, and predicts the 500-row test set.

After running in Kaggle, the cell writes direct notebook download links for:

```csv
submission.csv
randomized_search_results.csv
best_model_evaluation.json
```

Upload the supplied traffic CSV files as a Kaggle Dataset before running the cell. `test_truth.csv` is not read by the generated code.

## Supplied data

`data/traffic/` contains the package files used by the server:

- `train_16.csv`: 2,000 delivered rows, 21 features, deliberately damaged
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

The tests cover dataset scale/parity, Manual Override priority/scoring, signed Feature Hunt state, repair-budget enforcement, cumulative Round 4 wallets, timed model-search notebook generation, and the admission router. The local evaluator remains available for development-only scikit-learn checks; it is not deployed to Vercel.
