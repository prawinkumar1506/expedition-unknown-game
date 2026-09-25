import test from "node:test";
import assert from "node:assert/strict";
import { autoMapKaggleTeams, parseKaggleResultsCsv } from "../public/kaggle-results.js";

const csv = `DateSubmitted,SubmissionId,TeamId,UserName,TeamName,IsSelected,PublicScore,PrivateScore
2026-09-22 05:59:46,1,10,user_a,Alpha,False,0.70,0.71
2026-09-22 06:14:11,2,10,user_a,Alpha,True,0.77,0.78
2026-09-22 06:25:00,3,10,user_a,Alpha,True,0.76,0.77
2026-09-22 11:46:33,4,20,user_b,"Beta, Team",False,0.81,0.82
2026-09-23 14:34:45,5,20,user_b,"Beta, Team",False,0.40,0.41`;

test("Kaggle import prefers the best selected submission and falls back to best score", () => {
  const rows = parseKaggleResultsCsv(csv, "PrivateScore");
  assert.equal(rows.length, 2);
  const alpha = rows.find(row => row.teamName === "Alpha");
  const beta = rows.find(row => row.teamName === "Beta, Team");
  assert.equal(alpha.score, 0.78);
  assert.equal(alpha.usedSelectedSubmission, true);
  assert.equal(alpha.selectedCount, 2);
  assert.equal(beta.score, 0.82);
  assert.equal(beta.usedSelectedSubmission, false);
});

test("Kaggle import can switch between private and public score", () => {
  const rows = parseKaggleResultsCsv(csv, "PublicScore");
  assert.equal(rows.find(row => row.teamName === "Alpha").score, 0.77);
  assert.equal(rows.find(row => row.teamName === "Beta, Team").score, 0.81);
});

test("Kaggle teams auto-map to room teams with case and punctuation normalization", () => {
  const rows = parseKaggleResultsCsv(csv);
  const mapping = autoMapKaggleTeams(rows, ["ALPHA", "Beta Team", "Other"]);
  assert.equal(mapping.Alpha, "ALPHA");
  assert.equal(mapping["Beta, Team"], "Beta Team");
});
