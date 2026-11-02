import type { RoutineExercise } from '../models/training';

/**
 * Estimated session length.
 *
 * Every number here is an assumption, which is why the result is always
 * labelled an estimate in the UI and never presented as a measurement. Once a
 * routine has been performed, its real recorded durations are the better
 * answer and the estimate should give way to them.
 */

/** Seconds a working set takes to perform, excluding rest. */
const SECONDS_PER_SET = 35;

/** Warm-up sets are quicker and rested less. */
const SECONDS_PER_WARMUP_SET = 25;
const WARMUP_REST_SEC = 45;

/** Walking to the next station, loading plates, finding a bench. */
const TRANSITION_SEC = 60;

/** Used when neither the exercise nor the routine specifies a rest. */
export const DEFAULT_REST_SEC = 90;

export interface DurationEstimate {
  seconds: number;
  minutes: number;
  /** Always true. Present so a caller cannot forget this is not a measurement. */
  isEstimate: true;
}

export function estimateRoutineDuration(
  exercises: readonly RoutineExercise[],
  fallbackRestSec = DEFAULT_REST_SEC,
): DurationEstimate {
  let seconds = 0;

  for (const exercise of exercises) {
    if (exercise.isOptional) {
      continue; // Optional work is not part of the expected session.
    }

    const rest = exercise.restSec ?? fallbackRestSec;
    const working = Math.max(0, exercise.targetSets);
    const warmups = Math.max(0, exercise.warmupSets);

    seconds += warmups * (SECONDS_PER_WARMUP_SET + WARMUP_REST_SEC);
    seconds += working * SECONDS_PER_SET;

    // Rest follows every set but the last of the exercise; the transition to
    // the next station covers that gap instead.
    seconds += Math.max(0, working - 1) * rest;
  }

  const stations = exercises.filter((exercise) => !exercise.isOptional).length;
  seconds += Math.max(0, stations - 1) * TRANSITION_SEC;

  return {
    seconds,
    minutes: Math.max(0, Math.round(seconds / 60)),
    isEstimate: true,
  };
}

/** Total planned working sets, for the routine summary line. */
export function totalPlannedSets(exercises: readonly RoutineExercise[]): number {
  return exercises.reduce(
    (total, exercise) => total + (exercise.isOptional ? 0 : Math.max(0, exercise.targetSets)),
    0,
  );
}
