import { InjectionToken } from '@angular/core';

/**
 * Identity of the browser tab this code is running in.
 *
 * Needed for the multi-tab guard in docs/ARCHITECTURE.md section 7.4: two tabs
 * writing to one active session would race and lose sets, so the session
 * records which tab owns it.
 *
 * The identity must **survive a reload of the same tab and differ between
 * tabs** — a freshly generated id would make every refresh look like a second
 * tab and lock the user out of their own workout for the heartbeat window.
 * That is per-tab session storage, not local storage and not a random value,
 * which is why this is a contract rather than a call to `crypto.randomUUID()`
 * in the store.
 */
export interface TabIdentity {
  readonly tabId: string;
}

export const TAB_IDENTITY = new InjectionToken<TabIdentity>('TAB_IDENTITY');
