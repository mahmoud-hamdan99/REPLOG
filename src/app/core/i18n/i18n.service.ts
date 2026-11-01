import { DOCUMENT, computed, effect, inject, isDevMode, Service, signal } from '@angular/core';
import { directionFor, type Language } from '../../domain/models/prefs';
import { SettingsStore } from '../settings/settings.store';

/** A translation is either a plain string or a set of plural forms. */
export type Translation = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dictionary = Record<string, Translation>;
export type TranslateParams = Record<string, string | number>;

/**
 * Explicit loaders rather than a computed `import()` path: a template-literal
 * import is not statically analysable, so the bundler cannot split it cleanly.
 * Each dictionary becomes its own lazy chunk, fetched only when that language
 * is selected and precached by the service worker for offline use.
 */
const LOADERS: Record<Language, () => Promise<{ default: Dictionary }>> = {
  en: () => import('./locales/en.json'),
  ar: () => import('./locales/ar.json'),
};

/**
 * Runtime translation.
 *
 * Deliberately not Angular's compile-time `$localize`: that produces one build
 * per locale, which cannot switch language without a reload and would double
 * the deployed artefact. See docs/ARCHITECTURE.md decision D3.
 *
 * `t()` is called directly from templates. It reads the locale and dictionary
 * signals, so a template that calls it re-renders when either changes — which
 * is what makes switching language instant and reload-free. A pure pipe would
 * memoise on its arguments and miss the locale change.
 */
@Service()
export class I18n {
  private readonly settings = inject(SettingsStore);
  private readonly doc = inject(DOCUMENT);
  private readonly dictionaries = signal<Partial<Record<Language, Dictionary>>>({});
  private readonly missing = new Set<string>();

  readonly locale = computed<Language>(() => this.settings.language());
  readonly direction = computed(() => directionFor(this.locale()));
  readonly isReady = computed(() => this.dictionaries()[this.locale()] !== undefined);

  constructor() {
    effect(() => {
      const locale = this.locale();

      // Reflect onto the document so CSS (:root[lang='ar']) and assistive
      // technology both follow. No reload needed.
      const root = this.doc.documentElement;
      root.lang = locale;
      root.dir = directionFor(locale);

      if (this.dictionaries()[locale] === undefined) {
        void this.load(locale);
      }
    });
  }

  /** Loads a dictionary. Safe to call repeatedly; later calls are no-ops. */
  async load(locale: Language): Promise<void> {
    if (this.dictionaries()[locale] !== undefined) {
      return;
    }
    const module = await LOADERS[locale]();
    this.dictionaries.update((current) => ({ ...current, [locale]: module.default }));
  }

  /**
   * Translates `key`. Missing keys render as the key itself rather than an
   * empty string, so a gap is visible in review instead of silently blank.
   */
  t(key: string, params?: TranslateParams): string {
    const dictionary = this.dictionaries()[this.locale()];
    if (!dictionary) {
      return key;
    }

    const entry = dictionary[key];
    if (entry === undefined) {
      this.reportMissing(key);
      return key;
    }

    const template = typeof entry === 'string' ? entry : this.selectPlural(entry, params);
    return template === undefined ? key : interpolate(template, params);
  }

  /** Formats a number in the active locale and numeral system. */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    const locale = this.locale();
    const numbering = this.settings.numerals();
    return new Intl.NumberFormat(`${locale}-u-nu-${numbering}`, options).format(value);
  }

  /** Keys requested but absent, for Settings → About → Diagnostics. */
  missingKeys(): readonly string[] {
    return [...this.missing];
  }

  private selectPlural(
    forms: Partial<Record<Intl.LDMLPluralRule, string>>,
    params?: TranslateParams,
  ): string | undefined {
    const count = typeof params?.['count'] === 'number' ? params['count'] : 0;
    const category = new Intl.PluralRules(this.locale()).select(count);
    // Arabic distinguishes six categories; 'other' is the guaranteed fallback.
    return forms[category] ?? forms.other;
  }

  private reportMissing(key: string): void {
    if (this.missing.has(key)) {
      return;
    }
    this.missing.add(key);
    if (isDevMode()) {
      console.warn(`[i18n] missing key "${key}" for locale "${this.locale()}"`);
    }
  }
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
