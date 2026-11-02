import type { IDBPDatabase, IDBPTransaction } from 'idb';
import { STORES } from '../schema';

export type UpgradeTransaction = IDBPTransaction<unknown, string[], 'versionchange'>;

/**
 * Initial schema: every store and index in DATABASE_SPEC section 3.
 *
 * Idempotent and resumable. A browser killed part-way through an upgrade must
 * be able to re-run this, so every creation is guarded by an existence check
 * rather than assuming a clean database.
 */
export function migrateTo1(db: IDBPDatabase<unknown>, tx: UpgradeTransaction): void {
  for (const definition of STORES) {
    const store = db.objectStoreNames.contains(definition.name)
      ? tx.objectStore(definition.name)
      : db.createObjectStore(definition.name, { keyPath: definition.keyPath });

    for (const index of definition.indexes) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, index.options);
      }
    }
  }
}
