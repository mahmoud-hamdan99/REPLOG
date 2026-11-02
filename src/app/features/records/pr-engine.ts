import { inject, Service } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import type { PrDetectionContext, PrDetector, PrRecomputeContext } from '../../data/pr-detector';
import type { Query } from '../../data/repository';
import type { TxScope } from '../../data/unit-of-work';
import type { Draft } from '../../domain/models/entity';
import type { LoadType } from '../../domain/models/enums';
import type { PersonalRecord } from '../../domain/models/records';
import type { SetLog, WorkoutExercise } from '../../domain/models/workout';
import {
  achievementKey,
  buildRecords,
  type PrAchievement,
  type PrContext,
  type PrSet,
} from '../../domain/strength/prs';

/** Sorts above every ISO instant, so a variant's whole history is one range. */
const MAX_KEY = '￿';

/** What a variant is, for the records it holds. */
interface VariantIdentity {
  exerciseId: string;
  nameSnapshot: string;
}

/**
 * Record detection and rebuilding.
 *
 * The seam Phase 5 declared and bound to a no-op, now filled in.
 *
 * **Detection and rebuilding are the same operation.** Both recompute a
 * variant's entire record table from its set logs and reconcile the stored
 * table against the result. That is what makes the determinism the acceptance
 * criteria ask for true by construction: there is no incremental path that
 * could drift from a rebuild, because there is no incremental path.
 *
 * It costs one indexed range read per affected variant —
 * `by_variantKey_completedAt`, bounded to that variant — which is cheap beside
 * the alternative of two implementations that must agree forever.
 *
 * Everything runs inside the caller's transaction, so a detector that throws
 * rolls the workout back with it. That is why Phase 5 put the seam here.
 */
@Service()
export class PrEngine implements PrDetector {
  private readonly settings = inject(SettingsStore);

  /**
   * Recomputes the variants a finished workout touched.
   *
   * Returns only the achievements belonging to *this* workout, so the summary
   * announces what was just earned rather than the whole table.
   */
  async detect(tx: TxScope, context: PrDetectionContext): Promise<PersonalRecord[]> {
    const variants = new Map<string, VariantIdentity>();
    for (const exercise of context.exercises) {
      variants.set(exercise.variantKey, {
        exerciseId: exercise.exerciseId,
        nameSnapshot: exercise.nameSnapshot,
      });
    }

    const earned: PersonalRecord[] = [];
    for (const [variantKey, identity] of variants) {
      const written = await this.rebuildVariant(tx, variantKey, identity);
      earned.push(...written.filter((record) => record.workoutId === context.workout.id));
    }
    return earned;
  }

  /** Rebuilds the named variants after history changed under them. */
  async recompute(tx: TxScope, context: PrRecomputeContext): Promise<void> {
    for (const variantKey of context.variantKeys) {
      await this.rebuildVariant(tx, variantKey);
    }
  }

  /**
   * Rebuilds every variant that has either records or sets.
   *
   * The Settings → Data routine. Both sides are read, so a variant whose sets
   * arrived without records (an import) and one whose records outlived its
   * sets (a deletion) are each repaired.
   */
  async rebuildAll(tx: TxScope): Promise<number> {
    const variants = new Set<string>();
    for (const record of await tx.repo('personalRecords').list()) {
      variants.add(record.variantKey);
    }
    for (const set of await tx.repo('setLogs').list()) {
      variants.add(set.variantKey);
    }

    for (const variantKey of variants) {
      await this.rebuildVariant(tx, variantKey);
    }
    return variants.size;
  }

  /**
   * Makes the stored table for one variant equal what its sets imply.
   *
   * Reconciles rather than deleting and reinserting: an achievement that is
   * still correct keeps its record id, so anything pointing at it stays valid
   * across a rebuild — and comparing two rebuilds compares their content
   * rather than their generated keys.
   */
  private async rebuildVariant(
    tx: TxScope,
    variantKey: string,
    identity?: VariantIdentity,
  ): Promise<PersonalRecord[]> {
    const records = tx.repo('personalRecords');
    const existing = await records.list({
      index: 'by_variantKey_type_achievedAt',
      range: { lower: [variantKey], upper: [variantKey, MAX_KEY, MAX_KEY] },
    });
    const sets = await tx.repo('setLogs').list(variantRange(variantKey));

    const exerciseId =
      identity?.exerciseId ?? sets.at(-1)?.exerciseId ?? existing.at(-1)?.exerciseId;
    if (exerciseId === undefined) {
      // Nothing to name and nothing to score. Clear any table left behind.
      for (const orphan of existing) {
        await records.remove(orphan.id, { hard: true });
      }
      return [];
    }

    const slots = await this.slotsFor(tx, exerciseId, variantKey);
    const context = this.contextFor(variantKey, exerciseId, slots, existing, identity);
    const loads = new Map(slots.map((slot) => [slot.id, slot.loadType] as const));

    const achievements = buildRecords(
      sets.map((set) => toPrSet(set, loads)),
      context,
    );

    const byKey = new Map(
      existing.map((record) => [achievementKey(toAchievement(record)), record]),
    );
    const written: PersonalRecord[] = [];

    for (const achievement of achievements) {
      const key = achievementKey(achievement);
      const previous = byKey.get(key);
      byKey.delete(key);

      written.push(
        await records.put({
          ...(previous ? { id: previous.id } : {}),
          exerciseId: context.exerciseId,
          variantKey,
          nameSnapshot: context.nameSnapshot,
          prType: achievement.prType,
          value: achievement.value,
          weightKg: achievement.weightKg,
          reps: achievement.reps,
          repBucket: achievement.repBucket,
          isEstimate: achievement.isEstimate,
          formula: achievement.formula,
          achievedAt: achievement.achievedAt,
          workoutId: achievement.workoutId,
          setLogId: achievement.setLogId,
          previousValue: achievement.previousValue,
          previousAchievedAt: achievement.previousAchievedAt,
          isCurrent: achievement.isCurrent,
          deletedAt: null,
        } satisfies Draft<PersonalRecord>),
      );
    }

    // Whatever the sets no longer support is hard-deleted. A record is a
    // derived value; a tombstone would preserve a claim the data has stopped
    // making, and a later rebuild would have to work around it.
    for (const orphan of byKey.values()) {
      await records.remove(orphan.id, { hard: true });
    }

    return written;
  }

  /**
   * The exercise's slots in this variant.
   *
   * They carry two things the set logs do not: the `loadType`, which decides
   * whether a set can hold a record at all, and the `nameSnapshot` a record is
   * labelled with. One indexed read per variant rather than a lookup per set.
   */
  private async slotsFor(
    tx: TxScope,
    exerciseId: string,
    variantKey: string,
  ): Promise<WorkoutExercise[]> {
    const slots = await tx
      .repo('workoutExercises')
      .list({ index: 'by_exerciseId', equals: exerciseId });

    return slots.filter((slot) => slot.variantKey === variantKey);
  }

  /**
   * What a record of this variant is labelled with.
   *
   * The caller's name where it has one, then the most recent slot's snapshot,
   * then an existing record's. The exercise id is the last resort and is not a
   * name — it only shows up for data with no slot and no record behind it.
   */
  private contextFor(
    variantKey: string,
    exerciseId: string,
    slots: readonly WorkoutExercise[],
    existing: readonly PersonalRecord[],
    identity?: VariantIdentity,
  ): PrContext {
    return {
      exerciseId,
      variantKey,
      nameSnapshot:
        identity?.nameSnapshot ??
        slots.at(-1)?.nameSnapshot ??
        existing.at(-1)?.nameSnapshot ??
        exerciseId,
      formula: this.settings.prefs().e1rmFormula,
    };
  }
}

/** A variant's whole history, in one indexed range. */
function variantRange(variantKey: string): Query {
  return {
    index: 'by_variantKey_completedAt',
    range: { lower: [variantKey, ''], upper: [variantKey, MAX_KEY] },
  };
}

/**
 * A set in the shape record detection reads.
 *
 * The load type comes from the slot the set belongs to. When that slot is
 * missing — orphaned data, which Phase 11's integrity check exists to find —
 * the set is treated as plain bodyweight work, which holds no record. Guessing
 * `external` from the presence of a weight would be inventing a record out of
 * a data error.
 */
function toPrSet(set: SetLog, loads: ReadonlyMap<string, LoadType>): PrSet {
  return {
    id: set.id,
    workoutId: set.workoutId,
    completedAt: set.completedAt,
    isCompleted: set.isCompleted,
    setType: set.setType,
    loadType: loads.get(set.workoutExerciseId) ?? 'bodyweight',
    weightKg: set.weightKg,
    extraWeightKg: set.extraWeightKg,
    reps: set.reps,
    volumeKg: set.volumeKg,
  };
}

function toAchievement(record: PersonalRecord): PrAchievement {
  return {
    prType: record.prType,
    value: record.value,
    weightKg: record.weightKg,
    reps: record.reps,
    repBucket: record.repBucket,
    isEstimate: record.isEstimate,
    formula: record.formula,
    achievedAt: record.achievedAt,
    workoutId: record.workoutId,
    setLogId: record.setLogId,
    previousValue: record.previousValue,
    previousAchievedAt: record.previousAchievedAt,
    isCurrent: record.isCurrent,
  };
}
