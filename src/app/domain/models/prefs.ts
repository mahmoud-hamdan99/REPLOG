/** Lightweight preferences. Persisted in LocalStorage, not IndexedDB, so the
 *  theme and text direction can be resolved synchronously before first paint.
 *  See docs/DATABASE_SPEC.md section 5. */
export interface Prefs {
  prefsVersion: 1;
  language: Language;
  theme: ThemePreference;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  numerals: Numerals;
  weekStartsOn: WeekStart;
  defaultRestSec: number;
  trackingMode: TrackingMode;
  autoStartRestTimer: boolean;
  restTimerSound: boolean;
  keepScreenAwake: boolean;
  showPreviousPerformance: boolean;
  showSuggestions: boolean;
  e1rmFormula: E1rmFormula;
  confirmBeforeFinish: boolean;
  hapticsEnabled: boolean;
  /** Hides photo thumbnails behind a tap-to-reveal blur. */
  blurPhotos: boolean;
  lastRoute: string | null;
  reduceMotion: ReduceMotionPreference;
}

export type Language = 'en' | 'ar';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';
export type Numerals = 'latn' | 'arab';
export type WeekStart = 0 | 1 | 6;
export type TrackingMode = 'simple' | 'advanced';
export type E1rmFormula = 'epley' | 'brzycki';
export type ReduceMotionPreference = 'system' | 'always' | 'never';

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  prefsVersion: 1,
  language: 'en',
  theme: 'system',
  weightUnit: 'kg',
  lengthUnit: 'cm',
  numerals: 'latn',
  weekStartsOn: 1,
  defaultRestSec: 90,
  trackingMode: 'simple',
  autoStartRestTimer: true,
  restTimerSound: true,
  keepScreenAwake: true,
  showPreviousPerformance: true,
  showSuggestions: true,
  e1rmFormula: 'epley',
  confirmBeforeFinish: true,
  hapticsEnabled: false,
  blurPhotos: false,
  lastRoute: null,
  reduceMotion: 'system',
} satisfies Prefs);

const LANGUAGES: readonly Language[] = ['en', 'ar'];
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb'];
const LENGTH_UNITS: readonly LengthUnit[] = ['cm', 'in'];
const NUMERALS: readonly Numerals[] = ['latn', 'arab'];
const WEEK_STARTS: readonly WeekStart[] = [0, 1, 6];
const TRACKING_MODES: readonly TrackingMode[] = ['simple', 'advanced'];
const E1RM_FORMULAS: readonly E1rmFormula[] = ['epley', 'brzycki'];
const REDUCE_MOTION: readonly ReduceMotionPreference[] = ['system', 'always', 'never'];

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Coerces unknown stored JSON into a valid `Prefs`. Never throws: a corrupt or
 * partial blob degrades to defaults field by field rather than discarding every
 * preference the user has set.
 */
export function normalizePrefs(raw: unknown): Prefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const rest = typeof r['defaultRestSec'] === 'number' ? r['defaultRestSec'] : d.defaultRestSec;

  return {
    prefsVersion: 1,
    language: oneOf(r['language'], LANGUAGES, d.language),
    theme: oneOf(r['theme'], THEMES, d.theme),
    weightUnit: oneOf(r['weightUnit'], WEIGHT_UNITS, d.weightUnit),
    lengthUnit: oneOf(r['lengthUnit'], LENGTH_UNITS, d.lengthUnit),
    numerals: oneOf(r['numerals'], NUMERALS, d.numerals),
    weekStartsOn: oneOf(r['weekStartsOn'], WEEK_STARTS, d.weekStartsOn),
    defaultRestSec: Math.min(3600, Math.max(0, Math.round(rest))),
    trackingMode: oneOf(r['trackingMode'], TRACKING_MODES, d.trackingMode),
    autoStartRestTimer: bool(r['autoStartRestTimer'], d.autoStartRestTimer),
    restTimerSound: bool(r['restTimerSound'], d.restTimerSound),
    keepScreenAwake: bool(r['keepScreenAwake'], d.keepScreenAwake),
    showPreviousPerformance: bool(r['showPreviousPerformance'], d.showPreviousPerformance),
    showSuggestions: bool(r['showSuggestions'], d.showSuggestions),
    e1rmFormula: oneOf(r['e1rmFormula'], E1RM_FORMULAS, d.e1rmFormula),
    confirmBeforeFinish: bool(r['confirmBeforeFinish'], d.confirmBeforeFinish),
    hapticsEnabled: bool(r['hapticsEnabled'], d.hapticsEnabled),
    blurPhotos: bool(r['blurPhotos'], d.blurPhotos),
    lastRoute: typeof r['lastRoute'] === 'string' ? r['lastRoute'] : null,
    reduceMotion: oneOf(r['reduceMotion'], REDUCE_MOTION, d.reduceMotion),
  };
}

/** The set of keys a valid `Prefs` carries, for round-tripping unknown ones. */
export const PREFS_KEYS: readonly string[] = Object.keys(DEFAULT_PREFS);

/** Text direction for a language. */
export function directionFor(language: Language): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}
