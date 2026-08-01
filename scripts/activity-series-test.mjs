/**
 * Regression tests for the agent-safe series contract (issue #19).
 *
 * Expectations come from `groundTruth()` in the fixture, which recomputes
 * everything from the closed-form profile — never from src/services/series.ts.
 * Otherwise the test would only prove the implementation equals itself.
 */
import assert from 'node:assert/strict';
import {
  SERIES_HARD_MAX_POINTS,
  buildActivitySeries,
  computeStats,
  downsampleToBuckets,
  extractSamples,
  percentile
} from '../dist/services/series.js';
import { RIDE_ACTIVITY_ID, buildSyntheticRide, groundTruth } from './synthetic-series-fixture.mjs';

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${label}`);
}

const ride = buildSyntheticRide();
const truth = groundTruth();

check('fixture is a 3h ride at 1 Hz', () => {
  assert.equal(ride.activityDetailMetrics.length, 10800);
  assert.equal(truth.count, 10800);
});

check('extractSamples reads the Garmin column layout', () => {
  const samples = extractSamples(ride, 'heart_rate');
  assert.equal(samples.length, 10800);
  assert.equal(samples[0].t, 0, 'epoch ms must normalize to seconds from start');
  assert.equal(samples[10799].t, 10799);
  assert.equal(samples[0].value, 95);
});

check('stats are computed on full-resolution samples, not on buckets', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.ok(series.downsampled, 'a 3h 1 Hz ride must downsample');
  assert.equal(series.stats.min, truth.min);
  assert.equal(series.stats.max, truth.max);
  assert.ok(Math.abs(series.stats.avg - truth.avg) < 0.01, `avg ${series.stats.avg} vs truth ${truth.avg}`);
  assert.ok(Math.abs(series.stats.p25 - truth.p25) < 0.01);
  assert.ok(Math.abs(series.stats.p50 - truth.p50) < 0.01);
  assert.ok(Math.abs(series.stats.p75 - truth.p75) < 0.01);
});

check('downsampled series mean stays within 1 bpm of true mean', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  const weighted =
    series.points.reduce((acc, point) => acc + point.value * point.samples, 0) /
    series.points.reduce((acc, point) => acc + point.samples, 0);
  assert.ok(Math.abs(weighted - truth.avg) <= 1, `weighted ${weighted} vs truth ${truth.avg}`);
});

check('every source sample is accounted for in exactly one bucket', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  const bucketed = series.points.reduce((acc, point) => acc + point.samples, 0);
  assert.equal(bucketed, series.source_points);
  assert.equal(series.source_points, 10800);
});

check('metadata declares the loss honestly', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.equal(series.method, 'time_bucket_mean');
  assert.equal(series.returned_points, series.points.length);
  assert.ok(series.returned_points < series.source_points);
  assert.equal(series.contract_version, 'agent-safe-series/v1');
  assert.equal(series.unit, 'bpm');
});

check('hard cap holds even when the caller asks for more', () => {
  const series = buildActivitySeries(ride, {
    activityId: RIDE_ACTIVITY_ID,
    metric: 'heart_rate',
    resolutionSeconds: 1,
    maxPoints: 100000
  });
  assert.ok(series.returned_points <= SERIES_HARD_MAX_POINTS, `returned ${series.returned_points}`);
  assert.ok(series.resolution_seconds > series.requested_resolution_seconds, 'resolution must be raised');
  assert.ok(series.notes.some((note) => note.includes('max_points')), 'the bump must be stated in notes');
});

check('a tight max_points budget is still respected', () => {
  for (const budget of [10, 25, 60, 137, 500]) {
    const series = buildActivitySeries(ride, {
      activityId: RIDE_ACTIVITY_ID,
      metric: 'heart_rate',
      resolutionSeconds: 1,
      maxPoints: budget
    });
    assert.ok(series.returned_points <= budget, `budget ${budget} -> got ${series.returned_points}`);
  }
});

check('intra-bucket spread survives downsampling', () => {
  const series = buildActivitySeries(ride, {
    activityId: RIDE_ACTIVITY_ID,
    metric: 'heart_rate',
    resolutionSeconds: 600
  });
  // A 10-min bucket over the interval block spans threshold (168) and recovery (120).
  const spread = series.points.find((point) => point.max - point.min > 40);
  assert.ok(spread, 'a bucket covering threshold+recovery must expose min/max spread');
  assert.ok(spread.min <= 121 && spread.max >= 167);
});

check('short activity returns full precision, not fake buckets', () => {
  const short = buildSyntheticRide({ durationSeconds: 120 });
  const series = buildActivitySeries(short, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.equal(series.downsampled, false);
  assert.equal(series.method, 'none');
  assert.equal(series.returned_points, series.source_points);
  assert.ok(series.points.every((point) => point.samples === 1));
});

check('time_in_zone uses full-resolution samples and declares its reference', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.ok(series.time_in_zone);
  assert.equal(series.time_in_zone.zone_model, 'percent_of_reference_max_hr');
  assert.equal(series.time_in_zone.reference_source, 'observed_max');
  assert.equal(series.time_in_zone.reference_max_hr, truth.max);
  const total = series.time_in_zone.zones.reduce((acc, zone) => acc + zone.percent, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `zone percents sum to ${total}`);
  assert.ok(series.notes.some((note) => note.includes('reference_max_hr')));
});

check('a caller-supplied max HR is labelled as such', () => {
  const series = buildActivitySeries(ride, {
    activityId: RIDE_ACTIVITY_ID,
    metric: 'heart_rate',
    referenceMaxHr: 190
  });
  assert.equal(series.time_in_zone.reference_source, 'caller');
  assert.equal(series.time_in_zone.reference_max_hr, 190);
});

check('data_quality reports real gaps instead of hiding them', () => {
  const gapped = buildSyntheticRide({ gaps: [[3000, 3600]] });
  const series = buildActivitySeries(gapped, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.equal(series.data_quality.actual_samples, 10800 - 601);
  assert.ok(series.data_quality.longest_gap_seconds >= 600, `gap ${series.data_quality.longest_gap_seconds}`);
  assert.ok(series.data_quality.coverage_ratio < 1);
  assert.equal(series.data_quality.sample_interval_seconds, 1);
});

check('sparse coverage raises an explicit note', () => {
  const sparse = buildSyntheticRide({ gaps: [[1000, 3000], [4000, 6000], [7000, 9000]] });
  const series = buildActivitySeries(sparse, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.ok(series.data_quality.coverage_ratio < 0.9, `coverage ${series.data_quality.coverage_ratio}`);
  assert.ok(series.notes.some((note) => note.includes('Sparse series')));
});

check('documented limit: a gap at the head reads as a shorter activity', () => {
  // coverage_ratio is derived from first-to-last sample span, so it can only see
  // interior holes. Without a nominal activity duration from Garmin there is no
  // way to know the first 4000s were dropped rather than never recorded — and
  // inventing an assumption here would produce a confidently wrong quality score.
  const headless = buildSyntheticRide({ gaps: [[0, 4000]] });
  const series = buildActivitySeries(headless, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.equal(series.data_quality.coverage_ratio, 1);
  assert.equal(series.data_quality.longest_gap_seconds, 1);
  assert.ok(!series.notes.some((note) => note.includes('Sparse series')));
});

check('GPS columns are never served, even when present upstream', () => {
  const withGps = buildSyntheticRide({ includeGps: true });
  const series = buildActivitySeries(withGps, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  const encoded = JSON.stringify(series);
  assert.ok(!encoded.includes('-3.73'), 'latitude must not appear in the payload');
  assert.ok(!encoded.includes('-38.52'), 'longitude must not appear in the payload');
  assert.ok(series.notes.some((note) => note.includes('GPS')));
});

check('a second metric extracts independently', () => {
  const series = buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'power' });
  assert.equal(series.unit, 'watts');
  assert.equal(series.source_points, 10800);
  assert.equal(series.time_in_zone, undefined, 'HR zones only apply to heart_rate');
});

check('a missing metric errors instead of returning an empty series', () => {
  assert.throws(
    () => buildActivitySeries(ride, { activityId: RIDE_ACTIVITY_ID, metric: 'elevation' }),
    /No elevation samples/
  );
});

check('payload without a clock column falls back to index and says so', () => {
  const noClock = buildSyntheticRide({ durationSeconds: 300, includeTimestamp: false });
  const series = buildActivitySeries(noClock, { activityId: RIDE_ACTIVITY_ID, metric: 'heart_rate' });
  assert.equal(series.source_points, 300);
  assert.ok(series.notes.some((note) => note.includes('sample index')));
});

check('percentile interpolates linearly, matching numpy default', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(percentile([10], 0.9), 10);
});

check('bucket boundaries are stable and ordered', () => {
  const samples = [
    { t: 0, value: 10 },
    { t: 30, value: 20 },
    { t: 59, value: 30 },
    { t: 60, value: 40 },
    { t: 119, value: 50 }
  ];
  const points = downsampleToBuckets(samples, 60);
  assert.equal(points.length, 2);
  assert.equal(points[0].t, 0);
  assert.equal(points[0].samples, 3);
  assert.equal(points[0].value, 20);
  assert.equal(points[1].t, 60);
  assert.equal(points[1].samples, 2);
  assert.equal(points[1].value, 45);
});

check('computeStats on a known vector', () => {
  const stats = computeStats([100, 110, 120, 130, 140]);
  assert.equal(stats.avg, 120);
  assert.equal(stats.min, 100);
  assert.equal(stats.max, 140);
  assert.equal(stats.p50, 120);
  assert.equal(stats.percentile_method, 'linear_interpolation');
});

console.log(`\nactivity-series: ${passed} checks passed`);
