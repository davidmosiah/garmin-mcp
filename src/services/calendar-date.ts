const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Garmin wellness endpoints key off a civil calendar date, not a UTC instant.
 * Subtracting 24h then formatting can skip a local day around DST spring-forward;
 * resolve "today" in the IANA zone first, then shift whole civil days.
 */
export function calendarDateString(daysAgo = 0, timeZone?: string, now: number | Date = Date.now()): string {
  const epochMs = typeof now === "number" ? now : now.getTime();
  const zone = resolveIanaTimeZone(timeZone);
  const today = formatCivilDate(epochMs, zone);
  return daysAgo === 0 ? today : shiftCivilDate(today, -daysAgo);
}

export function resolveIanaTimeZone(timeZone?: string): string {
  const trimmed = timeZone?.trim();
  if (!trimmed || trimmed === "UTC") return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
    return trimmed;
  } catch {
    return "UTC";
  }
}

function formatCivilDate(epochMs: number, timeZone: string): string {
  if (timeZone === "UTC") return new Date(epochMs).toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const civil = `${byType.year}-${byType.month}-${byType.day}`;
  return CIVIL_DATE.test(civil) ? civil : new Date(epochMs).toISOString().slice(0, 10);
}

function shiftCivilDate(civil: string, deltaDays: number): string {
  const [year, month, day] = civil.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}
