import type { E1rmFormulaName, LoadType, PrType, SetType } from '../models/enums';
import type { Flag } from '../models/entity';
import { estimate1Rm } from './e1rm';
import { isWorkingSet } from './volume';

/**
 * Personal records.
 *
 * Two commitments shape everything here.
 *
 * **Comparison is always variant-scoped.** Callers hand in the sets for one
 * `variantKey` and get that variant's records back; a dumbbell press and a
 * barbell press are different keys and can never displace one another
 * (docs/ARCHITECTURE.md section 6.1).
 *
 * **One code path builds the table.** `buildRecords` takes a variant's whole
 * qualifying history and returns its complete list of achievements. Detecting
 * a record after a workout and rebuilding the table from scratch are the same
 * call over the same input, so "a rebuild reproduces the incrementally built
 * table exactly" is true by construction rather than by keeping two
 * implementations in step.
 */

/** A logged set, reduced to what record detection actually reads. */
export interface PrSet {
  id: string;
  workoutId: string;
  /** Null for an unconfirmed row, which is never a candidate. */
  completedAt: string | null;
  isCompleted: boolean;
  setType: SetType;
  loadType: LoadType;
  weightKg: number | null;
  extraWeightKg: number | null;
  reps: number | null;
  /** Precomputed at write time; null where volume is not computable. */
  volumeKg: number | null;
}

export interface PrContext {
  exerciseId: string;
  variantKey: string;
  nameSnapshot: string;
  formula: E1rmFormulaName;
}

/** One achievement event, before it is given an envelope and stored. */
export interface PrAchievement {
  prType: PrType;
  value: number;
  weightKg: number | null;
  reps: number | null;
  repBucket: number | null;
  isEstimate: boolean;
  formula: E1rmFormulaName | null;
  achievedAt: string;
  workoutId: string;
  setLogId: string;
  /** `null` marks a first-ever record, which the UI labels "First record". */
  previousValue: number | null;
  previousAchievedAt: string | null;
  isCurrent: Flag;
}

/** Load types that can hold a record at all. */
const SCORABLE: readonly LoadType[] = ['external', 'bodyweight-plus'];

/**
 * The load a record is measured on.
 *
 * External work is scored on the bar. **Bodyweight-plus is scored on the added
 * weight, not the total**: a weighted pull-up is "+25 kg" in every gym, it is
 * the number the lifter actually chooses, and scoring the total would hand out
 * a new record every time someone's recorded body weight went up — a record
 * nobody earned, which is exactly what PRODUCT_SPEC section 4.9 rules out.
 *
 * Volume is a different question and keeps using effective weight: total work
 * done genuinely includes the body being moved.
 */
export function recordLoadKg(set: PrSet): number | null {
  if (set.loadType === 'external') return set.weightKg;
  if (set.loadType === 'bodyweight-plus') return set.extraWeightKg;
  return null;
}

/** Whether a set can hold a record: confirmed, working, and on a scored load. */
export function isPrCandidate(set: PrSet): boolean {
  return (
    set.isCompleted &&
    set.completedAt !== null &&
    isWorkingSet(set.setType) &&
    SCORABLE.includes(set.loadType)
  );
}

/** Chronological, with the id breaking ties so the order is total. */
function chronological(a: PrSet, b: PrSet): number {
  const byTime = (a.completedAt ?? '').localeCompare(b.completedAt ?? '');
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

/** Sets grouped into the sessions they were performed in, oldest first. */
function sessions(sets: readonly PrSet[]): PrSet[][] {
  const byWorkout = new Map<string, PrSet[]>();
  for (const set of [...sets].sort(chronological)) {
    const group = byWorkout.get(set.workoutId);
    if (group) group.push(set);
    else byWorkout.set(set.workoutId, [set]);
  }
  return [...byWorkout.values()];
}

/** The running best for one record type, or one weight bucket of one. */
interface Best {
  value: number;
  achievedAt: string;
}

/**
 * Every record this variant has ever set, oldest first.
 *
 * A record is created only on a **strictly** greater value. Ties never create
 * one: repeating your best is not beating it, and a table full of equal-value
 * "records" would make the word meaningless.
 */
export function buildRecords(sets: readonly PrSet[], context: PrContext): PrAchievement[] {
  const candidates = sets.filter(isPrCandidate);
  const achievements: PrAchievement[] = [];

  const bests = new Map<string, Best>();
  const keyOf = (prType: PrType, bucket: number | null) =>
    bucket === null ? prType : `${prType}@${bucket}`;

  const consider = (
    prType: PrType,
    value: number | null,
    set: PrSet,
    extras: {
      bucket?: number | null;
      weightKg?: number | null;
      reps?: number | null;
      formula?: E1rmFormulaName;
    } = {},
  ): void => {
    if (value === null || !Number.isFinite(value) || value <= 0) return;

    const bucket = extras.bucket ?? null;
    const key = keyOf(prType, bucket);
    const previous = bests.get(key);
    if (previous && value <= previous.value) return;

    const achievedAt = set.completedAt as string;
    achievements.push({
      prType,
      value: round2(value),
      weightKg: extras.weightKg ?? null,
      reps: extras.reps ?? null,
      repBucket: bucket,
      isEstimate: extras.formula !== undefined,
      formula: extras.formula ?? null,
      achievedAt,
      workoutId: set.workoutId,
      setLogId: set.id,
      previousValue: previous ? previous.value : null,
      previousAchievedAt: previous ? previous.achievedAt : null,
      isCurrent: 0,
    });
    bests.set(key, { value: round2(value), achievedAt });
  };

  for (const session of sessions(candidates)) {
    for (const set of session) {
      const load = recordLoadKg(set);
      const reps = set.reps;

      // Heaviest load moved, which needs at least one rep to have happened.
      if (load !== null && reps !== null && reps >= 1) {
        consider('maxWeight', load, set, { weightKg: load, reps });
      }

      // Bucketed by the exact load, so twelve reps at 20 kg cannot beat five
      // at 100 kg — they are simply different records.
      if (load !== null && reps !== null && reps >= 1) {
        consider('maxRepsAtWeight', reps, set, { bucket: load, weightKg: load, reps });
      }

      // Estimates only from external load: an estimated one-rep max derived
      // from added weight would be a number with no referent.
      if (set.loadType === 'external') {
        const estimate = estimate1Rm(set.weightKg, reps, context.formula);
        if (estimate) {
          consider('estimated1RM', estimate.value, set, {
            weightKg: set.weightKg,
            reps,
            formula: estimate.formula,
          });
        }
      }

      consider('maxSetVolume', set.volumeKg, set, { weightKg: load, reps });
    }

    // Session volume is only known once the session is over, and it is
    // attributed to the last set that contributed to it.
    const total = session.reduce((sum, set) => sum + (set.volumeKg ?? 0), 0);
    const last = session.at(-1);
    if (last && total > 0) {
      consider('maxSessionVolume', total, last);
    }
  }

  return markCurrent(achievements);
}

/**
 * Flags the latest achievement in each group as the one that stands.
 *
 * Exactly one per `(prType, repBucket)` — the previous holder is left in place
 * with `isCurrent: 0`, because PRODUCT_SPEC section 4.10 asks for record
 * *history*, and a progression reads better than an overwrite.
 */
function markCurrent(achievements: readonly PrAchievement[]): PrAchievement[] {
  const latest = new Map<string, PrAchievement>();
  for (const achievement of achievements) {
    const key =
      achievement.repBucket === null
        ? achievement.prType
        : `${achievement.prType}@${achievement.repBucket}`;
    latest.set(key, achievement);
  }

  const current = new Set(latest.values());
  return achievements.map((achievement) => ({
    ...achievement,
    isCurrent: current.has(achievement) ? 1 : 0,
  }));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A stable identity for an achievement, independent of its record id.
 *
 * Lets a rebuild recognise the events it already stored and leave their ids
 * alone, so a record keeps its identity across rebuilds — and so comparing two
 * rebuilds is comparing their content, not their generated keys.
 */
export function achievementKey(achievement: PrAchievement): string {
  return [
    achievement.prType,
    achievement.repBucket ?? '',
    achievement.setLogId,
    achievement.value,
  ].join('|');
}
