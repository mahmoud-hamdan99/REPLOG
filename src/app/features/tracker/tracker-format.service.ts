import { computed, inject, Service } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import type { SetLog } from '../../domain/models/workout';
import { durationParts } from '../../domain/time/duration';
import { displayIncrement, toCanonicalMass, toDisplayMass } from '../../domain/units/convert';
import type { PreviousPerformance, PreviousSet } from './previous-performance.service';

/** Shown where a value exists but is not yet entered. */
const BLANK = '—';

/**
 * Formatting and unit conversion for the tracker's views.
 *
 * One place, for two reasons. Conversion is a *presentation* concern — storage
 * is always canonical kilograms (docs/ARCHITECTURE.md section 5.5) — and
 * scattering `toDisplayMass` through a dozen templates is how a screen ends up
 * showing pounds with a "kg" label. And every number here needs the locale's
 * numeral system, which means going through `I18n.formatNumber` rather than
 * `String(value)`.
 */
@Service()
export class TrackerFormat {
  private readonly i18n = inject(I18n);
  private readonly settings = inject(SettingsStore);

  readonly unit = computed(() => this.settings.weightUnit());
  readonly unitShort = computed(() => this.i18n.t(`unit.short.${this.unit()}`));

  /** Canonical kilograms to a display value in the user's unit. */
  massDisplay(kg: number | null): number | null {
    return kg === null ? null : toDisplayMass(kg, this.unit());
  }

  /** A display value back to canonical kilograms. */
  massCanonical(value: number | null): number | null {
    return value === null ? null : toCanonicalMass(value, this.unit());
  }

  /** The exercise's own load step, expressed in the display unit. */
  increment(incrementKg: number): number {
    return displayIncrement(incrementKg, this.unit());
  }

  /** A load with no unit suffix, for a column that is already labelled. */
  mass(kg: number | null): string {
    const value = this.massDisplay(kg);
    return value === null ? BLANK : this.i18n.formatNumber(value);
  }

  /** A load with its unit, for prose and for standalone figures. */
  massWithUnit(kg: number | null): string {
    const value = this.massDisplay(kg);
    return value === null ? BLANK : `${this.i18n.formatNumber(value)} ${this.unitShort()}`;
  }

  number(value: number | null): string {
    return value === null ? BLANK : this.i18n.formatNumber(value);
  }

  /**
   * `m:ss`, or `h:mm:ss` past the hour, in the locale's numerals.
   *
   * `minimumIntegerDigits` rather than `padStart`: padding a localised string
   * with an ASCII zero would mix numeral systems in Arabic.
   */
  clock(totalSeconds: number): string {
    const { hours, minutes, seconds } = durationParts(totalSeconds);
    const pad = (value: number) => this.i18n.formatNumber(value, { minimumIntegerDigits: 2 });

    return hours > 0
      ? `${this.i18n.formatNumber(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${this.i18n.formatNumber(minutes)}:${pad(seconds)}`;
  }

  /** Rounded-up minutes, for a session total where seconds are noise. */
  minutes(totalSeconds: number): string {
    return this.i18n.formatNumber(Math.max(1, Math.round(totalSeconds / 60)));
  }

  setCount(count: number): string {
    return this.i18n.t('count.sets', { count });
  }

  repCount(count: number): string {
    return this.i18n.t('count.reps', { count });
  }

  /** "100 × 5", the compact form a logged set reads as. */
  setSummary(set: Pick<SetLog, 'weightKg' | 'reps'>): string {
    if (set.weightKg === null && set.reps === null) return BLANK;
    if (set.weightKg === null) return `${this.number(set.reps)}`;
    if (set.reps === null) return this.mass(set.weightKg);
    return `${this.mass(set.weightKg)} × ${this.number(set.reps)}`;
  }

  /** The same, for one set of a past performance. */
  previousSet(set: PreviousSet): string {
    return this.setSummary({ weightKg: set.weightKg, reps: set.reps });
  }

  /** Every working set of a past performance, space separated. */
  previousSets(previous: PreviousPerformance): string {
    return previous.sets
      .filter((set) => set.setType !== 'warmup')
      .map((set) => this.previousSet(set))
      .join('   ');
  }

  /** "12 Feb" — a day and month, which is all a comparison needs. */
  shortDate(iso: string): string {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return BLANK;
    return new Intl.DateTimeFormat(`${this.i18n.locale()}-u-nu-${this.settings.numerals()}`, {
      day: 'numeric',
      month: 'short',
    }).format(new Date(parsed));
  }

  /**
   * "3 days ago", or "today" for the same day.
   *
   * Zero is special-cased rather than left to the plural forms: English has
   * only `one` and `other`, so `Intl.PluralRules` sends 0 to `other` and the
   * line reads "Last done 0 days ago".
   */
  relativeDays(days: number): string {
    return days <= 0 ? this.i18n.t('time.today') : this.i18n.t('count.daysAgo', { count: days });
  }
}
