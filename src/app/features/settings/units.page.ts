import { Component, inject } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { Card } from '../../shared/ui/card';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import type { LengthUnit, Numerals, WeekStart, WeightUnit } from '../../domain/models/prefs';

/**
 * Units and numerals.
 *
 * The note at the bottom is the point of the screen. Every number in the
 * database is metric, and these controls change only the labels and the
 * arithmetic at the display edge — so a user who switches to pounds has not
 * edited a single record, and one who switches back sees exactly what they
 * saw before. Users of other trackers have been burned by this, so the screen
 * says it outright instead of leaving them to test it on their own history.
 */
@Component({
  selector: 'rl-units-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Card, Segmented],
  template: `
    <rl-app-header titleKey="settings.units.title" [showBack]="true" />

    <div class="page">
      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="weightUnit"
              labelKey="settings.units.weight"
              [options]="weightOptions"
              [value]="settings.weightUnit()"
              (valueChange)="settings.set('weightUnit', $event)"
            />
          </div>
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="lengthUnit"
              labelKey="settings.units.length"
              [options]="lengthOptions"
              [value]="settings.lengthUnit()"
              (valueChange)="settings.set('lengthUnit', $event)"
            />
          </div>
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="numerals"
              labelKey="settings.units.numerals"
              [options]="numeralOptions"
              [value]="settings.numerals()"
              (valueChange)="settings.set('numerals', $event)"
            />
          </div>
        </rl-card>
        <p class="t-caption group__note">{{ i18n.t('settings.units.note') }}</p>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="weekStart"
              labelKey="settings.units.weekStart"
              [options]="weekOptions"
              [value]="weekStart()"
              (valueChange)="setWeekStart($event)"
            />
          </div>
        </rl-card>
      </section>
    </div>
  `,
})
export class UnitsPage {
  protected readonly settings = inject(SettingsStore);
  protected readonly i18n = inject(I18n);

  protected readonly weightOptions: readonly SegmentedOption<WeightUnit>[] = [
    { value: 'kg', labelKey: 'unit.kg' },
    { value: 'lb', labelKey: 'unit.lb' },
  ];

  protected readonly lengthOptions: readonly SegmentedOption<LengthUnit>[] = [
    { value: 'cm', labelKey: 'unit.cm' },
    { value: 'in', labelKey: 'unit.in' },
  ];

  /**
   * Labelled with the digits themselves rather than with the words "Latin"
   * and "Arabic": the sample is unambiguous in either language, and someone
   * who cannot yet read the interface can still pick the one they recognise.
   */
  protected readonly numeralOptions: readonly SegmentedOption<Numerals>[] = [
    { value: 'latn', labelKey: 'numerals.latn' },
    { value: 'arab', labelKey: 'numerals.arab' },
  ];

  /**
   * Saturday, Sunday and Monday — the three week starts this app's two
   * languages actually use. `WeekStart` is numeric and `SegmentedOption`
   * takes strings, so the value crosses as a string and is mapped back here
   * rather than widening the shared component for one screen.
   */
  protected readonly weekOptions: readonly SegmentedOption<string>[] = [
    { value: '6', labelKey: 'weekday.6' },
    { value: '0', labelKey: 'weekday.0' },
    { value: '1', labelKey: 'weekday.1' },
  ];

  protected weekStart(): string {
    return String(this.settings.prefs().weekStartsOn);
  }

  protected setWeekStart(value: string): void {
    const parsed = Number(value);
    const allowed: readonly WeekStart[] = [0, 1, 6];
    const next = allowed.find((day) => day === parsed);
    if (next !== undefined) this.settings.set('weekStartsOn', next);
  }
}
