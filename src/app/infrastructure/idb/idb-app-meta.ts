import { inject, Service } from '@angular/core';
import type { AppMetaStore } from '../../data/app-meta';
import { APP_META_DEFAULTS, type AppMeta, type AppMetaKey } from '../../domain/models/system';
import { IdbDatabase, storeOf } from './idb-database';

const STORE = 'appMeta' as const;

/**
 * Key/value access to app-local pointers.
 *
 * Reads merge over `APP_META_DEFAULTS`, so a key written by a newer build, or
 * one never written at all, degrades to a sensible default instead of
 * `undefined` leaking into application code.
 */
@Service()
export class IdbAppMetaStore implements AppMetaStore {
  private readonly db = inject(IdbDatabase);

  async readAll(): Promise<AppMeta> {
    const rows = await this.db.run([STORE], 'readonly', async (tx) => storeOf(tx, STORE).getAll());

    const merged = { ...APP_META_DEFAULTS } as unknown as Record<string, unknown>;
    for (const row of rows as { key: string; value: unknown }[]) {
      if (row.key in merged) {
        merged[row.key] = row.value;
      }
    }
    return merged as unknown as AppMeta;
  }

  async get<K extends AppMetaKey>(key: K): Promise<AppMeta[K]> {
    const row = await this.db.run([STORE], 'readonly', async (tx) => storeOf(tx, STORE).get(key));
    const value = (row as { value: unknown } | undefined)?.value;
    return (value === undefined ? APP_META_DEFAULTS[key] : value) as AppMeta[K];
  }

  async set<K extends AppMetaKey>(key: K, value: AppMeta[K]): Promise<void> {
    await this.db.run([STORE], 'readwrite', async (tx) => {
      await storeOf(tx, STORE).put({ key, value });
    });
  }

  /** One transaction for the whole patch, so related pointers move together. */
  async patch(changes: Partial<AppMeta>): Promise<void> {
    const entries = Object.entries(changes);
    if (entries.length === 0) {
      return;
    }
    await this.db.run([STORE], 'readwrite', async (tx) => {
      const store = storeOf(tx, STORE);
      for (const [key, value] of entries) {
        await store.put({ key, value });
      }
    });
  }
}
