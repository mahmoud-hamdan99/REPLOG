import type { RoutineExercise } from '../models/training';
import { sortByOrder } from './ordering';

/**
 * Superset grouping.
 *
 * A superset is two or more exercises performed back to back. The invariants
 * that matter, and that these functions maintain:
 *
 *   - a group needs at least two members; a group of one is not a superset and
 *     is dissolved rather than left to render a bracket around nothing
 *   - members of a group are contiguous in the list, because the tracker
 *     alternates between them and a gap would make that nonsense
 *   - `supersetOrder` is dense from zero within each group
 *
 * Group labels are letters so the UI can say "Superset A" without inventing a
 * name, and are reassigned from scratch on every change so they always read
 * A, B, C down the list rather than leaving holes behind a deletion.
 */

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Rebuilds group labels and orders from the list's current arrangement.
 *
 * Takes whatever grouping the caller left behind, dissolves anything with
 * fewer than two members, splits a group whose members are no longer adjacent,
 * and relabels the survivors in list order.
 */
export function normaliseSupersets(exercises: readonly RoutineExercise[]): RoutineExercise[] {
  const sorted = sortByOrder(exercises);

  // Collect runs of adjacent exercises that share a group key.
  const runs: RoutineExercise[][] = [];
  let current: RoutineExercise[] = [];
  let currentKey: string | null = null;

  for (const exercise of sorted) {
    const key = exercise.supersetGroup;
    if (key !== null && key === currentKey) {
      current.push(exercise);
    } else {
      if (current.length > 0) runs.push(current);
      current = [exercise];
      currentKey = key;
    }
  }
  if (current.length > 0) runs.push(current);

  let label = 0;
  const result: RoutineExercise[] = [];

  for (const run of runs) {
    const isGroup = run[0]?.supersetGroup !== null && run.length > 1;
    if (isGroup) {
      const groupLabel = LABELS[label % LABELS.length] ?? 'A';
      label += 1;
      run.forEach((exercise, index) => {
        result.push({ ...exercise, supersetGroup: groupLabel, supersetOrder: index });
      });
    } else {
      for (const exercise of run) {
        result.push({ ...exercise, supersetGroup: null, supersetOrder: null });
      }
    }
  }

  return result;
}

/** Groups an exercise with the one after it, extending an existing group. */
export function groupWithNext(
  exercises: readonly RoutineExercise[],
  uid: string,
): RoutineExercise[] {
  const sorted = sortByOrder(exercises);
  const index = sorted.findIndex((exercise) => exercise.uid === uid);
  if (index === -1 || index === sorted.length - 1) {
    return sorted; // Nothing follows it; there is nothing to group with.
  }

  const target = sorted[index] as RoutineExercise;
  const next = sorted[index + 1] as RoutineExercise;
  // Reuse whichever side already belongs to a group, so grouping a third
  // exercise onto a pair extends that pair rather than starting a new one.
  const key = target.supersetGroup ?? next.supersetGroup ?? `g-${uid}`;

  return normaliseSupersets(
    sorted.map((exercise) =>
      exercise.uid === target.uid || exercise.uid === next.uid
        ? { ...exercise, supersetGroup: key }
        : exercise,
    ),
  );
}

/** Removes one exercise from its group, dissolving the group if one is left. */
export function ungroup(exercises: readonly RoutineExercise[], uid: string): RoutineExercise[] {
  return normaliseSupersets(
    sortByOrder(exercises).map((exercise) =>
      exercise.uid === uid ? { ...exercise, supersetGroup: null } : exercise,
    ),
  );
}

/** Exercises grouped for display: each entry is either a single or a superset. */
export function supersetBlocks(
  exercises: readonly RoutineExercise[],
): { group: string | null; members: RoutineExercise[] }[] {
  const blocks: { group: string | null; members: RoutineExercise[] }[] = [];

  for (const exercise of sortByOrder(exercises)) {
    const last = blocks.at(-1);
    if (exercise.supersetGroup !== null && last?.group === exercise.supersetGroup) {
      last.members.push(exercise);
    } else {
      blocks.push({ group: exercise.supersetGroup, members: [exercise] });
    }
  }

  return blocks;
}
