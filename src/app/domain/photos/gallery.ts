import type { Photo } from '../models/body';
import type { Pose } from '../models/enums';
import { daysBetween, monthKey, parseDayKey } from '../time/day-key';

/**
 * Arranging a photo library, and reading two photos against each other.
 *
 * Pure, so the grouping and the interval are testable without a canvas, a
 * blob or a browser — the parts of this feature that are genuinely hard to
 * test are the pixels, and keeping the arithmetic out of there is what makes
 * the arithmetic provable.
 */

/**
 * Filter order, which is also the order the chips appear in.
 *
 * Front, side, back is how people photograph themselves and how they think
 * about the result; `other` last because it is the bucket, not a pose.
 */
export const POSES: readonly Pose[] = ['front', 'side-left', 'side-right', 'back', 'other'];

export interface PhotoGroup {
  /** `YYYY-MM`, for the heading. */
  month: string;
  photos: Photo[];
}

/**
 * Newest first, grouped by the month each photo was taken in.
 *
 * By month rather than by day: a progress photo is a weekly or monthly habit,
 * and a heading per day would push the grid itself off the screen. Ordering is
 * by `takenAt` and then by `recordedAt`, so two photos imported together on
 * the same day keep the order they arrived in.
 */
export function groupByMonth(photos: readonly Photo[]): PhotoGroup[] {
  const groups = new Map<string, Photo[]>();

  for (const photo of sortNewestFirst(photos)) {
    const month = monthKey(parseDayKey(photo.takenAt));
    const bucket = groups.get(month);
    if (bucket) bucket.push(photo);
    else groups.set(month, [photo]);
  }

  return [...groups].map(([month, grouped]) => ({ month, photos: grouped }));
}

export function sortNewestFirst(photos: readonly Photo[]): Photo[] {
  return [...photos].sort((a, b) =>
    a.takenAt === b.takenAt
      ? b.recordedAt.localeCompare(a.recordedAt)
      : b.takenAt.localeCompare(a.takenAt),
  );
}

/** Only the poses asked for; an empty selection means no filter at all. */
export function filterByPose(photos: readonly Photo[], poses: readonly Pose[]): Photo[] {
  return poses.length === 0 ? [...photos] : photos.filter((photo) => poses.includes(photo.pose));
}

export interface Interval {
  days: number;
  /** Whole weeks, for the caption that reads "14 weeks apart". */
  weeks: number;
  /** True when the two photos are the same day — "apart" would be a lie. */
  sameDay: boolean;
}

/**
 * How far apart two photos are.
 *
 * Absolute, because the caption is about distance and the user may have
 * picked the later one first. Weeks are floored: eleven days is one week and
 * some, and rounding it up to two would overstate the gap the picture covers.
 */
export function intervalBetween(from: string, to: string): Interval {
  const days = Math.abs(daysBetween(from, to));
  return { days, weeks: Math.floor(days / 7), sameDay: days === 0 };
}

/**
 * The pair a compare view should open with.
 *
 * The oldest and the newest of whatever is on screen, which is the comparison
 * someone opening this screen is almost always after. `null` when there is
 * nothing to compare — one photo is not a pair, and showing it twice would
 * invite a reading of "no change" that the data does not support.
 */
export function defaultPair(photos: readonly Photo[]): { from: Photo; to: Photo } | null {
  const sorted = sortNewestFirst(photos);
  const newest = sorted[0];
  const oldest = sorted[sorted.length - 1];
  return sorted.length < 2 || !newest || !oldest ? null : { from: oldest, to: newest };
}
