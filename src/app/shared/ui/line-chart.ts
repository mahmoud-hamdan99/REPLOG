import { Component, computed, inject, input, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { positionOn, scaleForPoints, type Scale } from '../../domain/analytics/axis';
import { chartState, pointCount, segments, type Point } from '../../domain/analytics/series';

/** Plot coordinate space. Arbitrary units; CSS decides the real size. */
const W = 1000;
const H = 360;

/**
 * A line over time.
 *
 * Hand-built SVG (ARCHITECTURE D4) with the geometry in the drawing and every
 * piece of text in HTML around it. That split is deliberate: axis labels in
 * SVG need font sizes in user units, which scale with the viewBox and ignore
 * the type tokens, and they would have to be mirrored by hand for Arabic.
 * As HTML they inherit the type scale, the numeral system and the direction
 * for free.
 *
 * The plot itself is `dir="ltr"` in both directions. UI_UX_SPEC section 10.2
 * makes the time axis an explicit exception to mirroring — time reads left to
 * right in Arabic technical interfaces, and mirroring the axis while the
 * numerals stay LTR reads worse, not better. Everything around it mirrors.
 *
 * Gaps break the path. There is one `<path>` per run of consecutive readings,
 * so a month nobody recorded is a hole in the line rather than a straight
 * segment implying steady progress through it.
 */
@Component({
  selector: 'rl-line-chart',
  styleUrl: './line-chart.css',
  host: { '[class.lc--sparse]': "state() === 'sparse'" },
  template: `
    @if (state() === 'empty') {
      <p class="lc__empty t-body">{{ i18n.t('chart.empty', { count: count() }) }}</p>
    } @else {
      <figure class="lc">
        <div class="lc__grid">
          <div class="lc__y" aria-hidden="true">
            @for (tick of reversedTicks(); track tick) {
              <span class="t-micro">{{ formatValue()(tick) }}</span>
            }
          </div>

          <div class="lc__plot">
            <svg
              dir="ltr"
              class="lc__svg"
              [attr.viewBox]="'0 0 ' + W + ' ' + H"
              preserveAspectRatio="none"
              role="img"
              [attr.aria-label]="summary()"
              (pointerdown)="scrub($event)"
              (pointermove)="scrubIfDown($event)"
              (pointerup)="release()"
              (pointerleave)="release()"
            >
              @if (fill() && area(); as path) {
                <path class="lc__area" [attr.d]="path" />
              }

              @for (run of paths(); track $index) {
                <path class="lc__line" [attr.d]="run" vector-effect="non-scaling-stroke" />
              }

              @if (averagePaths().length > 0) {
                @for (run of averagePaths(); track $index) {
                  <path class="lc__avg" [attr.d]="run" vector-effect="non-scaling-stroke" />
                }
              }

              @for (dot of dots(); track dot.key) {
                <circle class="lc__dot" [attr.cx]="dot.x" [attr.cy]="dot.y" r="5" />
              }

              @if (active(); as point) {
                <line
                  class="lc__cursor"
                  [attr.x1]="point.x"
                  [attr.x2]="point.x"
                  y1="0"
                  [attr.y2]="H"
                  vector-effect="non-scaling-stroke"
                />
                <circle
                  class="lc__dot lc__dot--active"
                  [attr.cx]="point.x"
                  [attr.cy]="point.y"
                  r="8"
                />
              }
            </svg>

            @if (active(); as point) {
              <!--
                The positioning layer is LTR because the plot is: the callout
                sits at a fraction of the plot measured from its left edge, and
                an inline offset inherited from an Arabic page would measure
                that fraction from the right — putting the callout at the
                mirror of the point it describes, and off the card entirely.
                The callout's own text still reads in its own direction.
              -->
              <div class="lc__layer" dir="ltr">
                <div class="lc__anchor" [style.inset-inline-start.%]="point.percent">
                  <!--
                    The anchor positions, the output reads. They are separate
                    elements because an inline inset resolves against the
                    element's *own* direction: put dir="auto" on the thing
                    being positioned and an Arabic callout measures its offset
                    from the right-hand edge, landing at the mirror of its point.
                  -->
                  <output class="lc__callout t-caption" dir="auto">
                    <span class="lc__callout-value t-body-strong">
                      {{ formatValue()(point.value) }}
                    </span>
                    <span class="lc__callout-key">{{ formatKey()(point.key) }}</span>
                  </output>
                </div>
              </div>
            }
          </div>

          <div class="lc__x" aria-hidden="true">
            @for (label of edgeLabels(); track label) {
              <span class="t-micro">{{ label }}</span>
            }
          </div>
        </div>

        <figcaption class="lc__caption t-caption">
          {{ i18n.t('chart.points', { count: count() }) }}
          @if (scale().zoomed) {
            <!-- A zoomed axis has to show the scale the reader is given. -->
            <span class="lc__range">
              {{
                i18n.t('chart.axisRange', {
                  min: formatValue()(scale().min),
                  max: formatValue()(scale().max),
                })
              }}
            </span>
          }
          @if (state() === 'sparse') {
            <span class="lc__sparse">{{ i18n.t('chart.sparse') }}</span>
          }
          @if (averagePaths().length > 0) {
            <span class="lc__avg-key">{{
              i18n.t('chart.movingAverage', { window: averageWindow() })
            }}</span>
          }
        </figcaption>
      </figure>
    }
  `,
})
export class LineChart {
  protected readonly i18n = inject(I18n);
  protected readonly W = W;
  protected readonly H = H;

  readonly points = input.required<readonly Point[]>();
  /** Calculated, drawn dashed, and named in the caption. */
  readonly average = input<readonly Point[]>([]);
  readonly averageWindow = input(0);
  /** Volume and counts: true. Weight and measurements: false. */
  readonly zeroBased = input(false);
  /** Area fill belongs to a single series only (UI_UX_SPEC section 9). */
  readonly fill = input(true);
  readonly formatValue = input<(value: number) => string>((value) => String(value));
  readonly formatKey = input<(key: string) => string>((key) => key);
  /** Already-translated name of what is plotted, for the image's label. */
  readonly label = input('');

  protected readonly count = computed(() => pointCount(this.points()));
  protected readonly state = computed(() => chartState(this.points()));

  protected readonly scale = computed<Scale>(() =>
    scaleForPoints([...this.points(), ...this.average()], { zeroBased: this.zeroBased() }),
  );

  protected readonly reversedTicks = computed(() => [...this.scale().ticks].reverse());

  /**
   * X positions, one per bucket, evenly spaced.
   *
   * Evenly by bucket rather than by date: the buckets are already a uniform
   * grid of days, weeks or months, and spacing them by elapsed time would make
   * February's bar narrower than March's for no reason a reader could use.
   */
  private readonly xs = computed(() => {
    const total = this.points().length;
    if (total <= 1) return [W / 2];
    return this.points().map((_, index) => (index / (total - 1)) * W);
  });

  private project(points: readonly Point[]): (Point & { x: number; y: number })[] {
    const scale = this.scale();
    const xs = this.xs();
    return points.flatMap((point, index) =>
      point.value === null
        ? []
        : [
            {
              ...point,
              x: xs[index] ?? 0,
              y: H - positionOn(scale, point.value) * H,
            },
          ],
    );
  }

  /** One path per run of readings, so a gap is a gap. */
  protected readonly paths = computed(() =>
    segments(this.points()).map((run) => this.pathFor(run)),
  );

  protected readonly averagePaths = computed(() =>
    segments(this.average()).map((run) => this.pathFor(run)),
  );

  private pathFor(run: readonly Point[]): string {
    const indexOf = new Map(this.points().map((point, index) => [point.key, index]));
    const xs = this.xs();
    const scale = this.scale();

    return run
      .map((point, position) => {
        const x = xs[indexOf.get(point.key) ?? 0] ?? 0;
        const y = H - positionOn(scale, point.value as number) * H;
        return `${position === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`;
      })
      .join(' ');
  }

  /**
   * The area under the line, for a single run only.
   *
   * Only when the whole window is one unbroken run: an area fill across a gap
   * would shade a region the data never covered, which is the same lie as
   * joining the line across it.
   */
  protected readonly area = computed(() => {
    const runs = segments(this.points());
    const only = runs[0];
    if (runs.length !== 1 || !only || only.length < 2) return '';

    const drawn = this.pathFor(only);
    const projected = this.project(only);
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (!first || !last) return '';

    return `${drawn} L${round(last.x)} ${H} L${round(first.x)} ${H} Z`;
  });

  /** Dots at readings only, never at interpolated positions. */
  protected readonly dots = computed(() => {
    const projected = this.project(this.points());
    // Above roughly a dot every 12 px the marks merge into the line and stop
    // telling the reader where the readings are.
    return projected.length > 40 ? [] : projected;
  });

  // ------------------------------------------------------------- scrubbing

  private readonly activeIndex = signal<number | null>(null);
  private dragging = false;

  protected readonly active = computed(() => {
    const index = this.activeIndex();
    if (index === null) return null;

    const point = this.points()[index];
    if (!point || point.value === null) return null;

    const xs = this.xs();
    const x = xs[index] ?? 0;
    return {
      key: point.key,
      value: point.value,
      x,
      y: H - positionOn(this.scale(), point.value) * H,
      // Clamped: the callout is centred on its anchor and may be half the
      // plot wide, so outside this band part of it would sit off the card.
      // The cursor line still marks the exact point, and the callout names
      // the date, so nothing is ambiguous when it stops tracking.
      percent: Math.min(75, Math.max(25, (x / W) * 100)),
    };
  });

  /**
   * Touch reading, as UI_UX_SPEC section 9.5 requires: no hover-only
   * affordance, because a phone has no hover.
   */
  protected scrub(event: PointerEvent): void {
    this.dragging = true;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    this.moveTo(event);
  }

  protected scrubIfDown(event: PointerEvent): void {
    if (this.dragging) this.moveTo(event);
  }

  protected release(): void {
    this.dragging = false;
  }

  private moveTo(event: PointerEvent): void {
    const target = event.currentTarget as SVGSVGElement | null;
    const box = target?.getBoundingClientRect();
    if (!box || box.width === 0) return;

    // The plot is LTR whatever the page direction, so the fraction is measured
    // from the element's left edge rather than from its inline start.
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const total = this.points().length;
    const nearest = Math.round(fraction * (total - 1));

    // Snap to a reading: landing on a gap would show a callout for a value
    // that was never recorded.
    this.activeIndex.set(this.nearestReading(nearest));
  }

  private nearestReading(from: number): number | null {
    const points = this.points();
    for (let offset = 0; offset < points.length; offset++) {
      for (const index of [from - offset, from + offset]) {
        if (index >= 0 && index < points.length && points[index]?.value !== null) return index;
      }
    }
    return null;
  }

  /** What a screen reader is told, since the drawing itself says nothing. */
  protected readonly summary = computed(() =>
    this.i18n.t('chart.summary', { label: this.label(), count: this.count() }),
  );

  /** First and last bucket only: mobile cannot read five date labels. */
  protected readonly edgeLabels = computed(() => {
    const points = this.points();
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return [];
    return first.key === last.key
      ? [this.formatKey()(first.key)]
      : [this.formatKey()(first.key), this.formatKey()(last.key)];
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
