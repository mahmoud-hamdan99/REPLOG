/**
 * An indexable boolean.
 *
 * IndexedDB has no boolean key type: `true` is not a valid key, so an index on
 * a boolean field silently matches nothing. Any flag that an index ranges over
 * is therefore stored as 0 or 1. Flags with no index behind them stay plain
 * booleans, because the ergonomic cost is only worth paying where it buys a
 * query. See docs/DATABASE_SPEC.md section 2.2.
 */
export type Flag = 0 | 1;

export const flag = (value: boolean): Flag => (value ? 1 : 0);

/**
 * The envelope every persisted record carries.
 *
 * It costs about 80 bytes per record in Version 1 and buys a Version 2 that is
 * additive rather than a breaking migration: `updatedAt` plus `rev` plus
 * `origin` give last-write-wins with a conflict hint, and `deletedAt`
 * tombstones let deletions replicate instead of silently reappearing from
 * another device. See docs/DATABASE_SPEC.md section 2.1.
 */
export interface Entity {
  /** UUIDv7: time-sortable, so the key doubles as a creation cursor. */
  readonly id: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. Bumped on every write. */
  updatedAt: string;
  /** Soft-delete tombstone. `null` means live. */
  deletedAt: string | null;
  /** Local revision counter. Starts at 1, incremented per write. */
  rev: number;
  /** Device that last wrote this record. */
  origin: string;
}

/**
 * How long a tombstoned record stays recoverable.
 *
 * A property of the tombstone, so it lives beside it rather than being retyped
 * into each screen that promises it.
 */
export const RECOVERY_WINDOW_DAYS = 30;

/**
 * What a caller supplies. The envelope is stamped by the repository, so no
 * application code hand-writes `rev` or `updatedAt` and they cannot drift.
 */
export type Draft<T extends Entity> = Omit<
  T,
  'createdAt' | 'updatedAt' | 'rev' | 'origin' | 'id' | 'deletedAt'
> & {
  /** Omit to insert with a generated id; supply one to replace a record. */
  id?: string;
  /** Omit for a live record. Present only when restoring a tombstone. */
  deletedAt?: string | null;
};

/** Fields a `patch` may change: everything except the envelope and the id. */
export type Patch<T extends Entity> = Partial<Omit<T, keyof Entity>>;

export const ENVELOPE_KEYS: readonly (keyof Entity)[] = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'rev',
  'origin',
];

/** True when a record is live (not tombstoned). */
export function isLive<T extends Entity>(record: T): boolean {
  return record.deletedAt === null;
}
