import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { setupIdb, type IdbHarness } from '../idb/testing/idb-test-kit';
import { IdbPhotoBlobStore } from './idb-photo-blob-store';

const blobOf = (text: string): Blob => new Blob([text], { type: 'image/webp' });

describe('IdbPhotoBlobStore', () => {
  let h: IdbHarness;
  let blobs: IdbPhotoBlobStore;

  beforeEach(async () => {
    h = await setupIdb();
    blobs = TestBed.inject(IdbPhotoBlobStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  it('round-trips a blob', async () => {
    await blobs.put('b1', blobOf('pixels'));

    const stored = await blobs.get('b1');
    expect(stored).toBeDefined();
    expect(stored?.type).toBe('image/webp');
    expect(await stored?.text()).toBe('pixels');
  });

  it('returns undefined for an unknown id', async () => {
    expect(await blobs.get('missing')).toBeUndefined();
  });

  it('replaces an existing blob', async () => {
    await blobs.put('b1', blobOf('first'));
    await blobs.put('b1', blobOf('second'));

    expect(await (await blobs.get('b1'))?.text()).toBe('second');
    expect(await blobs.ids()).toEqual(['b1']);
  });

  /**
   * Photo blobs are hard-deleted, never tombstoned: a tombstoned image would
   * hold storage the user believes they reclaimed.
   */
  it('hard-deletes rather than tombstoning', async () => {
    await blobs.put('b1', blobOf('pixels'));
    await blobs.remove('b1');

    expect(await blobs.get('b1')).toBeUndefined();
    expect(await blobs.ids()).toEqual([]);
    expect(await blobs.totalBytes()).toBe(0);
  });

  it('removes several blobs at once', async () => {
    await blobs.put('b1', blobOf('a'));
    await blobs.put('b2', blobOf('b'));
    await blobs.put('b3', blobOf('c'));

    await blobs.removeMany(['b1', 'b3']);
    expect(await blobs.ids()).toEqual(['b2']);
  });

  it('ignores an empty removal list', async () => {
    await blobs.put('b1', blobOf('a'));
    await expect(blobs.removeMany([])).resolves.toBeUndefined();
    expect(await blobs.ids()).toEqual(['b1']);
  });

  it('removing an absent blob is not an error', async () => {
    await expect(blobs.remove('missing')).resolves.toBeUndefined();
  });

  it('sums stored bytes for the storage meter', async () => {
    await blobs.put('b1', blobOf('12345'));
    await blobs.put('b2', blobOf('678'));

    expect(await blobs.totalBytes()).toBe(8);
  });

  it('reports zero bytes when empty', async () => {
    expect(await blobs.totalBytes()).toBe(0);
  });

  it('lists ids without materialising the blobs', async () => {
    await blobs.put('b1', blobOf('a'));
    await blobs.put('b2', blobOf('b'));
    expect((await blobs.ids()).sort()).toEqual(['b1', 'b2']);
  });
});
