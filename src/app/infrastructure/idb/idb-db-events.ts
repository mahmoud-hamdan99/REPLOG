import { DestroyRef, inject, Service } from '@angular/core';
import type { DbChange, DbEvents } from '../../data/db-events';

const CHANNEL_NAME = 'replog-db';

/**
 * Post-commit change notification, relayed across tabs.
 *
 * Two tabs open on the same database is a normal accident — a user opens the
 * app, then opens it again from the home screen. Without a relay the second tab
 * would show stale lists indefinitely, because IndexedDB has no change feed.
 *
 * The relay carries only store names and ids, never record contents: a
 * listener re-reads from the database, which keeps the message small and means
 * a tab can never render a value that was rolled back.
 */
@Service()
export class IdbDbEvents implements DbEvents {
  private readonly listeners = new Set<(change: DbChange) => void>();
  private readonly channel = openChannel();

  constructor() {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<DbChange>) => {
        // Arrived from another tab: deliver locally, never echo it back.
        this.deliver({ ...event.data, local: false });
      };
    }
    inject(DestroyRef).onDestroy(() => this.channel?.close());
  }

  emit(change: DbChange): void {
    this.deliver(change);
    if (change.local) {
      try {
        this.channel?.postMessage(change);
      } catch {
        // A structured-clone failure must not fail the write that just
        // succeeded; the other tab simply stays stale until it re-reads.
      }
    }
  }

  subscribe(listener: (change: DbChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private deliver(change: DbChange): void {
    for (const listener of [...this.listeners]) {
      listener(change);
    }
  }
}

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null;
  }
}
