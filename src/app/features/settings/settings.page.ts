import { Component, inject } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { Card } from '../../shared/ui/card';
import { SectionHeader } from '../../shared/ui/section-header';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import type { Language, LengthUnit, ThemePreference, WeightUnit } from '../../domain/models/prefs';

/**
 * Settings.
 *
 * Phase 1 ships only the preferences the shell itself needs — appearance,
 * language and units — because those are what make theming and runtime
 * language switching verifiable. Profile, workout preferences, data and backup
 * arrive with their own phases and are routed to placeholders until then.
 */
@Component({
  selector: 'rl-settings-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Card, SectionHeader, Segmented],
  template: `
    <rl-app-header titleKey="page.settings.title" />

    <div class="page">
      <section class="group">
        <rl-section-header titleKey="settings.appearance.title" />
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              name="theme"
              labelKey="settings.appearance.theme"
              [options]="themeOptions"
              [value]="settings.themePreference()"
              (valueChange)="settings.set('theme', $event)"
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
        <rl-section-header titleKey="settings.units.weight" />
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              name="weightUnit"
              labelKey="settings.units.weight"
              [options]="weightOptions"
              [value]="settings.weightUnit()"
              (valueChange)="settings.set('weightUnit', $event)"
            />
          </div>
          <div class="group__control">
            <rl-segmented
              name="lengthUnit"
              labelKey="settings.units.length"
              [options]="lengthOptions"
              [value]="settings.lengthUnit()"
              (valueChange)="settings.set('lengthUnit', $event)"
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
    </div>
  `,
})
export class SettingsPage {
  protected readonly settings = inject(SettingsStore);
  protected readonly i18n = inject(I18n);

  protected readonly themeOptions: readonly SegmentedOption<ThemePreference>[] = [
    { value: 'system', labelKey: 'theme.system' },
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
  ];

  protected readonly languageOptions: readonly SegmentedOption<Language>[] = [
    { value: 'en', labelKey: 'language.en' },
    { value: 'ar', labelKey: 'language.ar' },
  ];

  protected readonly weightOptions: readonly SegmentedOption<WeightUnit>[] = [
    { value: 'kg', labelKey: 'unit.kg' },
    { value: 'lb', labelKey: 'unit.lb' },
  ];

  protected readonly lengthOptions: readonly SegmentedOption<LengthUnit>[] = [
    { value: 'cm', labelKey: 'unit.cm' },
    { value: 'in', labelKey: 'unit.in' },
  ];
}
