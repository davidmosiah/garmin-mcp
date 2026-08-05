/**
 * Agent-safe time-series shaping for large Garmin activities.
 *
 * A 3-hour ride at 1 Hz is ~10,800 samples. Handing that to an agent burns the
 * context window and buys nothing: the agent needs the shape of the effort and
 * exact aggregates, not every sample. This module turns a raw Garmin activity
 * details payload into a bounded response that says exactly what it did.
 *
 * Two rules drive the whole design:
 *
 * 1. Stats are always computed on full-resolution samples, never on the
 *    downsampled points. An agent gets exact avg/min/max/percentiles and zone
 *    distribution even when the plotted series is lossy.
 * 2. The payload is explicit about precision it does not have (`downsampled`,
 *    `source_points`, `returned_points`, `method`, `data_quality`), so the
 *    agent never invents it.
 *
 * The response shape is deliberately aligned with the Mi Fitness Data Bridge
 * (Kindred) `workout_series` contract so a single agent can consume both.
 * See https://github.com/davidmosiah/garmin-mcp/issues/19.
 */

export const SERIES_CONTRACT_VERSION = "agent-safe-series/v1";

/** Server-enforced ceiling. Even an explicit max_points request cannot exceed this. */
export const SERIES_HARD_MAX_POINTS = 500;
export const SERIES_DEFAULT_MAX_POINTS = 400;
export const SERIES_DEFAULT_RESOLUTION_SECONDS = 60;

/**
 * Metrics we expose as a series. GPS is deliberately absent: a lat/lon stream is
 * the same class of context bomb as 1 Hz HR *and* carries location privacy, so it
 * stays behind the existing privacy_mode/include_gps escalation, never here.
 */
export const SERIES_METRICS = ["heart_rate", "power", "cadence", "speed", "elevation"] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];

/** Garmin descriptor keys per metric, in preference order. */
const METRIC_DESCRIPTOR_KEYS: Record<SeriesMetric, string[]> = {
  heart_rate: ["directHeartRate"],
  power: ["directPower"],
  cadence: ["directBikeCadence", "directRunCadence", "directDoubleCadence", "directCadence"],
  speed: ["directSpeed"],
  elevation: ["directElevation", "directElevationGain"]
};

const METRIC_UNITS: Record<SeriesMetric, string> = {
  heart_rate: "bpm",
  power: "watts",
  cadence: "rpm",
  speed: "m/s",
  elevation: "m"
};

/** Descriptor keys that carry a per-sample clock, in preference order. */
const TIMESTAMP_KEYS = ["directTimestamp", "sumElapsedDuration", "sumDuration", "sumMovingDuration"];

/** Keys that must never leave this module, whatever the caller asks for. */
const FORBIDDEN_DESCRIPTOR_KEYS = new Set([
  "directLatitude",
  "directLongitude",
  "directGpsLatitude",
  "directGpsLongitude"
]);

export type SeriesPoint = {
  /** Seconds since activity start for the bucket (or the sample, when not downsampled). */
  t: number;
  /** Bucket mean, or the raw sample value when method is "none". */
  value: number;
  min: number;
  max: number;
  /** Full-resolution samples aggregated into this point. */
  samples: number;
}

export type SeriesStats = {
  avg: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  /** Named so a consumer can reproduce the numbers exactly. */
  percentile_method: "linear_interpolation";
}

export type ZoneBucket = {
  zone: number;
  /** Inclusive lower bound in bpm. */
  min_bpm: number;
  /** Exclusive upper bound in bpm; null for the open-ended top zone. */
  max_bpm: number | null;
  seconds: number;
  percent: number;
}

/**
 * Shared with Mi Fitness Data Bridge `agent-safe-series/v1`
 * (https://github.com/shkyyy18/mi-fitness-data-bridge@1647472).
 * Prefer the same strings on both servers so one agent can branch once.
 */
export type ReferenceSource =
  | "caller_provided"
  | "activity_recorded_max"
  | "observed_max";

export type CoverageAnchor = "nominal_duration" | "sample_span";

export type TimeInZone = {
  zone_model: "percent_of_reference_max_hr";
  reference_max_hr: number;
  /** Where reference_max_hr came from — never silently assumed. */
  reference_source: ReferenceSource;
  zones: ZoneBucket[];
}

export type DataQuality = {
  expected_samples: number;
  actual_samples: number;
  coverage_ratio: number;
  longest_gap_seconds: number;
  /** Median delta between consecutive samples; the basis for expected_samples. */
  sample_interval_seconds: number;
  /**
   * How expected_samples was derived. `nominal_duration` (from the activity
   * row) is the honest one: head/tail sensor drops surface as coverage < 1.
   * `sample_span` only sees interior holes — the documented fallback when no
   * duration is available. Pattern from Kindred / Mi Fitness Data Bridge.
   */
  coverage_anchor: CoverageAnchor;
}

export type ActivitySeries = {
  contract_version: typeof SERIES_CONTRACT_VERSION;
  activity_id: string | number;
  metric: SeriesMetric;
  unit: string;
  /** Absolute clock for the first sample when known; points[].t is relative to this. */
  start_time?: string;
  t_unit: "seconds_from_start";
  resolution_seconds: number;
  requested_resolution_seconds: number;
  points: SeriesPoint[];
  stats: SeriesStats;
  time_in_zone?: TimeInZone;
  downsampled: boolean;
  source_points: number;
  returned_points: number;
  method: "time_bucket_mean" | "none";
  data_quality: DataQuality;
  notes: string[];
}

interface RawSample {
  t: number;
  value: number;
}

/** Percentile with linear interpolation between ranks (numpy default). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * q;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Computed on full-resolution samples. Never call this with downsampled points. */
export function computeStats(values: number[]): SeriesStats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    avg: round(sum / values.length),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    p25: round(percentile(sorted, 0.25)),
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    percentile_method: "linear_interpolation"
  };
}

/**
 * Five zones as percentage bands of a reference max HR (50/60/70/80/90%).
 * Time is attributed per sample using the median sample interval, so a sparse
 * series does not silently inflate the zone totals.
 */
export function computeTimeInZone(
  samples: RawSample[],
  sampleIntervalSeconds: number,
  referenceMaxHr: number,
  referenceSource: TimeInZone["reference_source"]
): TimeInZone {
  const bounds = [0.5, 0.6, 0.7, 0.8, 0.9].map((pct) => Math.round(referenceMaxHr * pct));
  const seconds = new Array(bounds.length).fill(0);

  for (const sample of samples) {
    let index = -1;
    for (let i = bounds.length - 1; i >= 0; i -= 1) {
      if (sample.value >= bounds[i]) {
        index = i;
        break;
      }
    }
    // Below zone 1 is real recovery/idle time, not a zone. Dropping it keeps the
    // percentages meaningful instead of diluting them with coasting.
    if (index >= 0) seconds[index] += sampleIntervalSeconds;
  }

  const total = seconds.reduce((acc, value) => acc + value, 0);
  return {
    zone_model: "percent_of_reference_max_hr",
    reference_max_hr: referenceMaxHr,
    reference_source: referenceSource,
    zones: bounds.map((min, index) => ({
      zone: index + 1,
      min_bpm: min,
      max_bpm: index === bounds.length - 1 ? null : bounds[index + 1] - 1,
      seconds: round(seconds[index], 1),
      percent: total > 0 ? round((seconds[index] / total) * 100, 1) : 0
    }))
  };
}

function medianInterval(samples: RawSample[]): number {
  if (samples.length < 2) return 1;
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].t - samples[i - 1].t;
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return 1;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
  return median > 0 ? median : 1;
}

/**
 * Prefer nominal activity duration when available (duration-anchored coverage).
 * That is the close Kindred shipped first: a missing leading 20 minutes of a
 * 3h ride becomes coverage_ratio ≈ 0.889 instead of "shorter, fully-sampled".
 * Without a duration, fall back to the first-to-last sample span and say so.
 */
export function computeDataQuality(
  samples: RawSample[],
  options: { nominalDurationSeconds?: number } = {}
): DataQuality {
  const interval = medianInterval(samples);
  const span = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;

  let expected: number;
  let coverage_anchor: CoverageAnchor;
  const nominal = options.nominalDurationSeconds;
  if (typeof nominal === "number" && Number.isFinite(nominal) && nominal > 0) {
    // Inclusive of both endpoints, same as the span formula.
    expected = Math.round(nominal / interval) + 1;
    coverage_anchor = "nominal_duration";
  } else {
    // Inclusive of both endpoints: a 10s span at 1s cadence is 11 samples.
    expected = span > 0 ? Math.round(span / interval) + 1 : samples.length;
    coverage_anchor = "sample_span";
  }

  let longestGap = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].t - samples[i - 1].t;
    if (delta > longestGap) longestGap = delta;
  }

  // Head/tail gaps against a nominal duration are not interior holes, so they
  // do not raise longest_gap_seconds. Surface them via coverage_ratio instead.
  if (coverage_anchor === "nominal_duration" && samples.length > 0 && typeof nominal === "number") {
    const headGap = Math.max(0, samples[0].t);
    const tailGap = Math.max(0, nominal - samples[samples.length - 1].t);
    const edge = Math.max(headGap, tailGap);
    if (edge > longestGap) longestGap = edge;
  }

  return {
    expected_samples: expected,
    actual_samples: samples.length,
    coverage_ratio: expected > 0 ? round(Math.min(samples.length / expected, 1), 3) : 1,
    longest_gap_seconds: round(longestGap, 1),
    sample_interval_seconds: round(interval, 2),
    coverage_anchor
  };
}

/**
 * Fixed time-bucket downsampling. Each bucket reports mean/min/max/count so the
 * intra-bucket spread stays visible instead of being flattened into one number.
 */
export function downsampleToBuckets(samples: RawSample[], resolutionSeconds: number): SeriesPoint[] {
  if (samples.length === 0) return [];
  const origin = samples[0].t;
  const buckets = new Map<number, { sum: number; min: number; max: number; count: number }>();

  for (const sample of samples) {
    const index = Math.floor((sample.t - origin) / resolutionSeconds);
    const bucket = buckets.get(index);
    if (bucket) {
      bucket.sum += sample.value;
      bucket.count += 1;
      if (sample.value < bucket.min) bucket.min = sample.value;
      if (sample.value > bucket.max) bucket.max = sample.value;
    } else {
      buckets.set(index, { sum: sample.value, min: sample.value, max: sample.value, count: 1 });
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, bucket]) => ({
      t: round(origin + index * resolutionSeconds, 1),
      value: round(bucket.sum / bucket.count),
      min: round(bucket.min),
      max: round(bucket.max),
      samples: bucket.count
    }));
}

/**
 * Pick the smallest resolution that is >= the requested one and still fits the
 * point budget. Returning a coarser series with an honest label beats refusing
 * the call or blowing the caller's context.
 */
export function resolveEffectiveResolution(
  samples: RawSample[],
  requestedResolutionSeconds: number,
  maxPoints: number
): number {
  if (samples.length === 0) return requestedResolutionSeconds;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span <= 0) return requestedResolutionSeconds;

  let resolution = requestedResolutionSeconds;
  // Ceil so the bucket count lands at or under budget on the first try.
  const needed = Math.ceil(span / maxPoints);
  if (needed > resolution) resolution = needed;

  // Bucket boundaries are floor-based, so the arithmetic estimate can be one
  // bucket optimistic. Walk up until the real count fits.
  while (downsampleToBuckets(samples, resolution).length > maxPoints) {
    resolution += Math.max(1, Math.ceil(resolution * 0.1));
  }
  return resolution;
}

export interface GarminDetailsPayload {
  activityId?: string | number;
  metricDescriptors?: Array<{ key?: string; metricsIndex?: number; unit?: { key?: string } }>;
  activityDetailMetrics?: Array<{ metrics?: Array<number | null> }>;
  [key: string]: unknown;
}

/**
 * Pull one metric out of Garmin's column-oriented details payload.
 *
 * Garmin ships `metricDescriptors` (key -> column index) plus
 * `activityDetailMetrics` (one row per sample). Nulls are dropped rather than
 * zero-filled: a missing HR reading is not a heart rate of zero, and imputing
 * one would corrupt every downstream stat.
 */
export function extractSamples(payload: GarminDetailsPayload, metric: SeriesMetric): RawSample[] {
  const descriptors = payload.metricDescriptors ?? [];
  const rows = payload.activityDetailMetrics ?? [];
  if (descriptors.length === 0 || rows.length === 0) return [];

  const indexFor = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const descriptor = descriptors.find((item) => item?.key === key);
      if (descriptor && typeof descriptor.metricsIndex === "number") return descriptor.metricsIndex;
    }
    return undefined;
  };

  const valueIndex = indexFor(METRIC_DESCRIPTOR_KEYS[metric]);
  if (valueIndex === undefined) return [];

  const timeKey = TIMESTAMP_KEYS.find((key) => descriptors.some((item) => item?.key === key));
  const timeIndex = timeKey ? indexFor([timeKey]) : undefined;
  const timeIsEpoch = timeKey === "directTimestamp";

  const samples: RawSample[] = [];
  let epochOrigin: number | undefined;

  for (const [rowIndex, row] of rows.entries()) {
    const metrics = row?.metrics;
    if (!Array.isArray(metrics)) continue;

    const rawValue = metrics[valueIndex];
    if (rawValue === null || rawValue === undefined || !Number.isFinite(Number(rawValue))) continue;

    let t: number;
    if (timeIndex !== undefined) {
      const rawTime = metrics[timeIndex];
      if (rawTime === null || rawTime === undefined || !Number.isFinite(Number(rawTime))) continue;
      const numericTime = Number(rawTime);
      if (timeIsEpoch) {
        // Garmin sends epoch milliseconds here; normalize to seconds from start.
        if (epochOrigin === undefined) epochOrigin = numericTime;
        t = (numericTime - epochOrigin) / 1000;
      } else {
        t = numericTime;
      }
    } else {
      // No clock column: fall back to row order at 1 Hz and say so upstream.
      t = rowIndex;
    }

    samples.push({ t, value: Number(rawValue) });
  }

  samples.sort((a, b) => a.t - b.t);
  return samples;
}

/** Pull nominal duration (seconds) from a Garmin activity summary row. */
export function pickActivityDurationSeconds(summary: Record<string, unknown> | null | undefined): number | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const candidates = [
    summary.duration,
    summary.elapsedDuration,
    summary.movingDuration,
    summary.durationInSeconds,
    summary.elapsedDurationInSeconds,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.duration,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.elapsedDuration
  ];
  for (const value of candidates) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** Pull recorded max HR from a Garmin activity summary row. */
export function pickActivityMaxHr(summary: Record<string, unknown> | null | undefined): number | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const candidates = [
    summary.maxHR,
    summary.maxHeartRate,
    summary.maxHeartRateInBeatsPerMinute,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.maxHR,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.maxHeartRate
  ];
  for (const value of candidates) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n) && n >= 100 && n <= 240) return n;
  }
  return undefined;
}

/** Pull start clock (ISO-ish string) from a Garmin activity summary row. */
export function pickActivityStartTime(summary: Record<string, unknown> | null | undefined): string | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const candidates = [
    summary.startTimeGMT,
    summary.startTimeLocal,
    summary.beginTimestamp,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.startTimeGMT,
    (summary.summaryDTO as Record<string, unknown> | undefined)?.startTimeLocal
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      // Garmin sometimes ships epoch ms.
      const ms = value > 1e12 ? value : value * 1000;
      return new Date(ms).toISOString();
    }
  }
  return undefined;
}

export interface BuildActivitySeriesOptions {
  activityId: string | number;
  metric: SeriesMetric;
  resolutionSeconds?: number;
  maxPoints?: number;
  /** Caller-supplied reference max HR (zones comparable across activities). */
  referenceMaxHr?: number;
  /**
   * Max HR recorded on the activity summary row (Garmin maxHR / maxHeartRate).
   * Used when the caller did not pass referenceMaxHr — preferred over the
   * series-observed max so zones match the activity card.
   */
  activityRecordedMaxHr?: number;
  /**
   * Nominal activity duration in seconds from the activity row. Enables
   * duration-anchored coverage (Kindred pattern). Omit only when unknown.
   */
  nominalDurationSeconds?: number;
  /** Absolute start clock for the envelope, when known (ISO 8601). */
  startTime?: string;
}

/**
 * Turn a raw Garmin details payload into the bounded, self-describing series
 * contract. Throws on an empty/unsupported metric so the tool layer can return a
 * real error instead of an empty series that reads like "no effort recorded".
 */
export function buildActivitySeries(
  payload: GarminDetailsPayload,
  options: BuildActivitySeriesOptions
): ActivitySeries {
  const {
    activityId,
    metric,
    resolutionSeconds = SERIES_DEFAULT_RESOLUTION_SECONDS,
    maxPoints = SERIES_DEFAULT_MAX_POINTS,
    referenceMaxHr,
    activityRecordedMaxHr,
    nominalDurationSeconds,
    startTime
  } = options;

  const budget = Math.min(Math.max(1, Math.trunc(maxPoints)), SERIES_HARD_MAX_POINTS);
  const requested = Math.max(1, Math.trunc(resolutionSeconds));
  const notes: string[] = [];

  const descriptors = payload.metricDescriptors ?? [];
  if (descriptors.some((item) => item?.key && FORBIDDEN_DESCRIPTOR_KEYS.has(item.key))) {
    notes.push("Positional columns present upstream were ignored; GPS never enters a series response.");
  }

  const samples = extractSamples(payload, metric);
  if (samples.length === 0) {
    throw new Error(
      `No ${metric} samples in activity ${activityId}. Garmin did not record this metric, or the activity has no detail samples.`
    );
  }

  const hasClock = (payload.metricDescriptors ?? []).some((item) => item?.key && TIMESTAMP_KEYS.includes(item.key));
  if (!hasClock) {
    notes.push("No timestamp column in payload; sample index was used as a 1 Hz clock.");
  }

  const values = samples.map((sample) => sample.value);
  const stats = computeStats(values);
  const dataQuality = computeDataQuality(samples, { nominalDurationSeconds });

  const effective = resolveEffectiveResolution(samples, requested, budget);
  if (effective !== requested) {
    notes.push(
      `Requested ${requested}s resolution would exceed max_points=${budget}; served at ${effective}s instead.`
    );
  }

  // Below the native sample rate there is nothing to bucket — return full precision.
  const shouldDownsample = effective > dataQuality.sample_interval_seconds && samples.length > budget;
  const points: SeriesPoint[] = shouldDownsample
    ? downsampleToBuckets(samples, effective)
    : samples.map((sample) => ({
        t: round(sample.t, 1),
        value: round(sample.value),
        min: round(sample.value),
        max: round(sample.value),
        samples: 1
      }));

  if (dataQuality.coverage_ratio < 0.9) {
    notes.push(
      `Sparse series: ${dataQuality.actual_samples} of ~${dataQuality.expected_samples} expected samples ` +
        `(anchor=${dataQuality.coverage_anchor}, longest gap ${dataQuality.longest_gap_seconds}s). Treat the shape as indicative.`
    );
  }

  let timeInZone: TimeInZone | undefined;
  if (metric === "heart_rate") {
    let source: ReferenceSource;
    let reference: number;
    if (referenceMaxHr !== undefined) {
      source = "caller_provided";
      reference = referenceMaxHr;
    } else if (
      typeof activityRecordedMaxHr === "number" &&
      Number.isFinite(activityRecordedMaxHr) &&
      activityRecordedMaxHr > 0
    ) {
      source = "activity_recorded_max";
      reference = Math.round(activityRecordedMaxHr);
    } else {
      source = "observed_max";
      reference = Math.round(stats.max);
    }
    timeInZone = computeTimeInZone(samples, dataQuality.sample_interval_seconds, reference, source);
    if (source !== "caller_provided") {
      notes.push(
        `reference_max_hr source=${source}. Pass reference_max_hr for zones that compare across activities.`
      );
    }
  }

  return {
    contract_version: SERIES_CONTRACT_VERSION,
    activity_id: activityId,
    metric,
    unit: METRIC_UNITS[metric],
    start_time: startTime,
    t_unit: "seconds_from_start",
    resolution_seconds: shouldDownsample ? effective : round(dataQuality.sample_interval_seconds, 2),
    requested_resolution_seconds: requested,
    points,
    stats,
    time_in_zone: timeInZone,
    downsampled: shouldDownsample,
    source_points: samples.length,
    returned_points: points.length,
    method: shouldDownsample ? "time_bucket_mean" : "none",
    data_quality: dataQuality,
    notes
  };
}
