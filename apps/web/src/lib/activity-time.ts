import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./format";

/**
 * Two-way conversion between `datetime-local` values and epoch milliseconds in
 * a Tema timezone.
 *
 * The math lives in `format.ts`, which uses only `Intl.DateTimeFormat` (no date
 * library). This module adds the input validation the form needs: a malformed
 * or impossible wall-clock value is `null`, never a silently normalized date.
 */

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Parses a wall-clock input in `timeZone`; blank or invalid input is `null`. */
export function localInputToEpoch(value: string, timeZone: string): number | null {
  const trimmed = value.trim();
  const match = LOCAL_INPUT_PATTERN.exec(trimmed);
  if (!match) return null;

  const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart] = match;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  const second = Number(secondPart ?? "0");

  if (month < 1 || month > 12) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (!isRealCalendarDate(year, month, day)) return null;

  try {
    const epoch = fromDateTimeLocalValue(trimmed, timeZone);
    if (epoch === null) return null;

    // A wall-clock value inside a DST gap does not exist; Intl would silently
    // shift it forward. Round-trip and reject instead of storing a different
    // time than the admin typed.
    if (toDateTimeLocalValue(epoch, timeZone) !== trimmed.slice(0, 16)) return null;

    return epoch;
  } catch {
    return null;
  }
}

/** Fills a `datetime-local` value from epoch ms in `timeZone`; invalid input is blank. */
export function epochToLocalInput(epoch: number, timeZone: string): string {
  if (!Number.isFinite(epoch)) return "";

  try {
    return toDateTimeLocalValue(epoch, timeZone);
  } catch {
    return "";
  }
}
