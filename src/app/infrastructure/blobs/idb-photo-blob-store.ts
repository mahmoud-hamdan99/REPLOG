import { inject, Service } from '@angular/core';
import { CLOCK } from '../../data/clock';
import type { PhotoBlobStore } from '../../data/photo-blobs';
import type { PhotoBlob } from '../../domain/models/body';
import { IdbDatabase, storeOf } from '../idb/idb-database';

const STORE = 'photoBlobs' as const;

/**
 * Photo pixels in IndexedDB.
 *
 * Stored as an `ArrayBuffer` plus its media type rather than as a `Blob`: iOS
 * Safari has a long history of failing to persist Blobs in IndexedDB, and a
 * lost progress photo cannot be recovered. The API still speaks `Blob`, so
 * callers hand one in and get one back.
 *
 * Blobs are hard-deleted rather than tombstoned: a tombstoned 300 kB image
 * would hold storage the user believes they reclaimed, and on a device where
 * photos dominate the quota that is the opposite of helpful. The confirmation
 * dialog says the image cannot be recovered, which is the honest trade.
 */
@Service()
export class IdbPhotoBlobStore implements PhotoBlobStore {
  private readonly db = inject(IdbDatabase);
  private readonly clock = inject(CLOCK);

  async get(id: string): Promise<Blob | undefined> {
    const row = (await this.db.run([STORE], 'readonly', async (tx) =>
      storeOf(tx, STORE).get(id),
    )) as PhotoBlob | undefined;

    return row ? new Blob([row.data], { type: row.mimeType }) : undefined;
  }

  async put(id: string, blob: Blob): Promise<void> {
    // Read the bytes before opening the transaction: awaiting anything other
    // than an IndexedDB operation inside one lets it auto-commit underneath us.
    const data = await blob.arrayBuffer();
    const record: PhotoBlob = {
      id,
      data,
      mimeType: blob.type,
      byteSize: data.byteLength,
      createdAt: this.clock.nowIso(),
    };

    await this.db.run([STORE], 'readwrite', async (tx) => {
      await storeOf(tx, STORE).put(record);
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.run([STORE], 'readwrite', async (tx) => {
      await storeOf(tx, STORE).delete(id);
    });
  }

  async removeMany(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.run([STORE], 'readwrite', async (tx) => {
      const store = storeOf(tx, STORE);
      for (const id of ids) {
        await store.delete(id);
      }
    });
  }

  async ids(): Promise<string[]> {
    const keys = await this.db.run([STORE], 'readonly', async (tx) =>
      storeOf(tx, STORE).getAllKeys(),
    );
    return keys as string[];
  }

  /**
   * Sums sizes by walking the `by_byteSize` index with a key-only cursor, so
   * not one image is deserialised. Summing `data.byteLength` from the records
   * would pull the entire photo library into memory — tens of megabytes on a
   * modest account, on a device already short of it.
   */
  async totalBytes(): Promise<number> {
    return this.db.run([STORE], 'readonly', async (tx) => {
      let total = 0;
      let cursor = await storeOf(tx, STORE).index('by_byteSize').openKeyCursor();
      while (cursor) {
        total += typeof cursor.key === 'number' ? cursor.key : 0;
        cursor = await cursor.continue();
      }
      return total;
    });
  }
}
