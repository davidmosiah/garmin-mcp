import assert from 'node:assert/strict';
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
    if (endpoint.includes('/bodyBattery/reports/daily/')) {
      return { charged: 55, drained: 42, bodyBatteryValuesArray: [[1, 68], [2, 54]] };
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

console.log(JSON.stringify({ ok: true, daily: daily.kind, weekly: weekly.kind }, null, 2));
