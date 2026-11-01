/**
 * Presentation-only formatting. The Worker stores UTC epoch milliseconds and
 * converts nothing; every timezone conversion happens here (AGENTS.md data
 * integrity rule).
 */

const UNKNOWN_SCHEDULE = "Belum dijadwalkan";

function formatter(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDateTime(value: number | null, timeZone: string): string {
  if (value === null) return UNKNOWN_SCHEDULE;
  return formatter(timeZone, true).format(new Date(value));
}

export function formatDate(value: number | null, timeZone: string): string {
  if (value === null) return UNKNOWN_SCHEDULE;
  return formatter(timeZone, false).format(new Date(value));
}

/** `start – end`; degrades to whichever bound exists. */
export function formatSchedule(
  startsAt: number | null,
  endsAt: number | null,
  timeZone: string,
): string {
  if (startsAt === null && endsAt === null) return UNKNOWN_SCHEDULE;
  if (startsAt !== null && endsAt === null) return formatDateTime(startsAt, timeZone);
  if (startsAt === null && endsAt !== null) return `Selesai ${formatDateTime(endsAt, timeZone)}`;

  return `${formatDateTime(startsAt, timeZone)} – ${formatDateTime(endsAt, timeZone)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 *
 * `Intl` can only format, not parse, so the wall-clock parts are reassembled as
 * if they were UTC and compared with the real instant. This is the standard
 * trick for timezone-aware datetime inputs without a date library.
 */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );

  return asUtc - at.getTime();
}

/** Fills a datetime-local input from epoch ms, expressed in the event timezone. */
export function toDateTimeLocalValue(value: number | null, timeZone: string): string {
  if (value === null) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));

  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get(
    "hour",
  )}:${values.get("minute")}`;
}

/**
 * Parses a datetime-local value as wall-clock time in `timeZone`; blank means
 * "not set". Two passes handle DST boundaries: the first estimate may use the
 * offset on the wrong side of a transition.
 */
export function fromDateTimeLocalValue(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );

  if (!Number.isFinite(utcGuess)) return null;

  const first = utcGuess - timeZoneOffsetMs(timeZone, new Date(utcGuess));
  return utcGuess - timeZoneOffsetMs(timeZone, new Date(first));
}
