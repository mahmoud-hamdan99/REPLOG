import type { Draft } from '../models/entity';
import type { Plan, Routine, RoutineExercise } from '../models/training';
import { normalise } from './ordering';

/**
 * Duplicating a plan.
 *
 * Every identifier is regenerated — the plan's, each routine's, and each
 * embedded exercise's `uid`. A copy that shared ids with its original would
 * look fine until the first edit, at which point writing to one would silently
 * rewrite the other. The copy also resets `revision` to 1, because it has its
 * own history from here and inheriting a revision number would imply changes
 * it never had.
 */
export function duplicatePlan(
  plan: Plan,
  routines: readonly Routine[],
  options: { name: string; newId: () => string },
): { plan: Draft<Plan>; routines: Draft<Routine>[] } {
  const planId = options.newId();

  const planDraft: Draft<Plan> = {
    id: planId,
    name: options.name,
    description: plan.description,
    goal: plan.goal,
    weekStartsOn: plan.weekStartsOn,
    accentColor: plan.accentColor,
    isArchived: 0,
    orderIndex: plan.orderIndex,
    durationWeeks: plan.durationWeeks,
  };

  const routineDrafts = routines.map<Draft<Routine>>((routine) => ({
    id: options.newId(),
    planId,
    name: routine.name,
    scheduleType: routine.scheduleType,
    weekdays: [...routine.weekdays],
    orderIndex: routine.orderIndex,
    estimatedDurationMin: routine.estimatedDurationMin,
    notes: routine.notes,
    exercises: routine.exercises.map((exercise) => ({
      ...exercise,
      uid: options.newId(),
    })),
    revision: 1,
    isArchived: false,
  }));

  return { plan: planDraft, routines: routineDrafts };
}

/** Duplicates a single routine, within the same plan or into another one. */
export function duplicateRoutine(
  routine: Routine,
  options: { name: string; planId?: string | null; newId: () => string },
): Draft<Routine> {
  return {
    id: options.newId(),
    planId: options.planId === undefined ? routine.planId : options.planId,
    name: options.name,
    scheduleType: routine.scheduleType,
    // A duplicate does not inherit the weekday slots: two routines claiming
    // the same day is almost never what was wanted, and the user can assign
    // the copy deliberately.
    weekdays: [],
    orderIndex: routine.orderIndex,
    estimatedDurationMin: routine.estimatedDurationMin,
    notes: routine.notes,
    exercises: routine.exercises.map((exercise) => ({
      ...exercise,
      uid: options.newId(),
    })),
    revision: 1,
    isArchived: false,
  };
}

/** The fields whose change makes a routine structurally different. */
function structuralShape(routine: {
  scheduleType: string;
  weekdays: readonly number[];
  exercises: readonly RoutineExercise[];
}): string {
  return JSON.stringify({
    scheduleType: routine.scheduleType,
    weekdays: [...routine.weekdays].sort((a, b) => a - b),
    exercises: [...routine.exercises]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((exercise) => ({
        exerciseId: exercise.exerciseId,
        supersetGroup: exercise.supersetGroup,
        supersetOrder: exercise.supersetOrder,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        targetWeightKg: exercise.targetWeightKg,
        targetRpe: exercise.targetRpe,
        restSec: exercise.restSec,
        warmupSets: exercise.warmupSets,
        trackingMode: exercise.trackingMode,
        isOptional: exercise.isOptional,
      })),
  });
}

/**
 * Whether an edit should bump the routine's revision.
 *
 * Only structural changes count: what is performed, how much of it, and when.
 * Renaming a routine or fixing a typo in its notes does not make a past
 * workout "based on a different revision", and bumping for it would make the
 * revision number meaningless as a description of what changed.
 */
export function bumpsRevision(
  before: Pick<Routine, 'scheduleType' | 'weekdays' | 'exercises'>,
  after: Pick<Routine, 'scheduleType' | 'weekdays' | 'exercises'>,
): boolean {
  return structuralShape(before) !== structuralShape(after);
}

/** A fresh exercise slot with sensible targets. */
export function newRoutineExercise(options: {
  uid: string;
  exerciseId: string;
  nameSnapshot: string;
  orderIndex: number;
  restSec?: number | null;
}): RoutineExercise {
  return {
    uid: options.uid,
    exerciseId: options.exerciseId,
    nameSnapshot: options.nameSnapshot,
    orderIndex: options.orderIndex,
    supersetGroup: null,
    supersetOrder: null,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetWeightKg: null,
    targetRpe: null,
    restSec: options.restSec ?? null,
    warmupSets: 0,
    trackingMode: null,
    notes: null,
    isOptional: false,
  };
}

/** Removes an exercise and respaces the rest. */
export function removeExercise(
  exercises: readonly RoutineExercise[],
  uid: string,
): RoutineExercise[] {
  return normalise(exercises.filter((exercise) => exercise.uid !== uid));
}
