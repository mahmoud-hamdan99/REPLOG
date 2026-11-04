import { Component, inject } from '@angular/core';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { Card } from '../../shared/ui/card';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import type { E1rmFormula, Prefs, TrackingMode } from '../../domain/models/prefs';

/** Preferences that are a plain on/off, with the sentence each one needs. */
interface ToggleRow {
  key: keyof Prefs;
  labelKey: string;
  hintKey?: string;
  /** False hides the row outright rather than showing a control that lies. */
  supported?: boolean;
}

/**
 * Workout preferences.
 *
 * Two rules shape this screen. A toggle for something the browser cannot do
 * is worse than no toggle, so keep-screen-awake and haptics are hidden where
 * the API is absent rather than shown switched off (UI_UX_SPEC section 7).
 * And a preference that changes how numbers are *derived* says so: switching
 * the 1RM formula rewrites every estimate on every screen, and the user is
 * told that their logged sets are untouched, because that is the thing they
 * would otherwise worry about.
 */
@Component({
  selector: 'rl-workout-settings-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Card, Segmented],
  template: `
    <rl-app-header titleKey="settings.workout.title" [showBack]="true" />

    <div class="page">
      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <label class="slider">
              <span class="slider__row">
                <span class="t-label">{{ i18n.t('settings.workout.rest') }}</span>
                <output class="t-stat-sm slider__value">{{ restLabel() }}</output>
              </span>
              <input
                class="slider__input"
                type="range"
                min="0"
                max="300"
                step="15"
                [value]="settings.prefs().defaultRestSec"
                (input)="setRest($any($event.target).value)"
              />
            </label>
            <p class="t-caption toggle__hint">{{ i18n.t('settings.workout.restHint') }}</p>
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          @for (row of toggles; track row.key) {
            @if (row.supported !== false) {
              <div class="group__control">
                <label class="toggle">
                  <input
                    class="toggle__input"
                    type="checkbox"
                    [checked]="isOn(row.key)"
                    (change)="setToggle(row.key, $any($event.target).checked)"
                  />
                  <span class="t-body">{{ i18n.t(row.labelKey) }}</span>
                </label>
                @if (row.hintKey) {
                  <p class="t-caption toggle__hint">{{ i18n.t(row.hintKey) }}</p>
                }
              </div>
            }
          }
        </rl-card>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="trackingMode"
              labelKey="settings.workout.trackingMode"
              [options]="modeOptions"
              [value]="settings.trackingMode()"
              (valueChange)="settings.set('trackingMode', $event)"
            />
            <p class="t-caption toggle__hint">
              {{ i18n.t('settings.workout.trackingModeHint') }}
            </p>
          </div>
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="e1rmFormula"
              labelKey="settings.workout.e1rm"
              [options]="formulaOptions"
              [value]="settings.prefs().e1rmFormula"
              (valueChange)="settings.set('e1rmFormula', $event)"
            />
            <p class="t-caption toggle__hint">{{ i18n.t('settings.workout.e1rmHint') }}</p>
          </div>
        </rl-card>
      </section>
    </div>
  `,
})
export class WorkoutSettingsPage {
  protected readonly settings = inject(SettingsStore);
  protected readonly i18n = inject(I18n);
  private readonly fmt = inject(DisplayFormat);

  protected readonly modeOptions: readonly SegmentedOption<TrackingMode>[] = [
    { value: 'simple', labelKey: 'mode.simple' },
    { value: 'advanced', labelKey: 'mode.advanced' },
  ];

  protected readonly formulaOptions: readonly SegmentedOption<E1rmFormula>[] = [
    { value: 'epley', labelKey: 'formula.epley' },
    { value: 'brzycki', labelKey: 'formula.brzycki' },
  ];

  protected readonly toggles: readonly ToggleRow[] = [
    { key: 'autoStartRestTimer', labelKey: 'settings.workout.autoStartRest' },
    { key: 'restTimerSound', labelKey: 'settings.workout.restSound' },
    {
      key: 'keepScreenAwake',
      labelKey: 'settings.workout.keepAwake',
      supported: supportsWakeLock(),
    },
    {
      key: 'hapticsEnabled',
      labelKey: 'settings.workout.haptics',
      supported: supportsVibration(),
    },
    { key: 'confirmBeforeFinish', labelKey: 'settings.workout.confirmFinish' },
    { key: 'showPreviousPerformance', labelKey: 'settings.workout.showPrevious' },
    {
      key: 'showSuggestions',
      labelKey: 'settings.workout.showSuggestions',
      hintKey: 'settings.workout.suggestionsHint',
    },
  ];

  protected restLabel(): string {
    return this.fmt.clock(this.settings.prefs().defaultRestSec);
  }

  protected setRest(raw: string): void {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) this.settings.set('defaultRestSec', Math.round(seconds));
  }

  protected isOn(key: keyof Prefs): boolean {
    return this.settings.prefs()[key] === true;
  }

  protected setToggle(key: keyof Prefs, value: boolean): void {
    this.settings.patch({ [key]: value } as Partial<Prefs>);
  }
}

/**
 * Both checks read the global directly, the way the tracker already does.
 *
 * Feature code may not reach into `infrastructure/`, and a one-line presence
 * test does not earn a port and an adapter; what matters is that the answer is
 * used to *hide* the control, so being wrong fails safe.
 */
function supportsWakeLock(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function supportsVibration(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
