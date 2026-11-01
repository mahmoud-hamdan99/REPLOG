import { computed, inject, Service, signal } from '@angular/core';
import { PREFS_STORE } from '../../data/prefs';
import { DEFAULT_PREFS, type Prefs } from '../../domain/models/prefs';

/**
 * Owns user preferences. The single writer: no component touches the
 * preference store, and nothing else writes LocalStorage.
 *
 * Reads are synchronous at construction so the first render already has the
 * right language, units and theme.
 */
@Service()
export class SettingsStore {
  private readonly store = inject(PREFS_STORE);
  private readonly _prefs = signal<Prefs>(this.store.read());

  readonly prefs = this._prefs.asReadonly();

  readonly language = computed(() => this._prefs().language);
  readonly themePreference = computed(() => this._prefs().theme);
  readonly weightUnit = computed(() => this._prefs().weightUnit);
  readonly lengthUnit = computed(() => this._prefs().lengthUnit);
  readonly numerals = computed(() => this._prefs().numerals);
  readonly trackingMode = computed(() => this._prefs().trackingMode);
  readonly reduceMotion = computed(() => this._prefs().reduceMotion);

  /** Update one preference. Persisted immediately. */
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.patch({ [key]: value } as unknown as Partial<Prefs>);
  }

  /** Update several preferences as one write. */
  patch(changes: Partial<Prefs>): void {
    const next: Prefs = { ...this._prefs(), ...changes, prefsVersion: 1 };
    this._prefs.set(next);
    this.store.write(next);
  }

  /** Restore defaults. Does not touch IndexedDB data. */
  reset(): void {
    const next: Prefs = { ...DEFAULT_PREFS };
    this._prefs.set(next);
    this.store.write(next);
  }
}
