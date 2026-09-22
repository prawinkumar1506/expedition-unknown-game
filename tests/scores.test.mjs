import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../db/sqlite.js";
import scoresHandler from "../api/scores.js";

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("scores endpoint persists normalized score rows and activity records", async () => {
  const room = String(Math.floor(100000 + Math.random() * 900000));
  const player = `score-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  database.prepare("INSERT INTO game_rooms (pin, host_token, mission_seed, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(room, randomUUID(), randomUUID(), now + 60_000, now);
  database.prepare("INSERT INTO game_players (room_pin, name, joined_at) VALUES (?, ?, ?)").run(room, player, now);
  try {
    const write = response();
    await scoresHandler({ method: "POST", body: { room, player, stage: "quality", payload: { score: 74, credits: 12, timeTakenSeconds: 91 } }, url: "/api/scores" }, write);
    assert.equal(write.statusCode, 200);
    assert.equal(write.body.score.score, 74);

    const read = response();
    await scoresHandler({ method: "GET", body: {}, url: `/api/scores?room=${room}` }, read);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.body.scores.map(item => item.stage), ["quality"]);
    assert.equal(read.body.scores[0].credits, 12);
    assert.equal(read.body.activity[0].event, "score_submitted");
  } finally {
    database.prepare("DELETE FROM game_rooms WHERE pin = ?").run(room);
  }
});
