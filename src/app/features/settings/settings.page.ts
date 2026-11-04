import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { PwaService } from '../../core/pwa/pwa.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ListRow } from '../../shared/ui/list-row';
import { SectionHeader } from '../../shared/ui/section-header';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import type { Language, ReduceMotionPreference, ThemePreference } from '../../domain/models/prefs';

/**
 * Settings.
 *
 * A hub, per UI_UX_SPEC section 5.12. The split is by how a preference
 * behaves, not by how many there are: the ones that change the app the instant
 * they are touched — theme, language, motion — stay on this screen so the
 * change is visible in the act of making it. A language switch that flipped
 * the whole interface to Arabic while the user was looking at a sub-screen
 * would be a worse demonstration of itself.
 *
 * Everything with more than a handful of controls, or that writes to the
 * database rather than to preferences, gets a screen of its own.
 */
@Component({
  selector: 'rl-settings-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Button, Card, ListRow, SectionHeader, Segmented],
  template: `
    <rl-app-header titleKey="page.settings.title" />

    <div class="page">
      <!-- A held update waits here. The toast that offered it has long since
           gone, and an update nobody can find again is an update nobody
           applies. -->
      @if (pwa.updateReady()) {
        <section class="group">
          <rl-card>
            <rl-section-header titleKey="update.title" />
            <p class="t-body group__note">{{ i18n.t('update.body') }}</p>
            <rl-button variant="primary" [full]="true" (click)="pwa.apply()">
              {{ i18n.t('update.reload') }}
            </rl-button>
          </rl-card>
        </section>
      }

      <section class="group">
        <rl-section-header titleKey="settings.appearance.title" />
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="theme"
              labelKey="settings.appearance.theme"
              [options]="themeOptions"
              [value]="settings.themePreference()"
              (valueChange)="settings.set('theme', $event)"
            />
          </div>
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="reduceMotion"
              labelKey="settings.appearance.reduceMotion"
              [options]="motionOptions"
              [value]="settings.reduceMotion()"
              (valueChange)="settings.set('reduceMotion', $event)"
            />
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-section-header titleKey="settings.language.title" />
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              name="language"
              labelKey="settings.language.title"
              [options]="languageOptions"
              [value]="settings.language()"
              (valueChange)="settings.set('language', $event)"
            />
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-section-header titleKey="settings.photos.title" />
        <rl-card [inset]="false">
          <div class="group__control">
            <label class="toggle">
              <input
                class="toggle__input"
                type="checkbox"
                [checked]="settings.prefs().blurPhotos"
                (change)="settings.set('blurPhotos', $any($event.target).checked)"
              />
              <span class="t-body">{{ i18n.t('settings.photos.blur') }}</span>
            </label>
            <!-- The honest part. UI_UX_SPEC section 7 asks the app to say what
                 it does not do, and a blur that read as a lock would be worse
                 than no blur at all. -->
            <p class="t-caption toggle__hint">{{ i18n.t('settings.photos.blurHint') }}</p>
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          @for (row of rows; track row.path) {
            <rl-list-row
              [labelKey]="row.labelKey"
              [valueText]="row.value?.()"
              variant="nav"
              (pressed)="go(row.path)"
            />
          }
        </rl-card>
      </section>
    </div>
  `,
})
export class SettingsPage {
  protected readonly pwa = inject(PwaService);
  protected readonly settings = inject(SettingsStore);
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  protected readonly themeOptions: readonly SegmentedOption<ThemePreference>[] = [
    { value: 'system', labelKey: 'theme.system' },
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
  ];

  protected readonly motionOptions: readonly SegmentedOption<ReduceMotionPreference>[] = [
    { value: 'system', labelKey: 'reduceMotion.system' },
    { value: 'always', labelKey: 'reduceMotion.always' },
    { value: 'never', labelKey: 'reduceMotion.never' },
  ];

  protected readonly languageOptions: readonly SegmentedOption<Language>[] = [
    { value: 'en', labelKey: 'language.en' },
    { value: 'ar', labelKey: 'language.ar' },
  ];

  /**
   * The rows that lead somewhere else.
   *
   * Units carries its own summary, because "kg · cm" is the answer to the
   * question the row asks and saves a trip into the screen to find out.
   */
  protected readonly rows: readonly {
    path: string;
    labelKey: string;
    value?: () => string;
  }[] = [
    { path: '/settings/profile', labelKey: 'settings.profile.title' },
    {
      path: '/settings/units',
      labelKey: 'settings.units.title',
      value: () =>
        this.i18n.join([
          this.i18n.t(`unit.short.${this.settings.weightUnit()}`),
          this.i18n.t(`unit.short.${this.settings.lengthUnit()}`),
        ]),
    },
    { path: '/settings/workout', labelKey: 'settings.workout.title' },
    { path: '/settings/data', labelKey: 'page.data.title' },
    {
      path: '/exercises',
      labelKey: 'settings.library.title',
    },
    { path: '/settings/about', labelKey: 'page.about.title' },
  ];

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
