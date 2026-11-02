import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { PR_DETECTOR, type PrDetector } from '../../data/pr-detector';
import { APP_META_STORE } from '../../data/app-meta';
import { TAB_IDENTITY } from '../../data/tab-id';
import { SET_LOGS_REPO, WORKOUTS_REPO, WORKOUT_EXERCISES_REPO } from '../../data/tokens';
import type { ExerciseFacts } from '../../domain/tracker/session';
import { PlannerStore } from '../planner/planner.store';
import {
  FakeClock,
  reopenIdb,
  setupIdb,
  type IdbHarness,
} from '../../infrastructure/idb/testing/idb-test-kit';
import { TrackerStore } from './tracker.store';

/**
 * The reliability suite.
 *
 * This file is the acceptance evidence for Phase 5. The contract it exists to
 * prove (docs/ARCHITECTURE.md section 7): *a set the user has confirmed
 * survives an app kill, a Safari tab purge, an iOS memory reclaim and a cold
 * boot, losing at most the one edit still in flight.*
 *
 * Run against the real IndexedDB stack, because transactions, rollback and
 * read-your-writes are precisely what is being tested — a double that
 * reimplemented them would only prove the double works.
 */

const BENCH: ExerciseFacts = {
  exerciseId: 'bench',
  variantKey: 'bench|barbell|bilateral',
  name: 'Bench Press',
  loadType: 'external',
  laterality: 'bilateral',
  defaultRestSec: null,
};

const ROW: ExerciseFacts = {
  exerciseId: 'row',
  variantKey: 'row|barbell|bilateral',
  name: 'Barbell Row',
  loadType: 'external',
  laterality: 'bilateral',
  defaultRestSec: null,
};

const FACTS = new Map([
  ['bench', BENCH],
  ['row', ROW],
]);
const facts = (id: string) => FACTS.get(id);

describe('TrackerStore', () => {
  let h: IdbHarness;
  let store: TrackerStore;
  let planner: PlannerStore;

  beforeEach(async () => {
    h = await setupIdb();
    planner = TestBed.inject(PlannerStore);
    store = TestBed.inject(TrackerStore);
    await planner.load();
  });

  afterEach(async () => {
    await h.dispose();
  });

  /** A plan with one two-exercise day, the shape most tests start from. */
  async function seedRoutine(options: { sets?: number; warmups?: number } = {}) {
    const plan = await planner.createPlan('PPL');
    const routine = await planner.createRoutine({ planId: plan.id, name: 'Push A' });
    await planner.addExercise(routine.id, { exerciseId: 'bench', nameSnapshot: 'Bench Press' });
    await planner.addExercise(routine.id, { exerciseId: 'row', nameSnapshot: 'Barbell Row' });

    const saved = planner.routineById(routine.id);
    if (saved) {
      await planner.saveRoutine(routine.id, {
        exercises: saved.exercises.map((exercise) => ({
          ...exercise,
          targetSets: options.sets ?? 3,
          warmupSets: options.warmups ?? 0,
          targetRepsMin: 8,
          targetRepsMax: 12,
          restSec: 90,
        })),
      });
    }

    return { plan, routineId: routine.id };
  }

  async function startSession(options: { sets?: number; warmups?: number } = {}) {
    const { routineId, plan } = await seedRoutine(options);
    const workoutId = await store.startFromRoutine(routineId, { facts, plan });
    return { workoutId, routineId };
  }

  /**
   * Replaces the whole injector, keeping the database and the clock.
   *
   * This is a *reload of the same tab*: `sessionStorage` survives it, so the
   * tab identity is unchanged and the session is still owned here. A second
   * tab is `anotherTab()` below.
   */
  async function reload(options: Parameters<typeof reopenIdb>[0] = {}) {
    await h.db.close();
    h = await reopenIdb({ clock: h.clock, ...options });
    return TestBed.inject(TrackerStore);
  }

  /** A different tab against the same database. */
  async function anotherTab(tabId = 'tab-2') {
    return reload({ providers: [{ provide: TAB_IDENTITY, useValue: { tabId } }] });
  }

  // ------------------------------------------------------------------ start

  describe('starting a session', () => {
    it('creates the workout, its exercises and its planned rows', async () => {
      const { workoutId } = await startSession({ sets: 3, warmups: 1 });

      expect(store.workout()?.id).toBe(workoutId);
      expect(store.workout()?.status).toBe('active');
      expect(store.cards()).toHaveLength(2);
      // One warm-up plus three working rows, for each of two exercises.
      expect(store.cards()[0]?.sets).toHaveLength(4);
      expect(store.cards()[0]?.sets[0]?.setType).toBe('warmup');
    });

    it('freezes the plan into a snapshot rather than referencing it', async () => {
      const { routineId, plan } = await seedRoutine();
      const revisionAtStart = planner.routineById(routineId)?.revision;
      await store.startFromRoutine(routineId, { facts, plan });

      // Structural edits after the fact must not reach back into history.
      await planner.saveRoutine(routineId, { name: 'Renamed After Starting' });
      await planner.addExercise(routineId, { exerciseId: 'row', nameSnapshot: 'Another' });

      expect(store.workout()?.planSnapshot?.routineName).toBe('Push A');
      expect(store.workout()?.planSnapshot?.routineRevision).toBe(revisionAtStart);
      expect(store.workout()?.name).toBe('Push A');
      expect(store.cards()).toHaveLength(2);
    });

    it('points appMeta at the session, so a cold start can find it', async () => {
      const { workoutId } = await startSession();
      const meta = TestBed.inject(APP_META_STORE);

      expect(await meta.get('activeWorkoutId')).toBe(workoutId);
    });

    it('refuses a second session while one is live', async () => {
      await startSession();
      const { routineId } = await seedRoutine();

      await expect(store.startFromRoutine(routineId, { facts })).rejects.toThrow(
        /already in progress/,
      );
    });

    it('clones structure but no loads when repeating a workout', async () => {
      await startSession({ sets: 2 });
      const first = store.cards()[0]?.sets[0];
      if (first) {
        store.editSet(first.id, { weightKg: 100, reps: 8 });
        await store.confirmSet(first.id);
      }
      const finished = await store.finish();

      await store.startFromWorkout(finished.workoutId);

      expect(store.cards()).toHaveLength(2);
      expect(store.cards()[0]?.sets.every((set) => set.weightKg === null)).toBe(true);
      expect(store.cards()[0]?.sets.every((set) => !set.isCompleted)).toBe(true);
      expect(store.workout()?.source).toBe('repeat');
    });
  });

  // --------------------------------------------------- 1. a confirmed set lives

  describe('a confirmed set survives a kill', () => {
    it('is still present and still committed after a reload', async () => {
      await startSession();
      const target = store.cards()[0]?.sets[0];
      if (!target) throw new Error('no row to confirm');

      store.editSet(target.id, { weightKg: 100, reps: 5 });
      await store.confirmSet(target.id);

      // The kill: a brand-new injector over the same database.
      const revived = await reload();
      expect(await revived.loadActive()).toBe(true);

      const recovered = revived.setById(target.id);
      expect(recovered?.isCompleted).toBe(true);
      expect(recovered?.weightKg).toBe(100);
      expect(recovered?.reps).toBe(5);
      expect(recovered?.completedAt).not.toBeNull();
      // Derived values are stored, not recomputed on read.
      expect(recovered?.volumeKg).toBe(500);
      expect(recovered?.e1rmKg).toBe(116.67);
    });

    it('never resumes on its own', async () => {
      await startSession();
      const revived = await reload();
      await revived.loadActive();

      expect(revived.awaitingResumeChoice()).toBe(true);
    });

    it('keeps the exercise rollups in step with the rows', async () => {
      await startSession();
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      for (const set of card.sets.slice(0, 2)) {
        store.editSet(set.id, { weightKg: 60, reps: 10 });
        await store.confirmSet(set.id);
      }

      const revived = await reload();
      await revived.loadActive();
      const exercise = revived.exerciseById(card.exercise.id);

      expect(exercise?.completedSetCount).toBe(2);
      expect(exercise?.volumeKg).toBe(1200);
    });

    it('clears a pointer that leads nowhere instead of trapping the user', async () => {
      const meta = TestBed.inject(APP_META_STORE);
      await meta.set('activeWorkoutId', 'does-not-exist');

      expect(await store.loadActive()).toBe(false);
      expect(await meta.get('activeWorkoutId')).toBeNull();
    });
  });

  // ------------------------------------------- 2. a draft survives a page hide

  describe('an unconfirmed draft', () => {
    it('is on disk after a flush, even though the row is not complete', async () => {
      await startSession();
      const target = store.cards()[0]?.sets[0];
      if (!target) throw new Error('no row');

      store.editSet(target.id, { weightKg: 42.5, reps: 7 });
      expect(store.hasPendingWrites()).toBe(true);

      // What `visibilitychange` and `pagehide` call. On iOS this is the last
      // hook before the page can be evicted.
      await store.flushPending();
      expect(store.hasPendingWrites()).toBe(false);

      const revived = await reload();
      await revived.loadActive();
      const recovered = revived.setById(target.id);

      expect(recovered?.weightKg).toBe(42.5);
      expect(recovered?.reps).toBe(7);
      expect(recovered?.isCompleted).toBe(false);
      expect(recovered?.completedAt).toBeNull();
    });

    it('is folded into the write when the set is confirmed before it flushes', async () => {
      await startSession();
      const target = store.cards()[0]?.sets[0];
      if (!target) throw new Error('no row');

      store.editSet(target.id, { weightKg: 80, reps: 6 });
      await store.confirmSet(target.id);

      const stored = await TestBed.inject(SET_LOGS_REPO).get(target.id);
      expect(stored).toMatchObject({ weightKg: 80, reps: 6, isCompleted: true });
      expect(store.hasPendingWrites()).toBe(false);
    });
  });

  // ------------------------------------ 3. a PR bug may not destroy a workout

  describe('finishing', () => {
    it('drops unlogged rows, counts them, and totals the rest', async () => {
      await startSession({ sets: 3 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      for (const set of card.sets.slice(0, 2)) {
        store.editSet(set.id, { weightKg: 100, reps: 5 });
        await store.confirmSet(set.id);
      }

      const result = await store.finish();

      // 1 remaining row on this exercise, plus all 3 on the untouched one.
      expect(result.droppedSetCount).toBe(4);
      expect(result.totals).toMatchObject({ totalSets: 2, totalReps: 10, totalVolumeKg: 1000 });

      const workout = await TestBed.inject(WORKOUTS_REPO).get(result.workoutId);
      expect(workout?.status).toBe('completed');
      expect(workout?.finishedAt).not.toBeNull();
      expect(workout?.totalVolumeKg).toBe(1000);

      const remaining = await TestBed.inject(SET_LOGS_REPO).list({
        index: 'by_workoutId',
        equals: result.workoutId,
      });
      expect(remaining).toHaveLength(2);
      expect(await TestBed.inject(APP_META_STORE).get('activeWorkoutId')).toBeNull();
    });

    it('rolls the whole transaction back when record detection throws', async () => {
      await startSession({ sets: 2 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      for (const set of card.sets) {
        store.editSet(set.id, { weightKg: 100, reps: 5 });
        await store.confirmSet(set.id);
      }
      const workoutId = store.workout()?.id;

      const exploding: PrDetector = {
        detect: () => Promise.reject(new Error('PR detection blew up')),
      };
      const broken = await reload({ providers: [{ provide: PR_DETECTOR, useValue: exploding }] });
      await broken.loadActive();
      await broken.acceptResume();

      await expect(broken.finish()).rejects.toThrow('PR detection blew up');

      // The point of the single transaction: the session is untouched.
      const workouts = TestBed.inject(WORKOUTS_REPO);
      const workout = await workouts.get(workoutId as string);
      expect(workout?.status).toBe('active');
      expect(workout?.finishedAt).toBeNull();

      const sets = await TestBed.inject(SET_LOGS_REPO).list({
        index: 'by_workoutId',
        equals: workoutId as string,
      });
      expect(sets.filter((set) => set.isCompleted)).toHaveLength(2);
      expect(await TestBed.inject(APP_META_STORE).get('activeWorkoutId')).toBe(workoutId);
    });

    it('reports the records a detector wrote', async () => {
      const detector: PrDetector = {
        detect: async (tx, context) => [
          await tx.repo('personalRecords').put({
            exerciseId: 'bench',
            variantKey: BENCH.variantKey,
            nameSnapshot: 'Bench Press',
            prType: 'maxWeight',
            value: 100,
            weightKg: 100,
            reps: 5,
            repBucket: null,
            isEstimate: false,
            formula: null,
            achievedAt: context.workout.finishedAt ?? context.workout.startedAt,
            workoutId: context.workout.id,
            setLogId: context.sets[0]?.id ?? '',
            previousValue: null,
            previousAchievedAt: null,
            isCurrent: 1,
          }),
        ],
      };

      await startSession({ sets: 1 });
      const first = store.cards()[0]?.sets[0];
      if (first) {
        store.editSet(first.id, { weightKg: 100, reps: 5 });
        await store.confirmSet(first.id);
      }

      const withDetector = await reload({
        providers: [{ provide: PR_DETECTOR, useValue: detector }],
      });
      await withDetector.loadActive();
      await withDetector.acceptResume();

      const result = await withDetector.finish();
      expect(result.records).toHaveLength(1);

      const workout = await TestBed.inject(WORKOUTS_REPO).get(result.workoutId);
      expect(workout?.prCount).toBe(1);
    });

    it('discards a session without leaving its sets in the record', async () => {
      await startSession();
      const first = store.cards()[0]?.sets[0];
      if (first) {
        store.editSet(first.id, { weightKg: 100, reps: 5 });
        await store.confirmSet(first.id);
      }
      const workoutId = store.workout()?.id as string;

      await store.discard('user-discarded');

      expect(store.hasSession()).toBe(false);
      expect(await TestBed.inject(APP_META_STORE).get('activeWorkoutId')).toBeNull();

      // Nothing from a discarded session may reach a chart or a record.
      const visibleSets = await TestBed.inject(SET_LOGS_REPO).list({
        index: 'by_workoutId',
        equals: workoutId,
      });
      expect(visibleSets).toHaveLength(0);

      // It is still recoverable, which is what the 30-day window needs.
      const tombstoned = await TestBed.inject(WORKOUTS_REPO).get(workoutId, {
        includeDeleted: true,
      });
      expect(tombstoned?.status).toBe('discarded');
      expect(tombstoned?.discardedReason).toBe('user-discarded');
    });
  });

  // -------------------------------------------- 4. time survives backgrounding

  describe('timers derived from timestamps', () => {
    it('is exact after ten minutes with no ticks at all', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      clock.advance(600_000);
      // Nothing ticked while the tab was suspended; this is what coming back
      // to the foreground does.
      store.syncClock();

      expect(store.elapsedSec()).toBe(600);
    });

    it('excludes paused time from a session resumed hours later', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      clock.advance(300_000); // 5 min training
      await store.pause();
      clock.advance(8 * 3600_000); // 8 h away
      await store.resumeSession();
      clock.advance(120_000); // 2 min more
      store.syncClock();

      expect(store.elapsedSec()).toBe(420);
      expect(store.workout()?.status).toBe('active');
    });

    it('counts an open pause as paused, not as training', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      clock.advance(60_000);
      await store.pause();
      clock.advance(3600_000);
      store.syncClock();

      expect(store.elapsedSec()).toBe(60);
      expect(store.isPaused()).toBe(true);
    });

    it('keeps a rest timer accurate across ten minutes in the background', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      store.startRest(180);
      expect(store.restRemainingSec()).toBe(180);

      clock.advance(60_000);
      store.syncClock();
      expect(store.restRemainingSec()).toBe(120);

      clock.advance(600_000);
      store.syncClock();
      expect(store.restRemainingSec()).toBe(0);
      expect(store.isResting()).toBe(false);
    });

    it('restores a running rest after a reload', async () => {
      await startSession();
      const clock = h.clock as FakeClock;
      store.startRest(180);
      await store.flushPending();

      clock.advance(30_000);
      const revived = await reload();
      await revived.loadActive();

      expect(revived.restRemainingSec()).toBe(150);
    });

    it('adjusts a rest without restarting it', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      store.startRest(90);
      clock.advance(30_000);
      store.adjustRest(15);
      store.syncClock();

      expect(store.restRemainingSec()).toBe(75);
    });
  });

  // ------------------------------------------------ 5. only one tab may write

  describe('a second tab', () => {
    it('observes read-only rather than racing the first', async () => {
      await startSession();
      const second = await anotherTab();

      await second.loadActive();

      expect(second.isReadOnly()).toBe(true);
      expect(second.cards()).toHaveLength(2);
    });

    it('does not mistake a reload of the same tab for a second tab', async () => {
      await startSession();
      const reloaded = await reload();

      await reloaded.loadActive();

      expect(reloaded.isReadOnly()).toBe(false);
    });

    it('refuses to write while read-only', async () => {
      await startSession();
      const target = store.cards()[0]?.sets[0];
      const second = await anotherTab();
      await second.loadActive();

      await second.confirmSet(target?.id as string);
      second.editSet(target?.id as string, { weightKg: 999 });
      await expect(second.finish()).rejects.toThrow(/another tab/);

      const stored = await TestBed.inject(SET_LOGS_REPO).get(target?.id as string);
      expect(stored?.isCompleted).toBe(false);
      expect(stored?.weightKg).toBeNull();
    });

    it('takes over once the owning tab stops reporting in', async () => {
      await startSession();
      const clock = h.clock as FakeClock;

      // No heartbeat for a minute means that tab is gone; refusing forever
      // would lock the user out of their own session after a crash.
      clock.advance(60_000);
      const second = await anotherTab('tab-3');
      await second.loadActive();

      expect(second.isReadOnly()).toBe(false);
    });
  });

  // --------------------------------------------- 6. a burst loses no writes

  describe('a burst of confirmations', () => {
    it('serialises 200 taps with no lost writes', async () => {
      const plan = await planner.createPlan('Volume');
      const routine = await planner.createRoutine({ planId: plan.id, name: 'Many' });
      await planner.addExercise(routine.id, { exerciseId: 'bench', nameSnapshot: 'Bench Press' });
      const seeded = planner.routineById(routine.id);
      if (seeded) {
        await planner.saveRoutine(routine.id, {
          exercises: seeded.exercises.map((exercise) => ({ ...exercise, targetSets: 200 })),
        });
      }

      const workoutId = await store.startFromRoutine(routine.id, { facts, plan });
      const ids = store.cards()[0]?.sets.map((set) => set.id) ?? [];
      expect(ids).toHaveLength(200);

      for (const id of ids) {
        store.editSet(id, { weightKg: 50, reps: 10 });
      }
      // Fired without awaiting, the way a fast thumb produces them.
      await Promise.all(ids.map((id) => store.confirmSet(id)));

      const stored = await TestBed.inject(SET_LOGS_REPO).list({
        index: 'by_workoutId',
        equals: workoutId,
      });
      expect(stored.filter((set) => set.isCompleted)).toHaveLength(200);

      const exercises = await TestBed.inject(WORKOUT_EXERCISES_REPO).list({
        index: 'by_workoutId',
        equals: workoutId,
      });
      // An interleaved rollup would under-count here.
      expect(exercises[0]?.completedSetCount).toBe(200);
      expect(exercises[0]?.volumeKg).toBe(100_000);
      // 200 serial transactions against fake-indexeddb is slower than the
      // default 5 s budget. The point of the test is correctness under a
      // burst, not speed; the latency guard is a separate test.
    }, 120_000);
  });

  // ------------------------------------------------------- rows and exercises

  describe('editing a session', () => {
    it('advances focus to the next pending row', async () => {
      await startSession({ sets: 3 });
      const card = store.cards()[0];
      const first = card?.sets[0];
      if (!card || !first) throw new Error('no card');

      expect(store.focusSetId()).toBe(first.id);
      await store.confirmSet(first.id);
      expect(store.focusSetId()).toBe(card.sets[1]?.id);
    });

    it('moves focus to the next exercise when one is finished', async () => {
      await startSession({ sets: 1 });
      const [first, second] = store.cards();
      if (!first || !second) throw new Error('need two cards');

      await store.confirmSet(first.sets[0]?.id as string);

      expect(store.focusSetId()).toBe(second.sets[0]?.id);
      expect(store.expandedId()).toBe(second.exercise.id);
    });

    it('alternates focus between superset partners', async () => {
      await startSession({ sets: 2 });
      const [first, second] = store.cards();
      if (!first || !second) throw new Error('need two cards');

      await store.groupExerciseWithNext(first.exercise.id);
      expect(store.cards()[0]?.exercise.supersetGroup).toBe('A');
      expect(store.cards()[1]?.exercise.supersetGroup).toBe('A');

      await store.confirmSet(first.sets[0]?.id as string);
      expect(store.focusSetId()).toBe(second.sets[0]?.id);

      await store.confirmSet(second.sets[0]?.id as string);
      expect(store.focusSetId()).toBe(first.sets[1]?.id);
    });

    it('appends a set prefilled from the last working one', async () => {
      await startSession({ sets: 1 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      store.editSet(card.sets[0]?.id as string, { weightKg: 75, reps: 9 });
      await store.flushPending();
      await store.addSet(card.exercise.id);

      const sets = store.cards()[0]?.sets ?? [];
      expect(sets).toHaveLength(2);
      expect(sets[1]).toMatchObject({ weightKg: 75, reps: 9, isCompleted: false });
      expect(sets[1]?.setIndex).toBe(1);
    });

    it('inserts a warm-up above the working sets and renumbers', async () => {
      await startSession({ sets: 2 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      store.editSet(card.sets[0]?.id as string, { weightKg: 100 });
      await store.flushPending();
      await store.addWarmup(card.exercise.id);

      const sets = store.cards()[0]?.sets ?? [];
      expect(sets.map((set) => set.setType)).toEqual(['warmup', 'working', 'working']);
      expect(sets.map((set) => set.setIndex)).toEqual([0, 1, 2]);
      expect(sets[0]?.weightKg).toBe(50);
    });

    it('restores a deleted row from the undo toast', async () => {
      await startSession({ sets: 2 });
      const card = store.cards()[0];
      const victim = card?.sets[1];
      if (!card || !victim) throw new Error('no row');

      await store.deleteSet(victim.id);
      expect(store.cards()[0]?.sets).toHaveLength(1);

      await store.restoreSet(victim.id);
      expect(store.cards()[0]?.sets).toHaveLength(2);
    });

    it('un-confirms a row without discarding what was typed', async () => {
      await startSession({ sets: 1 });
      const target = store.cards()[0]?.sets[0];
      if (!target) throw new Error('no row');

      store.editSet(target.id, { weightKg: 90, reps: 4 });
      await store.confirmSet(target.id);
      await store.unconfirmSet(target.id);

      const set = store.setById(target.id);
      expect(set?.isCompleted).toBe(false);
      expect(set?.weightKg).toBe(90);
      expect(set?.reps).toBe(4);
      expect(set?.volumeKg).toBeNull();
      expect(store.exerciseById(target.workoutExerciseId)?.completedSetCount).toBe(0);
    });

    it('keeps a skipped exercise visible but out of the count', async () => {
      await startSession({ sets: 1 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      await store.skipExercise(card.exercise.id, true);

      expect(store.cards()).toHaveLength(2);
      expect(store.exerciseCount()).toBe(1);
      expect(store.progress().planned).toBe(1);
    });

    it('adds an exercise mid-session with no plan target', async () => {
      await startSession({ sets: 1 });

      await store.addExercise(ROW);

      const added = store.cards().at(-1);
      expect(store.cards()).toHaveLength(3);
      expect(added?.exercise.targetSnapshot).toBeNull();
      expect(added?.exercise.routineExerciseUid).toBeNull();
      expect(added?.sets).toHaveLength(3);
    });

    it('attributes history to the exercise actually performed', async () => {
      await startSession({ sets: 1 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      await store.replaceExercise(card.exercise.id, ROW);

      const replaced = store.exerciseById(card.exercise.id);
      expect(replaced?.exerciseId).toBe('row');
      expect(replaced?.variantKey).toBe(ROW.variantKey);
      expect(replaced?.nameSnapshot).toBe('Barbell Row');
      // The old slot's target no longer describes what is being done.
      expect(replaced?.targetSnapshot).toBeNull();
      expect(store.cards()[0]?.sets.every((set) => set.exerciseId === 'row')).toBe(true);
    });

    it('dissolves a superset that a reorder pulled apart', async () => {
      await startSession({ sets: 1 });
      await store.addExercise(ROW);
      const cards = store.cards();
      await store.groupExerciseWithNext(cards[0]?.exercise.id as string);
      expect(store.cards()[0]?.exercise.supersetGroup).toBe('A');

      // Move the third exercise between the two grouped ones.
      await store.moveExercise(2, 1);

      expect(store.cards().map((card) => card.exercise.supersetGroup)).toEqual([null, null, null]);
    });

    it('switches tracking mode mid-session without touching the data', async () => {
      await startSession({ sets: 1 });

      await store.setTrackingMode('advanced');

      expect(store.isAdvanced()).toBe(true);
      expect(store.workout()?.trackingMode).toBe('advanced');
      expect(store.cards()[0]?.sets).toHaveLength(1);
    });
  });

  // -------------------------------------------------- previous performance

  describe('previous performance', () => {
    it('says nothing rather than something wrong when there is no history', async () => {
      await startSession({ sets: 1 });
      const card = store.cards()[0];

      expect(await store.previousFor(card?.exercise.id as string)).toBeNull();
    });

    it('reports the last session of the same variant', async () => {
      await startSession({ sets: 2 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      for (const set of card.sets) {
        store.editSet(set.id, { weightKg: 100, reps: 5 });
        await store.confirmSet(set.id);
      }
      await store.finish();

      (h.clock as FakeClock).advance(3 * 86_400_000);
      const { routineId, plan } = await seedRoutine({ sets: 2 });
      await store.startFromRoutine(routineId, { facts, plan });

      const previous = await store.previousFor(store.cards()[0]?.exercise.id as string);
      expect(previous?.sets).toHaveLength(2);
      expect(previous?.sets[0]).toMatchObject({ weightKg: 100, reps: 5 });
    });

    it('does not offer a different variant as previous performance', async () => {
      await startSession({ sets: 1 });
      const card = store.cards()[0];
      if (!card) throw new Error('no card');

      store.editSet(card.sets[0]?.id as string, { weightKg: 100, reps: 5 });
      await store.confirmSet(card.sets[0]?.id as string);
      await store.finish();

      (h.clock as FakeClock).advance(86_400_000);
      const { routineId, plan } = await seedRoutine({ sets: 1 });
      await store.startFromRoutine(routineId, {
        // Same exercise id, different equipment: not comparable.
        facts: (id) =>
          id === 'bench' ? { ...BENCH, variantKey: 'bench|dumbbell|bilateral' } : facts(id),
        plan,
      });

      expect(await store.previousFor(store.cards()[0]?.exercise.id as string)).toBeNull();
    });
  });

  // ------------------------------------------------------------- performance

  describe('confirm cost', () => {
    it('stays indexed with thousands of set logs on file', async () => {
      // An index-regression guard, not a latency measurement: the figure under
      // coverage instrumentation is several times the real one. What it catches
      // is a confirm that starts scanning the store instead of using
      // `by_workoutExerciseId`, which would grow with the seeded rows.
      const sets = TestBed.inject(SET_LOGS_REPO);
      const drafts = Array.from({ length: 5000 }, (_, index) => ({
        workoutId: `old-${Math.floor(index / 25)}`,
        workoutExerciseId: `old-we-${Math.floor(index / 5)}`,
        exerciseId: 'bench',
        variantKey: BENCH.variantKey,
        dayKey: '2026-01-01',
        setIndex: index % 5,
        setType: 'working' as const,
        side: 'both' as const,
        weightKg: 80,
        extraWeightKg: null,
        reps: 8,
        durationSec: null,
        distanceM: null,
        rpe: null,
        rir: null,
        isCompleted: true,
        isPr: false,
        completedAt: '2026-01-01T10:00:00.000Z',
        restTakenSec: null,
        e1rmKg: null,
        volumeKg: 640,
        notes: null,
      }));
      await sets.putMany(drafts);

      await startSession({ sets: 3 });
      const target = store.cards()[0]?.sets[0];
      if (!target) throw new Error('no row');

      const started = performance.now();
      await store.confirmSet(target.id);
      const elapsed = performance.now() - started;

      expect(store.setById(target.id)?.isCompleted).toBe(true);
      expect(elapsed).toBeLessThan(400);
    });
  });
});
