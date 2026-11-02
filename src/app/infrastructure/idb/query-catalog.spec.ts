import 'fake-indexeddb/auto';

import type { SetLog, WorkoutExercise } from '../../domain/models';
import { storeOf } from './idb-database';
import { setupIdb, type IdbHarness } from './testing/idb-test-kit';

const EXERCISE_COUNT = 50;
const WORKOUT_COUNT = 50;
const EXERCISES_PER_WORKOUT = 5;
const SETS_PER_EXERCISE = 20; // 50 * 5 * 20 = 5000 set logs

/** The budget from the Phase 2 acceptance criteria. */
const INDEXED_QUERY_BUDGET_MS = 50;

function envelope(id: string, at: string) {
  return { id, createdAt: at, updatedAt: at, deletedAt: null, rev: 1, origin: 'seed' };
}

/**
 * Writes the fixture straight through the transaction rather than through the
 * repository: the repository reads each record before stamping it, which would
 * double the work for a fixture whose point is volume, not envelope semantics.
 */
async function seed(h: IdbHarness): Promise<void> {
  const workoutExercises: WorkoutExercise[] = [];
  const setLogs: SetLog[] = [];

  for (let w = 0; w < WORKOUT_COUNT; w += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + w, 18, 0, 0));
    const startedAt = day.toISOString();
    const dayKey = startedAt.slice(0, 10);

    for (let e = 0; e < EXERCISES_PER_WORKOUT; e += 1) {
      const exerciseIndex = (w * EXERCISES_PER_WORKOUT + e) % EXERCISE_COUNT;
      const exerciseId = `ex-${String(exerciseIndex).padStart(3, '0')}`;
      const variantKey = `${exerciseId}|barbell|bilateral`;
      const weId = `we-${w}-${e}`;

      workoutExercises.push({
        ...envelope(weId, startedAt),
        workoutId: `w-${w}`,
        exerciseId,
        variantKey,
        nameSnapshot: exerciseId,
        routineExerciseUid: null,
        startedAt,
        dayKey,
        orderIndex: e * 1000,
        supersetGroup: null,
        supersetOrder: null,
        targetSnapshot: null,
        loadType: 'external',
        laterality: 'bilateral',
        restSec: 90,
        notes: null,
        isSkipped: false,
        completedSetCount: SETS_PER_EXERCISE,
        volumeKg: 0,
      } as WorkoutExercise);

      for (let s = 0; s < SETS_PER_EXERCISE; s += 1) {
        const completedAt = new Date(day.getTime() + s * 60_000).toISOString();
        setLogs.push({
          ...envelope(`sl-${w}-${e}-${s}`, completedAt),
          workoutId: `w-${w}`,
          workoutExerciseId: weId,
          exerciseId,
          variantKey,
          dayKey,
          setIndex: s,
          setType: 'working',
          side: 'both',
          weightKg: 60 + s,
          extraWeightKg: null,
          reps: 5,
          durationSec: null,
          distanceM: null,
          rpe: null,
          rir: null,
          isCompleted: true,
          isPr: false,
          completedAt,
          restTakenSec: null,
          e1rmKg: null,
          volumeKg: (60 + s) * 5,
          notes: null,
        } as SetLog);
      }
    }
  }

  await h.db.run(['workoutExercises', 'setLogs'], 'readwrite', async (tx) => {
    const we = storeOf(tx, 'workoutExercises');
    for (const record of workoutExercises) {
      await we.put(record);
    }
    const sl = storeOf(tx, 'setLogs');
    for (const record of setLogs) {
      await sl.put(record);
    }
  });
}

async function timed<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await work();
  return { result, ms: performance.now() - start };
}

describe('query catalog at realistic scale', () => {
  let h: IdbHarness;

  beforeAll(async () => {
    h = await setupIdb();
    await seed(h);
  }, 120_000);

  afterAll(async () => {
    await h.dispose();
  });

  it('seeded five thousand set logs', async () => {
    expect(await h.repo('setLogs').count()).toBe(
      WORKOUT_COUNT * EXERCISES_PER_WORKOUT * SETS_PER_EXERCISE,
    );
  });

  /**
   * Q7, the query the Active Tracker opens with. It must be a single backwards
   * cursor hit on by_exerciseId_startedAt, not a scan of every session.
   */
  it('Q7: finds the most recent session for an exercise within budget', async () => {
    const { result, ms } = await timed(() =>
      h.repo('workoutExercises').list({
        index: 'by_exerciseId_startedAt',
        range: { lower: ['ex-007', ''], upper: ['ex-007', '￿'] },
        direction: 'prev',
        limit: 1,
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseId).toBe('ex-007');
    expect(ms).toBeLessThan(INDEXED_QUERY_BUDGET_MS);
  });

  it('Q8: reads one exercise progression series within budget', async () => {
    const { result, ms } = await timed(() =>
      h.repo('setLogs').list({
        index: 'by_exerciseId_completedAt',
        range: { lower: ['ex-007', '2026-01-01'], upper: ['ex-007', '2026-12-31'] },
      }),
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.exerciseId === 'ex-007')).toBe(true);
    expect(ms).toBeLessThan(INDEXED_QUERY_BUDGET_MS);
  });

  it('Q12: loads one session within budget', async () => {
    const { result, ms } = await timed(() =>
      h.repo('setLogs').list({ index: 'by_workoutId', equals: 'w-10' }),
    );

    expect(result).toHaveLength(EXERCISES_PER_WORKOUT * SETS_PER_EXERCISE);
    expect(ms).toBeLessThan(INDEXED_QUERY_BUDGET_MS);
  });

  it('Q13: aggregates a day of volume within budget', async () => {
    const { result, ms } = await timed(() =>
      h.repo('setLogs').list({ index: 'by_dayKey', equals: '2026-01-11' }),
    );

    expect(result.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(INDEXED_QUERY_BUDGET_MS);
  });

  it('variant-scoped record scan stays within budget', async () => {
    const { result, ms } = await timed(() =>
      h.repo('setLogs').list({
        index: 'by_variantKey_completedAt',
        range: {
          lower: ['ex-007|barbell|bilateral', ''],
          upper: ['ex-007|barbell|bilateral', '￿'],
        },
        direction: 'prev',
        limit: 50,
      }),
    );

    expect(result.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(INDEXED_QUERY_BUDGET_MS);
  });

  /**
   * The indexed query must return exactly what a full scan would.
   *
   * No timing ratio is asserted here: relative measurements distort under
   * coverage instrumentation and make the suite flaky. The index guard is the
   * absolute budget above — walking all five thousand records takes several
   * times the 50 ms budget, so a silently dropped index fails those tests.
   */
  it('returns the same records a full scan would', async () => {
    const indexed = await h.repo('setLogs').list({
      index: 'by_exerciseId_completedAt',
      range: { lower: ['ex-007', ''], upper: ['ex-007', '￿'] },
    });

    const all = await h.repo('setLogs').list();
    const scanned = all.filter((row) => row.exerciseId === 'ex-007');

    expect(indexed.map((r) => r.id).sort()).toEqual(scanned.map((r) => r.id).sort());
    expect(indexed.length).toBeGreaterThan(0);
  });
});
