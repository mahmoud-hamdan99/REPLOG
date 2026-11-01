import { Component, computed, input } from '@angular/core';

export type SkeletonShape = 'line' | 'card' | 'chart';

/**
 * Loading placeholder.
 *
 * `aria-hidden` with a sibling live region elsewhere: a screen reader should
 * hear "loading" once, not a description of grey rectangles. The shimmer is
 * dropped under prefers-reduced-motion by the global rule in _base.css.
 */
@Component({
  selector: 'rl-skeleton',
  styleUrl: './skeleton.css',
  host: { '[class]': 'classes()', '[style.inline-size]': 'width()', 'aria-hidden': 'true' },
  template: '',
})
export class Skeleton {
  readonly shape = input<SkeletonShape>('line');
  /** Any CSS inline-size, e.g. '60%'. */
  readonly width = input<string | undefined>(undefined);

  protected readonly classes = computed(() => `skeleton skeleton--${this.shape()}`);
}
