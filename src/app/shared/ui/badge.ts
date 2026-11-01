import { Component, computed, input } from '@angular/core';

export type BadgeKind = 'pr' | 'estimate' | 'warmup' | 'count' | 'neutral';

/**
 * Small status marker.
 *
 * `estimate` is load-bearing, not decorative: PRODUCT_SPEC sections 4.5 and 4.9
 * require calculated values to be visually distinguishable from recorded ones,
 * so every estimated-1RM figure carries this badge.
 */
@Component({
  selector: 'rl-badge',
  styleUrl: './badge.css',
  host: { '[class]': 'classes()' },
  template: `
    @if (kind() === 'estimate') {
      <span class="badge__glyph" aria-hidden="true">&#8961;</span>
    }
    <ng-content />
  `,
})
export class Badge {
  readonly kind = input<BadgeKind>('neutral');

  protected readonly classes = computed(() => `badge badge--${this.kind()}`);
}
