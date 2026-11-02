import { inject, type Provider } from '@angular/core';
import { APP_META_STORE } from './data/app-meta';
import { CLOCK } from './data/clock';
import { DB_EVENTS } from './data/db-events';
import { ID_FACTORY } from './data/ids';
import { PHOTO_BLOB_STORE } from './data/photo-blobs';
import { PR_DETECTOR } from './data/pr-detector';
import { PREFS_STORE } from './data/prefs';
import { TAB_IDENTITY } from './data/tab-id';
import { ENTITY_STORE_NAMES } from './data/stores';
import { REPOSITORY_TOKENS } from './data/tokens';
import { UNIT_OF_WORK } from './data/unit-of-work';

// Part of the composition root, alongside app.config.ts: the only place that
// binds data/ contracts to their infrastructure implementations. Extracted so
// the application and the test harness share one wiring rather than two copies
// that can drift. Enforced by eslint.config.js.
import { IdbPhotoBlobStore } from './infrastructure/blobs/idb-photo-blob-store';
import { IdbAppMetaStore } from './infrastructure/idb/idb-app-meta';
import { IdbDbEvents } from './infrastructure/idb/idb-db-events';
import { IdbEnvironment } from './infrastructure/idb/idb-environment';
import { IdbRepository } from './infrastructure/idb/idb-repository';
import { IdbUnitOfWork, StandaloneRepoContext } from './infrastructure/idb/idb-unit-of-work';
import { PrEngine } from './features/records/pr-engine';
import { LocalStoragePrefs } from './infrastructure/prefs/local-storage-prefs';
import { SessionTabIdentity } from './infrastructure/platform/session-tab-identity';
import { SystemClock } from './infrastructure/platform/system-clock';

/**
 * Every storage contract bound to its IndexedDB implementation.
 *
 * `options.clock` lets a test substitute a deterministic clock while keeping
 * the rest of the real stack, which is what makes feature stores testable
 * against genuine transactions instead of a fake that cannot roll back.
 */
export function provideDataLayer(options: { clock?: Provider } = {}): Provider[] {
  const repositories: Provider[] = ENTITY_STORE_NAMES.map((store) => ({
    provide: REPOSITORY_TOKENS[store],
    useFactory: () => new IdbRepository(store, inject(StandaloneRepoContext)),
  }));

  return [
    options.clock ?? { provide: CLOCK, useExisting: SystemClock },
    { provide: PREFS_STORE, useExisting: LocalStoragePrefs },
    { provide: DB_EVENTS, useExisting: IdbDbEvents },
    { provide: UNIT_OF_WORK, useExisting: IdbUnitOfWork },
    { provide: APP_META_STORE, useExisting: IdbAppMetaStore },
    { provide: ID_FACTORY, useExisting: IdbEnvironment },
    { provide: TAB_IDENTITY, useExisting: SessionTabIdentity },
    { provide: PHOTO_BLOB_STORE, useExisting: IdbPhotoBlobStore },
    // The seam Phase 5 declared, filled in by Phase 7. Bound here because
    // this is the composition root; nothing in data/ or features/ reaches for
    // the implementation directly.
    { provide: PR_DETECTOR, useExisting: PrEngine },
    ...repositories,
  ];
}
