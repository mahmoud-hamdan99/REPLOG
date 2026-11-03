import type { Point } from './series';

/**
 * Choosing an axis, which is a question about honesty before it is one about
 * aesthetics.
 *
 * UI_UX_SPEC section 9.4 splits it in two. A volume or count axis always
 * starts at zero, because the bar's length is the quantity and a truncated bar
 * misstates it by whatever was cut off. A body-weight axis may be zoomed,
 * because 2 kg on a 0–100 scale is invisible and a chart nobody can read helps
 * no one — but a zoomed axis has to print its real minimum and maximum, so the
 * reader can see the scale they are being shown.
 */

export interface Scale {
  min: number;
  max: number;
  /** Values to label, from `min` to `max` inclusive. At most five. */
  ticks: number[];
  /** True when `min` is not zero, so the view can say so. */
  zoomed: boolean;
}

export interface ScaleOptions {
  /** Volume and counts: true. Weight and measurements: false. */
  zeroBased: boolean;
  /** At most this many labels; mobile cannot read more than four or five. */
  maxTicks?: number;
  /**
   * Whole-number ticks only, for axes counting things.
   *
   * An axis of sessions labelled 0.75, 1.5, 2.25 is asking the reader to
   * picture three-quarters of a workout. Nothing on such an axis can fall
   * between two ticks, so the ticks should not either.
   */
  integral?: boolean;
}

/**
 * An axis covering every value, rounded to numbers a person would choose.
 *
 * Always covers the data: a "nice" step that clipped the maximum would hide
 * the best set in the window behind the top of the chart.
 */
export function scaleFor(values: readonly number[], options: ScaleOptions): Scale {
  const maxTicks = options.maxTicks ?? 5;
  const finite = values.filter((value) => Number.isFinite(value));

  if (finite.length === 0) {
    return { min: 0, max: 1, ticks: [0, 1], zoomed: false };
  }

  const lowest = Math.min(...finite);
  const highest = Math.max(...finite);

  if (options.zeroBased && options.integral) {
    const max = Math.max(1, Math.ceil(highest));
    // Below the tick budget, one tick per unit: 0, 1, 2, 3 for a maximum of
    // three, rather than four evenly spaced quarters of it.
    const steps = max <= maxTicks - 1 ? max : maxTicks - 1;
    const step = niceStep(Math.ceil(max / steps));
    const top = step * steps;
    return { min: 0, max: top, ticks: ticksBetween(0, top, steps + 1), zoomed: false };
  }

  if (options.zeroBased) {
    const max = niceCeiling(Math.max(highest, 0), maxTicks);
    return { min: 0, max, ticks: ticksBetween(0, max, maxTicks), zoomed: false };
  }

  // A flat series has no range to divide, and an axis from x to x cannot be
  // drawn. Padding by a tenth keeps the line in the middle of the chart rather
  // than along its edge.
  const span = highest - lowest;
  const padding = span === 0 ? Math.max(Math.abs(highest) * 0.1, 1) : span * 0.1;

  const min = floorTo(lowest - padding);
  const max = ceilTo(highest + padding);

  return { min, max, ticks: ticksBetween(min, max, maxTicks), zoomed: min !== 0 };
}

/** The scale a series of points needs, ignoring its gaps. */
export function scaleForPoints(points: readonly Point[], options: ScaleOptions): Scale {
  return scaleFor(
    points.flatMap((point) => (point.value === null ? [] : [point.value])),
    options,
  );
}

/**
 * Where a value sits on the axis, as 0–1 from the bottom.
 *
 * Clamped, because a moving average computed over a window can round a hair
 * past the axis it was scaled against, and a point drawn outside the plot is
 * worse than one drawn on its edge.
 */
export function positionOn(scale: Scale, value: number): number {
  const span = scale.max - scale.min;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - scale.min) / span));
}

/** Round up to 1, 2 or 5 times a power of ten, divided evenly by the ticks. */
function niceCeiling(value: number, ticks: number): number {
  if (value <= 0) return 1;

  const steps = Math.max(1, ticks - 1);
  const rough = value / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  return Math.ceil(value / step) * step;
}

/** The next whole step a person would count in: 1, 2, 5, 10, 20, 50 … */
function niceStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const normalised = value / magnitude;
  return (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
}

function ticksBetween(min: number, max: number, count: number): number[] {
  const steps = Math.max(1, count - 1);
  const step = (max - min) / steps;
  return Array.from({ length: steps + 1 }, (_, index) => round2(min + step * index));
}

function floorTo(value: number): number {
  return round2(Math.floor(value * 10) / 10);
}

function ceilTo(value: number): number {
  return round2(Math.ceil(value * 10) / 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
