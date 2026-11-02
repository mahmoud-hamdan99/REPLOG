import type { Draft, Entity, Patch } from '../domain/models/entity';

/**
 * A key usable against a store or index.
 *
 * Deliberately not `IDBValidKey`. The whole point of this layer is that the
 * storage engine can be replaced, and a contract that names IndexedDB types is
 * not replaceable. Every key in this schema is a string, a number, or a tuple
 * of those — instants are ISO strings, so no Date keys are needed.
 */
export type IndexKey = string | number | readonly (string | number)[];

export interface KeyRange {
  lower?: IndexKey;
  upper?: IndexKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

export interface Query {
  /** Named index to traverse. Omit to use the primary key. */
  index?: string;
  /** Exact key match. Mutually exclusive with `range`. */
  equals?: IndexKey;
  range?: KeyRange;
  /** `prev` walks the index backwards, for "most recent first". */
  direction?: 'next' | 'prev';
  limit?: number;
  offset?: number;
  /** Tombstoned records are excluded unless this is set. */
  includeDeleted?: boolean;
}

/**
 * Storage contract. Feature code depends on this and on the DI tokens in
 * tokens.ts, never on an implementation; that is what lets tests substitute an
 * in-memory fake with no IndexedDB shim, and what would let a Version 2 cloud
 * repository be provided against the same tokens without touching a store.
 */
export interface Repository<T extends Entity> {
  /**
   * Tombstoned records are hidden by default, matching `list`. Undo and
   * integrity repair pass `includeDeleted` to reach one on purpose.
   */
  get(id: string, options?: { includeDeleted?: boolean }): Promise<T | undefined>;
  list(query?: Query): Promise<T[]>;
  count(query?: Query): Promise<number>;

  /** Insert or full replace. Stamps `updatedAt`, `rev` and `origin`. */
  put(value: Draft<T>): Promise<T>;
  putMany(values: readonly Draft<T>[]): Promise<T[]>;

  /** Shallow field patch. Rejects if the record is missing. */
  patch(id: string, changes: Patch<T>): Promise<T>;

  /**
   * Soft delete by default: the record is tombstoned so an undo is possible and
   * so the deletion can replicate in Version 2. A hard delete is reserved for
   * resetting all data and for import in replace mode.
   */
  remove(id: string, options?: { hard?: boolean }): Promise<void>;

  /** Hard-removes every record in the store. */
  clear(): Promise<void>;
}
