import { buildKaggleScript, kaggleFilename, normalizeTuning } from "/kaggle-export.js";

const session = JSON.parse(sessionStorage.getItem("expedition-session") || "null");
if (!session) window.location.replace("/");

const box = document.querySelector("#workspace"), download = document.querySelector("#export"), statusText = document.querySelector("#mission-status");
const featureCredit = document.querySelector("#f-credit"), repairCredit = document.querySelector("#r-credit"), evaluationCredit = document.querySelector("#e-credit"), stageTimers = document.querySelector("#stage-timers");
const stageOrder = ["event1", "manual", "features", "quality"];
const analysisCatalog = [
  ["classprofiles", "Class profiles", 2, "See whether a sensor changes enough across traffic situations to be useful."],
  ["correlation", "Correlation analysis", 2, "Compare two sensors and check whether they may be giving you repeated information."],
  ["relationship", "Derived feature analysis", 2, "Study how two sensors behave together, create one combined feature, and decide whether that new feature deserves a slot."]
];
const modelCatalog = {
  "Decision Tree": { description: "Tune depth, split, leaf, criterion, and class weighting.", parameters: { criterion: [["gini", 1], ["entropy", 1], ["log_loss", 2]], max_depth: [[4, 1], [8, 1], [16, 2], [null, 2]], min_samples_split: [[2, 1], [8, 1], [16, 2], [32, 3]], min_samples_leaf: [[1, 1], [4, 1], [8, 2]], class_weight: [["balanced", 1], [null, 1]] } },
  "Logistic Regression": { description: "Tune regularization, solver, penalty, and class weighting.", parameters: { C: [[0.01, 1], [0.1, 1], [1, 2], [10, 2], [100, 3]], solver: [["lbfgs", 1], ["saga", 2]], penalty: [["l2", 1]], class_weight: [["balanced", 1], [null, 1]] } },
  "K-Nearest Neighbors": { description: "Tune neighbors, distance weighting, metric, and leaf size.", parameters: { n_neighbors: [[3, 1], [8, 1], [16, 2], [32, 3]], weights: [["uniform", 1], ["distance", 2]], p: [[1, 1], [2, 1]], leaf_size: [[15, 1], [30, 1], [60, 2]] } },
  "Random Forest": { description: "Tune tree count, depth, split, features, and weighting.", parameters: { n_estimators: [[100, 1], [200, 1], [400, 2], [800, 3]], max_depth: [[6, 1], [12, 1], [24, 2], [null, 2]], min_samples_split: [[2, 1], [8, 1], [16, 2]], min_samples_leaf: [[1, 1], [4, 1], [8, 2]], max_features: [["sqrt", 1], ["log2", 1], [null, 2]], class_weight: [["balanced", 1], ["balanced_subsample", 2]] } },
  "Support Vector Machine": { description: "Tune C, gamma, and class weighting for the RBF model.", parameters: { C: [[0.01, 1], [0.1, 1], [1, 2], [10, 2], [100, 3]], gamma: [[0.0001, 1], [0.001, 1], [0.01, 2], [0.1, 2]], class_weight: [["balanced", 1], [null, 1]] } }
};
const models = Object.entries(modelCatalog).map(([name, config]) => [name, config.description]);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const request = async (path, body) => { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error), { result }); return result; };
const downloadText = (filename, content, type = "text/plain;charset=utf-8") => { const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };

let data, stage = "event1", highestStage = 0;
let manualLabels = {}, manualLocked = false, manualState = "", manualResult = null, manualStatus = "";
let manualTimeSpentSec = 0, manualTimerId = null, manualTimerStart = 0;
let event1Result = null, event1Status = "", event1TimeSpentSec = 0, event1TimerId = null, event1TimerStart = 0, event1Selections = [];
let selectedFeatures = new Set(), analysisType = "classprofiles", analysisFeature = "", analysisSecond = "", analysisState = "", analysisCredits = 10, findings = [], featureState = "", featureResult = null, featureStatus = "";
let featureTimeSpentSec = 0, featureTimerId = null, featureTimerStart = 0;
let qualityPlan = null, repairs = { missingColumns: new Set(), outlierColumns: new Set() }, repairMethods = { missing: {}, outlier: {} }, emergencyFeed = false, qualityState = "", qualityResult = null, qualityStatus = "";
let qualityTimeSpentSec = 0, qualityTimerId = null, qualityTimerStart = 0;
let model = "Decision Tree", tuning = normalizeTuning(), hyperparameters = {}, forecastRuns = [], kaggleScript = "", forecastStatus = "", forecastLocked = false, preparedDatasets = null;
let forecastTimeSpentSec = 0, forecastTimerId = null, forecastTimerStart = 0;
let roomControl = { stageUnlocks: { global: ["event1"], players: {} } }, checkpointTimer = null;
const FEATURE_TIMEOUT_SECONDS = 30 * 60;
const QUALITY_TIMEOUT_SECONDS = 60 * 60;
const EVENT1_TIMEOUT_SECONDS = 15 * 60;
const FORECAST_TIMEOUT_SECONDS = QUALITY_TIMEOUT_SECONDS;
const stageStorageKey = `clearway-progress:${session?.room || "unknown"}:${session?.player || "unknown"}`;
const REPAIR_BUDGET = 50, EMERGENCY_REPAIR_COST = 30;
const modelSpend = () => forecastRuns.reduce((sum, run) => sum + Number(run.cost || 0), 0);
const event4CreditsRemaining = () => Math.max(0, REPAIR_BUDGET - repairSpend() - modelSpend());
const stageIsUnlocked = name => roomControl.stageUnlocks?.global?.includes(name) || roomControl.stageUnlocks?.players?.[session.player]?.includes(name);
const serializeState = () => ({ stage, highestStage, stageStartedAt: { event1: event1TimerStart, manual: manualTimerStart, features: featureTimerStart, quality: qualityTimerStart, forecast: forecastTimerStart }, manualLabels, manualLocked, manualState, manualResult, event1Result, event1Selections, analysisState, analysisCredits, findings, selectedFeatures: [...selectedFeatures], featureState, featureResult, qualityPlan, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), repairMethods, emergencyFeed, qualityState, qualityResult, model, tuning, hyperparameters, forecastRuns, kaggleScript, forecastStatus, forecastLocked });
const applyState = saved => {
  if (!saved || typeof saved !== "object") return;
  stage = saved.stage === "forecast" ? "quality" : (saved.stage || stage); highestStage = Number(saved.highestStage || 0); manualLabels = saved.manualLabels || {}; manualLocked = Boolean(saved.manualLocked); manualState = saved.manualState || ""; manualResult = saved.manualResult || null; event1Result = saved.event1Result || null; event1Selections = saved.event1Selections || [];
  analysisState = saved.analysisState || ""; analysisCredits = Number(saved.analysisCredits ?? 10); findings = saved.findings || []; selectedFeatures = new Set(saved.selectedFeatures || []); featureState = saved.featureState || ""; featureResult = saved.featureResult || null; qualityPlan = saved.qualityPlan || null;
  repairs = { missingColumns: new Set(saved.repairs?.missingColumns || []), outlierColumns: new Set(saved.repairs?.outlierColumns || []) }; repairMethods = saved.repairMethods || { missing: {}, outlier: {} };
  emergencyFeed = Boolean(saved.emergencyFeed); qualityState = saved.qualityState || ""; qualityResult = saved.qualityResult || null; model = saved.model || model; tuning = saved.tuning || tuning; hyperparameters = saved.hyperparameters || {}; forecastRuns = Array.isArray(saved.forecastRuns) ? saved.forecastRuns : []; kaggleScript = saved.kaggleScript || ""; forecastStatus = saved.forecastStatus || ""; forecastLocked = Boolean(saved.forecastLocked);
  const starts = saved.stageStartedAt || {}; event1TimerStart = Number(starts.event1 || 0); manualTimerStart = Number(starts.manual || 0); featureTimerStart = Number(starts.features || 0); qualityTimerStart = Number(starts.quality || 0); forecastTimerStart = Number(starts.forecast || 0);
};
const checkpoint = () => {
  const progress = serializeState();
  localStorage.setItem(stageStorageKey, JSON.stringify(progress));
  clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => request("/api/room", { action: "saveProgress", pin: session.room, player: session.player, progress }).catch(() => {}), 250);
};
const hydrate = room => {
  roomControl = room || roomControl;
  const serverState = room?.progress?.[session.player];
  const localState = JSON.parse(localStorage.getItem(stageStorageKey) || "null");
  applyState(serverState || localState);
  if (!stageIsUnlocked(stage)) stage = stageOrder.find(name => stageIsUnlocked(name)) || "event1";
  checkpoint();
};
const pollRoomControl = async () => { try { const result = await request("/api/room", { action: "get", pin: session.room, player: session.player }); const previousUnlocks = JSON.stringify(roomControl.stageUnlocks || {}); roomControl = result.room; if (previousUnlocks !== JSON.stringify(roomControl.stageUnlocks || {})) render(); } catch {} };
document.addEventListener("click", () => checkpoint());
document.addEventListener("change", () => checkpoint());

const formatCountdown = (secondsRemaining) => {
  const totalSeconds = Math.max(0, secondsRemaining);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};
const formatManualCountdown = () => formatCountdown(15 * 60 - manualTimeSpentSec);
const formatFeatureCountdown = () => formatCountdown(FEATURE_TIMEOUT_SECONDS - featureTimeSpentSec);
const formatQualityCountdown = () => formatCountdown(QUALITY_TIMEOUT_SECONDS - qualityTimeSpentSec);
const formatEvent1Countdown = () => formatCountdown(EVENT1_TIMEOUT_SECONDS - event1TimeSpentSec);
const formatForecastCountdown = () => formatCountdown(FORECAST_TIMEOUT_SECONDS - forecastTimeSpentSec);

const persistScore = async (stageName, storageKey, payload) => {
  await request("/api/scores", { room: session.room, player: session.player, stage: stageName, payload });
  const roomScores = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const roomKey = session.room;
  const teamScores = Array.isArray(roomScores[roomKey]) ? roomScores[roomKey] : [];
  const index = teamScores.findIndex(item => item.player === session.player);
  if (index >= 0) teamScores[index] = payload; else teamScores.push(payload);
  roomScores[roomKey] = teamScores;
  localStorage.setItem(storageKey, JSON.stringify(roomScores));
  window.dispatchEvent(new CustomEvent(`clearway-${stageName}-score`, { detail: { room: roomKey, payload } }));
};

const saveEvent1Result = async result => persistScore("event1", "clearway-event1-scores", {
  player: session.player,
  passed: Boolean(result.passed),
  status: result.status || (result.passed ? "completed" : "failed"),
  timeTakenSeconds: Number(result.timeTakenSeconds || event1TimeSpentSec),
  submittedAt: Date.now()
});

const saveEvent2Result = async result => {
  const payload = {
    player: session.player,
    correct: result.correct,
    wrong: result.wrong,
    blank: result.blank,
    points: result.points,
    score: result.score,
    timeTakenSeconds: Number(result.timeTakenSeconds || manualTimeSpentSec),
    submittedAt: Date.now()
  };
  return persistScore("manual", "clearway-event2-scores", payload);
};

const saveFeatureResult = async result => {
  const payload = {
    player: session.player,
    strong: Number(result.strongCount || 0),
    moderate: Number(result.moderateCount || 0),
    weak: Number(result.weakCount || 0),
    points: Number(result.pointsEarned || 0),
    maxPoints: Number(result.maxPoints || 20),
    score: Number(result.score || 0),
    credits: Number(result.spent || 0),
    timeTakenSeconds: Number(result.timeTakenSeconds || featureTimeSpentSec),
    submittedAt: Date.now()
  };
  return persistScore("features", "clearway-feature-scores", payload);
};

const saveQualityResult = async result => {
  const payload = {
    player: session.player,
    strong: Number(featureResult?.strongCount || 0),
    moderate: Number(featureResult?.moderateCount || 0),
    weak: Number(featureResult?.weakCount || 0),
    points: Number(featureResult?.pointsEarned || 0),
    maxPoints: Number(featureResult?.maxPoints || 20),
    score: Number(result.qualityScore ?? result.featureScore ?? featureResult?.score ?? 0),
    credits: Number(result.repairSpend ?? 0),
    timeTakenSeconds: Number(result.timeTakenSeconds || qualityTimeSpentSec),
    emergencyFeed: Boolean(result.emergencyFeed),
    status: result.status || "IN_PROGRESS",
    submittedAt: Date.now()
  };
  return persistScore("quality", "clearway-quality-scores", payload);
};

const sealManualRound = async () => {
  if (manualLocked) return;
  manualLocked = true;
  if (manualTimerId) clearInterval(manualTimerId);
  try {
    manualResult = await request("/api/labels", {
      room: session.room,
      player: session.player,
      labels: manualLabels,
      timeTakenSeconds: manualTimeSpentSec
    });
    manualState = manualResult.manualState;
    manualStatus = manualResult.message;
    await saveEvent2Result(manualResult);
    highestStage = Math.max(highestStage, 2);
    checkpoint();
    render();
  } catch (error) {
    manualLocked = false;
    manualStatus = error.message;
    render();
  }
};

const startEvent1Timer = () => {
  if (event1Result || event1TimerId) clearInterval(event1TimerId);
  if (!event1TimerStart || event1TimerStart > Date.now()) event1TimerStart = Date.now();
  event1TimerId = setInterval(() => {
    event1TimeSpentSec = Math.min(EVENT1_TIMEOUT_SECONDS, Math.max(0, Math.floor((Date.now() - event1TimerStart) / 1000)));
    updateChrome();
    if (event1TimeSpentSec % 5 === 0) checkpoint();
    if (event1TimeSpentSec >= EVENT1_TIMEOUT_SECONDS) {
      clearInterval(event1TimerId);
      if (!event1Result) {
        event1Result = { passed: false, status: "failed", timeTakenSeconds: EVENT1_TIMEOUT_SECONDS };
        event1Status = "15 minutes expired. Archive reconstruction failed. Event 2 opened with the supplied training data.";
        saveEvent1Result(event1Result).catch(() => {});
        highestStage = Math.max(highestStage, 1);
        setStage("manual");
      }
      return;
    }
    if (stage === "event1") {
      const timerNode = document.querySelector("#event1-timer-value");
      if (timerNode) timerNode.textContent = formatEvent1Countdown();
    }
  }, 1000);
};

const startManualTimer = () => {
  if (manualLocked) return;
  if (manualTimerId) clearInterval(manualTimerId);
  if (!manualTimerStart || manualTimerStart > Date.now()) manualTimerStart = Date.now();
  manualTimerId = setInterval(() => {
    manualTimeSpentSec = Math.min(15 * 60, Math.max(0, Math.floor((Date.now() - manualTimerStart) / 1000)));
    updateChrome();
    if (manualTimeSpentSec % 5 === 0) checkpoint();
    if (manualTimeSpentSec >= 15 * 60) {
      clearInterval(manualTimerId);
      if (!manualLocked) {
        manualStatus = "Time expired. Event 2 was auto-locked. Wait for the host to open the next stage.";
        sealManualRound();
      }
      return;
    }
    if (stage === "manual") {
      const timerNode = document.querySelector("#manual-timer-value");
      if (timerNode) timerNode.textContent = formatManualCountdown();
    }
  }, 1000);
};

const startFeatureTimer = () => {
  if (featureResult || featureTimerId) clearInterval(featureTimerId);
  if (!featureTimerStart || featureTimerStart > Date.now()) featureTimerStart = Date.now();
  featureTimerId = setInterval(() => {
    featureTimeSpentSec = Math.min(FEATURE_TIMEOUT_SECONDS, Math.max(0, Math.floor((Date.now() - featureTimerStart) / 1000)));
    updateChrome();
    if (featureTimeSpentSec % 5 === 0) checkpoint();
    if (featureTimeSpentSec >= FEATURE_TIMEOUT_SECONDS) {
      clearInterval(featureTimerId);
      if (!featureResult) {
        featureStatus = "Feature lock timed out. The ten-channel selection was completed automatically.";
        sealFeatureRound();
      }
      return;
    }
    if (stage === "features") {
      const timerNode = document.querySelector("#feature-timer-value");
      if (timerNode) timerNode.textContent = formatFeatureCountdown();
    }
  }, 1000);
};

const startQualityTimer = () => {
  if (qualityResult || qualityTimerId) clearInterval(qualityTimerId);
  if (!qualityTimerStart || qualityTimerStart > Date.now()) qualityTimerStart = Date.now();
  qualityTimerId = setInterval(() => {
    qualityTimeSpentSec = Math.min(QUALITY_TIMEOUT_SECONDS, Math.max(0, Math.floor((Date.now() - qualityTimerStart) / 1000)));
    forecastTimeSpentSec = qualityTimeSpentSec;
    updateChrome();
    if (qualityTimeSpentSec % 5 === 0) checkpoint();
    if (qualityTimeSpentSec >= QUALITY_TIMEOUT_SECONDS) {
      clearInterval(qualityTimerId);
      if (!qualityResult) {
        qualityStatus = "Quality Lab timed out. The current repair plan was sealed automatically.";
        sealQualityRound();
      }
      forecastLocked = true;
      return;
    }
    if (stage === "quality") {
      const timerNode = document.querySelector("#quality-timer-value, #forecast-timer-value");
      if (timerNode) timerNode.textContent = formatQualityCountdown();
    }
  }, 1000);
};

const startForecastTimer = () => {
  if (forecastLocked || forecastTimerId) clearInterval(forecastTimerId);
  if (!forecastTimerStart || forecastTimerStart > Date.now()) forecastTimerStart = Date.now();
  forecastTimerId = setInterval(() => {
    forecastTimeSpentSec = Math.min(FORECAST_TIMEOUT_SECONDS, Math.max(0, Math.floor((Date.now() - forecastTimerStart) / 1000)));
    if (forecastTimeSpentSec % 5 === 0) checkpoint();
    if (forecastTimeSpentSec >= FORECAST_TIMEOUT_SECONDS) {
      clearInterval(forecastTimerId);
      forecastLocked = true;
      forecastStatus = "40 minutes elapsed. Notebook generation is now locked and cannot be reopened.";
      if (stage === "forecast") render();
      return;
    }
    if (stage === "forecast") {
      const timerNode = document.querySelector("#forecast-timer-value");
      if (timerNode) timerNode.textContent = formatForecastCountdown();
    }
  }, 1000);
};

const evaluatedDerivedFeatures = () => findings.map(item => item.result?.derivedFeature).filter(Boolean).filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
const featureName = name => data?.featureMeta?.[name]?.label || evaluatedDerivedFeatures().find(item => item.id === name)?.label || String(name).replaceAll("_", " ");
const featureFamily = name => data?.featureMeta?.[name]?.family || evaluatedDerivedFeatures().find(item => item.id === name)?.family || "telemetry";
const displayFeatures = () => {
  const features = [...(data?.features || []), ...evaluatedDerivedFeatures().map(item => item.id)];
  let seed = `${session?.room || "room"}:${session?.player || "player"}`;
  for (const character of seed) seed = `${(seed.charCodeAt(0) ^ character.charCodeAt(0))}${seed.slice(1)}`;
  let state = [...seed].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 2166136261);
  for (let index = features.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [features[index], features[swapIndex]] = [features[swapIndex], features[index]];
  }
  return features;
};
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const sectionIntro = (event, title, subtitle, beats) => `<section class="story-brief"><span>EVENT ${event} · ${esc(title.toUpperCase())}</span><h1>${esc(title.split(" ")[0])} <i>${esc(title.split(" ").slice(1).join(" "))}</i></h1>${(Array.isArray(subtitle) ? subtitle : [subtitle]).map(paragraph => `<p>${esc(paragraph)}</p>`).join("")}<div class="story-beats">${beats.map((beat, index) => `<span class="${index < stageOrder.indexOf(stage) ? "done" : index === stageOrder.indexOf(stage) ? "active" : ""}">${esc(beat)}</span>`).join("")}</div></section>`;

function setStage(next) {
  const index = stageOrder.indexOf(next); if (index < 0 || index > highestStage || !stageIsUnlocked(next)) return;
  [event1TimerId, manualTimerId, featureTimerId, qualityTimerId, forecastTimerId].forEach(timerId => { if (timerId) clearInterval(timerId); });
  event1TimerId = manualTimerId = featureTimerId = qualityTimerId = forecastTimerId = null;
  stage = next; if (stage === "event1" && !event1Result) event1TimerStart = event1TimerStart || Date.now(); if (stage === "manual" && !manualResult) manualTimerStart = manualTimerStart || Date.now(); if (stage === "features" && !featureResult) featureTimerStart = featureTimerStart || Date.now(); if (stage === "quality" && !qualityResult) qualityTimerStart = qualityTimerStart || Date.now(); if (stage === "forecast") forecastTimerStart = forecastTimerStart || Date.now(); checkpoint(); render(); if (stage === "event1") startEvent1Timer(); if (stage === "manual") startManualTimer(); if (stage === "features") startFeatureTimer(); if (stage === "quality") startQualityTimer(); if (stage === "forecast") startForecastTimer(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function updateChrome() {
  featureCredit.textContent = `${analysisCredits} / 10`;
  const spent = repairSpend(); repairCredit.textContent = `${event4CreditsRemaining()} / ${REPAIR_BUDGET}`;
  evaluationCredit.textContent = `${event4CreditsRemaining()} Event 4 CR · ${formatCountdown(FORECAST_TIMEOUT_SECONDS - forecastTimeSpentSec)}`;
  if (stageTimers) stageTimers.textContent = `E1 ${formatCountdown(EVENT1_TIMEOUT_SECONDS - event1TimeSpentSec)} · E2 ${formatCountdown(15 * 60 - manualTimeSpentSec)} · E3 ${formatCountdown(FEATURE_TIMEOUT_SECONDS - featureTimeSpentSec)} · E4–5 ${formatCountdown(QUALITY_TIMEOUT_SECONDS - qualityTimeSpentSec)}`;
  document.querySelectorAll("[data-stage]").forEach(button => { const index = stageOrder.indexOf(button.dataset.stage); button.classList.toggle("active", button.dataset.stage === stage); button.classList.toggle("is-active", button.dataset.stage === stage); button.disabled = index > highestStage || !stageIsUnlocked(button.dataset.stage); });
}

function renderEvent1() {
  const archiveCandidates = [
    "JTU7_stream_A_core_20260314_0314_gen1.csv",
    "JTU7_stream_A_core_20260314_0314_gen2.csv",
    "JTU7_stream_A_core_20260314_0314_gen3.csv",
    "JTU7_stream_A_core_20260314_0314_gen3_COPY.csv",
    "JTU7_stream_B_context_20260314_0314_gen3.csv",
    "JTU7_stream_B_context_20260315_0314_gen3.csv",
    "JTU7_stream_C_labels_20260314_0314_gen3.csv",
    "JTU7_stream_C_labels_20260314_0314_gen3_partial.csv",
    "JTU9_stream_A_core_20260314_0314_gen3.csv",
    "camera_diag_backup_2025.csv",
    "weather_export_legacy_2024Q1.csv",
    "traffic/backup_feature_list.json"
  ];
  return `${sectionIntro("1", "Archive Reconstruction", [
    "The recovery desk received a whole cabinet of plausible labels: JTU7 and JTU9, a context page dated March 14 and another dated March 15, three shelf marks—gen1, gen2 and gen3—a file marked COPY, a labels file marked partial, plus weather_export_legacy_2024Q1, camera_diag_backup_2025 and a folder called personal_backup_do_not_use. The archivist warns that names are only the first layer of the puzzle; every shelf contains something that looks almost useful.",
    "Read the incident log before touching the directory. It describes the crossing on Meridian Ave where the Site D route was struck by the Surge. The route card for that crossing carries a hyphenated badge, JTU-7; another badge in the cabinet says JTU-9. The night watch began at 03:14 and ended six hours later at 09:14. The log was written for the 14th of March 2026, although a neighbouring export carries the 15th. Decide which site, date and clock belong to the same event before trusting any filename.",
    "Three couriers tried to deliver the archive before the power dropped. The first delivery was an unfinished draft; the second was a stale revision; the last one was the only attempt that reached completion. Their envelopes are also different in what they remember: one records movement at the junction, one records weather, visibility, cameras and signals, and one carries verdicts written before the Surge. The movement and context voices should tell the same fifty-event story. The verdict voice speaks for forty events and leaves ten deliberately unanswered. A copied envelope, a truncated envelope and a wrong-day envelope may still borrow a familiar costume.",
    "The answer is not the three neatest names. It is the only set that survives every sentence of the log, agrees on the site and six-hour window, uses the completed generation rather than the two earlier attempts, and joins cleanly by event ID. Inspect the contents as well as the labels, keep the ten unanswered verdicts blank, and seal the three voices your team can defend."
  ], ["Archive Reconstruction", "Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>TARGET SITE</small><b>JTU-7</b></div><div><small>WINDOW</small><b>03:14–09:14</b></div><div><small>FINAL SYNC</small><b>generation 3</b></div><div><small>LEFTOVER FRAGMENTS</small><b>old + stray</b></div><div><small>TIMER</small><b id="event1-timer-value">${formatEvent1Countdown()}</b></div></section>
    <section class="card"><div class="panel-title">Recovered archive bundle <span>Pull together the fragments that belong to the final JTU-7 recovery window</span></div>
      <div class="selection-board">
        <div class="panel-title">Available recovery fragments <span>${event1Selections.length}/3 selected</span></div>
        <div class="pick-grid">${archiveCandidates.map(name => `<button class="pick feature ${event1Selections.includes(name) ? "chosen" : ""}" data-event1-choice="${name}" type="button" ${event1Result ? "disabled" : ""}><b>${event1Selections.includes(name) ? "✓" : "+"}</b><span class="pick-text"><strong class="pick-name">${esc(name)}</strong><small>recovery fragment</small></span></button>`).join("")}</div>
      </div>
      <div class="analysis-status">${esc(event1Status || "Choose the three fragments that belong to the final JTU-7 gen3 bundle. No upload box is required; the archive is already staged in the project folder and it must be reconstructed from the valid names alone.")}</div>
      <div class="stage-actions">${event1Result ? `<span class="recovery-message success">Archive ${event1Result.passed ? "completed" : "failed"}. This round is locked${stageIsUnlocked("manual") ? "." : "; waiting for the host to open Event 2."}</span>${stageIsUnlocked("manual") ? `<button class="btn btn--primary" data-next="manual">Open Event 2</button>` : ""}` : `<button id="event1-submit" class="btn btn--primary" ${event1Selections.length !== 3 ? "disabled" : ""}>Submit archive</button>`}</div>
    </section>`;
}

function renderManual() {
  const answered = Object.values(manualLabels).filter(Boolean).length;
  const nextStageOpen = stageIsUnlocked("features");
  return `${sectionIntro("2", "Manual Override", "Fifty queued junction readings cannot wait for CLEARWAY to reboot. Apply the printed checklist from top to bottom; the first matching rule wins. Correct answers score +1; blank and wrong answers score 0.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>QUEUED READINGS</small><b>50 tabular records</b></div><div><small>SCORING</small><b>+1 correct · 0 wrong · 0 blank</b></div><div><small>PROTOCOL</small><b>First matching rule wins</b></div><div><small>PROGRESS</small><b id="manual-progress">${answered}/50 answered</b></div><div><small>TIMER</small><b id="manual-timer-value">${formatManualCountdown()}</b></div></section>
    <section class="card"><div class="panel-title">Paper protocol <span>Read every rule in order</span></div><div class="protocol-grid">${data.manualRules.map(rule => `<article><span>RULE ${rule.priority}</span><b>${esc(rule.label)}</b><small>${esc(rule.test)}</small></article>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Manual review tray <span>Road occupancy is context; it is not a decision threshold in this protocol</span></div><div class="table-scroll"><table class="data-table manual-table"><thead><tr><th>ID</th><th>Vehicles</th><th>Avg speed</th><th>Occupancy</th><th>Pedestrians</th><th>Incident distance</th><th>Controller call</th></tr></thead><tbody>${data.manualRows.map(row => `<tr><th>${row.manual_id}</th><td>${row.vehicle_count}</td><td>${row.avg_vehicle_speed_kmph} km/h</td><td>${row.road_occupancy_pct}%</td><td>${row.pedestrian_count}</td><td>${row.incident_distance_m} m</td><td><select data-manual="${row.manual_id}" ${manualLocked ? "disabled" : ""}><option value="">Leave blank · 0 points</option>${data.manualClasses.map(label => `<option value="${label}" ${manualLabels[row.manual_id] === label ? "selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div><div class="stage-actions"><span class="${manualResult ? "recovery-message success" : "recovery-message"}">${esc(manualStatus || "You may seal the ledger with blanks; guessing carries a real penalty.")}</span>${manualLocked ? `<button class="btn btn--primary" data-next="features" ${nextStageOpen ? "" : "disabled"}>→ ${nextStageOpen ? "Open Event 3" : "Waiting for host to open Event 3"}</button>` : `<button id="lock-manual" class="btn btn--primary">Seal Event 2 ledger</button>`}</div></section>`;
}

function findingHtml(item) {
  const result = item.result;
  if (result.kind === "classprofiles") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>class profile</span></header><div class="finding-callout"><span><b>What this means</b><br>${esc(result.explanation || "Compare how this sensor behaves in each traffic situation.")}</span></div><table class="analysis-table"><thead><tr><th>Traffic situation</th><th>Typical reading</th><th>Readings available</th></tr></thead><tbody>${result.classes.map(row => `<tr><th>${esc(row.label.replaceAll("_", " "))}</th><td>${number(row.median)}</td><td>${row.count - row.missingCount}/${row.count}</td></tr>`).join("")}</tbody></table></article>`;
  if (result.kind === "correlation") return `<article class="finding"><header><b>${esc(featureName(result.feature))} × ${esc(featureName(result.secondFeature))}</b><span>correlation analysis</span></header><div class="finding-callout"><span><b>What this means</b><br>${esc(result.explanation)}</span></div><div class="relationship-score">Measured connection <strong>${esc(result.evidence?.strength || "unknown")}</strong></div></article>`;
  return `<article class="finding"><header><b>${esc(featureName(result.feature))} × ${esc(featureName(result.secondFeature))}</b><span>derived feature analysis</span></header><div class="finding-callout"><span><b>What the relationship shows</b><br>${esc(result.explanation)}</span></div><table class="analysis-table"><thead><tr><th>${esc(featureName(result.feature))} range</th><th>Typical ${esc(featureName(result.secondFeature))}</th><th>Readings</th></tr></thead><tbody>${result.bins.map(bin => `<tr><th>${number(bin.from)}–${number(bin.to)}</th><td>${number(bin.median)}</td><td>${bin.count}</td></tr>`).join("")}</tbody></table>${result.derivedFeature ? `<div class="finding-callout"><span><b>Derived feature created: ${esc(result.derivedFeature.label)}</b><br>${esc(result.derivedFeature.explanation)}<br><br><b>Formula:</b> ${esc(result.derivedFeature.formula)}<br><b>Class-separation evidence:</b> ${esc(result.derivedFeature.evidence?.level || "unknown")}</span></div>` : ""}</article>`;
}

function renderFeatures() {
  const config = analysisCatalog.find(item => item[0] === analysisType) || analysisCatalog[0], pair = analysisType === "correlation" || analysisType === "relationship", nextStageOpen = stageIsUnlocked("quality");
  const orderedFeatures = displayFeatures();
  return `${sectionIntro("3", "Feature Hunt", "Sixteen telemetry channels survived the Surge, but Central has only ten seats. Spend investigation credits, then lock exactly ten channels. That choice cannot be reopened.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>CANDIDATE CHANNELS</small><b>${data.features.length}</b></div><div><small>LOCKED INPUTS</small><b>Exactly 10</b></div><div><small>INVESTIGATION POOL</small><b>${analysisCredits}/10 credits</b></div><div><small>TRAIN ARCHIVE</small><b>${data.recordCounts.trainingDelivered} damaged rows</b></div><div><small>TIMER</small><b id="feature-timer-value">${formatFeatureCountdown()}</b></div></section>
    <div class="investigation-shell"><aside class="tool-catalog"><div class="panel-title">Investigation menu <span>10-credit pool</span></div>${analysisCatalog.map(item => `<button data-analysis-type="${item[0]}" class="${analysisType === item[0] ? "active" : ""}" ${featureResult ? "disabled" : ""}><span><b>${esc(item[1])}</b><small>${esc(item[3])}</small></span><strong>${item[2]} CR</strong></button>`).join("")}</aside>
      <section class="evidence-console"><div class="panel-title">Analysis console <span>${esc(config[1])}</span></div><div class="analysis-config"><div><span>SELECTED TOOL</span><b>${esc(config[1])}</b><p>${esc(config[3])}</p></div><label>Primary channel<select id="analysis-feature">${data.features.map(name => `<option value="${name}" ${analysisFeature === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>${pair ? `<label>Comparison channel<select id="analysis-second">${data.features.filter(name => name !== analysisFeature).map(name => `<option value="${name}" ${analysisSecond === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>` : ""}<button id="run-analysis" class="btn btn--primary" ${featureResult || analysisCredits < config[2] ? "disabled" : ""}>Run · ${config[2]} credits</button></div><div class="analysis-status">${esc(featureStatus || "Purchased evidence can be reopened without spending again.")}</div><div class="findings">${findings.length ? findings.map(findingHtml).join("") : `<div class="empty-finding"><b>NO INVESTIGATION PURCHASED</b><span>Choose a tool and spend credits to reveal evidence.</span></div>`}</div></section></div>
    <section class="selection-board"><div class="panel-title">Ten-feature lock <span>${selectedFeatures.size}/10 selected · ${evaluatedDerivedFeatures().length} derived evaluated</span></div><div class="pick-grid">${orderedFeatures.map(name => `<button class="pick feature ${selectedFeatures.has(name) ? "chosen" : ""}" data-feature="${name}" ${featureResult ? "disabled" : ""}><b>${selectedFeatures.has(name) ? "✓" : "+"}</b><span>${esc(featureName(name))}<small>${featureFamily(name) === "derived" ? "evaluated derived feature" : `${esc(featureFamily(name))} channel`}</small></span></button>`).join("")}</div>${featureResult ? `<div class="feature-score"><strong>${featureResult.score}</strong><span>EVENT 3 SCORE</span><div><small>High-value seats</small><b>${featureResult.strongCount}/10</b></div><div><small>Credits spent</small><b>${featureResult.spent}/10</b></div></div><div class="stage-actions"><span class="recovery-message success">${esc(featureResult.message)}</span><button class="btn btn--primary" data-next="quality" ${nextStageOpen ? "" : "disabled"}>→ ${nextStageOpen ? "Open Event 4" : "Waiting for host to open Event 4"}</button></div>` : `<div class="feature-lock"><span>${esc(featureStatus || "Investigate first, then commit up to ten features. Any derived feature you evaluate becomes selectable here and uses one slot like a normal sensor.")}</span><b>${selectedFeatures.size}/10</b><button id="lock-features" class="btn btn--primary">Lock selection</button></div>`}</section>`;
}

const sealFeatureRound = async () => {
  if (featureResult) return;
  try {
    featureResult = await request("/api/features", { room: session.room, player: session.player, features: [...selectedFeatures], analysisState });
    featureState = featureResult.featureState;
    const datasetSnapshot = await request("/api/dataset", { room: session.room, player: session.player, stage: "features", featureState });
    featureStatus = `${featureResult.message} Working train/test datasets now contain only the ${datasetSnapshot.summary.features.length} locked channels.`;
    await saveFeatureResult(featureResult);
    highestStage = Math.max(highestStage, 3);
    const planResponse = await request("/api/quality", { room: session.room, player: session.player, action: "plan", featureState });
    qualityPlan = planResponse.plan;
    render();
  } catch (error) {
    featureStatus = error.message;
    render();
  }
};

const sealQualityRound = async () => {
  if (qualityResult) return;
  try {
    qualityResult = await request("/api/quality", {
      room: session.room,
      player: session.player,
      action: "seal",
      featureState,
      emergencyFeed,
      repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])),
      missingMethods: repairMethods.missing,
      outlierMethods: repairMethods.outlier,
      timeTakenSeconds: qualityTimeSpentSec
    });
    qualityState = qualityResult.qualityState;
    const datasetSnapshot = await request("/api/dataset", { room: session.room, player: session.player, stage: "quality", qualityState });
    preparedDatasets = null;
    qualityStatus = `${qualityResult.message} Working datasets updated: ${datasetSnapshot.summary.missingTrain} training values and ${datasetSnapshot.summary.missingTest} test values remain missing.`;
    await saveQualityResult(qualityResult);
    highestStage = Math.max(highestStage, 4);
    render();
  } catch (error) {
    qualityStatus = error.message;
    render();
  }
};

const submitEvent4 = async () => {
  if (!forecastRuns.length) {
    forecastStatus = "Generate the model notebook before submitting Event 4.";
    render();
    return;
  }
  if (!qualityResult) {
    qualityResult = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, emergencyFeed, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), missingMethods: repairMethods.missing, outlierMethods: repairMethods.outlier, timeTakenSeconds: qualityTimeSpentSec });
  }
  const submittedAt = Date.now();
  const timeTakenSeconds = Math.min(QUALITY_TIMEOUT_SECONDS, Math.max(0, Math.floor((submittedAt - qualityTimerStart) / 1000)));
  clearInterval(qualityTimerId);
  clearInterval(forecastTimerId);
  qualityTimerId = null;
  forecastTimerId = null;
  qualityTimeSpentSec = timeTakenSeconds;
  forecastTimeSpentSec = timeTakenSeconds;
  qualityResult = { ...qualityResult, status: "COMPLETED", timeTakenSeconds };
  await saveQualityResult(qualityResult);
  forecastStatus = "Event 4 submitted. The model handoff and completion time are recorded.";
  checkpoint();
  render();
};

const repairSpend = () => qualityPlan ? repairs.missingColumns.size * qualityPlan.costs.missing + repairs.outlierColumns.size * qualityPlan.costs.outlier + (emergencyFeed ? EMERGENCY_REPAIR_COST : 0) : 0;
function repairCards(kind, items) {
  const key = { missing: "missingColumns", outlier: "outlierColumns" }[kind], set = repairs[key], cost = qualityPlan.costs[kind], methods = kind === "missing" ? qualityPlan.missingMethods : qualityPlan.outlierMethods;
  return items.map(item => { const id = item.feature, selected = set.has(id), detail = kind === "missing" ? "Choose a replacement method for this locked column." : "Choose how to handle outliers in this locked column."; return `<article class="repair-case ${selected ? "selected" : ""}"><button class="repair-case-toggle" data-repair-kind="${kind}" data-repair-id="${id}" ${emergencyFeed ? "disabled" : ""}><div class="repair-case-head"><div><span class="eyebrow">${kind.toUpperCase()}</span><h3>${esc(featureName(id))}</h3></div><span class="repair-cost">${cost} CR</span></div><div class="repair-evidence"><small>REPAIR OPTION</small><p>${esc(detail)}</p></div></button>${selected ? `<label class="repair-method">${kind === "missing" ? "Replacement method" : "Outlier method"}<select data-repair-method="${kind}" data-repair-id="${id}" ${emergencyFeed ? "disabled" : ""}>${methods.map(method => `<option value="${method}" ${(repairMethods[kind][id] || methods[0]) === method ? "selected" : ""}>${method.replaceAll("_", " ")}</option>`).join("")}</select></label>` : ""}</article>`; }).join("");
}
function renderQuality() {
  if (!qualityPlan) return `${sectionIntro("4", "Data Quality Lab", "The feature lock is closed. Loading only the damaged records that affect your ten selected channels.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}<section class="card"><div class="loading"><i></i>SCANNING TRAINING ARCHIVE…</div></section>`;
  const spent = repairSpend();
  const emergencyEligible = featureResult?.strongCount <= 4;
  return `${sectionIntro("4", "Repair + Model Handoff", "Clean only missing values and outliers, choose how each repair is applied, then generate and run model notebooks before the combined handoff timer expires.", ["Manual Override", "Feature Hunt", "Repair + Model Handoff"])}
    <section class="incident-ribbon"><div><small>EVENT 4 POOL</small><b>${event4CreditsRemaining()}/${REPAIR_BUDGET} credits</b></div><div><small>MISSING VALUES</small><b>3 credits/column · confirmation required</b></div><div><small>OUTLIERS</small><b>3 credits/column · confirmation required</b></div><div><small>EMERGENCY FEED</small><b>${EMERGENCY_REPAIR_COST} credits</b></div></section>
    <section class="card emergency-feed ${emergencyFeed ? "selected" : ""}"><div class="panel-title">Emergency Telemetry Feed <span>Selection is irreversible</span></div><div class="emergency-body"><div><span class="eyebrow">BACKUP RECOVERY PATH</span><h3>Available only after a failed Feature Hunt lock.</h3><p>${emergencyEligible ? `Selecting this feed charges ${EMERGENCY_REPAIR_COST} repair credits immediately. It uses the backup train/test files, forfeits Event 3, and caps Event 4 at 35/100.` : `Your ${featureResult?.strongCount ?? 0}/10 strong-channel lock is still competitive. The backup route unlocks only at 4 or fewer strong channels.`}</p></div><button id="toggle-emergency" class="btn ${emergencyFeed ? "btn--primary" : "btn--ghost"}" ${qualityResult || !emergencyEligible || emergencyFeed ? "disabled" : ""}>${emergencyFeed ? `Emergency feed selected · ${EMERGENCY_REPAIR_COST} CR charged` : `Select emergency feed · ${EMERGENCY_REPAIR_COST} CR`}</button></div></section>
    ${emergencyFeed ? `<section class="card"><div class="panel-title">Clean recovery feed <span>Repair operations sealed</span></div><div class="stage-actions"><span class="recovery-message">The backup feed is already clean. Missing-value and outlier operations are sealed and unavailable.</span></div></section>` : `<section class="card"><div class="panel-title">Missing values <span>${repairs.missingColumns.size}/${qualityPlan.limits.missing} columns selected</span></div><div class="repair-grid">${repairCards("missing", qualityPlan.missingColumns)}</div></section>
    <section class="card"><div class="panel-title">Impossible outliers <span>${repairs.outlierColumns.size}/${qualityPlan.limits.outlier} columns selected</span></div><div class="repair-grid">${repairCards("outlier", qualityPlan.outlierColumns)}</div><div class="stage-actions"><span class="recovery-message">${esc(qualityStatus || `${spent} repair credits selected. Your choices will be baked into the working train/test datasets before model handoff.`)}</span></div></section>`}` + renderForecast();
}

function renderForecast() {
  const outputNames = "train_ready.csv · test_ready.csv · model notebook";
  const catalog = modelCatalog[model], selected = hyperparameters[model] || Object.fromEntries(Object.entries(catalog.parameters).map(([name, options]) => [name, options[0][0]]));
  const parameterCost = Object.entries(catalog.parameters).reduce((sum, [name, options]) => sum + options.filter(([value]) => (Array.isArray(selected[name]) ? selected[name] : [selected[name]]).some(candidate => String(candidate) === String(value))).reduce((subtotal, [, cost]) => subtotal + cost, 0), 0);
  const runCost = 1 + parameterCost;
  const parameterControls = Object.entries(catalog.parameters).map(([name, options]) => { const values = Array.isArray(selected[name]) ? selected[name] : [selected[name]]; return `<label>${esc(name.replaceAll("_", " "))}<select multiple size="${Math.min(4, options.length)}" data-hyperparameter="${esc(name)}" ${forecastLocked ? "disabled" : ""}>${options.map(([value, cost]) => `<option value="${value === null ? "__null__" : esc(value)}" data-cost="${cost}" ${values.some(candidate => String(candidate) === String(value)) ? "selected" : ""}>${value === null ? "None" : esc(value)} · ${cost} CR</option>`).join("")}</select></label>`; }).join("");
  return `${sectionIntro("4", "Model Handoff", "After cleaning, configure and generate fixed model notebooks, execute them locally, and download the resulting submission file before the combined handoff timer expires.", ["Manual Override", "Feature Hunt", "Repair + Model Handoff"])}
    <section class="incident-ribbon"><div><small>FINAL TEST FEED</small><b>${data.recordCounts.finalTest} unseen rows</b></div><div><small>MODEL RUNS</small><b>${forecastRuns.length}</b></div><div><small>EVENT 4 CREDITS</small><b>${event4CreditsRemaining()}/${REPAIR_BUDGET}</b></div><div><small>HANDOFF WINDOW</small><b id="forecast-timer-value">${formatForecastCountdown()}</b></div></section>
    <section class="card"><div class="panel-title">Model choice <span>One real scikit-learn pipeline per notebook run</span></div><div class="model-grid">${models.map(item => `<button class="model ${model === item[0] ? "selected" : ""}" data-model="${item[0]}"><span>RANDOMIZED SEARCH</span><b>${esc(item[0])}</b><i class="protocol-name">SCALE · TUNE · TRAIN</i><small>${esc(item[1])}</small></button>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Hyperparameter controls <span>${esc(model)} · this run costs ${runCost} CR</span></div><div class="analysis-config">${parameterControls}<label>Random-search trials<input id="tuning-trials" type="number" min="5" max="100" value="${tuning.trials}" ${forecastLocked ? "disabled" : ""}></label><label>Stratified CV folds<input id="tuning-folds" type="number" min="3" max="10" value="${tuning.folds}" ${forecastLocked ? "disabled" : ""}></label><label>Random seed<input id="tuning-seed" type="number" min="0" max="999999" value="${tuning.randomState}" ${forecastLocked ? "disabled" : ""}></label></div><div class="analysis-status">Dropdown values are discrete choices. Each selection has a visible credit cost; every generated notebook is fixed to this run configuration.</div></section>
    <section class="card"><div class="panel-title">Prepared data + notebook delivery <span>${outputNames}</span></div><div class="stage-actions"><span class="recovery-message">${esc(forecastStatus || (forecastLocked ? "The handoff window has expired. Notebook generation is locked." : "Freeze your current choices into prepared train/test CSVs, then generate a notebook that only scales, tunes, trains, and evaluates."))}</span><button id="generate-kaggle" class="btn btn--primary" ${forecastLocked || event4CreditsRemaining() < runCost ? "disabled" : ""}>${forecastLocked ? "Generation locked" : `Prepare data + notebook · ${runCost} CR`}</button></div>${preparedDatasets ? `<div class="stage-actions"><span>Prepared files: ${preparedDatasets.summary.trainRows} training rows · ${preparedDatasets.summary.testRows} test rows · ${preparedDatasets.summary.features.length} features</span><button id="download-train-ready" class="btn btn--ghost">Download train_ready.csv</button><button id="download-test-ready" class="btn btn--ghost">Download test_ready.csv</button></div>` : ""}</section>
    <section class="card"><div class="panel-title">Generated run history <span>${forecastRuns.length} notebook${forecastRuns.length === 1 ? "" : "s"}</span></div>${forecastRuns.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Model</th><th>Credits</th><th>Parameters</th><th>Generated</th></tr></thead><tbody>${forecastRuns.map(run => `<tr><td>${esc(run.model)}</td><td>${run.cost}</td><td>${esc(Object.entries(run.parameters).map(([key, value]) => `${key}=${value}`).join(", "))}</td><td>${new Date(run.createdAt).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-finding">No notebooks generated yet.</div>`}</section>
    <section class="card"><div class="panel-title">Final submission <span>${qualityResult?.status === "COMPLETED" ? "Recorded" : "Required"}</span></div><div class="stage-actions"><span class="recovery-message">${esc(qualityResult?.status === "COMPLETED" ? "Event 4 is complete and the admin dashboard has been updated." : "When the model test is complete, submit this event to record your final time.")}</span><button id="submit-event4" class="btn btn--primary" ${!forecastRuns.length || qualityResult?.status === "COMPLETED" ? "disabled" : ""}>${qualityResult?.status === "COMPLETED" ? "Event 4 submitted" : "I have completed the test, I am going to submit it"}</button></div></section>`;
}

function render() {
  updateChrome();
  box.innerHTML = stage === "event1" ? renderEvent1() : stage === "manual" ? renderManual() : stage === "features" ? renderFeatures() : stage === "quality" ? renderQuality() : renderForecast();
  bind();
}

function toggleRepair(kind, id) {
  const key = { missing: "missingColumns", outlier: "outlierColumns" }[kind], set = repairs[key], limit = qualityPlan.limits[kind], cost = qualityPlan.costs[kind];
  if (set.has(id)) set.delete(id);
  else if (set.size >= limit) qualityStatus = `That repair type is limited to ${limit} selections.`;
  else if (event4CreditsRemaining() < cost) qualityStatus = `That repair costs ${cost} credits, but only ${event4CreditsRemaining()} Event 4 credits remain.`;
  else if (window.confirm(`Selecting ${featureName(id)} for ${kind} repair will spend ${cost} Event 4 credits. Continue?`)) set.add(id);
  preparedDatasets = null;
  render();
}

function bind() {
  document.querySelectorAll("[data-event1-choice]").forEach(button => {
    button.onclick = () => {
      const name = button.dataset.event1Choice;
      if (event1Selections.includes(name)) {
        event1Selections = event1Selections.filter(item => item !== name);
      } else if (event1Selections.length < 3) {
        event1Selections.push(name);
      } else {
        event1Selections = [name];
      }
      render();
    };
  });

  const event1Submit = document.querySelector("#event1-submit");
  if (event1Submit) event1Submit.onclick = async () => {
    const names = [...event1Selections];
    const required = ["JTU7_stream_A_core_20260314_0314_gen3.csv", "JTU7_stream_B_context_20260314_0314_gen3.csv", "JTU7_stream_C_labels_20260314_0314_gen3.csv"];
    const isMatch = names.length === required.length && required.every(name => names.includes(name));
    if (!isMatch) {
      event1Status = "The recovered bundle does not match the expected final archive. Re-check the site, time window, and generation before submitting again.";
      render();
      return;
    }
    event1TimeSpentSec = Math.min(EVENT1_TIMEOUT_SECONDS, Math.max(0, Math.floor((Date.now() - event1TimerStart) / 1000)));
    clearInterval(event1TimerId);
    event1TimerId = null;
    event1Submit.disabled = true;
    try {
      const result = await request("/api/recovery", { room: session.room, player: session.player, files: names, timeTakenSeconds: event1TimeSpentSec });
      event1Result = { passed: Boolean(result.passed), status: result.status || "completed", timeTakenSeconds: Number(result.timeTakenSeconds || event1TimeSpentSec) };
      event1Status = result.message || "Archive reconstructed successfully. The final JTU-7 gen3 bundle was verified.";
      await saveEvent1Result(event1Result);
      highestStage = Math.max(highestStage, 1);
      render();
    } catch (error) {
      event1Status = error.message || "The archive bundle is invalid.";
      startEvent1Timer();
      render();
    }
  };
  document.querySelectorAll("[data-next]").forEach(button => button.onclick = () => setStage(button.dataset.next));
  document.querySelectorAll("[data-manual]").forEach(select => select.onchange = () => {
    manualLabels[select.dataset.manual] = select.value;
    manualStatus = "";
    const progressNode = document.querySelector("#manual-progress");
    if (progressNode) progressNode.textContent = `${Object.values(manualLabels).filter(Boolean).length}/50 answered`;
  });
  const lockManual = document.querySelector("#lock-manual"); if (lockManual) lockManual.onclick = async () => { lockManual.disabled = true; await sealManualRound(); };
  document.querySelectorAll("[data-analysis-type]").forEach(button => button.onclick = () => { analysisType = button.dataset.analysisType; featureStatus = ""; render(); });
  const primary = document.querySelector("#analysis-feature"); if (primary) primary.onchange = () => { analysisFeature = primary.value; if (analysisSecond === analysisFeature) analysisSecond = data.features.find(name => name !== analysisFeature); render(); };
  const second = document.querySelector("#analysis-second"); if (second) second.onchange = () => { analysisSecond = second.value; };
  const analyze = document.querySelector("#run-analysis"); if (analyze) analyze.onclick = async () => { analyze.disabled = true; try { if (!analysisCatalog.some(item => item[0] === analysisType)) analysisType = "classprofiles"; const result = await request("/api/analyze", { room: session.room, player: session.player, type: analysisType, feature: analysisFeature, secondFeature: analysisSecond, analysisState }); analysisState = result.analysisState; analysisCredits = result.creditsRemaining; const key = `${analysisType}:${analysisFeature}:${analysisSecond}`; findings = [{ key, result: result.result }, ...findings.filter(item => item.key !== key)]; featureStatus = result.replayed ? "Evidence reopened; no credits charged." : `${result.cost} credits spent. ${result.creditsRemaining} remain.`; render(); } catch (error) { featureStatus = error.message; render(); } };
  document.querySelectorAll("[data-feature]").forEach(button => button.onclick = () => { const name = button.dataset.feature; if (selectedFeatures.has(name)) selectedFeatures.delete(name); else if (selectedFeatures.size < 10) selectedFeatures.add(name); render(); });
  const lockFeatures = document.querySelector("#lock-features"); if (lockFeatures) lockFeatures.onclick = async () => { lockFeatures.disabled = true; await sealFeatureRound(); };
  const emergency = document.querySelector("#toggle-emergency"); if (emergency) emergency.onclick = () => { if (emergencyFeed) return; if (event4CreditsRemaining() < EMERGENCY_REPAIR_COST) { qualityStatus = `The Emergency Feed costs ${EMERGENCY_REPAIR_COST} credits, but only ${event4CreditsRemaining()} Event 4 credits remain.`; render(); return; } if (window.confirm(`The Emergency Feed will spend ${EMERGENCY_REPAIR_COST} Event 4 credits. Continue?`)) { emergencyFeed = true; preparedDatasets = null; qualityStatus = `Emergency feed selected. The prepared train/test datasets will now be rebuilt from the backup feed.`; render(); } };
  document.querySelectorAll("[data-repair-kind]").forEach(button => button.onclick = () => toggleRepair(button.dataset.repairKind, button.dataset.repairId));
  document.querySelectorAll("[data-repair-method]").forEach(select => select.onchange = () => { repairMethods[select.dataset.repairMethod][select.dataset.repairId] = select.value; preparedDatasets = null; checkpoint(); render(); });
  document.querySelectorAll("[data-model]").forEach(button => button.onclick = () => { model = button.dataset.model; hyperparameters[model] ||= Object.fromEntries(Object.entries(modelCatalog[model].parameters).map(([name, options]) => [name, [options[0][0]]])); kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  document.querySelectorAll("[data-hyperparameter]").forEach(select => select.onchange = () => { const options = modelCatalog[model].parameters[select.dataset.hyperparameter]; const values = [...select.selectedOptions].map(option => option.value === "__null__" ? null : option.value).map(value => options.find(([candidate]) => String(candidate) === String(value))?.[0] ?? value); hyperparameters[model] = { ...(hyperparameters[model] || {}), [select.dataset.hyperparameter]: values.length ? values : [options[0][0]] }; kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const tuningTrials = document.querySelector("#tuning-trials"), tuningFolds = document.querySelector("#tuning-folds"), tuningSeed = document.querySelector("#tuning-seed");
  [tuningTrials, tuningFolds, tuningSeed].filter(Boolean).forEach(input => input.onchange = () => { tuning = normalizeTuning({ trials: tuningTrials.value, folds: tuningFolds.value, randomState: tuningSeed.value }); kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const generateKaggle = document.querySelector("#generate-kaggle"); if (generateKaggle) generateKaggle.onclick = async () => { if (forecastLocked) { forecastStatus = "The combined handoff timer has expired. Notebook generation is locked."; render(); return; } const parameters = hyperparameters[model] || Object.fromEntries(Object.entries(modelCatalog[model].parameters).map(([name, options]) => [name, [options[0][0]]])); const parameterCost = Object.entries(modelCatalog[model].parameters).reduce((sum, [name, options]) => sum + options.filter(([value]) => (Array.isArray(parameters[name]) ? parameters[name] : [parameters[name]]).some(candidate => String(candidate) === String(value))).reduce((subtotal, [, cost]) => subtotal + cost, 0), 0); const runCost = 1 + parameterCost; if (event4CreditsRemaining() < runCost) { forecastStatus = `That run costs ${runCost} credits; ${event4CreditsRemaining()} Event 4 credits remain.`; render(); return; } generateKaggle.disabled = true; try { const currentQuality = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, emergencyFeed, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), missingMethods: repairMethods.missing, outlierMethods: repairMethods.outlier }); qualityState = currentQuality.qualityState; preparedDatasets = await request("/api/dataset", { room: session.room, player: session.player, stage: "quality", qualityState, includeContent: true }); tuning = normalizeTuning({ ...tuning, hyperparameters: parameters }); kaggleScript = buildKaggleScript({ model, features: currentQuality.features, trainFile: preparedDatasets.trainFilename, testFile: preparedDatasets.testFilename, tuning: { ...tuning, hyperparameters: parameters }, notebook: true }); forecastRuns = [{ model, cost: runCost, parameters, createdAt: Date.now() }, ...forecastRuns]; downloadText(kaggleFilename(model, "ipynb"), kaggleScript, "application/x-ipynb+json"); qualityResult = null; forecastStatus = `${kaggleFilename(model, "ipynb")} downloaded. Your prepared train/test CSVs are ready below; the notebook contains no feature filtering or repair logic.`; checkpoint(); render(); } catch (error) { forecastStatus = error.message; render(); } };
  const trainReady = document.querySelector("#download-train-ready"); if (trainReady && preparedDatasets?.trainCsv) trainReady.onclick = () => downloadText(preparedDatasets.trainFilename, preparedDatasets.trainCsv, "text/csv;charset=utf-8");
  const testReady = document.querySelector("#download-test-ready"); if (testReady && preparedDatasets?.testCsv) testReady.onclick = () => downloadText(preparedDatasets.testFilename, preparedDatasets.testCsv, "text/csv;charset=utf-8");
  const submitEvent4Button = document.querySelector("#submit-event4"); if (submitEvent4Button) submitEvent4Button.onclick = async () => { submitEvent4Button.disabled = true; try { await submitEvent4(); } catch (error) { forecastStatus = error.message; render(); } };
}

download.onclick = () => { if (!kaggleScript) return; try { JSON.parse(kaggleScript); const url = URL.createObjectURL(new Blob([kaggleScript], { type: "application/x-ipynb+json" })), link = document.createElement("a"); link.href = url; link.download = kaggleFilename(model, "ipynb"); link.click(); URL.revokeObjectURL(url); } catch { forecastStatus = "The generated notebook JSON is invalid and was not downloaded."; render(); } };
  document.querySelectorAll("[data-stage]").forEach(button => button.onclick = () => setStage(button.dataset.stage));
window.addEventListener("beforeunload", () => checkpoint());
setInterval(() => checkpoint(), 5000);
Promise.all([request("/api/mission", session), request("/api/room", { action: "get", pin: session.room, player: session.player })]).then(([result, roomResult]) => {
  data = result; analysisFeature = data.features[0]; analysisSecond = data.features[1]; hydrate(roomResult.room);
  statusText.textContent = `${result.mission.scope.toUpperCase()} · ROOM ${session.room} · ${result.recordCounts.trainingDelivered} TRAIN / ${result.recordCounts.finalTest} TEST`;
  render();
  if (stage === "event1") startEvent1Timer();
  else if (stage === "manual") startManualTimer();
  else if (stage === "features") startFeatureTimer();
  else if (stage === "quality") startQualityTimer();
  else startForecastTimer();
  setInterval(pollRoomControl, 5000);
}).catch(error => box.innerHTML = `<div class="error-box">CLEARWAY console could not open: ${esc(error.message)}</div>`);
