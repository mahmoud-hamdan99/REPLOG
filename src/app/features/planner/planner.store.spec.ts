import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { ROUTINES_REPO, WORKOUTS_REPO } from '../../data/tokens';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { PlannerStore } from './planner.store';

/**
 * Against the real storage stack: duplication and deletion span two stores in
 * one transaction, which an in-memory double could not meaningfully exercise.
 */
describe('PlannerStore', () => {
  let h: IdbHarness;
  let store: PlannerStore;

  beforeEach(async () => {
    h = await setupIdb();
    store = TestBed.inject(PlannerStore);
    await store.load();
  });

  afterEach(async () => {
    await h.dispose();
  });

  async function seedPlan(name = 'PPL') {
    const plan = await store.createPlan(name);
    const push = await store.createRoutine({ planId: plan.id, name: 'Push A' });
    const pull = await store.createRoutine({ planId: plan.id, name: 'Pull A' });
    await store.addExercise(push.id, { exerciseId: 'bench', nameSnapshot: 'Bench Press' });
    await store.addExercise(push.id, { exerciseId: 'dips', nameSnapshot: 'Dips' });
    await store.addExercise(pull.id, { exerciseId: 'row', nameSnapshot: 'Row' });
    return { plan, push, pull };
  }

  describe('plans', () => {
    it('creates a plan and makes the first one active', async () => {
      const plan = await store.createPlan('PPL');

      expect(store.livePlans()).toHaveLength(1);
      expect(store.activePlanId()).toBe(plan.id);
      expect(store.activePlan()?.name).toBe('PPL');
    });

    it('does not steal the active slot from an existing plan', async () => {
      const first = await store.createPlan('First');
      await store.createPlan('Second');
      expect(store.activePlanId()).toBe(first.id);
    });

    it('archives a plan and clears it as active', async () => {
      const plan = await store.createPlan('PPL');
      await store.setPlanArchived(plan.id, true);

      expect(store.livePlans()).toHaveLength(0);
      expect(store.archivedPlans()).toHaveLength(1);
      expect(store.activePlanId()).toBeNull();
    });

    it('restores an archived plan', async () => {
      const plan = await store.createPlan('PPL');
      await store.setPlanArchived(plan.id, true);
      await store.setPlanArchived(plan.id, false);
      expect(store.livePlans()).toHaveLength(1);
    });

    it('reorders plans with a single write per move', async () => {
      const a = await store.createPlan('A');
      const b = await store.createPlan('B');
      const c = await store.createPlan('C');
      const revsBefore = store.livePlans().map((p) => p.rev);

      await store.movePlan(2, 0);
      await store.load({ force: true });

      expect(store.livePlans().map((p) => p.id)).toEqual([c.id, a.id, b.id]);
      // Only the moved plan was written; the others keep their revision.
      const moved = store.planById(c.id);
      expect(moved?.rev).toBe((revsBefore[2] ?? 0) + 1);
      expect(store.planById(a.id)?.rev).toBe(revsBefore[0]);
      expect(store.planById(b.id)?.rev).toBe(revsBefore[1]);
    });
  });

  describe('duplication', () => {
    /**
     * The acceptance criterion: mutate the copy, then re-read the original and
     * find it untouched. A copy sharing ids would fail here, not at creation.
     */
    it('produces a fully independent copy', async () => {
      const { plan, push } = await seedPlan();
      const copy = await store.duplicatePlanById(plan.id, 'PPL copy');
      expect(copy).toBeDefined();

      const copiedRoutines = store.routinesForPlan(copy!.id);
      expect(copiedRoutines).toHaveLength(2);

      // Mutate the copy thoroughly.
      const copiedPush = copiedRoutines.find((r) => r.name === 'Push A');
      await store.addExercise(copiedPush!.id, { exerciseId: 'fly', nameSnapshot: 'Fly' });
      await store.saveRoutine(copiedPush!.id, { name: 'Changed' });
      await store.updatePlan(copy!.id, { name: 'Changed plan' });

      await store.load({ force: true });

      // The original is exactly as it was.
      expect(store.planById(plan.id)?.name).toBe('PPL');
      const originalPush = store.routineById(push.id);
      expect(originalPush?.name).toBe('Push A');
      expect(originalPush?.exercises).toHaveLength(2);
    });

    it('shares no identifiers with the original', async () => {
      const { plan } = await seedPlan();
      const copy = await store.duplicatePlanById(plan.id, 'Copy');

      const originalIds = store.routinesForPlan(plan.id).map((r) => r.id);
      const copyIds = store.routinesForPlan(copy!.id).map((r) => r.id);
      expect(copyIds.some((id) => originalIds.includes(id))).toBe(false);

      const originalUids = store
        .routinesForPlan(plan.id)
        .flatMap((r) => r.exercises.map((e) => e.uid));
      const copyUids = store
        .routinesForPlan(copy!.id)
        .flatMap((r) => r.exercises.map((e) => e.uid));
      expect(copyUids.some((uid) => originalUids.includes(uid))).toBe(false);
    });

    it('duplicates a single routine without its weekday slots', async () => {
      const { push } = await seedPlan();
      await store.setWeekdays(push.id, [1, 4]);

      const copy = await store.duplicateRoutineById(push.id, 'Push A copy');

      expect(copy?.weekdays).toEqual([]);
      expect(copy?.exercises).toHaveLength(2);
      expect(store.routineById(push.id)?.weekdays).toEqual([1, 4]);
    });
  });

  describe('scheduling', () => {
    it('shows a routine on every weekday it is assigned to', async () => {
      const { push } = await seedPlan();
      await store.setWeekdays(push.id, [1, 4]);

      expect(store.routinesOnWeekday(1).map((r) => r.id)).toContain(push.id);
      expect(store.routinesOnWeekday(4).map((r) => r.id)).toContain(push.id);
      expect(store.routinesOnWeekday(2)).toEqual([]);
    });

    it('keeps weekdays sorted regardless of selection order', async () => {
      const { push } = await seedPlan();
      await store.setWeekdays(push.id, [4, 1, 6]);
      expect(store.routineById(push.id)?.weekdays).toEqual([1, 4, 6]);
    });

    it('creates a standalone flexible routine with no plan', async () => {
      const flexible = await store.createRoutine({ planId: null, name: 'Arms' });

      expect(flexible.planId).toBeNull();
      expect(flexible.scheduleType).toBe('flexible');
      expect(store.flexibleRoutines().map((r) => r.id)).toContain(flexible.id);
      // A flexible routine is never scheduled onto a weekday.
      expect(store.routinesOnWeekday(1).map((r) => r.id)).not.toContain(flexible.id);
    });
  });

  describe('revisions', () => {
    it('bumps for a structural change', async () => {
      const { push } = await seedPlan();
      const before = store.routineById(push.id)?.revision ?? 0;

      await store.addExercise(push.id, { exerciseId: 'x', nameSnapshot: 'X' });

      expect(store.routineById(push.id)?.revision).toBe(before + 1);
    });

    it('does not bump for a rename', async () => {
      const { push } = await seedPlan();
      const before = store.routineById(push.id)?.revision ?? 0;

      await store.saveRoutine(push.id, { name: 'Push B' });

      expect(store.routineById(push.id)?.name).toBe('Push B');
      expect(store.routineById(push.id)?.revision).toBe(before);
    });

    it('bumps when weekdays change', async () => {
      const { push } = await seedPlan();
      const before = store.routineById(push.id)?.revision ?? 0;
      await store.setWeekdays(push.id, [2]);
      expect(store.routineById(push.id)?.revision).toBe(before + 1);
    });
  });

  describe('routine exercises', () => {
    it('adds, reorders and removes', async () => {
      const { push } = await seedPlan();
      await store.addExercise(push.id, { exerciseId: 'fly', nameSnapshot: 'Fly' });
      expect(store.routineById(push.id)?.exercises.map((e) => e.exerciseId)).toEqual([
        'bench',
        'dips',
        'fly',
      ]);

      await store.moveExercise(push.id, 2, 0);
      expect(store.routineById(push.id)?.exercises.map((e) => e.exerciseId)).toEqual([
        'fly',
        'bench',
        'dips',
      ]);

      const uid = store.routineById(push.id)!.exercises[1]!.uid;
      await store.removeRoutineExercise(push.id, uid);
      expect(store.routineById(push.id)?.exercises.map((e) => e.exerciseId)).toEqual([
        'fly',
        'dips',
      ]);
    });

    it('survives a reload', async () => {
      const { push } = await seedPlan();
      await store.moveExercise(push.id, 1, 0);
      const expected = store.routineById(push.id)!.exercises.map((e) => e.exerciseId);

      await store.load({ force: true });

      expect(store.routineById(push.id)?.exercises.map((e) => e.exerciseId)).toEqual(expected);
    });

    it('configures targets', async () => {
      const { push } = await seedPlan();
      const uid = store.routineById(push.id)!.exercises[0]!.uid;

      await store.configureExercise(push.id, uid, {
        targetSets: 5,
        targetRepsMin: 3,
        targetRepsMax: 5,
        restSec: 180,
      });

      const configured = store.routineById(push.id)!.exercises[0];
      expect(configured?.targetSets).toBe(5);
      expect(configured?.restSec).toBe(180);
    });

    it('groups and ungroups a superset', async () => {
      const { push } = await seedPlan();
      const first = store.routineById(push.id)!.exercises[0]!.uid;

      await store.groupExerciseWithNext(push.id, first);
      expect(store.routineById(push.id)?.exercises.map((e) => e.supersetGroup)).toEqual(['A', 'A']);

      await store.ungroupExercise(push.id, first);
      expect(store.routineById(push.id)?.exercises.every((e) => e.supersetGroup === null)).toBe(
        true,
      );
    });

    it('recomputes the duration estimate on save', async () => {
      const { push } = await seedPlan();
      const estimate = store.routineById(push.id)?.estimatedDurationMin;
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('deletion', () => {
    it('allows deleting a plan that has never been trained', async () => {
      const { plan } = await seedPlan();
      expect(await store.canDeletePlan(plan.id)).toBe(true);

      await store.deletePlan(plan.id);
      expect(store.livePlans()).toHaveLength(0);
      expect(store.routinesForPlan(plan.id)).toEqual([]);
    });

    /**
     * History renders from snapshots so deleting cannot corrupt it, but a plan
     * the user has actually trained is worth keeping; archiving is offered.
     */
    it('refuses to delete a plan with recorded workouts', async () => {
      const { plan, push } = await seedPlan();

      await TestBed.inject(WORKOUTS_REPO).put({
        status: 'completed',
        startedAt: '2026-03-02T18:00:00.000Z',
        finishedAt: '2026-03-02T19:00:00.000Z',
        dayKey: '2026-03-02',
        name: 'Push A',
        planId: plan.id,
        routineId: push.id,
        planSnapshot: null,
        source: 'routine',
        pauses: [],
        durationSec: 3600,
        totalVolumeKg: 0,
        totalSets: 0,
        totalReps: 0,
        exerciseCount: 2,
        bodyWeightKg: null,
        notes: null,
        perceivedEffort: null,
        feeling: null,
        prCount: 0,
        trackingMode: 'simple',
        tabId: null,
        heartbeatAt: null,
        discardedReason: null,
        editedAt: null,
      } as never);

      expect(await store.canDeletePlan(plan.id)).toBe(false);
    });

    it('removes the plan and its routines together', async () => {
      const { plan } = await seedPlan();
      await store.deletePlan(plan.id);

      const remaining = await TestBed.inject(ROUTINES_REPO).count();
      expect(remaining).toBe(0);
    });
  });

  /**
   * PRODUCT_SPEC section 4.6: editing a template must never silently modify
   * recorded history. The workout keeps its own snapshot, so an edit to the
   * routine it came from leaves it untouched.
   */
  it('editing a routine does not alter an existing workout record', async () => {
    const { plan, push } = await seedPlan();
    const workouts = TestBed.inject(WORKOUTS_REPO);

    const workout = await workouts.put({
      status: 'completed',
      startedAt: '2026-03-02T18:00:00.000Z',
      finishedAt: '2026-03-02T19:00:00.000Z',
      dayKey: '2026-03-02',
      name: 'Push A',
      planId: plan.id,
      routineId: push.id,
      planSnapshot: {
        planId: plan.id,
        planName: 'PPL',
        routineId: push.id,
        routineName: 'Push A',
        routineRevision: 1,
        scheduleType: 'scheduled',
      },
      source: 'routine',
      pauses: [],
      durationSec: 3600,
      totalVolumeKg: 5000,
      totalSets: 6,
      totalReps: 30,
      exerciseCount: 2,
      bodyWeightKg: 82,
      notes: null,
      perceivedEffort: null,
      feeling: null,
      prCount: 0,
      trackingMode: 'simple',
      tabId: null,
      heartbeatAt: null,
      discardedReason: null,
      editedAt: null,
    } as never);

    // Rework the routine completely.
    await store.saveRoutine(push.id, { name: 'Totally Different' });
    await store.addExercise(push.id, { exerciseId: 'new', nameSnapshot: 'New' });
    await store.setWeekdays(push.id, [3]);

    const reread = await workouts.get(workout.id);
    expect(reread?.name).toBe('Push A');
    expect(reread?.planSnapshot?.routineName).toBe('Push A');
    expect(reread?.planSnapshot?.routineRevision).toBe(1);
    expect(reread?.exerciseCount).toBe(2);
    expect(reread?.rev).toBe(workout.rev);
  });

  it('builds a plan with four routines and twenty-four exercises intact', async () => {
    const plan = await store.createPlan('Big');
    for (let r = 0; r < 4; r += 1) {
      const routine = await store.createRoutine({ planId: plan.id, name: `Day ${r + 1}` });
      for (let e = 0; e < 6; e += 1) {
        await store.addExercise(routine.id, {
          exerciseId: `ex-${r}-${e}`,
          nameSnapshot: `Exercise ${r}-${e}`,
        });
      }
    }

    await store.load({ force: true });

    const routines = store.routinesForPlan(plan.id);
    expect(routines).toHaveLength(4);
    expect(routines.flatMap((r) => r.exercises)).toHaveLength(24);

    const copy = await store.duplicatePlanById(plan.id, 'Big copy');
    expect(store.routinesForPlan(copy!.id).flatMap((r) => r.exercises)).toHaveLength(24);

    await store.setPlanArchived(plan.id, true);
    expect(store.archivedPlans().map((p) => p.id)).toContain(plan.id);
    // Archiving loses nothing.
    expect(store.routinesForPlan(plan.id).flatMap((r) => r.exercises)).toHaveLength(24);
  });
});
