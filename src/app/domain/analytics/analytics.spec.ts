import { positionOn, scaleFor, scaleForPoints } from './axis';
import { consistency, longestStreak } from './consistency';
import { distribution } from './distribution';
import {
  bucketKeyOf,
  bucketingFor,
  bucketsIn,
  windowFor,
  withinWindow,
  type TimeRange,
} from './range';
import {
  chartState,
  measurementSeries,
  movingAverage,
  netChange,
  pointCount,
  segments,
  totalSeries,
  type Point,
} from './series';

/**
 * The arithmetic every chart rests on.
 *
 * Pure, so none of it needs a browser — which matters because the thing most
 * likely to be wrong here is not the drawing but the bucketing, and a bug
 * there is invisible on screen: the chart looks fine and says the wrong thing.
 */

const MONDAY = 1;
const day = (key: string) => key;

describe('ranges', () => {
  it('counts an inclusive window, so "7 days" is seven days', () => {
    // Today plus the six before it. Off by one here is a whole bar of
    // training appearing or vanishing.
    expect(windowFor('7d', '2026-03-20')).toEqual({ from: '2026-03-14', to: '2026-03-20' });
    expect(windowFor('30d', '2026-03-20')).toEqual({ from: '2026-02-19', to: '2026-03-20' });
  });

  it('counts months in calendar terms, not in days', () => {
    expect(windowFor('3m', '2026-06-20')).toEqual({ from: '2026-03-21', to: '2026-06-20' });
    expect(windowFor('1y', '2026-06-20')).toEqual({ from: '2025-06-21', to: '2026-06-20' });
  });

  it('clamps a month-end start to a shorter month', () => {
    // Three months before 31 May is February, which has no 31st. Rolling over
    // would silently stretch the window past what the user asked for.
    expect(windowFor('3m', '2026-05-31').from).toBe('2026-03-01');
  });

  it('has no start for all time', () => {
    expect(windowFor('all', '2026-03-20')).toEqual({ from: null, to: '2026-03-20' });
  });

  it('reads short ranges by day and long ones by month', () => {
    const expected: Record<TimeRange, string> = {
      '7d': 'day',
      '30d': 'day',
      '3m': 'week',
      '6m': 'week',
      '1y': 'month',
      all: 'month',
    };

    for (const [range, bucketing] of Object.entries(expected)) {
      expect(bucketingFor(range as TimeRange)).toBe(bucketing);
    }
  });
});

describe('bucketing', () => {
  it('keys a week by its first day, honouring the week start', () => {
    // 2026-03-20 is a Friday.
    expect(bucketKeyOf('2026-03-20', 'week', MONDAY)).toBe('2026-03-16');
    expect(bucketKeyOf('2026-03-20', 'week', 0)).toBe('2026-03-15');
    expect(bucketKeyOf('2026-03-20', 'month', MONDAY)).toBe('2026-03');
    expect(bucketKeyOf('2026-03-20', 'day', MONDAY)).toBe('2026-03-20');
  });

  it('emits every bucket in the window, including the empty ones', () => {
    // The empty ones are the point: a chart built only from buckets that have
    // data draws March straight to June as though April never happened.
    const buckets = bucketsIn({ from: '2026-03-01', to: '2026-03-07' }, 'day', MONDAY);

    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toBe('2026-03-01');
    expect(buckets[6]).toBe('2026-03-07');
  });

  it('crosses a month boundary without losing or repeating a week', () => {
    const buckets = bucketsIn({ from: '2026-03-25', to: '2026-04-08' }, 'week', MONDAY);

    expect(buckets).toEqual(['2026-03-23', '2026-03-30', '2026-04-06']);
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  it('crosses a year boundary', () => {
    const buckets = bucketsIn({ from: '2025-11-15', to: '2026-02-03' }, 'month', MONDAY);

    expect(buckets).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('spans a daylight-saving change without dropping or doubling a day', () => {
    // Clocks move in most of Europe on the last Sunday of March. A day is 23
    // hours there, and bucketing by millisecond arithmetic lands on the wrong
    // date or emits the same one twice.
    const buckets = bucketsIn({ from: '2026-03-27', to: '2026-03-31' }, 'day', MONDAY);

    expect(buckets).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });

  it('spans the autumn change too, where a day is 25 hours', () => {
    const buckets = bucketsIn({ from: '2026-10-24', to: '2026-10-27' }, 'day', MONDAY);

    expect(buckets).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('emits one bucket for a single-day window', () => {
    expect(bucketsIn({ from: '2026-03-20', to: '2026-03-20' }, 'day', MONDAY)).toEqual([
      '2026-03-20',
    ]);
  });

  it('has no buckets for an open-ended window, which the caller must bound', () => {
    expect(bucketsIn({ from: null, to: '2026-03-20' }, 'month', MONDAY)).toEqual([]);
  });

  it('knows what is inside the window', () => {
    const window = { from: '2026-03-01', to: '2026-03-31' };

    expect(withinWindow('2026-03-01', window)).toBe(true);
    expect(withinWindow('2026-03-31', window)).toBe(true);
    expect(withinWindow('2026-02-28', window)).toBe(false);
    expect(withinWindow('2026-04-01', window)).toBe(false);
    expect(withinWindow('2019-01-01', { from: null, to: '2026-03-31' })).toBe(true);
  });
});

describe('series', () => {
  const buckets = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];

  it('treats a bucket with no training as zero volume', () => {
    // Not a gap: you did no work that day, and hiding it would conceal the
    // fortnight somebody missed.
    const points = totalSeries(
      [
        { day: '2026-03-01', value: 1000 },
        { day: '2026-03-01', value: 500 },
        { day: '2026-03-04', value: 800 },
      ],
      buckets,
      day,
    );

    expect(points.map((point) => point.value)).toEqual([1500, 0, 0, 800]);
  });

  it('treats a bucket with no weigh-in as unknown', () => {
    // A gap, not zero: drawing it as zero puts a cliff in the chart that the
    // scale never recorded.
    const points = measurementSeries(
      [
        { day: '2026-03-01', value: 80.4 },
        { day: '2026-03-04', value: 79.8 },
      ],
      buckets,
      day,
    );

    expect(points.map((point) => point.value)).toEqual([80.4, null, null, 79.8]);
  });

  it('takes the last reading in a bucket rather than averaging them', () => {
    // Every point on the chart is then a number that was really on the scale.
    const points = measurementSeries(
      [
        { day: '2026-03-01', value: 80 },
        { day: '2026-03-02', value: 81 },
        { day: '2026-03-03', value: 79 },
      ],
      ['2026-03'],
      () => '2026-03',
    );

    expect(points[0]?.value).toBe(79);
  });

  it('breaks a line into runs, so a gap stays a gap on screen', () => {
    const points: Point[] = [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
      { key: 'c', value: null },
      { key: 'd', value: 4 },
    ];

    expect(segments(points).map((run) => run.map((point) => point.key))).toEqual([
      ['a', 'b'],
      ['d'],
    ]);
  });

  describe('moving average', () => {
    it('averages over the trailing window', () => {
      const points: Point[] = [
        { key: 'a', value: 10 },
        { key: 'b', value: 20 },
        { key: 'c', value: 30 },
      ];

      expect(movingAverage(points, 3).map((point) => point.value)).toEqual([null, 15, 20]);
    });

    it('is null until the window holds enough readings', () => {
      // One weigh-in in a quiet month must not produce a confident trend line
      // through nothing.
      const points: Point[] = [
        { key: 'a', value: 70 },
        { key: 'b', value: null },
        { key: 'c', value: null },
      ];

      expect(movingAverage(points, 3).map((point) => point.value)).toEqual([null, null, null]);
    });

    it('never reaches past its window to find points', () => {
      // Averaging "the last 3 readings" instead of "readings in the last 3
      // buckets" would quietly span the six-month gap in the middle here.
      const points: Point[] = [
        { key: 'jan', value: 100 },
        { key: 'feb', value: 100 },
        { key: 'mar', value: null },
        { key: 'apr', value: null },
        { key: 'may', value: null },
        { key: 'jun', value: 70 },
      ];

      const averaged = movingAverage(points, 3);

      // June's window is April, May, June — one reading, so no average.
      expect(averaged[5]?.value).toBeNull();
      expect(averaged[1]?.value).toBe(100);
    });
  });

  it('counts the readings, which the chart always prints', () => {
    expect(
      pointCount([
        { key: 'a', value: 1 },
        { key: 'b', value: null },
        { key: 'c', value: 3 },
      ]),
    ).toBe(2);
  });

  describe('chart state', () => {
    const withCount = (count: number): Point[] =>
      Array.from({ length: count }, (_, index) => ({ key: String(index), value: index }));

    it('is empty below three readings', () => {
      // Two points always look like a trend and almost never are.
      expect(chartState(withCount(0))).toBe('empty');
      expect(chartState(withCount(2))).toBe('empty');
    });

    it('is sparse from three to four, which means no trend line', () => {
      expect(chartState(withCount(3))).toBe('sparse');
      expect(chartState(withCount(4))).toBe('sparse');
    });

    it('is ok from five', () => {
      expect(chartState(withCount(5))).toBe('ok');
    });

    it('counts readings, not buckets', () => {
      const mostlyGaps: Point[] = [
        { key: 'a', value: 1 },
        { key: 'b', value: null },
        { key: 'c', value: null },
        { key: 'd', value: null },
        { key: 'e', value: 2 },
      ];

      expect(chartState(mostlyGaps)).toBe('empty');
    });
  });

  it('reports the net change between the first and last readings', () => {
    expect(
      netChange([
        { key: 'a', value: 82.5 },
        { key: 'b', value: null },
        { key: 'c', value: 79.8 },
      ]),
    ).toBe(-2.7);
  });

  it('has no net change without two readings', () => {
    expect(netChange([{ key: 'a', value: 80 }])).toBeNull();
    expect(netChange([])).toBeNull();
  });
});

describe('distribution', () => {
  it('rolls detailed muscles up into the twelve categories', () => {
    const slices = distribution([
      { muscle: 'lats', sets: 4, volumeKg: 2000 },
      { muscle: 'upper-back', sets: 2, volumeKg: 900 },
      { muscle: 'chest', sets: 3, volumeKg: 1500 },
    ]);

    expect(slices.map((slice) => slice.group)).toEqual(['back', 'chest']);
    expect(slices[0]).toMatchObject({ sets: 6, volumeKg: 2900 });
  });

  it('counts sets rather than volume', () => {
    // A volume-weighted chart says "you train legs" to someone who trains
    // everything equally, because a squat moves more weight than a curl.
    const slices = distribution([
      { muscle: 'quadriceps', sets: 3, volumeKg: 9000 },
      { muscle: 'biceps', sets: 3, volumeKg: 900 },
    ]);

    expect(slices.map((slice) => slice.share)).toEqual([50, 50]);
  });

  it('sums to exactly 100 even when the thirds do not divide', () => {
    // Rounding each share on its own gives 99 or 101 often enough to notice,
    // and a distribution that does not add up undermines the whole screen.
    const slices = distribution([
      { muscle: 'chest', sets: 1, volumeKg: 1 },
      { muscle: 'back', sets: 1, volumeKg: 1 },
      { muscle: 'biceps', sets: 1, volumeKg: 1 },
    ]);

    expect(slices.reduce((total, slice) => total + slice.share, 0)).toBe(100);
  });

  it('sums to exactly 100 across many uneven groups', () => {
    const slices = distribution([
      { muscle: 'chest', sets: 7, volumeKg: 1 },
      { muscle: 'back', sets: 5, volumeKg: 1 },
      { muscle: 'biceps', sets: 3, volumeKg: 1 },
      { muscle: 'triceps', sets: 3, volumeKg: 1 },
      { muscle: 'calves', sets: 1, volumeKg: 1 },
      { muscle: 'abs', sets: 1, volumeKg: 1 },
      { muscle: 'glutes', sets: 1, volumeKg: 1 },
    ]);

    expect(slices.reduce((total, slice) => total + slice.share, 0)).toBe(100);
  });

  it('orders by share, breaking ties by name so the chart does not shuffle', () => {
    const slices = distribution([
      { muscle: 'triceps', sets: 2, volumeKg: 1 },
      { muscle: 'biceps', sets: 2, volumeKg: 1 },
      { muscle: 'chest', sets: 5, volumeKg: 1 },
    ]);

    expect(slices.map((slice) => slice.group)).toEqual(['chest', 'biceps', 'triceps']);
  });

  it('is empty with nothing recorded rather than inventing a zero slice', () => {
    expect(distribution([])).toEqual([]);
  });
});

describe('consistency', () => {
  const weeks = [
    { week: '2026-03-02', sessions: 3 },
    { week: '2026-03-09', sessions: 1 },
    { week: '2026-03-16', sessions: 3 },
    { week: '2026-03-23', sessions: 4 },
  ];

  it('counts weeks met, not sessions completed', () => {
    // Eight sessions in one week and nothing for three is a session count
    // that looks fine and a habit that does not exist.
    expect(consistency(weeks, 3)).toMatchObject({
      weeksHit: 3,
      weeksCounted: 4,
      sessions: 11,
      planned: 12,
      rate: 0.75,
    });
  });

  it('has no rate without a plan to measure against', () => {
    // Null, not zero: having no target is not the same as missing it.
    expect(consistency(weeks, null).rate).toBeNull();
    expect(consistency(weeks, 0).rate).toBeNull();
  });

  it('still reports the sessions when there is no plan', () => {
    expect(consistency(weeks, null).sessions).toBe(11);
  });

  it('has no rate with no weeks', () => {
    expect(consistency([], 3).rate).toBeNull();
  });

  it('measures the longest run of weeks met', () => {
    expect(longestStreak(weeks, 3)).toBe(2);
    expect(longestStreak(weeks, 1)).toBe(4);
    expect(longestStreak(weeks, 5)).toBe(0);
  });

  it('has no streak without a target', () => {
    expect(longestStreak(weeks, null)).toBe(0);
  });
});

describe('axis', () => {
  it('starts a volume axis at zero', () => {
    // The bar's length is the quantity; a truncated bar misstates it.
    const scale = scaleFor([1200, 4300, 2600], { zeroBased: true });

    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(4300);
    expect(scale.zoomed).toBe(false);
  });

  it('rounds a zero-based maximum to a number a person would pick', () => {
    expect(scaleFor([4300], { zeroBased: true }).max % 1000).toBe(0);
  });

  it('zooms a weight axis, and says that it did', () => {
    // 2 kg on a 0–100 axis is invisible, so zooming is right — and a zoomed
    // axis has to show the scale the reader is being given.
    const scale = scaleFor([79.8, 80.4, 81.2], { zeroBased: false });

    expect(scale.zoomed).toBe(true);
    expect(scale.min).toBeLessThan(79.8);
    expect(scale.max).toBeGreaterThan(81.2);
  });

  it('labels a count axis in whole units', () => {
    // Nothing on an axis of sessions can fall between two ticks, so the
    // ticks must not either: 0.75 of a workout is not a thing.
    const scale = scaleFor([3], { zeroBased: true, integral: true });

    expect(scale.ticks).toEqual([0, 1, 2, 3]);
  });

  it('keeps a count axis whole when the numbers get larger', () => {
    for (const max of [1, 2, 5, 9, 17, 120]) {
      const scale = scaleFor([max], { zeroBased: true, integral: true });
      expect(scale.max).toBeGreaterThanOrEqual(max);
      for (const tick of scale.ticks) expect(Number.isInteger(tick)).toBe(true);
      expect(scale.ticks.length).toBeLessThanOrEqual(5);
    }
  });

  it('never clips the data', () => {
    // A "nice" step that cut the maximum would hide the best set in the
    // window behind the top of the chart.
    for (const values of [[7], [999], [0.3, 0.7], [12_345]]) {
      for (const zeroBased of [true, false]) {
        const scale = scaleFor(values, { zeroBased });
        expect(scale.max).toBeGreaterThanOrEqual(Math.max(...values));
        expect(scale.min).toBeLessThanOrEqual(Math.min(...values));
      }
    }
  });

  it('gives a flat series an axis it can be drawn on', () => {
    const scale = scaleFor([80, 80, 80], { zeroBased: false });

    expect(scale.max).toBeGreaterThan(scale.min);
  });

  it('labels at most five ticks, first and last being the real bounds', () => {
    const scale = scaleFor([10, 90], { zeroBased: true });

    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(scale.ticks[0]).toBe(scale.min);
    expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.max);
  });

  it('has a drawable axis with no data at all', () => {
    const scale = scaleFor([], { zeroBased: true });

    expect(scale.max).toBeGreaterThan(scale.min);
  });

  it('ignores gaps when scaling a series', () => {
    const scale = scaleForPoints(
      [
        { key: 'a', value: 80 },
        { key: 'b', value: null },
        { key: 'c', value: 82 },
      ],
      { zeroBased: false },
    );

    expect(scale.min).toBeLessThan(80);
    expect(scale.max).toBeGreaterThan(82);
  });

  it('places a value as a fraction of the axis', () => {
    const scale = { min: 0, max: 100, ticks: [], zoomed: false };

    expect(positionOn(scale, 0)).toBe(0);
    expect(positionOn(scale, 50)).toBe(0.5);
    expect(positionOn(scale, 100)).toBe(1);
  });

  it('clamps a value that rounds past the axis', () => {
    // A moving average can land a hair outside the scale it was measured
    // against, and a point drawn outside the plot is worse than one on its edge.
    const scale = { min: 0, max: 100, ticks: [], zoomed: false };

    expect(positionOn(scale, 120)).toBe(1);
    expect(positionOn(scale, -5)).toBe(0);
  });
});
