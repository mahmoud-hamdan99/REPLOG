import { Component, computed, inject, input } from '@angular/core';
import { DisplayFormat } from '../../../core/format/display-format.service';
import { I18n } from '../../../core/i18n/i18n.service';
import type { PreviousPerformance } from '../previous-performance.service';

/**
 * "Last time · 12 Feb" with that session's sets.
 *
 * Renders an explicit "No history yet" line rather than collapsing to nothing:
 * an empty space is indistinguishable from a bug, and PRODUCT_SPEC section 4.4
 * asks for previous performance to be visible for every exercise — including
 * the answer "there isn't any".
 *
 * Variant-scoped by the lookup that produced it, so this is never a dumbbell
 * press standing in for a barbell press.
 */
@Component({
  selector: 'rl-prev-performance',
  styleUrl: './prev-performance.css',
  template: `
    @if (previous(); as last) {
      <div class="prev">
        <p class="prev__when t-micro">
          {{ i18n.t('tracker.prev.title', { date: format.shortDate(last.performedAt) }) }}
        </p>
        <p class="prev__sets t-caption">{{ sets() }}</p>
      </div>
    } @else {
      <p class="prev prev--none t-caption">{{ i18n.t('tracker.prev.none') }}</p>
    }
  `,
})
export class PrevPerformance {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);

  readonly previous = input<PreviousPerformance | null>(null);

  /**
   * Working sets only: a warm-up is not something to compare against.
   *
   * Joined with the locale's separator rather than spaces — "100 × 5 100 × 5"
   * reads as one number running into the next.
   */
  protected readonly sets = computed(() =>
    this.i18n.join(
      (this.previous()?.sets ?? [])
        .filter((set) => set.setType !== 'warmup')
        .map((set) => this.format.setSummary(set)),
    ),
  );
}
