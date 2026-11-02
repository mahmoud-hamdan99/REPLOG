import { DEFAULT_PREFS } from '../../domain/models/prefs';
import { LocalStoragePrefs, PREFS_KEY } from './local-storage-prefs';

/** Constructed directly: the class takes no dependencies. */
const makeStore = () => new LocalStoragePrefs();

describe('LocalStoragePrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when nothing is stored', () => {
    expect(makeStore().read()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips preferences', () => {
    const store = makeStore();
    store.write({ ...DEFAULT_PREFS, language: 'ar', theme: 'light' });

    expect(makeStore().read()).toMatchObject({ language: 'ar', theme: 'light' });
  });

  it('degrades field by field rather than discarding everything', () => {
    // A partially corrupt blob should not cost the user every setting.
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ language: 'ar', theme: 'chartreuse', defaultRestSec: 'soon' }),
    );

    const prefs = makeStore().read();
    expect(prefs.language).toBe('ar');
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme);
    expect(prefs.defaultRestSec).toBe(DEFAULT_PREFS.defaultRestSec);
  });

  it('survives unparseable JSON', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(makeStore().read()).toEqual(DEFAULT_PREFS);
  });

  /**
   * Running an older build must not destroy settings a newer one wrote, so
   * unrecognised keys are preserved across a read/write cycle.
   */
  it('round-trips keys it does not recognise', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, futureSetting: 'keep me' }));

    const store = makeStore();
    const prefs = store.read();
    store.write({ ...prefs, language: 'ar' });

    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    expect(raw.futureSetting).toBe('keep me');
    expect(raw.language).toBe('ar');
  });

  it('clears stored preferences', () => {
    const store = makeStore();
    store.write({ ...DEFAULT_PREFS, language: 'ar' });
    store.clear();

    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(store.read()).toEqual(DEFAULT_PREFS);
  });

  it('does not throw when storage is unavailable', () => {
    // Safari throws on storage access in some blocked-storage states, and a
    // failed preference write must never interrupt what the user was doing.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };

    try {
      expect(() => makeStore().write({ ...DEFAULT_PREFS })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('falls back to defaults when reading throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };

    try {
      expect(makeStore().read()).toEqual(DEFAULT_PREFS);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
