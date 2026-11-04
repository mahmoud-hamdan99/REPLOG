import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APP_META_STORE } from '../../data/app-meta';
import { CLOCK } from '../../data/clock';
import { I18n } from '../i18n/i18n.service';
import { Button } from '../../shared/ui/button';

/**
 * The one-time storage-durability notice (DATABASE_SPEC section 9.4).
 *
 * Shown once, acknowledged once, recorded in `appMeta`. It exists because the
 * honest version of "your data never leaves your device" has a second half —
 * *and the browser may delete it* — and a user who only hears the first half
 * has been misled by omission. Saying it at the start costs one dismissal;
 * not saying it costs somebody their training history.
 *
 * A card above the dashboard rather than a modal: nothing here needs an
 * answer before the app can be used, and a dialog on first launch is the
 * fastest way to teach someone to dismiss dialogs without reading them.
 */
@Component({
  selector: 'rl-first-run-notice',
  styleUrl: './first-run-notice.css',
  imports: [Button, RouterLink],
  template: `
    @if (visible()) {
      <section class="notice" role="note">
        <h2 class="t-h3 notice__title">{{ i18n.t('firstRun.title') }}</h2>
        <p class="t-body notice__body">{{ i18n.t('firstRun.body') }}</p>
        <div class="notice__actions">
          <rl-button variant="primary" routerLink="/settings/data" (click)="acknowledge()">
            {{ i18n.t('firstRun.action') }}
          </rl-button>
          <rl-button variant="ghost" (click)="acknowledge()">
            {{ i18n.t('firstRun.dismiss') }}
          </rl-button>
        </div>
      </section>
    }
  `,
})
export class FirstRunNotice {
  protected readonly i18n = inject(I18n);
  private readonly meta = inject(APP_META_STORE);
  private readonly clock = inject(CLOCK);

  protected readonly visible = signal(false);

  constructor() {
    void this.check();
  }

  private async check(): Promise<void> {
    try {
      this.visible.set((await this.meta.get('storageWarningAcknowledgedAt')) === null);
    } catch {
      // Safe mode, or storage blocked. The notice is about storage; if we
      // cannot read storage there is nothing useful to say here, and the
      // database's own error state is already on screen.
      this.visible.set(false);
    }
  }

  protected async acknowledge(): Promise<void> {
    // Hidden immediately and recorded after: the write can fail in safe mode,
    // and a notice that refuses to go away because of that would be worse
    // than one shown twice.
    this.visible.set(false);
    try {
      await this.meta.set('storageWarningAcknowledgedAt', this.clock.nowIso());
    } catch {
      // Nothing to do. It will be offered again next launch.
    }
  }
}
