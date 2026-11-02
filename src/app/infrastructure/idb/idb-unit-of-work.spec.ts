import 'fake-indexeddb/auto';

import { setLogDraft, setupIdb, type IdbHarness } from './testing/idb-test-kit';

const workoutDraft = (overrides: Record<string, unknown> = {}) => ({
  status: 'completed',
  startedAt: '2026-03-02T18:00:00.000Z',
  finishedAt: '2026-03-02T19:00:00.000Z',
  dayKey: '2026-03-02',
  name: 'Push A',
  planId: null,
  routineId: null,
  planSnapshot: null,
  source: 'quick',
  pauses: [],
  durationSec: 3600,
  totalVolumeKg: 5000,
  totalSets: 12,
  totalReps: 60,
  exerciseCount: 4,
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
  ...overrides,
});

describe('IdbUnitOfWork', () => {
  let h: IdbHarness;

  beforeEach(async () => {
    h = await setupIdb();
  });

  afterEach(async () => {
    await h.dispose();
  });

  it('commits writes across several stores', async () => {
    await h.uow.run(['workouts', 'setLogs'], 'readwrite', async (tx) => {
      const workout = await tx.repo('workouts').put(workoutDraft() as never);
      await tx.repo('setLogs').put(setLogDraft({ workoutId: workout.id }) as never);
    });

    expect(await h.repo('workouts').count()).toBe(1);
    expect(await h.repo('setLogs').count()).toBe(1);
  });

  /**
   * The contract the finish-workout flow depends on: personal-record detection
   * runs in the same transaction as the session itself, so a bug there may
   * never destroy a logged workout. If this test fails, that guarantee is gone.
   */
  it('rolls back every store when the work throws', async () => {
    const boom = new Error('PR detection failed');

    await expect(
      h.uow.run(['workouts', 'setLogs', 'personalRecords'], 'readwrite', async (tx) => {
        await tx.repo('workouts').put(workoutDraft() as never);
        await tx.repo('setLogs').put(setLogDraft() as never);
        throw boom;
      }),
    ).rejects.toThrow('PR detection failed');

    expect(await h.repo('workouts').count({ includeDeleted: true })).toBe(0);
    expect(await h.repo('setLogs').count({ includeDeleted: true })).toBe(0);
    expect(await h.repo('personalRecords').count({ includeDeleted: true })).toBe(0);
  });

  it('leaves earlier committed transactions untouched when a later one fails', async () => {
    await h.uow.run(['workouts'], 'readwrite', async (tx) => {
      await tx.repo('workouts').put(workoutDraft({ name: 'Kept' }) as never);
    });

    await expect(
      h.uow.run(['workouts'], 'readwrite', async (tx) => {
        await tx.repo('workouts').put(workoutDraft({ name: 'Discarded' }) as never);
        throw new Error('nope');
      }),
    ).rejects.toThrow();

    const remaining = await h.repo('workouts').list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe('Kept');
  });

  describe('commit hooks', () => {
    it('runs them after the transaction commits, in registration order', async () => {
      const order: string[] = [];

      await h.uow.run(['workouts'], 'readwrite', async (tx) => {
        tx.onCommit(() => order.push('first'));
        tx.onCommit(() => order.push('second'));
        await tx.repo('workouts').put(workoutDraft() as never);
        order.push('work');
      });

      expect(order).toEqual(['work', 'first', 'second']);
    });

    it('does not run them when the transaction rolls back', async () => {
      const hooks: string[] = [];

      await expect(
        h.uow.run(['workouts'], 'readwrite', async (tx) => {
          tx.onCommit(() => hooks.push('should not run'));
          await tx.repo('workouts').put(workoutDraft() as never);
          throw new Error('rollback');
        }),
      ).rejects.toThrow();

      expect(hooks).toEqual([]);
    });
  });

  describe('change notification', () => {
    it('holds notifications until the commit', async () => {
      await h.uow.run(['workouts', 'setLogs'], 'readwrite', async (tx) => {
        await tx.repo('workouts').put(workoutDraft() as never);
        await tx.repo('setLogs').put(setLogDraft() as never);
        // Nothing announced yet: the transaction can still roll back.
        expect(h.changes).toHaveLength(0);
      });

      expect(h.changes.map((c) => c.store)).toEqual(['workouts', 'setLogs']);
    });

    /**
     * Announcing a change that then rolled back would leave every subscriber
     * showing a record that does not exist.
     */
    it('announces nothing when the transaction rolls back', async () => {
      await expect(
        h.uow.run(['workouts'], 'readwrite', async (tx) => {
          await tx.repo('workouts').put(workoutDraft() as never);
          throw new Error('rollback');
        }),
      ).rejects.toThrow();

      expect(h.changes).toEqual([]);
    });
  });

  it('refuses a store that was not declared up front', async () => {
    // IndexedDB scopes a transaction at creation; this surfaces the mistake
    // immediately rather than at some later line.
    await expect(
      h.uow.run(['workouts'], 'readwrite', async (tx) => {
        await tx.repo('setLogs').put(setLogDraft() as never);
      }),
    ).rejects.toThrow();
  });

  it('returns the value produced by the work', async () => {
    const result = await h.uow.run(['workouts'], 'readwrite', async (tx) => {
      const workout = await tx.repo('workouts').put(workoutDraft() as never);
      return workout.id;
    });

    expect(typeof result).toBe('string');
    expect(await h.repo('workouts').get(result)).toBeDefined();
  });
});
