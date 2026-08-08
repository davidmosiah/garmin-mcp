/**
 * Contract gate for `garmin_demo`.
 *
 * The demo tool exists so agents can see the payload shape before making any
 * real Garmin Connect call. A hand-written example nobody compares against
 * reality drifts silently, and an agent that trusts it writes a parser for
 * fields that never arrive.
 *
 * This gate runs the REAL builders (`buildDailySummary`, `buildWellnessContext`)
 * and the REAL privacy envelope (`applyPrivacy`, as used by every date tool)
 * over a stub Garmin client, then compares key sets against the demo payload,
 * failing in both directions:
 *
 *   - a key in the demo that the server never emits -> invented contract
 *   - a key the server emits that the demo omits    -> incomplete contract
 *
 * Arrays are compared as the union of their elements' key paths, because a real
 * payload contains both populated and empty entries and either alone
 * under-describes the shape.
 *
 * There is no recorded Garmin fixture in this repo (Garmin Connect is a live
 * authenticated API and responses are personal health data). The stub below is
 * the cheapest thing that still exercises real code: it feeds synthetic
 * responses shaped like the Garmin endpoints the builders read, and every field
 * name in it is one this repo's own parsing/privacy layer already names.
 */
import assert from 'node:assert/strict';
import { buildDailySummary } from '../dist/services/summary.js';
import { buildWellnessContext } from '../dist/services/context.js';
import { applyPrivacy } from '../dist/services/privacy.js';
import { buildDemoPayload } from '../dist/services/demo.js';

const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_PRIVACY_MODE = 'structured';
// Live Garmin uses query params; path-segment date 404s (see #20).
const BODY_BATTERY_ENDPOINT = `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${TODAY}&endDate=${TODAY}`;

/** Synthetic Garmin Connect responses. No real health data, no real coordinates. */
const BODY_BATTERY_RAW = {
  calendarDate: TODAY,
  charged: 55,
  drained: 42,
  bodyBatteryMostRecentValue: 54,
  startTimestampLocal: `${TODAY}T00:00:00.0`,
  endTimestampLocal: `${TODAY}T23:59:00.0`,
  bodyBatteryValuesArray: [[1, 68], [2, 54]]
};

const stubClient = {
  async getDisplayName() {
    return 'fixture-user';
  },
  async get(endpoint) {
    if (endpoint.includes('/usersummary-service/usersummary/daily/')) {
      return {
        calendarDate: TODAY,
        totalSteps: 9000,
        totalKilocalories: 2400,
        activeKilocalories: 600,
        moderateIntensityMinutes: 35,
        vigorousIntensityMinutes: 25,
        wellnessDistanceMeters: 7200,
        floorsAscended: 11,
        restingHeartRate: 58
      };
    }
    if (endpoint.includes('/dailySummaryChart/')) return { totalSteps: 9000 };
    if (endpoint.includes('/dailySleepData/')) {
      return {
        dailySleepDTO: {
          calendarDate: TODAY,
          sleepTimeSeconds: 25800,
          deepSleepSeconds: 4800,
          remSleepSeconds: 5400,
          awakeSleepSeconds: 900,
          sleepScore: 86
        }
      };
    }
    if (endpoint.includes('/dailyHeartRate/')) {
      return { restingHeartRate: 58, minHeartRate: 47, maxHeartRate: 151, heartRateValues: [[1, 60], [2, 62]] };
    }
    if (endpoint.includes('/hrv-service/hrv/')) {
      return { hrvSummary: { lastNightAvg: 48.2, weeklyAvg: 46.1, status: 'BALANCED' } };
    }
    if (endpoint.includes('/dailyStress/')) return { avgStressLevel: 28, maxStressLevel: 65 };
    // Exact query-param form only (legacy path-segment form must not match).
    const bodyBatteryRange = endpoint.match(
      /\/wellness-service\/wellness\/bodyBattery\/reports\/daily\?startDate=([^&]+)&endDate=([^&]+)$/
    );
    if (bodyBatteryRange && bodyBatteryRange[1] === bodyBatteryRange[2]) {
      // Real API returns an array of daily entries; tools/summary unwrap to one object.
      return [BODY_BATTERY_RAW];
    }
    if (endpoint.includes('/trainingreadiness/')) return { score: 72 };
    if (endpoint.includes('/trainingstatus/')) return { trainingStatus: 'MAINTAINING' };
    if (endpoint.includes('/daily/respiration/')) return { avgWakingRespirationValue: 14.2 };
    if (endpoint.includes('/daily/spo2/')) return { averageSpo2: 97 };
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};

/**
 * Keys the server only emits when the account/device happens to record that
 * metric. The demo shows them because they are part of the contract an agent may
 * encounter; the stub may or may not produce them. Each entry needs a reason.
 *
 * This is deliberately narrow. Adding a key here to silence the gate defeats the
 * gate — only list fields that are genuinely conditional on live data.
 */
const OPTIONAL_IN_REAL = new Map([
  // No allowances needed today: the stub exercises every documented field.
  // Kept as the explicit, reviewable place to record one if that ever changes.
]);

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // Union across elements: a payload has both populated and empty entries.
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

function diff(demoSet, realSet) {
  const invented = [...demoSet].filter((k) => !realSet.has(k)).sort();
  const missing = [...realSet].filter((k) => !demoSet.has(k) && !OPTIONAL_IN_REAL.has(k)).sort();
  return { invented, missing };
}

function report(name, invented, missing) {
  const lines = [];
  if (invented.length > 0) {
    lines.push(
      `\n  ${name}: ${invented.length} key(s) in the demo that the real server NEVER returns.`,
      `  An agent trusting these writes a parser for data that never arrives:`,
      ...invented.map((k) => `    - ${k}`)
    );
  }
  if (missing.length > 0) {
    lines.push(
      `\n  ${name}: ${missing.length} key(s) the real server returns but the demo omits.`,
      `  Agents reading the demo will not know these exist:`,
      ...missing.map((k) => `    + ${k}`)
    );
  }
  return lines.join('\n');
}

const payload = buildDemoPayload();
const demo = payload.sample;

const real = {
  garmin_daily_summary: await buildDailySummary(stubClient, { days: 1, timezone: 'UTC' }),
  garmin_wellness_context: await buildWellnessContext(stubClient, { days: 7, timezone: 'UTC' }),
  // Raw date tools return this exact envelope; see registerDateTool in src/tools/garmin-tools.ts.
  garmin_get_body_battery_day: {
    endpoint: BODY_BATTERY_ENDPOINT,
    privacy_mode: DEFAULT_PRIVACY_MODE,
    data: applyPrivacy(BODY_BATTERY_ENDPOINT, BODY_BATTERY_RAW, DEFAULT_PRIVACY_MODE)
  }
};

const failures = [];
let checked = 0;

for (const [name, realPayload] of Object.entries(real)) {
  assert.ok(demo[name], `demo payload is missing the ${name} sample entirely`);
  const demoSet = keyPaths(demo[name]);
  const realSet = keyPaths(realPayload);
  const { invented, missing } = diff(demoSet, realSet);
  checked += demoSet.size;
  if (invented.length > 0 || missing.length > 0) {
    failures.push(report(name, invented, missing));
  } else {
    console.log(`PASS ${name} — ${demoSet.size} key paths match the real server output`);
  }
}

// The demo must stay honest about being synthetic, whatever the shape says.
assert.equal(payload.is_demo, true, 'demo payload must be tagged is_demo=true');
assert.equal(payload.ok, true, 'demo payload must be tagged ok=true');
assert.ok(Array.isArray(payload.notes) && payload.notes.length > 0, 'demo payload must carry notes');
console.log('PASS demo payload is tagged synthetic');

// A demo that leaks the positional/device metadata the privacy layer strips
// would re-teach agents the wrong contract.
const encoded = JSON.stringify(payload).toLowerCase();
for (const needle of ['latitude', 'longitude', 'deviceid', 'unitid', 'startlatitude']) {
  assert.ok(!encoded.includes(needle), `demo payload must not contain "${needle}"`);
}
console.log('PASS demo payload carries no positional or device-identifier keys');

if (failures.length > 0) {
  console.error('\nFAIL demo contract drifted from the real server output:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix src/services/demo.ts so the examples match what the server returns.' +
      '\nDo not widen OPTIONAL_IN_REAL to silence this — that is how the drift got here.\n'
  );
  process.exit(1);
}

console.log(`\ndemo-contract: ${checked} key paths verified against the real server output`);
console.log(JSON.stringify({ ok: true, suite: 'demo-contract', samples: Object.keys(real).length }));
