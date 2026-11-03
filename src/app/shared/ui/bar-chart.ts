import { Component, computed, inject, input, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { scaleFor, type Scale } from '../../domain/analytics/axis';
import type { Point } from '../../domain/analytics/series';

/**
 * One bar, optionally split into stacked parts.
 *
 * `parts` lets a volume bar be broken down by muscle group. An empty list
 * means a plain bar of `value`.
 */
export interface Bar {
  key: string;
  value: number;
  parts?: readonly { key: string; value: number; colorIndex: number }[];
}

/**
 * Bars over time, optionally stacked.
 *
 * A bar's length *is* its quantity, so the axis starts at zero and there is no
 * option to zoom it — a truncated bar misstates the number by exactly the
 * amount that was cut off, and unlike a line chart there is no visual cue that
 * anything was.
 *
 * Bars are drawn as HTML blocks rather than SVG rects. A bar chart is a row of
 * rectangles with labels, which is what CSS grid already is; doing it in SVG
 * would mean re-implementing layout and then fighting it for the stacked case.
 */
@Component({
  selector: 'rl-bar-chart',
  styleUrl: './bar-chart.css',
  template: `
    @if (bars().length === 0) {
      <p class="bc__empty t-body">{{ i18n.t('chart.empty', { count: 0 }) }}</p>
    } @else {
      <figure class="bc">
        <div class="bc__grid">
          <div class="bc__y" aria-hidden="true">
            @for (tick of reversedTicks(); track tick) {
              <span class="t-micro">{{ formatValue()(tick) }}</span>
            }
          </div>

          <!-- Time runs left to right in both directions (UI_UX_SPEC 10.2). -->
          <div class="bc__plot" dir="ltr" role="img" [attr.aria-label]="summary()">
            @for (bar of bars(); track bar.key) {
              <button
                type="button"
                class="bc__col"
                [class.bc__col--active]="active() === bar.key"
                [attr.aria-label]="describe(bar)"
                (click)="toggle(bar.key)"
              >
                <span class="bc__stack" [style.block-size.%]="heightOf(bar)">
                  @if (bar.parts && bar.parts.length > 0) {
                    @for (part of bar.parts; track part.key) {
                      <span
                        class="bc__part"
                        [attr.data-color]="part.colorIndex % 6"
                        [style.flex-grow]="part.value"
                      ></span>
                    }
                  } @else {
                    <span class="bc__part" data-color="0" style="flex-grow: 1"></span>
                  }
                </span>
              </button>
            }
          </div>

          <div class="bc__x" aria-hidden="true">
            @for (label of edgeLabels(); track label) {
              <span class="t-micro">{{ label }}</span>
            }
          </div>
        </div>

        @if (activeBar(); as bar) {
          <output class="bc__readout t-caption">
            <span class="t-body-strong">{{ formatValue()(bar.value) }}</span>
            <span>{{ formatKey()(bar.key) }}</span>
          </output>
        }

        <figcaption class="bc__caption t-caption">
          {{ i18n.t('chart.buckets', { count: bars().length }) }}
        </figcaption>
      </figure>
    }
  `,
})
export class BarChart {
  protected readonly i18n = inject(I18n);

  readonly bars = input.required<readonly Bar[]>();
  readonly formatValue = input<(value: number) => string>((value) => String(value));
  readonly formatKey = input<(key: string) => string>((key) => key);
  readonly label = input('');
  /** Whole-number ticks, for a chart counting sessions, sets or reps. */
  readonly integral = input(false);

  protected readonly scale = computed<Scale>(() =>
    // Always zero-based. Not an option, because there is no honest way to
    // truncate a bar.
    scaleFor(
      this.bars().map((bar) => bar.value),
      { zeroBased: true, integral: this.integral() },
    ),
  );

  protected readonly reversedTicks = computed(() => [...this.scale().ticks].reverse());

  protected heightOf(bar: Bar): number {
    const max = this.scale().max;
    return max <= 0 ? 0 : (bar.value / max) * 100;
  }

  private readonly activeKey = signal<string | null>(null);

  protected readonly active = computed(() => this.activeKey());

  protected readonly activeBar = computed(() =>
    this.bars().find((bar) => bar.key === this.activeKey()),
  );

  /** Tap to read, tap again to dismiss. A phone has no hover. */
  protected toggle(key: string): void {
    this.activeKey.update((current) => (current === key ? null : key));
  }

  protected describe(bar: Bar): string {
    return `${this.formatKey()(bar.key)}: ${this.formatValue()(bar.value)}`;
  }

  protected readonly summary = computed(() =>
    this.i18n.t('chart.summary', { label: this.label(), count: this.bars().length }),
  );

  protected readonly edgeLabels = computed(() => {
    const bars = this.bars();
    const first = bars[0];
    const last = bars[bars.length - 1];
    if (!first || !last) return [];
    return first.key === last.key
      ? [this.formatKey()(first.key)]
      : [this.formatKey()(first.key), this.formatKey()(last.key)];
  });
}

/** Re-exported so callers do not have to know the chart's own shape. */
export type { Point };
