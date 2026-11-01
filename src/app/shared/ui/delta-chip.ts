import { Component, computed, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

/**
 * Change indicator.
 *
 * Deliberately not colour-coded by "good" and "bad": losing weight is not
 * inherently progress and gaining it is not inherently failure. Direction is
 * shown by an arrow glyph and the signed number; colour stays neutral unless
 * the caller opts into semantics. See docs/UI_UX_SPEC.md section 5.1.
 */
@Component({
  selector: 'rl-delta-chip',
  styleUrl: './delta-chip.css',
  host: { '[class]': 'classes()' },
  template: `
    @if (arrow()) {
      <span class="delta__arrow" aria-hidden="true">{{ arrow() }}</span>
    }
    <span class="delta__value">{{ formatted() }}</span>
    @if (unit()) {
      <span class="delta__unit">{{ unit() }}</span>
    }
  `,
})
export class DeltaChip {
  private readonly i18n = inject(I18n);

  /** Signed change. Null means "no comparison available", not zero. */
  readonly value = input.required<number | null>();
  readonly unit = input<string | undefined>(undefined);
  readonly fractionDigits = input(1);

  protected readonly direction = computed<'up' | 'down' | 'flat' | 'none'>(() => {
    const value = this.value();
    if (value === null) return 'none';
    if (value > 0) return 'up';
    if (value < 0) return 'down';
    return 'flat';
  });

  protected readonly arrow = computed(() => {
    switch (this.direction()) {
      case 'up':
        return '↑';
      case 'down':
        return '↓';
      case 'flat':
        // No glyph: a horizontal arrow would be a direction, and "no change"
        // is not one. The zero carries the meaning on its own.
        return '';
      default:
        return '—';
    }
  });

  protected readonly formatted = computed(() => {
    const value = this.value();
    if (value === null) {
      return '';
    }
    const digits = this.fractionDigits();
    return this.i18n.formatNumber(Math.abs(value), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  });

  protected readonly classes = computed(() => `delta delta--${this.direction()}`);
}
