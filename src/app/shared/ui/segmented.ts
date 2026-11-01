import { Component, inject, input, model } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

export interface SegmentedOption<T extends string> {
  value: T;
  labelKey: string;
}

/**
 * Segmented control for small mutually exclusive choices (theme, tracking
 * mode).
 *
 * Built on native radio inputs rather than buttons with ARIA: that gives
 * correct roles, arrow-key navigation within the group and a single tab stop
 * for free, which a hand-rolled roving-tabindex implementation usually gets
 * subtly wrong.
 */
@Component({
  selector: 'rl-segmented',
  styleUrl: './segmented.css',
  template: `
    <div class="seg" role="radiogroup" [attr.aria-label]="i18n.t(labelKey())">
      @for (option of options(); track option.value) {
        <label class="seg__item" [class.seg__item--active]="option.value === value()">
          <input
            class="seg__input"
            type="radio"
            [name]="name()"
            [value]="option.value"
            [checked]="option.value === value()"
            (change)="value.set(option.value)"
          />
          <span>{{ i18n.t(option.labelKey) }}</span>
        </label>
      }
    </div>
  `,
})
export class Segmented<T extends string> {
  protected readonly i18n = inject(I18n);

  readonly options = input.required<readonly SegmentedOption<T>[]>();
  readonly value = model.required<T>();
  readonly name = input.required<string>();
  readonly labelKey = input.required<string>();
}
