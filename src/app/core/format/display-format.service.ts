import { computed, inject, Service } from '@angular/core';
import { I18n } from '../i18n/i18n.service';
import { SettingsStore } from '../settings/settings.store';
import type { PersonalRecord } from '../../domain/models/records';
import type { SetLog } from '../../domain/models/workout';
import { durationParts } from '../../domain/time/duration';
import { parseDayKey } from '../../domain/time/day-key';
import type { MeasurementUnitType } from '../../domain/models/enums';
import {
  displayIncrement,
  toCanonicalLength,
  toCanonicalMass,
  toDisplayBodyLength,
  toDisplayBodyMass,
  toDisplayLength,
  toDisplayMass,
} from '../../domain/units/convert';

/** Shown where a value exists but is not yet entered. */
const BLANK = '—';

/**
 * Formatting and unit conversion for every view.
 *
 * One place, for two reasons. Conversion is a *presentation* concern — storage
 * is always canonical kilograms (docs/ARCHITECTURE.md section 5.5) — and
 * scattering `toDisplayMass` through a dozen templates is how a screen ends up
 * showing pounds with a "kg" label. And every number here needs the locale's
 * numeral system, which means going through `I18n.formatNumber` rather than
 * `String(value)`.
 */
@Service()
export class DisplayFormat {
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

  // -------------------------------------------------------------- lengths

  readonly lengthUnit = computed(() => this.settings.lengthUnit());
  readonly lengthUnitShort = computed(() => this.i18n.t(`unit.short.${this.lengthUnit()}`));

  /** Canonical centimetres to a display value in the user's unit. */
  lengthDisplay(cm: number | null): number | null {
    return cm === null ? null : toDisplayLength(cm, this.lengthUnit());
  }

  lengthCanonical(value: number | null): number | null {
    return value === null ? null : toCanonicalLength(value, this.lengthUnit());
  }

  lengthWithUnit(cm: number | null): string {
    const value = this.lengthDisplay(cm);
    return value === null ? BLANK : `${this.i18n.formatNumber(value)} ${this.lengthUnitShort()}`;
  }

  // ------------------------------------------------------ by unit type

  /**
   * Conversion dispatched on a unit type.
   *
   * Custom measurements carry a unit type rather than a known field, so the
   * screens that render them need one entry point. Percentages and counts are
   * already canonical — there is no second unit to offer — which is itself
   * worth stating rather than leaving a reader to wonder why they fall
   * through.
   */
  toDisplay(unitType: MeasurementUnitType, canonical: number | null): number | null {
    if (canonical === null) return null;
    // A measured mass, not a load: scale precision rather than the plate grid,
    // so 80.4 kg stays 80.4 kg instead of becoming 80.5.
    if (unitType === 'mass') return toDisplayBodyMass(canonical, this.unit());
    if (unitType === 'length') return toDisplayBodyLength(canonical, this.lengthUnit());
    return canonical;
  }

  toCanonical(unitType: MeasurementUnitType, value: number | null): number | null {
    if (value === null) return null;
    if (unitType === 'mass') return this.massCanonical(value);
    if (unitType === 'length') return this.lengthCanonical(value);
    return value;
  }

  /** The suffix a field of this unit type is measured in. */
  unitFor(unitType: MeasurementUnitType): string {
    if (unitType === 'mass') return this.unitShort();
    if (unitType === 'length') return this.lengthUnitShort();
    if (unitType === 'percent') return this.i18n.t('unit.short.percent');
    return '';
  }

  /** A measurement with its unit, whatever kind of measurement it is. */
  byUnitType(unitType: MeasurementUnitType, canonical: number | null): string {
    const value = this.toDisplay(unitType, canonical);
    if (value === null) return BLANK;
    const unit = this.unitFor(unitType);
    return unit === '' ? this.i18n.formatNumber(value) : `${this.i18n.formatNumber(value)} ${unit}`;
  }

  /**
   * A change, always signed.
   *
   * The sign is the information: "+0.4 kg" and "0.4 kg" say different things,
   * and a delta that dropped its sign would read as a measurement.
   */
  delta(unitType: MeasurementUnitType, canonical: number | null): string {
    const value = this.toDisplay(unitType, canonical);
    if (value === null) return BLANK;

    const formatted = this.i18n.formatNumber(Math.abs(value));
    const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
    const unit = this.unitFor(unitType);
    return unit === '' ? `${sign}${formatted}` : `${sign}${formatted} ${unit}`;
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

  // ------------------------------------------------------------- records

  /**
   * What kind of record this is.
   *
   * UI_UX_SPEC section 5.5 asks every record entry to state its type, value
   * and previous best. Here rather than in a feature because two screens show
   * records — the post-workout summary and the records list — and a type
   * label that drifted between them would be two different claims about the
   * same row.
   */
  recordType(record: Pick<PersonalRecord, 'prType' | 'repBucket'>): string {
    if (record.prType === 'maxRepsAtWeight') {
      return this.i18n.t('records.type.maxRepsAtWeight', {
        weight: this.massWithUnit(record.repBucket),
      });
    }
    return this.i18n.t(`records.type.${record.prType}`);
  }

  /** The value in the unit its type is measured in: reps are not kilograms. */
  recordValue(record: Pick<PersonalRecord, 'prType' | 'value'>): string {
    return record.prType === 'maxRepsAtWeight'
      ? this.repCount(record.value)
      : this.massWithUnit(record.value);
  }

  /**
   * "First record", or what it improved on.
   *
   * Never both and never neither: `previousValue` is null exactly when there
   * was nothing to beat, and starting is not the same as improving.
   */
  recordDelta(record: Pick<PersonalRecord, 'prType' | 'previousValue'>): string {
    if (record.previousValue === null) {
      return this.i18n.t('records.first');
    }
    return this.i18n.t('records.improved', {
      value: this.recordValue({ prType: record.prType, value: record.previousValue }),
    });
  }

  /** The formula behind an estimate, named rather than implied. */
  recordFormula(record: Pick<PersonalRecord, 'formula'>): string {
    return record.formula === null
      ? ''
      : this.i18n.t('records.formula', { formula: this.i18n.t(`formula.${record.formula}`) });
  }

  /** "12 Feb" — a day and month, which is all a comparison needs. */
  shortDate(iso: string): string {
    return this.date(iso, { day: 'numeric', month: 'short' });
  }

  /**
   * "Mon, 12 Feb" — with the weekday.
   *
   * A history row needs it: "Monday" is how people remember which session a
   * date was, and scanning a month of bare numbers does not tell you that.
   */
  weekdayDate(iso: string): string {
    return this.date(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * The same, for a `YYYY-MM-DD` day key rather than an instant.
   *
   * A separate method because `Date.parse('2026-10-20')` reads the string as
   * UTC midnight, which renders as the 19th anywhere west of Greenwich. The
   * day a measurement was taken on has no time and no zone, so it is parsed
   * as local midnight and never shifts.
   */
  weekdayDay(day: string): string {
    const parsed = parseDayKey(day);
    return Number.isNaN(parsed.getTime())
      ? BLANK
      : this.formatDate(parsed, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * "March 2026", from a `YYYY-MM` key.
   *
   * The year is always shown. A gallery heading of "March" alone is ambiguous
   * the moment someone has been training for more than a year, which is the
   * case this screen exists for.
   */
  monthLabel(month: string): string {
    const parsed = parseDayKey(`${month}-01`);
    return Number.isNaN(parsed.getTime())
      ? BLANK
      : this.formatDate(parsed, { month: 'long', year: 'numeric' });
  }

  private date(iso: string, options: Intl.DateTimeFormatOptions): string {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return BLANK;
    return this.formatDate(new Date(parsed), options);
  }

  private formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(
      `${this.i18n.locale()}-u-nu-${this.settings.numerals()}`,
      options,
    ).format(date);
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
