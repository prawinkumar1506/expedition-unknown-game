import { materializeDerivedRows } from "./_derived.js";

const numeric = values => values.filter(value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))).map(Number);
const missing = value => value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));
const median = values => { const ordered = numeric(values).sort((a, b) => a - b), n = ordered.length; return n ? (n % 2 ? ordered[(n - 1) / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2) : null; };
const mean = values => { const clean = numeric(values); return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null; };
const mode = values => {
  const clean = numeric(values), counts = new Map();
  for (const value of clean) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
};
const quantile = (values, q) => {
  const ordered = numeric(values).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const position = (ordered.length - 1) * q, low = Math.floor(position), high = Math.ceil(position);
  return low === high ? ordered[low] : ordered[low] + (ordered[high] - ordered[low]) * (position - low);
};
const csvCell = value => {
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\n") + "\n";
}

function project(rows, features, training) {
  return rows.map(row => Object.fromEntries([
    ["event_id", row.event_id],
    ...features.map(feature => [feature, row[feature]]),
    ...(training ? [["label", row.label]] : [])
  ]));
}

function fillMissing(train, test, feature, method) {
  const source = train.map(row => row[feature]), replacement = method === "mean" ? mean(source) : method === "mode" ? mode(source) : median(source);
  if (replacement === null) return;
  for (const row of train) if (missing(row[feature])) row[feature] = replacement;
  for (const row of test) if (missing(row[feature])) row[feature] = replacement;
}

function repairOutliers(train, test, feature, method) {
  const source = train.map(row => row[feature]), q1 = quantile(source, 0.25), q3 = quantile(source, 0.75), middle = median(source);
  if (q1 === null || q3 === null || middle === null) return;
  const iqr = q3 - q1, low = q1 - 1.5 * iqr, high = q3 + 1.5 * iqr;
  const repair = row => {
    if (missing(row[feature]) || !Number.isFinite(Number(row[feature]))) return;
    const value = Number(row[feature]);
    if (value < low || value > high) row[feature] = method === "median_replace" ? middle : Math.max(low, Math.min(high, value));
  };
  train.forEach(repair);
  test.forEach(repair);
}

export function prepareDatasets({ trainRows, testRows, features, derivedFeatures = [], repairs = {}, methods = {} }) {
  const trainSource = materializeDerivedRows(trainRows, derivedFeatures), testSource = materializeDerivedRows(testRows, derivedFeatures);
  const train = project(trainSource, features, true), test = project(testSource, features, false);
  const missingColumns = new Set(repairs.missingColumns || []), outlierColumns = new Set(repairs.outlierColumns || []);
  for (const feature of features) {
    if (missingColumns.has(feature)) fillMissing(train, test, feature, methods.missing?.[feature] || "median");
    if (outlierColumns.has(feature)) repairOutliers(train, test, feature, methods.outlier?.[feature] || "iqr_clip");
  }
  const trainColumns = ["event_id", ...features, "label"], testColumns = ["event_id", ...features];
  const missingTrain = train.reduce((count, row) => count + features.filter(feature => missing(row[feature])).length, 0);
  const missingTest = test.reduce((count, row) => count + features.filter(feature => missing(row[feature])).length, 0);
  return {
    train,
    test,
    trainColumns,
    testColumns,
    trainCsv: toCsv(train, trainColumns),
    testCsv: toCsv(test, testColumns),
    summary: { features: [...features], trainRows: train.length, testRows: test.length, missingTrain, missingTest }
  };
}
