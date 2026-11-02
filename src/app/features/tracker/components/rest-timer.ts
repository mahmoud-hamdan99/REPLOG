import { Component, computed, inject, input, model, output } from '@angular/core';
import { I18n } from '../../../core/i18n/i18n.service';
import { SettingsStore } from '../../../core/settings/settings.store';
import { REST_ADJUST_SEC } from '../../../domain/tracker/rest';
import { Button } from '../../../shared/ui/button';
import { ProgressRing } from '../../../shared/ui/progress-ring';
import { Sheet } from '../../../shared/ui/sheet';
import { TrackerFormat } from '../tracker-format.service';

/**
 * Rest timer sheet.
 *
 * A half-height sheet so the set grid stays visible behind it, and the
 * countdown is derived from `startedAt + targetSec` rather than ticked, so
 * backgrounding and screen lock cannot desynchronise it.
 *
 * **The stated limitation** (PRODUCT_SPEC section 9): iOS gives a web app no
 * reliable way to fire an alert while it is backgrounded or the screen is
 * locked. So the sheet says so, in place, next to the one thing that does help
 * — Screen Wake Lock — and that toggle is hidden entirely where the API is
 * absent rather than offered as a lie.
 */
@Component({
  selector: 'rl-rest-timer',
  styleUrl: './rest-timer.css',
  imports: [Button, ProgressRing, Sheet],
  template: `
    <rl-sheet [(open)]="open" labelKey="tracker.rest.title">
      <div class="rest">
        <rl-progress-ring class="rest__ring" [value]="progress()" [size]="168" [stroke]="10">
          <span class="rest__time t-stat-xl">{{ format.clock(remainingSec()) }}</span>
          <span class="rest__label t-caption">
            {{ isDone() ? i18n.t('tracker.rest.done') : i18n.t('tracker.rest.remaining') }}
          </span>
        </rl-progress-ring>

        <p class="rest__next t-body">{{ nextText() }}</p>

        <div class="rest__controls">
          <rl-button variant="secondary" (click)="adjusted.emit(-step)">
            {{ i18n.t('tracker.rest.minus', stepParam()) }}
          </rl-button>
          <rl-button variant="secondary" (click)="adjusted.emit(step)">
            {{ i18n.t('tracker.rest.plus', stepParam()) }}
          </rl-button>
          <rl-button variant="ghost" (click)="skipped.emit()">
            {{ i18n.t('tracker.rest.skip') }}
          </rl-button>
        </div>

        @if (wakeLockSupported) {
          <label class="rest__awake">
            <input
              type="checkbox"
              [checked]="settings.prefs().keepScreenAwake"
              (change)="toggleAwake($any($event.target).checked)"
            />
            <span class="t-body">{{ i18n.t('tracker.rest.keepAwake') }}</span>
          </label>
        }

        <p class="rest__note t-caption">{{ i18n.t('tracker.rest.backgroundNote') }}</p>
      </div>
    </rl-sheet>
  `,
})
export class RestTimer {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(TrackerFormat);
  protected readonly settings = inject(SettingsStore);
  protected readonly step = REST_ADJUST_SEC;

  readonly open = model(false);
  readonly remainingSec = input.required<number>();
  readonly progress = input.required<number>();
  readonly isDone = input(false);
  /** Already-translated "Next: Incline DB, set 4", or null at the last set. */
  readonly nextText = input<string>('');

  readonly adjusted = output<number>();
  readonly skipped = output<void>();

  /**
   * Feature-detected, not assumed.
   *
   * Wake Lock landed in iOS 16.4 and is still absent in some browsers. Showing
   * a toggle that cannot do anything would be exactly the kind of promise
   * PRODUCT_SPEC section 9 forbids.
   */
  protected readonly wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  /** The step rendered in the locale's numerals, not baked into the string. */
  protected stepParam(): Record<string, string> {
    return { seconds: this.i18n.formatNumber(this.step) };
  }

  protected toggleAwake(enabled: boolean): void {
    this.settings.set('keepScreenAwake', enabled);
  }
}

/**
 * The compact pill that replaces the sheet once it is dismissed.
 *
 * The sheet can be swiped away while the timer keeps running; the pill is how
 * the user gets back to it, and how they can still see the countdown while
 * logging the next exercise.
 */
@Component({
  selector: 'rl-rest-pill',
  styleUrl: './rest-timer.css',
  template: `
    <button
      type="button"
      class="pill"
      [class.pill--done]="isDone()"
      [attr.aria-label]="i18n.t('tracker.rest.title')"
      (click)="opened.emit()"
    >
      <span aria-hidden="true">&#9201;</span>
      <span class="pill__time">{{ format.clock(remainingSec()) }}</span>
    </button>

    <!-- Assertive because it is the only cue that rest is over while the sheet
         is closed, and it has to interrupt what the screen reader is saying. -->
    <span class="sr-only" role="status" aria-live="assertive">{{ announcement() }}</span>
  `,
})
export class RestPill {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(TrackerFormat);

  readonly remainingSec = input.required<number>();
  readonly isDone = input(false);

  readonly opened = output<void>();

  protected readonly announcement = computed(() =>
    this.isDone() ? this.i18n.t('tracker.rest.done') : '',
  );
}
