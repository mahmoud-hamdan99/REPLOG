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

/**
 * Variants whose history has changed under their records.
 *
 * Correcting a historical set, or deleting a workout, can invalidate a record
 * that was derived from it — including one set in a *different* session, since
 * removing today's best promotes whatever stood before it. So the rebuild is
 * scoped to variant keys rather than to the workout: the workout is what
 * changed, the variant is what has to be recomputed.
 */
export interface PrRecomputeContext {
  variantKeys: readonly string[];
}

export interface PrDetector {
  /**
   * Writes any new records through `tx` and returns them, so the summary screen
   * can announce exactly what was committed.
   */
  detect(tx: TxScope, context: PrDetectionContext): Promise<PersonalRecord[]>;

  /**
   * Rebuilds the affected variants' records from `setLogs`.
   *
   * Called from inside the transaction that changed the history, for the same
   * reason `detect` is: records and the sets they are derived from move
   * together or not at all. Rebuilding from the logs rather than patching the
   * record table is what makes the result deterministic — PRODUCT_SPEC asks
   * that a rebuild reproduce the incrementally built table exactly, and it can
   * only do that if both paths run the same code.
   */
  recompute(tx: TxScope, context: PrRecomputeContext): Promise<void>;
}

/** Leaves records alone entirely. Replaced in Phase 7. */
export const NO_PR_DETECTION: PrDetector = {
  detect: () => Promise.resolve([]),
  recompute: () => Promise.resolve(),
};

export const PR_DETECTOR = new InjectionToken<PrDetector>('PR_DETECTOR');
