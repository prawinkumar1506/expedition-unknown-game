const REQUIRED_COLUMNS = ["DateSubmitted", "SubmissionId", "TeamId", "UserName", "TeamName", "IsSelected", "PublicScore", "PrivateScore"];

export function normalizeTeamName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsvRows(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(items => items.some(item => String(item).trim() !== ""));
}

const asBoolean = value => ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
const asScore = value => {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
};

export function parseKaggleResultsCsv(text, scoreField = "PrivateScore") {
  if (!["PrivateScore", "PublicScore"].includes(scoreField)) throw new Error("Unsupported Kaggle score field.");
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The Kaggle CSV has no submission rows.");
  const headers = rows[0].map(value => String(value).trim());
  const missing = REQUIRED_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) throw new Error(`Kaggle CSV is missing columns: ${missing.join(", ")}`);
  const positions = Object.fromEntries(headers.map((header, index) => [header, index]));
  const submissions = rows.slice(1).map(values => ({
    dateSubmitted: values[positions.DateSubmitted] || "",
    submissionId: values[positions.SubmissionId] || "",
    teamId: values[positions.TeamId] || "",
    userName: values[positions.UserName] || "",
    teamName: String(values[positions.TeamName] || "").trim(),
    isSelected: asBoolean(values[positions.IsSelected]),
    publicScore: asScore(values[positions.PublicScore]),
    privateScore: asScore(values[positions.PrivateScore])
  })).filter(item => item.teamName);

  const groups = new Map();
  for (const submission of submissions) {
    const key = submission.teamName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(submission);
  }

  const chosen = [];
  for (const [teamName, teamSubmissions] of groups) {
    const scoreKey = scoreField === "PrivateScore" ? "privateScore" : "publicScore";
    const selected = teamSubmissions.filter(item => item.isSelected && item[scoreKey] !== null);
    const pool = selected.length ? selected : teamSubmissions.filter(item => item[scoreKey] !== null);
    if (!pool.length) continue;
    const best = [...pool].sort((a, b) => {
      const scoreDelta = Number(b[scoreKey]) - Number(a[scoreKey]);
      if (scoreDelta) return scoreDelta;
      return String(b.dateSubmitted).localeCompare(String(a.dateSubmitted));
    })[0];
    chosen.push({
      ...best,
      scoreField,
      score: Number(best[scoreKey]),
      submissionCount: teamSubmissions.length,
      selectedCount: selected.length,
      usedSelectedSubmission: selected.length > 0
    });
  }
  return chosen.sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName));
}

export function autoMapKaggleTeams(kaggleRows, playerNames, existing = {}) {
  const mapping = { ...existing };
  const normalizedPlayers = new Map();
  for (const player of playerNames) {
    const key = normalizeTeamName(player);
    if (!normalizedPlayers.has(key)) normalizedPlayers.set(key, []);
    normalizedPlayers.get(key).push(player);
  }
  for (const row of kaggleRows) {
    if (mapping[row.teamName]) continue;
    const matches = normalizedPlayers.get(normalizeTeamName(row.teamName)) || [];
    if (matches.length === 1) mapping[row.teamName] = matches[0];
  }
  return mapping;
}
