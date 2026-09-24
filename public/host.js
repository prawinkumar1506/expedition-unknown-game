const pin = document.querySelector("#room-pin");
const message = document.querySelector("#host-message");
const button = document.querySelector("#start-game");
const newRoomButton = document.querySelector("#new-room");
const closeRoomButton = document.querySelector("#close-room");
const players = document.querySelector("#players");
const count = document.querySelector("#player-count");
const stageControls = document.querySelector("#stage-controls");
const event1Scoreboard = document.querySelector("#event1-scoreboard");
const scoreboard = document.querySelector("#event2-scoreboard");
const featureScoreboard = document.querySelector("#event3-scoreboard");
const qualityScoreboard = document.querySelector("#event4-scoreboard");
const activityLog = document.querySelector("#activity-log");
const overallLeaderboard = document.querySelector("#overall-leaderboard");
const leaderboardUpdated = document.querySelector("#leaderboard-updated");
const inspectorTeam = document.querySelector("#inspector-team");
const teamInspector = document.querySelector("#team-inspector");

let room;
let hostToken;
let timer;
let selectedInspector = "";
const inspectorOpen = new Set();

const hostStorageKey = "clearway-host-room";
const stageOrder = ["event1", "manual", "features", "quality"];
const stageNames = {
  event1: "Stage 1 · Archive",
  manual: "Stage 2 · Manual Override",
  features: "Stage 3 · Feature Hunt",
  quality: "Stage 4 · Repair + Model Handoff"
};
const leaderboardStages = [
  ["event1", "E1 Archive"],
  ["manual", "E2 Manual"],
  ["features", "E3 Features"],
  ["quality", "E4 Handoff"]
];
const INVESTIGATION_BUDGET = 75;
const OVERALL_CREDIT_BUDGET = 200;
const EVENT1_LIMIT_SECONDS = 15 * 60;
const FEATURE_LIMIT_SECONDS = 30 * 60;
const FINAL_LIMIT_SECONDS = 90 * 60;
const PERFORMANCE_WEIGHT = 0.90;
const CREDIT_WEIGHT = 0.05;
const TIME_WEIGHT = 0.05;

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = value => `${number(value).toFixed(1)}%`;

async function api(body) {
  const response = await fetch("/api/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}

function formatTime(seconds) {
  const safe = Math.max(0, number(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const secs = Math.floor(safe % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function getScores(stage) {
  return (room?.scores || []).filter(item => item.stage === stage);
}

function scoreFor(player, stage) {
  return (room?.scores || []).find(item => item.player === player && item.stage === stage) || null;
}

function stageNormalizedScore(player, stage) {
  const score = scoreFor(player, stage);
  if (!score) return 0;
  if (stage === "event1") return score.passed ? 100 : 0;
  return Math.max(0, Math.min(100, number(score.score)));
}

function leaderboardRow(player) {
  const progress = room?.progress?.[player.name] || {};
  const stages = Object.fromEntries(leaderboardStages.map(([stage]) => [stage, stageNormalizedScore(player.name, stage)]));
  const total = Object.values(stages).reduce((sum, score) => sum + score, 0);
  const completed = leaderboardStages.filter(([stage]) => scoreFor(player.name, stage)).length;
  const totalTime = leaderboardStages.reduce((sum, [stage]) => sum + number(scoreFor(player.name, stage)?.timeTakenSeconds), 0);
  const featureCredits = scoreFor(player.name, "features")?.credits ?? Math.max(0, INVESTIGATION_BUDGET - number(progress.analysisCredits ?? INVESTIGATION_BUDGET));
  const runs = Array.isArray(progress.forecastRuns) ? progress.forecastRuns : [];
  const roundCreditsFromProgress = runs.reduce((sum, run) => sum + number(run.cost) + number(run.repairCost), 0);
  const roundCredits = scoreFor(player.name, "quality")?.credits ?? roundCreditsFromProgress;
  const creditsUsed = Math.max(0, featureCredits + roundCredits);
  const creditEfficiency = Math.max(0, Math.min(100, (1 - creditsUsed / OVERALL_CREDIT_BUDGET) * 100));
  const manualLimit = Math.max(60, number(room?.stageDurations?.manual || 20 * 60));
  const stageLimits = { event1: EVENT1_LIMIT_SECONDS, manual: manualLimit, features: FEATURE_LIMIT_SECONDS, quality: FINAL_LIMIT_SECONDS };
  const completedTimeBudget = leaderboardStages.reduce((sum, [stage]) => sum + (scoreFor(player.name, stage) ? stageLimits[stage] : 0), 0);
  const timeEfficiency = completedTimeBudget ? Math.max(0, Math.min(100, (1 - totalTime / completedTimeBudget) * 100)) : 0;
  const completionFactor = completed / leaderboardStages.length;
  const performance = total / leaderboardStages.length;
  const evaluation = performance * PERFORMANCE_WEIGHT + creditEfficiency * CREDIT_WEIGHT * completionFactor + timeEfficiency * TIME_WEIGHT * completionFactor;
  return {
    player: player.name,
    stages,
    total,
    overall: performance,
    evaluation,
    creditsUsed,
    creditEfficiency,
    timeEfficiency,
    completed,
    totalTime,
    currentStage: progress.stage || "event1"
  };
}

function leaderboardRows() {
  return (room?.players || []).map(leaderboardRow).sort((a, b) =>
    b.evaluation - a.evaluation || b.total - a.total || b.completed - a.completed || a.creditsUsed - b.creditsUsed || a.totalTime - b.totalTime || a.player.localeCompare(b.player)
  );
}

function scoreCell(score, complete) {
  return `<div class="leaderboard-score"><b>${score.toFixed(1)}</b><span class="leaderboard-score-bar"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></span></div><span class="leaderboard-meta">${complete ? "submitted" : "not submitted"}</span>`;
}

function renderLeaderboard() {
  if (!overallLeaderboard) return;
  const rows = leaderboardRows();
  leaderboardUpdated.textContent = rows.length ? `LIVE · ${new Date().toLocaleTimeString()}` : "LIVE";
  if (!rows.length) {
    overallLeaderboard.innerHTML = '<div class="host-empty">Waiting for teams to join…</div>';
    return;
  }
  overallLeaderboard.innerHTML = `<div class="table-scroll"><table class="data-table leaderboard-table"><thead><tr><th>Rank</th><th>Team</th>${leaderboardStages.map(([, label]) => `<th>${esc(label)}</th>`).join("")}<th>Total</th><th>Credits used</th><th>Time</th><th>Evaluation</th><th>Current stage</th><th></th></tr></thead><tbody>${rows.map((entry, index) => `<tr>
    <td class="leaderboard-rank">#${index + 1}</td>
    <td class="leaderboard-team">${esc(entry.player)}<span class="leaderboard-meta">${entry.completed}/4 stages · ${formatTime(entry.totalTime)} recorded</span></td>
    ${leaderboardStages.map(([stage]) => `<td class="leaderboard-stage">${scoreCell(entry.stages[stage], Boolean(scoreFor(entry.player, stage)))}</td>`).join("")}
    <td class="leaderboard-total">${entry.total.toFixed(1)} / 400</td>
    <td><strong>${entry.creditsUsed} / ${OVERALL_CREDIT_BUDGET}</strong></td>
    <td><strong>${formatTime(entry.totalTime)}</strong></td>
    <td><strong>${entry.evaluation.toFixed(2)}</strong><span class="leaderboard-meta">90% score · 5% credits · 5% time</span></td>
    <td><span class="stage-pill">${esc(stageNames[entry.currentStage] || entry.currentStage)}</span></td>
    <td class="leaderboard-actions"><button class="btn btn--ghost" data-inspect-player="${esc(entry.player)}">Inspect</button></td>
  </tr>`).join("")}</tbody></table></div>`;
  overallLeaderboard.querySelectorAll("[data-inspect-player]").forEach(control => {
    control.onclick = () => selectInspector(control.dataset.inspectPlayer, true);
  });
}

function renderInspectorSelector() {
  if (!inspectorTeam) return;
  const names = (room?.players || []).map(player => player.name);
  if (selectedInspector && !names.includes(selectedInspector)) selectedInspector = "";
  inspectorTeam.innerHTML = `<option value="">Select a team…</option>${names.map(name => `<option value="${esc(name)}" ${name === selectedInspector ? "selected" : ""}>${esc(name)}</option>`).join("")}`;
  inspectorTeam.onchange = () => selectInspector(inspectorTeam.value, false);
}

function kv(label, value, className = "") {
  return `<div class="inspect-kv"><small>${esc(label)}</small><strong class="${className}">${esc(value)}</strong></div>`;
}

function chips(values, variant = "") {
  const items = Array.isArray(values) ? values : [];
  return items.length ? `<div class="inspect-chips">${items.map(value => `<span class="inspect-chip ${variant}">${esc(value)}</span>`).join("")}</div>` : '<p class="inspect-note">None recorded.</p>';
}

function detail(key, title, subtitle, body) {
  const open = inspectorOpen.has(key) ? " open" : "";
  return `<details class="inspect-detail" data-inspect-detail="${esc(key)}"${open}><summary><div class="inspect-title"><b>${esc(title)}</b><span>${esc(subtitle)}</span></div></summary><div class="inspect-content">${body}</div></details>`;
}

function investigationDescription(item) {
  const result = item?.result || {};
  if (result.kind === "classprofiles") return `Class profiles · ${result.feature || "unknown channel"}`;
  if (result.kind === "correlation") return `Correlation · ${result.feature || "?"} × ${result.secondFeature || "?"}`;
  return result.kind || item?.key || "Investigation";
}

function renderTeamInspector() {
  if (!teamInspector) return;
  if (!selectedInspector) {
    teamInspector.innerHTML = '<div class="host-empty">Choose a team from the leaderboard or selector to inspect its run.</div>';
    return;
  }
  const player = (room?.players || []).find(item => item.name === selectedInspector);
  if (!player) {
    teamInspector.innerHTML = '<div class="host-empty">That team is no longer present in the room.</div>';
    return;
  }
  const progress = room?.progress?.[selectedInspector] || {};
  const standing = leaderboardRow(player);
  const e1 = scoreFor(selectedInspector, "event1") || progress.event1Result || {};
  const e2 = scoreFor(selectedInspector, "manual") || progress.manualResult || {};
  const e3 = scoreFor(selectedInspector, "features") || progress.featureResult || {};
  const e4 = scoreFor(selectedInspector, "quality") || progress.qualityResult || {};
  const stageStarts = progress.stageStartedAt || {};
  const currentStarted = number(stageStarts[progress.stage]);
  const liveElapsed = currentStarted ? Math.max(0, Math.floor((Date.now() - currentStarted) / 1000)) : 0;
  const labels = progress.manualLabels && typeof progress.manualLabels === "object" ? Object.entries(progress.manualLabels) : [];
  const selectedFeatures = Array.isArray(progress.selectedFeatures) ? progress.selectedFeatures : [];
  const autoSelected = Array.isArray(progress.featureResult?.autoSelected) ? progress.featureResult.autoSelected : [];
  const findings = Array.isArray(progress.findings) ? progress.findings : [];
  const missingRepairs = Array.isArray(progress.repairs?.missingColumns) ? progress.repairs.missingColumns : [];
  const outlierRepairs = Array.isArray(progress.repairs?.outlierColumns) ? progress.repairs.outlierColumns : [];
  const forecastRuns = Array.isArray(progress.forecastRuns) ? progress.forecastRuns : [];
  const teamActivity = (room?.activity || []).filter(item => item.player === selectedInspector);

  const event1Body = `<div class="inspect-grid">${kv("Status", e1.status || (e1.passed ? "completed" : "not submitted"))}${kv("Passed", e1.passed === undefined ? "—" : e1.passed ? "Yes" : "No")}${kv("Time", formatTime(e1.timeTakenSeconds))}${kv("Selections", `${(progress.event1Selections || []).length}/3`)}</div><div class="inspect-section-label">Archive fragments selected</div>${chips(progress.event1Selections || [])}`;
  const event2Body = `<div class="inspect-grid">${kv("Correct", e2.correct ?? "—")}${kv("Wrong", e2.wrong ?? "—")}${kv("Blank", e2.blank ?? "—")}${kv("Score", e2.score == null ? "—" : pct(e2.score))}${kv("Time", formatTime(e2.timeTakenSeconds))}${kv("Answers recorded", labels.length)}</div><div class="inspect-section-label">Manual decisions</div>${labels.length ? `<div class="table-scroll"><table class="inspect-table"><thead><tr><th>Record</th><th>Controller call</th></tr></thead><tbody>${labels.sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => `<tr><td>${esc(id)}</td><td>${esc(value || "blank")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="inspect-note">No Manual Override decisions have been checkpointed.</p>'}`;
  const event3Body = `<div class="inspect-grid">${kv("Score", e3.score == null ? "—" : pct(e3.score))}${kv("Strong", e3.strong ?? progress.featureResult?.strongCount ?? "—")}${kv("Moderate", e3.moderate ?? progress.featureResult?.moderateCount ?? "—")}${kv("Weak", e3.weak ?? progress.featureResult?.weakCount ?? "—")}${kv("Intel spent", `${INVESTIGATION_BUDGET - number(progress.analysisCredits ?? INVESTIGATION_BUDGET)} / ${INVESTIGATION_BUDGET}`)}${kv("Investigations", findings.length)}</div><div class="inspect-section-label">Locked features</div>${chips(selectedFeatures, "good")}${autoSelected.length ? `<div class="inspect-section-label">Server auto-filled features</div>${chips(autoSelected, "warn")}` : ""}<div class="inspect-section-label">Purchased evidence</div>${findings.length ? `<div class="table-scroll"><table class="inspect-table"><thead><tr><th>#</th><th>Investigation</th></tr></thead><tbody>${findings.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(investigationDescription(item))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="inspect-note">No investigation results are checkpointed.</p>'}`;
  const missingMethodRows = missingRepairs.map(feature => [feature, progress.repairMethods?.missing?.[feature] || "median"]);
  const outlierMethodRows = outlierRepairs.map(feature => [feature, progress.repairMethods?.outlier?.[feature] || "iqr_clip"]);
  const committedRepairCredits = forecastRuns.reduce((sum, run) => sum + number(run.repairCost), 0);
  const committedSearchCredits = forecastRuns.reduce((sum, run) => sum + number(run.cost), 0);
  const event4Body = `<div class="inspect-grid">${kv("Quality score", e4.score == null ? "—" : pct(e4.score))}${kv("Repair credits", `${committedRepairCredits} / 50`)}${kv("Search credits", `${committedSearchCredits} / 150`)}${kv("Kaggle uploaded", progress.kaggleSubmitted ? "YES" : "NO")}${kv("Status", e4.status || "in progress")}${kv("Time", formatTime(e4.timeTakenSeconds))}</div><div class="inspect-section-label">Current missing-value plan</div>${missingMethodRows.length ? `<table class="inspect-table"><thead><tr><th>Feature</th><th>Method</th></tr></thead><tbody>${missingMethodRows.map(([feature, method]) => `<tr><td>${esc(feature)}</td><td>${esc(method)}</td></tr>`).join("")}</tbody></table>` : '<p class="inspect-note">No missing-value repairs selected.</p>'}<div class="inspect-section-label">Current outlier plan</div>${outlierMethodRows.length ? `<table class="inspect-table"><thead><tr><th>Feature</th><th>Method</th></tr></thead><tbody>${outlierMethodRows.map(([feature, method]) => `<tr><td>${esc(feature)}</td><td>${esc(method)}</td></tr>`).join("")}</tbody></table>` : '<p class="inspect-note">No outlier repairs selected.</p>'}`;
  const currentParams = progress.hyperparameters?.[progress.model] || {};
  const modelBody = `<div class="inspect-grid">${kv("Current model", progress.model || "—")}${kv("Notebook runs", forecastRuns.length)}${kv("Random seed", progress.tuning?.randomState ?? "—")}${kv("Kaggle uploaded", progress.kaggleSubmitted ? "YES" : "NO")}${kv("Generation locked", progress.forecastLocked ? "YES" : "NO")}</div><div class="inspect-section-label">Current search-range levels</div><pre class="inspect-params">${esc(JSON.stringify(currentParams, null, 2) || "{}")}</pre><div class="inspect-section-label">Generated notebook runs</div>${forecastRuns.length ? `<div class="table-scroll"><table class="inspect-table"><thead><tr><th>When</th><th>Model</th><th>Target</th><th>Search CR</th><th>Repair CR</th><th>Search ranges</th></tr></thead><tbody>${forecastRuns.map(run => `<tr><td>${esc(formatDate(run.createdAt))}</td><td>${esc(run.model)}</td><td>${run.targetSeconds ? esc(formatTime(run.targetSeconds)) : "—"}</td><td>${number(run.cost)}</td><td>${number(run.repairCost)}</td><td>${esc(JSON.stringify(run.parameters || {}))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="inspect-note">No model notebook has been generated yet.</p>'}<div class="inspect-section-label">Latest handoff status</div><p class="inspect-note">${esc(progress.forecastStatus || "No model handoff status recorded yet.")}</p>`;
  const activityBody = teamActivity.length ? `<div class="table-scroll"><table class="inspect-table"><thead><tr><th>Time</th><th>Event</th><th>Stage / payload</th></tr></thead><tbody>${teamActivity.map(item => `<tr><td>${esc(formatDate(item.createdAt))}</td><td>${esc(item.event)}</td><td>${esc(item.payload?.stage || JSON.stringify(item.payload || {}))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="inspect-note">No server activity recorded for this team yet.</p>';

  teamInspector.innerHTML = `<div class="inspector-summary">
    <div><small>TEAM</small><strong>${esc(selectedInspector)}</strong></div>
    <div><small>EVALUATION</small><strong class="accent-value">${standing.evaluation.toFixed(2)}</strong></div>
    <div><small>TOTAL</small><strong>${standing.total.toFixed(1)} / 400</strong></div>
    <div><small>CREDITS USED</small><strong>${standing.creditsUsed} / ${OVERALL_CREDIT_BUDGET}</strong></div>
    <div><small>RECORDED TIME</small><strong>${formatTime(standing.totalTime)}</strong></div>
    <div><small>COMPLETED</small><strong>${standing.completed} / 4</strong></div>
    <div><small>CURRENT STAGE</small><strong>${esc(stageNames[standing.currentStage] || standing.currentStage)}</strong></div>
  </div><div class="inspector-body">
    ${detail("event1", "Event 1 · Archive Reconstruction", `${stageNormalizedScore(selectedInspector, "event1").toFixed(1)} / 100`, event1Body)}
    ${detail("manual", "Event 2 · Manual Override", `${stageNormalizedScore(selectedInspector, "manual").toFixed(1)} / 100`, event2Body)}
    ${detail("features", "Event 3 · Feature Hunt", `${stageNormalizedScore(selectedInspector, "features").toFixed(1)} / 100`, event3Body)}
    ${detail("quality", "Event 4 · Repair + Model Handoff", `${stageNormalizedScore(selectedInspector, "quality").toFixed(1)} / 100`, event4Body)}
    ${detail("model", "Model notebook activity", `${forecastRuns.length} generated`, modelBody)}
    ${detail("activity", "Server activity trail", `${teamActivity.length} events`, activityBody)}
  </div>`;
  teamInspector.querySelectorAll("[data-inspect-detail]").forEach(node => {
    node.addEventListener("toggle", () => {
      if (node.open) inspectorOpen.add(node.dataset.inspectDetail);
      else inspectorOpen.delete(node.dataset.inspectDetail);
    });
  });
}

function selectInspector(player, scroll) {
  selectedInspector = player || "";
  renderInspectorSelector();
  renderTeamInspector();
  if (scroll && selectedInspector) document.querySelector(".inspector-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getEvent1Scores() {
  return getScores("event1").sort((a, b) => a.passed === b.passed ? number(a.timeTakenSeconds) - number(b.timeTakenSeconds) : Number(b.passed) - Number(a.passed));
}
function getRoomScores() {
  return getScores("manual").sort((a, b) => number(b.score) - number(a.score) || number(a.timeTakenSeconds) - number(b.timeTakenSeconds));
}
function getFeatureScores() {
  return getScores("features").sort((a, b) => number(b.score) - number(a.score) || number(a.timeTakenSeconds) - number(b.timeTakenSeconds));
}
function getQualityScores() {
  return getScores("quality").sort((a, b) => number(b.score) - number(a.score) || number(a.timeTakenSeconds) - number(b.timeTakenSeconds));
}

function renderEvent1Scoreboard() {
  const scores = getEvent1Scores();
  if (!scores.length) { event1Scoreboard.innerHTML = "<span>No Event 1 results yet.</span>"; return; }
  event1Scoreboard.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Team</th><th>Status</th><th>Time</th></tr></thead><tbody>${scores.map(team => `<tr><td>${esc(team.player)}</td><td>${team.passed ? "COMPLETED" : "FAILED"}</td><td>${formatTime(team.timeTakenSeconds)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderScoreboard() {
  const scores = getRoomScores();
  if (!scores.length) { scoreboard.innerHTML = "<span>No Event 2 results yet.</span>"; return; }
  scoreboard.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Team</th><th>Correct</th><th>Wrong</th><th>Blank</th><th>Score</th><th>Time</th></tr></thead><tbody>${scores.map(team => `<tr><td>${esc(team.player)}</td><td>+${number(team.correct)}</td><td>${number(team.wrong)}</td><td>${number(team.blank)}</td><td>${pct(team.score)}</td><td>${formatTime(team.timeTakenSeconds)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderFeatureScoreboard() {
  const scores = getFeatureScores();
  if (!scores.length) { featureScoreboard.innerHTML = "<span>No Event 3 results yet.</span>"; return; }
  featureScoreboard.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Team</th><th>Strong</th><th>Moderate</th><th>Weak</th><th>Points</th><th>Score</th><th>Credits</th><th>Time</th></tr></thead><tbody>${scores.map(team => `<tr><td>${esc(team.player)}</td><td>${number(team.strong)}</td><td>${number(team.moderate)}</td><td>${number(team.weak)}</td><td>${number(team.points)}/${number(team.maxPoints) || 20}</td><td>${pct(team.score)}</td><td>${number(team.credits)}</td><td>${formatTime(team.timeTakenSeconds)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderQualityScoreboard() {
  const scores = getQualityScores();
  if (!scores.length) { qualityScoreboard.innerHTML = "<span>No Event 4 results yet.</span>"; return; }
  qualityScoreboard.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Team</th><th>Status</th><th>Score</th><th>Round credits</th><th>Overall credits</th><th>Time</th></tr></thead><tbody>${scores.map(team => { const featureCredits = number(scoreFor(team.player, "features")?.credits); const overallCredits = featureCredits + number(team.credits); return `<tr><td>${esc(team.player)}</td><td>${esc(team.status || "IN PROGRESS")}</td><td>${pct(team.score)}</td><td>${number(team.credits)}</td><td>${overallCredits}/${OVERALL_CREDIT_BUDGET}</td><td>${formatTime(team.timeTakenSeconds)}</td></tr>`; }).join("")}</tbody></table></div>`;
}

function renderActivity() {
  if (!activityLog) return;
  const rows = room?.activity || [];
  activityLog.innerHTML = rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Time</th><th>Team</th><th>Event</th><th>Stage</th></tr></thead><tbody>${rows.map(item => `<tr><td>${esc(formatDate(item.createdAt))}</td><td>${esc(item.player || "HOST")}</td><td>${esc(item.event)}</td><td>${esc(item.payload?.stage || "room")}</td></tr>`).join("")}</tbody></table></div>` : "<span>No activity recorded yet.</span>";
}

function currentTime(progress) {
  const name = progress?.stage || "event1";
  const started = number(progress?.stageStartedAt?.[name]);
  return formatTime(progress?.[`${name}Result`]?.timeTakenSeconds ?? (started ? Math.floor((Date.now() - started) / 1000) : 0));
}

function playerScore(progress) {
  return progress?.qualityResult?.qualityScore ?? progress?.featureResult?.score ?? progress?.manualResult?.score ?? (progress?.event1Result ? (progress.event1Result.passed ? "PASSED" : "FAILED") : "—");
}

function renderStageControls() {
  if (!stageControls || !room) return;
  const global = room.stageUnlocks?.global || [];
  const manualDuration = Math.max(60, number(room.stageDurations?.manual || 20 * 60));
  const globalButtons = stageOrder.map(stage => `<button class="btn btn--ghost" data-unlock-stage="${stage}">${global.includes(stage) ? "Unlocked" : "Unlock"} ${stageNames[stage]}</button>`).join(" ");
  const rows = room.players.map(player => {
    const progress = room.progress?.[player.name] || {};
    const unlocked = [...global, ...(room.stageUnlocks?.players?.[player.name] || [])];
    return `<tr><td>${esc(player.name)}</td><td>${esc(stageNames[progress.stage] || "Stage 1 · Archive")}</td><td>${currentTime(progress)}</td><td>${esc(playerScore(progress))}</td><td>${stageOrder.map(stage => `<button class="btn btn--ghost" data-unlock-stage="${stage}" data-unlock-player="${esc(player.name)}" ${unlocked.includes(stage) ? "disabled" : ""}>${unlocked.includes(stage) ? "OPEN" : `OPEN ${stageNames[stage]}`}</button>`).join(" ")}</td></tr>`;
  }).join("");
  stageControls.innerHTML = `<div class="stage-actions">${globalButtons}</div><div class="stage-actions"><strong>Stage 2 time: ${Math.round(manualDuration / 60)} min</strong><button class="btn btn--ghost" data-stage2-time="-60">−1 min</button><button class="btn btn--ghost" data-stage2-time="60">+1 min</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Team</th><th>Current stage</th><th>Stage time</th><th>Score</th><th>Individual unlock</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No teams connected.</td></tr>'}</tbody></table></div>`;
  stageControls.querySelectorAll("[data-unlock-stage]").forEach(control => {
    control.onclick = async () => {
      control.disabled = true;
      try {
        show((await api({ action: "unlock", pin: room.pin, hostToken, stage: control.dataset.unlockStage, player: control.dataset.unlockPlayer || null })).room);
        message.textContent = "Stage access updated.";
      } catch (error) {
        message.textContent = error.message;
        control.disabled = false;
      }
    };
  });
  stageControls.querySelectorAll("[data-stage2-time]").forEach(control => {
    control.onclick = async () => {
      control.disabled = true;
      try {
        const durationSeconds = Math.max(60, Math.min(7200, manualDuration + Number(control.dataset.stage2Time || 0)));
        show((await api({ action: "setDuration", pin: room.pin, hostToken, stage: "manual", durationSeconds })).room);
        message.textContent = `Stage 2 time set to ${Math.round(durationSeconds / 60)} minutes.`;
      } catch (error) {
        message.textContent = error.message;
        control.disabled = false;
      }
    };
  });
}

function rememberRoom() {
  sessionStorage.setItem(hostStorageKey, JSON.stringify({ pin: room.pin, hostToken }));
}

function forgetRoom() {
  sessionStorage.removeItem(hostStorageKey);
}

function show(next) {
  room = next;
  rememberRoom();
  pin.innerHTML = `${room.pin.slice(0, 3)} ${room.pin.slice(3)} <span class="accent">${room.status === "started" ? "LIVE" : "READY"}</span>`;
  count.textContent = room.players.length;
  players.innerHTML = room.players.length ? room.players.map(item => `<span class="tag t-info">${esc(item.name)}</span>`).join(" ") : '<span class="tag t-old">Waiting for the first team…</span>';
  button.disabled = room.status !== "lobby" || room.players.length === 0;
  newRoomButton.disabled = false;
  closeRoomButton.disabled = false;
  if (room.status === "started") {
    button.textContent = "RESTORATION STARTED";
    message.textContent = "The room is live. New teams can join Event 1.";
  }
  renderStageControls();
  renderLeaderboard();
  renderInspectorSelector();
  renderTeamInspector();
  renderEvent1Scoreboard();
  renderScoreboard();
  renderFeatureScoreboard();
  renderQualityScoreboard();
  renderActivity();
}

async function refresh() {
  try {
    show((await api({ action: "get", pin: room.pin, hostToken })).room);
  } catch (error) {
    message.textContent = error.message;
    clearInterval(timer);
  }
}

async function createRoom() {
  const data = await api({ action: "create" });
  hostToken = data.hostToken;
  selectedInspector = "";
  inspectorOpen.clear();
  show(data.room);
  message.textContent = "Share this PIN. Only joined restoration teams appear here.";
  clearInterval(timer);
  timer = setInterval(refresh, 5000);
}

(async () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(hostStorageKey) || "null");
    if (saved?.pin && saved?.hostToken) {
      hostToken = saved.hostToken;
      show((await api({ action: "get", pin: saved.pin, hostToken })).room);
      message.textContent = "Room restored after refresh. Existing teams and scores remain connected.";
      timer = setInterval(refresh, 5000);
    } else {
      await createRoom();
    }
  } catch {
    forgetRoom();
    try {
      await createRoom();
    } catch (error) {
      pin.innerHTML = "ROOM<br><i>OFFLINE</i>";
      message.textContent = error.message;
    }
  }
})();

button.onclick = async () => {
  button.disabled = true;
  try { show((await api({ action: "start", pin: room.pin, hostToken })).room); }
  catch (error) { message.textContent = error.message; button.disabled = false; }
};

newRoomButton.onclick = async () => {
  if (!confirm("Close the current room and generate a new room PIN?")) return;
  newRoomButton.disabled = true;
  try {
    if (room) await api({ action: "close", pin: room.pin, hostToken });
    forgetRoom();
    await createRoom();
  } catch (error) {
    message.textContent = error.message;
    newRoomButton.disabled = false;
  }
};

closeRoomButton.onclick = async () => {
  if (!confirm("Close this room? Its scores and audit history will remain in SQLite.")) return;
  closeRoomButton.disabled = true;
  try {
    await api({ action: "close", pin: room.pin, hostToken });
    clearInterval(timer);
    forgetRoom();
    button.disabled = true;
    newRoomButton.disabled = false;
    pin.innerHTML = `${room.pin.slice(0, 3)} ${room.pin.slice(3)} <span class="accent">CLOSED</span>`;
    message.textContent = "Room closed. Scores and audit history remain available in the local database.";
  } catch (error) {
    message.textContent = error.message;
    closeRoomButton.disabled = false;
  }
};
