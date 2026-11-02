import type { RoutineExercise } from '../models/training';
import { newRoutineExercise } from '../planner/plan-ops';
import { currentFocus, focusAfter, sessionProgress, type FocusExercise } from './focus';
import {
  MAX_REST_SEC,
  REST_ADJUST_SEC,
  adjustRest,
  isRestDone,
  restElapsedSec,
  restProgress,
  restRemainingSec,
  type RestState,
} from './rest';
import {
  planAdHoc,
  planFromRoutine,
  renumber,
  warmupWeightKg,
  type ExerciseFacts,
} from './session';

const facts = (overrides: Partial<ExerciseFacts> = {}): ExerciseFacts => ({
  exerciseId: 'bench',
  variantKey: 'bench|barbell|bilateral',
  name: 'Bench Press',
  loadType: 'external',
  laterality: 'bilateral',
  defaultRestSec: null,
  ...overrides,
});

const slot = (uid: string, orderIndex: number, overrides: Partial<RoutineExercise> = {}) =>
  ({
    ...newRoutineExercise({ uid, exerciseId: 'bench', nameSnapshot: uid, orderIndex }),
    ...overrides,
  }) as RoutineExercise;

const library = new Map<string, ExerciseFacts>([['bench', facts()]]);
const lookup = (id: string) => library.get(id);

describe('planFromRoutine', () => {
  it('pre-creates warm-up rows before working rows', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { targetSets: 3, warmupSets: 2 })], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(planned?.sets.map((set) => set.setType)).toEqual([
      'warmup',
      'warmup',
      'working',
      'working',
      'working',
    ]);
    expect(planned?.sets.map((set) => set.setIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a warm-up row blank, having nothing to base a percentage on', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { warmupSets: 1, targetWeightKg: 100 })], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(planned?.sets[0]).toMatchObject({ setType: 'warmup', weightKg: null, reps: null });
  });

  it('prefills a planned load but not a rep range', () => {
    const [planned] = planFromRoutine(
      [slot('a', 1000, { targetWeightKg: 60, targetRepsMin: 8, targetRepsMax: 12 })],
      { facts: lookup, defaultRestSec: 90 },
    );

    expect(planned?.sets[0]).toMatchObject({ weightKg: 60, reps: null });
  });

  it('prefills reps when the plan asked for an exact number', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { targetRepsMin: 5, targetRepsMax: 5 })], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(planned?.sets[0]?.reps).toBe(5);
  });

  it('splits sides for a separately logged unilateral exercise', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { targetSets: 2 })], {
      facts: () => facts({ laterality: 'unilateral-separate' }),
      defaultRestSec: 90,
    });

    expect(planned?.sets.map((set) => set.side)).toEqual(['left', 'right', 'left', 'right']);
  });

  it('keeps alternating unilateral work as one row per set', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { targetSets: 2 })], {
      facts: () => facts({ laterality: 'unilateral-alternating' }),
      defaultRestSec: 90,
    });

    expect(planned?.sets.map((set) => set.side)).toEqual(['both', 'both']);
  });

  it('freezes the plan target, so a later edit cannot rewrite history', () => {
    const [planned] = planFromRoutine(
      [slot('a', 1000, { targetSets: 4, targetRepsMin: 8, targetRepsMax: 10, restSec: 120 })],
      { facts: lookup, defaultRestSec: 90 },
    );

    expect(planned?.targetSnapshot).toEqual({
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetWeightKg: null,
      targetRpe: null,
      restSec: 120,
    });
  });

  it('prefers the slot rest, then the exercise default, then the preference', () => {
    const withSlotRest = planFromRoutine([slot('a', 1000, { restSec: 150 })], {
      facts: lookup,
      defaultRestSec: 90,
    });
    const withExerciseDefault = planFromRoutine([slot('a', 1000)], {
      facts: () => facts({ defaultRestSec: 45 }),
      defaultRestSec: 90,
    });
    const withPreference = planFromRoutine([slot('a', 1000)], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(withSlotRest[0]?.restSec).toBe(150);
    expect(withExerciseDefault[0]?.restSec).toBe(45);
    expect(withPreference[0]?.restSec).toBe(90);
  });

  it('survives an exercise that is no longer in the library', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { nameSnapshot: 'Deleted Lift' })], {
      facts: () => undefined,
      defaultRestSec: 90,
    });

    expect(planned?.nameSnapshot).toBe('Deleted Lift');
    expect(planned?.variantKey).toBe('bench');
    expect(planned?.loadType).toBe('external');
  });

  it('marks skipped slots without dropping them', () => {
    const planned = planFromRoutine([slot('a', 1000), slot('b', 2000)], {
      facts: lookup,
      defaultRestSec: 90,
      skipUids: new Set(['b']),
    });

    expect(planned).toHaveLength(2);
    expect(planned[1]?.isSkipped).toBe(true);
  });

  it('respaces order indices in routine order, ignoring stale values', () => {
    const planned = planFromRoutine([slot('b', 9000), slot('a', 10)], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(planned.map((item) => item.routineExerciseUid)).toEqual(['a', 'b']);
    expect(planned.map((item) => item.orderIndex)).toEqual([1000, 2000]);
  });

  it('gives a zero-set slot at least one row to log into', () => {
    const [planned] = planFromRoutine([slot('a', 1000, { targetSets: 0 })], {
      facts: lookup,
      defaultRestSec: 90,
    });

    expect(planned?.sets).toHaveLength(1);
  });
});

describe('planAdHoc', () => {
  it('has no target snapshot, because no plan asked for it', () => {
    const planned = planAdHoc(facts(), { orderIndex: 4000, defaultRestSec: 90 });

    expect(planned.targetSnapshot).toBeNull();
    expect(planned.routineExerciseUid).toBeNull();
    expect(planned.sets).toHaveLength(3);
    expect(planned.sets.every((set) => set.weightKg === null)).toBe(true);
  });

  it('honours the exercise rest default and an explicit set count', () => {
    const planned = planAdHoc(facts({ defaultRestSec: 60 }), {
      orderIndex: 1000,
      defaultRestSec: 90,
      targetSets: 5,
    });

    expect(planned.restSec).toBe(60);
    expect(planned.sets).toHaveLength(5);
  });

  it('splits sides for separately logged unilateral work', () => {
    const planned = planAdHoc(facts({ laterality: 'unilateral-separate' }), {
      orderIndex: 1000,
      defaultRestSec: 90,
      targetSets: 2,
    });

    expect(planned.sets.map((set) => set.side)).toEqual(['left', 'right', 'left', 'right']);
  });
});

describe('warmupWeightKg', () => {
  it('halves the working load and rounds to a plate step', () => {
    expect(warmupWeightKg(100)).toBe(50);
    expect(warmupWeightKg(95)).toBe(47.5);
    expect(warmupWeightKg(63)).toBe(32.5);
  });

  it('suggests nothing when there is no load to halve', () => {
    expect(warmupWeightKg(null)).toBeNull();
    expect(warmupWeightKg(0)).toBeNull();
  });
});

describe('renumber', () => {
  it('makes set indices dense from zero in list order', () => {
    expect(renumber([{ setIndex: 7 }, { setIndex: 2 }, { setIndex: 9 }])).toEqual([
      { setIndex: 0 },
      { setIndex: 1 },
      { setIndex: 2 },
    ]);
  });
});

// --------------------------------------------------------------------- focus

const fx = (
  id: string,
  completed: readonly boolean[],
  overrides: Partial<FocusExercise> = {},
): FocusExercise => ({
  id,
  supersetGroup: null,
  isSkipped: false,
  sets: completed.map((isCompleted, index) => ({ id: `${id}-${index}`, isCompleted })),
  ...overrides,
});

describe('currentFocus', () => {
  it('is the first pending row in list order', () => {
    expect(currentFocus([fx('a', [true, true]), fx('b', [false, false])])).toEqual({
      exerciseId: 'b',
      setId: 'b-0',
    });
  });

  it('steps over a skipped exercise', () => {
    expect(currentFocus([fx('a', [false], { isSkipped: true }), fx('b', [false])])).toEqual({
      exerciseId: 'b',
      setId: 'b-0',
    });
  });

  it('is null once everything is logged', () => {
    expect(currentFocus([fx('a', [true])])).toBeNull();
  });

  it('is null for an empty session', () => {
    expect(currentFocus([])).toBeNull();
  });
});

describe('focusAfter', () => {
  it('advances to the next pending row of the same exercise', () => {
    expect(focusAfter([fx('a', [true, false, false])], 'a')).toEqual({
      exerciseId: 'a',
      setId: 'a-1',
    });
  });

  it('moves to the next exercise once this one is done', () => {
    expect(focusAfter([fx('a', [true]), fx('b', [false])], 'a')).toEqual({
      exerciseId: 'b',
      setId: 'b-0',
    });
  });

  it('alternates between superset partners', () => {
    const group = [
      fx('a', [true, false], { supersetGroup: 'A' }),
      fx('b', [false, false], { supersetGroup: 'A' }),
    ];

    expect(focusAfter(group, 'a')).toEqual({ exerciseId: 'b', setId: 'b-0' });
    expect(focusAfter(group, 'b')).toEqual({ exerciseId: 'a', setId: 'a-1' });
  });

  it('wraps within a three-member group', () => {
    const group = [
      fx('a', [true], { supersetGroup: 'A' }),
      fx('b', [true], { supersetGroup: 'A' }),
      fx('c', [false], { supersetGroup: 'A' }),
    ];

    expect(focusAfter(group, 'b')).toEqual({ exerciseId: 'c', setId: 'c-0' });
    expect(focusAfter(group, 'c')).toEqual({ exerciseId: 'c', setId: 'c-0' });
  });

  it('leaves the group only once every member is finished', () => {
    const exercises = [
      fx('a', [true], { supersetGroup: 'A' }),
      fx('b', [true], { supersetGroup: 'A' }),
      fx('c', [false]),
    ];

    expect(focusAfter(exercises, 'a')).toEqual({ exerciseId: 'c', setId: 'c-0' });
  });

  it('skips a skipped partner rather than focusing nothing', () => {
    const exercises = [
      fx('a', [true, false], { supersetGroup: 'A' }),
      fx('b', [false], { supersetGroup: 'A', isSkipped: true }),
    ];

    expect(focusAfter(exercises, 'a')).toEqual({ exerciseId: 'a', setId: 'a-1' });
  });

  it('comes back to unfinished work earlier in the list', () => {
    const exercises = [fx('a', [true, false]), fx('b', [true])];

    expect(focusAfter(exercises, 'b')).toEqual({ exerciseId: 'a', setId: 'a-1' });
  });

  it('is null when the session is complete', () => {
    expect(focusAfter([fx('a', [true]), fx('b', [true])], 'a')).toBeNull();
  });

  it('falls back to the first pending row for an unknown exercise', () => {
    expect(focusAfter([fx('a', [false])], 'ghost')).toEqual({
      exerciseId: 'a',
      setId: 'a-0',
    });
  });
});

describe('sessionProgress', () => {
  it('counts completed rows against planned rows', () => {
    expect(sessionProgress([fx('a', [true, true, false]), fx('b', [false])])).toEqual({
      completed: 2,
      planned: 4,
      ratio: 0.5,
    });
  });

  it('excludes a skipped exercise from the denominator', () => {
    expect(
      sessionProgress([fx('a', [true]), fx('b', [false, false], { isSkipped: true })]),
    ).toEqual({ completed: 1, planned: 1, ratio: 1 });
  });

  it('is zero rather than NaN with nothing planned', () => {
    expect(sessionProgress([])).toEqual({ completed: 0, planned: 0, ratio: 0 });
  });
});

// ----------------------------------------------------------------- rest timer

const START = Date.UTC(2026, 10, 2, 10, 0, 0);
const rest = (overrides: Partial<RestState> = {}): RestState => ({
  startedAtMs: START,
  targetSec: 90,
  exerciseId: 'we1',
  setId: 's1',
  ...overrides,
});

describe('rest timer', () => {
  it('derives the remaining time from the clock, not from a counter', () => {
    expect(restRemainingSec(rest(), START)).toBe(90);
    expect(restRemainingSec(rest(), START + 30_000)).toBe(60);
    expect(restRemainingSec(rest(), START + 90_000)).toBe(0);
  });

  it('is still correct after ten minutes in the background', () => {
    // The point of ARCHITECTURE section 7.3: a suspended tab cannot drift.
    expect(restRemainingSec(rest(), START + 600_000)).toBe(0);
    expect(restElapsedSec(rest(), START + 600_000)).toBe(600);
    expect(isRestDone(rest(), START + 600_000)).toBe(true);
  });

  it('never reports negative time left', () => {
    expect(restRemainingSec(rest(), START + 200_000)).toBe(0);
    expect(restProgress(rest(), START + 200_000)).toBe(0);
  });

  it('depletes the ring from one to zero', () => {
    expect(restProgress(rest(), START)).toBe(1);
    expect(restProgress(rest(), START + 45_000)).toBeCloseTo(0.5, 5);
  });

  it('reports no progress for a zero-length rest instead of dividing by zero', () => {
    expect(restProgress(rest({ targetSec: 0 }), START)).toBe(0);
  });

  it('extends the target without touching the start timestamp', () => {
    const extended = adjustRest(rest(), REST_ADJUST_SEC, START + 10_000);

    expect(extended.startedAtMs).toBe(START);
    expect(extended.targetSec).toBe(105);
    expect(restRemainingSec(extended, START + 10_000)).toBe(95);
  });

  it('ends the rest rather than counting backwards when shortened past zero', () => {
    const shortened = adjustRest(rest({ targetSec: 10 }), -REST_ADJUST_SEC, START + 5_000);

    expect(shortened.targetSec).toBe(5);
    expect(restRemainingSec(shortened, START + 5_000)).toBe(0);
  });

  it('caps the target at an hour', () => {
    const absurd = adjustRest(rest({ targetSec: MAX_REST_SEC }), 600, START);
    expect(absurd.targetSec).toBe(MAX_REST_SEC);
  });
});
