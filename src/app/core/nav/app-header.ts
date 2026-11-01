import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../i18n/i18n.service';
import { Icon } from '../../shared/ui/icon';

/**
 * Sticky page header: optional back button, title, one trailing action slot.
 *
 * The title truncates to a single line and never wraps; a two-line header
 * would shift the content below it as the user navigates.
 */
@Component({
  selector: 'rl-app-header',
  styleUrl: './app-header.css',
  imports: [Icon],
  template: `
    <header class="hdr">
      @if (showBack()) {
        <button
          type="button"
          class="hdr__back"
          [attr.aria-label]="i18n.t('common.back')"
          (click)="goBack()"
        >
          <rl-icon name="chevron" />
        </button>
      }
      <h1 class="t-h1 hdr__title">{{ i18n.t(titleKey()) }}</h1>
      <div class="hdr__actions">
        <ng-content />
      </div>
    </header>
  `,
})
export class AppHeader {
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  readonly titleKey = input.required<string>();
  readonly showBack = input(false);

  protected goBack(): void {
    // History back, not a hardcoded parent route: the user's own path back is
    // almost always the one they expect.
    if (globalThis.history.length > 1) {
      globalThis.history.back();
    } else {
      void this.router.navigate(['/']);
    }
  }
}
