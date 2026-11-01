import { Service } from '@angular/core';
import type { PrefsStore } from '../../data/prefs';
import { normalizePrefs, PREFS_KEYS, type Prefs } from '../../domain/models/prefs';

export const PREFS_KEY = 'replog.prefs.v1';

/**
 * LocalStorage-backed preferences.
 *
 * Every access is guarded. Safari throws on storage access in some
 * private-browsing and blocked-storage states, and a failed preference read
 * must never stop the app from starting. Unknown keys are round-tripped so
 * running an older build does not destroy settings a newer one wrote.
 */
@Service()
export class LocalStoragePrefs implements PrefsStore {
  private unknownKeys: Record<string, unknown> = {};

  read(): Prefs {
    let raw: unknown = {};
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored !== null) {
        raw = JSON.parse(stored);
      }
    } catch {
      raw = {};
    }
    this.unknownKeys = extractUnknownKeys(raw);
    return normalizePrefs(raw);
  }

  write(prefs: Prefs): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...this.unknownKeys, ...prefs }));
    } catch {
      // Storage full, blocked, or unavailable. Preferences are a convenience:
      // failing to save one must not interrupt what the user was doing.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      // See write().
    }
    this.unknownKeys = {};
  }
}

function extractUnknownKeys(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const known = new Set(PREFS_KEYS);
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([key]) => !known.has(key)),
  );
}
