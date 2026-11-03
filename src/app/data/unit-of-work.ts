import { InjectionToken } from '@angular/core';
import type { AppMeta, AppMetaKey } from '../domain/models/system';
import type { Repository } from './repository';
import type { EntityStoreName, StoreEntityMap, StoreName } from './stores';

/**
 * App-local pointers inside a transaction.
 *
 * The same key/value table `AppMetaStore` exposes standalone, reachable here
 * because some pointers must move atomically with the records they point at:
 * clearing `activeWorkoutId` is part of finishing a workout, and a pointer
 * cleared by a transaction that then rolls back would orphan a live session.
 */
export interface TxAppMeta {
  get<K extends AppMetaKey>(key: K): Promise<AppMeta[K]>;
  set<K extends AppMetaKey>(key: K, value: AppMeta[K]): Promise<void>;
}

/**
 * Photo pixels inside a transaction.
 *
 * Both blobs and the metadata record that names them have to land together.
 * A metadata row whose pixels are missing renders a broken thumbnail the user
 * cannot explain, and a pair of orphaned blobs is a quarter of a megabyte the
 * storage meter counts and nothing can reclaim.
 *
 * Takes an `ArrayBuffer`, not a `Blob`, because reading a blob's bytes is an
 * await that is not an IndexedDB operation: do it inside the transaction and
 * the transaction commits underneath you. The caller reads the bytes first.
 */
export interface TxPhotoBlobs {
  put(id: string, data: ArrayBuffer, mimeType: string): Promise<void>;
  /** Hard delete — photo blobs are never tombstoned (DATABASE_SPEC 3.12). */
  remove(id: string): Promise<void>;
}

/**
 * A transaction scope.
 *
 * Repositories obtained here are bound to the transaction, so several
 * aggregates can be written atomically. Finishing a workout touches workouts,
 * workoutExercises, setLogs, personalRecords and appMeta, and must either
 * happen entirely or not at all: a personal-record bug may never be allowed to
 * destroy a logged session.
 */
export interface TxScope {
  repo<N extends EntityStoreName>(store: N): Repository<StoreEntityMap[N]>;

  /** Requires `'appMeta'` in the transaction's store list. */
  appMeta(): TxAppMeta;

  /** Requires `'photoBlobs'` in the transaction's store list. */
  blobs(): TxPhotoBlobs;

  /**
   * Runs after the transaction commits.
   *
   * Change notifications, toasts and navigation belong here. Firing them
   * mid-transaction would announce a result that can still roll back.
   */
  onCommit(fn: () => void): void;
}

export interface UnitOfWork {
  /**
   * Runs `work` inside one transaction over `stores`.
   *
   * The critical rule: do not await anything other than `TxScope` calls inside
   * `work`. An IndexedDB transaction auto-commits as soon as the microtask
   * queue drains, so awaiting a fetch, a timer, or any unrelated promise closes
   * the transaction and the next operation throws `TransactionInactiveError`.
   */
  run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: TxScope) => Promise<R>,
  ): Promise<R>;
}

export const UNIT_OF_WORK = new InjectionToken<UnitOfWork>('UNIT_OF_WORK');
