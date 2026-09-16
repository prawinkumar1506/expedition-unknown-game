import { buildKaggleScript, kaggleFilename, normalizeTuning } from "/kaggle-export.js";

const session = JSON.parse(sessionStorage.getItem("expedition-session") || "null");
if (!session) window.location.replace("/");

const box = document.querySelector("#workspace"), download = document.querySelector("#export"), statusText = document.querySelector("#mission-status");
const featureCredit = document.querySelector("#f-credit"), repairCredit = document.querySelector("#r-credit"), evaluationCredit = document.querySelector("#e-credit");
const stageOrder = ["event1", "manual", "features", "quality", "forecast"];
const analysisCatalog = [
  ["stats", "Basic channel statistics", 1, "Mean, median, deviation, range and missing percentage."],
  ["missing", "Missing-value analysis", 1, "Null count and affected training records."],
  ["classwise", "Class-wise distribution", 2, "Compare one channel across all five traffic classes."],
  ["correlation", "Correlation analysis", 2, "Inspect redundancy across all sixteen channels."],
  ["relationship", "Channel relationship view", 2, "Compare two channels across five value bands."]
];
const models = [
  ["Decision Tree", "Tune depth, split, leaf, criterion, and class weighting."],
  ["Logistic Regression", "Tune regularization, solver, and class weighting."],
  ["K-Nearest Neighbors", "Tune neighborhood size, distance rule, and metric."],
  ["Random Forest", "Tune tree count, depth, split, features, and weighting."],
  ["Support Vector Machine", "Tune C, RBF gamma, and class weighting."]
];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const request = async (path, body) => { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error), { result }); return result; };

let data, stage = "event1", highestStage = 0;
let manualLabels = {}, manualLocked = false, manualState = "", manualResult = null, manualStatus = "";
let manualTimeSpentSec = 0, manualTimerId = null, manualTimerStart = 0;
let event1Result = null, event1Status = "", event1TimeSpentSec = 0, event1TimerId = null, event1TimerStart = 0, event1Selections = [];
let selectedFeatures = new Set(), analysisType = "stats", analysisFeature = "", analysisSecond = "", analysisState = "", analysisCredits = 10, findings = [], featureState = "", featureResult = null, featureStatus = "";
let featureTimeSpentSec = 0, featureTimerId = null, featureTimerStart = 0;
let qualityPlan = null, repairs = { missingColumns: new Set(), outlierColumns: new Set(), labelRecords: new Set(), duplicateGroups: new Set() }, emergencyFeed = false, qualityState = "", qualityResult = null, qualityStatus = "";
let qualityTimeSpentSec = 0, qualityTimerId = null, qualityTimerStart = 0;
let model = "Decision Tree", tuning = normalizeTuning(), kaggleScript = "", forecastStatus = "", forecastLocked = false;
let forecastTimeSpentSec = 0, forecastTimerId = null, forecastTimerStart = 0;
let roomControl = { stageUnlocks: { global: ["event1"], players: {} } }, checkpointTimer = null;
const FEATURE_TIMEOUT_SECONDS = 30 * 60;
const QUALITY_TIMEOUT_SECONDS = 20 * 60;
const EVENT1_TIMEOUT_SECONDS = 15 * 60;
const FORECAST_TIMEOUT_SECONDS = 40 * 60;
const stageStorageKey = `clearway-progress:${session?.room || "unknown"}:${session?.player || "unknown"}`;
const stageIsUnlocked = name => roomControl.stageUnlocks?.global?.includes(name) || roomControl.stageUnlocks?.players?.[session.player]?.includes(name);
const serializeState = () => ({ stage, highestStage, stageStartedAt: { event1: event1TimerStart, manual: manualTimerStart, features: featureTimerStart, quality: qualityTimerStart, forecast: forecastTimerStart }, manualLabels, manualLocked, manualState, manualResult, event1Result, event1Selections, analysisState, analysisCredits, findings, selectedFeatures: [...selectedFeatures], featureState, featureResult, qualityPlan, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), emergencyFeed, qualityState, qualityResult, model, tuning, kaggleScript, forecastStatus, forecastLocked });
const applyState = saved => {
  if (!saved || typeof saved !== "object") return;
  stage = saved.stage || stage; highestStage = Number(saved.highestStage || 0); manualLabels = saved.manualLabels || {}; manualLocked = Boolean(saved.manualLocked); manualState = saved.manualState || ""; manualResult = saved.manualResult || null; event1Result = saved.event1Result || null; event1Selections = saved.event1Selections || [];
  analysisState = saved.analysisState || ""; analysisCredits = Number(saved.analysisCredits ?? 10); findings = saved.findings || []; selectedFeatures = new Set(saved.selectedFeatures || []); featureState = saved.featureState || ""; featureResult = saved.featureResult || null; qualityPlan = saved.qualityPlan || null;
  repairs = { missingColumns: new Set(saved.repairs?.missingColumns || []), outlierColumns: new Set(saved.repairs?.outlierColumns || []), labelRecords: new Set(saved.repairs?.labelRecords || []), duplicateGroups: new Set(saved.repairs?.duplicateGroups || []) };
  emergencyFeed = Boolean(saved.emergencyFeed); qualityState = saved.qualityState || ""; qualityResult = saved.qualityResult || null; model = saved.model || model; tuning = saved.tuning || tuning; kaggleScript = saved.kaggleScript || ""; forecastStatus = saved.forecastStatus || ""; forecastLocked = Boolean(saved.forecastLocked);
  const starts = saved.stageStartedAt || {}; event1TimerStart = Number(starts.event1 || 0); manualTimerStart = Number(starts.manual || 0); featureTimerStart = Number(starts.features || 0); qualityTimerStart = Number(starts.quality || 0); forecastTimerStart = Number(starts.forecast || 0);
};
const checkpoint = () => {
  const progress = serializeState();
  localStorage.setItem(stageStorageKey, JSON.stringify(progress));
  clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => request("/api/room", { action: "saveProgress", room: session.room, player: session.player, progress }).catch(() => {}), 250);
};
const hydrate = room => {
  roomControl = room || roomControl;
  const serverState = room?.progress?.[session.player];
  const localState = JSON.parse(localStorage.getItem(stageStorageKey) || "null");
  applyState(serverState || localState);
  if (!stageIsUnlocked(stage)) stage = stageOrder.find(name => stageIsUnlocked(name)) || "event1";
  checkpoint();
};
const pollRoomControl = async () => { try { const result = await request("/api/room", { action: "get", pin: session.room }); roomControl = result.room; if (!stageIsUnlocked(stage)) render(); } catch {} };
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

const saveEvent1Result = result => {
  const storageKey = "clearway-event1-scores";
  const roomScores = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const roomKey = session.room;
  const teamScores = Array.isArray(roomScores[roomKey]) ? roomScores[roomKey] : [];
  const index = teamScores.findIndex(item => item.player === session.player);
  const payload = {
    player: session.player,
    passed: Boolean(result.passed),
    status: result.status || (result.passed ? "completed" : "failed"),
    timeTakenSeconds: Number(result.timeTakenSeconds || event1TimeSpentSec),
    submittedAt: Date.now()
  };
  if (index >= 0) teamScores[index] = payload; else teamScores.push(payload);
  roomScores[roomKey] = teamScores;
  localStorage.setItem(storageKey, JSON.stringify(roomScores));
  window.dispatchEvent(new CustomEvent("clearway-event1-score", { detail: { room: roomKey, payload } }));
};

const saveEvent2Result = result => {
  const storageKey = "clearway-event2-scores";
  const roomScores = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const roomKey = session.room;
  const teamScores = Array.isArray(roomScores[roomKey]) ? roomScores[roomKey] : [];
  const index = teamScores.findIndex(item => item.player === session.player);
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
  if (index >= 0) teamScores[index] = payload; else teamScores.push(payload);
  roomScores[roomKey] = teamScores;
  localStorage.setItem(storageKey, JSON.stringify(roomScores));
  window.dispatchEvent(new CustomEvent("clearway-event2-score", { detail: { room: roomKey, payload } }));
};

const saveFeatureResult = result => {
  const storageKey = "clearway-feature-scores";
  const roomScores = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const roomKey = session.room;
  const teamScores = Array.isArray(roomScores[roomKey]) ? roomScores[roomKey] : [];
  const index = teamScores.findIndex(item => item.player === session.player);
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
  if (index >= 0) teamScores[index] = payload; else teamScores.push(payload);
  roomScores[roomKey] = teamScores;
  localStorage.setItem(storageKey, JSON.stringify(roomScores));
  window.dispatchEvent(new CustomEvent("clearway-feature-score", { detail: { room: roomKey, payload } }));
};

const saveQualityResult = result => {
  const storageKey = "clearway-quality-scores";
  const roomScores = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const roomKey = session.room;
  const teamScores = Array.isArray(roomScores[roomKey]) ? roomScores[roomKey] : [];
  const index = teamScores.findIndex(item => item.player === session.player);
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
    submittedAt: Date.now()
  };
  if (index >= 0) teamScores[index] = payload; else teamScores.push(payload);
  roomScores[roomKey] = teamScores;
  localStorage.setItem(storageKey, JSON.stringify(roomScores));
  window.dispatchEvent(new CustomEvent("clearway-quality-score", { detail: { room: roomKey, payload } }));
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
    saveEvent2Result(manualResult);
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
    if (event1TimeSpentSec % 5 === 0) checkpoint();
    if (event1TimeSpentSec >= EVENT1_TIMEOUT_SECONDS) {
      clearInterval(event1TimerId);
      if (!event1Result) {
        event1Result = { passed: false, status: "failed", timeTakenSeconds: EVENT1_TIMEOUT_SECONDS };
        event1Status = "15 minutes expired. Archive reconstruction failed. Event 2 opened with the supplied training data.";
        saveEvent1Result(event1Result);
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
    if (qualityTimeSpentSec % 5 === 0) checkpoint();
    if (qualityTimeSpentSec >= QUALITY_TIMEOUT_SECONDS) {
      clearInterval(qualityTimerId);
      if (!qualityResult) {
        qualityStatus = "Quality Lab timed out. The current repair plan was sealed automatically.";
        sealQualityRound();
      }
      return;
    }
    if (stage === "quality") {
      const timerNode = document.querySelector("#quality-timer-value");
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

const featureName = name => data?.featureMeta?.[name]?.label || String(name).replaceAll("_", " ");
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const sectionIntro = (event, title, subtitle, beats) => `<section class="story-brief"><span>EVENT ${event} · ${esc(title.toUpperCase())}</span><h1>${esc(title.split(" ")[0])} <i>${esc(title.split(" ").slice(1).join(" "))}</i></h1><p>${esc(subtitle)}</p><div class="story-beats">${beats.map((beat, index) => `<span class="${index < stageOrder.indexOf(stage) ? "done" : index === stageOrder.indexOf(stage) ? "active" : ""}">${esc(beat)}</span>`).join("")}</div></section>`;

function setStage(next) {
  const index = stageOrder.indexOf(next); if (index < 0 || index > highestStage || !stageIsUnlocked(next)) return;
  [event1TimerId, manualTimerId, featureTimerId, qualityTimerId, forecastTimerId].forEach(timerId => { if (timerId) clearInterval(timerId); });
  event1TimerId = manualTimerId = featureTimerId = qualityTimerId = forecastTimerId = null;
  stage = next; if (stage === "event1" && !event1Result) event1TimerStart = event1TimerStart || Date.now(); if (stage === "manual" && !manualResult) manualTimerStart = manualTimerStart || Date.now(); if (stage === "features" && !featureResult) featureTimerStart = featureTimerStart || Date.now(); if (stage === "quality" && !qualityResult) qualityTimerStart = qualityTimerStart || Date.now(); if (stage === "forecast") forecastTimerStart = forecastTimerStart || Date.now(); checkpoint(); render(); if (stage === "event1") startEvent1Timer(); if (stage === "manual") startManualTimer(); if (stage === "features") startFeatureTimer(); if (stage === "quality") startQualityTimer(); if (stage === "forecast") startForecastTimer(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function updateChrome() {
  featureCredit.textContent = `${analysisCredits} / 10`;
  const spent = repairSpend(); repairCredit.textContent = `${Math.max(0, 15 - spent)} / 15`;
  evaluationCredit.textContent = `${tuning.trials} trials`;
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
  return `${sectionIntro("1", "Archive Reconstruction", "When the Surge hit CLEARWAY at 03:14, it did not just knock the classifier offline — it interrupted the streams writing to the archive at that exact moment. What sits on the recovery drive now is a broken patchwork of fragments, stale copies, and discarded exports from other systems that happened to share the same backup drive.", ["Archive Reconstruction", "Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>TARGET SITE</small><b>JTU-7</b></div><div><small>WINDOW</small><b>03:14–09:14</b></div><div><small>FINAL SYNC</small><b>generation 3</b></div><div><small>LEFTOVER FRAGMENTS</small><b>old + stray</b></div><div><small>TIMER</small><b id="event1-timer-value">${formatEvent1Countdown()}</b></div></section>
    <section class="card"><div class="panel-title">Recovered archive bundle <span>Pull together the fragments that belong to the final JTU-7 recovery window</span></div>
      <div class="selection-board">
        <div class="panel-title">Available recovery fragments <span>${event1Selections.length}/3 selected</span></div>
        <div class="pick-grid">${archiveCandidates.map(name => `<button class="pick feature ${event1Selections.includes(name) ? "chosen" : ""}" data-event1-choice="${name}" type="button"><b>${event1Selections.includes(name) ? "✓" : "+"}</b><span class="pick-text"><strong class="pick-name">${esc(name)}</strong><small>recovery fragment</small></span></button>`).join("")}</div>
      </div>
      <div class="analysis-status">${esc(event1Status || "Choose the three fragments that belong to the final JTU-7 gen3 bundle. No upload box is required; the archive is already staged in the project folder and it must be reconstructed from the valid names alone.")}</div>
      <div class="stage-actions"><button id="event1-submit" class="btn btn--primary" ${event1Selections.length !== 3 ? "disabled" : ""}>Submit archive</button></div>
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
  if (result.kind === "stats") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>basic statistics</span></header><div class="metric-grid">${["mean", "median", "stdDev", "min", "max"].map(key => `<div><small>${key}</small><strong>${number(result.summary[key])}</strong></div>`).join("")}</div></article>`;
  if (result.kind === "missing") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>missing values</span></header><div class="finding-callout"><strong>${result.missingCount}</strong><span>missing cells · ${result.missingPct}% of ${result.recordCount || 2030} delivered rows</span></div></article>`;
  if (result.kind === "classwise") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>class-wise distribution</span></header><table class="analysis-table"><thead><tr><th>Class</th><th>Mean</th><th>Std dev</th><th>Missing</th></tr></thead><tbody>${result.classes.map(row => `<tr><th>${esc(row.label)}</th><td>${number(row.mean)}</td><td>${number(row.stdDev)}</td><td>${row.missingCount}</td></tr>`).join("")}</tbody></table></article>`;
  if (result.kind === "correlation") return `<article class="finding"><header><b>All 16 channels</b><span>correlation matrix</span></header><div class="matrix-scroll"><table class="matrix-table"><thead><tr><th></th>${result.features.map(name => `<th>${esc(featureName(name))}</th>`).join("")}</tr></thead><tbody>${result.features.map((name, i) => `<tr><th>${esc(featureName(name))}</th>${result.matrix[i].map(value => `<td>${number(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></article>`;
  return `<article class="finding"><header><b>${esc(featureName(result.feature))} × ${esc(featureName(result.secondFeature))}</b><span>relationship</span></header><div class="relationship-score">Pearson correlation <strong>${number(result.coefficient)}</strong></div><div class="bin-chart">${result.bins.map(bin => `<div><span>${number(bin.from)}–${number(bin.to)}</span><i><em style="width:${Math.min(100, Math.abs(bin.mean || 0))}%"></em></i><b>${number(bin.mean)}</b></div>`).join("")}</div></article>`;
}

function renderFeatures() {
  const config = analysisCatalog.find(item => item[0] === analysisType), global = analysisType === "correlation", pair = analysisType === "relationship", nextStageOpen = stageIsUnlocked("quality");
  return `${sectionIntro("3", "Feature Hunt", "Sixteen telemetry channels survived the Surge, but Central has only ten seats. Spend investigation credits, then lock exactly ten channels. That choice cannot be reopened.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>CANDIDATE CHANNELS</small><b>16</b></div><div><small>LOCKED INPUTS</small><b>Exactly 10</b></div><div><small>INVESTIGATION POOL</small><b>${analysisCredits}/10 credits</b></div><div><small>TRAIN ARCHIVE</small><b>2,030 damaged rows</b></div><div><small>TIMER</small><b id="feature-timer-value">${formatFeatureCountdown()}</b></div></section>
    <div class="investigation-shell"><aside class="tool-catalog"><div class="panel-title">Investigation menu <span>10-credit pool</span></div>${analysisCatalog.map(item => `<button data-analysis-type="${item[0]}" class="${analysisType === item[0] ? "active" : ""}" ${featureResult ? "disabled" : ""}><span><b>${esc(item[1])}</b><small>${esc(item[3])}</small></span><strong>${item[2]} CR</strong></button>`).join("")}</aside>
      <section class="evidence-console"><div class="panel-title">Analysis console <span>${esc(config[1])}</span></div><div class="analysis-config"><div><span>SELECTED TOOL</span><b>${esc(config[1])}</b><p>${esc(config[3])}</p></div>${global ? "" : `<label>Primary channel<select id="analysis-feature">${data.features.map(name => `<option value="${name}" ${analysisFeature === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>`}${pair ? `<label>Comparison channel<select id="analysis-second">${data.features.filter(name => name !== analysisFeature).map(name => `<option value="${name}" ${analysisSecond === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>` : ""}<button id="run-analysis" class="btn btn--primary" ${featureResult || analysisCredits < config[2] ? "disabled" : ""}>Run · ${config[2]} credits</button></div><div class="analysis-status">${esc(featureStatus || "Purchased evidence can be reopened without spending again.")}</div><div class="findings">${findings.length ? findings.map(findingHtml).join("") : `<div class="empty-finding"><b>NO INVESTIGATION PURCHASED</b><span>Choose a tool and spend credits to reveal evidence.</span></div>`}</div></section></div>
    <section class="selection-board"><div class="panel-title">Ten-channel lock <span>${selectedFeatures.size}/10 selected</span></div><div class="pick-grid">${data.features.map(name => `<button class="pick feature ${selectedFeatures.has(name) ? "chosen" : ""}" data-feature="${name}" ${featureResult ? "disabled" : ""}><b>${selectedFeatures.has(name) ? "✓" : "+"}</b><span>${esc(featureName(name))}<small>${esc(data.featureMeta[name].family)} channel</small></span></button>`).join("")}</div>${featureResult ? `<div class="feature-score"><strong>${featureResult.score}</strong><span>EVENT 3 SCORE</span><div><small>High-value seats</small><b>${featureResult.strongCount}/10</b></div><div><small>Credits spent</small><b>${featureResult.spent}/10</b></div></div><div class="stage-actions"><span class="recovery-message success">${esc(featureResult.message)}</span><button class="btn btn--primary" data-next="quality" ${nextStageOpen ? "" : "disabled"}>→ ${nextStageOpen ? "Open Event 4" : "Waiting for host to open Event 4"}</button></div>` : `<div class="feature-lock"><span>${esc(featureStatus || "Investigate first, then commit up to ten channels. Missing channels are completed with a penalty.")}</span><b>${selectedFeatures.size}/10</b><button id="lock-features" class="btn btn--primary">Lock selection</button></div>`}</section>`;
}

const sealFeatureRound = async () => {
  if (featureResult) return;
  try {
    featureResult = await request("/api/features", { room: session.room, player: session.player, features: [...selectedFeatures], analysisState });
    featureState = featureResult.featureState;
    featureStatus = featureResult.message;
    saveFeatureResult(featureResult);
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
      timeTakenSeconds: qualityTimeSpentSec
    });
    qualityState = qualityResult.qualityState;
    qualityStatus = qualityResult.message;
    saveQualityResult(qualityResult);
    highestStage = Math.max(highestStage, 4);
    if (stage === "quality") {
      setStage("forecast");
    } else {
      render();
    }
  } catch (error) {
    qualityStatus = error.message;
    render();
  }
};

const repairSpend = () => qualityPlan ? repairs.missingColumns.size * qualityPlan.costs.missing + repairs.outlierColumns.size * qualityPlan.costs.outlier + repairs.labelRecords.size * qualityPlan.costs.label + repairs.duplicateGroups.size * qualityPlan.costs.duplicate : 0;
function repairCards(kind, items) {
  const key = { missing: "missingColumns", outlier: "outlierColumns", label: "labelRecords", duplicate: "duplicateGroups" }[kind], set = repairs[key], cost = qualityPlan.costs[kind];
  return items.map(item => { const id = item.feature || item.eventId || item.duplicateId, selected = set.has(id), detail = item.issueCount ? `${item.issueCount} logged faults` : item.observedLabel ? `Observed: ${item.observedLabel}` : `${item.kind.replaceAll("_", " ")} of ${item.sourceId}`; return `<button class="repair-case ${selected ? "selected" : ""}" data-repair-kind="${kind}" data-repair-id="${id}" ${qualityResult || emergencyFeed ? "disabled" : ""}><div class="repair-case-head"><div><span class="eyebrow">${kind.toUpperCase()}</span><h3>${esc(item.feature ? featureName(item.feature) : id)}</h3></div><span class="repair-cost">${cost} CR</span></div><div class="repair-evidence"><div><small>EVIDENCE</small><p>${esc(detail)}</p></div></div></button>`; }).join("");
}
function renderQuality() {
  if (!qualityPlan) return `${sectionIntro("4", "Data Quality Lab", "The feature lock is closed. Loading only the damaged records that affect your ten selected channels.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}<section class="card"><div class="loading"><i></i>SCANNING TRAINING ARCHIVE…</div></section>`;
  const spent = repairSpend();
  const emergencyEligible = featureResult?.strongCount <= 4;
  return `${sectionIntro("4", "Data Quality Lab", "The 2,030-row training archive contains missing cells, impossible readings, wrong labels, and retry duplicates. Spend at most 15 repair credits; the system controls how each chosen repair is applied.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>REPAIR POOL</small><b>${15 - spent}/15 credits</b></div><div><small>MISSING VALUES</small><b>3 credits/column · max 3</b></div><div><small>OUTLIERS</small><b>3 credits/column · max 2</b></div><div><small>RECORD REPAIRS</small><b>Labels 1 · duplicates 2</b></div></section>
    <section class="card emergency-feed ${emergencyFeed ? "selected" : ""}"><div class="panel-title">Emergency Telemetry Feed <span>Irreversible after sealing</span></div><div class="emergency-body"><div><span class="eyebrow">BACKUP RECOVERY PATH</span><h3>Available only after a failed Feature Hunt lock.</h3><p>${emergencyEligible ? "Your lock has 4 or fewer strong channels. Swap both train and test to the clean fixed 10-channel feed, forfeit Event 3, receive only 35/100 for Event 4, and cap the final-model score at 70/100. It can keep you in the game, not put you on top." : `Your ${featureResult?.strongCount ?? 0}/10 strong-channel lock is still competitive. The backup route unlocks only at 4 or fewer strong channels.`}</p></div><button id="toggle-emergency" class="btn ${emergencyFeed ? "btn--primary" : "btn--ghost"}" ${qualityResult || !emergencyEligible ? "disabled" : ""}>${emergencyFeed ? "Emergency feed selected" : "Select emergency feed"}</button></div></section>
    <section class="card"><div class="panel-title">Missing values <span>${repairs.missingColumns.size}/3 columns selected</span></div><div class="repair-grid">${repairCards("missing", qualityPlan.missingColumns)}</div></section>
    <section class="card"><div class="panel-title">Impossible outliers <span>${repairs.outlierColumns.size}/2 columns selected</span></div><div class="repair-grid">${repairCards("outlier", qualityPlan.outlierColumns)}</div></section>
    <section class="card"><div class="panel-title">Suspicious labels <span>${repairs.labelRecords.size}/6 records selected</span></div><div class="repair-grid">${repairCards("label", qualityPlan.labelCandidates)}</div></section>
    <section class="card"><div class="panel-title">Retry duplicates <span>${repairs.duplicateGroups.size}/4 groups selected</span></div><div class="repair-grid">${repairCards("duplicate", qualityPlan.duplicateGroups)}</div><div class="stage-actions"><span class="${qualityResult ? "recovery-message success" : "recovery-message"}">${esc(qualityStatus || `${spent}/15 credits committed. Repairs apply only after this event is sealed.`)}</span>${qualityResult ? `<button class="btn btn--primary" data-next="forecast">Open Event 5</button>` : `<button id="seal-quality" class="btn btn--primary">Seal Event 4 plan</button>`}</div></section>`;
}

function renderForecast() {
  const outputNames = "submission.csv · randomized_search_results.csv · best_model_evaluation.json";
  return `${sectionIntro("5", "Notebook Model Handoff", "The app seals your decisions but does not train in production. Configure tuning here, then download the generated notebook. It runs RandomizedSearchCV, evaluates the selected best configuration, and writes a local submission file.", ["Manual Override", "Feature Hunt", "Quality Lab", "Notebook handoff"])}
    <section class="incident-ribbon"><div><small>FINAL TEST FEED</small><b>500 clean unseen rows</b></div><div><small>SEARCH METHOD</small><b>RandomizedSearchCV</b></div><div><small>PRIMARY METRIC</small><b>Macro F1</b></div><div><small>OUTPUTS</small><b>1 notebook + submission.csv</b></div></section>
    <section class="card"><div class="panel-title">Model choice <span>One real scikit-learn pipeline per notebook run</span></div><div class="model-grid">${models.map(item => `<button class="model ${model === item[0] ? "selected" : ""}" data-model="${item[0]}"><span>RANDOMIZED SEARCH</span><b>${esc(item[0])}</b><i class="protocol-name">IMPUTE · SCALE · TUNE</i><small>${esc(item[1])}</small></button>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Hyperparameter tuning brief <span>These settings are embedded in the notebook</span></div><div class="analysis-config"><label>Random-search trials<input id="tuning-trials" type="number" min="5" max="100" value="${tuning.trials}"></label><label>Stratified CV folds<input id="tuning-folds" type="number" min="3" max="10" value="${tuning.folds}"></label><label>Random seed<input id="tuning-seed" type="number" min="0" max="999999" value="${tuning.randomState}"></label><div class="timer-strip"><small>Handoff window</small><strong id="forecast-timer-value">${formatForecastCountdown()}</strong></div><button class="btn btn--ghost" type="button" ${forecastLocked ? "disabled" : ""}>${forecastLocked ? "Notebook locked" : "Notebook ready"}</button></div><div class="analysis-status">Each model has a different search space, and the notebook updates its optimizer accordingly for the selected estimator. The tuning settings are per-model and are not globally fixed to a tiny grid.</div></section>
    <section class="card"><div class="panel-title">Notebook delivery <span>Download the ready-to-run local notebook</span></div><div class="stage-actions"><span class="${kaggleScript ? "recovery-message success" : "recovery-message"}">${esc(forecastStatus || (forecastLocked ? "The 40-minute handoff window has expired. Notebook generation is locked." : `The generated notebook will save ${outputNames}. It runs locally and writes a submission.csv without changing the source CSV files.`))}</span><button id="generate-kaggle" class="btn btn--primary" ${forecastLocked ? "disabled" : ""}>${forecastLocked ? "Generation locked" : "Generate Notebook"}</button>${kaggleScript ? `<button id="copy-kaggle" class="btn btn--ghost">Copy notebook JSON</button>` : ""}</div>${kaggleScript ? `<pre class="analysis-status" style="margin:12px 0 0;white-space:pre-wrap;max-height:260px;overflow:auto">${esc(kaggleScript)}</pre>` : ""}</section>`;
}

function render() {
  updateChrome();
  box.innerHTML = stage === "event1" ? renderEvent1() : stage === "manual" ? renderManual() : stage === "features" ? renderFeatures() : stage === "quality" ? renderQuality() : renderForecast();
  bind();
}

function toggleRepair(kind, id) {
  const key = { missing: "missingColumns", outlier: "outlierColumns", label: "labelRecords", duplicate: "duplicateGroups" }[kind], set = repairs[key], limit = qualityPlan.limits[kind], cost = qualityPlan.costs[kind];
  if (set.has(id)) set.delete(id);
  else if (set.size < limit && repairSpend() + cost <= qualityPlan.budget) set.add(id);
  else qualityStatus = set.size >= limit ? `That repair type is limited to ${limit} selections.` : `The repair would exceed the 15-credit budget.`;
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
    try {
      const result = await request("/api/recovery", { room: session.room, player: session.player, files: names, timeTakenSeconds: event1TimeSpentSec });
      event1Result = { passed: Boolean(result.passed), status: result.status || "completed", timeTakenSeconds: Number(result.timeTakenSeconds || event1TimeSpentSec) };
      event1Status = result.message || "Archive reconstructed successfully. The final JTU-7 gen3 bundle was verified.";
      saveEvent1Result(event1Result);
      highestStage = Math.max(highestStage, 1);
      setStage("manual");
    } catch (error) {
      event1Status = error.message || "The archive bundle is invalid.";
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
  const analyze = document.querySelector("#run-analysis"); if (analyze) analyze.onclick = async () => { analyze.disabled = true; try { const result = await request("/api/analyze", { room: session.room, player: session.player, type: analysisType, feature: analysisFeature, secondFeature: analysisSecond, analysisState }); analysisState = result.analysisState; analysisCredits = result.creditsRemaining; const key = `${analysisType}:${analysisFeature}:${analysisSecond}`; findings = [{ key, result: result.result }, ...findings.filter(item => item.key !== key)]; featureStatus = result.replayed ? "Evidence reopened; no credits charged." : `${result.cost} credits spent. ${result.creditsRemaining} remain.`; render(); } catch (error) { featureStatus = error.message; render(); } };
  document.querySelectorAll("[data-feature]").forEach(button => button.onclick = () => { const name = button.dataset.feature; if (selectedFeatures.has(name)) selectedFeatures.delete(name); else if (selectedFeatures.size < 10) selectedFeatures.add(name); render(); });
  const lockFeatures = document.querySelector("#lock-features"); if (lockFeatures) lockFeatures.onclick = async () => { lockFeatures.disabled = true; await sealFeatureRound(); };
  const emergency = document.querySelector("#toggle-emergency"); if (emergency) emergency.onclick = () => { emergencyFeed = !emergencyFeed; qualityStatus = emergencyFeed ? "Emergency feed staged. Seal the event to make the swap irreversible." : "Emergency feed deselected."; render(); };
  document.querySelectorAll("[data-repair-kind]").forEach(button => button.onclick = () => toggleRepair(button.dataset.repairKind, button.dataset.repairId));
  const sealQuality = document.querySelector("#seal-quality"); if (sealQuality) sealQuality.onclick = async () => { sealQuality.disabled = true; try { qualityResult = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, emergencyFeed, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])) }); qualityState = qualityResult.qualityState; qualityStatus = qualityResult.message; saveQualityResult(qualityResult); highestStage = Math.max(highestStage, 4); render(); } catch (error) { qualityStatus = error.message; render(); } };
  document.querySelectorAll("[data-model]").forEach(button => button.onclick = () => { model = button.dataset.model; kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const tuningTrials = document.querySelector("#tuning-trials"), tuningFolds = document.querySelector("#tuning-folds"), tuningSeed = document.querySelector("#tuning-seed");
  [tuningTrials, tuningFolds, tuningSeed].filter(Boolean).forEach(input => input.onchange = () => { tuning = normalizeTuning({ trials: tuningTrials.value, folds: tuningFolds.value, randomState: tuningSeed.value }); kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const generateKaggle = document.querySelector("#generate-kaggle"); if (generateKaggle) generateKaggle.onclick = () => { if (forecastLocked) { forecastStatus = "40 minutes elapsed. Notebook generation is locked."; render(); return; } try { const finalRepairs = qualityResult?.emergencyFeed ? {} : Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])); kaggleScript = buildKaggleScript({ model, features: qualityResult?.features || featureResult?.selected, emergencyFeed: Boolean(qualityResult?.emergencyFeed), repairs: finalRepairs, tuning, notebook: true }); download.disabled = false; forecastStatus = `${model} notebook ready. Download the .ipynb file from the top bar.`; render(); } catch (error) { forecastStatus = error.message; render(); } };
  const copyKaggle = document.querySelector("#copy-kaggle"); if (copyKaggle) copyKaggle.onclick = async () => { try { await navigator.clipboard.writeText(kaggleScript); forecastStatus = "Notebook JSON copied to the clipboard."; render(); } catch { forecastStatus = "Clipboard access was blocked. Use the download button in the top bar instead."; render(); } };
}

download.onclick = () => { if (!kaggleScript) return; const url = URL.createObjectURL(new Blob([kaggleScript], { type: "application/x-ipynb+json" })), link = document.createElement("a"); link.href = url; link.download = kaggleFilename(model, "ipynb"); link.click(); URL.revokeObjectURL(url); };
document.querySelectorAll("[data-stage]").forEach(button => button.onclick = () => setStage(button.dataset.stage));
window.addEventListener("beforeunload", () => checkpoint());
setInterval(() => checkpoint(), 5000);
Promise.all([request("/api/mission", session), request("/api/room", { action: "get", pin: session.room })]).then(([result, roomResult]) => {
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
