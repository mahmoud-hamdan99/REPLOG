/**
 * Turning records into something a chart can draw, without inventing anything.
 *
 * The rule PRODUCT_SPEC section 4.9 states as "do not fabricate missing data"
 * splits into two different answers, and getting them the wrong way round is
 * the bug this module exists to prevent:
 *
 *   - **A week with no training is zero volume.** That is a measurement, not a
 *     gap. Drawing it as a gap would hide the fortnight somebody missed.
 *   - **A week with no weigh-in is unknown.** That is a gap, not zero. Drawing
 *     it as zero would put a cliff in the chart that the scale never recorded.
 *
 * So there are two builders, named for which they are, and neither can be used
 * for the other's job by accident.
 */

export interface Point {
  /** Bucket key — a day key, a week's first day, or `YYYY-MM`. */
  key: string;
  /** `null` means "not known", and a chart must break its line here. */
  value: number | null;
}

export interface Sample {
  /** The day this reading belongs to. */
  day: string;
  value: number;
}

/**
 * One point per bucket, summing what happened in it, zero where nothing did.
 *
 * For volume, set counts, rep counts, session counts — anything where "none"
 * is a real quantity the user can act on.
 */
export function totalSeries(
  samples: readonly Sample[],
  buckets: readonly string[],
  bucketOf: (day: string) => string,
): Point[] {
  const totals = new Map<string, number>();
  for (const sample of samples) {
    const key = bucketOf(sample.day);
    totals.set(key, (totals.get(key) ?? 0) + sample.value);
  }

  return buckets.map((key) => ({ key, value: totals.get(key) ?? 0 }));
}

/**
 * One point per bucket, carrying a reading that was actually taken.
 *
 * Null where the bucket holds no reading. Where it holds several, the **last**
 * one wins rather than their mean: every point on the chart is then a number
 * that was really on the scale that day, and a tooltip can show it without
 * qualification. A mean would be defensible, but it is a value nobody
 * measured, and this app's rule is that a displayed number is a recorded one
 * unless it is marked as calculated.
 */
export function measurementSeries(
  samples: readonly Sample[],
  buckets: readonly string[],
  bucketOf: (day: string) => string,
): Point[] {
  const latest = new Map<string, Sample>();
  for (const sample of samples) {
    const key = bucketOf(sample.day);
    const held = latest.get(key);
    if (held === undefined || sample.day >= held.day) latest.set(key, sample);
  }

  return buckets.map((key) => ({ key, value: latest.get(key)?.value ?? null }));
}

/**
 * A trailing average over the last `window` buckets.
 *
 * Calculated, and the UI says so — the spec allows a moving average only when
 * it is labelled as such, because a smoothed line looks exactly like a
 * measured one.
 *
 * Two rules keep it honest. It averages over a fixed number of *buckets*, not
 * over the last N readings, so it can never quietly span a six-month gap to
 * find enough points. And it is null unless at least `minPoints` of those
 * buckets hold a reading, so a single weigh-in in a quiet month does not
 * produce a confident-looking trend line through nothing.
 */
export function movingAverage(points: readonly Point[], window: number, minPoints = 2): Point[] {
  return points.map((point, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = points.slice(start, index + 1);
    const values = slice.flatMap((candidate) =>
      candidate.value === null ? [] : [candidate.value],
    );

    if (values.length < minPoints) return { key: point.key, value: null };
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return { key: point.key, value: round2(mean) };
  });
}

export type ChartState =
  /** Nothing to draw. The screen shows an empty state, not an axis. */
  | 'empty'
  /** Enough to plot, not enough to claim a direction. No trend line. */
  | 'sparse'
  | 'ok';

/** How many points carry a reading. The count is always shown beside a chart. */
export function pointCount(points: readonly Point[]): number {
  return points.filter((point) => point.value !== null).length;
}

/**
 * Whether there is enough here to draw, and enough to interpret.
 *
 * The thresholds are UI_UX_SPEC section 9.3's: under three points there is no
 * chart, under five there is no trend line. Two points always look like a
 * trend and almost never are.
 */
export function chartState(points: readonly Point[]): ChartState {
  const count = pointCount(points);
  if (count < 3) return 'empty';
  return count < 5 ? 'sparse' : 'ok';
}

/**
 * Runs of consecutive points that have readings.
 *
 * What a line chart draws: one path per run, so a gap is a gap on screen
 * rather than a straight line through months nobody recorded.
 */
export function segments(points: readonly Point[]): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    if (point.value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

/** The change between the first and last readings, or null without both. */
export function netChange(points: readonly Point[]): number | null {
  const known = points.filter((point): point is Point & { value: number } => point.value !== null);
  const first = known[0];
  const last = known[known.length - 1];
  return known.length < 2 || !first || !last ? null : round2(last.value - first.value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
