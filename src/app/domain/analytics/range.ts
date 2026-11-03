import type { Weekday } from '../models/enums';
import { addDays, dayKey, monthKey, parseDayKey, startOfWeek, type DayKey } from '../time/day-key';

/**
 * The windows PRODUCT_SPEC section 4.9 asks for, and the granularity each is
 * read at.
 *
 * The two are tied together on purpose. A year of daily bars is 365 marks on a
 * 350 px screen — three-quarters of a pixel each — which is not a chart but a
 * texture. Choosing the bucket from the range means the user picks a span and
 * gets something legible, rather than picking a span and then being asked a
 * second question they have no way to answer.
 */
export type TimeRange = '7d' | '30d' | '3m' | '6m' | '1y' | 'all';

export const TIME_RANGES: readonly TimeRange[] = ['7d', '30d', '3m', '6m', '1y', 'all'];

export type Bucketing = 'day' | 'week' | 'month';

/** Day buckets up to a month, weeks to half a year, months beyond. */
export function bucketingFor(range: TimeRange): Bucketing {
  if (range === '7d' || range === '30d') return 'day';
  if (range === '3m' || range === '6m') return 'week';
  return 'month';
}

export interface Window {
  /** Inclusive. `null` for "all time", which has no start until the data does. */
  from: DayKey | null;
  /** Inclusive, normally today. */
  to: DayKey;
}

/**
 * The window a range covers, ending today.
 *
 * Counted in calendar days rather than milliseconds: across a daylight-saving
 * boundary a day is 23 or 25 hours, and "30 days ago" computed by subtraction
 * lands on the wrong date twice a year.
 *
 * `7d` means today and the six days before it — seven days inclusive, which is
 * what someone picking "7 days" means. Off by one here is a bar's worth of
 * training appearing or vanishing from the chart.
 */
export function windowFor(range: TimeRange, today: DayKey): Window {
  if (range === 'all') return { from: null, to: today };

  const end = parseDayKey(today);
  const starts: Record<Exclude<TimeRange, 'all'>, () => Date> = {
    '7d': () => addDays(end, -6),
    '30d': () => addDays(end, -29),
    '3m': () => monthsBefore(end, 3),
    '6m': () => monthsBefore(end, 6),
    '1y': () => monthsBefore(end, 12),
  };

  return { from: dayKey(starts[range]()), to: today };
}

/**
 * The same date some months earlier, clamped to the end of a shorter month.
 *
 * Three months before 31 May is 28 February, not 3 March. `setMonth` rolls
 * over on its own, which would quietly extend the window past the range the
 * user asked for.
 */
function monthsBefore(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  // One day forward: a 3-month window ending today starts the day *after* the
  // same date three months ago, so the span is three months rather than three
  // months and a day.
  return addDays(target, 1);
}

/** Which bucket a day belongs to. */
export function bucketKeyOf(day: DayKey, bucketing: Bucketing, weekStartsOn: Weekday): string {
  if (bucketing === 'day') return day;
  if (bucketing === 'month') return monthKey(parseDayKey(day));
  return dayKey(startOfWeek(parseDayKey(day), weekStartsOn));
}

/**
 * Every bucket in a window, in order, including the ones with nothing in them.
 *
 * The empty buckets are the point. A chart built only from buckets that have
 * data draws a line straight from March to June with no indication that April
 * and May happened — the single most misleading thing a progress chart can do.
 * Emitting every bucket lets the series decide what an absence *means*, which
 * is a different answer for volume than for body weight.
 */
export function bucketsIn(window: Window, bucketing: Bucketing, weekStartsOn: Weekday): string[] {
  if (window.from === null) return [];

  const keys: string[] = [];
  const last = bucketKeyOf(window.to, bucketing, weekStartsOn);
  let cursor = parseDayKey(bucketKeyOf(window.from, bucketing, weekStartsOn));

  // Guarded by the key comparison rather than by a date comparison: a month
  // bucket's key is 'YYYY-MM', and both forms sort correctly as strings.
  for (let guard = 0; guard < 4000; guard++) {
    const key = bucketKeyOf(dayKey(cursor), bucketing, weekStartsOn);
    keys.push(key);
    if (key >= last) break;
    cursor = advance(cursor, bucketing);
  }

  return keys;
}

function advance(cursor: Date, bucketing: Bucketing): Date {
  if (bucketing === 'day') return addDays(cursor, 1);
  if (bucketing === 'week') return addDays(cursor, 7);
  return new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
}

/** Whether a day falls inside the window. */
export function withinWindow(day: DayKey, window: Window): boolean {
  return (window.from === null || day >= window.from) && day <= window.to;
}
