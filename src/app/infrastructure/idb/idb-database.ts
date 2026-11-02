import { computed, Service, signal } from '@angular/core';
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { migrationError, storageError, toAppError } from '../../core/errors/app-error';
import type { StoreName } from '../../data/stores';
import { runMigrations } from './migrations';
import type { UpgradeTransaction } from './migrations/v1';
import { DB_NAME, DB_VERSION } from './schema';

export type AnyTransaction = IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>;

/**
 * The slice of the IndexedDB surface this app uses.
 *
 * `idb`'s generics collapse to possibly-undefined members when the schema type
 * is `unknown`, and declaring a full `DBSchema` would duplicate schema.ts as a
 * second source of truth that could silently drift from the real stores. A
 * narrow structural type keeps one schema definition and stays honest about
 * what is actually called.
 */
export interface IdbCursorLike {
  readonly value: unknown;
  continue(): Promise<IdbCursorLike | null>;
}

/** A key-only cursor: yields keys without deserialising record values. */
export interface IdbKeyCursorLike {
  readonly key: IDBValidKey;
  readonly primaryKey: IDBValidKey;
  continue(): Promise<IdbKeyCursorLike | null>;
}

export interface IdbQuerySource {
  count(range?: IDBKeyRange): Promise<number>;
  openCursor(range?: IDBKeyRange, direction?: IDBCursorDirection): Promise<IdbCursorLike | null>;
  openKeyCursor(
    range?: IDBKeyRange,
    direction?: IDBCursorDirection,
  ): Promise<IdbKeyCursorLike | null>;
}

export interface IdbStoreLike extends IdbQuerySource {
  get(key: IDBValidKey): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  getAllKeys(): Promise<IDBValidKey[]>;
  put(value: unknown): Promise<unknown>;
  delete(key: IDBValidKey): Promise<unknown>;
  clear(): Promise<unknown>;
  index(name: string): IdbQuerySource;
}

/** Typed accessor for a store inside a transaction. */
export function storeOf(tx: AnyTransaction, name: StoreName): IdbStoreLike {
  return tx.objectStore(name) as unknown as IdbStoreLike;
}

export type SafeModeReason = 'future-schema' | 'migration-failed';

/**
 * Runs `work` inside one transaction. The unit of work and every repository go
 * through this, so there is a single place that owns transaction lifetime.
 */
export interface TxRunner {
  run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: AnyTransaction) => Promise<R>,
  ): Promise<R>;
}

/**
 * The only class that knows about IndexedDB.
 *
 * Owns opening, upgrading, transaction lifetime and error mapping. Nothing
 * above the infrastructure layer may import it; eslint enforces that.
 */
@Service()
export class IdbDatabase implements TxRunner {
  private handle: Promise<IDBPDatabase<unknown>> | null = null;
  private readonly _safeMode = signal<SafeModeReason | null>(null);
  private readonly _blocked = signal(false);

  /**
   * Non-null when the database cannot be used for writing.
   *
   * Entered when the stored schema is newer than this build understands — the
   * user opened an older version — or when a migration failed. The app then
   * goes read-only with export enabled. Silently truncating data written by a
   * newer build would be the worst possible outcome.
   */
  readonly safeMode = this._safeMode.asReadonly();
  readonly isSafeMode = computed(() => this._safeMode() !== null);

  /** True while another tab holds an older version open and blocks an upgrade. */
  readonly isBlocked = this._blocked.asReadonly();

  async open(): Promise<IDBPDatabase<unknown>> {
    this.handle ??= this.doOpen();
    try {
      return await this.handle;
    } catch (error) {
      // Allow a later retry (for example after the user closes the other tab).
      this.handle = null;
      throw error;
    }
  }

  private async doOpen(): Promise<IDBPDatabase<unknown>> {
    try {
      return await openDB<unknown>(DB_NAME, DB_VERSION, {
        upgrade: (db, oldVersion, newVersion, tx) => {
          try {
            runMigrations(db, tx as UpgradeTransaction, oldVersion, newVersion ?? DB_VERSION);
          } catch (error) {
            // Throwing here aborts the version-change transaction and rejects
            // the open, which is what we want: a half-migrated schema is worse
            // than no upgrade at all.
            this._safeMode.set('migration-failed');
            throw migrationError('Database upgrade failed', { cause: error });
          }
        },
        blocked: () => {
          // Another tab is holding the old version open.
          this._blocked.set(true);
        },
        blocking: () => {
          // We are the old version and something else wants to upgrade. Close
          // so the other tab can proceed rather than deadlocking both.
          void this.close();
        },
        terminated: () => {
          this.handle = null;
        },
      });
    } catch (error) {
      if (isVersionError(error)) {
        // The stored database is newer than this build. Forward-only means we
        // must not open it at a lower version and risk dropping fields.
        this._safeMode.set('future-schema');
        throw migrationError(
          'This device holds data from a newer version of REPLOG. ' +
            'Update the app, or export a backup before continuing.',
          { cause: error, retryable: false },
        );
      }
      throw toAppError(error);
    }
  }

  async run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: AnyTransaction) => Promise<R>,
  ): Promise<R> {
    if (mode === 'readwrite' && this._safeMode() !== null) {
      throw migrationError('REPLOG is in safe mode; writing is disabled.', { retryable: false });
    }

    const db = await this.open();
    const tx = db.transaction(stores as string[], mode) as AnyTransaction;

    // Claim tx.done's rejection immediately. Aborting below makes it reject,
    // and an unclaimed rejection surfaces as an unhandled promise rejection
    // that has nothing to do with the real failure.
    const settled = tx.done.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    try {
      const result = await work(tx);

      // Surfaces an abort or a quota failure that only appears at commit time.
      const outcome = await settled;
      if (!outcome.ok) {
        throw outcome.error;
      }
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Already aborted or already committed; the original error is what matters.
      }
      // Wait for the abort to land, then report the cause rather than the
      // AbortError it produced.
      await settled;
      throw mapTransactionError(error);
    }
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      try {
        (await handle).close();
      } catch {
        // Already closed.
      }
    }
  }

  /** Clears the blocked flag once the conflicting tab has gone away. */
  acknowledgeUnblocked(): void {
    this._blocked.set(false);
  }
}

function isVersionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'VersionError';
}

function mapTransactionError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return storageError('Storage is full', {
      cause: error,
      detail: error.message,
      retryable: false,
    });
  }
  return toAppError(error);
}
