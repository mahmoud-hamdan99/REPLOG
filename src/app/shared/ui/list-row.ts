import { Component, computed, inject, input, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

export type ListRowVariant = 'value' | 'nav' | 'destructive';

/** Settings-style row: label, optional value, optional disclosure. */
@Component({
  selector: 'rl-list-row',
  styleUrl: './list-row.css',
  template: `
    @if (interactive()) {
      <button type="button" [class]="classes()" (click)="pressed.emit()">
        <span class="row__label">{{ i18n.t(labelKey()) }}</span>
        @if (valueText()) {
          <span class="row__value">{{ valueText() }}</span>
        }
        <ng-content />
        @if (variant() === 'nav') {
          <span class="row__chevron" aria-hidden="true">&#8250;</span>
        }
      </button>
    } @else {
      <div [class]="classes()">
        <span class="row__label">{{ i18n.t(labelKey()) }}</span>
        @if (valueText()) {
          <span class="row__value">{{ valueText() }}</span>
        }
        <ng-content />
      </div>
    }
  `,
})
export class ListRow {
  protected readonly i18n = inject(I18n);

  readonly labelKey = input.required<string>();
  readonly valueText = input<string | undefined>(undefined);
  readonly variant = input<ListRowVariant>('value');
  readonly interactive = input(true);
  readonly pressed = output<void>();

  protected readonly classes = computed(() => `row row--${this.variant()}`);
}
