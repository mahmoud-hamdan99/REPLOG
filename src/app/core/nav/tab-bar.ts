import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18n } from '../i18n/i18n.service';
import { Icon } from '../../shared/ui/icon';
import { TABS } from './nav.model';

/**
 * Bottom navigation.
 *
 * A real `<nav>` with anchors, so the platform supplies link semantics and
 * middle-click/long-press behaviour. The centre Train tab is visually elevated
 * but is still just a link.
 *
 * Phase 5 will switch the Train tab's label to "Resume" with a live elapsed
 * timer while a workout is in progress; the session store it needs does not
 * exist yet, so that state is deliberately absent rather than faked.
 */
@Component({
  selector: 'rl-tab-bar',
  styleUrl: './tab-bar.css',
  imports: [RouterLink, RouterLinkActive, Icon],
  template: `
    <nav class="tabs" [attr.aria-label]="i18n.t('nav.primaryLabel')">
      @for (tab of tabs; track tab.id) {
        <a
          class="tab"
          [class.tab--center]="tab.center"
          [routerLink]="tab.path"
          routerLinkActive="tab--active"
          [routerLinkActiveOptions]="{ exact: tab.exact ?? false }"
          #link="routerLinkActive"
          [attr.aria-current]="link.isActive ? 'page' : null"
        >
          <rl-icon class="tab__icon" [name]="tab.icon" [filled]="!!tab.center" />
          <span class="tab__label">{{ i18n.t(tab.labelKey) }}</span>
        </a>
      }
    </nav>
  `,
})
export class TabBar {
  protected readonly i18n = inject(I18n);
  protected readonly tabs = TABS;
}
