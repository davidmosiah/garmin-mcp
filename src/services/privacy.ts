import type { GarminConfig, PrivacyMode } from "../types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

export function resolvePrivacyMode(config: GarminConfig, override?: PrivacyMode): PrivacyMode {
  return override ?? config.privacyMode;
}

export function applyPrivacy(endpoint: string, payload: unknown, mode: PrivacyMode): unknown {
  if (mode === "raw") return payload;
  if (isObject(payload) && Array.isArray(payload.records)) {
    return { ...payload, privacy_mode: mode, records: payload.records.map((record) => normalizeRecord(endpoint, record, mode)) };
  }
  if (Array.isArray(payload)) return payload.map((record) => normalizeRecord(endpoint, record, mode));
  return normalizeRecord(endpoint, payload, mode);
}

export function normalizeRecord(endpoint: string, record: unknown, mode: PrivacyMode): unknown {
  if (!isObject(record)) return record;
  if (endpoint.includes("socialProfile") || endpoint.includes("userprofile")) return normalizeProfile(record, mode);
  if (endpoint.includes("deviceregistration") || endpoint.includes("device-info")) return normalizeDevice(record, mode);
  if (endpoint.includes("activities/search/activities") || endpoint.includes("activities/")) return normalizeActivity(record, mode);
  if (endpoint.includes("activity-service/activity") && endpoint.includes("/details")) return normalizeActivityDetail(record, mode);
  if (endpoint.includes("activity-service/activity")) return normalizeActivity(record, mode);
  if (endpoint.includes("dailySleepData")) return normalizeSleep(record, mode);
  if (endpoint.includes("dailyHeartRate") || endpoint.includes("hrv-service") || endpoint.includes("daily/spo2") || endpoint.includes("daily/respiration")) return normalizeVitals(record, mode);
  if (endpoint.includes("dailyStress")) return normalizeStress(record, mode);
  if (endpoint.includes("bodyBattery")) return normalizeBodyBattery(record, mode);
  if (endpoint.includes("trainingreadiness") || endpoint.includes("trainingstatus")) return mode === "summary" ? summarizeUnknown(record) : removeSensitive(record);
  if (endpoint.includes("usersummary") || endpoint.includes("dailySummaryChart") || endpoint.includes("daily/im")) return normalizeDailySummary(record, mode);
  if (endpoint.includes("weight-service")) return normalizeWeight(record, mode);
  if (endpoint.includes("hydration")) return normalizeHydration(record, mode);
  return mode === "summary" ? summarizeUnknown(record) : removeSensitive(record);
}

export function normalizeStreams(payload: unknown, mode: PrivacyMode, includeGps: boolean): unknown {
  if (mode === "raw") return payload;
  if (!isObject(payload)) return payload;
  const clean = removeSensitive(payload);
  if (!includeGps) removeGpsFields(clean);
  if (mode === "summary") return summarizeUnknown(clean);
  return clean;
}

function normalizeProfile(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    displayName: record.displayName,
    userId: mode === "summary" ? undefined : record.userId,
    profileId: mode === "summary" ? undefined : record.profileId,
    fullName: mode === "summary" ? undefined : record.fullName,
    location: mode === "summary" ? undefined : record.location,
    userProfileFullName: mode === "summary" ? undefined : record.userProfileFullName
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...base, ...record });
}

function normalizeDevice(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const devices = Array.isArray(record) ? record : [record];
  const normalized = devices.map((device) => {
    if (!isObject(device)) return device;
    const base = pickDefined({
      deviceId: mode === "summary" ? undefined : device.deviceId,
      unitId: mode === "summary" ? undefined : device.unitId,
      productName: device.productName,
      displayName: device.displayName,
      deviceType: device.deviceType,
      softwareVersion: device.softwareVersion,
      batteryLevel: device.batteryLevel,
      lastSyncTime: device.lastSyncTime,
      primary: device.primary
    });
    return mode === "summary" ? base : removeSensitive({ ...base, ...device });
  });
  return Array.isArray(record) ? normalized : normalized[0];
}

function normalizeDailySummary(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    calendarDate: record.calendarDate,
    totalSteps: record.totalSteps ?? record.steps,
    totalKilocalories: record.totalKilocalories,
    activeKilocalories: record.activeKilocalories,
    wellnessDistanceMeters: record.wellnessDistanceMeters ?? record.distanceMeters,
    moderateIntensityMinutes: record.moderateIntensityMinutes,
    vigorousIntensityMinutes: record.vigorousIntensityMinutes,
    restingHeartRate: record.restingHeartRate,
    averageStressLevel: record.averageStressLevel ?? record.avgStressLevel,
    bodyBatteryMostRecentValue: record.bodyBatteryMostRecentValue
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...base, ...record });
}

function normalizeActivity(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    activityId: record.activityId,
    activityName: record.activityName ?? record.activityType,
    activityType: record.activityType,
    startTimeLocal: record.startTimeLocal,
    duration: record.duration,
    elapsedDuration: record.elapsedDuration,
    distance: record.distance,
    calories: record.calories,
    averageHR: record.averageHR ?? record.averageHeartRate,
    averageHeartRate: record.averageHeartRate,
    maxHR: record.maxHR,
    aerobicTrainingEffect: record.aerobicTrainingEffect,
    anaerobicTrainingEffect: record.anaerobicTrainingEffect
  });
  if (mode === "summary") return base;
  const clean = removeSensitive({ ...base, ...record });
  removeGpsFields(clean);
  return clean;
}

function normalizeActivityDetail(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const clean = removeSensitive(record);
  removeGpsFields(clean);
  if (mode === "summary") return summarizeUnknown(clean);
  return clean;
}

function normalizeSleep(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const sleep = isObject(record.dailySleepDTO) ? record.dailySleepDTO : record;
  const base = pickDefined({
    calendarDate: sleep.calendarDate,
    sleepTimeSeconds: sleep.sleepTimeSeconds,
    deepSleepSeconds: sleep.deepSleepSeconds,
    lightSleepSeconds: sleep.lightSleepSeconds,
    remSleepSeconds: sleep.remSleepSeconds,
    awakeSleepSeconds: sleep.awakeSleepSeconds,
    sleepScore: sleep.sleepScore ?? sleep.overallSleepScore
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, dailySleepDTO: { ...base, ...sleep } });
}

function normalizeVitals(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return summarizeUnknown(record);
  return removeSensitive(record);
}

function normalizeStress(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    calendarDate: record.calendarDate,
    avgStressLevel: record.avgStressLevel ?? record.averageStressLevel,
    maxStressLevel: record.maxStressLevel,
    restStressDuration: record.restStressDuration,
    activityStressDuration: record.activityStressDuration
  });
  return mode === "summary" ? base : removeSensitive({ ...base, ...record });
}

function normalizeBodyBattery(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    calendarDate: record.calendarDate,
    charged: record.charged,
    drained: record.drained,
    bodyBatteryMostRecentValue: record.bodyBatteryMostRecentValue,
    startTimestampLocal: record.startTimestampLocal,
    endTimestampLocal: record.endTimestampLocal
  });
  return mode === "summary" ? base : removeSensitive({ ...base, ...record });
}

function normalizeWeight(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (Array.isArray(record.weightDTOList)) return { weightDTOList: record.weightDTOList.map((item) => isObject(item) ? normalizeWeight(item, mode) : item) };
  const base = pickDefined({ date: record.calendarDate ?? record.date, weight: record.weight, bmi: record.bmi, bodyFat: record.bodyFat });
  return mode === "summary" ? base : removeSensitive({ ...base, ...record });
}

function normalizeHydration(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({ calendarDate: record.calendarDate, valueInML: record.valueInML, goalInML: record.goalInML, sweatLossInML: record.sweatLossInML });
  return mode === "summary" ? base : removeSensitive({ ...base, ...record });
}

function summarizeUnknown(record: Record<string, unknown>): Record<string, unknown> {
  return pickDefined({
    id: record.id ?? record.activityId ?? record.userId,
    date: record.date ?? record.calendarDate ?? record.startTimeLocal,
    name: record.name ?? record.activityName ?? record.displayName,
    status: record.status ?? record.trainingStatus,
    score: record.score ?? record.sleepScore ?? record.trainingReadinessScore,
    summary: record.summary,
    value: record.value
  });
}

/** Top-level and nested secret-ish keys (identity + OAuth session). */
function isSensitiveKey(key: string): boolean {
  return [
    "email",
    "emailAddress",
    "fullName",
    "firstName",
    "lastName",
    "avatar",
    "profileImageUrlLarge",
    "profileImageUrlMedium",
    "profileImageUrlSmall",
    "access_token",
    "refresh_token",
    "di_token",
    "di_refresh_token",
    "jwt_web",
    "csrf_token",
    "password",
    "location",
    "address"
  ].includes(key);
}

/** GPS / route geometry keys — stripped at every nesting level (Polar/Strava parity). */
function isGpsKey(key: string): boolean {
  return [
    "startLatitude",
    "startLongitude",
    "start_latlng",
    "endLatitude",
    "endLongitude",
    "end_latlng",
    "latitude",
    "longitude",
    "lat",
    "lon",
    "lng",
    "latlng",
    "coordinates",
    "coordinate",
    "gps",
    "gpx",
    "geoPolylineDTO",
    "map",
    "polyline",
    "summary_polyline"
  ].includes(key);
  // Note: do not drop whole "points"/"routePoints" arrays — recurse into them so
  // elevation/time samples can remain while lat/lon fields are stripped.
}

function deepRedact(value: unknown, dropKey: (key: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => deepRedact(item, dropKey));
  if (!isObject(value)) return value;
  const clone: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (dropKey(key)) continue;
    clone[key] = deepRedact(child, dropKey);
  }
  return clone;
}

function removeSensitive(record: Record<string, unknown>): Record<string, unknown> {
  return deepRedact(record, (key) => isSensitiveKey(key) || isGpsKey(key)) as Record<string, unknown>;
}

/** In-place recursive GPS strip (used when includeGps=false after base redaction). */
function removeGpsFields(record: Record<string, unknown>): void {
  const cleaned = deepRedact(record, isGpsKey) as Record<string, unknown>;
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, cleaned);
}
