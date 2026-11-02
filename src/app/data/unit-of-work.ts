import { InjectionToken } from '@angular/core';
import type { Repository } from './repository';
import type { EntityStoreName, StoreEntityMap, StoreName } from './stores';

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
