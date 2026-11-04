import { RECOVERY_WINDOW_DAYS } from '../models/entity';

/**
 * The arithmetic behind "recoverable for 30 days" (DATABASE_SPEC section 9.3).
 *
 * Pure, because the screen that promises the window and the routine that ends
 * it have to agree exactly. A record the list offers to restore and the purge
 * considers expired is the worst possible disagreement: the user taps Restore
 * on something that is already gone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Tombstoned {
  id: string;
  /** Null means not deleted; those never appear here. */
  deletedAt: string | null;
}

/** When a tombstone stops being recoverable. */
export function expiresAt(deletedAt: string): number {
  return Date.parse(deletedAt) + RECOVERY_WINDOW_DAYS * DAY_MS;
}

/**
 * Whole days left, floored, never below zero.
 *
 * Floored rather than rounded so the number never promises a day that is not
 * there: at 29.6 days gone the screen says "today", not "tomorrow".
 */
export function daysLeft(deletedAt: string, nowMs: number): number {
  const remaining = expiresAt(deletedAt) - nowMs;
  return remaining <= 0 ? 0 : Math.floor(remaining / DAY_MS);
}

export function isRecoverable(deletedAt: string, nowMs: number): boolean {
  return expiresAt(deletedAt) > nowMs;
}

/**
 * Splits tombstones into what can still come back and what cannot.
 *
 * A record with an unparseable `deletedAt` counts as expired: it is already
 * invisible everywhere else in the app, and a date nothing can read is not a
 * promise anyone can keep.
 */
export function partitionByWindow<T extends Tombstoned>(
  rows: readonly T[],
  nowMs: number,
): { recoverable: T[]; expired: T[] } {
  const recoverable: T[] = [];
  const expired: T[] = [];

  for (const row of rows) {
    if (row.deletedAt === null) continue;
    const at = Date.parse(row.deletedAt);
    if (Number.isNaN(at) || !isRecoverable(row.deletedAt, nowMs)) expired.push(row);
    else recoverable.push(row);
  }

  // Newest first: the thing most likely to have been deleted by mistake is
  // the thing deleted a moment ago.
  recoverable.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return { recoverable, expired };
}
