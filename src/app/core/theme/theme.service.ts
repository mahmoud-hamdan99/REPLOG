import { DOCUMENT, DestroyRef, effect, inject, Service, signal, computed } from '@angular/core';
import type { ReduceMotionPreference, ResolvedTheme } from '../../domain/models/prefs';
import { SettingsStore } from '../settings/settings.store';

/**
 * Must stay in step with --bg in src/styles/_tokens.css and _themes.css, and
 * with the inline pre-paint script in src/index.html. Drives the iOS status bar
 * colour in standalone mode.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#0b0c0e',
  light: '#f6f7f8',
};

/**
 * Resolves the theme preference ('system' | 'light' | 'dark') to an applied
 * theme and reflects it onto the document.
 *
 * The pre-paint script in index.html does this once before Angular boots; this
 * service takes over afterwards and keeps it live as the preference or the OS
 * setting changes.
 */
@Service()
export class ThemeService {
  private readonly settings = inject(SettingsStore);
  private readonly doc = inject(DOCUMENT);
  private readonly systemPrefersLight = signal(false);

  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.settings.themePreference();
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    return this.systemPrefersLight() ? 'light' : 'dark';
  });

  constructor() {
    this.watchSystemPreference();

    effect(() => {
      const theme = this.resolved();
      this.doc.documentElement.setAttribute('data-theme', theme);
      this.doc
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', THEME_COLORS[theme]);
    });

    // The motion preference, reflected the same way, because until Phase 14
    // it was reflected nowhere: the setting existed, the Settings screen
    // offered all three values, and nothing in the app read any of them. Only
    // the OS-level media query in _base.css did anything, so "Always" and
    // "Never" were both quietly "System".
    effect(() => {
      const preference: ReduceMotionPreference = this.settings.reduceMotion();
      const element = this.doc.documentElement;
      if (preference === 'system') element.removeAttribute('data-motion');
      else element.setAttribute('data-motion', preference === 'always' ? 'reduced' : 'full');
    });
  }

  private watchSystemPreference(): void {
    const query = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: light)');
    if (!query) {
      return;
    }
    this.systemPrefersLight.set(query.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      this.systemPrefersLight.set(event.matches);
    };
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
}
