/**
 * Deterministic synthetic activity fixtures in Garmin Connect `details` format.
 *
 * Counterpart to the Mi Fitness Data Bridge fixture in `tests/synthetic_fixtures.py`
 * (Kindred), so the same 3-hour ride can regression-test both downsamplers and the
 * two payload shapes can be diffed directly. See issue #19.
 *
 * Zero real health data, zero randomness: every value comes from a closed-form
 * profile, so ground truth is exact and the fixture is reproducible across runs
 * and machines.
 *
 * Profile (matches the Kindred fixture beat for beat):
 *   0–20 min    warm-up, 95 -> 130 bpm linear
 *   20–80 min   steady state, 140 bpm with a +/-8 bpm sinusoid (10 min period)
 *   80–110 min  3x (5 min threshold @ 168 / 5 min recovery @ 120)
 *   110–150 min tempo, 150 bpm with a +/-4 bpm sinusoid (5 min period)
 *   150–180 min cool-down, 145 -> 95 bpm linear
 */

export const RIDE_DURATION_SECONDS = 10800;
export const RIDE_START_EPOCH_MS = 1_753_000_000_000;
export const RIDE_ACTIVITY_ID = 9_900_000_001;

/** Heart rate in bpm at a given second offset. Closed form, no state, no RNG. */
export function heartRateAt(t) {
  if (t < 1200) {
    return 95 + (130 - 95) * (t / 1200);
  }
  if (t < 4800) {
    return 140 + 8 * Math.sin((2 * Math.PI * (t - 1200)) / 600);
  }
  if (t < 6600) {
    const intoBlock = (t - 4800) % 600;
    return intoBlock < 300 ? 168 : 120;
  }
  if (t < 9000) {
    return 150 + 4 * Math.sin((2 * Math.PI * (t - 6600)) / 300);
  }
  return 145 - (145 - 95) * ((t - 9000) / 1800);
}

/** Power in watts. Loosely tracks HR so multi-metric extraction is exercised. */
export function powerAt(t) {
  return Math.max(0, (heartRateAt(t) - 60) * 2.4);
}

/**
 * Build a Garmin-format details payload.
 *
 * @param {object} [options]
 * @param {number} [options.durationSeconds] Ride length in seconds.
 * @param {number} [options.sampleIntervalSeconds] Seconds between samples.
 * @param {Array<[number, number]>} [options.gaps] Inclusive [startSec, endSec] windows to drop, for data-quality tests.
 * @param {boolean} [options.includeTimestamp] Emit the directTimestamp column.
 * @param {boolean} [options.includeGps] Emit lat/lon columns, to prove they are never served.
 */
export function buildSyntheticRide(options = {}) {
  const {
    durationSeconds = RIDE_DURATION_SECONDS,
    sampleIntervalSeconds = 1,
    gaps = [],
    includeTimestamp = true,
    includeGps = false
  } = options;

  const descriptors = [];
  let index = 0;
  if (includeTimestamp) descriptors.push({ key: "directTimestamp", metricsIndex: index++, unit: { key: "gmt" } });
  descriptors.push({ key: "directHeartRate", metricsIndex: index++, unit: { key: "bpm" } });
  descriptors.push({ key: "directPower", metricsIndex: index++, unit: { key: "watt" } });
  if (includeGps) {
    descriptors.push({ key: "directLatitude", metricsIndex: index++, unit: { key: "degree" } });
    descriptors.push({ key: "directLongitude", metricsIndex: index++, unit: { key: "degree" } });
  }

  const inGap = (t) => gaps.some(([start, end]) => t >= start && t <= end);

  const rows = [];
  for (let t = 0; t < durationSeconds; t += sampleIntervalSeconds) {
    if (inGap(t)) continue;
    const metrics = [];
    if (includeTimestamp) metrics.push(RIDE_START_EPOCH_MS + t * 1000);
    metrics.push(Math.round(heartRateAt(t)));
    metrics.push(Math.round(powerAt(t)));
    if (includeGps) {
      metrics.push(-3.7327 + t * 0.000001);
      metrics.push(-38.5267 + t * 0.000001);
    }
    rows.push({ metrics });
  }

  return {
    activityId: RIDE_ACTIVITY_ID,
    measurementCount: rows.length,
    metricsCount: descriptors.length,
    metricDescriptors: descriptors,
    activityDetailMetrics: rows
  };
}

/**
 * Ground truth computed straight from the profile, independent of src/services/series.ts.
 * A test that derived expectations from the implementation would only prove the
 * implementation equals itself.
 */
export function groundTruth(options = {}) {
  const { durationSeconds = RIDE_DURATION_SECONDS, sampleIntervalSeconds = 1, gaps = [] } = options;
  const inGap = (t) => gaps.some(([start, end]) => t >= start && t <= end);

  const values = [];
  for (let t = 0; t < durationSeconds; t += sampleIntervalSeconds) {
    if (inGap(t)) continue;
    values.push(Math.round(heartRateAt(t)));
  }

  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => {
    const rank = (sorted.length - 1) * q;
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  };

  return {
    count: values.length,
    avg: values.reduce((acc, value) => acc + value, 0) / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: at(0.25),
    p50: at(0.5),
    p75: at(0.75)
  };
}
