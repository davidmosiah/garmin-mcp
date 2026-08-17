import assert from 'node:assert/strict';
import { calendarDateString } from '../dist/services/calendar-date.js';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { buildWellnessContext, formatWellnessContextMarkdown } from '../dist/services/context.js';

const today = new Date().toISOString().slice(0, 10);

const fakeClient = {
  async getDisplayName() {
    return 'fixture-user';
  },
  async get(endpoint) {
    if (endpoint.includes('/usersummary-service/usersummary/daily/')) {
      return { calendarDate: today, totalSteps: 9000, totalKilocalories: 2400, activeKilocalories: 600, moderateIntensityMinutes: 35, vigorousIntensityMinutes: 25, wellnessDistanceMeters: 7200, restingHeartRate: 58 };
    }
    if (endpoint.includes('/dailySummaryChart/')) {
      return { totalSteps: 9000 };
    }
    if (endpoint.includes('/dailySleepData/')) {
      return { dailySleepDTO: { calendarDate: today, sleepTimeSeconds: 25800, deepSleepSeconds: 4800, remSleepSeconds: 5400, awakeSleepSeconds: 900, sleepScore: 86 } };
    }
    if (endpoint.includes('/dailyHeartRate/')) {
      return { restingHeartRate: 58, minHeartRate: 47, maxHeartRate: 151, heartRateValues: [[1, 60], [2, 62]] };
    }
    if (endpoint.includes('/hrv-service/hrv/')) {
      return { hrvSummary: { lastNightAvg: 48.2, weeklyAvg: 46.1, status: 'BALANCED' } };
    }
    if (endpoint.includes('/dailyStress/')) {
      return { avgStressLevel: 28, maxStressLevel: 65 };
    }
    const bodyBatteryRange = endpoint.match(
      /\/wellness-service\/wellness\/bodyBattery\/reports\/daily\?startDate=([^&]+)&endDate=([^&]+)$/
    );
    if (bodyBatteryRange && bodyBatteryRange[1] === bodyBatteryRange[2]) {
      // Real Garmin endpoint returns an array (one entry per day in the requested range).
      return [{ charged: 55, drained: 42, bodyBatteryValuesArray: [[1, 68], [2, 54]] }];
    }
    if (endpoint.includes('/trainingreadiness/')) {
      return { score: 72 };
    }
    if (endpoint.includes('/trainingstatus/')) {
      return { trainingStatus: 'MAINTAINING' };
    }
    if (endpoint.includes('/daily/respiration/')) {
      return { avgWakingRespirationValue: 14.2 };
    }
    if (endpoint.includes('/daily/spo2/')) {
      return { averageSpo2: 97 };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};

const daily = await buildDailySummary(fakeClient, { days: 7, timezone: 'UTC' });
assert.equal(daily.kind, 'daily_summary');
assert.equal(daily.scorecard.steps, 9000);
assert.equal(daily.scorecard.sleep_minutes, 430);
assert.equal(daily.scorecard.resting_heart_rate, 58);
assert.equal(daily.scorecard.body_battery_end, 54);
assert.equal(daily.scorecard.training_readiness_score, 72);
assert.ok(daily.diagnostic.action_candidates.length >= 2);
assert.equal(daily.data_quality.confidence, 'high');
assert.equal(daily.data_quality.availability.sleep, 'present');
assert.equal(daily.data_quality.availability.hrv, 'present');
assert.equal(daily.data_quality.missing_or_failed.hrv, false);
assert.deepEqual(daily.data_quality.notes, []);

const weekly = await buildWeeklySummary(fakeClient, { days: 7, compare_days: 7, timezone: 'UTC' });
assert.equal(weekly.kind, 'weekly_summary');
assert.equal(weekly.scorecard.current.days, 7);
assert.equal(weekly.scorecard.current.avg_sleep_hours, 7.17);
assert.equal(weekly.scorecard.current.avg_body_battery_end, 54);
assert.ok(weekly.diagnostic.bottlenecks.length >= 1);

const context = await buildWellnessContext(fakeClient, { days: 7, timezone: 'UTC' });
assert.equal(context.source, 'garmin');
assert.equal(context.context_contract_version, 'delx-wellness-context/v1');
assert.equal(context.context_type, 'wellness_context');
assert.equal(context.recommended_handoff.tool, 'exercise_catalog_recommend_session');
assert.equal(context.readiness_score, 72);
assert.equal(context.sleep_score, 86);
assert.equal(context.body_battery, 54);
assert.equal(context.recent_training_load, 'normal');
assert.ok(context.notes.some((note) => /Body Battery/i.test(note)));
const contextMarkdown = formatWellnessContextMarkdown(context);
assert.ok(contextMarkdown.includes('context_type'));
assert.ok(contextMarkdown.includes('exercise_catalog_recommend_session'));

let capturedStderr = '';
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  capturedStderr += String(chunk);
  return true;
};
try {
  const partialClient = {
    async getDisplayName() {
      return 'fixture-user';
    },
    async get(endpoint) {
      if (endpoint.includes('/dailySleepData/')) throw new Error('synthetic sleep contract failure');
      return fakeClient.get(endpoint);
    }
  };
  await buildDailySummary(partialClient, { days: 7, timezone: 'UTC' });
} finally {
  process.stderr.write = originalStderrWrite;
}
assert.match(capturedStderr, /\[garmin-mcp\] summary domain error: synthetic sleep contract failure/);

const eveningUtc = Date.parse('2026-08-16T01:00:00.000Z');
assert.equal(calendarDateString(0, 'America/New_York', eveningUtc), '2026-08-15');
assert.equal(calendarDateString(0, 'UTC', eveningUtc), '2026-08-16');
assert.equal(calendarDateString(0, undefined, eveningUtc), '2026-08-16');
assert.equal(calendarDateString(0, 'Not/AZone', eveningUtc), '2026-08-16');
assert.equal(calendarDateString(1, 'America/New_York', eveningUtc), '2026-08-14');

// US spring-forward 2026-03-08: civil yesterday is 03-08, not 03-07 from a 24h subtract.
const afterSpringForward = Date.parse('2026-03-09T04:30:00.000Z');
assert.equal(calendarDateString(0, 'America/New_York', afterSpringForward), '2026-03-09');
assert.equal(calendarDateString(1, 'America/New_York', afterSpringForward), '2026-03-08');

const realNow = Date.now;
Date.now = () => eveningUtc;
try {
  const eastern = await buildDailySummary(fakeClient, { days: 7, timezone: 'America/New_York' });
  assert.equal(eastern.window.date, '2026-08-15');
  assert.equal(eastern.window.timezone, 'America/New_York');
  assert.equal(eastern.scorecard.hrv_last_night_avg, 48.2);
  assert.equal(eastern.data_quality.availability.hrv, 'present');

  const utcDay = await buildDailySummary(fakeClient, { days: 7, timezone: 'UTC' });
  assert.equal(utcDay.window.date, '2026-08-16');

  const omittedZone = await buildDailySummary(fakeClient, { days: 7 });
  assert.equal(omittedZone.window.date, '2026-08-16');
  assert.equal(omittedZone.window.timezone, 'UTC');

  const invalidZone = await buildDailySummary(fakeClient, { days: 7, timezone: 'Not/AZone' });
  assert.equal(invalidZone.window.date, '2026-08-16');
  assert.equal(invalidZone.window.timezone, 'UTC');
  assert.ok(invalidZone.data_quality.notes.some((note) => /Invalid IANA timezone/i.test(note)));

  const requested = new Set();
  const trackingClient = {
    async getDisplayName() {
      return 'fixture-user';
    },
    async get(endpoint) {
      for (const match of endpoint.matchAll(/\d{4}-\d{2}-\d{2}/g)) requested.add(match[0]);
      return fakeClient.get(endpoint);
    }
  };
  const easternWeek = await buildWeeklySummary(trackingClient, { days: 7, compare_days: 0, timezone: 'America/New_York' });
  assert.equal(easternWeek.window.timezone, 'America/New_York');
  assert.ok(requested.has('2026-08-15'), `weekly window should include local today, got ${[...requested].join(',')}`);
  assert.ok(!requested.has('2026-08-16'), 'weekly window must not jump to the UTC date after local evening');
} finally {
  Date.now = realNow;
}

const emptyOvernightClient = {
  async getDisplayName() {
    return 'fixture-user';
  },
  async get(endpoint) {
    if (endpoint.includes('/dailySleepData/')) return { dailySleepDTO: {} };
    if (endpoint.includes('/hrv-service/hrv/')) return { hrvSummary: {} };
    return fakeClient.get(endpoint);
  }
};
const emptyOvernight = await buildDailySummary(emptyOvernightClient, { days: 7, timezone: 'America/New_York' });
assert.equal(emptyOvernight.data_quality.missing_or_failed.sleep, true);
assert.equal(emptyOvernight.data_quality.missing_or_failed.hrv, true);
assert.equal(emptyOvernight.data_quality.availability.sleep, 'empty');
assert.equal(emptyOvernight.data_quality.availability.hrv, 'empty');
assert.equal(emptyOvernight.data_quality.confidence, 'partial');
assert.equal(emptyOvernight.diagnostic.readiness_context, 'overnight_metrics_pending');
assert.ok(emptyOvernight.data_quality.notes.some((note) => /not a recorded zero-sleep night/i.test(note)));
const emptyJson = JSON.parse(JSON.stringify(emptyOvernight));
assert.equal(emptyJson.scorecard.sleep_minutes, undefined);
assert.equal(emptyJson.scorecard.hrv_last_night_avg, undefined);
assert.equal(emptyJson.data_quality.missing_or_failed.hrv, true);
assert.equal(emptyJson.data_quality.availability.hrv, 'empty');

let failedHrvStderr = '';
const originalHrvStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  failedHrvStderr += String(chunk);
  return true;
};
let failedHrv;
try {
  const failHrvClient = {
    async getDisplayName() {
      return 'fixture-user';
    },
    async get(endpoint) {
      if (endpoint.includes('/hrv-service/hrv/')) throw new Error('synthetic hrv contract failure');
      return fakeClient.get(endpoint);
    }
  };
  failedHrv = await buildDailySummary(failHrvClient, { days: 7, timezone: 'UTC' });
} finally {
  process.stderr.write = originalHrvStderr;
}
assert.match(failedHrvStderr, /synthetic hrv contract failure/);
assert.equal(failedHrv.data_quality.availability.hrv, 'failed');
assert.equal(failedHrv.data_quality.missing_or_failed.hrv, true);
assert.equal(failedHrv.data_quality.availability.sleep, 'present');
assert.ok(failedHrv.data_quality.notes.some((note) => /HRV request failed/i.test(note)));

console.log(JSON.stringify({ ok: true, daily: daily.kind, weekly: weekly.kind }, null, 2));
