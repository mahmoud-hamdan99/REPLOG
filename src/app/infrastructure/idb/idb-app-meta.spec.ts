import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { APP_META_DEFAULTS } from '../../domain/models/system';
import { storeOf } from './idb-database';
import { IdbAppMetaStore } from './idb-app-meta';
import { setupIdb, type IdbHarness } from './testing/idb-test-kit';

describe('IdbAppMetaStore', () => {
  let h: IdbHarness;
  let meta: IdbAppMetaStore;

  beforeEach(async () => {
    h = await setupIdb();
    meta = TestBed.inject(IdbAppMetaStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  it('returns defaults for a database that has never been written', async () => {
    expect(await meta.readAll()).toEqual(APP_META_DEFAULTS);
  });

  it('falls back to the default for a single unset key', async () => {
    expect(await meta.get('activeWorkoutId')).toBeNull();
    expect(await meta.get('builtInCatalogVersion')).toBe(0);
  });

  it('round-trips a value', async () => {
    await meta.set('activeWorkoutId', 'workout-42');
    expect(await meta.get('activeWorkoutId')).toBe('workout-42');
  });

  it('round-trips a structured value', async () => {
    const tab = { tabId: 'tab-1', heartbeatAt: '2026-03-02T18:00:00.000Z' };
    await meta.set('activeTab', tab);
    expect(await meta.get('activeTab')).toEqual(tab);
  });

  it('distinguishes a stored null from an unset key', async () => {
    await meta.set('activeWorkoutId', 'workout-42');
    await meta.set('activeWorkoutId', null);
    expect(await meta.get('activeWorkoutId')).toBeNull();
  });

  it('merges stored values over defaults when reading everything', async () => {
    await meta.set('deviceId', 'device-abc');
    const all = await meta.readAll();

    expect(all.deviceId).toBe('device-abc');
    // Untouched keys still carry their defaults rather than undefined.
    expect(all.builtInCatalogVersion).toBe(APP_META_DEFAULTS.builtInCatalogVersion);
    expect(all.activePlanId).toBeNull();
  });

  it('patches several keys in one transaction', async () => {
    await meta.patch({ deviceId: 'd1', activePlanId: 'p1', schemaVersion: 1 });
    const all = await meta.readAll();

    expect(all.deviceId).toBe('d1');
    expect(all.activePlanId).toBe('p1');
    expect(all.schemaVersion).toBe(1);
  });

  it('ignores an empty patch', async () => {
    await expect(meta.patch({})).resolves.toBeUndefined();
    expect(await meta.readAll()).toEqual(APP_META_DEFAULTS);
  });

  /**
   * A key written by a newer build must not leak into application code as an
   * unrecognised field; readAll only surfaces keys the current build declares.
   */
  it('drops keys it does not recognise', async () => {
    await h.db.run(['appMeta'], 'readwrite', async (tx) => {
      await storeOf(tx, 'appMeta').put({ key: 'fromTheFuture', value: 'surprise' });
    });

    const all = await meta.readAll();
    expect('fromTheFuture' in all).toBe(false);
    expect(all).toEqual(APP_META_DEFAULTS);
  });
});
