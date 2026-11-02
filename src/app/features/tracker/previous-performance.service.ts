import { inject, Service } from '@angular/core';
import { SET_LOGS_REPO, WORKOUT_EXERCISES_REPO } from '../../data/tokens';
import type { SetType, Side } from '../../domain/models/enums';

export interface PreviousSet {
  setType: SetType;
  side: Side;
  weightKg: number | null;
  extraWeightKg: number | null;
  reps: number | null;
  e1rmKg: number | null;
}

export interface PreviousPerformance {
  workoutId: string;
  /** When that session started, for the "Last time · 12 Feb" line. */
  performedAt: string;
  sets: PreviousSet[];
}

/** How far back to look for a session of the same variant before giving up. */
const LOOKBACK = 10;

/**
 * "Last time you did this."
 *
 * Scoped to the **variant key**, not the exercise (docs/ARCHITECTURE.md
 * section 6.1): a dumbbell press is not previous performance for a barbell
 * press, and showing it as such would quietly invite the user to compare
 * incomparable numbers.
 *
 * One backwards cursor on `workoutExercises.by_exerciseId_startedAt` — query
 * Q7 in docs/DATABASE_SPEC.md section 8 — rather than a scan, so this stays
 * cheap with thousands of sessions on file.
 */
@Service()
export class PreviousPerformanceLookup {
  private readonly exercisesRepo = inject(WORKOUT_EXERCISES_REPO);
  private readonly setsRepo = inject(SET_LOGS_REPO);

  /** Keyed by variant and cut-off, so one session's lookups are done once. */
  private readonly cache = new Map<string, PreviousPerformance | null>();

  /**
   * The most recent completed performance of `variantKey` strictly before
   * `beforeIso`. `null` means no history, which the UI must say out loud
   * rather than render as an empty block.
   */
  async forVariant(
    exerciseId: string,
    variantKey: string,
    beforeIso: string,
  ): Promise<PreviousPerformance | null> {
    const key = `${variantKey}@${beforeIso}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.lookup(exerciseId, variantKey, beforeIso);
    this.cache.set(key, result);
    return result;
  }

  /** Dropped when a session ends; the next session asks a different question. */
  clear(): void {
    this.cache.clear();
  }

  private async lookup(
    exerciseId: string,
    variantKey: string,
    beforeIso: string,
  ): Promise<PreviousPerformance | null> {
    // `[exerciseId]` sorts below every `[exerciseId, instant]`, so the lower
    // bound needs no sentinel; `upperOpen` excludes the session in progress.
    const candidates = await this.exercisesRepo.list({
      index: 'by_exerciseId_startedAt',
      range: { lower: [exerciseId], upper: [exerciseId, beforeIso], upperOpen: true },
      direction: 'prev',
      limit: LOOKBACK,
    });

    for (const candidate of candidates) {
      if (candidate.variantKey !== variantKey || candidate.isSkipped) continue;

      const sets = (
        await this.setsRepo.list({ index: 'by_workoutExerciseId', equals: candidate.id })
      )
        .filter((set) => set.isCompleted)
        .sort((a, b) => a.setIndex - b.setIndex);

      // A slot with no confirmed sets is not a performance; keep looking back.
      if (sets.length === 0) continue;

      return {
        workoutId: candidate.workoutId,
        performedAt: candidate.startedAt,
        sets: sets.map((set) => ({
          setType: set.setType,
          side: set.side,
          weightKg: set.weightKg,
          extraWeightKg: set.extraWeightKg,
          reps: set.reps,
          e1rmKg: set.e1rmKg,
        })),
      };
    }

    return null;
  }
}
