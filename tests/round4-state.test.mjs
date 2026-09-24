import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { MODEL_CATALOG, ROUND4, searchPlan } from "../public/round4-config.js";
import { buildKaggleScript, kaggleFilename, normalizeTuning } from "../public/kaggle-export.js";

// Exercise the actual client state transitions with a fixed clock and stubbed I/O.
const source = (await readFile(new URL("../public/game.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "").split('Promise.all([request("/api/mission"')[0];
function client({ elapsed = 0, completed = false, failSave = false } = {}) {
  const now = 10_000_000, calls = [], nodes = new Map();
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { querySelectorAll: () => [], classList: { toggle() {} } });
      return nodes.get(selector);
    },
    querySelectorAll: () => [], addEventListener() {}
  };
  const context = vm.createContext({
    modelCatalog: MODEL_CATALOG, ROUND4, searchPlan, buildKaggleScript, kaggleFilename, normalizeTuning,
    Date: class extends Date { static now() { return now; } }, document,
    window: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {},
    sessionStorage: { getItem: () => JSON.stringify({ room: "test", player: "review" }) },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: async (path, options) => {
      calls.push({ path, body: JSON.parse(options.body) });
      return { ok: !failSave, json: async () => failSave ? { error: "Temporary save failure" } : {} };
    }
  });
  vm.runInContext(source + `
    render = () => {};
    applyState({ stage: 'quality', stageStartedAt: { quality: ${now - elapsed * 1000} },
      forecastRuns: [{cost: 8, repairCost: 3}], kaggleSubmitted: true,
      qualityResult: {qualityScore: 75, repairSpend: 3, status: '${completed ? "COMPLETED" : "IN_PROGRESS"}', timeTakenSeconds: ${elapsed}} });
    globalThis.state = { submitEvent4, startQualityTimer, round4Closed, serializeState, formatQualityCountdown,
      restore: applyState, round4CreditsRemaining,
      clock: () => qualityTimeSpentSec };
  `, context);
  return { ...context.state, calls, nodes };
}

test("Round 4 restores a consistent 90-minute countdown and permits immediate completion", async () => {
  const session = client({ elapsed: 0 });
  assert.equal(session.formatQualityCountdown(), "90:00");
  await session.submitEvent4();
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].path, "/api/scores");
  assert.equal(session.serializeState().forecastLocked, true);
});

test("Round 4 completion persists full elapsed time and credits before locking", async () => {
  const session = client({ elapsed: 3700 });
  await session.submitEvent4();
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].path, "/api/scores");
  assert.equal(session.calls[0].body.stage, "quality");
  assert.equal(session.calls[0].body.payload.timeTakenSeconds, 3700);
  assert.equal(session.calls[0].body.payload.credits, 11);
  assert.equal(session.calls[0].body.payload.status, "COMPLETED");
  assert.equal(session.round4Closed(), true);
  const restored = client({ elapsed: 3700, completed: true });
  restored.startQualityTimer();
  assert.equal(restored.formatQualityCountdown(), "28:20");
  assert.equal(restored.round4Closed(), true);
});

test("Round 4 uses one cumulative 200-credit wallet across downloaded experiments", () => {
  const session = client({ elapsed: 100 });
  session.restore({ stage: "quality", stageStartedAt: { quality: 9_900_000 }, forecastRuns: [
    { cost: 19, repairCost: 12 },
    { cost: 19, repairCost: 12 }
  ] });
  assert.equal(session.round4CreditsRemaining(), 138);
});

test("Round 4 remains retryable if score persistence fails", async () => {
  const session = client({ elapsed: 3700, failSave: true });
  await assert.rejects(session.submitEvent4(), /Temporary save failure/);
  assert.equal(session.round4Closed(), false);
  assert.notEqual(session.serializeState().qualityResult.status, "COMPLETED");
});

test("Round 4 closes at 90 minutes even after reloading an expired session", async () => {
  const session = client({ elapsed: 5500 });
  session.startQualityTimer();
  assert.equal(session.clock(), 5400);
  assert.equal(session.formatQualityCountdown(), "00:00");
  assert.equal(session.round4Closed(), true);
  await session.submitEvent4();
  assert.equal(session.calls.length, 0);
});
