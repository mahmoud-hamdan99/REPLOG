import { Component, inject, input } from '@angular/core';
import { AppHeader } from '../../core/nav/app-header';
import { EmptyState } from '../../shared/ui/empty-state';
import { I18n } from '../../core/i18n/i18n.service';

/**
 * Stand-in for a screen that is routed but not yet built.
 *
 * It says so plainly rather than showing an empty page or mock data. `titleKey`
 * and `showBack` are bound from route data via `withComponentInputBinding()`.
 */
@Component({
  selector: 'rl-placeholder-page',
  imports: [AppHeader, EmptyState],
  template: `
    <rl-app-header [titleKey]="titleKey()" [showBack]="showBack()" />
    <div class="page">
      <rl-empty-state titleKey="placeholder.title" bodyKey="placeholder.body" />
    </div>
  `,
})
export class PlaceholderPage {
  protected readonly i18n = inject(I18n);

  readonly titleKey = input('app.name');
  readonly showBack = input(false);
}
