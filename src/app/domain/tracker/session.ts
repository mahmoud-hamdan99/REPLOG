import type { Laterality, LoadType, SetType, Side } from '../models/enums';
import type { RoutineExercise } from '../models/training';
import type { TargetSnapshot } from '../models/workout';
import { ORDER_STEP } from '../planner/ordering';

/**
 * Building a session from a plan.
 *
 * Everything a workout needs to know about a routine is copied here and never
 * read back from the routine again (docs/ARCHITECTURE.md section 7.6). That is
 * what makes editing a plan safe: history is a photograph, not a live view.
 */

/** The library facts a session freezes at start time. */
export interface ExerciseFacts {
  exerciseId: string;
  variantKey: string;
  name: string;
  loadType: LoadType;
  laterality: Laterality;
  defaultRestSec: number | null;
}

export interface PlannedSet {
  setIndex: number;
  setType: SetType;
  side: Side;
  weightKg: number | null;
  reps: number | null;
}

export interface PlannedExercise {
  exerciseId: string;
  variantKey: string;
  nameSnapshot: string;
  routineExerciseUid: string | null;
  orderIndex: number;
  supersetGroup: string | null;
  supersetOrder: number | null;
  targetSnapshot: TargetSnapshot | null;
  loadType: LoadType;
  laterality: Laterality;
  restSec: number | null;
  isSkipped: boolean;
  sets: PlannedSet[];
}

export interface PlanOptions {
  /** Resolves the library record; a missing one still produces a usable slot. */
  facts: (exerciseId: string) => ExerciseFacts | undefined;
  /** The user's global rest preference, used when nothing more specific applies. */
  defaultRestSec: number;
  /** Slots the user chose to skip in the pre-flight sheet. */
  skipUids?: ReadonlySet<string>;
}

/**
 * Sides a set row is logged on.
 *
 * `unilateral-separate` means left and right are genuinely different lifts
 * (a single-arm row), so each gets its own row. Alternating work is one row:
 * the user does both sides within the set.
 */
function sidesFor(laterality: Laterality): Side[] {
  return laterality === 'unilateral-separate' ? ['left', 'right'] : ['both'];
}

/**
 * Pre-creates the rows a planned exercise starts with.
 *
 * Warm-up rows come first and carry no load: there is nothing to base a
 * percentage on until a working weight exists, and a fabricated 50 % of nothing
 * is worse than a blank field. Working rows take the plan's `targetWeightKg`
 * where it was set, and a rep count only when the plan asked for an exact
 * number — prefilling the bottom of an 8–12 range would put a value the user
 * never chose one tap away from being committed.
 */
function plannedSets(exercise: RoutineExercise, laterality: Laterality): PlannedSet[] {
  const sides = sidesFor(laterality);
  const fixedReps =
    exercise.targetRepsMin !== null && exercise.targetRepsMin === exercise.targetRepsMax
      ? exercise.targetRepsMin
      : null;

  const sets: PlannedSet[] = [];
  let setIndex = 0;

  for (let i = 0; i < Math.max(0, exercise.warmupSets); i += 1) {
    for (const side of sides) {
      sets.push({ setIndex: setIndex++, setType: 'warmup', side, weightKg: null, reps: null });
    }
  }
  for (let i = 0; i < Math.max(1, exercise.targetSets); i += 1) {
    for (const side of sides) {
      sets.push({
        setIndex: setIndex++,
        setType: 'working',
        side,
        weightKg: exercise.targetWeightKg,
        reps: fixedReps,
      });
    }
  }

  return sets;
}

function targetSnapshotOf(exercise: RoutineExercise): TargetSnapshot {
  return {
    targetSets: exercise.targetSets,
    targetRepsMin: exercise.targetRepsMin,
    targetRepsMax: exercise.targetRepsMax,
    targetWeightKg: exercise.targetWeightKg,
    targetRpe: exercise.targetRpe,
    restSec: exercise.restSec,
  };
}

/** Freezes a routine into the structure a session is logged against. */
export function planFromRoutine(
  exercises: readonly RoutineExercise[],
  options: PlanOptions,
): PlannedExercise[] {
  const skip = options.skipUids ?? new Set<string>();

  return [...exercises]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((exercise, index) => {
      const facts = options.facts(exercise.exerciseId);
      const laterality = facts?.laterality ?? 'bilateral';

      return {
        exerciseId: exercise.exerciseId,
        // A slot whose exercise has since been deleted keeps a variant key
        // derived from the id, so its own history stays self-consistent.
        variantKey: facts?.variantKey ?? exercise.exerciseId,
        nameSnapshot: facts?.name ?? exercise.nameSnapshot,
        routineExerciseUid: exercise.uid,
        orderIndex: (index + 1) * ORDER_STEP,
        supersetGroup: exercise.supersetGroup,
        supersetOrder: exercise.supersetOrder,
        targetSnapshot: targetSnapshotOf(exercise),
        loadType: facts?.loadType ?? 'external',
        laterality,
        restSec: exercise.restSec ?? facts?.defaultRestSec ?? options.defaultRestSec,
        isSkipped: skip.has(exercise.uid),
        sets: plannedSets(exercise, laterality),
      } satisfies PlannedExercise;
    });
}

/** A single ad-hoc slot, for "add exercise" mid-session and quick workouts. */
export function planAdHoc(
  facts: ExerciseFacts,
  options: { orderIndex: number; defaultRestSec: number; targetSets?: number },
): PlannedExercise {
  const laterality = facts.laterality;
  const sides = sidesFor(laterality);
  const sets: PlannedSet[] = [];
  let setIndex = 0;

  for (let i = 0; i < Math.max(1, options.targetSets ?? 3); i += 1) {
    for (const side of sides) {
      sets.push({ setIndex: setIndex++, setType: 'working', side, weightKg: null, reps: null });
    }
  }

  return {
    exerciseId: facts.exerciseId,
    variantKey: facts.variantKey,
    nameSnapshot: facts.name,
    // No plan slot behind it, and no target snapshot to pretend there was one.
    routineExerciseUid: null,
    orderIndex: options.orderIndex,
    supersetGroup: null,
    supersetOrder: null,
    targetSnapshot: null,
    loadType: facts.loadType,
    laterality,
    restSec: facts.defaultRestSec ?? options.defaultRestSec,
    isSkipped: false,
    sets,
  };
}

/** Half the first working load, rounded to 2.5 kg: a starting point, not advice. */
export function warmupWeightKg(firstWorkingWeightKg: number | null): number | null {
  if (firstWorkingWeightKg === null || firstWorkingWeightKg <= 0) return null;
  return Math.round((firstWorkingWeightKg * 0.5) / 2.5) * 2.5;
}

/** Renumbers `setIndex` densely from zero in the given order. */
export function renumber<T extends { setIndex: number }>(sets: readonly T[]): T[] {
  return sets.map((set, index) => ({ ...set, setIndex: index }));
}
