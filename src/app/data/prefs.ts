import { InjectionToken } from '@angular/core';
import type { Prefs } from '../domain/models/prefs';

/**
 * Preference persistence contract. Stores and UI depend on this, never on
 * LocalStorage directly, so tests can substitute an in-memory implementation
 * and a future version could move preferences into a synced store.
 */
export interface PrefsStore {
  /** Synchronous by design: theme and direction must resolve before paint. */
  read(): Prefs;
  write(prefs: Prefs): void;
  clear(): void;
}

export const PREFS_STORE = new InjectionToken<PrefsStore>('PREFS_STORE');
