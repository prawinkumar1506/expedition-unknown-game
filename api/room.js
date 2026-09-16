import { clean, json } from "./_gateway.js";
import { randomUUID } from "node:crypto";
import { database, transaction } from "../db/sqlite.js";

const pin = () => String(Math.floor(100000 + Math.random() * 900000));
const stages = new Set(["event1", "manual", "features", "quality", "forecast"]);
const roomRow = roomPin => database.prepare("SELECT pin, status, mission_seed, host_token, expires_at FROM game_rooms WHERE pin = ? AND expires_at > ?").get(roomPin, Date.now());
const expose = room => {
  if (!room) return null;
  const players = database.prepare("SELECT name, joined_at AS joinedAt FROM game_players WHERE room_pin = ? ORDER BY joined_at").all(room.pin);
  const progress = Object.fromEntries(database.prepare("SELECT player_name, payload FROM game_progress WHERE room_pin = ?").all(room.pin).map(row => [row.player_name, JSON.parse(row.payload)]));
  const stageUnlocks = { global: [], players: {} };
  for (const row of database.prepare("SELECT stage, player_name FROM game_stage_unlocks WHERE room_pin = ? ORDER BY unlocked_at").all(room.pin)) {
    if (row.player_name === null) stageUnlocks.global.push(row.stage);
    else (stageUnlocks.players[row.player_name] ||= []).push(row.stage);
  }
  return { pin: room.pin, status: room.status, missionSeed: room.mission_seed, players, stageUnlocks, progress };
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
      return json(res, 201, transaction(() => { let roomPin; do roomPin = pin(); while (database.prepare("SELECT 1 FROM game_rooms WHERE pin = ?").get(roomPin)); const hostToken = randomUUID(); const now = Date.now(); database.prepare("INSERT INTO game_rooms (pin, host_token, mission_seed, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(roomPin, hostToken, randomUUID(), now + 14_400_000, now); database.prepare("INSERT INTO game_stage_unlocks (room_pin, stage, player_name, unlocked_at) VALUES (?, 'event1', NULL, ?)").run(roomPin, now); return { room: expose(roomRow(roomPin)), hostToken }; }));
    }
    const room = requireRoom(req.body || {}), roomPin = room.pin;
    if (action === "get") return json(res, 200, { room: expose(room) });
    if (action === "join") { const name = clean(req.body?.player, 20); if (!name) return json(res, 400, { error: "player name required" }); if (room.status !== "lobby") return json(res, 409, { error: "This game has already started" }); database.prepare("INSERT OR IGNORE INTO game_players (room_pin, name, joined_at) VALUES (?, ?, ?)").run(roomPin, name, Date.now()); return json(res, 200, { room: expose(roomRow(roomPin)) }); }
    if (action === "start") { if (req.body.hostToken !== room.host_token) return json(res, 409, { error: "Only the room host can start this game" }); database.prepare("UPDATE game_rooms SET status = 'started' WHERE pin = ?").run(roomPin); return json(res, 200, { room: expose(roomRow(roomPin)) }); }
    if (action === "saveProgress") { const player = clean(req.body?.player, 20), progress = req.body?.progress; if (!player || !progress || typeof progress !== "object") return json(res, 400, { error: "player progress required" }); if (!database.prepare("SELECT 1 FROM game_players WHERE room_pin = ? AND name = ?").get(roomPin, player)) return json(res, 409, { error: "Player is not in this room" }); database.prepare("INSERT INTO game_progress (room_pin, player_name, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_pin, player_name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").run(roomPin, player, JSON.stringify(progress), Date.now()); return json(res, 200, { room: expose(roomRow(roomPin)) }); }
    if (action === "unlock") { if (req.body.hostToken !== room.host_token) return json(res, 409, { error: "Only the room host can unlock stages" }); const stage = clean(req.body.stage, 20), player = req.body.player ? clean(req.body.player, 20) : null; if (!stages.has(stage)) return json(res, 400, { error: "invalid stage" }); database.prepare("INSERT OR IGNORE INTO game_stage_unlocks (room_pin, stage, player_name, unlocked_at) VALUES (?, ?, ?, ?)").run(roomPin, stage, player, Date.now()); return json(res, 200, { room: expose(roomRow(roomPin)) }); }
    return json(res, 400, { error: "unknown room action" });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Room database error" });
  }
}
