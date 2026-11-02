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
import { provideDataLayer } from './app.providers';
import { APP_META_STORE } from './data/app-meta';
import { AppErrorHandler } from './core/errors/app-error-handler';
import { I18n } from './core/i18n/i18n.service';
import { SelectivePreloadStrategy } from './core/nav/preload.strategy';
import { TranslatedTitleStrategy } from './core/nav/title.strategy';
import { SettingsStore } from './core/settings/settings.store';

// Composition root. Only this file and app.providers.ts may reach into the
// infrastructure layer; everything else depends on the tokens in data/.
// Enforced by eslint.config.js.
import { IdbDatabase } from './infrastructure/idb/idb-database';
import { IdbEnvironment } from './infrastructure/idb/idb-environment';
import { DB_VERSION } from './infrastructure/idb/schema';

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

    // Storage contracts bound to their browser implementations. Shared with the
    // test harness so both wire the stack the same way.
    ...provideDataLayer(),

    // Load the active language before the first render. The I18n constructor
    // effect would also fetch it, but effects run after the first paint, which
    // would flash raw translation keys.
    provideAppInitializer(async () => {
      const i18n = inject(I18n);
      await i18n.load(inject(SettingsStore).language());
    }),

    // Establish the device identity that stamps every write's `origin`.
    // Deliberately fault-tolerant: if the database cannot be opened — safe
    // mode, blocked by another tab, storage disabled — the app still boots and
    // shows its own error state rather than failing to start at all.
    provideAppInitializer(async () => {
      const appMeta = inject(APP_META_STORE);
      const environment = inject(IdbEnvironment);
      const database = inject(IdbDatabase);

      try {
        const meta = await appMeta.readAll();
        const deviceId = meta.deviceId || environment.newId();
        environment.setDeviceId(deviceId);

        if (meta.deviceId !== deviceId || meta.schemaVersion !== DB_VERSION) {
          await appMeta.patch({ deviceId, schemaVersion: DB_VERSION });
        }
      } catch {
        // `database.isSafeMode()` carries the reason for the UI to surface.
        void database;
      }
    }),
  ],
};
