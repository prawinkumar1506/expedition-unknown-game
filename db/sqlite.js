import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databasePath = process.env.CLEARWAY_DB_PATH || path.join(root, "data", "clearway.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS game_rooms (
    pin TEXT PRIMARY KEY CHECK (length(pin) = 6),
    host_token TEXT NOT NULL UNIQUE,
    mission_seed TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'started')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_players (
    room_pin TEXT NOT NULL REFERENCES game_rooms(pin) ON DELETE CASCADE,
    name TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (room_pin, name)
  );
  CREATE TABLE IF NOT EXISTS game_progress (
    room_pin TEXT NOT NULL,
    player_name TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (room_pin, player_name),
    FOREIGN KEY (room_pin, player_name) REFERENCES game_players(room_pin, name) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_stage_unlocks (
    room_pin TEXT NOT NULL REFERENCES game_rooms(pin) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    player_name TEXT,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (room_pin, stage, player_name)
  );
  CREATE TABLE IF NOT EXISTS game_evaluations (
    room_pin TEXT NOT NULL,
    player_name TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 8),
    PRIMARY KEY (room_pin, player_name),
    FOREIGN KEY (room_pin, player_name) REFERENCES game_players(room_pin, name) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_scores (
    room_pin TEXT NOT NULL REFERENCES game_rooms(pin) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('event1', 'manual', 'features', 'quality', 'forecast')),
    score REAL,
    points REAL,
    max_points REAL,
    credits REAL,
    time_taken_seconds REAL,
    status TEXT,
    payload TEXT NOT NULL,
    submitted_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (room_pin, player_name, stage),
    FOREIGN KEY (room_pin, player_name) REFERENCES game_players(room_pin, name) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS game_scores_room_stage_idx ON game_scores(room_pin, stage, updated_at);
  CREATE TABLE IF NOT EXISTS game_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_pin TEXT NOT NULL REFERENCES game_rooms(pin) ON DELETE CASCADE,
    player_name TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_activity_room_idx ON game_activity_log(room_pin, created_at);
`);

export function transaction(callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function logActivity(roomPin, playerName, eventType, payload = {}) {
  database.prepare("INSERT INTO game_activity_log (room_pin, player_name, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(roomPin, playerName || null, eventType, JSON.stringify(payload), Date.now());
}

export { databasePath };