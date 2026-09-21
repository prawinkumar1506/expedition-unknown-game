import { clean, json } from "./_gateway.js";
import { randomUUID } from "node:crypto";
import { database, logActivity, transaction } from "../db/sqlite.js";

const pin = () => String(Math.floor(100000 + Math.random() * 900000));
const stages = new Set(["event1", "manual", "features", "quality", "forecast"]);
const roomRow = roomPin => database.prepare("SELECT pin, status, mission_seed, host_token, expires_at FROM game_rooms WHERE pin = ? AND expires_at > ?").get(roomPin, Date.now());
const expose = (room, { host = false, player = null } = {}) => {
  if (!room) return null;
  const players = database.prepare("SELECT name, joined_at AS joinedAt FROM game_players WHERE room_pin = ? ORDER BY joined_at").all(room.pin);
  const progressRows = host
    ? database.prepare("SELECT player_name, payload FROM game_progress WHERE room_pin = ?").all(room.pin)
    : player
      ? database.prepare("SELECT player_name, payload FROM game_progress WHERE room_pin = ? AND player_name = ?").all(room.pin, player)
      : [];
  const progress = Object.fromEntries(progressRows.map(row => [row.player_name, JSON.parse(row.payload)]));
  const scores = host ? database.prepare("SELECT stage, player_name AS player, score, points, max_points AS maxPoints, credits, time_taken_seconds AS timeTakenSeconds, status, payload, submitted_at AS submittedAt, updated_at AS updatedAt FROM game_scores WHERE room_pin = ? ORDER BY stage, updated_at, player_name").all(room.pin).map(row => ({ ...row, ...JSON.parse(row.payload) })) : [];
  const activity = host ? database.prepare("SELECT id, player_name AS player, event_type AS event, payload, created_at AS createdAt FROM game_activity_log WHERE room_pin = ? ORDER BY id DESC LIMIT 500").all(room.pin).map(row => ({ ...row, payload: JSON.parse(row.payload) })) : [];
  const stageUnlocks = { global: [], players: {} };
  for (const row of database.prepare("SELECT stage, player_name FROM game_stage_unlocks WHERE room_pin = ? ORDER BY unlocked_at").all(room.pin)) {
    if (row.player_name === null) stageUnlocks.global.push(row.stage);
    else if (host || row.player_name === player) (stageUnlocks.players[row.player_name] ||= []).push(row.stage);
  }
  return { pin: room.pin, status: room.status, missionSeed: room.mission_seed, players, stageUnlocks, progress, scores, activity };
};
const requireRoom = body => {
  const roomPin = clean(body.pin, 6);
  if (!roomPin) throw Object.assign(new Error("valid room PIN required"), { status: 400 });
  const room = roomRow(roomPin);
  if (!room) throw Object.assign(new Error("Room not found"), { status: 404 });
  return room;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const action = clean(req.body?.action, 12);
  try {
    if (action === "create") {
      return json(res, 201, transaction(() => { let roomPin; do roomPin = pin(); while (database.prepare("SELECT 1 FROM game_rooms WHERE pin = ?").get(roomPin)); const hostToken = randomUUID(); const now = Date.now(); database.prepare("INSERT INTO game_rooms (pin, host_token, mission_seed, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(roomPin, hostToken, randomUUID(), now + 14_400_000, now); database.prepare("INSERT INTO game_stage_unlocks (room_pin, stage, player_name, unlocked_at) VALUES (?, 'event1', NULL, ?)").run(roomPin, now); logActivity(roomPin, null, "room_created", {}); return { room: expose(roomRow(roomPin), { host: true }), hostToken }; }));
    }
    const room = requireRoom(req.body || {}), roomPin = room.pin;
    if (action === "get") {
      const suppliedHostToken = req.body?.hostToken;
      if (suppliedHostToken && suppliedHostToken !== room.host_token) return json(res, 409, { error: "Host authority could not be verified" });
      const player = clean(req.body?.player, 20);
      if (player && !database.prepare("SELECT 1 FROM game_players WHERE room_pin = ? AND name = ?").get(roomPin, player)) return json(res, 409, { error: "Player is not in this room" });
      return json(res, 200, { room: expose(room, { host: Boolean(suppliedHostToken), player }) });
    }
    if (action === "close") { if (req.body.hostToken !== room.host_token) return json(res, 409, { error: "Only the room host can close this room" }); logActivity(roomPin, null, "room_closed", {}); database.prepare("UPDATE game_rooms SET expires_at = ? WHERE pin = ?").run(Date.now(), roomPin); return json(res, 200, { closed: true, pin: roomPin }); }
    if (action === "join") { const name = clean(req.body?.player, 20); if (!name) return json(res, 400, { error: "player name required" }); const joinedAt = Date.now(); const result = database.prepare("INSERT OR IGNORE INTO game_players (room_pin, name, joined_at) VALUES (?, ?, ?)").run(roomPin, name, joinedAt); if (result.changes) logActivity(roomPin, name, room.status === "started" ? "player_joined_live_room" : "player_joined", {}); return json(res, 200, { room: expose(roomRow(roomPin), { player: name }) }); }
    if (action === "start") { if (req.body.hostToken !== room.host_token) return json(res, 409, { error: "Only the room host can start this game" }); database.prepare("UPDATE game_rooms SET status = 'started' WHERE pin = ?").run(roomPin); logActivity(roomPin, null, "room_started", {}); return json(res, 200, { room: expose(roomRow(roomPin), { host: true }) }); }
    if (action === "saveProgress") { const player = clean(req.body?.player, 20), progress = req.body?.progress; if (!player || !progress || typeof progress !== "object") return json(res, 400, { error: "player progress required" }); if (!database.prepare("SELECT 1 FROM game_players WHERE room_pin = ? AND name = ?").get(roomPin, player)) return json(res, 409, { error: "Player is not in this room" }); database.prepare("INSERT INTO game_progress (room_pin, player_name, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_pin, player_name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").run(roomPin, player, JSON.stringify(progress), Date.now()); return json(res, 200, { room: expose(roomRow(roomPin), { player }) }); }
    if (action === "unlock") { if (req.body.hostToken !== room.host_token) return json(res, 409, { error: "Only the room host can unlock stages" }); const stage = clean(req.body.stage, 20), player = req.body.player ? clean(req.body.player, 20) : null; if (!stages.has(stage)) return json(res, 400, { error: "invalid stage" }); database.prepare("INSERT OR IGNORE INTO game_stage_unlocks (room_pin, stage, player_name, unlocked_at) VALUES (?, ?, ?, ?)").run(roomPin, stage, player, Date.now()); return json(res, 200, { room: expose(roomRow(roomPin), { host: true }) }); }
    return json(res, 400, { error: "unknown room action" });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Room database error" });
  }
}
