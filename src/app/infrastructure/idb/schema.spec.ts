import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../data/clock';
import { DB_EVENTS } from '../../data/db-events';
import { STORE_NAMES } from '../../data/stores';
import { IdbDatabase } from './idb-database';
import { IdbDbEvents } from './idb-db-events';
import { DB_NAME, DB_VERSION, STORES } from './schema';
import { FakeClock, deleteDatabase, setupIdb, type IdbHarness } from './testing/idb-test-kit';

describe('schema and migrations', () => {
  describe('version 1', () => {
    let h: IdbHarness;

    beforeEach(async () => {
      h = await setupIdb();
    });

    afterEach(async () => {
      await h.dispose();
    });

    it('creates every declared store', async () => {
      const db = await h.db.open();
      const created = [...db.objectStoreNames].sort();
      expect(created).toEqual([...STORES.map((s) => s.name)].sort());
    });

    it('declares a store for every name the data layer knows about', () => {
      // Guards against the schema and the StoreName union drifting apart.
      expect([...STORES.map((s) => s.name)].sort()).toEqual([...STORE_NAMES].sort());
    });

    it('creates every declared index with the right key path', async () => {
      const db = await h.db.open();
      const tx = db.transaction([...db.objectStoreNames], 'readonly');

      for (const definition of STORES) {
        const store = tx.objectStore(definition.name);
        const actual = [...store.indexNames].sort();
        const expected = [...definition.indexes.map((i) => i.name)].sort();
        expect(actual, `indexes on ${definition.name}`).toEqual(expected);

        for (const index of definition.indexes) {
          const live = store.index(index.name);
          const keyPath = Array.isArray(live.keyPath) ? [...live.keyPath] : live.keyPath;
          expect(keyPath, `${definition.name}.${index.name} key path`).toEqual(index.keyPath);
          expect(live.multiEntry, `${definition.name}.${index.name} multiEntry`).toBe(
            index.options?.multiEntry ?? false,
          );
        }
      }
      await tx.done;
    });

    it('reports the expected version', async () => {
      const db = await h.db.open();
      expect(db.version).toBe(DB_VERSION);
    });

    it('is idempotent across a close and reopen', async () => {
      await h.db.open();
      await h.db.close();
      const reopened = await h.db.open();
      expect([...reopened.objectStoreNames]).toHaveLength(STORES.length);
    });

    it('leaves the outbox empty, since Version 1 never writes to it', async () => {
      expect(await h.repo('outbox').count({ includeDeleted: true })).toBe(0);
    });
  });

  /**
   * Forward-only. Opening a database written by a newer build must not silently
   * downgrade it: fields this build does not know about would be dropped on the
   * next write. Safe mode keeps the data intact and export available.
   */
  describe('safe mode', () => {
    let db: IdbDatabase;

    beforeEach(async () => {
      await deleteDatabase();

      // Create a database at a version from the future, outside our own code.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('somethingNew', { keyPath: 'id' });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: CLOCK, useValue: new FakeClock() },
          { provide: DB_EVENTS, useExisting: IdbDbEvents },
        ],
      });
      db = TestBed.inject(IdbDatabase);
    });

    afterEach(async () => {
      await db.close();
      await deleteDatabase();
    });

    it('refuses to open a newer schema and records why', async () => {
      await expect(db.open()).rejects.toThrow(/newer version/i);
      expect(db.isSafeMode()).toBe(true);
      expect(db.safeMode()).toBe('future-schema');
    });

    it('blocks writes while in safe mode', async () => {
      await expect(db.open()).rejects.toThrow();
      await expect(db.run(['exercises'], 'readwrite', async () => undefined)).rejects.toThrow(
        /safe mode/i,
      );
    });
  });
});
