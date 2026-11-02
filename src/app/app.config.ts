import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  type Provider,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  TitleStrategy,
} from '@angular/router';

import { routes } from './app.routes';
import { APP_META_STORE } from './data/app-meta';
import { CLOCK } from './data/clock';
import { DB_EVENTS } from './data/db-events';
import { PHOTO_BLOB_STORE } from './data/photo-blobs';
import { PREFS_STORE } from './data/prefs';
import { ENTITY_STORE_NAMES } from './data/stores';
import { REPOSITORY_TOKENS } from './data/tokens';
import { UNIT_OF_WORK } from './data/unit-of-work';
import { AppErrorHandler } from './core/errors/app-error-handler';
import { I18n } from './core/i18n/i18n.service';
import { SelectivePreloadStrategy } from './core/nav/preload.strategy';
import { TranslatedTitleStrategy } from './core/nav/title.strategy';
import { SettingsStore } from './core/settings/settings.store';

// This file is the composition root: the one place allowed to reach into the
// infrastructure layer and bind implementations to the contracts in data/.
// Everything else depends on the tokens. Enforced by eslint.config.js.
import { IdbPhotoBlobStore } from './infrastructure/blobs/idb-photo-blob-store';
import { IdbAppMetaStore } from './infrastructure/idb/idb-app-meta';
import { IdbDatabase } from './infrastructure/idb/idb-database';
import { IdbDbEvents } from './infrastructure/idb/idb-db-events';
import { IdbEnvironment } from './infrastructure/idb/idb-environment';
import { IdbRepository } from './infrastructure/idb/idb-repository';
import { IdbUnitOfWork, StandaloneRepoContext } from './infrastructure/idb/idb-unit-of-work';
import { DB_VERSION } from './infrastructure/idb/schema';
import { LocalStoragePrefs } from './infrastructure/prefs/local-storage-prefs';
import { SystemClock } from './infrastructure/platform/system-clock';

/**
 * One repository per entity store, all sharing the standalone context so each
 * operation gets its own transaction. Multi-store writes go through
 * `UNIT_OF_WORK` instead.
 */
const repositoryProviders: Provider[] = ENTITY_STORE_NAMES.map((store) => ({
  provide: REPOSITORY_TOKENS[store],
  useFactory: () => new IdbRepository(store, inject(StandaloneRepoContext)),
}));

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
    { provide: DB_EVENTS, useExisting: IdbDbEvents },
    { provide: UNIT_OF_WORK, useExisting: IdbUnitOfWork },
    { provide: APP_META_STORE, useExisting: IdbAppMetaStore },
    { provide: PHOTO_BLOB_STORE, useExisting: IdbPhotoBlobStore },
    ...repositoryProviders,

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
