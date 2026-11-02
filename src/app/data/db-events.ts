import { InjectionToken } from '@angular/core';
import type { StoreName } from './stores';

export interface DbChange {
  store: StoreName;
  ids: readonly string[];
  kind: 'put' | 'remove' | 'bulk' | 'clear';
  /** False when the change arrived from another tab via the relay. */
  local: boolean;
}

/**
 * Post-commit change notification.
 *
 * Decouples writes from cache invalidation: a store that caches a list
 * subscribes and invalidates rather than every writer knowing who to tell. It
 * is also the seam a Version 2 realtime feed plugs into, since a remote change
 * looks the same to a subscriber as a local one.
 *
 * Discrete events rather than a signal: a signal models current state, and
 * "record X changed" is not state — two identical consecutive changes must both
 * be delivered.
 */
export interface DbEvents {
  emit(change: DbChange): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (change: DbChange) => void): () => void;
}

export const DB_EVENTS = new InjectionToken<DbEvents>('DB_EVENTS');
