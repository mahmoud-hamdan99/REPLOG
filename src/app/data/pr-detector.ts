import { InjectionToken } from '@angular/core';
import type { PersonalRecord } from '../domain/models/records';
import type { SetLog, Workout, WorkoutExercise } from '../domain/models/workout';
import type { TxScope } from './unit-of-work';

/**
 * The seam between finishing a workout and detecting personal records.
 *
 * Record detection is Phase 7 work, but the transaction it has to run inside is
 * built here (docs/ARCHITECTURE.md section 7.5), so the contract is declared
 * now and bound to a no-op. That keeps two promises that matter:
 *
 *   - detection happens **inside** the finish transaction, so records and the
 *     workout they came from are committed together or not at all
 *   - a detector that throws rolls the whole transaction back, leaving the
 *     session active and complete. A record-keeping bug is never allowed to
 *     destroy a logged workout, and a test pins that down.
 */
export interface PrDetectionContext {
  /** The workout as patched by the finish transaction, not as it was before. */
  workout: Workout;
  exercises: readonly WorkoutExercise[];
  /** Confirmed sets only; unlogged rows are already gone by this point. */
  sets: readonly SetLog[];
}

export interface PrDetector {
  /**
   * Writes any new records through `tx` and returns them, so the summary screen
   * can announce exactly what was committed.
   */
  detect(tx: TxScope, context: PrDetectionContext): Promise<PersonalRecord[]>;
}

/** Finishes a workout without touching records. Replaced in Phase 7. */
export const NO_PR_DETECTION: PrDetector = {
  detect: () => Promise.resolve([]),
};

export const PR_DETECTOR = new InjectionToken<PrDetector>('PR_DETECTOR');
