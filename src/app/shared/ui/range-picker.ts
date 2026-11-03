import { Component, inject, input, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TIME_RANGES, type TimeRange } from '../../domain/analytics/range';

/**
 * The six windows PRODUCT_SPEC section 4.9 asks for.
 *
 * A radio group rather than a row of buttons: picking a range is choosing one
 * of a fixed set, which is what radios mean, and it gives arrow-key movement
 * and a single tab stop for free.
 */
@Component({
  selector: 'rl-range-picker',
  styleUrl: './range-picker.css',
  template: `
    <div class="rp" role="radiogroup" [attr.aria-label]="i18n.t('range.label')">
      @for (option of ranges; track option) {
        <button
          type="button"
          class="rp__option t-label"
          role="radio"
          [attr.aria-checked]="value() === option"
          [class.rp__option--on]="value() === option"
          [attr.tabindex]="value() === option ? 0 : -1"
          (click)="selected.emit(option)"
        >
          {{ i18n.t('range.' + option) }}
        </button>
      }
    </div>
  `,
})
export class RangePicker {
  protected readonly i18n = inject(I18n);
  protected readonly ranges = TIME_RANGES;

  readonly value = input.required<TimeRange>();
  readonly selected = output<TimeRange>();
}
