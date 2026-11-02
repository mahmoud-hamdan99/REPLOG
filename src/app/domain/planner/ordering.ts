/**
 * Sparse ordering.
 *
 * Items carry widely spaced `orderIndex` values (1000, 2000, 3000, …) so moving
 * one is a single write of that item — its new index is the midpoint between
 * its neighbours — instead of renumbering the whole list. On a list of twenty
 * exercises that is the difference between one write and twenty.
 *
 * Midpoints eventually run out of room after repeated moves into the same gap,
 * so `needsNormalising` detects exhaustion and `normalise` respaces the list.
 */

export const ORDER_STEP = 1000;

/** Below this, midpoints stop being distinguishable and the list is respaced. */
const MIN_GAP = 2;

export interface Ordered {
  orderIndex: number;
}

/** Index for an item appended to the end. */
export function nextOrderIndex(items: readonly Ordered[]): number {
  if (items.length === 0) {
    return ORDER_STEP;
  }
  return Math.max(...items.map((item) => item.orderIndex)) + ORDER_STEP;
}

/**
 * Index that places an item between two neighbours.
 *
 * `null` for either side means the edge of the list.
 */
export function orderIndexBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return ORDER_STEP;
  if (before === null) return (after as number) - ORDER_STEP;
  if (after === null) return before + ORDER_STEP;
  return (before + after) / 2;
}

/** Items in display order. Stable: ties keep their existing relative order. */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * The index an item needs to sit at position `toIndex` of the sorted list.
 *
 * Returns `null` when the move is a no-op, so a caller never writes for a drag
 * that ended where it started.
 */
export function indexForMove<T extends Ordered>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): number | null {
  const sorted = sortByOrder(items);
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sorted.length ||
    toIndex >= sorted.length
  ) {
    return null;
  }

  // Neighbours in the list *without* the moved item, at the target position.
  const without = sorted.filter((_, index) => index !== fromIndex);
  const before = toIndex > 0 ? (without[toIndex - 1]?.orderIndex ?? null) : null;
  const after = without[toIndex]?.orderIndex ?? null;

  return orderIndexBetween(before, after);
}

/** True when gaps have collapsed far enough that the list should be respaced. */
export function needsNormalising(items: readonly Ordered[]): boolean {
  const sorted = sortByOrder(items);
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (sorted[i]?.orderIndex ?? 0) - (sorted[i - 1]?.orderIndex ?? 0);
    if (gap < MIN_GAP) {
      return true;
    }
  }
  return false;
}

/**
 * Respaces items onto clean multiples of the step, **in the order given**.
 *
 * Separate from `normalise` on purpose: after a move, array position is the
 * new truth and the old indices are stale. Sorting first would re-sort by
 * those stale indices and silently undo the move.
 */
export function respaceInOrder<T extends Ordered>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ ...item, orderIndex: (index + 1) * ORDER_STEP }));
}

/** Sorts by the current indices, then respaces onto clean multiples. */
export function normalise<T extends Ordered>(items: readonly T[]): T[] {
  return respaceInOrder(sortByOrder(items));
}

/**
 * Moves an item within an array and respaces the result.
 *
 * For a list held *inside* one document — a routine's embedded exercises — the
 * whole array is written anyway, so there is nothing to gain from preserving
 * sparse gaps and clean indices are easier to reason about.
 */
export function moveWithin<T extends Ordered>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const sorted = sortByOrder(items);
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sorted.length ||
    toIndex >= sorted.length
  ) {
    return sorted;
  }

  const moved = sorted[fromIndex] as T;
  const rest = sorted.filter((_, index) => index !== fromIndex);
  rest.splice(toIndex, 0, moved);
  // Array position is the new order; respacing must not re-sort by the old
  // indices, which would undo the move.
  return respaceInOrder(rest);
}
