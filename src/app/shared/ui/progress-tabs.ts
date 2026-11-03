import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';

interface ProgressTab {
  path: string;
  titleKey: string;
}

/**
 * Order follows UI_UX_SPEC section 2: Records first because it is what the
 * Progress tab lands on, then the two logs behind it.
 */
const TABS: readonly ProgressTab[] = [
  { path: '/progress', titleKey: 'page.records.title' },
  { path: '/body', titleKey: 'page.body.title' },
  { path: '/photos', titleKey: 'page.photos.title' },
];

/**
 * Navigation between the Progress screens.
 *
 * The information architecture calls Measurements and Photos "tabs inside
 * Progress", and until Phase 10 builds the analytics hub that holds them,
 * they were three routes with nothing linking to them — reachable only by
 * typing a URL, which on a phone means not reachable. This is the smallest
 * thing that makes them a group; Phase 10 replaces it with the real hub.
 *
 * Links rather than buttons, so each screen keeps its own URL, its own back
 * behaviour and its own place in history.
 */
@Component({
  selector: 'rl-progress-tabs',
  styleUrl: './progress-tabs.css',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="pt" [attr.aria-label]="i18n.t('page.progress.title')">
      @for (tab of tabs; track tab.path) {
        <a
          class="pt__tab t-label"
          [routerLink]="tab.path"
          routerLinkActive="pt__tab--active"
          [routerLinkActiveOptions]="{ exact: true }"
          ariaCurrentWhenActive="page"
        >
          {{ i18n.t(tab.titleKey) }}
        </a>
      }
    </nav>
  `,
})
export class ProgressTabs {
  protected readonly i18n = inject(I18n);
  protected readonly tabs = TABS;
}
