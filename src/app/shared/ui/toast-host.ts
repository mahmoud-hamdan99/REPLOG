import { Component, inject } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/toast/toast.service';

/**
 * Renders the toast stack. Mounted once, by the shell.
 *
 * The container is a polite live region so a confirmation is announced without
 * interrupting; errors are announced assertively via `role="alert"` on the
 * individual toast. Announcing the whole stack assertively would talk over the
 * user mid-set.
 */
@Component({
  selector: 'rl-toast-host',
  styleUrl: './toast-host.css',
  template: `
    <div class="toasts" aria-live="polite" aria-relevant="additions">
      @for (toast of toasts.toasts(); track toast.id) {
        <div
          class="toast"
          [class]="'toast--' + toast.kind"
          [attr.role]="toast.kind === 'error' ? 'alert' : null"
        >
          <span class="toast__message">{{ toast.message }}</span>
          @if (toast.action) {
            <button type="button" class="toast__action" (click)="toast.action!.run()">
              {{ i18n.t(toast.action.labelKey) }}
            </button>
          }
          <button
            type="button"
            class="toast__close"
            [attr.aria-label]="i18n.t('common.dismiss')"
            (click)="toasts.dismiss(toast.id)"
          >
            &#215;
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
  protected readonly i18n = inject(I18n);
}
