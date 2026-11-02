import type { DbChange } from '../../data/db-events';
import type { IndexKey, Query, Repository } from '../../data/repository';
import type { StoreName } from '../../data/stores';
import type { Draft, Entity, Patch } from '../../domain/models/entity';
import { notFoundError } from '../../core/errors/app-error';
import {
  storeOf,
  type AnyTransaction,
  type IdbQuerySource,
  type IdbStoreLike,
  type TxRunner,
} from './idb-database';

/**
 * What a repository needs beyond a transaction: envelope values and a way to
 * announce a change. Supplied either by the database (each operation gets its
 * own transaction, and notifications fire once it has committed) or by the unit
 * of work (operations join the ambient transaction, and notifications are held
 * until that transaction commits).
 */
export interface RepoContext extends TxRunner {
  nowIso(): string;
  newId(): string;
  origin(): string;
  notify(change: DbChange): void;
}

export class IdbRepository<T extends Entity> implements Repository<T> {
  constructor(
    private readonly storeName: StoreName,
    private readonly ctx: RepoContext,
  ) {}

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<T | undefined> {
    return this.ctx.run([this.storeName], 'readonly', async (tx) => {
      const record = (await storeOf(tx, this.storeName).get(id)) as T | undefined;
      if (!record) {
        return undefined;
      }
      return options.includeDeleted || record.deletedAt === null ? record : undefined;
    });
  }

  async list(query: Query = {}): Promise<T[]> {
    return this.ctx.run([this.storeName], 'readonly', async (tx) =>
      collect<T>(tx, this.storeName, query),
    );
  }

  async count(query: Query = {}): Promise<number> {
    return this.ctx.run([this.storeName], 'readonly', async (tx) => {
      // Without the soft-delete filter the engine can count the range directly.
      if (query.includeDeleted) {
        return openSource(tx, this.storeName, query).count(toRange(query) ?? undefined);
      }
      // Drop limit and offset by omission: with exactOptionalPropertyTypes,
      // setting them to undefined is not the same as leaving them out.
      const { limit: _limit, offset: _offset, ...unpaged } = query;
      void _limit;
      void _offset;
      const matched = await collect<T>(tx, this.storeName, unpaged);
      return matched.length;
    });
  }

  async put(value: Draft<T>): Promise<T> {
    const record = await this.ctx.run([this.storeName], 'readwrite', async (tx) => {
      const store = storeOf(tx, this.storeName);
      const stamped = await this.stamp(store, value);
      await store.put(stamped);
      return stamped;
    });

    this.ctx.notify({ store: this.storeName, ids: [record.id], kind: 'put', local: true });
    return record;
  }

  async putMany(values: readonly Draft<T>[]): Promise<T[]> {
    if (values.length === 0) {
      return [];
    }

    const records = await this.ctx.run([this.storeName], 'readwrite', async (tx) => {
      const store = storeOf(tx, this.storeName);
      const out: T[] = [];
      for (const value of values) {
        const stamped = await this.stamp(store, value);
        await store.put(stamped);
        out.push(stamped);
      }
      return out;
    });

    this.ctx.notify({
      store: this.storeName,
      ids: records.map((record) => record.id),
      kind: 'bulk',
      local: true,
    });
    return records;
  }

  async patch(id: string, changes: Patch<T>): Promise<T> {
    const record = await this.ctx.run([this.storeName], 'readwrite', async (tx) => {
      const store = storeOf(tx, this.storeName);
      const existing = (await store.get(id)) as T | undefined;
      if (!existing) {
        throw notFoundError(`No ${this.storeName} record with id ${id}`);
      }
      const next: T = {
        ...existing,
        ...changes,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: this.ctx.nowIso(),
        rev: existing.rev + 1,
        origin: this.ctx.origin(),
      };
      await store.put(next);
      return next;
    });

    this.ctx.notify({ store: this.storeName, ids: [id], kind: 'put', local: true });
    return record;
  }

  async remove(id: string, options: { hard?: boolean } = {}): Promise<void> {
    await this.ctx.run([this.storeName], 'readwrite', async (tx) => {
      const store = storeOf(tx, this.storeName);

      if (options.hard) {
        await store.delete(id);
        return;
      }

      const existing = (await store.get(id)) as T | undefined;
      if (!existing || existing.deletedAt !== null) {
        return; // Absent or already tombstoned: deleting twice is not an error.
      }
      const now = this.ctx.nowIso();
      await store.put({
        ...existing,
        deletedAt: now,
        updatedAt: now,
        rev: existing.rev + 1,
        origin: this.ctx.origin(),
      });
    });

    this.ctx.notify({ store: this.storeName, ids: [id], kind: 'remove', local: true });
  }

  async clear(): Promise<void> {
    await this.ctx.run([this.storeName], 'readwrite', async (tx) => {
      await storeOf(tx, this.storeName).clear();
    });
    this.ctx.notify({ store: this.storeName, ids: [], kind: 'clear', local: true });
  }

  /**
   * Applies the envelope. `createdAt` is preserved across a replace and `rev`
   * always increments, so no caller can reset either by accident.
   */
  private async stamp(store: IdbStoreLike, value: Draft<T>): Promise<T> {
    const now = this.ctx.nowIso();
    const id = value.id ?? this.ctx.newId();
    const existing = (await store.get(id)) as T | undefined;

    return {
      ...(value as object),
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: value.deletedAt ?? existing?.deletedAt ?? null,
      rev: (existing?.rev ?? 0) + 1,
      origin: this.ctx.origin(),
    } as T;
  }
}

function openSource(tx: AnyTransaction, storeName: StoreName, query: Query): IdbQuerySource {
  const store = storeOf(tx, storeName);
  return query.index ? store.index(query.index) : store;
}

function toRange(query: Query): IDBKeyRange | null {
  if (query.equals !== undefined) {
    return IDBKeyRange.only(query.equals as IDBValidKey);
  }
  const range = query.range;
  if (!range) {
    return null;
  }
  const { lower, upper, lowerOpen = false, upperOpen = false } = range;

  if (lower !== undefined && upper !== undefined) {
    return IDBKeyRange.bound(lower as IDBValidKey, upper as IDBValidKey, lowerOpen, upperOpen);
  }
  if (lower !== undefined) {
    return IDBKeyRange.lowerBound(lower as IDBValidKey, lowerOpen);
  }
  if (upper !== undefined) {
    return IDBKeyRange.upperBound(upper as IDBValidKey, upperOpen);
  }
  return null;
}

/**
 * Walks a cursor applying the soft-delete filter, then the offset, then the
 * limit — in that order, so a page of results is a page of *live* records
 * rather than a page that tombstones have punched holes in.
 */
async function collect<T extends Entity>(
  tx: AnyTransaction,
  storeName: StoreName,
  query: Query,
): Promise<T[]> {
  const source = openSource(tx, storeName, query);
  const range = toRange(query);
  const direction = query.direction ?? 'next';
  const offset = query.offset ?? 0;
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  const results: T[] = [];
  let skipped = 0;
  let cursor = await source.openCursor(range ?? undefined, direction);

  while (cursor && results.length < limit) {
    const value = cursor.value as T;
    if (query.includeDeleted || value.deletedAt === null) {
      if (skipped >= offset) {
        results.push(value);
      } else {
        skipped += 1;
      }
    }
    cursor = await cursor.continue();
  }

  return results;
}

export type { IndexKey };
