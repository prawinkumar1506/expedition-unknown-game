import { clean, json } from "./_gateway.js";
import { assignment } from "./_event.js";
import { prepareDatasets } from "./_dataset.js";
import { verifyState } from "./_state.js";

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), stage = clean(req.body?.stage, 16);
  if (!room || !player) return json(res, 400, { error: "Room and player are required." });
  try {
    const event = assignment(room);
    if (stage === "features") {
      const state = verifyState(req.body?.featureState, "features", room, player);
      const prepared = prepareDatasets({ trainRows: event.trainDamaged, testRows: event.test, features: state.selected });
      return json(res, 200, { stage, trainFilename: "train_ready.csv", testFilename: "test_ready.csv", summary: prepared.summary });
    }
    if (stage === "quality") {
      const state = verifyState(req.body?.qualityState, "quality", room, player), emergency = Boolean(state.emergencyFeed);
      const prepared = prepareDatasets({
        trainRows: emergency ? event.trainBackup : event.trainDamaged,
        testRows: emergency ? event.testBackup : event.test,
        features: state.features,
        repairs: state.repairs,
        methods: state.methods
      });
      const payload = {
        stage,
        trainFilename: "train_ready.csv",
        testFilename: "test_ready.csv",
        summary: prepared.summary
      };
      if (req.body?.includeContent) Object.assign(payload, { trainCsv: prepared.trainCsv, testCsv: prepared.testCsv });
      return json(res, 200, payload);
    }
    return json(res, 400, { error: "Choose features or quality dataset stage." });
  } catch (error) {
    const message = ["STATE_REQUIRED", "INVALID_STATE"].includes(error.message) ? "The dataset state could not be verified. Reload the mission." : error.message;
    return json(res, 409, { error: message });
  }
}
