import { inject, Service } from '@angular/core';
import { DB_EVENTS, type DbChange } from '../../data/db-events';
import type { EntityStoreName, StoreEntityMap, StoreName } from '../../data/stores';
import type { TxAppMeta, TxScope, UnitOfWork } from '../../data/unit-of-work';
import type { Repository } from '../../data/repository';
import { APP_META_DEFAULTS, type AppMeta, type AppMetaKey } from '../../domain/models/system';
import { IdbDatabase, storeOf, type AnyTransaction } from './idb-database';
import { IdbEnvironment } from './idb-environment';
import { IdbRepository, type RepoContext } from './idb-repository';

/**
 * `appMeta` access that joins the ambient transaction.
 *
 * Mirrors `IdbAppMetaStore`'s default-merging read, so a pointer that has never
 * been written reads as its default here too rather than as `undefined`.
 */
function boundAppMeta(tx: AnyTransaction): TxAppMeta {
  const store = storeOf(tx, 'appMeta');
  return {
    get: async <K extends AppMetaKey>(key: K): Promise<AppMeta[K]> => {
      const row = (await store.get(key)) as { value: unknown } | undefined;
      return (row?.value === undefined ? APP_META_DEFAULTS[key] : row.value) as AppMeta[K];
    },
    set: async <K extends AppMetaKey>(key: K, value: AppMeta[K]): Promise<void> => {
      await store.put({ key, value });
    },
  };
}

/**
 * Repository context for a *standalone* operation: each call gets its own
 * transaction, and because `IdbDatabase.run` awaits `tx.done`, a notification
 * emitted afterwards is always post-commit.
 */
@Service()
export class StandaloneRepoContext implements RepoContext {
  private readonly db = inject(IdbDatabase);
  private readonly env = inject(IdbEnvironment);
  private readonly events = inject(DB_EVENTS);

  run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: AnyTransaction) => Promise<R>,
  ): Promise<R> {
    return this.db.run(stores, mode, work);
  }

  nowIso(): string {
    return this.env.nowIso();
  }

  newId(): string {
    return this.env.newId();
  }

  origin(): string {
    return this.env.origin();
  }

  notify(change: DbChange): void {
    this.events.emit(change);
  }
}

@Service()
export class IdbUnitOfWork implements UnitOfWork {
  private readonly db = inject(IdbDatabase);
  private readonly env = inject(IdbEnvironment);
  private readonly events = inject(DB_EVENTS);

  async run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: TxScope) => Promise<R>,
  ): Promise<R> {
    const pendingChanges: DbChange[] = [];
    const commitHooks: (() => void)[] = [];

    const result = await this.db.run(stores, mode, async (tx) => {
      const context = this.boundContext(tx, pendingChanges);

      const scope: TxScope = {
        repo: <N extends EntityStoreName>(store: N): Repository<StoreEntityMap[N]> =>
          new IdbRepository<StoreEntityMap[N]>(store, context),
        appMeta: () => boundAppMeta(tx),
        onCommit: (fn) => {
          commitHooks.push(fn);
        },
      };

      return work(scope);
    });

    // Only reached once the transaction has committed. Anything that announces
    // a result — change events, toasts, navigation — waits until here, because
    // a rollback must leave no trace in the UI.
    for (const change of pendingChanges) {
      this.events.emit(change);
    }
    for (const hook of commitHooks) {
      hook();
    }

    return result;
  }

  /**
   * A context that joins the ambient transaction instead of opening its own,
   * and defers notifications to the commit.
   */
  private boundContext(tx: AnyTransaction, pending: DbChange[]): RepoContext {
    const env = this.env;
    return {
      run: <R>(
        _stores: readonly StoreName[],
        _mode: 'readonly' | 'readwrite',
        work: (tx: AnyTransaction) => Promise<R>,
      ): Promise<R> => work(tx),
      nowIso: () => env.nowIso(),
      newId: () => env.newId(),
      origin: () => env.origin(),
      notify: (change) => {
        pending.push(change);
      },
    };
  }
}
