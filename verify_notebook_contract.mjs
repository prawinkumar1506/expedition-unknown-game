import { buildKaggleScript, kaggleFilename } from './public/kaggle-export.js';

const features = [
  'vehicle_count',
  'avg_vehicle_speed_kmph',
  'road_occupancy_pct',
  'pedestrian_count',
  'time_of_day_hr',
  'visibility_m',
  'rain_intensity_mmhr',
  'signal_wait_time_s',
  'road_wetness_pct',
  'incident_distance_m'
];

const out = buildKaggleScript({
  model: 'Random Forest',
  features,
  tuning: { trials: 25, folds: 5, randomState: 42 },
  notebook: true
});

const parsed = JSON.parse(out);
const code = parsed.cells.find((c) => c.cell_type === 'code').source.join('');
const result = {
  filename: kaggleFilename('Random Forest', 'ipynb'),
  hasTrainRead: code.includes('TRAIN_FILE = "train_16.csv"') && code.includes("pd.read_csv(find_data(TRAIN_FILE))"),
  hasTestRead: code.includes('TEST_FILE = "test_16.csv"') && code.includes("pd.read_csv(find_data(TEST_FILE))"),
  hasSelectionMatch: code.includes('X = train_df[FEATURES].copy()') && code.includes('X_test = test_df[FEATURES].copy()'),
  hasSubmissionWrite: code.includes('submission.to_csv("submission.csv", index=False)'),
  noOrganizerTruth: !code.includes('test_truth') && !code.includes('train_clean')
};

console.log(JSON.stringify(result, null, 2));

if (!result.hasTrainRead || !result.hasTestRead || !result.hasSelectionMatch || !result.hasSubmissionWrite || !result.noOrganizerTruth) {
  process.exit(1);
}
