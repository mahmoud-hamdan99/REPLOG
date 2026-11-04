/**
 * What to do as the browser's storage fills up (DATABASE_SPEC section 9.4).
 *
 * The thresholds live here rather than in the two stores that act on them,
 * because a warning that appears at one number and a block that bites at
 * another is the kind of disagreement nobody notices until a user is told
 * "storage is nearly full" by a screen that has already stopped saving.
 */

/** Warn, and offer the quickest way to free space. */
export const NEAR_QUOTA = 0.8;

/**
 * Stop writing photos. Workouts keep logging.
 *
 * The asymmetry is the whole point: a set log is a few hundred bytes of
 * something that happened and cannot be re-recorded, and a photo is hundreds
 * of kilobytes that can be taken again. When only one of them can be written,
 * it is not a close call.
 */
export const AT_QUOTA = 0.95;

export interface QuotaReading {
  usageBytes: number | null;
  quotaBytes: number | null;
}

/**
 * Fraction of the quota in use, or null when the browser will not say.
 *
 * Null rather than zero. "We cannot tell" and "nothing stored" look identical
 * on a meter and mean opposite things, and treating the first as the second
 * would block photo writes on every browser that declines to answer.
 */
export function usageFraction(reading: QuotaReading): number | null {
  if (reading.usageBytes === null || !reading.quotaBytes) return null;
  return reading.usageBytes / reading.quotaBytes;
}

export function isNearQuota(reading: QuotaReading): boolean {
  return (usageFraction(reading) ?? 0) > NEAR_QUOTA;
}

export function isAtQuota(reading: QuotaReading): boolean {
  return (usageFraction(reading) ?? 0) > AT_QUOTA;
}
