import { Component, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import type { Slice } from '../../domain/analytics/distribution';

/**
 * Share of training per muscle group.
 *
 * A horizontal stacked bar with a labelled list under it, and deliberately
 * **not** a pie chart (UI_UX_SPEC section 9). A pie with twelve slices is
 * unreadable at any phone size, comparing angles is harder than comparing
 * lengths, and a pie's label placement has no good answer in a mirrored
 * layout.
 *
 * The list is not a legend, it is the data. Colour carries no information
 * that the percentages do not also carry, which is what makes the chart
 * readable in greyscale, to a colour-blind reader, and to a screen reader —
 * the bar is decorative and the list is what gets announced.
 */
@Component({
  selector: 'rl-distribution',
  styleUrl: './distribution-chart.css',
  template: `
    @if (slices().length === 0) {
      <p class="dc__empty t-body">{{ i18n.t('chart.empty', { count: 0 }) }}</p>
    } @else {
      <!-- Mirrors in Arabic: a category axis is not a time axis. -->
      <div class="dc__bar" aria-hidden="true">
        @for (slice of slices(); track slice.group; let i = $index) {
          <span class="dc__seg" [attr.data-color]="i % 6" [style.flex-grow]="slice.share"></span>
        }
      </div>

      <ul class="dc__list">
        @for (slice of slices(); track slice.group; let i = $index) {
          <li class="dc__row">
            <span class="dc__swatch" [attr.data-color]="i % 6" aria-hidden="true"></span>
            <span class="dc__name t-body">{{ i18n.t('muscle.' + slice.group) }}</span>
            <span class="dc__share t-body-strong">{{ i18n.formatNumber(slice.share) }}%</span>
            <span class="dc__sets t-caption">{{
              i18n.t('count.sets', { count: slice.sets })
            }}</span>
          </li>
        }
      </ul>

      @if (footnote()) {
        <p class="dc__footnote t-caption">{{ footnote() }}</p>
      }
    }
  `,
})
export class DistributionChart {
  protected readonly i18n = inject(I18n);

  readonly slices = input.required<readonly Slice[]>();
  /** Already-translated note about what the count excludes. */
  readonly footnote = input('');
}
