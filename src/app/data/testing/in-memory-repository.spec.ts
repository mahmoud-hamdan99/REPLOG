import type { Entity } from '../../domain/models/entity';
import { InMemoryRepository } from './in-memory-repository';

interface Widget extends Entity {
  name: string;
  group: string;
  rank: number;
}

const draft = (name: string, group = 'a', rank = 0) => ({ name, group, rank });

function makeRepo() {
  let tick = 0;
  return new InMemoryRepository<Widget>({
    indexes: {
      by_group: (w) => w.group,
      by_group_rank: (w) => [w.group, w.rank],
      by_rank: (w) => w.rank,
      by_optional: (w) => (w.rank === 0 ? null : w.rank),
    },
    nowIso: () => new Date(Date.UTC(2026, 2, 2, 18, 0, tick++)).toISOString(),
  });
}

/**
 * The double exists so stores can be tested without IndexedDB. That is only
 * safe if it behaves like the real repository on the semantics callers depend
 * on, so these mirror the assertions in idb-repository.spec.ts.
 */
describe('InMemoryRepository', () => {
  it('stamps a complete envelope', async () => {
    const repo = makeRepo();
    const record = await repo.put(draft('one'));

    expect(record.id).toBeTruthy();
    expect(record.rev).toBe(1);
    expect(record.deletedAt).toBeNull();
    expect(record.origin).toBe('test-device');
    expect(record.createdAt).toBe(record.updatedAt);
  });

  it('preserves createdAt and increments rev on replace', async () => {
    const repo = makeRepo();
    const first = await repo.put(draft('one'));
    const second = await repo.put({ ...draft('renamed'), id: first.id });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.rev).toBe(2);
    expect(second.name).toBe('renamed');
  });

  it('hides tombstoned records from get, list and count', async () => {
    const repo = makeRepo();
    const record = await repo.put(draft('one'));
    await repo.remove(record.id);

    expect(await repo.get(record.id)).toBeUndefined();
    expect(await repo.list()).toEqual([]);
    expect(await repo.count()).toBe(0);
    expect(await repo.get(record.id, { includeDeleted: true })).toBeDefined();
    // The record is tombstoned, not destroyed.
    expect(repo.snapshot()).toHaveLength(1);
  });

  it('hard delete destroys the record', async () => {
    const repo = makeRepo();
    const record = await repo.put(draft('one'));
    await repo.remove(record.id, { hard: true });
    expect(repo.snapshot()).toEqual([]);
  });

  it('patch rejects a missing record', async () => {
    await expect(makeRepo().patch('nope', { name: 'x' })).rejects.toThrow();
  });

  describe('queries', () => {
    it('filters by an index with an exact key', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('a', 'x'), draft('b', 'y'), draft('c', 'x')]);

      const matched = await repo.list({ index: 'by_group', equals: 'x' });
      expect(matched.map((w) => w.name).sort()).toEqual(['a', 'c']);
    });

    it('orders by an index and reverses on request', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('a', 'g', 3), draft('b', 'g', 1), draft('c', 'g', 2)]);

      expect((await repo.list({ index: 'by_rank' })).map((w) => w.name)).toEqual(['b', 'c', 'a']);
      expect((await repo.list({ index: 'by_rank', direction: 'prev' })).map((w) => w.name)).toEqual(
        ['a', 'c', 'b'],
      );
    });

    it('supports bounded ranges on a compound index', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('a', 'g', 1), draft('b', 'g', 5), draft('c', 'h', 1)]);

      const inGroup = await repo.list({
        index: 'by_group_rank',
        range: { lower: ['g', 0], upper: ['g', 10] },
      });
      expect(inGroup.map((w) => w.name)).toEqual(['a', 'b']);
    });

    it('honours open bounds', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('a', 'g', 1), draft('b', 'g', 2), draft('c', 'g', 3)]);

      const exclusive = await repo.list({
        index: 'by_rank',
        range: { lower: 1, upper: 3, lowerOpen: true, upperOpen: true },
      });
      expect(exclusive.map((w) => w.name)).toEqual(['b']);
    });

    it('omits records whose index key is null, as IndexedDB does', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('zero', 'g', 0), draft('one', 'g', 1)]);

      expect((await repo.list({ index: 'by_optional' })).map((w) => w.name)).toEqual(['one']);
      expect(await repo.count()).toBe(2);
    });

    it('applies offset and limit after the soft-delete filter', async () => {
      const repo = makeRepo();
      const records = await repo.putMany([
        draft('a', 'g', 1),
        draft('b', 'g', 2),
        draft('c', 'g', 3),
        draft('d', 'g', 4),
      ]);
      await repo.remove((records[1] as Widget).id);

      const page = await repo.list({ index: 'by_rank', offset: 1, limit: 2 });
      expect(page.map((w) => w.name)).toEqual(['c', 'd']);
    });

    it('count ignores paging', async () => {
      const repo = makeRepo();
      await repo.putMany([draft('a'), draft('b'), draft('c')]);
      expect(await repo.count({ limit: 1 })).toBe(3);
    });

    it('fails loudly when a query names an unregistered index', async () => {
      // Better than silently returning everything and producing a wrong
      // assertion in whatever test relied on it.
      await expect(makeRepo().list({ index: 'by_nothing' })).rejects.toThrow(/no extractor/i);
    });
  });

  it('seeds from existing records', async () => {
    const seeded: Widget = {
      id: 'w1',
      name: 'seeded',
      group: 'g',
      rank: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      rev: 1,
      origin: 'fixture',
    };
    const repo = new InMemoryRepository<Widget>({ seed: [seeded] });
    expect(await repo.get('w1')).toEqual(seeded);
  });
});
