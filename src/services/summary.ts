import type { GarminClient } from "./garmin-client.js";
import { redactErrorMessage } from "./redaction.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;
type SummaryClient = Pick<GarminClient, "get" | "getDisplayName">;

export interface SummaryOptions {
  days: number;
  compare_days?: number;
  timezone?: string;
}

function isObject(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(record: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function nested(record: unknown, key: string): UnknownRecord {
  return isObject(record) && isObject(record[key]) ? record[key] as UnknownRecord : {};
}

function round(value?: number, digits = 1): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function avg(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? sum(nums) / nums.length : undefined;
}

function percentDelta(current?: number, previous?: number): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

function dateString(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

async function safeGet(client: SummaryClient, endpoint: string): Promise<unknown> {
  try {
    return await client.get(endpoint);
  } catch (error) {
    return { error: logSummaryError(error), endpoint };
  }
}

async function safeDisplayName(client: SummaryClient): Promise<string | { error: string }> {
  try {
    return encodeURIComponent(await client.getDisplayName());
  } catch (error) {
    return { error: logSummaryError(error) };
  }
}

function logSummaryError(error: unknown): string {
  const message = redactErrorMessage(error instanceof Error ? error.message : String(error));
  process.stderr.write(`[garmin-mcp] summary domain error: ${message}\n`);
  return message;
}

async function dailyBundle(client: SummaryClient, date: string) {
  const name = await safeDisplayName(client);
  const noName = isObject(name) ? { error: name.error, endpoint: "displayName" } : undefined;
  const byName = (path: string) => noName ? Promise.resolve(noName) : safeGet(client, path.replace("{displayName}", name as string));

  // bodyBattery/reports/daily needs startDate/endDate query params (path-segment date 404s)
  // and returns an array of daily entries; unwrap to the single day we asked for so
  // downstream isObject(bundle.bodyBattery) checks keep working.
  const [daily, chart, sleep, heart, hrv, stress, bodyBattery, trainingReadiness, trainingStatus, respiration, spo2] = await Promise.all([
    byName(`/usersummary-service/usersummary/daily/{displayName}?calendarDate=${date}`),
    byName(`/wellness-service/wellness/dailySummaryChart/{displayName}?date=${date}`),
    byName(`/wellness-service/wellness/dailySleepData/{displayName}?date=${date}&nonSleepBufferMinutes=60`),
    byName(`/wellness-service/wellness/dailyHeartRate/{displayName}?date=${date}`),
    safeGet(client, `/hrv-service/hrv/${date}`),
    safeGet(client, `/wellness-service/wellness/dailyStress/${date}`),
    safeGet(client, `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`).then((v) => (Array.isArray(v) ? (v[0] ?? {}) : v)),
    safeGet(client, `/metrics-service/metrics/trainingreadiness/${date}`),
    safeGet(client, `/metrics-service/metrics/trainingstatus/aggregated/${date}`),
    safeGet(client, `/wellness-service/wellness/daily/respiration/${date}`),
    safeGet(client, `/wellness-service/wellness/daily/spo2/${date}`)
  ]);
  return { date, daily, chart, sleep, heart, hrv, stress, bodyBattery, trainingReadiness, trainingStatus, respiration, spo2 };
}

function dailyStats(bundle: Awaited<ReturnType<typeof dailyBundle>>) {
  const daily = isObject(bundle.daily) ? bundle.daily : {};
  const chart = isObject(bundle.chart) ? bundle.chart : {};
  const sleep = isObject(bundle.sleep) ? bundle.sleep : {};
  const sleepDto = nested(sleep, "dailySleepDTO");
  const heart = isObject(bundle.heart) ? bundle.heart : {};
  const hrv = isObject(bundle.hrv) ? bundle.hrv : {};
  const hrvSummary = nested(hrv, "hrvSummary");
  const stress = isObject(bundle.stress) ? bundle.stress : {};
  const bodyBattery = isObject(bundle.bodyBattery) ? bundle.bodyBattery : {};
  const trainingReadiness = isObject(bundle.trainingReadiness) ? bundle.trainingReadiness : {};
  const trainingStatus = isObject(bundle.trainingStatus) ? bundle.trainingStatus : {};
  const respiration = isObject(bundle.respiration) ? bundle.respiration : {};
  const spo2 = isObject(bundle.spo2) ? bundle.spo2 : {};

  const sleepSeconds = num(sleepDto, ["sleepTimeSeconds", "totalSleepSeconds", "durationInSeconds"]);
  const stressAvg = num(stress, ["avgStressLevel", "averageStressLevel", "overallStressLevel"]);
  const bodyBatteryValues = Array.isArray(bodyBattery.bodyBatteryValuesArray) ? bodyBattery.bodyBatteryValuesArray as unknown[] : [];
  const firstBattery = firstTupleNumber(bodyBatteryValues);
  const lastBattery = lastTupleNumber(bodyBatteryValues);

  return {
    date: bundle.date,
    steps: num(daily, ["totalSteps", "steps"]) ?? num(chart, ["totalSteps", "steps"]),
    calories_total: num(daily, ["totalKilocalories", "calories", "totalCalories"]),
    calories_active: num(daily, ["activeKilocalories", "activeCalories"]),
    active_minutes: sum([num(daily, ["moderateIntensityMinutes"]), num(daily, ["vigorousIntensityMinutes"])]),
    floors: num(daily, ["floorsAscended", "floorsClimbed"]),
    distance_km: metersToKm(num(daily, ["wellnessDistanceMeters", "distanceMeters", "totalDistanceMeters"])),
    resting_heart_rate: num(daily, ["restingHeartRate", "restingHR"]) ?? num(heart, ["restingHeartRate", "restingHR"]),
    min_heart_rate: num(heart, ["minHeartRate", "minHeartRateInBeatsPerMinute"]),
    max_heart_rate: num(heart, ["maxHeartRate", "maxHeartRateInBeatsPerMinute"]),
    sleep_minutes: sleepSeconds === undefined ? undefined : round(sleepSeconds / 60, 0),
    deep_sleep_minutes: secondsToMinutes(num(sleepDto, ["deepSleepSeconds"])),
    rem_sleep_minutes: secondsToMinutes(num(sleepDto, ["remSleepSeconds"])),
    awake_minutes: secondsToMinutes(num(sleepDto, ["awakeSleepSeconds", "awakeDurationInSeconds"])),
    sleep_score: num(sleepDto, ["sleepScore", "overallSleepScore"]),
    hrv_last_night_avg: num(hrvSummary, ["lastNightAvg", "lastNightAverage"]),
    hrv_weekly_avg: num(hrvSummary, ["weeklyAvg", "weeklyAverage"]),
    hrv_status: typeof hrvSummary.status === "string" ? hrvSummary.status : undefined,
    stress_avg: stressAvg,
    stress_max: num(stress, ["maxStressLevel", "maxStress"]),
    body_battery_charged: num(bodyBattery, ["charged", "chargedValue"]),
    body_battery_drained: num(bodyBattery, ["drained", "drainedValue"]),
    body_battery_start: firstBattery,
    body_battery_end: lastBattery,
    training_readiness_score: num(trainingReadiness, ["score", "trainingReadinessScore", "readinessScore"]),
    training_status: stringValue(trainingStatus, ["trainingStatus", "status", "trainingStatusFeedbackPhrase"]),
    respiration_avg: num(respiration, ["avgWakingRespirationValue", "avgRespirationValue", "averageRespiration"]),
    spo2_avg: num(spo2, ["averageSpo2", "avgSpo2", "averageSpO2"]),
    has_daily_error: hasError(bundle.daily),
    has_sleep_error: hasError(bundle.sleep),
    has_heart_error: hasError(bundle.heart),
    has_hrv_error: hasError(bundle.hrv),
    has_stress_error: hasError(bundle.stress),
    has_body_battery_error: hasError(bundle.bodyBattery),
    has_training_readiness_error: hasError(bundle.trainingReadiness)
  };
}

function hasError(value: unknown): boolean {
  return isObject(value) && typeof value.error === "string";
}

function stringValue(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function secondsToMinutes(value?: number): number | undefined {
  return value === undefined ? undefined : round(value / 60, 0);
}

function metersToKm(value?: number): number | undefined {
  return value === undefined ? undefined : round(value / 1000, 2);
}

function tupleValue(item: unknown): number | undefined {
  if (!Array.isArray(item)) return undefined;
  const value = item[item.length - 1];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstTupleNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const n = tupleValue(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function lastTupleNumber(values: unknown[]): number | undefined {
  for (const value of [...values].reverse()) {
    const n = tupleValue(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function classifyReadiness(stats: ReturnType<typeof dailyStats>): string {
  const sleepHours = (stats.sleep_minutes ?? 0) / 60;
  const stress = stats.stress_avg ?? 0;
  const readiness = stats.training_readiness_score;
  const bodyBatteryEnd = stats.body_battery_end;
  if (readiness !== undefined && readiness >= 70 && sleepHours >= 7) return "green_light";
  if (readiness !== undefined && readiness < 40) return "readiness_limited";
  if (sleepHours < 6 && stress >= 45) return "recovery_risk";
  if (sleepHours < 6) return "sleep_limited";
  if (bodyBatteryEnd !== undefined && bodyBatteryEnd < 35) return "low_body_battery";
  if ((stats.active_minutes ?? 0) >= 120) return "high_load";
  return "neutral";
}

function buildActions(stats: ReturnType<typeof dailyStats>, weekly?: ReturnType<typeof aggregateStats>): string[] {
  const actions: string[] = [];
  const state = classifyReadiness(stats);
  if (state === "green_light") actions.push("If subjective energy matches the data, this is a reasonable day for quality training or cognitively demanding work.");
  if (state === "readiness_limited") actions.push("Keep training intensity low today; Garmin training readiness is suppressed, so protect recovery before adding load.");
  if (state === "recovery_risk") actions.push("Prioritize a low-stress day: short sleep plus elevated stress is a poor setup for hard training.");
  if (state === "sleep_limited") actions.push("Move the biggest health lever first: sleep timing, evening light/stimulation, caffeine cutoff and consistent wake time.");
  if (state === "low_body_battery") actions.push("Use Body Battery as a pacing signal: schedule demanding blocks earlier or reduce non-essential stressors.");
  if (state === "high_load") actions.push("Protect connective tissue: add mobility, zone 1/2 recovery or a lighter session before another hard day.");
  if ((stats.resting_heart_rate ?? 0) > 0 && (stats.sleep_minutes ?? 0) < 360) actions.push("Watch resting heart rate alongside poor sleep; avoid interpreting one metric in isolation.");
  if (weekly?.avg_sleep_hours !== undefined && weekly.avg_sleep_hours < 6.5) actions.push("Weekly sleep average is below 6.5h; recovery improvements may beat training complexity.");
  if (weekly?.avg_stress !== undefined && weekly.avg_stress >= 45) actions.push("Weekly stress is elevated; add a measurable downshift habit such as 10 minutes easy walk or breathwork after work.");
  actions.push("This is not medical advice; use Garmin as trend context and escalate symptoms or abnormal vitals to a clinician.");
  return [...new Set(actions)];
}

function aggregateStats(days: ReturnType<typeof dailyStats>[]) {
  return {
    days: days.length,
    total_steps: round(sum(days.map((day) => day.steps)), 0),
    avg_steps: round(avg(days.map((day) => day.steps)), 0),
    avg_active_minutes: round(avg(days.map((day) => day.active_minutes)), 0),
    avg_sleep_hours: round(avg(days.map((day) => day.sleep_minutes).map((minutes) => minutes === undefined ? undefined : minutes / 60)), 2),
    avg_resting_heart_rate: round(avg(days.map((day) => day.resting_heart_rate)), 0),
    avg_hrv_last_night: round(avg(days.map((day) => day.hrv_last_night_avg)), 1),
    avg_stress: round(avg(days.map((day) => day.stress_avg)), 0),
    avg_body_battery_end: round(avg(days.map((day) => day.body_battery_end)), 0),
    avg_training_readiness: round(avg(days.map((day) => day.training_readiness_score)), 0),
    days_with_sleep: days.filter((day) => day.sleep_minutes !== undefined).length,
    days_with_hrv: days.filter((day) => day.hrv_last_night_avg !== undefined || day.hrv_weekly_avg !== undefined).length,
    days_with_body_battery: days.filter((day) => day.body_battery_end !== undefined || day.body_battery_charged !== undefined).length,
    days_with_training_readiness: days.filter((day) => day.training_readiness_score !== undefined).length
  };
}

export async function buildDailySummary(client: SummaryClient, options: SummaryOptions) {
  const date = dateString(0);
  const bundle = await dailyBundle(client, date);
  const stats = dailyStats(bundle);
  const readiness = classifyReadiness(stats);

  return {
    kind: "daily_summary" as const,
    generated_at: new Date().toISOString(),
    window: { date, days: options.days, timezone: options.timezone ?? "UTC" },
    data_quality: {
      confidence: [stats.has_daily_error, stats.has_sleep_error, stats.has_heart_error].filter(Boolean).length === 0 ? "high" : "partial",
      missing_or_failed: {
        daily: stats.has_daily_error,
        sleep: stats.has_sleep_error,
        heart: stats.has_heart_error,
        hrv: stats.has_hrv_error,
        stress: stats.has_stress_error,
        body_battery: stats.has_body_battery_error,
        training_readiness: stats.has_training_readiness_error
      }
    },
    scorecard: stats,
    diagnostic: {
      readiness_context: readiness,
      primary_signal: primarySignal(readiness),
      action_candidates: buildActions(stats)
    },
    safety: {
      medical_advice: false,
      api_boundary: "Garmin MCP exposes processed Garmin Connect data and supported activity details. It does not expose unrestricted raw device telemetry."
    }
  };
}

export async function buildWeeklySummary(client: SummaryClient, options: SummaryOptions) {
  const days = Math.max(options.days, 7);
  const compareDays = options.compare_days ?? 7;
  const currentBundles = await Promise.all(Array.from({ length: days }, (_, index) => dailyBundle(client, dateString(index))));
  const current = currentBundles.map(dailyStats).reverse();
  const previous = compareDays > 0
    ? (await Promise.all(Array.from({ length: compareDays }, (_, index) => dailyBundle(client, dateString(days + index))))).map(dailyStats).reverse()
    : [];
  const currentStats = aggregateStats(current);
  const previousStats = previous.length ? aggregateStats(previous) : undefined;

  return {
    kind: "weekly_summary" as const,
    generated_at: new Date().toISOString(),
    window: { days, compare_days: compareDays, timezone: options.timezone ?? "UTC" },
    data_quality: {
      days_with_daily_summary: current.filter((day) => day.steps !== undefined).length,
      days_with_sleep: currentStats.days_with_sleep,
      days_with_hrv: currentStats.days_with_hrv,
      days_with_body_battery: currentStats.days_with_body_battery,
      days_with_training_readiness: currentStats.days_with_training_readiness,
      confidence: currentStats.days_with_sleep >= 5 && currentStats.days_with_body_battery >= 5 ? "high" : currentStats.days_with_sleep >= 3 ? "medium" : "low"
    },
    scorecard: {
      current: currentStats,
      previous: previousStats,
      delta: previousStats ? {
        steps_pct: round(percentDelta(currentStats.avg_steps, previousStats.avg_steps), 1),
        active_minutes_pct: round(percentDelta(currentStats.avg_active_minutes, previousStats.avg_active_minutes), 1),
        sleep_hours_pct: round(percentDelta(currentStats.avg_sleep_hours, previousStats.avg_sleep_hours), 1),
        resting_hr_pct: round(percentDelta(currentStats.avg_resting_heart_rate, previousStats.avg_resting_heart_rate), 1),
        hrv_pct: round(percentDelta(currentStats.avg_hrv_last_night, previousStats.avg_hrv_last_night), 1),
        stress_pct: round(percentDelta(currentStats.avg_stress, previousStats.avg_stress), 1),
        body_battery_pct: round(percentDelta(currentStats.avg_body_battery_end, previousStats.avg_body_battery_end), 1)
      } : undefined
    },
    diagnostic: {
      load_classification: classifyWeeklyLoad(currentStats),
      bottlenecks: inferBottlenecks(currentStats, previousStats),
      action_candidates: buildActions(current[current.length - 1] ?? current[0], currentStats),
      next_week_success_metrics: [
        "Keep sleep average above the user's sustainable baseline before increasing intensity.",
        "Track active minutes, stress, Body Battery and resting heart rate together, not in isolation.",
        "Use HRV only when enough days are available; sparse HRV should be treated as low confidence.",
        "If symptoms, illness or abnormal vitals appear, seek clinical guidance instead of agent optimization."
      ]
    },
    safety: {
      medical_advice: false,
      raw_sensor_boundary: "Garmin MCP exposes processed Garmin Connect data and supported activity detail payloads, not unrestricted raw sensor streams."
    }
  };
}

function primarySignal(readiness: string): string {
  if (readiness === "green_light") return "Recovery signals look supportive; use subjective state to choose how hard to push.";
  if (readiness === "readiness_limited") return "Training readiness is the limiting signal; reduce intensity before adding load.";
  if (readiness === "recovery_risk") return "Load, sleep and stress are misaligned; recovery discipline matters today.";
  if (readiness === "sleep_limited") return "Sleep is the highest-leverage constraint today.";
  if (readiness === "low_body_battery") return "Body Battery suggests pacing and stress reduction should come before extra intensity.";
  if (readiness === "high_load") return "Recent active load is high enough to justify recovery protection.";
  return "Use Garmin trends as practical readiness context, not as a diagnosis.";
}

function classifyWeeklyLoad(stats: ReturnType<typeof aggregateStats>): string {
  const active = stats.avg_active_minutes ?? 0;
  const sleep = stats.avg_sleep_hours ?? 0;
  const stress = stats.avg_stress ?? 0;
  if (active >= 90 && sleep < 6.5) return "high_load_low_sleep";
  if (stress >= 45 && sleep < 6.5) return "stress_sleep_bottleneck";
  if (active >= 90) return "high_load";
  if (sleep < 6.5) return "sleep_limited";
  if (active >= 35) return "moderate";
  return "light";
}

function inferBottlenecks(current: ReturnType<typeof aggregateStats>, previous?: ReturnType<typeof aggregateStats>): string[] {
  const bottlenecks: string[] = [];
  const activeDelta = percentDelta(current.avg_active_minutes, previous?.avg_active_minutes);
  const sleepDelta = percentDelta(current.avg_sleep_hours, previous?.avg_sleep_hours);
  const stressDelta = percentDelta(current.avg_stress, previous?.avg_stress);
  if ((current.avg_sleep_hours ?? 0) < 6.5) bottlenecks.push("Average sleep is below 6.5h; recovery may be the limiting factor.");
  if ((current.avg_stress ?? 0) >= 45) bottlenecks.push("Average stress is elevated; downshift practices may improve recovery more than training complexity.");
  if (activeDelta !== undefined && activeDelta > 35) bottlenecks.push("Active minutes increased sharply versus the comparison window.");
  if (sleepDelta !== undefined && sleepDelta < -10) bottlenecks.push("Sleep duration decreased materially versus the comparison window.");
  if (stressDelta !== undefined && stressDelta > 20) bottlenecks.push("Stress increased materially versus the comparison window.");
  if (current.days_with_hrv < 3) bottlenecks.push("HRV data is sparse; do not over-weight HRV conclusions.");
  if (current.days_with_body_battery < 3) bottlenecks.push("Body Battery data is sparse; treat pacing recommendations as low confidence.");
  if (!bottlenecks.length) bottlenecks.push("No obvious Garmin-only bottleneck; combine trends with subjective energy, soreness and life stress.");
  return bottlenecks;
}

export function formatSummaryMarkdown(summary: Record<string, unknown>): string {
  const lines = [`# Garmin ${summary.kind === "weekly_summary" ? "Weekly" : "Daily"} Summary`, ""];
  lines.push(`Generated: ${summary.generated_at}`);
  const diagnostic = summary.diagnostic as { primary_signal?: string; load_classification?: string; readiness_context?: string; action_candidates?: string[]; bottlenecks?: string[] } | undefined;
  if (diagnostic?.primary_signal) lines.push(`\n## Primary signal\n${diagnostic.primary_signal}`);
  if (diagnostic?.readiness_context) lines.push(`\n## Readiness context\n${diagnostic.readiness_context}`);
  if (diagnostic?.load_classification) lines.push(`\n## Load\n${diagnostic.load_classification}`);
  if (diagnostic?.bottlenecks?.length) {
    lines.push("\n## Bottlenecks");
    diagnostic.bottlenecks.forEach((item) => lines.push(`- ${item}`));
  }
  if (diagnostic?.action_candidates?.length) {
    lines.push("\n## Action candidates");
    diagnostic.action_candidates.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push("\n## Structured data");
  lines.push("```json");
  lines.push(JSON.stringify(summary, null, 2));
  lines.push("```");
  return lines.join("\n");
}
