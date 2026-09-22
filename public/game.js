import { buildKaggleScript, kaggleFilename, normalizeTuning } from "/kaggle-export.js";
import { MODEL_CATALOG as modelCatalog, ROUND4, searchPlan } from "/round4-config.js";

const session = JSON.parse(sessionStorage.getItem("expedition-session") || "null");
if (!session) window.location.replace("/");

const box = document.querySelector("#workspace"), download = document.querySelector("#export"), statusText = document.querySelector("#mission-status");
const featureCredit = document.querySelector("#f-credit"), repairCredit = document.querySelector("#r-credit"), evaluationCredit = document.querySelector("#e-credit"), stageTimers = document.querySelector("#stage-timers");
const stageOrder = ["event1", "manual", "features", "quality"];
const analysisCatalog = [
  ["classprofiles", "Class profiles", 2, "See whether a sensor changes enough across traffic situations to be useful."],
  ["correlation", "Correlation analysis", 2, "Compare two sensors and check whether they may be giving you repeated information."]
];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const request = async (path, body) => { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error), { result }); return result; };

let data, stage = "event1", highestStage = 0;
let manualLabels = {}, manualLocked = false, manualState = "", manualResult = null, manualStatus = "";
let manualTimeSpentSec = 0, manualTimerId = null, manualTimerStart = 0;
let event1Result = null, event1Status = "", event1TimeSpentSec = 0, event1TimerId = null, event1TimerStart = 0, event1Selections = [];
let selectedFeatures = new Set(), analysisType = "classprofiles", analysisFeature = "", analysisSecond = "", analysisState = "", analysisCredits = 10, findings = [], featureState = "", featureResult = null, featureStatus = "";
let featureTimeSpentSec = 0, featureTimerId = null, featureTimerStart = 0;
let qualityPlan = null, repairs = { missingColumns: new Set(), outlierColumns: new Set() }, repairMethods = { missing: {}, outlier: {} }, qualityState = "", qualityResult = null, qualityStatus = "";
let qualityTimeSpentSec = 0, qualityTimerId = null, qualityTimerStart = 0;
let model = "Random Forest", tuning = normalizeTuning(), hyperparameters = {}, forecastRuns = [], kaggleScript = "", forecastStatus = "", forecastLocked = false;
let forecastTimeSpentSec = 0, forecastTimerId = null, forecastTimerStart = 0;
let roomControl = { stageUnlocks: { global: ["event1"], players: {} } }, checkpointTimer = null;
const FEATURE_TIMEOUT_SECONDS = 30 * 60;
const QUALITY_TIMEOUT_SECONDS = ROUND4.durationSeconds;
const ROUND4_TIMEOUT_SECONDS = QUALITY_TIMEOUT_SECONDS;
const EVENT1_TIMEOUT_SECONDS = 15 * 60;
const FORECAST_TIMEOUT_SECONDS = ROUND4_TIMEOUT_SECONDS;
const stageStorageKey = `clearway-progress:${session?.room || "unknown"}:${session?.player || "unknown"}`;
const REPAIR_BUDGET = ROUND4.repairBudget;
let generatingNotebook = false, kaggleSubmitted = false;
const generateKaggleWindowExpired = () => Boolean(qualityTimerStart && Date.now() - qualityTimerStart >= ROUND4_TIMEOUT_SECONDS * 1000);
const round4Closed = () => forecastLocked || qualityResult?.status === "COMPLETED" || generateKaggleWindowExpired();
const searchCreditsRemaining = () => Math.max(0, ROUND4.searchBudget - modelSpend());
const round4Elapsed = () => qualityTimerStart ? Math.max(0, Math.floor((Date.now() - qualityTimerStart) / 1000)) : 0;
const modelSpend = () => forecastRuns.reduce((sum, run) => sum + Number(run.cost || 0), 0);
const repairSpend = () => forecastRuns.reduce((sum, run) => sum + Number(run.repairCost || 0), 0);
const event4CreditsRemaining = () => Math.max(0, REPAIR_BUDGET - repairSpend());
const stageIsUnlocked = name => roomControl.stageUnlocks?.global?.includes(name) || roomControl.stageUnlocks?.players?.[session.player]?.includes(name);
const serializeState = () => ({ stage, highestStage, stageStartedAt: { event1: event1TimerStart, manual: manualTimerStart, features: featureTimerStart, quality: qualityTimerStart, forecast: forecastTimerStart }, manualLabels, manualLocked, manualState, manualResult, event1Result, event1Selections, analysisState, analysisCredits, findings, selectedFeatures: [...selectedFeatures], featureState, featureResult, qualityPlan, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), repairMethods, qualityState, qualityResult, model, tuning, hyperparameters, forecastRuns, kaggleScript, forecastStatus, forecastLocked, kaggleSubmitted });
const applyState = saved => {
  if (!saved || typeof saved !== "object") return;
  stage = saved.stage === "forecast" ? "quality" : (saved.stage || stage); highestStage = Number(saved.highestStage || 0); manualLabels = saved.manualLabels || {}; manualLocked = Boolean(saved.manualLocked); manualState = saved.manualState || ""; manualResult = saved.manualResult || null; event1Result = saved.event1Result || null; event1Selections = saved.event1Selections || [];
  analysisState = saved.analysisState || ""; analysisCredits = Number(saved.analysisCredits ?? 10); findings = saved.findings || []; selectedFeatures = new Set(saved.selectedFeatures || []); featureState = saved.featureState || ""; featureResult = saved.featureResult || null; qualityPlan = saved.qualityPlan || null;
  repairs = { missingColumns: new Set(saved.repairs?.missingColumns || []), outlierColumns: new Set(saved.repairs?.outlierColumns || []) }; repairMethods = saved.repairMethods || { missing: {}, outlier: {} };
  qualityState = saved.qualityState || ""; qualityResult = saved.qualityResult || null; model = Object.hasOwn(modelCatalog, saved.model) ? saved.model : "Random Forest"; tuning = saved.tuning || tuning; hyperparameters = saved.hyperparameters || {}; forecastRuns = Array.isArray(saved.forecastRuns) ? saved.forecastRuns : []; kaggleScript = saved.kaggleScript || ""; forecastStatus = saved.forecastStatus || ""; forecastLocked = Boolean(saved.forecastLocked); kaggleSubmitted = Boolean(saved.kaggleSubmitted);
  const starts = saved.stageStartedAt || {}; event1TimerStart = Number(starts.event1 || 0); manualTimerStart = Number(starts.manual || 0); featureTimerStart = Number(starts.features || 0); qualityTimerStart = Number(starts.quality || 0); forecastTimerStart = Number(starts.forecast || 0);
  // Recover from partially persisted stage transitions. A successfully sealed
  // stage is stronger evidence than a stale highestStage counter.
  if (event1Result) highestStage = Math.max(highestStage, 1);
  if (manualResult || manualState) highestStage = Math.max(highestStage, 2);
  if (featureResult && featureState) highestStage = Math.max(highestStage, 3);
  if (qualityResult || qualityState) highestStage = Math.max(highestStage, 3);
  qualityTimeSpentSec = Math.min(ROUND4_TIMEOUT_SECONDS, qualityResult?.status === "COMPLETED" ? Number(qualityResult.timeTakenSeconds || 0) : round4Elapsed());
  forecastTimeSpentSec = qualityTimeSpentSec;
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
  if (data?.features) {
    selectedFeatures = new Set([...selectedFeatures].filter(name => data.features.includes(name)));
    findings = findings.filter(item => ["classprofiles", "correlation"].includes(item.result?.kind));
    if (!analysisCatalog.some(item => item[0] === analysisType)) analysisType = "classprofiles";
    const lockedSelection = Array.isArray(featureResult?.selected) ? featureResult.selected : [];
    if (lockedSelection.some(name => !data.features.includes(name))) {
      featureResult = null;
      featureState = "";
      qualityPlan = null;
      qualityState = "";
      qualityResult = null;
      stage = "features";
      highestStage = Math.min(highestStage, 2);
      featureStatus = "Derived features were removed from the game. Re-lock Event 3 using only the original telemetry channels.";
    }
  }
  if (!stageIsUnlocked(stage)) stage = stageOrder.find(name => stageIsUnlocked(name)) || "event1";
  checkpoint();
};
const pollRoomControl = async () => { try { const result = await request("/api/room", { action: "get", pin: session.room, player: session.player }); const previousUnlocks = JSON.stringify(roomControl.stageUnlocks || {}); roomControl = result.room; if (featureResult && featureState) highestStage = Math.max(highestStage, 3); if (previousUnlocks !== JSON.stringify(roomControl.stageUnlocks || {})) render(); } catch {} };
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
const stageTimerReaders = { event1: ["E1", formatEvent1Countdown], manual: ["E2", formatManualCountdown], features: ["E3", formatFeatureCountdown], quality: ["E4", formatQualityCountdown] };

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
    credits: repairSpend() + modelSpend(),
    timeTakenSeconds: Number(result.timeTakenSeconds || qualityTimeSpentSec),
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
  clearInterval(qualityTimerId);
  if (forecastLocked || qualityResult?.status === "COMPLETED") return;
  if (!qualityTimerStart || qualityTimerStart > Date.now()) qualityTimerStart = Date.now();
  const tick = () => {
    qualityTimeSpentSec = Math.min(ROUND4_TIMEOUT_SECONDS, round4Elapsed());
    forecastTimeSpentSec = qualityTimeSpentSec;
    updateChrome();
    if (qualityTimeSpentSec % 5 === 0) checkpoint();
    if (qualityTimeSpentSec >= ROUND4_TIMEOUT_SECONDS) {
      clearInterval(qualityTimerId);
      forecastLocked = true;
      qualityStatus = "The 90-minute lab has closed. Your repair plan is being recorded.";
      if (!qualityResult) sealQualityRound();
      checkpoint();
      render();
      return;
    }
    document.querySelectorAll("#quality-timer-value, #forecast-timer-value").forEach(node => node.textContent = formatQualityCountdown());
    const finish = document.querySelector("#submit-event4");
    if (finish) finish.disabled = round4Closed() || generatingNotebook || !kaggleSubmitted || !forecastRuns.length || qualityTimeSpentSec < ROUND4.minimumSeconds;
    const opens = document.querySelector("#round4-finish-countdown");
    if (opens) opens.textContent = qualityTimeSpentSec < ROUND4.minimumSeconds ? `Completion opens in ${formatCountdown(ROUND4.minimumSeconds - qualityTimeSpentSec)}` : "Completion is open. Submit your chosen CSV to Kaggle first.";
  };
  qualityTimerId = setInterval(tick, 1000);
  tick();
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
      forecastStatus = "90 minutes elapsed. Notebook generation is now locked and cannot be reopened.";
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
const featureFamily = name => data?.featureMeta?.[name]?.family || "telemetry";
const displayFeatures = () => {
  const features = [...(data?.features || [])];
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
const sectionIntro = (event, title, subtitle, beats) => `<section class="story-brief story-brief--event-${esc(event)}"><span>EVENT ${event} · ${esc(title.toUpperCase())}</span><h1>${esc(title.split(" ")[0])} <i>${esc(title.split(" ").slice(1).join(" "))}</i></h1><div class="story-description">${(Array.isArray(subtitle) ? subtitle : [subtitle]).map(paragraph => `<p>${esc(paragraph)}</p>`).join("")}</div><div class="story-beats">${beats.map((beat, index) => `<span class="${index < stageOrder.indexOf(stage) ? "done" : index === stageOrder.indexOf(stage) ? "active" : ""}">${esc(beat)}</span>`).join("")}</div></section>`;

function setStage(next) {
  const index = stageOrder.indexOf(next); if (index < 0 || index > highestStage || !stageIsUnlocked(next)) return;
  [event1TimerId, manualTimerId, featureTimerId, qualityTimerId, forecastTimerId].forEach(timerId => { if (timerId) clearInterval(timerId); });
  event1TimerId = manualTimerId = featureTimerId = qualityTimerId = forecastTimerId = null;
  stage = next; if (stage === "event1" && !event1Result) event1TimerStart = event1TimerStart || Date.now(); if (stage === "manual" && !manualResult) manualTimerStart = manualTimerStart || Date.now(); if (stage === "features" && !featureResult) featureTimerStart = featureTimerStart || Date.now(); if (stage === "quality" && !qualityResult) qualityTimerStart = qualityTimerStart || Date.now(); if (stage === "forecast") forecastTimerStart = forecastTimerStart || Date.now(); checkpoint(); render(); if (stage === "event1") startEvent1Timer(); if (stage === "manual") startManualTimer(); if (stage === "features") startFeatureTimer(); if (stage === "quality") { startQualityTimer(); if (!qualityPlan && featureState) request("/api/quality", { room: session.room, player: session.player, action: "plan", featureState }).then(result => { qualityPlan = result.plan; qualityStatus = "Event 4 loaded from your sealed Event 3 feature set."; checkpoint(); render(); }).catch(error => { qualityStatus = `Event 4 could not load the repair plan yet: ${error.message}`; render(); }); } if (stage === "forecast") startForecastTimer(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function updateChrome() {
  if (featureCredit) featureCredit.textContent = `${analysisCredits} / 10`;
  if (repairCredit) repairCredit.textContent = `${event4CreditsRemaining()} / ${REPAIR_BUDGET}`;
  if (evaluationCredit) evaluationCredit.textContent = `${searchCreditsRemaining()} / ${ROUND4.searchBudget}`;
  if (stageTimers) { const [timerLabel, readTimer] = stageTimerReaders[stage] || ["E4", formatForecastCountdown]; stageTimers.innerHTML = `<span class="stage-timer-label">${timerLabel}</span><span class="stage-timer-value">${readTimer()}</span>`; }
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
    "When the system came back online, the recovery team found several files from the night of the incident mixed together in the archive. Two junction identifiers appeared repeatedly: JTU-7 and JTU-9. The operations notes for the affected Meridian Avenue crossing were filed under JTU-7, while JTU-9 appeared in records from another nearby route.",
    "The first alert from the crossing was logged at 03:14 on March 14, and the monitoring team kept recording the incident for the next six hours, until 09:14. A few files dated March 15 had also ended up in the same folder during recovery, so not every file with a similar name belonged to the incident window.",
    "The archive had also been synchronized several times while the network was unstable. The first synchronization stopped before it finished, and the second contained an older version of the records. A third synchronization completed successfully shortly before the system went offline, making it the last complete copy of the incident data.",
    "Recovery was not perfectly clean either. Alongside the synchronized files were older fragments left behind by previous attempts and stray files copied in from unrelated folders—including backups, duplicate copies, partial exports, and legacy records. They may look relevant at first glance, but they were never part of the final incident archive.",
    "Your task is to reconstruct the set of files that belongs to the same incident, using the details in the recovery notes to separate the actual archive from everything that was mixed in around it."
  ], ["Archive Reconstruction", "Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
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
    <section class="card"><div class="panel-title">Paper protocol <span>Read every rule in order. First match wins — stop checking once a rule fires.</span></div><div class="protocol-grid">${data.manualRules.map(rule => `<article><span>RULE ${rule.priority}</span><b>${esc(rule.label)}</b><small>${esc(rule.test)}</small></article>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Manual review tray <span>Apply Rules 1–4 strictly from top to bottom</span></div><div class="table-scroll"><table class="data-table manual-table"><thead><tr><th>ID</th><th>Vehicles</th><th>Occupancy</th><th>Pedestrians</th><th>Avg speed</th><th>Incident distance</th><th>Controller call</th></tr></thead><tbody>${data.manualRows.map(row => `<tr><th>${row.manual_id}</th><td>${row.vehicle_count}</td><td>${row.road_occupancy_pct}%</td><td>${row.pedestrian_count}</td><td>${row.avg_vehicle_speed_kmph} km/h</td><td>${row.incident_distance_m} m</td><td><select data-manual="${row.manual_id}" ${manualLocked ? "disabled" : ""}><option value="">Leave blank · 0 points</option>${data.manualClasses.map(label => `<option value="${label}" ${manualLabels[row.manual_id] === label ? "selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div><div class="stage-actions"><span class="${manualResult ? "recovery-message success" : "recovery-message"}">${esc(manualStatus || "You may seal the ledger with blanks; guessing carries a real penalty.")}</span>${manualLocked ? `<button class="btn btn--primary" data-next="features" ${nextStageOpen ? "" : "disabled"}>→ ${nextStageOpen ? "Open Event 3" : "Waiting for host to open Event 3"}</button>` : `<button id="lock-manual" class="btn btn--primary">Seal Event 2 ledger</button>`}</div></section>`;
}

function findingHtml(item) {
  const result = item.result;
  if (result.kind === "classprofiles") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>class profile</span></header><div class="finding-callout"><span><b>What this means</b><br>${esc(result.explanation || "Compare how this sensor behaves in each traffic situation.")}</span></div><table class="analysis-table"><thead><tr><th>Traffic situation</th><th>Typical reading</th><th>Readings available</th></tr></thead><tbody>${result.classes.map(row => `<tr><th>${esc(row.label.replaceAll("_", " "))}</th><td>${number(row.median)}</td><td>${row.count - row.missingCount}/${row.count}</td></tr>`).join("")}</tbody></table></article>`;
  return `<article class="finding"><header><b>${esc(featureName(result.feature))} × ${esc(featureName(result.secondFeature))}</b><span>correlation analysis</span></header><div class="finding-callout"><span><b>What this means</b><br>${esc(result.explanation)}</span></div><div class="relationship-score">Measured connection <strong>${esc(result.evidence?.strength || "unknown")}</strong></div></article>`;
}

function renderFeatures() {
  const config = analysisCatalog.find(item => item[0] === analysisType) || analysisCatalog[0], pair = analysisType === "correlation", nextStageOpen = stageIsUnlocked("quality");
  const orderedFeatures = displayFeatures();
  return `${sectionIntro("3", "Feature Hunt", "Sixteen telemetry channels survived the Surge, but Central has only ten seats. Spend investigation credits, then lock exactly ten channels. That choice cannot be reopened.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>CANDIDATE CHANNELS</small><b>${data.features.length}</b></div><div><small>LOCKED INPUTS</small><b>Exactly 10</b></div><div><small>INVESTIGATION POOL</small><b>${analysisCredits}/10 credits</b></div><div><small>TRAIN ARCHIVE</small><b>${data.recordCounts.trainingDelivered} damaged rows</b></div><div><small>TIMER</small><b id="feature-timer-value">${formatFeatureCountdown()}</b></div></section>
    <div class="investigation-shell"><aside class="tool-catalog"><div class="panel-title">Investigation menu <span>10-credit pool</span></div>${analysisCatalog.map(item => `<button data-analysis-type="${item[0]}" class="${analysisType === item[0] ? "active" : ""}" ${featureResult ? "disabled" : ""}><span><b>${esc(item[1])}</b><small>${esc(item[3])}</small></span><strong>${item[2]} CR</strong></button>`).join("")}</aside>
      <section class="evidence-console"><div class="panel-title">Analysis console <span>${esc(config[1])}</span></div><div class="analysis-config"><div><span>SELECTED TOOL</span><b>${esc(config[1])}</b><p>${esc(config[3])}</p></div><label>Primary channel<select id="analysis-feature">${data.features.map(name => `<option value="${name}" ${analysisFeature === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>${pair ? `<label>Comparison channel<select id="analysis-second">${data.features.filter(name => name !== analysisFeature).map(name => `<option value="${name}" ${analysisSecond === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>` : ""}<button id="run-analysis" class="btn btn--primary" ${featureResult || analysisCredits < config[2] ? "disabled" : ""}>Run · ${config[2]} credits</button></div><div class="analysis-status">${esc(featureStatus || "Purchased evidence can be reopened without spending again.")}</div><div class="findings">${findings.length ? findings.map(findingHtml).join("") : `<div class="empty-finding"><b>NO INVESTIGATION PURCHASED</b><span>Choose a tool and spend credits to reveal evidence.</span></div>`}</div></section></div>
    <section class="selection-board"><div class="panel-title">Ten-feature lock <span>${selectedFeatures.size}/10 selected</span></div><div class="pick-grid">${orderedFeatures.map(name => `<button class="pick feature ${selectedFeatures.has(name) ? "chosen" : ""}" data-feature="${name}" ${featureResult ? "disabled" : ""}><b>${selectedFeatures.has(name) ? "✓" : "+"}</b><span>${esc(featureName(name))}<small>${esc(featureFamily(name))} channel</small></span></button>`).join("")}</div>${featureResult ? `<div class="feature-score"><strong>${featureResult.score}</strong><span>EVENT 3 SCORE</span><div><small>High-value seats</small><b>${featureResult.strongCount}/10</b></div><div><small>Credits spent</small><b>${featureResult.spent}/10</b></div></div><div class="stage-actions"><span class="recovery-message success">${esc(featureResult.message)}</span><button class="btn btn--primary" data-next="quality" ${nextStageOpen ? "" : "disabled"}>→ ${nextStageOpen ? "Open Event 4" : "Waiting for host to open Event 4"}</button></div>` : `<div class="feature-lock"><span>${esc(featureStatus || "Investigate the available telemetry channels, then commit up to ten of them.")}</span><b>${selectedFeatures.size}/10</b><button id="lock-features" class="btn btn--primary">Lock selection</button></div>`}</section>`;
}

const sealFeatureRound = async () => {
  if (featureResult) return;
  try {
    const sealed = await request("/api/features", { room: session.room, player: session.player, features: [...selectedFeatures], analysisState });
    featureResult = sealed;
    featureState = sealed.featureState;
    highestStage = Math.max(highestStage, 3);
    featureStatus = sealed.message;
    checkpoint();
    render();
    const followUps = await Promise.allSettled([
      saveFeatureResult(sealed),
      request("/api/quality", { room: session.room, player: session.player, action: "plan", featureState })
    ]);
    const scoreResult = followUps[0], planResult = followUps[1];
    featureStatus = `${sealed.message} The source CSVs remain unchanged; this lock will be written into the notebook.`;
    if (planResult.status === "fulfilled") qualityPlan = planResult.value.plan;
    const warnings = [];
    if (scoreResult.status === "rejected") warnings.push("scoreboard sync failed temporarily");
    if (planResult.status === "rejected") warnings.push("Event 4 repair plan will load when you enter it");
    if (warnings.length) featureStatus = `${featureStatus} ${warnings.join("; ")}.`;
    checkpoint();
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
      repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])),
      missingMethods: repairMethods.missing,
      outlierMethods: repairMethods.outlier,
      timeTakenSeconds: qualityTimeSpentSec
    });
    qualityState = qualityResult.qualityState;
    if (round4Closed() && qualityResult.status !== "COMPLETED") qualityResult.status = "TIME_EXPIRED";
    qualityStatus = qualityResult.message;
    await saveQualityResult(qualityResult);
    highestStage = Math.max(highestStage, 4);
    render();
  } catch (error) {
    qualityStatus = error.message;
    render();
  }
};

const submitEvent4 = async () => {
  if (round4Closed() || generatingNotebook || round4Elapsed() < ROUND4.minimumSeconds || !kaggleSubmitted) {
    forecastStatus = "Complete at least 60 minutes of the lab and upload your chosen submission.csv to Kaggle before recording completion.";
    render();
    return;
  }
  if (!forecastRuns.length) {
    forecastStatus = "Generate the model notebook before submitting Event 4.";
    render();
    return;
  }
  if (!qualityResult) {
    qualityResult = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])), missingMethods: repairMethods.missing, outlierMethods: repairMethods.outlier, timeTakenSeconds: qualityTimeSpentSec });
  }
  const submittedAt = Date.now();
  const timeTakenSeconds = Math.min(ROUND4_TIMEOUT_SECONDS, Math.max(0, Math.floor((submittedAt - qualityTimerStart) / 1000)));
  const completedResult = { ...qualityResult, status: "COMPLETED", timeTakenSeconds };
  await saveQualityResult(completedResult);
  clearInterval(qualityTimerId);
  clearInterval(forecastTimerId);
  qualityTimerId = null;
  forecastTimerId = null;
  qualityTimeSpentSec = timeTakenSeconds;
  forecastTimeSpentSec = timeTakenSeconds;
  qualityResult = completedResult;
  forecastLocked = true;
  forecastStatus = "Event 4 submitted. The model handoff and completion time are recorded.";
  checkpoint();
  render();
};

const currentRepairSpend = () => qualityPlan ? repairs.missingColumns.size * qualityPlan.costs.missing + repairs.outlierColumns.size * qualityPlan.costs.outlier : 0;
function repairCards(kind, items) {
  const key = { missing: "missingColumns", outlier: "outlierColumns" }[kind], set = repairs[key], cost = qualityPlan.costs[kind], methods = kind === "missing" ? qualityPlan.missingMethods : qualityPlan.outlierMethods;
  const labels = { median: "Fill with median", mean: "Fill with mean", mode: "Fill with mode", drop: "Drop affected training rows", iqr_clip: "Clip to IQR bounds", iqr_remove: "Remove outlier training rows", median_clip: "Replace outliers with median" };
  return items.map(item => {
    const selected = set.has(item.feature), disabled = round4Closed() || generatingNotebook;
    return `<article class="r4-repair ${selected ? "selected" : ""}"><label><input type="checkbox" data-repair-kind="${kind}" data-repair-id="${esc(item.feature)}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""}><span><b>${esc(featureName(item.feature))}</b><small>${item.issueCount} affected cells · ${cost} CR</small></span></label>${selected ? `<select aria-label="${esc(featureName(item.feature))} ${kind} method" data-repair-method="${kind}" data-repair-id="${esc(item.feature)}" ${disabled ? "disabled" : ""}>${methods.map(method => `<option value="${method}" ${(repairMethods[kind][item.feature] || methods[0]) === method ? "selected" : ""}>${labels[method]}</option>`).join("")}</select>` : ""}</article>`;
  }).join("");
}
function renderQuality() {
  if (!qualityPlan) return `<section class="card"><div class="loading">Loading Round 4 repair options…</div></section>`;
  return `<div class="round4-lab">
    <section class="r4-hero"><div><span class="r4-eyebrow">ROUND 04 / THE FINAL FORECAST</span><h1>Build. Compare. <em>Commit.</em></h1><p>Repair your telemetry. Explore five ensemble and five regular models. Turn the strongest experiment into your Kaggle submission.</p></div><div class="r4-clock"><span>LAB TIME REMAINING</span><strong id="quality-timer-value">${formatQualityCountdown()}</strong><small>90-minute lab · completion after 60 min</small></div></section>
    <div class="r4-wallets"><div><span>REPAIR WALLET</span><b>${event4CreditsRemaining()} <small>/ ${REPAIR_BUDGET} CR</small></b><p>${repairSpend()} spent · ${currentRepairSpend()} CR in the current plan</p></div><div><span>SEARCH WALLET</span><b>${searchCreditsRemaining()} <small>/ ${ROUND4.searchBudget} CR</small></b><p>${modelSpend()} spent · ${forecastRuns.length} notebooks generated</p></div><div><span>YOUR MISSION</span><b>${data.recordCounts.finalTest} <small>predictions</small></b><p>Macro F1 · final standings on Kaggle</p></div></div>
    <div class="r4-roadmap"><span><b>01</b> Repair & plan <small>10–15 min</small></span><span><b>02</b> Search & compare <small>45–60 min</small></span><span><b>03</b> Submit to Kaggle <small>10–15 min</small></span></div>
    <section class="r4-panel"><div class="r4-heading"><div><span class="r4-eyebrow">01 / DATA QUALITY</span><h2>Make each repair count</h2></div><span class="r4-pill">3 CR per column & operation</span></div><p class="r4-muted">Your repair wallet is separate from model search. Edit the plan between experiments; each notebook keeps its own snapshot. Unselected missing cells use zero. Purchased methods learn from training folds only.</p>
      <details class="r4-repair-group"><summary>Missing values <span>${repairs.missingColumns.size}/${qualityPlan.limits.missing} selected</span></summary><div class="r4-repairs">${repairCards("missing", qualityPlan.missingColumns)}</div></details><details class="r4-repair-group"><summary>Outlier treatment <span>${repairs.outlierColumns.size}/${qualityPlan.limits.outlier} selected</span></summary><div class="r4-repairs">${repairCards("outlier", qualityPlan.outlierColumns)}</div></details>
      <p class="r4-status" role="status">${esc(qualityStatus)}</p></section>
    ${renderForecast()}</div>`;
}

function rangeControls() {
  const plan = searchPlan(model, hyperparameters[model]);
  return Object.entries(modelCatalog[model].parameters).map(([key, parameter]) => `<label class="r4-slider"><span><b>${esc(parameter.label)}</b><output data-range-output="${key}">${plan.levels[key]}/${parameter.values.length} values</output></span><input type="range" min="1" max="${parameter.values.length}" step="1" value="${plan.levels[key]}" data-hyperparameter="${key}" aria-label="${esc(parameter.label)} search range" aria-valuetext="${esc(plan.parameters[key].map(value => value ?? "unlimited").join(", "))}" ${round4Closed() || generatingNotebook ? "disabled" : ""}><span class="r4-range-ends"><small>${parameter.values[0]} only</small><small>Full range</small></span><small class="r4-range-values" data-range-values="${key}">${plan.parameters[key].map(value => value ?? "unlimited").join(" · ")}</small></label>`).join("");
}
function runSummary() {
  const plan = searchPlan(model, hyperparameters[model]), remaining = searchCreditsRemaining(), repairCost = currentRepairSpend(), repairRemaining = event4CreditsRemaining(), minutes = (plan.targetSeconds / 60).toFixed(1);
  const insufficientSearch = remaining < plan.cost, insufficientRepair = repairRemaining < repairCost;
  return `<span class="r4-eyebrow">THIS EXPERIMENT</span><h3>${esc(model)}</h3><div class="r4-run-price">${plan.cost}<small> CR</small></div><dl><div><dt>Target runtime</dt><dd>~${minutes} min</dd></div><div><dt>Search space</dt><dd>${plan.combinations} configurations</dd></div><div><dt>Validation</dt><dd>${plan.folds}-fold Macro F1</dd></div><div><dt>Model wallet after run</dt><dd>${remaining - plan.cost} CR</dd></div><div><dt>Repair wallet after run</dt><dd>${repairRemaining - repairCost} CR</dd></div></dl><p>Wider sliders unlock more values, more search time, and higher credit costs. The notebook samples the space; it may not visit every combination.</p><p class="r4-muted">Real CV work, including repeated folds for narrow ranges. Runtime is approximate; the current trial and final refit must finish.</p><button id="generate-kaggle" class="btn btn--primary" ${round4Closed() || generatingNotebook || insufficientSearch || insufficientRepair ? "disabled" : ""}>${round4Closed() ? "Lab closed" : generatingNotebook ? "Preparing notebook…" : insufficientSearch ? "Not enough search credits" : insufficientRepair ? "Not enough repair credits" : `Download experiment · ${plan.cost} model CR + ${repairCost} repair CR`}</button><small>Both wallets are charged once per new notebook. Re-downloads are free.</small>`;
}
function renderForecast() {
  const closed = round4Closed(), elapsed = round4Elapsed(), config = modelCatalog[model];
  const levelsFor = value => Object.fromEntries(Object.keys(config.parameters).map(key => [key, value]));
  const focused = searchPlan(model, levelsFor(1)), balanced = searchPlan(model, levelsFor(2)), full = searchPlan(model, levelsFor(99));
  return `<section class="r4-panel"><div class="r4-heading"><div><span class="r4-eyebrow">02 / MODEL WORKBENCH</span><h2>Choose your model</h2></div><span class="r4-pill">5 ensemble · 5 regular</span></div><div class="r4-models">${Object.entries(modelCatalog).map(([name, item], index) => `<button class="r4-model ${name === model ? "selected" : ""}" data-model="${name}" aria-pressed="${name === model}" ${closed || generatingNotebook ? "disabled" : ""}><span>${String(index + 1).padStart(2, "0")} / ${item.kind.toUpperCase()} · ${item.family}</span><b>${name}</b><small>${item.description}</small><i>${name === model ? "Selected ✓" : "Explore model →"}</i></button>`).join("")}</div></section>
    <section class="r4-workbench"><div class="r4-panel"><div class="r4-heading"><div><span class="r4-eyebrow">SEARCH DESIGN</span><h2>How far will you explore?</h2></div></div><p class="r4-muted">Each slider grows a real hyperparameter range. This ${config.kind} model targets ~${(focused.targetSeconds / 60).toFixed(1)} min focused, ~${(balanced.targetSeconds / 60).toFixed(1)} min balanced, and ~${(full.targetSeconds / 60).toFixed(1)} min at full range. Fast models repeat shuffled CV cycles instead of idling.</p><div class="r4-presets">${[[1,"Focused"],[2,"Balanced"],[99,"Full range"]].map(([value,label]) => `<button data-range-preset="${value}" ${closed || generatingNotebook ? "disabled" : ""}>${label}</button>`).join("")}</div><div class="r4-sliders">${rangeControls()}</div><label class="r4-seed">Random seed<input id="tuning-seed" type="number" min="0" max="999999" value="${normalizeTuning(tuning).randomState}" ${closed || generatingNotebook ? "disabled" : ""}></label></div><aside class="r4-run-summary" id="round4-run-summary">${runSummary()}</aside></section>
    <p class="r4-status" role="status">${esc(forecastStatus)}</p>
    <section class="r4-panel"><div class="r4-heading"><div><span class="r4-eyebrow">EXPERIMENT LOG</span><h2>Your notebook history</h2></div><span class="r4-pill">${forecastRuns.length} generated</span></div>${forecastRuns.length ? `<div class="table-scroll"><table class="r4-history"><thead><tr><th>Model / generated</th><th>Target</th><th>Credits</th><th>Search ranges</th><th>Notebook</th></tr></thead><tbody>${forecastRuns.map((run, index) => `<tr><td><b>${esc(run.model)}</b><small>${new Date(run.createdAt).toLocaleTimeString()}</small></td><td>${run.targetSeconds ? `~${(run.targetSeconds / 60).toFixed(1)} min` : "Legacy"}</td><td>${run.cost} CR</td><td><details><summary>View snapshot</summary><p>${esc(Object.entries(run.parameters || {}).map(([key, values]) => `${key}: ${[].concat(values).map(value => value ?? "unlimited").join(", ")}`).join("; "))}</p><p>${esc(JSON.stringify(run.repairs || {}))}</p></details></td><td><button class="btn btn--ghost" data-redownload="${index}" ${run.notebook ? "" : "disabled"}>Download</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="r4-empty"><b>Your first experiment starts here.</b><p>Choose a model, set the ranges, and download its notebook. Run it in Kaggle or locally, then compare the evaluation files.</p></div>`}</section>
    <section class="r4-panel r4-finish"><div><span class="r4-eyebrow">03 / FINAL HANDOFF</span><h2>${qualityResult?.status === "COMPLETED" ? "Round complete" : "Put your best run forward"}</h2><p>Run the notebook, download submission.csv, and upload it to the organizer’s Kaggle competition. Keep randomized_search_results.csv and best_model_evaluation.json as your experiment record.</p><p id="round4-finish-countdown">${closed ? "The lab is closed." : elapsed < ROUND4.minimumSeconds ? `Completion opens in ${formatCountdown(ROUND4.minimumSeconds - elapsed)}` : "Completion is open. Submit your chosen CSV to Kaggle first."}</p><label><input id="round4-kaggle-submitted" type="checkbox" ${kaggleSubmitted ? "checked" : ""} ${closed || generatingNotebook ? "disabled" : ""}> I have uploaded my chosen submission.csv to Kaggle.</label></div><button id="submit-event4" class="btn btn--primary" ${closed || generatingNotebook || !forecastRuns.length || !kaggleSubmitted || elapsed < ROUND4.minimumSeconds ? "disabled" : ""}>${qualityResult?.status === "COMPLETED" ? "Completion recorded" : "Record round complete"}</button></section>`;
}

function render() {
  const openRepairs = [...box.querySelectorAll(".r4-repair-group")].map(node => node.open);
  updateChrome();
  box.innerHTML = stage === "event1" ? renderEvent1() : stage === "manual" ? renderManual() : stage === "features" ? renderFeatures() : stage === "quality" ? renderQuality() : renderForecast();
  box.querySelectorAll(".r4-repair-group").forEach((node, index) => node.open = Boolean(openRepairs[index]));
  bind();
}

function toggleRepair(kind, id) {
  if (round4Closed() || generatingNotebook) return;
  const key = { missing: "missingColumns", outlier: "outlierColumns" }[kind], set = repairs[key], limit = qualityPlan.limits[kind], cost = qualityPlan.costs[kind];
  if (set.has(id)) set.delete(id);
  else if (set.size >= limit) qualityStatus = `That repair type is limited to ${limit} selections.`;
  else if (currentRepairSpend() + cost > event4CreditsRemaining()) qualityStatus = `That repair would make this experiment cost more than the ${event4CreditsRemaining()} repair credits remaining.`;
  else set.add(id);
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
  document.querySelectorAll("[data-repair-kind]").forEach(button => button.onchange = () => toggleRepair(button.dataset.repairKind, button.dataset.repairId));
  document.querySelectorAll("[data-repair-method]").forEach(select => select.onchange = () => { if (round4Closed() || generatingNotebook) return; repairMethods[select.dataset.repairMethod][select.dataset.repairId] = select.value; checkpoint(); });
  document.querySelectorAll("[data-model]").forEach(button => button.onclick = () => { if (round4Closed() || generatingNotebook) return; model = button.dataset.model; kaggleScript = ""; forecastStatus = ""; render(); });
  document.querySelectorAll("[data-range-preset]").forEach(button => button.onclick = () => { if (round4Closed() || generatingNotebook) return; hyperparameters[model] = Object.fromEntries(Object.keys(modelCatalog[model].parameters).map(key => [key, Number(button.dataset.rangePreset)])); render(); });
  document.querySelectorAll("[data-hyperparameter]").forEach(input => input.oninput = () => {
    if (round4Closed() || generatingNotebook) return;
    const key = input.dataset.hyperparameter;
    hyperparameters[model] = { ...searchPlan(model, hyperparameters[model]).levels, [key]: Number(input.value) };
    const plan = searchPlan(model, hyperparameters[model]), values = plan.parameters[key].map(value => value ?? "unlimited").join(" · ");
    document.querySelector(`[data-range-output="${key}"]`).textContent = `${plan.levels[key]}/${modelCatalog[model].parameters[key].values.length} values`;
    document.querySelector(`[data-range-values="${key}"]`).textContent = values;
    input.setAttribute("aria-valuetext", values);
    document.querySelector("#round4-run-summary").innerHTML = runSummary();
    bindGenerateNotebook(); checkpoint();
  });
  const seed = document.querySelector("#tuning-seed"); if (seed) seed.onchange = () => { tuning = normalizeTuning({ randomState: seed.value }); seed.value = tuning.randomState; checkpoint(); };
  document.querySelectorAll("[data-redownload]").forEach(button => button.onclick = () => { const run = forecastRuns[Number(button.dataset.redownload)]; if (run?.notebook) downloadNotebook(run.notebook, run.model); });
  const submitted = document.querySelector("#round4-kaggle-submitted"); if (submitted) submitted.onchange = () => { kaggleSubmitted = submitted.checked; render(); checkpoint(); };
  bindGenerateNotebook();
  const submitEvent4Button = document.querySelector("#submit-event4"); if (submitEvent4Button) submitEvent4Button.onclick = async () => { submitEvent4Button.disabled = true; try { await submitEvent4(); } catch (error) { forecastStatus = error.message; render(); } };
}

function downloadNotebook(content, name) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/x-ipynb+json" }));
  const link = document.createElement("a"); link.href = url; link.download = kaggleFilename(name); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bindGenerateNotebook() {
  const button = document.querySelector("#generate-kaggle");
  if (!button) return;
  button.onclick = async () => {
    if (round4Closed() || generatingNotebook) return;
    const chosenModel = model, plan = searchPlan(chosenModel, hyperparameters[chosenModel]);
    if (searchCreditsRemaining() < plan.cost) return;
    if (event4CreditsRemaining() < currentRepairSpend()) return;
    const repairSnapshot = Object.fromEntries(Object.entries(repairs).map(([key, values]) => [key, [...values]]));
    const methodSnapshot = JSON.parse(JSON.stringify(repairMethods));
    generatingNotebook = true; render();
    try {
      const result = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, repairs: repairSnapshot, missingMethods: methodSnapshot.missing, outlierMethods: methodSnapshot.outlier });
      if (round4Closed()) throw new Error("The lab closed before notebook generation completed. No search credits charged.");
      const repairCost = Number(result.repairSpend || 0);
      if (event4CreditsRemaining() < repairCost) throw new Error(`This experiment needs ${repairCost} repair credits, but only ${event4CreditsRemaining()} remain.`);
      const content = buildKaggleScript({ model: chosenModel, features: result.features, repairs: repairSnapshot, tuning: { ...normalizeTuning(tuning), ranges: plan.levels, repairMethods: methodSnapshot }, notebook: true });
      forecastRuns = [{ model: chosenModel, cost: plan.cost, repairCost, targetSeconds: plan.targetSeconds, parameters: plan.parameters, ranges: plan.levels, repairs: repairSnapshot, repairMethods: methodSnapshot, createdAt: Date.now(), notebook: content }, ...forecastRuns];
      qualityState = result.qualityState; qualityResult = null; kaggleSubmitted = false; kaggleScript = content; download.disabled = false;
      forecastStatus = `${chosenModel} notebook ready. Run it to create submission.csv; target ${(plan.targetSeconds / 60).toFixed(1)} minutes.`;
      checkpoint(); downloadNotebook(content, chosenModel);
    } catch (error) { forecastStatus = error.message; }
    finally { generatingNotebook = false; render(); }
  };
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
