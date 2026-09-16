import { clean, json } from "./_gateway.js";
import { database, logActivity, transaction } from "../db/sqlite.js";

const stages = new Set(["event1", "manual", "features", "quality", "forecast"]);
const numeric = value => value === undefined || value === null || value === "" ? null : Number(value);
const roomExists = room => database.prepare("SELECT pin FROM game_rooms WHERE pin = ? AND expires_at > ?").get(room, Date.now());
const playerExists = (room, player) => database.prepare("SELECT 1 FROM game_players WHERE room_pin = ? AND name = ?").get(room, player);
const decode = row => ({
  room: row.room_pin,
  player: row.player_name,
  stage: row.stage,
  score: row.score,
  points: row.points,
  maxPoints: row.max_points,
  credits: row.credits,
  timeTakenSeconds: row.time_taken_seconds,
  status: row.status,
  submittedAt: row.submitted_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...JSON.parse(row.payload)
});

export default function handler(req, res) {
  const body = req.body || {};
  const url = new URL(req.url || "/api/scores", "http://localhost");
  const room = clean(req.method === "GET" ? url.searchParams.get("room") : body.room, 6);
  if (!room) return json(res, 400, { error: "room is required" });
  if (!roomExists(room)) return json(res, 404, { error: "Room not found" });

  if (req.method === "GET") {
    const stage = clean(url.searchParams.get("stage"), 20);
    const rows = database.prepare(`SELECT * FROM game_scores WHERE room_pin = ? ${stages.has(stage) ? "AND stage = ?" : ""} ORDER BY stage, updated_at, player_name`).all(...(stages.has(stage) ? [room, stage] : [room]));
    const activity = database.prepare("SELECT id, player_name AS player, event_type AS event, payload, created_at AS createdAt FROM game_activity_log WHERE room_pin = ? ORDER BY id DESC LIMIT 500").all(room).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
    return json(res, 200, { room, scores: rows.map(decode), activity });
  }
  if (req.method !== "POST") return json(res, 405, { error: "GET or POST required" });

  const player = clean(body.player, 20), stage = clean(body.stage, 20), payload = body.payload;
  if (!player || !stages.has(stage) || !payload || typeof payload !== "object" || Array.isArray(payload)) return json(res, 400, { error: "room, player, stage, and score payload are required" });
  if (!playerExists(room, player)) return json(res, 409, { error: "Player is not in this room" });
  const now = Date.now();
  const record = {
    score: numeric(payload.score),
    points: numeric(payload.points),
    maxPoints: numeric(payload.maxPoints),
    credits: numeric(payload.credits),
    timeTakenSeconds: numeric(payload.timeTakenSeconds),
    status: payload.status == null ? null : String(payload.status).slice(0, 40)
  };
  transaction(() => {
    database.prepare(`INSERT INTO game_scores (room_pin, player_name, stage, score, points, max_points, credits, time_taken_seconds, status, payload, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_pin, player_name, stage) DO UPDATE SET score = excluded.score, points = excluded.points, max_points = excluded.max_points, credits = excluded.credits, time_taken_seconds = excluded.time_taken_seconds, status = excluded.status, payload = excluded.payload, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at`).run(room, player, stage, record.score, record.points, record.maxPoints, record.credits, record.timeTakenSeconds, record.status, JSON.stringify(payload), now, now, now);
    logActivity(room, player, "score_submitted", { stage, payload });
  });
  const row = database.prepare("SELECT * FROM game_scores WHERE room_pin = ? AND player_name = ? AND stage = ?").get(room, player, stage);
  return json(res, 200, { score: decode(row) });
}