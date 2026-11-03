import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';

interface ProgressTab {
  path: string;
  titleKey: string;
}

/**
 * Order follows UI_UX_SPEC section 2, and lands on Strength because that is
 * what someone opening Progress after a session wants to see.
 */
const TABS: readonly ProgressTab[] = [
  { path: '/progress', titleKey: 'page.strength.title' },
  { path: '/progress/volume', titleKey: 'page.volume.title' },
  { path: '/progress/body', titleKey: 'page.bodyTrends.title' },
  { path: '/records', titleKey: 'page.records.title' },
  { path: '/photos', titleKey: 'page.photos.title' },
];

/**
 * Navigation between the Progress screens.
 *
 * The information architecture calls these "tabs inside Progress". They are
 * separate routes rather than state inside one component, so each keeps its
 * own URL, its own entry in history and its own back behaviour — a chart
 * someone wants to come back to is a place, not a mode.
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
