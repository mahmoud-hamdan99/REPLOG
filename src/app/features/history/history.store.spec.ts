import 'fake-indexeddb/auto';

import { inject as angularInject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PR_DETECTOR, type PrDetector, type PrRecomputeContext } from '../../data/pr-detector';
import type { Query, Repository } from '../../data/repository';
import { WORKOUTS_REPO } from '../../data/tokens';
import type { Draft, Entity, Patch } from '../../domain/models/entity';
import type { SetLog, Workout, WorkoutExercise } from '../../domain/models/workout';
import { IdbRepository } from '../../infrastructure/idb/idb-repository';
import { StandaloneRepoContext } from '../../infrastructure/idb/idb-unit-of-work';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { HistoryStore, PAGE_SIZE } from './history.store';

/**
 * Counts the index rows a repository hands back.
 *
 * The paging criterion — "500 seeded workouts page smoothly with no full-store
 * scan" — is a claim about *cost*, and a stopwatch measures the machine rather
 * than the access path. Counting rows tests the claim directly: keyset paging
 * reads a page's worth whichever page you ask for, while offset paging reads
 * everything it skips.
 */
class CountingRepository<T extends Entity> implements Repository<T> {
  rows = 0;
  calls = 0;

  constructor(private readonly inner: Repository<T>) {}

  reset(): void {
    this.rows = 0;
    this.calls = 0;
  }

  async list(query?: Query): Promise<T[]> {
    const result = await this.inner.list(query);
    this.calls += 1;
    this.rows += result.length;
    return result;
  }

  get(id: string, options?: { includeDeleted?: boolean }): Promise<T | undefined> {
    return this.inner.get(id, options);
  }
  count(query?: Query): Promise<number> {
    return this.inner.count(query);
  }
  put(value: Draft<T>): Promise<T> {
    return this.inner.put(value);
  }
  putMany(values: readonly Draft<T>[]): Promise<T[]> {
    return this.inner.putMany(values);
  }
  patch(id: string, changes: Patch<T>): Promise<T> {
    return this.inner.patch(id, changes);
  }
  remove(id: string, options?: { hard?: boolean }): Promise<void> {
    return this.inner.remove(id, options);
  }
  clear(): Promise<void> {
    return this.inner.clear();
  }
}

/** Records what the PR seam was asked to rebuild, without rebuilding anything. */
class SpyDetector implements PrDetector {
  readonly recomputed: string[][] = [];

  detect = () => Promise.resolve([]);

  recompute = (_tx: unknown, context: PrRecomputeContext): Promise<void> => {
    this.recomputed.push([...context.variantKeys]);
    return Promise.resolve();
  };
}

const BENCH = 'bench|barbell|bilateral';
const ROW = 'row|barbell|bilateral';

describe('HistoryStore', () => {
  let h: IdbHarness;
  let store: HistoryStore;
  let counter: CountingRepository<Workout>;
  let detector: SpyDetector;

  beforeEach(async () => {
    counter = undefined as unknown as CountingRepository<Workout>;
    detector = new SpyDetector();

    h = await setupIdb({
      providers: [
        {
          provide: WORKOUTS_REPO,
          useFactory: () => {
            counter = new CountingRepository<Workout>(
              new IdbRepository<Workout>('workouts', angularInject(StandaloneRepoContext)),
            );
            return counter;
          },
        },
        { provide: PR_DETECTOR, useValue: detector },
      ],
    });
    store = TestBed.inject(HistoryStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  // ------------------------------------------------------------------ seeds

  const DAY_MS = 86_400_000;
  const BASE = Date.UTC(2026, 0, 1, 10, 0, 0);

  function workoutDraft(index: number, overrides: Partial<Workout> = {}): Draft<Workout> {
    const startedAtMs = BASE + index * DAY_MS;
    const iso = new Date(startedAtMs).toISOString();
    return {
      status: 'completed',
      startedAt: iso,
      finishedAt: iso,
      dayKey: iso.slice(0, 10),
      name: `Session ${index}`,
      planId: null,
      routineId: null,
      planSnapshot: null,
      source: 'quick',
      pauses: [],
      durationSec: 3600,
      totalVolumeKg: 0,
      totalSets: 0,
      totalReps: 0,
      exerciseCount: 0,
      bodyWeightKg: 80,
      notes: null,
      perceivedEffort: null,
      feeling: null,
      prCount: 0,
      trackingMode: 'simple',
      tabId: null,
      heartbeatAt: null,
      discardedReason: null,
      editedAt: null,
      ...overrides,
    } as Draft<Workout>;
  }

  /** Seeds `count` completed workouts, one per day, newest last. */
  async function seedWorkouts(count: number, overrides: Partial<Workout> = {}): Promise<void> {
    const repo = h.repo('workouts');
    await repo.putMany(Array.from({ length: count }, (_, index) => workoutDraft(index, overrides)));
  }

  /** One workout with one exercise and its sets, wired up consistently. */
  async function seedSession(options: {
    index: number;
    variantKey?: string;
    exerciseId?: string;
    sets?: { weightKg: number | null; reps: number | null; isCompleted?: boolean }[];
    workout?: Partial<Workout>;
  }): Promise<{ workout: Workout; exercise: WorkoutExercise; sets: SetLog[] }> {
    const workout = await h.repo('workouts').put(workoutDraft(options.index, options.workout));
    const exerciseId = options.exerciseId ?? 'bench';
    const variantKey = options.variantKey ?? BENCH;

    const exercise = await h.repo('workoutExercises').put({
      workoutId: workout.id,
      exerciseId,
      variantKey,
      nameSnapshot: 'Bench Press',
      routineExerciseUid: null,
      startedAt: workout.startedAt,
      dayKey: workout.dayKey,
      orderIndex: 1000,
      supersetGroup: null,
      supersetOrder: null,
      targetSnapshot: null,
      loadType: 'external',
      laterality: 'bilateral',
      restSec: 90,
      notes: null,
      isSkipped: false,
      completedSetCount: 0,
      volumeKg: 0,
    } as Draft<WorkoutExercise>);

    const specs = options.sets ?? [{ weightKg: 100, reps: 5 }];
    const sets: SetLog[] = [];
    for (const [index, spec] of specs.entries()) {
      sets.push(
        await h.repo('setLogs').put({
          workoutId: workout.id,
          workoutExerciseId: exercise.id,
          exerciseId,
          variantKey,
          dayKey: workout.dayKey,
          setIndex: index,
          setType: 'working',
          side: 'both',
          weightKg: spec.weightKg,
          extraWeightKg: null,
          reps: spec.reps,
          durationSec: null,
          distanceM: null,
          rpe: null,
          rir: null,
          isCompleted: spec.isCompleted ?? true,
          isPr: false,
          completedAt: workout.startedAt,
          restTakenSec: null,
          e1rmKg: null,
          volumeKg: (spec.weightKg ?? 0) * (spec.reps ?? 0),
          notes: null,
        } as Draft<SetLog>),
      );
    }

    return { workout, exercise, sets };
  }

  // ----------------------------------------------------------------- paging

  describe('paging', () => {
    it('returns the newest page first, in descending order', async () => {
      await seedWorkouts(120);
      await store.load();

      const page = store.workouts() ?? [];
      expect(page).toHaveLength(PAGE_SIZE);
      expect(page[0]?.name).toBe('Session 119');
      expect(page[49]?.name).toBe('Session 70');
      expect(store.hasMore()).toBe(true);
    });

    it('continues from the cursor without repeating or skipping a row', async () => {
      await seedWorkouts(120);
      await store.load();
      await store.loadMore();
      await store.loadMore();

      const all = store.workouts() ?? [];
      expect(all).toHaveLength(120);
      expect(new Set(all.map((workout) => workout.id)).size).toBe(120);

      const names = all.map((workout) => workout.name);
      expect(names[0]).toBe('Session 119');
      expect(names.at(-1)).toBe('Session 0');
      expect(store.hasMore()).toBe(false);
    });

    it('lists both of two sessions that share an instant', async () => {
      // The cursor bound is inclusive precisely so neither is dropped; the
      // delivered set is what stops the boundary row appearing twice.
      const sameInstant = new Date(BASE).toISOString();
      await h
        .repo('workouts')
        .putMany([
          workoutDraft(0, { startedAt: sameInstant, name: 'A' }),
          workoutDraft(0, { startedAt: sameInstant, name: 'B' }),
        ]);

      await store.load();

      const names = (store.workouts() ?? []).map((workout) => workout.name).sort();
      expect(names).toEqual(['A', 'B']);
    });

    it('reads a page of rows for a late page, not everything before it', async () => {
      await seedWorkouts(500);
      await store.load();

      const firstPageRows = counter.rows;
      counter.reset();

      // Walk to page ten. Each step should cost what the first one did.
      for (let page = 2; page <= 10; page += 1) {
        await store.loadMore();
      }

      expect(store.workouts()).toHaveLength(PAGE_SIZE * 10);
      // Nine pages of 50, plus one boundary row re-read per page. Offset
      // paging would have read 50+100+…+500 = 2 750 rows to get here.
      expect(counter.rows).toBeLessThanOrEqual(PAGE_SIZE * 9 + 9 + firstPageRows);
      expect(counter.rows).toBeLessThan(1000);
    });

    it('is empty, not broken, with no history at all', async () => {
      await store.load();

      expect(store.workouts()).toEqual([]);
      expect(store.hasMore()).toBe(false);
      expect(store.isLoading()).toBe(false);
    });

    it('groups into months on the stored local day, newest first', async () => {
      await h
        .repo('workouts')
        .putMany([
          workoutDraft(0, { dayKey: '2026-01-01', startedAt: '2026-01-01T10:00:00.000Z' }),
          workoutDraft(1, { dayKey: '2026-01-20', startedAt: '2026-01-20T10:00:00.000Z' }),
          workoutDraft(2, { dayKey: '2026-02-03', startedAt: '2026-02-03T10:00:00.000Z' }),
        ]);

      await store.load();

      expect(store.months().map((month) => month.key)).toEqual(['2026-02', '2026-01']);
      expect(store.months()[1]?.workouts).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------- filters

  describe('filters', () => {
    it('narrows to one routine', async () => {
      await h
        .repo('workouts')
        .putMany([
          workoutDraft(0, { routineId: 'push' }),
          workoutDraft(1, { routineId: 'pull' }),
          workoutDraft(2, { routineId: 'push' }),
        ]);

      await store.load();
      await store.setFilters({ routineId: 'push' });

      expect(store.workouts()).toHaveLength(2);
      expect(store.hasActiveFilters()).toBe(true);
    });

    it('narrows to a date range on local day keys', async () => {
      await seedWorkouts(10);
      await store.load();

      await store.setFilters({ fromDay: '2026-01-04', toDay: '2026-01-06' });

      const days = (store.workouts() ?? []).map((workout) => workout.dayKey);
      expect(days).toEqual(['2026-01-06', '2026-01-05', '2026-01-04']);
    });

    it('narrows to one exercise through its own index', async () => {
      await seedSession({ index: 0, exerciseId: 'bench' });
      await seedSession({ index: 1, exerciseId: 'row', variantKey: ROW });
      await seedSession({ index: 2, exerciseId: 'bench' });

      await store.load();
      expect(store.workouts()).toHaveLength(3);

      await store.setFilters({ exerciseId: 'bench' });
      expect(store.workouts()).toHaveLength(2);
    });

    it('clears back to everything', async () => {
      await seedWorkouts(5);
      await store.load();
      await store.setFilters({ routineId: 'nothing-matches' });
      expect(store.workouts()).toHaveLength(0);

      await store.clearFilters();
      expect(store.workouts()).toHaveLength(5);
      expect(store.hasActiveFilters()).toBe(false);
    });

    it('stops rather than scanning the store for a filter that matches nothing', async () => {
      await seedWorkouts(500);
      await store.load();
      counter.reset();

      await store.setFilters({ routineId: 'no-such-routine' });

      expect(store.workouts()).toEqual([]);
      // The scan is bounded; without the bound this would read all 500.
      expect(counter.rows).toBeLessThanOrEqual(PAGE_SIZE * 20 + PAGE_SIZE);
    });
  });

  // ----------------------------------------------------------------- detail

  describe('detail', () => {
    it('reads a workout with its exercises and sets', async () => {
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 100, reps: 4 },
        ],
      });

      const detail = await store.detail(seeded.workout.id);

      expect(detail?.exercises).toHaveLength(1);
      expect(detail?.setsByExercise.get(seeded.exercise.id)).toHaveLength(2);
      expect(detail?.setsByExercise.get(seeded.exercise.id)?.[0]?.setIndex).toBe(0);
    });

    it('stays fully readable after the routine it came from is deleted', async () => {
      const routine = await h.repo('routines').put({
        planId: null,
        name: 'Push A',
        scheduleType: 'flexible',
        weekdays: [],
        orderIndex: 1000,
        estimatedDurationMin: null,
        notes: null,
        exercises: [],
        revision: 3,
        isArchived: false,
      });
      const seeded = await seedSession({
        index: 0,
        workout: {
          routineId: routine.id,
          planSnapshot: {
            planId: null,
            planName: null,
            routineId: routine.id,
            routineName: 'Push A',
            routineRevision: 3,
            scheduleType: 'flexible',
          },
        },
      });

      await h.repo('routines').remove(routine.id);
      const detail = await store.detail(seeded.workout.id);

      // Every rendered value comes from the snapshot, so nothing is lost.
      expect(detail?.routineState).toBe('missing');
      expect(detail?.workout.planSnapshot?.routineName).toBe('Push A');
      expect(detail?.exercises).toHaveLength(1);
      expect(detail?.setsByExercise.get(seeded.exercise.id)).toHaveLength(1);
    });

    it('notes a routine that has changed since the session', async () => {
      const routine = await h.repo('routines').put({
        planId: null,
        name: 'Push A',
        scheduleType: 'flexible',
        weekdays: [],
        orderIndex: 1000,
        estimatedDurationMin: null,
        notes: null,
        exercises: [],
        revision: 3,
        isArchived: false,
      });
      const seeded = await seedSession({
        index: 0,
        workout: {
          routineId: routine.id,
          planSnapshot: {
            planId: null,
            planName: null,
            routineId: routine.id,
            routineName: 'Push A',
            routineRevision: 3,
            scheduleType: 'flexible',
          },
        },
      });

      await h.repo('routines').patch(routine.id, { revision: 4 });
      expect((await store.detail(seeded.workout.id))?.routineState).toBe('changed');

      await h.repo('routines').patch(routine.id, { revision: 3 });
      expect((await store.detail(seeded.workout.id))?.routineState).toBe('same');
    });

    it('calls a quick workout ad-hoc rather than pretending it had a plan', async () => {
      const seeded = await seedSession({ index: 0 });
      expect((await store.detail(seeded.workout.id))?.routineState).toBe('adhoc');
    });

    it('returns null for a workout that is not there', async () => {
      expect(await store.detail('missing')).toBeNull();
    });
  });

  // -------------------------------------------------------- per-exercise view

  describe('exercise history', () => {
    it('lists every session of an exercise, newest first', async () => {
      await seedSession({ index: 0, sets: [{ weightKg: 90, reps: 5 }] });
      await seedSession({ index: 1, sets: [{ weightKg: 95, reps: 5 }] });
      await seedSession({ index: 2, sets: [{ weightKg: 100, reps: 5 }] });

      const sessions = await store.exerciseHistory('bench');

      expect(sessions).toHaveLength(3);
      expect(sessions[0]?.sets[0]?.weightKg).toBe(100);
      expect(sessions[2]?.sets[0]?.weightKg).toBe(90);
    });

    it('skips a slot with nothing confirmed', async () => {
      await seedSession({ index: 0, sets: [{ weightKg: 100, reps: 5, isCompleted: false }] });
      expect(await store.exerciseHistory('bench')).toHaveLength(0);
    });

    it('does not include a deleted workout', async () => {
      const seeded = await seedSession({ index: 0 });
      await store.deleteWorkout(seeded.workout.id);

      expect(await store.exerciseHistory('bench')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------- mutations

  describe('corrections', () => {
    it('recomputes rollups and marks the workout as edited', async () => {
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 100, reps: 5 },
        ],
      });
      await store.load();

      await store.updateSet(seeded.sets[0]!.id, { weightKg: 120, reps: 3 });

      const set = await h.repo('setLogs').get(seeded.sets[0]!.id);
      expect(set?.weightKg).toBe(120);
      expect(set?.volumeKg).toBe(360);
      // Derived values are recomputed, never left stale.
      expect(set?.e1rmKg).toBe(132);

      const exercise = await h.repo('workoutExercises').get(seeded.exercise.id);
      expect(exercise?.volumeKg).toBe(860);

      const workout = await h.repo('workouts').get(seeded.workout.id);
      expect(workout?.totalVolumeKg).toBe(860);
      expect(workout?.totalSets).toBe(2);
      expect(workout?.totalReps).toBe(8);
      expect(workout?.editedAt).not.toBeNull();
    });

    it('asks for the affected variant to be rebuilt', async () => {
      const seeded = await seedSession({ index: 0 });
      await store.updateSet(seeded.sets[0]!.id, { reps: 6 });

      expect(detector.recomputed).toEqual([[BENCH]]);
    });

    it('removes a set and brings it back with the totals intact', async () => {
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 80, reps: 10 },
        ],
      });

      await store.deleteSet(seeded.sets[1]!.id);
      expect((await h.repo('workouts').get(seeded.workout.id))?.totalVolumeKg).toBe(500);

      await store.restoreSet(seeded.sets[1]!.id);
      expect((await h.repo('workouts').get(seeded.workout.id))?.totalVolumeKg).toBe(1300);
      expect(
        await h.repo('setLogs').list({ index: 'by_workoutId', equals: seeded.workout.id }),
      ).toHaveLength(2);
    });

    it('leaves a corrected workout matching a rebuild from its sets', async () => {
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 100, reps: 5 },
          { weightKg: 90, reps: 8 },
        ],
      });

      await store.updateSet(seeded.sets[2]!.id, { weightKg: 95, reps: 6 });
      const afterEdit = await h.repo('workouts').get(seeded.workout.id);

      // The same recomputation, run again from the stored sets, must agree.
      await store.updateSet(seeded.sets[2]!.id, { weightKg: 95, reps: 6 });
      const afterRepeat = await h.repo('workouts').get(seeded.workout.id);

      expect(afterRepeat?.totalVolumeKg).toBe(afterEdit?.totalVolumeKg);
      expect(afterRepeat?.totalSets).toBe(afterEdit?.totalSets);
      expect(afterRepeat?.totalReps).toBe(afterEdit?.totalReps);
      expect(afterRepeat?.totalVolumeKg).toBe(1570);
    });
  });

  describe('deleting a workout', () => {
    it('hides it and its sets from every default query', async () => {
      const seeded = await seedSession({ index: 0 });
      await seedSession({ index: 1 });
      await store.load();
      expect(store.workouts()).toHaveLength(2);

      await store.deleteWorkout(seeded.workout.id);

      expect(store.workouts()).toHaveLength(1);
      expect(
        await h.repo('setLogs').list({ index: 'by_workoutId', equals: seeded.workout.id }),
      ).toHaveLength(0);
      expect(
        await h.repo('workoutExercises').list({ index: 'by_workoutId', equals: seeded.workout.id }),
      ).toHaveLength(0);
    });

    it('recovers it, with its sets, from the tombstone', async () => {
      // Every write gets its own instant, as it would with the real clock.
      // With a frozen clock the cascade's timestamps are all equal and the
      // ordering this restore depends on is never actually exercised.
      h.clock.tickMs = 1;
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 90, reps: 8 },
        ],
      });

      await store.deleteWorkout(seeded.workout.id);
      await store.restoreWorkout(seeded.workout.id);

      await store.load({ force: true });
      expect(store.workouts()).toHaveLength(1);

      const detail = await store.detail(seeded.workout.id);
      expect(detail?.setsByExercise.get(seeded.exercise.id)).toHaveLength(2);
      expect(detail?.workout.totalVolumeKg).toBe(1220);
    });

    it('does not resurrect a set that was deleted on its own beforehand', async () => {
      h.clock.tickMs = 1;
      const seeded = await seedSession({
        index: 0,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 90, reps: 8 },
        ],
      });

      // A correction made last week, then the whole session deleted today.
      await store.deleteSet(seeded.sets[1]!.id);
      h.clock.advance(60_000);
      await store.deleteWorkout(seeded.workout.id);

      await store.restoreWorkout(seeded.workout.id);

      const detail = await store.detail(seeded.workout.id);
      expect(detail?.setsByExercise.get(seeded.exercise.id)).toHaveLength(1);
      expect(detail?.workout.totalVolumeKg).toBe(500);
    });

    it('asks for every variant in the session to be rebuilt', async () => {
      const seeded = await seedSession({ index: 0 });
      detector.recomputed.length = 0;

      await store.deleteWorkout(seeded.workout.id);
      expect(detector.recomputed).toEqual([[BENCH]]);

      detector.recomputed.length = 0;
      await store.restoreWorkout(seeded.workout.id);
      expect(detector.recomputed).toEqual([[BENCH]]);
    });

    it('is a no-op on a workout that was never deleted', async () => {
      const seeded = await seedSession({ index: 0 });
      await store.restoreWorkout(seeded.workout.id);

      expect((await h.repo('workouts').get(seeded.workout.id))?.deletedAt).toBeNull();
    });
  });
});
