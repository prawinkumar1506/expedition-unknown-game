# Implementation guide

## Purpose and deployment boundary

Operation Clearway is a browser-based multiplayer data-science game with four active events. Vercel serves the player, lobby, and host pages plus lightweight Node API routes. It deliberately **does not train models in production**: Round 4 creates a Kaggle/local notebook from the team’s sealed feature, repair, and search choices. The optional scikit-learn evaluator is a local development tool only.

```text
host.html ──POST /api/room──> SQLite game_rooms
                                  │
index.html ──POST /api/room──> lobby.html ──poll──> game.html
                                                   │
                         /api/mission, labels, analyze, features, quality
                                                   │
                                      kaggle-export.js → Kaggle cell
                                                   │
                          submission.csv + search results + evaluation JSON
```

## Runtime configuration

| Module | Implementation responsibility |
| --- | --- |
| `package.json` | Declares the ESM Node project, Node 22.5+ requirement, static build command, and the Node test command. |
| `vercel.json` | Configures the Vercel routes. Data-backed Event 2–4 functions run in `bom1`, receive `data/traffic/**`, and have a 60-second cold-start-safe duration. `/api/health` rewrites to `api/health.js`. No Python function is deployed. |
| `requirements-local.txt` | Development-only dependency declaration for the local scikit-learn evaluator. It is intentionally not named `requirements.txt`, so Vercel does not package SciPy/scikit-learn. |
| `tools/local_ml_pipeline.py` | Development-only reference evaluator. It builds a real `SimpleImputer → StandardScaler → classifier` scikit-learn pipeline, runs five-fold stratified Macro F1, and can create a local 500-row submission. It is not part of the Vercel runtime. |

## Server modules

The active player flow uses the room and Event 2–4 routes; their state-changing handlers require `POST`. The fleet modules are retained as a separate admission-router prototype.

| Module | Route | Role and important behavior |
| --- | --- | --- |
| `api/_event.js` | internal | Loads and caches CSV/JSON game data, coerces telemetry numbers, exposes feature metadata and class definitions, creates deterministic Event 2 rows, and provides the ordered manual classifier. |
| `api/_state.js` | internal | HMAC-signs Event 2–4 state tokens. `packState()` serializes the room, player, and sealed decision; `verifyState()` rejects altered or cross-player tokens. Production should set `CLEARWAY_STATE_SECRET`. |
| `api/_gateway.js` | internal | Shared input cleaner, JSON response helper, fleet defaults, Redis helper, weighted rendezvous score, admission ticket signer, and reservation IDs. |
| `api/room.js` | `POST /api/room` | SQLite-backed room authority. `create` makes a 6-digit room with host token and 4-hour expiry; `join`, progress checkpoints, stage unlocks, and `start` are persisted in the local database. |
| `api/mission.js` | `POST /api/mission` | Delivers public game metadata, Event 2 records/rules, features, preview rows, and Kaggle tuning defaults. It never exposes a training endpoint. |
| `api/labels.js` | `POST /api/labels` | Validates Manual Override labels, applies the ordered rules from `_event.js`, scores `correct − wrong`, and seals a `manual` state token. |
| `api/analyze.js` | `POST /api/analyze` | Maintains an HMAC-signed 10-credit investigation ledger. Provides class-profile evidence and pairwise Spearman correlation evidence. Reopening purchased evidence is free; answer-revealing feature importance and derived features are intentionally absent. |
| `api/features.js` | `POST /api/features` | Requires exactly ten distinct valid features, verifies the investigation ledger, computes the strong-channel/investigation score, and seals a `features` token. |
| `api/quality.js` | `POST /api/quality` | Builds a room-specific repair plan from corruption logs, validates the selected repair choice, scores repair effectiveness, and seals a `quality` token using the team's locked features. |
| `api/health.js` | `GET /api/health` | Minimal availability response with server timestamp. |
| `api/camera.js` | legacy endpoint | Returns HTTP 410: Event 2 is tabular, not an image round. |
| `api/recovery.js` | legacy endpoint | Returns HTTP 410: the earlier recovery event is outside the Events 2–5 scope. |
| `api/join.js` | `POST /api/join` | Retained fleet-admission prototype. Orders healthy capacity-available fleets with weighted rendezvous routing and reserves a 30-second lease, atomically in Redis when configured. It is not used by the current SQLite room flow. |
| `api/heartbeat.js` | `POST /api/heartbeat` | Retained fleet-admission companion. Requires Redis and `x-fleet-key`; writes a 15-second fleet heartbeat. |

### State and scoring flow

1. `labels.js` produces a signed manual state.
2. `analyze.js` produces a signed investigation ledger; `features.js` consumes it and produces a feature state.
3. `quality.js` consumes the feature state and produces a quality state with the team's selected repairs and locked features.
4. The browser passes the sealed features, repairs, model, and tuning settings to `kaggle-export.js`. The generated cell—not Vercel—trains and evaluates the model.

## Client modules

| Module | Entry point | Responsibility |
| --- | --- | --- |
| `public/index.html` + `public/app.js` | `/` | Participant join form. Calls `room.js` with `join`, stores `{ room, player }` in `sessionStorage` as `expedition-session`, then opens the lobby. |
| `public/lobby.html` + `public/lobby.js` | `/lobby.html` | Polls room state every five seconds, renders the roster, and redirects the team to `game.html` when the host starts the room. |
| `public/game.html` + `public/game.js` | `/game.html` | Main player terminal. Runs Events 1–4, preserves local/server UI state, requests server-signed seals, renders Round 4’s repair/model workbench, and downloads generated notebooks. `game.js` is an ES module. |
| `public/kaggle-export.js` | imported by `game.js` | Pure client-side notebook generator. Validates the ten locked features, serializes the selected repair plan and search ranges, injects the chosen classifier, and supplies a safe download filename. |
| `public/host.html` + `public/host.js` | `/host.html` | Host room lifecycle UI. Creates the room, shows roster, starts the game, and presents the Kaggle handoff checklist: teams retain `submission.csv`, `randomized_search_results.csv`, and `best_model_evaluation.json`. |
| `public/mission.css` | `game.html` | Original game widgets: investigations, feature selection, repair cards, stage actions, and responsive layout. |
| `public/game-adapter.css` | `game.html` | Adapts game widgets to the Adminator dashboard shell and provides page-level responsive styling. |
| `public/vendor/adminator/` | all active pages | Vendored MIT-licensed Adminator 4.3.0 assets and base dashboard style. Do not edit generated vendor bundles without replacing the upstream asset set. |
| `public/styles.css`, `public/recovery.css` | retained legacy styles | Earlier standalone/recovery styling retained for reference; neither is linked by the current Events 2–5 pages. |

### Kaggle generator contract

`buildKaggleScript()` receives the chosen model, ten sealed features, repair choices, and search-range settings. It writes a standalone notebook that:

1. Locates unchanged `train_16.csv` and `test_16.csv` beside the notebook, under `data/` or `data/traffic/`, or below `/kaggle/input`.
2. Restricts inputs to the ten sealed features and applies only the selected missing-value/outlier repairs.
3. Learns repair statistics inside each training fold through `RepairedClassifier`, avoiding validation leakage; row-removal methods affect training rows only.
4. Runs real timed shuffled cross-validation with Macro F1 across the selected model search ranges.
5. Evaluates the selected configuration on a held-out split and refits it on all training data.
6. Saves `submission.csv`, `randomized_search_results.csv`, and `best_model_evaluation.json`.

The selected search spaces cover ten approved models: five ensemble and five regular estimators. The generator does not read `test_truth.csv`.

## Data modules

| Artifact | Used by | Contents |
| --- | --- | --- |
| `data/traffic/train_16.csv` | Events 3–4 / notebook source | 2,000 delivered damaged training rows with 21 telemetry features and labels. |
| `data/traffic/test_16.csv` | Event 4 / notebook source | 500 clean test rows without labels. |
| `data/traffic/feature_strength_table.csv` | Feature Hunt | Organizer strength grouping used to score the sealed ten-feature choice. |
| `data/traffic/corruption_log.csv` | Quality Lab and generated Kaggle cell | Missing, outlier, label, and duplicate evidence plus original values for repairs. |
| `data/traffic/generation_metadata.json` | Mission metadata | Source-package generation and injected-corruption counts. |
| `data/traffic/test_truth.csv` | local evaluator / organizer reference | Final labels used only for local/organizer checks. It is not read by generated participant notebooks. |

## SQLite module

`db/sqlite.js` creates the local room persistence layer in `data/clearway.sqlite`:

- `game_rooms` stores PIN, host token, mission seed, room status, roster, and expiry.
- `join_game_room()` locks the room row, rejects expired/started rooms, and appends a unique player.
- `start_game_room()` requires the host token and transitions the room to `started`.
- `game_evaluations` and `use_game_evaluation()` remain from the earlier server-side forecast implementation. They are not called by the Kaggle handoff but are retained for a future tournament-control feature.
- RLS is enabled, direct public access is revoked, and only `service_role` may execute the functions.

## Test modules

| Module | Coverage |
| --- | --- |
| `tests/game-phases.test.mjs` | Dataset shape, Manual Override scoring, signed analysis ledger, Feature Hunt lock, Quality Lab budget, Kaggle cell generation, and retired camera behavior. |
| `tests/router.test.mjs` | Weighted rendezvous ordering and capacity guard behavior for the retained fleet router. |
| `tests/test_ml_pipeline.py` | Local-only scikit-learn pipeline construction, reproducible five-fold diagnostics, submission shape, and HMAC tamper rejection. |

Run the active Node suite with `npm test`. To use the local evaluator, install `requirements-local.txt`, then run `python -m unittest discover -s tests -p "test_*.py" -v`.

## Environment and operational checklist

| Variable | Needed by | Notes |
| --- | --- | --- |
| `CLEARWAY_DB_PATH` | `db/sqlite.js` | Optional path for the LAN server's SQLite database. |
| `CLEARWAY_STATE_SECRET` | `_state.js` | Required in production to sign Event 2–4 seals independently of other secrets. |
| `MATCH_GATEWAY_SECRET` | legacy fleet router and analysis fallback | Signs admission tickets and, if no explicit state secret is set, analysis state. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | legacy fleet router | Enables atomic leases and heartbeat-aware capacity routing. |
| `FLEET_HEARTBEAT_SECRET` | `heartbeat.js` | Required `x-fleet-key` value for fleet heartbeat writes. |

Before a release: run `npm test`, `node --check public/game.js`, and `node --check public/kaggle-export.js`; start the standalone LAN server; create a host room; join with a player; and verify Round 4 downloads a model-specific notebook that reads the unchanged source CSV pair.
