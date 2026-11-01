import { Component, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

/**
 * Eyebrow label, hero number, optional footnote.
 *
 * A tile with no data shows an em dash and its own prompt rather than a zero:
 * "0 kg" reads as a measurement, which would be a fabrication
 * (PRODUCT_SPEC section 4.1 — all statistics come from stored records).
 */
@Component({
  selector: 'rl-stat-tile',
  styleUrl: './stat-tile.css',
  template: `
    <p class="t-micro tile__label">{{ i18n.t(labelKey()) }}</p>
    <p class="tile__value" [class.t-stat-xl]="hero()" [class.t-stat]="!hero()">
      @if (value() !== null) {
        {{ value() }}
        @if (unit()) {
          <span class="tile__unit">{{ unit() }}</span>
        }
      } @else {
        <span class="tile__empty">&#8212;</span>
      }
    </p>
    @if (value() === null && emptyHintKey()) {
      <p class="t-caption tile__footnote">{{ i18n.t(emptyHintKey()!) }}</p>
    } @else if (footnoteKey()) {
      <p class="t-caption tile__footnote">{{ i18n.t(footnoteKey()!) }}</p>
    }
    <ng-content />
  `,
})
export class StatTile {
  protected readonly i18n = inject(I18n);

  readonly labelKey = input.required<string>();
  /** Pre-formatted display value, or null when there is genuinely no data. */
  readonly value = input.required<string | null>();
  readonly unit = input<string | undefined>(undefined);
  readonly footnoteKey = input<string | undefined>(undefined);
  /** Shown instead of the footnote when there is no value: what to do next. */
  readonly emptyHintKey = input<string | undefined>(undefined);
  readonly hero = input(false);
}
