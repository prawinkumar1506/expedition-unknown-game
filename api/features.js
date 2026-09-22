import { clean, json } from "./_gateway.js";
import { assignment } from "./_event.js";
import { verifyAnalysisState } from "./analyze.js";
import { packState } from "./_state.js";

const round = value => Number(value.toFixed(1));

const weightForFeature = feature => {
  const strength = String(feature?.intended_strength || "weak").toLowerCase();
  if (strength === "strong") return 1;
  if (strength === "moderate") return 3;
  return 6;
};

const seededRandom = seed => {
  let value = 0;
  for (const character of seed) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 0x100000000);
};

const completeSelection = (selected, features, strength, seed) => {
  const result = [...selected], random = seededRandom(seed);
  while (result.length < 10) {
    const candidates = features.filter(feature => !result.includes(feature));
    const totalWeight = candidates.reduce((sum, feature) => sum + weightForFeature(strength[feature]), 0);
    let target = random() * totalWeight;
    const chosen = candidates.find(feature => (target -= weightForFeature(strength[feature])) < 0) || candidates[candidates.length - 1];
    result.push(chosen);
  }
  return result;
};

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20);
  const requested = Array.isArray(req.body?.features) ? req.body.features.map(value => clean(value, 48)) : [];
  if (!room || !player || requested.length > 10 || new Set(requested).size !== requested.length) return json(res, 400, { error: "Lock at most 10 unique telemetry channels." });
  const event = assignment(room);
  try {
    const ledger = verifyAnalysisState(req.body?.analysisState, room, player);
    if (requested.some(feature => !event.features.includes(feature))) return json(res, 400, { error: "The channel set contains an unavailable telemetry channel." });
    const selected = completeSelection(requested, event.features, event.featureStrength, `${room}:${player}`);
    const autoSelected = selected.filter(feature => !requested.includes(feature));
    const strengthFor = feature => event.featureStrength[feature]?.intended_strength || "weak";
    const strongCount = selected.filter(feature => strengthFor(feature) === "strong").length;
    const moderateCount = selected.filter(feature => strengthFor(feature) === "moderate").length;
    const weakCount = selected.filter(feature => strengthFor(feature) === "weak").length;
    const rawPointsEarned = strongCount * 2 + moderateCount;
    const penalty = autoSelected.length * 2;
    const pointsEarned = Math.max(0, rawPointsEarned - penalty);
    const maxPoints = 20;
    const score = round((pointsEarned / maxPoints) * 100);
    const investigationTypes = new Set(ledger.purchases.map(key => key.split(":")[1])).size;
    const investigation = Math.min(100, investigationTypes * 15 + ledger.spent * 4);
    const components = { channelStrength: pointsEarned * 10, investigation };
    const featureState = packState("features", {
      room,
      player,
      selected,
      requested,
      autoSelected,
      penalty,
      score,
      strongCount,
      moderateCount,
      weakCount,
      pointsEarned,
      maxPoints,
      spent: ledger.spent
    });
    return json(res, 200, {
      locked: true,
      selected,
      requested,
      autoSelected,
      penalty,
      rawPointsEarned,
      score,
      strongCount,
      moderateCount,
      weakCount,
      pointsEarned,
      maxPoints,
      components,
      spent: ledger.spent,
      featureState,
      message: `Feature Hunt sealed: ${strongCount} strong, ${moderateCount} moderate, ${weakCount} weak channels. Feature quality score ${score}/100.`
    });
  } catch (error) {
    return json(res, 409, { error: "The investigation ledger could not be verified. Reload the mission." });
  }
}
