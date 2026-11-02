import type { Weekday } from '../models/enums';

/**
 * Calendar maths.
 *
 * Day keys are **local**, not UTC. A session logged at 23:30 belongs to that
 * evening, not to the next morning, and a weigh-in at 00:10 belongs to the day
 * the user thinks it does. Every bucket, streak and comparison therefore works
 * on local day keys, while instants stay ISO-8601 UTC.
 */

export type DayKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const DAY_MS = 86_400_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Local calendar day of an instant. */
export function dayKey(date: Date): DayKey {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar month of an instant. */
export function monthKey(date: Date): MonthKey {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}`;
}

/** Midnight local time at the start of a day key. */
export function parseDayKey(key: DayKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/**
 * Adds days in *calendar* terms, not by adding 86,400,000 ms.
 *
 * Across a daylight-saving boundary a day is 23 or 25 hours long, so millisecond
 * arithmetic drifts by an hour and can land on the wrong date. Constructing a
 * new local date lets the platform resolve the offset.
 */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** First day of the week containing `date`, honouring the user's week start. */
export function startOfWeek(date: Date, weekStartsOn: Weekday): Date {
  const start = startOfDay(date);
  const shift = (start.getDay() - weekStartsOn + 7) % 7;
  return addDays(start, -shift);
}

/**
 * Bucket key for a week: the day key of its first day.
 *
 * Deliberately not an ISO week number. ISO weeks always start on Monday, but
 * the user can choose Sunday, Monday or Saturday, and a key that disagrees with
 * the displayed week boundary produces charts whose bars do not match the
 * calendar the user is looking at. A start-of-week day key also sorts correctly
 * as a string and never needs year-boundary special cases.
 */
export function weekKey(date: Date, weekStartsOn: Weekday): DayKey {
  return dayKey(startOfWeek(date, weekStartsOn));
}

/** Inclusive list of day keys between two dates. */
export function dayKeysBetween(from: Date, to: Date): DayKey[] {
  const keys: DayKey[] = [];
  let cursor = startOfDay(from);
  const last = startOfDay(to);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/** Whole days between two day keys, using noon to sidestep DST shifts. */
export function daysBetween(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  a.setHours(12, 0, 0, 0);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
