import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../db/sqlite.js";
import roomHandler from "../api/room.js";

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("host room can be restored after refresh and explicitly closed without deleting history", async () => {
  const created = response();
  await roomHandler({ method: "POST", body: { action: "create" } }, created);
  assert.equal(created.statusCode, 201);
  const { room, hostToken } = created.body;
  const restored = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin } }, restored);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.room.pin, room.pin);
  const player = response();
  await roomHandler({ method: "POST", body: { action: "join", pin: room.pin, player: "archive-team" } }, player);
  assert.equal(player.statusCode, 200);
  const started = response();
  await roomHandler({ method: "POST", body: { action: "start", pin: room.pin, hostToken } }, started);
  assert.equal(started.statusCode, 200);
  const latePlayer = response();
  await roomHandler({ method: "POST", body: { action: "join", pin: room.pin, player: "late-team" } }, latePlayer);
  assert.equal(latePlayer.statusCode, 200);
  const progress = response();
  await roomHandler({ method: "POST", body: { action: "saveProgress", pin: room.pin, player: "archive-team", progress: { stage: "event1", selectedFeatures: ["vehicle_count"] } } }, progress);
  assert.equal(progress.statusCode, 200);

  const publicView = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin } }, publicView);
  assert.deepEqual(publicView.body.room.progress, {});
  assert.deepEqual(publicView.body.room.scores, []);
  assert.deepEqual(publicView.body.room.activity, []);

  const playerView = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin, player: "archive-team" } }, playerView);
  assert.deepEqual(Object.keys(playerView.body.room.progress), ["archive-team"]);
  assert.deepEqual(playerView.body.room.progress["archive-team"].selectedFeatures, ["vehicle_count"]);

  const hostView = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin, hostToken } }, hostView);
  assert.equal(hostView.statusCode, 200);
  assert.ok(hostView.body.room.progress["archive-team"]);
  assert.ok(Array.isArray(hostView.body.room.activity));

  const badHost = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin, hostToken: "wrong-token" } }, badHost);
  assert.equal(badHost.statusCode, 409);

  const closed = response();
  await roomHandler({ method: "POST", body: { action: "close", pin: room.pin, hostToken } }, closed);
  assert.equal(closed.statusCode, 200);
  assert.ok(database.prepare("SELECT 1 FROM game_rooms WHERE pin = ?").get(room.pin));
  const unavailable = response();
  await roomHandler({ method: "POST", body: { action: "get", pin: room.pin } }, unavailable);
  assert.equal(unavailable.statusCode, 404);
  database.prepare("DELETE FROM game_rooms WHERE pin = ?").run(room.pin);
});
