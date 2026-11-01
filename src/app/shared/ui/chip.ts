import { Component, computed, input, output } from '@angular/core';

export type ChipVariant = 'filter' | 'choice' | 'removable';

/** Filter and choice chip. Selected state carries a check glyph as well as
 *  colour, because colour is never the only signal. */
@Component({
  selector: 'rl-chip',
  styleUrl: './chip.css',
  template: `
    <button
      type="button"
      [class]="classes()"
      [attr.aria-pressed]="variant() === 'removable' ? null : selected()"
      (click)="toggled.emit()"
    >
      @if (selected() && variant() !== 'removable') {
        <span class="chip__check" aria-hidden="true">&#10003;</span>
      }
      <ng-content />
      @if (variant() === 'removable') {
        <span class="chip__remove" aria-hidden="true">&#215;</span>
      }
    </button>
  `,
})
export class Chip {
  readonly variant = input<ChipVariant>('filter');
  readonly selected = input(false);
  readonly toggled = output<void>();

  protected readonly classes = computed(
    () => `chip chip--${this.variant()}` + (this.selected() ? ' chip--selected' : ''),
  );
}
