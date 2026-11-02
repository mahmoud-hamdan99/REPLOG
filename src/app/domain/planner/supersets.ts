import { sortByOrder, type Ordered } from './ordering';

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
 *
 * Generic over the carrier rather than tied to `RoutineExercise`: a planned
 * routine and a live workout group their exercises by exactly the same rules,
 * and a second copy of these invariants is a second place for them to drift.
 * Callers identify an item with a predicate, so one carrier keying on `uid`
 * and another on `id` both work without an adapter.
 */

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The fields grouping needs. Anything ordered and groupable qualifies. */
export interface Supersettable extends Ordered {
  supersetGroup: string | null;
  supersetOrder: number | null;
}

/**
 * Rebuilds group labels and orders from the list's current arrangement.
 *
 * Takes whatever grouping the caller left behind, dissolves anything with
 * fewer than two members, splits a group whose members are no longer adjacent,
 * and relabels the survivors in list order.
 */
export function normaliseSupersets<T extends Supersettable>(exercises: readonly T[]): T[] {
  const sorted = sortByOrder(exercises);

  // Collect runs of adjacent exercises that share a group key.
  const runs: T[][] = [];
  let current: T[] = [];
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
  const result: T[] = [];

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

/** Groups the matched exercise with the one after it, extending any group. */
export function groupWithNext<T extends Supersettable>(
  exercises: readonly T[],
  matches: (exercise: T) => boolean,
): T[] {
  const sorted = sortByOrder(exercises);
  const index = sorted.findIndex(matches);
  if (index === -1 || index === sorted.length - 1) {
    return sorted; // Nothing follows it; there is nothing to group with.
  }

  const target = sorted[index] as T;
  const next = sorted[index + 1] as T;
  // Reuse whichever side already belongs to a group, so grouping a third
  // exercise onto a pair extends that pair rather than starting a new one.
  // A fresh key only has to be unique within this call: normalising relabels.
  const key = target.supersetGroup ?? next.supersetGroup ?? `g-${index}`;

  return normaliseSupersets(
    sorted.map((exercise, position) =>
      position === index || position === index + 1 ? { ...exercise, supersetGroup: key } : exercise,
    ),
  );
}

/** Removes the matched exercise from its group, dissolving a leftover single. */
export function ungroup<T extends Supersettable>(
  exercises: readonly T[],
  matches: (exercise: T) => boolean,
): T[] {
  return normaliseSupersets(
    sortByOrder(exercises).map((exercise) =>
      matches(exercise) ? { ...exercise, supersetGroup: null } : exercise,
    ),
  );
}

/** Exercises grouped for display: each entry is either a single or a superset. */
export function supersetBlocks<T extends Supersettable>(
  exercises: readonly T[],
): { group: string | null; members: T[] }[] {
  const blocks: { group: string | null; members: T[] }[] = [];

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
