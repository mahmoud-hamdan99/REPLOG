import type { Plan, Routine, RoutineExercise } from '../models/training';
import { estimateRoutineDuration, totalPlannedSets } from './duration';
import {
  ORDER_STEP,
  indexForMove,
  moveWithin,
  needsNormalising,
  nextOrderIndex,
  normalise,
  orderIndexBetween,
  sortByOrder,
} from './ordering';
import {
  bumpsRevision,
  duplicatePlan,
  duplicateRoutine,
  newRoutineExercise,
  removeExercise,
} from './plan-ops';
import { groupWithNext, normaliseSupersets, supersetBlocks, ungroup } from './supersets';

const ex = (uid: string, orderIndex: number, overrides: Partial<RoutineExercise> = {}) =>
  ({
    ...newRoutineExercise({ uid, exerciseId: `e-${uid}`, nameSnapshot: uid, orderIndex }),
    ...overrides,
  }) as RoutineExercise;
const byUid = (uid: string) => (exercise: RoutineExercise) => exercise.uid === uid;

const routine = (overrides: Partial<Routine> = {}): Routine =>
  ({
    id: 'r1',
    planId: 'p1',
    name: 'Push A',
    scheduleType: 'scheduled',
    weekdays: [1, 4],
    orderIndex: 1000,
    estimatedDurationMin: null,
    notes: null,
    exercises: [ex('a', 1000), ex('b', 2000)],
    revision: 3,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    origin: 'device',
    ...overrides,
  }) as Routine;

const plan = (overrides: Partial<Plan> = {}): Plan =>
  ({
    id: 'p1',
    name: 'PPL',
    description: 'Six days',
    goal: 'hypertrophy',
    weekStartsOn: 1,
    accentColor: null,
    isArchived: 0,
    orderIndex: 1000,
    durationWeeks: 8,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    origin: 'device',
    ...overrides,
  }) as Plan;

function idFactory() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('ordering', () => {
  it('appends past the current maximum', () => {
    expect(nextOrderIndex([])).toBe(ORDER_STEP);
    expect(nextOrderIndex([{ orderIndex: 1000 }, { orderIndex: 5000 }])).toBe(6000);
  });

  it('places an item between two neighbours', () => {
    expect(orderIndexBetween(1000, 2000)).toBe(1500);
    expect(orderIndexBetween(null, 1000)).toBe(0);
    expect(orderIndexBetween(3000, null)).toBe(4000);
    expect(orderIndexBetween(null, null)).toBe(ORDER_STEP);
  });

  it('sorts by index', () => {
    const items = [{ orderIndex: 3000 }, { orderIndex: 1000 }, { orderIndex: 2000 }];
    expect(sortByOrder(items).map((i) => i.orderIndex)).toEqual([1000, 2000, 3000]);
  });

  /**
   * The point of sparse indices: one move is one write, not a renumber of the
   * whole list.
   */
  it('computes a move as a single new index', () => {
    const items = [{ orderIndex: 1000 }, { orderIndex: 2000 }, { orderIndex: 3000 }];
    // Move the last item to the front.
    expect(indexForMove(items, 2, 0)).toBe(0);
    // Move the first item to the middle.
    expect(indexForMove(items, 0, 1)).toBe(2500);
  });

  it('returns null when a move changes nothing', () => {
    const items = [{ orderIndex: 1000 }, { orderIndex: 2000 }];
    expect(indexForMove(items, 1, 1)).toBeNull();
    expect(indexForMove(items, 5, 0)).toBeNull();
    expect(indexForMove(items, 0, -1)).toBeNull();
  });

  it('detects when gaps have collapsed', () => {
    expect(needsNormalising([{ orderIndex: 1000 }, { orderIndex: 2000 }])).toBe(false);
    expect(needsNormalising([{ orderIndex: 1000 }, { orderIndex: 1001 }])).toBe(true);
  });

  it('respaces onto clean multiples', () => {
    const respaced = normalise([{ orderIndex: 7 }, { orderIndex: 3 }, { orderIndex: 5 }]);
    expect(respaced.map((i) => i.orderIndex)).toEqual([1000, 2000, 3000]);
  });

  it('moves an item within an embedded array', () => {
    const items = [ex('a', 1000), ex('b', 2000), ex('c', 3000)];
    expect(moveWithin(items, 0, 2).map((i) => i.uid)).toEqual(['b', 'c', 'a']);
    expect(moveWithin(items, 2, 0).map((i) => i.uid)).toEqual(['c', 'a', 'b']);
    expect(moveWithin(items, 1, 1).map((i) => i.uid)).toEqual(['a', 'b', 'c']);
  });

  it('survives twenty repeated moves into the same gap', () => {
    let items: { orderIndex: number }[] = [
      { orderIndex: 1000 },
      { orderIndex: 2000 },
      { orderIndex: 3000 },
    ];
    for (let i = 0; i < 20; i += 1) {
      const next = indexForMove(items, 2, 1);
      if (next === null) break;
      items = sortByOrder([items[0], { orderIndex: next }, items[1]] as { orderIndex: number }[]);
      if (needsNormalising(items)) {
        items = normalise(items);
      }
    }
    // Still strictly increasing and distinct: no collisions, no lost order.
    const indices = sortByOrder(items).map((i) => i.orderIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('supersets', () => {
  it('groups an exercise with the one after it', () => {
    const grouped = groupWithNext([ex('a', 1000), ex('b', 2000), ex('c', 3000)], byUid('a'));

    expect(grouped[0]?.supersetGroup).toBe('A');
    expect(grouped[1]?.supersetGroup).toBe('A');
    expect(grouped[0]?.supersetOrder).toBe(0);
    expect(grouped[1]?.supersetOrder).toBe(1);
    expect(grouped[2]?.supersetGroup).toBeNull();
  });

  it('extends an existing group rather than starting a new one', () => {
    let list = groupWithNext([ex('a', 1000), ex('b', 2000), ex('c', 3000)], byUid('a'));
    list = groupWithNext(list, byUid('b'));

    expect(list.map((e) => e.supersetGroup)).toEqual(['A', 'A', 'A']);
    expect(list.map((e) => e.supersetOrder)).toEqual([0, 1, 2]);
  });

  it('does nothing when there is nothing after it', () => {
    const list = groupWithNext([ex('a', 1000)], byUid('a'));
    expect(list[0]?.supersetGroup).toBeNull();
  });

  /**
   * A group of one is not a superset. Leaving it would render a bracket
   * around a single exercise.
   */
  it('dissolves a group that drops to one member', () => {
    const grouped = groupWithNext([ex('a', 1000), ex('b', 2000)], byUid('a'));
    const after = ungroup(grouped, byUid('b'));

    expect(after.every((e) => e.supersetGroup === null)).toBe(true);
  });

  it('keeps a group of three when one member leaves', () => {
    let list = groupWithNext([ex('a', 1000), ex('b', 2000), ex('c', 3000)], byUid('a'));
    list = groupWithNext(list, byUid('b'));
    const after = ungroup(list, byUid('c'));

    expect(after.map((e) => e.supersetGroup)).toEqual(['A', 'A', null]);
  });

  it('splits a group whose members are no longer adjacent', () => {
    // b and d claim the same group but c sits between them.
    const split = normaliseSupersets([
      ex('b', 1000, { supersetGroup: 'A' }),
      ex('c', 2000, { supersetGroup: null }),
      ex('d', 3000, { supersetGroup: 'A' }),
    ]);

    expect(split.every((e) => e.supersetGroup === null)).toBe(true);
  });

  it('relabels groups in list order, leaving no holes', () => {
    const list = normaliseSupersets([
      ex('a', 1000, { supersetGroup: 'zz' }),
      ex('b', 2000, { supersetGroup: 'zz' }),
      ex('c', 3000, { supersetGroup: null }),
      ex('d', 4000, { supersetGroup: 'qq' }),
      ex('e', 5000, { supersetGroup: 'qq' }),
    ]);

    expect(list.map((e) => e.supersetGroup)).toEqual(['A', 'A', null, 'B', 'B']);
  });

  it('builds display blocks', () => {
    const list = groupWithNext([ex('a', 1000), ex('b', 2000), ex('c', 3000)], byUid('a'));
    const blocks = supersetBlocks(list);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.members.map((m) => m.uid)).toEqual(['a', 'b']);
    expect(blocks[1]?.members.map((m) => m.uid)).toEqual(['c']);
  });
});

describe('duplicatePlan', () => {
  /**
   * The acceptance criterion: a copy that shared ids would look fine until the
   * first edit silently rewrote the original.
   */
  it('regenerates every identifier', () => {
    const source = plan();
    const sourceRoutines = [routine(), routine({ id: 'r2', name: 'Pull A' })];

    const copy = duplicatePlan(source, sourceRoutines, {
      name: 'PPL copy',
      newId: idFactory(),
    });

    expect(copy.plan.id).not.toBe(source.id);
    expect(copy.routines.map((r) => r.id)).not.toContain('r1');
    expect(copy.routines.map((r) => r.id)).not.toContain('r2');

    const sourceUids = sourceRoutines.flatMap((r) => r.exercises.map((e) => e.uid));
    const copyUids = copy.routines.flatMap((r) => r.exercises.map((e) => e.uid));
    expect(copyUids.some((uid) => sourceUids.includes(uid))).toBe(false);
    expect(new Set(copyUids).size).toBe(copyUids.length);
  });

  it('points the copied routines at the copied plan', () => {
    const copy = duplicatePlan(plan(), [routine()], { name: 'Copy', newId: idFactory() });
    expect(copy.routines.every((r) => r.planId === copy.plan.id)).toBe(true);
  });

  it('resets revision and unarchives the copy', () => {
    const copy = duplicatePlan(plan({ isArchived: 1 }), [routine({ revision: 9 })], {
      name: 'Copy',
      newId: idFactory(),
    });

    expect(copy.plan.isArchived).toBe(0);
    expect(copy.routines[0]?.revision).toBe(1);
  });

  it('carries the content across unchanged', () => {
    const copy = duplicatePlan(plan(), [routine()], { name: 'Copy', newId: idFactory() });

    expect(copy.plan.goal).toBe('hypertrophy');
    expect(copy.routines[0]?.weekdays).toEqual([1, 4]);
    expect(copy.routines[0]?.exercises).toHaveLength(2);
    expect(copy.routines[0]?.exercises[0]?.exerciseId).toBe('e-a');
  });

  it('does not share array references with the original', () => {
    const source = routine();
    const copy = duplicatePlan(plan(), [source], { name: 'Copy', newId: idFactory() });

    copy.routines[0]?.weekdays.push(6);
    expect(source.weekdays).toEqual([1, 4]);
  });
});

describe('duplicateRoutine', () => {
  it('clears the weekday slots', () => {
    // Two routines claiming the same day is almost never what was meant.
    const copy = duplicateRoutine(routine(), { name: 'Push A copy', newId: idFactory() });
    expect(copy.weekdays).toEqual([]);
  });

  it('can move the copy into another plan', () => {
    const copy = duplicateRoutine(routine(), {
      name: 'Copy',
      planId: 'other-plan',
      newId: idFactory(),
    });
    expect(copy.planId).toBe('other-plan');
  });

  it('keeps the original plan when none is given', () => {
    const copy = duplicateRoutine(routine(), { name: 'Copy', newId: idFactory() });
    expect(copy.planId).toBe('p1');
  });
});

describe('bumpsRevision', () => {
  it('is false for a rename', () => {
    const before = routine();
    expect(bumpsRevision(before, { ...before, name: 'Push B' } as Routine)).toBe(false);
  });

  it('is true when an exercise is added', () => {
    const before = routine();
    const after = { ...before, exercises: [...before.exercises, ex('c', 3000)] } as Routine;
    expect(bumpsRevision(before, after)).toBe(true);
  });

  it('is true when targets change', () => {
    const before = routine();
    const after = {
      ...before,
      exercises: [
        { ...before.exercises[0], targetSets: 5 } as RoutineExercise,
        before.exercises[1] as RoutineExercise,
      ],
    } as Routine;
    expect(bumpsRevision(before, after)).toBe(true);
  });

  it('is true when the weekday assignment changes', () => {
    const before = routine();
    expect(bumpsRevision(before, { ...before, weekdays: [2] } as Routine)).toBe(true);
  });

  it('is false when weekdays are merely reordered', () => {
    const before = routine({ weekdays: [1, 4] });
    expect(bumpsRevision(before, { ...before, weekdays: [4, 1] } as Routine)).toBe(false);
  });

  it('is true when exercises are reordered', () => {
    const before = routine();
    const after = { ...before, exercises: moveWithin(before.exercises, 0, 1) } as Routine;
    expect(bumpsRevision(before, after)).toBe(true);
  });
});

describe('removeExercise', () => {
  it('drops the exercise and respaces the rest', () => {
    const list = removeExercise([ex('a', 1000), ex('b', 2000), ex('c', 3000)], 'b');
    expect(list.map((e) => e.uid)).toEqual(['a', 'c']);
    expect(list.map((e) => e.orderIndex)).toEqual([1000, 2000]);
  });
});

describe('estimateRoutineDuration', () => {
  it('accounts for sets, rest and transitions', () => {
    const estimate = estimateRoutineDuration([
      ex('a', 1000, { targetSets: 3, restSec: 60, warmupSets: 0 }),
      ex('b', 2000, { targetSets: 3, restSec: 60, warmupSets: 0 }),
    ]);

    // Per exercise: 3 sets x 35s + 2 rests x 60s = 225s. Plus one transition.
    expect(estimate.seconds).toBe(225 * 2 + 60);
    expect(estimate.minutes).toBe(9); // 510s is 8.5 minutes, rounded up.
  });

  it('includes warm-up sets at a lower cost', () => {
    const without = estimateRoutineDuration([ex('a', 1000, { warmupSets: 0 })]);
    const with2 = estimateRoutineDuration([ex('a', 1000, { warmupSets: 2 })]);
    expect(with2.seconds).toBeGreaterThan(without.seconds);
  });

  it('uses the fallback rest when an exercise has none', () => {
    const shortRest = estimateRoutineDuration([ex('a', 1000, { restSec: null })], 30);
    const longRest = estimateRoutineDuration([ex('a', 1000, { restSec: null })], 180);
    expect(longRest.seconds).toBeGreaterThan(shortRest.seconds);
  });

  it('skips optional exercises', () => {
    const estimate = estimateRoutineDuration([ex('a', 1000), ex('b', 2000, { isOptional: true })]);
    expect(estimate.seconds).toBe(estimateRoutineDuration([ex('a', 1000)]).seconds);
  });

  it('is zero for an empty routine', () => {
    expect(estimateRoutineDuration([]).seconds).toBe(0);
  });

  it('always declares itself an estimate', () => {
    expect(estimateRoutineDuration([ex('a', 1000)]).isEstimate).toBe(true);
  });
});

describe('totalPlannedSets', () => {
  it('sums working sets and ignores optional work', () => {
    expect(
      totalPlannedSets([
        ex('a', 1000, { targetSets: 4 }),
        ex('b', 2000, { targetSets: 3 }),
        ex('c', 3000, { targetSets: 5, isOptional: true }),
      ]),
    ).toBe(7);
  });
});
