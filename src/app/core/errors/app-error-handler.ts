import { ErrorHandler, inject, Injectable, isDevMode } from '@angular/core';
import { DiagnosticsService } from './diagnostics.service';
import { toAppError } from './app-error';
import { I18n } from '../i18n/i18n.service';
import { ToastService } from '../toast/toast.service';

/**
 * Global error handler.
 *
 * Normalises whatever was thrown, records it in the diagnostics buffer, and
 * shows the user a human message. Nothing leaves the device: no telemetry, no
 * logging endpoint.
 *
 * Declared with `@Injectable` rather than `@Service` because it is wired
 * explicitly as the `ErrorHandler` provider, not auto-provided.
 */
@Injectable({ providedIn: 'root' })
export class AppErrorHandler implements ErrorHandler {
  private readonly diagnostics = inject(DiagnosticsService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);

  handleError(thrown: unknown): void {
    const error = toAppError(thrown);

    this.diagnostics.record({
      kind: error.kind,
      message: error.message,
      detail: error.detail,
    });

    // Validation errors belong on the field that produced them, not in a
    // toast; whatever threw is responsible for rendering it.
    if (error.kind !== 'validation') {
      this.toasts.error(this.i18n.t(error.messageKey ?? 'state.error.title'));
    }

    if (isDevMode()) {
      console.error('[AppError]', error.kind, error.message, error);
    }
  }
}
