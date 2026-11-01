import type { IconName } from '../../shared/ui/icon';

export interface TabDef {
  id: string;
  /** Router path for the tab's root destination. */
  path: string;
  labelKey: string;
  icon: IconName;
  /** The elevated centre tab. Exactly one. */
  center?: boolean;
  /** Match only the exact path, for the root route. */
  exact?: boolean;
}

/**
 * The five bottom-bar destinations (docs/UI_UX_SPEC.md section 2).
 *
 * History lives under Home and More rather than taking a slot: users reach for
 * it after a session, not continuously. Body measurements and Photos are tabs
 * inside Progress for the same reason — weekly actions, not daily ones.
 */
export const TABS: readonly TabDef[] = [
  { id: 'home', path: '/', labelKey: 'nav.home', icon: 'home', exact: true },
  { id: 'plans', path: '/plans', labelKey: 'nav.plans', icon: 'plans' },
  { id: 'train', path: '/train', labelKey: 'nav.train', icon: 'train', center: true },
  { id: 'progress', path: '/progress', labelKey: 'nav.progress', icon: 'progress' },
  { id: 'more', path: '/settings', labelKey: 'nav.more', icon: 'more' },
];
