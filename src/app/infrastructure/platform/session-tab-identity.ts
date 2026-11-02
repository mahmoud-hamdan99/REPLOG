import { inject, Service } from '@angular/core';
import { ID_FACTORY } from '../../data/ids';
import type { TabIdentity } from '../../data/tab-id';

export const TAB_ID_KEY = 'replog.tabId';

/**
 * Tab identity held in `sessionStorage`.
 *
 * `sessionStorage` has exactly the lifetime wanted here: it is scoped to one
 * tab, survives a reload of that tab, and a newly opened tab starts empty. So
 * refreshing mid-workout keeps ownership of the session, while a second tab
 * opening the same session is correctly recognised as a second tab.
 *
 * Guarded like every other storage access: Safari throws in some
 * private-browsing and blocked-storage states, and the fallback — an id that
 * lasts as long as this page — is still correct for a single tab. It only
 * degrades the reload case, which beats failing to start.
 */
@Service()
export class SessionTabIdentity implements TabIdentity {
  private readonly ids = inject(ID_FACTORY);
  readonly tabId = this.resolve();

  private resolve(): string {
    try {
      const existing = sessionStorage.getItem(TAB_ID_KEY);
      if (existing !== null && existing !== '') {
        return existing;
      }
      const created = this.ids.newId();
      sessionStorage.setItem(TAB_ID_KEY, created);
      return created;
    } catch {
      return this.ids.newId();
    }
  }
}
