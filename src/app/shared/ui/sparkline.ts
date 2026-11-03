import { Component, computed, input } from '@angular/core';
import { positionOn, scaleForPoints } from '../../domain/analytics/axis';
import { segments, type Point } from '../../domain/analytics/series';

const W = 200;
const H = 48;

/**
 * A line with no axes, for inside a stat tile.
 *
 * Decorative in the strict sense: it carries shape, not values, so it is
 * `aria-hidden` and the tile beside it states the number. A sparkline that
 * announced itself to a screen reader would read as a list of coordinates
 * nobody asked for.
 *
 * It still refuses to bridge gaps. The temptation is strong at this size —
 * the break is only a few pixels — but a tile that implies two months of
 * steady progress across a month nobody recorded is wrong at any scale.
 */
@Component({
  selector: 'rl-sparkline',
  styleUrl: './sparkline.css',
  template: `
    <svg
      dir="ltr"
      class="sl"
      [attr.viewBox]="'0 0 ' + W + ' ' + H"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      @for (run of paths(); track $index) {
        <path class="sl__line" [attr.d]="run" vector-effect="non-scaling-stroke" />
      }
      @for (lone of isolated(); track $index) {
        <circle class="sl__lone" [attr.cx]="lone.x" [attr.cy]="lone.y" r="3" />
      }
      @if (last(); as point) {
        <circle class="sl__last" [attr.cx]="point.x" [attr.cy]="point.y" r="4" />
      }
    </svg>
  `,
})
export class Sparkline {
  protected readonly W = W;
  protected readonly H = H;

  readonly points = input.required<readonly Point[]>();
  readonly zeroBased = input(false);

  private readonly scale = computed(() =>
    scaleForPoints(this.points(), { zeroBased: this.zeroBased() }),
  );

  private readonly xs = computed(() => {
    const total = this.points().length;
    if (total <= 1) return [W / 2];
    return this.points().map((_, index) => (index / (total - 1)) * W);
  });

  protected readonly paths = computed(() => {
    const indexOf = new Map(this.points().map((point, index) => [point.key, index]));
    const xs = this.xs();
    const scale = this.scale();

    return segments(this.points())
      .filter((run) => run.length > 1)
      .map((run) =>
        run
          .map((point, position) => {
            const x = xs[indexOf.get(point.key) ?? 0] ?? 0;
            const y = H - positionOn(scale, point.value as number) * H;
            return `${position === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`;
          })
          .join(' '),
      );
  });

  /**
   * Readings with a gap on both sides.
   *
   * A path through a single point draws nothing, so without this a series of
   * alternating readings and gaps — someone weighing in fortnightly against
   * weekly buckets — shows half its data and no shape at all.
   */
  protected readonly isolated = computed(() => {
    const indexOf = new Map(this.points().map((point, index) => [point.key, index]));
    const xs = this.xs();
    const scale = this.scale();

    return segments(this.points())
      .filter((run) => run.length === 1)
      .flatMap((run) => {
        const point = run[0];
        if (!point) return [];
        return [
          {
            x: xs[indexOf.get(point.key) ?? 0] ?? 0,
            y: H - positionOn(scale, point.value as number) * H,
          },
        ];
      });
  });

  /** The latest reading, emphasised — the one number a tile is about. */
  protected readonly last = computed(() => {
    const points = this.points();
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index];
      if (point && point.value !== null) {
        return {
          x: this.xs()[index] ?? 0,
          y: H - positionOn(this.scale(), point.value) * H,
        };
      }
    }
    return null;
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
