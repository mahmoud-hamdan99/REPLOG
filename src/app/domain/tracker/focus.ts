/**
 * Which row is "current".
 *
 * UI_UX_SPEC section 5.3: exactly one row is current, it carries the accent
 * outline, and it is the only auto-focus target. Getting this wrong on a phone
 * means the user types into the wrong set, so the rule lives here as a pure
 * function with its own tests rather than inside a component.
 */

export interface FocusSet {
  id: string;
  isCompleted: boolean;
}

export interface FocusExercise {
  id: string;
  supersetGroup: string | null;
  isSkipped: boolean;
  /** In display order. */
  sets: readonly FocusSet[];
}

export interface Focus {
  exerciseId: string;
  setId: string;
}

function firstPending(exercise: FocusExercise): Focus | null {
  if (exercise.isSkipped) return null;
  const set = exercise.sets.find((candidate) => !candidate.isCompleted);
  return set ? { exerciseId: exercise.id, setId: set.id } : null;
}

/** The first pending row in list order, or `null` when the session is fully logged. */
export function currentFocus(exercises: readonly FocusExercise[]): Focus | null {
  for (const exercise of exercises) {
    const focus = firstPending(exercise);
    if (focus) return focus;
  }
  return null;
}

/**
 * Where focus goes after a set in `exerciseId` is confirmed.
 *
 * Order of preference:
 *   1. **Inside a superset**, the next member of the group with a pending row —
 *      wrapping within the group, because alternating A/B/A/B is the whole
 *      point of grouping them. Only when every member is done does focus leave.
 *   2. The next pending row of the same exercise.
 *   3. The first pending row anywhere after it.
 *   4. Failing that, the first pending row from the top: a row skipped earlier
 *      in the list is still unfinished work, and leaving focus nowhere would
 *      make it unreachable by keyboard.
 */
export function focusAfter(exercises: readonly FocusExercise[], exerciseId: string): Focus | null {
  const index = exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (index === -1) return currentFocus(exercises);

  const completed = exercises[index] as FocusExercise;
  const group = completed.supersetGroup;

  if (group !== null) {
    const members = exercises.filter((exercise) => exercise.supersetGroup === group);
    const position = members.findIndex((exercise) => exercise.id === exerciseId);

    for (let step = 1; step <= members.length; step += 1) {
      const member = members[(position + step) % members.length];
      const focus = member ? firstPending(member) : null;
      if (focus) return focus;
    }
  } else {
    const own = firstPending(completed);
    if (own) return own;
  }

  for (const exercise of exercises.slice(index + 1)) {
    const focus = firstPending(exercise);
    if (focus) return focus;
  }

  return currentFocus(exercises);
}

/** Completed-set progress over the whole session, for the header bar. */
export function sessionProgress(exercises: readonly FocusExercise[]): {
  completed: number;
  planned: number;
  ratio: number;
} {
  let completed = 0;
  let planned = 0;

  for (const exercise of exercises) {
    if (exercise.isSkipped) continue;
    planned += exercise.sets.length;
    completed += exercise.sets.filter((set) => set.isCompleted).length;
  }

  return { completed, planned, ratio: planned === 0 ? 0 : completed / planned };
}
