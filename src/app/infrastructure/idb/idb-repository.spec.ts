import 'fake-indexeddb/auto';

import type { Exercise } from '../../domain/models';
import { exerciseDraft, setLogDraft, setupIdb, type IdbHarness } from './testing/idb-test-kit';

describe('IdbRepository', () => {
  let h: IdbHarness;

  beforeEach(async () => {
    h = await setupIdb();
  });

  afterEach(async () => {
    await h.dispose();
  });

  describe('envelope stamping', () => {
    it('generates a sortable id and a complete envelope', async () => {
      const record = await h.repo('exercises').put(exerciseDraft() as never);

      expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.createdAt).toBe(h.clock.nowIso());
      expect(record.updatedAt).toBe(record.createdAt);
      expect(record.deletedAt).toBeNull();
      expect(record.rev).toBe(1);
      expect(record.origin).toBe('test-device');
    });

    it('preserves createdAt and increments rev when replacing', async () => {
      const repo = h.repo('exercises');
      const first = await repo.put(exerciseDraft() as never);

      h.clock.advance(60_000);
      const second = await repo.put({ ...exerciseDraft(), id: first.id } as never);

      expect(second.id).toBe(first.id);
      expect(second.createdAt).toBe(first.createdAt);
      expect(second.updatedAt).not.toBe(first.updatedAt);
      expect(second.rev).toBe(2);
    });

    it('ignores a caller-supplied rev rather than trusting it', async () => {
      const repo = h.repo('exercises');
      const record = await repo.put({ ...exerciseDraft(), rev: 99 } as never);
      expect(record.rev).toBe(1);
    });

    it('patch preserves createdAt and bumps rev', async () => {
      const repo = h.repo('exercises');
      const created = await repo.put(exerciseDraft() as never);

      h.clock.advance(5_000);
      const patched = await repo.patch(created.id, { isFavorite: true } as never);

      expect(patched.isFavorite).toBe(true);
      expect(patched.nameEn).toBe('Bench Press');
      expect(patched.createdAt).toBe(created.createdAt);
      expect(patched.rev).toBe(2);
    });

    it('patch rejects a missing record instead of creating one', async () => {
      await expect(h.repo('exercises').patch('nope', {} as never)).rejects.toThrow();
      expect(await h.repo('exercises').count()).toBe(0);
    });
  });

  describe('soft delete', () => {
    it('tombstones rather than destroying, and hides the record by default', async () => {
      const repo = h.repo('exercises');
      const created = await repo.put(exerciseDraft() as never);

      await repo.remove(created.id);

      expect(await repo.get(created.id)).toBeUndefined();
      expect(await repo.list()).toEqual([]);
      expect(await repo.count()).toBe(0);

      const tombstoned = await repo.get(created.id, { includeDeleted: true });
      expect(tombstoned?.deletedAt).toBe(h.clock.nowIso());
      expect(tombstoned?.rev).toBe(2);
    });

    it('removing twice is not an error and does not re-stamp', async () => {
      const repo = h.repo('exercises');
      const created = await repo.put(exerciseDraft() as never);

      await repo.remove(created.id);
      const afterFirst = await repo.get(created.id, { includeDeleted: true });
      h.clock.advance(1000);
      await repo.remove(created.id);
      const afterSecond = await repo.get(created.id, { includeDeleted: true });

      expect(afterSecond?.deletedAt).toBe(afterFirst?.deletedAt);
      expect(afterSecond?.rev).toBe(afterFirst?.rev);
    });

    it('hard delete destroys the record entirely', async () => {
      const repo = h.repo('exercises');
      const created = await repo.put(exerciseDraft() as never);

      await repo.remove(created.id, { hard: true });

      expect(await repo.get(created.id, { includeDeleted: true })).toBeUndefined();
    });

    it('removing an absent record is a no-op', async () => {
      await expect(h.repo('exercises').remove('nope')).resolves.toBeUndefined();
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await h
        .repo('exercises')
        .putMany([
          exerciseDraft({ nameNormEn: 'a squat', equipment: 'barbell' }),
          exerciseDraft({ nameNormEn: 'b curl', equipment: 'dumbbell' }),
          exerciseDraft({ nameNormEn: 'c row', equipment: 'barbell' }),
          exerciseDraft({ nameNormEn: 'd press', equipment: 'machine' }),
        ] as never);
    });

    it('filters by an index with an exact key', async () => {
      const barbell = await h.repo('exercises').list({
        index: 'by_equipment',
        equals: 'barbell',
      });
      expect(barbell).toHaveLength(2);
      expect(barbell.every((e) => (e as Exercise).equipment === 'barbell')).toBe(true);
    });

    it('orders by an index and honours reverse direction', async () => {
      const repo = h.repo('exercises');
      const ascending = await repo.list({ index: 'by_nameNorm' });
      const descending = await repo.list({ index: 'by_nameNorm', direction: 'prev' });

      expect(ascending.map((e) => (e as Exercise).nameNormEn)).toEqual([
        'a squat',
        'b curl',
        'c row',
        'd press',
      ]);
      expect(descending.map((e) => (e as Exercise).nameNormEn)).toEqual([
        'd press',
        'c row',
        'b curl',
        'a squat',
      ]);
    });

    it('supports a bounded range on a compound index', async () => {
      // The default library listing: live exercises, alphabetical.
      const live = await h.repo('exercises').list({
        index: 'by_isArchived_nameNorm',
        range: { lower: [0, ''], upper: [0, '￿'] },
      });
      expect(live).toHaveLength(4);
    });

    it('excludes archived rows from the live range', async () => {
      await h
        .repo('exercises')
        .putMany([exerciseDraft({ nameNormEn: 'e dead', isArchived: 1 })] as never);

      const live = await h.repo('exercises').list({
        index: 'by_isArchived_nameNorm',
        range: { lower: [0, ''], upper: [0, '￿'] },
      });
      expect(live).toHaveLength(4);
      expect(await h.repo('exercises').count()).toBe(5);
    });

    /**
     * Offset must be applied after the soft-delete filter, or a page of results
     * would be a page with tombstone-shaped holes punched in it.
     */
    it('applies offset and limit to live records only', async () => {
      const repo = h.repo('exercises');
      const all = await repo.list({ index: 'by_nameNorm' });
      await repo.remove((all[1] as Exercise).id);

      const page = await repo.list({ index: 'by_nameNorm', offset: 1, limit: 2 });
      expect(page.map((e) => (e as Exercise).nameNormEn)).toEqual(['c row', 'd press']);
    });

    it('count ignores paging but respects the soft-delete filter', async () => {
      const repo = h.repo('exercises');
      const all = await repo.list();
      await repo.remove((all[0] as Exercise).id);

      expect(await repo.count({ limit: 1 })).toBe(3);
      expect(await repo.count({ includeDeleted: true })).toBe(4);
    });

    it('omits records whose index key is null, as IndexedDB does', async () => {
      // An uncompleted set has a null completedAt and is therefore absent from
      // the progression index — exactly what a progression chart wants.
      await h
        .repo('setLogs')
        .putMany([
          setLogDraft({ completedAt: '2026-03-02T18:00:00.000Z' }),
          setLogDraft({ completedAt: null, isCompleted: false }),
        ] as never);

      const completed = await h.repo('setLogs').list({ index: 'by_exerciseId_completedAt' });
      expect(completed).toHaveLength(1);
      expect(await h.repo('setLogs').count()).toBe(2);
    });
  });

  describe('bulk operations', () => {
    it('putMany stamps every record and returns them in order', async () => {
      const records = await h
        .repo('exercises')
        .putMany([
          exerciseDraft({ nameNormEn: 'one' }),
          exerciseDraft({ nameNormEn: 'two' }),
        ] as never);

      expect(records).toHaveLength(2);
      expect(new Set(records.map((r) => r.id)).size).toBe(2);
      expect(records.every((r) => r.rev === 1)).toBe(true);
    });

    it('putMany with an empty list touches nothing', async () => {
      expect(await h.repo('exercises').putMany([])).toEqual([]);
      expect(h.changes).toHaveLength(0);
    });

    it('clear removes everything, tombstones included', async () => {
      const repo = h.repo('exercises');
      await repo.putMany([exerciseDraft(), exerciseDraft()] as never);
      await repo.clear();
      expect(await repo.count({ includeDeleted: true })).toBe(0);
    });
  });

  describe('change notification', () => {
    it('announces writes with the store and ids', async () => {
      const record = await h.repo('exercises').put(exerciseDraft() as never);

      expect(h.changes).toEqual([
        { store: 'exercises', ids: [record.id], kind: 'put', local: true },
      ]);
    });

    it('distinguishes a removal from a write', async () => {
      const repo = h.repo('exercises');
      const record = await repo.put(exerciseDraft() as never);
      h.changes.length = 0;

      await repo.remove(record.id);
      expect(h.changes[0]).toMatchObject({ kind: 'remove', ids: [record.id] });
    });
  });
});
