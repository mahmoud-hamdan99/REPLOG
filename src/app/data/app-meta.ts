import { InjectionToken } from '@angular/core';
import type { AppMeta, AppMetaKey } from '../domain/models/system';

/**
 * App-local pointers and counters: the active workout id, the device id, the
 * seeded catalog version, the last export time.
 *
 * Kept out of the repository abstraction because these are not user records.
 * They have no sync envelope, are never soft-deleted, and are read as a whole
 * map once at boot.
 */
export interface AppMetaStore {
  /** Reads every key, merged over defaults. Used once during startup. */
  readAll(): Promise<AppMeta>;
  get<K extends AppMetaKey>(key: K): Promise<AppMeta[K]>;
  set<K extends AppMetaKey>(key: K, value: AppMeta[K]): Promise<void>;
  patch(changes: Partial<AppMeta>): Promise<void>;
}

export const APP_META_STORE = new InjectionToken<AppMetaStore>('APP_META_STORE');
