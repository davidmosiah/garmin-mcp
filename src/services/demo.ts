/**
 * Synthetic example payloads for `garmin_demo`.
 *
 * The stated purpose of the demo tool is that agents see the contract *before*
 * any real Garmin Connect call. That only holds if the examples match what the
 * server actually returns — an example advertising a field the server never
 * emits makes an agent write a parser for data that never arrives.
 *
 * These shapes are not hand-maintained guesses: `scripts/demo-contract-test.mjs`
 * runs the real `buildDailySummary` / `buildWellnessContext` and the real
 * `applyPrivacy` envelope against a stub Garmin client and fails the build when
 * the key sets diverge in either direction (invented keys, or contract fields
 * missing from the example).
 *
 * If you change a builder's output shape, that gate fails and points here.
 * Update this file — do not weaken the gate.
 *
 * All values are synthetic. No real user data ever belongs in this file.
 */

/** Values below are internally consistent so the narrative strings are the ones
 *  the real classifiers would actually emit for these numbers. */
const DEMO_READINESS = 72;
const DEMO_SLEEP_SCORE = 86;
const DEMO_SLEEP_MINUTES = 430;
const DEMO_BODY_BATTERY_END = 54;
const DEMO_ACTIVE_MINUTES = 60;

function demoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function demoGeneratedAt(date: string): string {
  return `${date}T07:12:00.000Z`;
}

/** Mirrors `buildDailySummary().data_quality` — shared with the wellness context. */
function demoDataQuality() {
  return {
    confidence: "high",
    missing_or_failed: {
      daily: false,
      sleep: false,
      heart: false,
      hrv: false,
      stress: false,
      body_battery: false,
      training_readiness: false
    }
  };
}

/** Mirrors `buildDailySummary` in src/services/summary.ts. */
function demoDailySummary(date: string) {
  return {
    kind: "daily_summary",
    generated_at: demoGeneratedAt(date),
    window: {
      date,
      days: 1,
      timezone: "UTC"
    },
    data_quality: demoDataQuality(),
    // Every scorecard field the builder emits. Fields Garmin did not return for
    // the day are present with value `undefined` in the real payload, so agents
    // must treat each one as optional — never as guaranteed.
    scorecard: {
      date,
      steps: 9000,
      calories_total: 2400,
      calories_active: 600,
      active_minutes: DEMO_ACTIVE_MINUTES,
      floors: 11,
      distance_km: 7.2,
      resting_heart_rate: 58,
      min_heart_rate: 47,
      max_heart_rate: 151,
      sleep_minutes: DEMO_SLEEP_MINUTES,
      deep_sleep_minutes: 80,
      rem_sleep_minutes: 90,
      awake_minutes: 15,
      sleep_score: DEMO_SLEEP_SCORE,
      hrv_last_night_avg: 48.2,
      hrv_weekly_avg: 46.1,
      hrv_status: "BALANCED",
      stress_avg: 28,
      stress_max: 65,
      body_battery_charged: 55,
      body_battery_drained: 42,
      body_battery_start: 68,
      body_battery_end: DEMO_BODY_BATTERY_END,
      training_readiness_score: DEMO_READINESS,
      training_status: "MAINTAINING",
      respiration_avg: 14.2,
      spo2_avg: 97,
      has_daily_error: false,
      has_sleep_error: false,
      has_heart_error: false,
      has_hrv_error: false,
      has_stress_error: false,
      has_body_battery_error: false,
      has_training_readiness_error: false
    },
    diagnostic: {
      readiness_context: "green_light",
      primary_signal: "Recovery signals look supportive; use subjective state to choose how hard to push.",
      action_candidates: [
        "If subjective energy matches the data, this is a reasonable day for quality training or cognitively demanding work.",
        "This is not medical advice; use Garmin as trend context and escalate symptoms or abnormal vitals to a clinician."
      ]
    },
    safety: {
      medical_advice: false,
      api_boundary:
        "Garmin MCP exposes processed Garmin Connect data and supported activity details. It does not expose unrestricted raw device telemetry."
    }
  };
}

/** Mirrors `buildWellnessContext` in src/services/context.ts. */
function demoWellnessContext(date: string) {
  return {
    source: "garmin",
    context_contract_version: "delx-wellness-context/v1",
    context_type: "wellness_context",
    generated_at: demoGeneratedAt(date),
    readiness_score: DEMO_READINESS,
    sleep_score: DEMO_SLEEP_SCORE,
    body_battery: DEMO_BODY_BATTERY_END,
    recent_training_load: "normal",
    recent_training_load_minutes: DEMO_ACTIVE_MINUTES,
    // Echoed back from the caller's input; empty when the agent passes nothing.
    soreness: [] as string[],
    injury_flags: [] as string[],
    notes: [
      `Body Battery end: ${DEMO_BODY_BATTERY_END}.`,
      `Training readiness: ${DEMO_READINESS}.`
    ],
    data_quality: demoDataQuality(),
    recommended_handoff: {
      tool: "exercise_catalog_recommend_session",
      reason:
        "Use Garmin readiness, sleep, Body Battery and movement load to scale workout intensity and volume."
    },
    telegram_summary: `Garmin wellness context | Readiness: ${DEMO_READINESS} | Sleep: ${DEMO_SLEEP_SCORE} | Body Battery: ${DEMO_BODY_BATTERY_END} | Load: normal`
  };
}

/**
 * Mirrors the raw date-tool envelope: `{ endpoint, privacy_mode, data }`, where
 * `data` is the Garmin Connect payload after `applyPrivacy`. The shape of `data`
 * depends on `privacy_mode` — this example shows the default, `structured`.
 */
function demoBodyBatteryDay(date: string) {
  return {
    endpoint: `/wellness-service/wellness/bodyBattery/reports/daily/${date}`,
    privacy_mode: "structured",
    data: {
      calendarDate: date,
      charged: 55,
      drained: 42,
      bodyBatteryMostRecentValue: DEMO_BODY_BATTERY_END,
      startTimestampLocal: `${date}T00:00:00.0`,
      endTimestampLocal: `${date}T23:59:00.0`,
      bodyBatteryValuesArray: [
        [1, 68],
        [2, DEMO_BODY_BATTERY_END]
      ]
    }
  };
}

export function buildDemoPayload() {
  const date = demoDate();
  return {
    ok: true as const,
    is_demo: true as const,
    sample: {
      garmin_daily_summary: demoDailySummary(date),
      garmin_wellness_context: demoWellnessContext(date),
      garmin_get_body_battery_day: demoBodyBatteryDay(date)
    },
    notes: [
      "All sample data is synthetic; tagged with is_demo=true.",
      "Real calls return live data from Garmin Connect after local auth.",
      "Numeric fields are optional: Garmin omits metrics the device or account does not record, so treat every scorecard value as possibly undefined.",
      "Raw date tools such as garmin_get_body_battery_day wrap the Garmin payload in { endpoint, privacy_mode, data }; the shape of `data` depends on privacy_mode."
    ]
  };
}
