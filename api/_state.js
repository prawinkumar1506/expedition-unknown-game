import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => process.env.CLEARWAY_STATE_SECRET || process.env.MATCH_GATEWAY_SECRET || "clearway-local-state";
const sign = payload => createHmac("sha256", secret()).update(payload).digest("base64url");

export function packState(kind, state) {
  const payload = Buffer.from(JSON.stringify({ kind, ...state })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyState(token, kind, room, player) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw new Error("STATE_REQUIRED");
  const expected = sign(payload), left = Buffer.from(signature), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("INVALID_STATE");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (state.kind !== kind || state.room !== room || state.player !== player) throw new Error("INVALID_STATE");
  return state;
}
