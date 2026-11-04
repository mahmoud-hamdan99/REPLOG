import { TestBed } from '@angular/core/testing';
import { APP_META_STORE } from '../../data/app-meta';
import { PLANS_REPO, ROUTINES_REPO, SET_LOGS_REPO, WORKOUTS_REPO } from '../../data/tokens';
import { RECOVERY_WINDOW_DAYS } from '../../domain/models/entity';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { HistoryStore } from '../history/history.store';
import { PlannerStore } from '../planner/planner.store';
import { BackupReminderStore } from './reminder.store';
import { RecentlyDeletedStore } from './recently-deleted.store';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The 30-day recovery list, and the reminder that asks people to export.
 *
 * Both exist for the same reason: this app keeps everything on one device and
 * offers no cloud, so an accidental delete and a cleared browser are the two
 * ways a training history actually dies.
 */
describe('RecentlyDeletedStore', () => {
  let h: IdbHarness;
  let store: RecentlyDeletedStore;

  beforeEach(async () => {
    h = await setupIdb();
    store = TestBed.inject(RecentlyDeletedStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  async function seedWorkout(name: string) {
    const workout = await TestBed.inject(WORKOUTS_REPO).put({
      name,
      status: 'completed',
      startedAt: '2026-11-01T17:00:00.000Z',
      endedAt: '2026-11-01T18:00:00.000Z',
      dayKey: '2026-11-01',
      planId: null,
      routineId: null,
      planSnapshot: null,
      bodyWeightKg: 80,
      totalVolumeKg: 1000,
      totalSets: 2,
      totalReps: 10,
      durationSec: 3600,
      notes: null,
      source: 'manual',
    } as never);

    for (const index of [0, 1]) {
      await TestBed.inject(SET_LOGS_REPO).put({
        workoutId: workout.id,
        workoutExerciseId: 'we-1',
        exerciseId: 'barbell-bench-press',
        variantKey: 'barbell-bench-press|barbell|bilateral',
        dayKey: '2026-11-01',
        setIndex: index,
        setType: 'working',
        side: 'both',
        weightKg: 100,
        extraWeightKg: null,
        reps: 5,
        durationSec: null,
        distanceM: null,
        rpe: null,
        rir: null,
        isCompleted: true,
        isPr: false,
        completedAt: '2026-11-01T17:30:00.000Z',
        restTakenSec: null,
        e1rmKg: 116.7,
        volumeKg: 500,
        notes: null,
      } as never);
    }

    return workout;
  }

  const liveSets = async () => (await TestBed.inject(SET_LOGS_REPO).list()).length;

  it('lists a deleted session once, not once per set', async () => {
    // The trap: a workout deletion tombstones its sets too, so a list built
    // from "every tombstone" would show one deleted session as three rows and
    // offer to restore a set whose workout is still gone.
    const workout = await seedWorkout('Push A');
    await TestBed.inject(HistoryStore).deleteWorkout(workout.id);

    await store.load();

    expect(store.items()).toHaveLength(1);
    expect(store.items()?.[0]).toMatchObject({ kind: 'workout', title: 'Push A' });
  });

  it('brings a session back with the sets that went down with it', async () => {
    const workout = await seedWorkout('Push A');
    await TestBed.inject(HistoryStore).deleteWorkout(workout.id);
    expect(await liveSets()).toBe(0);

    await store.load();
    await store.restore(store.items()![0]!);

    expect(await liveSets()).toBe(2);
    expect(store.items()).toEqual([]);
  });

  it('hides a record past the window and counts it as expired instead', async () => {
    const workout = await seedWorkout('Push A');
    await TestBed.inject(HistoryStore).deleteWorkout(workout.id);

    h.clock.advance((RECOVERY_WINDOW_DAYS + 1) * DAY_MS);
    await store.load();

    expect(store.items()).toEqual([]);
    expect(store.expiredCount()).toBeGreaterThan(0);
  });

  it('does not purge on its own', async () => {
    // Loading the screen must not delete anything: it is the one place in the
    // app whose whole purpose is that deletions are not yet final.
    const workout = await seedWorkout('Push A');
    await TestBed.inject(HistoryStore).deleteWorkout(workout.id);
    h.clock.advance((RECOVERY_WINDOW_DAYS + 1) * DAY_MS);

    await store.load();

    expect(
      await TestBed.inject(WORKOUTS_REPO).get(workout.id, { includeDeleted: true }),
    ).toBeDefined();
  });

  it('purges only what is past the window when asked', async () => {
    const old = await seedWorkout('Old');
    await TestBed.inject(HistoryStore).deleteWorkout(old.id);
    h.clock.advance((RECOVERY_WINDOW_DAYS + 1) * DAY_MS);

    const recent = await seedWorkout('Recent');
    await TestBed.inject(HistoryStore).deleteWorkout(recent.id);

    await store.purgeExpired();

    const workouts = TestBed.inject(WORKOUTS_REPO);
    expect(await workouts.get(old.id, { includeDeleted: true })).toBeUndefined();
    expect(await workouts.get(recent.id, { includeDeleted: true })).toBeDefined();
  });

  it('restores a plan with the routines its deletion took, and no others', async () => {
    const planner = TestBed.inject(PlannerStore);
    const plans = TestBed.inject(PLANS_REPO);
    const routines = TestBed.inject(ROUTINES_REPO);

    const plan = await plans.put({
      name: 'Upper/Lower',
      description: null,
      isActive: 1,
      orderIndex: 1000,
      weekCount: null,
      startDate: null,
      notes: null,
    } as never);

    const kept = await routines.put({
      planId: plan.id,
      name: 'Upper',
      orderIndex: 1000,
      weekdays: [],
      isArchived: 0,
      notes: null,
    } as never);
    const removedEarlier = await routines.put({
      planId: plan.id,
      name: 'Retired',
      orderIndex: 2000,
      weekdays: [],
      isArchived: 0,
      notes: null,
    } as never);

    // Deleted on its own, before the plan went. It must stay deleted.
    await routines.remove(removedEarlier.id);
    h.clock.advance(60_000);
    await planner.deletePlan(plan.id);

    await store.load();
    const planItem = store.items()!.find((item) => item.kind === 'plan');
    expect(planItem).toBeDefined();
    await store.restore(planItem!);

    expect((await routines.get(kept.id))?.deletedAt).toBeNull();
    expect(await routines.get(removedEarlier.id)).toBeUndefined();
  });
});

describe('BackupReminderStore', () => {
  let h: IdbHarness;
  let reminders: BackupReminderStore;

  beforeEach(async () => {
    h = await setupIdb();
    reminders = TestBed.inject(BackupReminderStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  async function seedCompletedWorkout(startedAt: string) {
    await TestBed.inject(WORKOUTS_REPO).put({
      name: 'Push A',
      status: 'completed',
      startedAt,
      endedAt: startedAt,
      dayKey: startedAt.slice(0, 10),
      planId: null,
      routineId: null,
      planSnapshot: null,
      bodyWeightKg: null,
      totalVolumeKg: 0,
      totalSets: 0,
      totalReps: 0,
      durationSec: 0,
      notes: null,
      source: 'manual',
    } as never);
  }

  it('says nothing on a device with no training', async () => {
    await reminders.check();

    expect(reminders.reminder()).toBeNull();
  });

  it('asks for a first export once there is a session to lose', async () => {
    await seedCompletedWorkout(h.clock.nowIso());

    await reminders.check();

    expect(reminders.reminder()?.reason).toBe('never-exported');
  });

  it('stays quiet when the last export is newer than the last session', async () => {
    await seedCompletedWorkout(h.clock.nowIso());
    h.clock.advance(60_000);
    await TestBed.inject(APP_META_STORE).set('lastExportAt', h.clock.nowIso());

    h.clock.advance(90 * DAY_MS);
    await reminders.check();

    expect(reminders.reminder()).toBeNull();
  });

  it('stays quiet for a week after a snooze, then asks again', async () => {
    await seedCompletedWorkout(h.clock.nowIso());

    await reminders.check();
    expect(reminders.reminder()).not.toBeNull();

    await reminders.snooze();
    await reminders.check();
    expect(reminders.reminder()).toBeNull();

    h.clock.advance(8 * DAY_MS);
    await reminders.check();
    expect(reminders.reminder()).not.toBeNull();
  });
});
