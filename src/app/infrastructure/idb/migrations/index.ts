import type { IDBPDatabase } from 'idb';
import { migrateTo1, type UpgradeTransaction } from './v1';

export interface Migration {
  /** Schema version this step produces. */
  to: number;
  run(db: IDBPDatabase<unknown>, tx: UpgradeTransaction): void;
}

/**
 * Ordered, forward-only migrations.
 *
 * **Synchronous by contract.** `openDB` does not await its upgrade callback, so
 * anything after an `await` would run once the version-change transaction has
 * already begun committing, and a thrown error would surface as an unhandled
 * rejection instead of failing the open. A future step that must rewrite data
 * uses the supplied transaction with idb's cursors and awaits nothing else —
 * never a timer, a fetch, or an unrelated promise.
 *
 * The other rules (DATABASE_SPEC section 7.2): every step is idempotent and
 * resumable, and a step that cannot complete throws so the caller can offer an
 * export before anything else. Preserving data beats restoring features.
 */
export const MIGRATIONS: readonly Migration[] = [{ to: 1, run: migrateTo1 }];

export function runMigrations(
  db: IDBPDatabase<unknown>,
  tx: UpgradeTransaction,
  oldVersion: number,
  newVersion: number,
): void {
  for (const migration of MIGRATIONS) {
    if (oldVersion < migration.to && migration.to <= newVersion) {
      migration.run(db, tx);
    }
  }
}
