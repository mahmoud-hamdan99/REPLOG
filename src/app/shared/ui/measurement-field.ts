import { Component, computed, inject, input, output } from '@angular/core';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { normaliseDigits } from '../../core/i18n/numerals';
import type { MeasurementUnitType } from '../../domain/models/enums';

let idCounter = 0;

/**
 * One measurement input.
 *
 * **The only place a measurement converts units.** Values come in and go out
 * canonical — kilograms, centimetres, percent — and the display unit never
 * leaves this component. That is the rule from
 * docs/ARCHITECTURE.md section 5.5, and it is what makes switching kg→lb
 * change every number on screen and no number on disk.
 *
 * The previous value is ghost text rather than a prefilled input: prefilling
 * would make last week's measurement look like today's until someone noticed.
 * The delta appears only once a value is entered *and* there is something to
 * compare against — a gap stays a gap.
 */
@Component({
  selector: 'rl-measurement-field',
  styleUrl: './measurement-field.css',
  template: `
    <!--
      The label element is here for the click target; the accessible name
      comes from aria-labelledby instead. A <label> wrapping the whole
      control names the input with everything inside it — "Body weight kg
      Last 79.8 kg" — and aria-describedby then reads the hint out a second
      time. Naming the span alone gives "Body weight", or "Biceps Left" for
      one half of a pair, which is what distinguishes the two.
    -->
    <label class="mf" [attr.for]="inputId">
      <span class="mf__label t-label" [id]="labelId">
        {{ label() }}
        @if (sideLabel()) {
          <span class="mf__side t-caption">{{ sideLabel() }}</span>
        }
      </span>

      <span class="mf__input-wrap">
        <input
          class="mf__input"
          [id]="inputId"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          [value]="text()"
          [attr.placeholder]="placeholder()"
          [attr.aria-labelledby]="labelId"
          [attr.aria-describedby]="unitId + ' ' + hintId"
          (input)="onInput($any($event.target).value)"
        />
        <!-- Described, not hidden: a screen reader user needs the unit too, and
             it belongs with the hint rather than in the name. -->
        <span class="mf__unit t-caption" [id]="unitId">{{ unitLabel() }}</span>
      </span>

      <span class="mf__hint t-caption" [id]="hintId">
        @if (deltaText(); as delta) {
          <span class="mf__delta">{{ delta }}</span>
        } @else if (previousText(); as previous) {
          {{ i18n.t('body.last', { value: previous }) }}
        } @else {
          {{ i18n.t('body.noPrevious') }}
        }
      </span>
    </label>
  `,
})
export class MeasurementField {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);

  protected readonly inputId = `mf-${++idCounter}`;
  protected readonly labelId = `mf-label-${idCounter}`;
  protected readonly unitId = `mf-unit-${idCounter}`;
  protected readonly hintId = `mf-hint-${idCounter}`;

  /** Already-translated field name. */
  readonly label = input.required<string>();
  /** "Left" or "Right" for one half of a pair; empty otherwise. */
  readonly sideLabel = input('');
  readonly unitType = input.required<MeasurementUnitType>();
  /** Canonical: kilograms, centimetres, percent. */
  readonly value = input<number | null>(null);
  /** The last recorded value, canonical. Ghost text, never prefilled. */
  readonly previous = input<number | null>(null);
  /** Canonical change against `previous`; null when there is nothing to show. */
  readonly delta = input<number | null>(null);

  /** Emits canonical units, so no caller ever sees the display unit. */
  readonly valueChange = output<number | null>();

  protected readonly unitLabel = computed(() => this.format.unitFor(this.unitType()));

  /**
   * The display text for the bound canonical value.
   *
   * Deliberately derived rather than kept as local state: a unit switch has to
   * change what is on screen while the user is typing, and local state would
   * keep showing the old unit's number.
   */
  protected readonly text = computed(() => this.editable(this.value()));

  protected readonly placeholder = computed(() => this.editable(this.previous()));

  /**
   * A canonical value as editable text in the user's own numerals.
   *
   * `String(80.4)` would put Latin digits in the field while every other
   * number on an Arabic screen is Arabic-Indic. Grouping is off because a
   * thousands separator in a field the user is typing into is noise, and
   * because it collides with the decimal marks `onInput` accepts.
   */
  private editable(canonical: number | null): string {
    const display = this.format.toDisplay(this.unitType(), canonical);
    return display === null
      ? ''
      : this.i18n.formatNumber(display, { useGrouping: false, maximumFractionDigits: 2 });
  }

  protected readonly previousText = computed(() =>
    this.previous() === null ? '' : this.format.byUnitType(this.unitType(), this.previous()),
  );

  protected readonly deltaText = computed(() =>
    this.delta() === null ? '' : this.format.delta(this.unitType(), this.delta()),
  );

  /**
   * Parses what was typed and emits it canonical.
   *
   * Accepts whatever digits and decimal mark the keyboard produces — Latin,
   * Arabic-Indic or Persian, with `.`, `,` or `٫`. An Arabic keyboard emits
   * Arabic-Indic digits, and a field that silently dropped them would be
   * unusable for exactly the users the Arabic interface exists for; a user
   * with a Latin keyboard on that interface must not be stuck either.
   */
  protected onInput(raw: string): void {
    const cleaned = normaliseDigits(raw);
    if (cleaned === '' || cleaned === '.') {
      this.valueChange.emit(null);
      return;
    }

    const parsed = Number(cleaned);
    // A half-typed "12." is not yet a number; emitting 12 would commit a value
    // the user is still in the middle of.
    if (!Number.isFinite(parsed) || cleaned.endsWith('.')) return;

    this.valueChange.emit(this.format.toCanonical(this.unitType(), parsed));
  }
}
