import type { IndexKey, Query, Repository } from '../repository';
import type { Draft, Entity, Patch } from '../../domain/models/entity';

/** Extracts an index key from a record, mirroring an IndexedDB key path. */
export type IndexExtractor<T> = (record: T) => IndexKey | null | undefined;

export interface InMemoryRepositoryOptions<T extends Entity> {
  /** Index name to key extractor, for queries that name an index. */
  indexes?: Record<string, IndexExtractor<T>>;
  seed?: readonly T[];
  nowIso?: () => string;
  newId?: () => string;
  origin?: () => string;
}

/**
 * In-memory `Repository` for tests.
 *
 * This is the payoff of putting the storage contract in `data/`: a store or a
 * component can be tested with no IndexedDB, no `fake-indexeddb` shim, and no
 * shared state between tests. It reproduces the behaviour that callers actually
 * depend on — envelope stamping, soft-delete filtering, ordering, offset and
 * limit — rather than pretending to be a database.
 *
 * It does not reproduce transactions. Code whose correctness depends on
 * atomicity is tested against the real engine instead, because a fake that
 * claimed to roll back would hide exactly the bug worth catching.
 */
export class InMemoryRepository<T extends Entity> implements Repository<T> {
  private readonly records = new Map<string, T>();
  private readonly indexes: Record<string, IndexExtractor<T>>;
  private readonly nowIso: () => string;
  private readonly newId: () => string;
  private readonly origin: () => string;
  private sequence = 0;

  constructor(options: InMemoryRepositoryOptions<T> = {}) {
    this.indexes = options.indexes ?? {};
    this.nowIso = options.nowIso ?? (() => new Date(0).toISOString());
    this.newId = options.newId ?? (() => `mem-${String(++this.sequence).padStart(6, '0')}`);
    this.origin = options.origin ?? (() => 'test-device');
    for (const record of options.seed ?? []) {
      this.records.set(record.id, record);
    }
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<T | undefined> {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }
    return options.includeDeleted || record.deletedAt === null ? record : undefined;
  }

  async list(query: Query = {}): Promise<T[]> {
    return this.select(query);
  }

  async count(query: Query = {}): Promise<number> {
    // Omit paging by destructuring: with exactOptionalPropertyTypes, setting a
    // key to undefined is not the same as leaving it out.
    const { limit: _limit, offset: _offset, ...unpaged } = query;
    void _limit;
    void _offset;
    return this.select(unpaged).length;
  }

  async put(value: Draft<T>): Promise<T> {
    const record = this.stamp(value);
    this.records.set(record.id, record);
    return record;
  }

  async putMany(values: readonly Draft<T>[]): Promise<T[]> {
    return Promise.all(values.map((value) => this.put(value)));
  }

  async patch(id: string, changes: Patch<T>): Promise<T> {
    const existing = this.records.get(id);
    if (!existing) {
      throw new Error(`No record with id ${id}`);
    }
    const next: T = {
      ...existing,
      ...changes,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.nowIso(),
      rev: existing.rev + 1,
      origin: this.origin(),
    };
    this.records.set(id, next);
    return next;
  }

  async remove(id: string, options: { hard?: boolean } = {}): Promise<void> {
    if (options.hard) {
      this.records.delete(id);
      return;
    }
    const existing = this.records.get(id);
    if (!existing || existing.deletedAt !== null) {
      return;
    }
    const now = this.nowIso();
    this.records.set(id, {
      ...existing,
      deletedAt: now,
      updatedAt: now,
      rev: existing.rev + 1,
      origin: this.origin(),
    });
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  /** Everything held, tombstones included. For assertions, not for production. */
  snapshot(): T[] {
    return [...this.records.values()];
  }

  private stamp(value: Draft<T>): T {
    const now = this.nowIso();
    const id = value.id ?? this.newId();
    const existing = this.records.get(id);
    return {
      ...(value as object),
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: value.deletedAt ?? existing?.deletedAt ?? null,
      rev: (existing?.rev ?? 0) + 1,
      origin: this.origin(),
    } as T;
  }

  private select(query: Query): T[] {
    const extractor = query.index ? this.indexes[query.index] : undefined;
    if (query.index && !extractor) {
      throw new Error(
        `InMemoryRepository has no extractor for index "${query.index}". ` +
          'Register it in the constructor options.',
      );
    }

    let rows = [...this.records.values()];

    if (!query.includeDeleted) {
      rows = rows.filter((row) => row.deletedAt === null);
    }

    const keyOf = (row: T): IndexKey => (extractor ? (extractor(row) ?? '') : row.id);

    if (extractor) {
      // Records whose index key is null are absent from a real IndexedDB index.
      rows = rows.filter((row) => {
        const key = extractor(row);
        return key !== null && key !== undefined;
      });
    }

    if (query.equals !== undefined) {
      rows = rows.filter((row) => compareKeys(keyOf(row), query.equals as IndexKey) === 0);
    } else if (query.range) {
      const { lower, upper, lowerOpen = false, upperOpen = false } = query.range;
      rows = rows.filter((row) => {
        const key = keyOf(row);
        if (lower !== undefined) {
          const c = compareKeys(key, lower);
          if (c < 0 || (lowerOpen && c === 0)) return false;
        }
        if (upper !== undefined) {
          const c = compareKeys(key, upper);
          if (c > 0 || (upperOpen && c === 0)) return false;
        }
        return true;
      });
    }

    rows.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    if (query.direction === 'prev') {
      rows.reverse();
    }

    const offset = query.offset ?? 0;
    const limited = rows.slice(offset);
    return query.limit === undefined ? limited : limited.slice(0, query.limit);
  }
}

/** Mirrors IndexedDB key ordering closely enough for test assertions. */
function compareKeys(a: IndexKey, b: IndexKey): number {
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);

  if (aArray && bArray) {
    const left = a as readonly (string | number)[];
    const right = b as readonly (string | number)[];
    const length = Math.min(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      const result = compareKeys(left[i] as IndexKey, right[i] as IndexKey);
      if (result !== 0) return result;
    }
    return left.length - right.length;
  }
  if (aArray !== bArray) {
    // IndexedDB orders numbers, then strings, then arrays.
    return aArray ? 1 : -1;
  }

  const aNumber = typeof a === 'number';
  const bNumber = typeof b === 'number';
  if (aNumber !== bNumber) {
    return aNumber ? -1 : 1;
  }
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}
