import type { LoadType, SetType } from '../models/enums';

/**
 * Volume.
 *
 * Two rules carry all the weight here, and both are stated in the UI rather
 * than applied silently:
 *
 *   1. **Working sets only.** Warm-ups, drop sets and sets taken to failure are
 *      excluded from volume and from personal records (DATABASE_SPEC §3.8), so
 *      a long warm-up ramp cannot inflate a session total.
 *   2. **Time and distance work has no volume**, and reports as `null` rather
 *      than as zero. Zero would average into a progression chart as a real data
 *      point and drag the line down; `null` is a gap, and a gap stays a gap.
 */

/** The set types that count toward volume and records. */
const COUNTING: readonly SetType[] = ['working', 'backoff'];

export function isWorkingSet(setType: SetType): boolean {
  return COUNTING.includes(setType);
}

export interface LoadInput {
  loadType: LoadType;
  weightKg: number | null;
  extraWeightKg: number | null;
  /** Snapshot taken when the session started, not today's weight. */
  bodyWeightKg: number | null;
}

/**
 * The load actually moved, per DATABASE_SPEC §3.8.
 *
 * Returns `null` when the figure is unknowable rather than guessing: a
 * bodyweight exercise with no recorded body weight has no computable volume,
 * and inventing 70 kg would quietly fabricate the user's history.
 */
export function effectiveWeightKg(input: LoadInput): number | null {
  const { loadType, weightKg, extraWeightKg, bodyWeightKg } = input;

  switch (loadType) {
    case 'external':
      return weightKg;
    case 'bodyweight':
      return bodyWeightKg;
    case 'bodyweight-plus':
    case 'assisted':
      // Assistance is stored negative, so one branch covers both.
      return bodyWeightKg === null ? null : bodyWeightKg + (extraWeightKg ?? 0);
    case 'time':
    case 'distance':
      return null;
  }
}

export interface VolumeInput extends LoadInput {
  setType: SetType;
  reps: number | null;
  isCompleted: boolean;
}

/** Volume for one set: `effectiveWeight × reps`, or `null` if not computable. */
export function setVolumeKg(input: VolumeInput): number | null {
  if (!input.isCompleted || !isWorkingSet(input.setType)) return null;
  if (input.reps === null || input.reps <= 0) return null;

  const weight = effectiveWeightKg(input);
  if (weight === null) return null;

  return Math.round(weight * input.reps * 100) / 100;
}

export interface SessionTotals {
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  /** Sets whose volume could not be computed, so the UI can say the total is partial. */
  uncountedSets: number;
}

/**
 * Session rollups over completed working sets.
 *
 * `uncountedSets` exists so the summary can say "plus 3 sets not counted toward
 * volume" instead of presenting a total that silently omits them.
 */
export function sessionTotals(sets: readonly VolumeInput[]): SessionTotals {
  let totalVolumeKg = 0;
  let totalSets = 0;
  let totalReps = 0;
  let uncountedSets = 0;

  for (const set of sets) {
    if (!set.isCompleted || !isWorkingSet(set.setType)) continue;
    totalSets += 1;
    totalReps += set.reps ?? 0;

    const volume = setVolumeKg(set);
    if (volume === null) uncountedSets += 1;
    else totalVolumeKg += volume;
  }

  return {
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    totalSets,
    totalReps,
    uncountedSets,
  };
}
