import { clean, json } from "./_gateway.js";

const REQUIRED_FILES = [
  "JTU7_stream_A_core_20260314_0314_gen3.csv",
  "JTU7_stream_B_context_20260314_0314_gen3.csv",
  "JTU7_stream_C_labels_20260314_0314_gen3.csv"
];

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });

  const room = clean(req.body?.room, 16);
  const player = clean(req.body?.player, 20);
  if (!room || !player) return json(res, 400, { error: "room and player are required" });

  const files = Array.isArray(req.body?.files) ? req.body.files.map(file => String(file).trim()) : [];
  const timeTakenSeconds = Number(req.body?.timeTakenSeconds ?? 0);

  if (!files.length || files.length !== REQUIRED_FILES.length || !REQUIRED_FILES.every(file => files.includes(file))) {
    const isTimeout = Number(timeTakenSeconds) >= 900;
    if (isTimeout) {
      return json(res, 200, {
        passed: false,
        status: "failed",
        timeTakenSeconds,
        message: "15 minutes expired. Archive reconstruction failed. Event 2 opened with the supplied train data."
      });
    }
    return json(res, 400, { error: "Required archive bundle is incomplete. Choose the three matching recovery fragments." });
  }

  return json(res, 200, {
    passed: true,
    status: "completed",
    timeTakenSeconds,
    message: "Archive reconstruction succeeded. The selected recovery bundle was verified."
  });
}
