import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  TitleStrategy,
} from '@angular/router';

import { routes } from './app.routes';
import { CLOCK } from './data/clock';
import { PREFS_STORE } from './data/prefs';
import { AppErrorHandler } from './core/errors/app-error-handler';
import { I18n } from './core/i18n/i18n.service';
import { SelectivePreloadStrategy } from './core/nav/preload.strategy';
import { TranslatedTitleStrategy } from './core/nav/title.strategy';
import { SettingsStore } from './core/settings/settings.store';

// This file is the composition root: the one place allowed to reach into the
// infrastructure layer and bind implementations to the contracts in data/.
// Everything else depends on the tokens. Enforced by eslint.config.js.
import { LocalStoragePrefs } from './infrastructure/prefs/local-storage-prefs';
import { SystemClock } from './infrastructure/platform/system-clock';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    provideRouter(
      routes,
      // Route data binds straight to component inputs, so a placeholder page
      // can take its titleKey without reading ActivatedRoute.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withPreloading(SelectivePreloadStrategy),
    ),

    { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
    { provide: ErrorHandler, useExisting: AppErrorHandler },

    // Storage contracts bound to their browser implementations.
    { provide: PREFS_STORE, useExisting: LocalStoragePrefs },
    { provide: CLOCK, useExisting: SystemClock },

    // Load the active language before the first render. The I18n constructor
    // effect would also fetch it, but effects run after the first paint, which
    // would flash raw translation keys.
    provideAppInitializer(async () => {
      const i18n = inject(I18n);
      await i18n.load(inject(SettingsStore).language());
    }),
  ],
};
