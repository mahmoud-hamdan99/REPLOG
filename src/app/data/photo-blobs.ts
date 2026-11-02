import { InjectionToken } from '@angular/core';

/**
 * Raw photo pixels.
 *
 * Separate from `photos` metadata so the gallery can list hundreds of entries
 * without materialising a single blob, and separate from the repository
 * abstraction because a blob carries no envelope and is addressed only by the
 * metadata record that owns it.
 *
 * In Version 2 this interface is the seam for cloud storage: the implementation
 * changes, the contract does not.
 */
export interface PhotoBlobStore {
  get(id: string): Promise<Blob | undefined>;
  put(id: string, blob: Blob): Promise<void>;
  /** Hard delete. Photo blobs are never tombstoned — see DATABASE_SPEC 3.12. */
  remove(id: string): Promise<void>;
  removeMany(ids: readonly string[]): Promise<void>;
  /** Every stored blob id, for orphan detection during an integrity check. */
  ids(): Promise<string[]>;
  /** Total bytes held, for the storage meter. */
  totalBytes(): Promise<number>;
}

export const PHOTO_BLOB_STORE = new InjectionToken<PhotoBlobStore>('PHOTO_BLOB_STORE');
