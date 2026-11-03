import { computed, inject, Service, signal } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import { CLOCK } from '../../data/clock';
import { MEASUREMENTS_REPO, SET_LOGS_REPO, WORKOUTS_REPO } from '../../data/tokens';
import { scaleFor } from '../../domain/analytics/axis';
import { consistency, longestStreak, type WeekTally } from '../../domain/analytics/consistency';
import { distribution, type DistributionInput } from '../../domain/analytics/distribution';
import {
  bucketKeyOf,
  bucketingFor,
  bucketsIn,
  windowFor,
  type Bucketing,
  type TimeRange,
  type Window,
} from '../../domain/analytics/range';
import {
  measurementSeries,
  movingAverage,
  totalSeries,
  type Point,
  type Sample,
} from '../../domain/analytics/series';
import type { Measurement } from '../../domain/models/body';
import type { SetLog, Workout } from '../../domain/models/workout';
import { isWorkingSet } from '../../domain/strength/volume';
import { dayKeyAt } from '../../domain/time/day-key';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';

/** Which screen a range belongs to; each remembers its own. */
export type AnalyticsTab = 'strength' | 'volume' | 'body';

/**
 * Everything the analytics screens read, loaded once per window.
 *
 * One store rather than one per tab, because the three tabs read overlapping
 * data over the same window: switching from Volume to Body should not re-read
 * the set logs it already has. The window is the cache key — change the range
 * and everything reloads, stay inside it and nothing does.
 *
 * Every series is built in `domain/analytics`, which is where the rule that
 * matters lives: a bucket with no training is zero volume, and a bucket with
 * no weigh-in is unknown. This store's job is to fetch and to hand the right
 * builder the right rows.
 */
@Service()
export class AnalyticsStore {
  private readonly setLogs = inject(SET_LOGS_REPO);
  private readonly workouts = inject(WORKOUTS_REPO);
  private readonly measurements = inject(MEASUREMENTS_REPO);
  private readonly library = inject(ExerciseLibraryStore);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(CLOCK);

  /** One range per tab, so switching tabs does not reset what was chosen. */
  private readonly ranges = signal<Record<AnalyticsTab, TimeRange>>({
    strength: '3m',
    volume: '3m',
    body: '6m',
  });

  private readonly _sets = signal<SetLog[] | null>(null);
  private readonly _workouts = signal<Workout[]>([]);
  private readonly _measurements = signal<Measurement[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _loading = signal(false);
  /** The window the held data was read for, so a repeat request is free. */
  private loadedFor: string | null = null;

  readonly error = this._error.asReadonly();
  readonly isLoading = this._loading.asReadonly();
  readonly hasData = computed(() => this._sets() !== null);

  rangeFor(tab: AnalyticsTab): TimeRange {
    return this.ranges()[tab];
  }

  setRange(tab: AnalyticsTab, range: TimeRange): void {
    this.ranges.update((current) => ({ ...current, [tab]: range }));
  }

  /**
   * The local day, read fresh.
   *
   * A method, not a computed: the clock is not a signal, so a computed would
   * cache the first reading and keep an app left open overnight on yesterday.
   */
  today(): string {
    return dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes());
  }

  windowOf(tab: AnalyticsTab): Window {
    return windowFor(this.rangeFor(tab), this.today());
  }

  bucketingOf(tab: AnalyticsTab): Bucketing {
    return bucketingFor(this.rangeFor(tab));
  }

  /**
   * Loads everything in the widest window any tab is showing.
   *
   * One read for all three: the ranges differ per tab, and reading each
   * separately would fetch the same set logs twice for two tabs looking at
   * overlapping months.
   */
  async load(options: { force?: boolean } = {}): Promise<void> {
    const window = this.widestWindow();
    const key = `${window.from ?? 'all'}..${window.to}`;
    if (this.loadedFor === key && !options.force) return;

    this._loading.set(true);
    this._error.set(null);

    try {
      const range = window.from === null ? undefined : { lower: window.from, upper: window.to };

      const [sets, workouts, measurements] = await Promise.all([
        this.setLogs.list(range ? { index: 'by_dayKey', range } : { index: 'by_dayKey' }),
        this.workouts.list({ index: 'by_status_startedAt', direction: 'prev' }),
        this.measurements.list({ index: 'by_measuredAt' }),
        this.library.load(),
      ]);

      this._sets.set(sets);
      this._workouts.set(workouts.filter((workout) => workout.status === 'completed'));
      this._measurements.set(measurements);
      this.loadedFor = key;
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : 'Analytics could not load');
    } finally {
      this._loading.set(false);
    }
  }

  private widestWindow(): Window {
    const windows = (['strength', 'volume', 'body'] as const).map((tab) => this.windowOf(tab));
    const anyAll = windows.some((window) => window.from === null);
    if (anyAll) return { from: null, to: this.today() };

    const from = windows.reduce<string>(
      (lowest, window) => (window.from !== null && window.from < lowest ? window.from : lowest),
      this.today(),
    );
    return { from, to: this.today() };
  }

  // ------------------------------------------------------------- buckets

  private bucketsOf(tab: AnalyticsTab): string[] {
    const window = this.windowOf(tab);
    if (window.from !== null) return bucketsIn(window, this.bucketingOf(tab), this.weekStart());

    // "All time" has no start until the data does. Falling back to today alone
    // would draw a one-bucket chart for a five-year history.
    const earliest = this.earliestDay();
    return earliest === null
      ? []
      : bucketsIn({ from: earliest, to: window.to }, this.bucketingOf(tab), this.weekStart());
  }

  private earliestDay(): string | null {
    const days = [
      ...(this._sets() ?? []).map((set) => set.dayKey),
      ...this._measurements().map((entry) => entry.measuredAt),
    ];
    return days.length === 0 ? null : days.reduce((low, day) => (day < low ? day : low));
  }

  private weekStart() {
    return this.settings.prefs().weekStartsOn;
  }

  private bucketOf(tab: AnalyticsTab): (day: string) => string {
    const bucketing = this.bucketingOf(tab);
    const weekStart = this.weekStart();
    return (day: string) => bucketKeyOf(day, bucketing, weekStart);
  }

  private inWindow<T>(rows: readonly T[], tab: AnalyticsTab, dayOf: (row: T) => string): T[] {
    const window = this.windowOf(tab);
    return rows.filter(
      (row) => (window.from === null || dayOf(row) >= window.from) && dayOf(row) <= window.to,
    );
  }

  // ------------------------------------------------------------ strength

  /** Completed working sets for one exercise, in the strength window. */
  private setsForExercise(exerciseId: string): SetLog[] {
    return this.inWindow(
      (this._sets() ?? []).filter(
        (set) => set.exerciseId === exerciseId && set.isCompleted && isWorkingSet(set.setType),
      ),
      'strength',
      (set) => set.dayKey,
    );
  }

  /**
   * Estimated one-rep max over time.
   *
   * A measurement series, not a total: a week with no session for this
   * exercise is a week with no estimate, and drawing it as zero would put a
   * cliff in a strength chart that nothing supports.
   */
  e1rmSeries(exerciseId: string): Point[] {
    const samples: Sample[] = this.setsForExercise(exerciseId).flatMap((set) =>
      set.e1rmKg === null ? [] : [{ day: set.dayKey, value: set.e1rmKg }],
    );
    return measurementSeries(
      this.bestPerDay(samples),
      this.bucketsOf('strength'),
      this.bucketOf('strength'),
    );
  }

  /** Heaviest working set over time, which is the number lifters actually track. */
  topSetSeries(exerciseId: string): Point[] {
    const samples: Sample[] = this.setsForExercise(exerciseId).flatMap((set) =>
      set.weightKg === null ? [] : [{ day: set.dayKey, value: set.weightKg }],
    );
    return measurementSeries(
      this.bestPerDay(samples),
      this.bucketsOf('strength'),
      this.bucketOf('strength'),
    );
  }

  /**
   * The best reading of each day, rather than the last.
   *
   * A session's top set is what represents that session; the last set is
   * usually the lightest, after fatigue. Taking it would draw a downward
   * trend out of ordinary training.
   */
  private bestPerDay(samples: readonly Sample[]): Sample[] {
    const best = new Map<string, number>();
    for (const sample of samples) {
      best.set(sample.day, Math.max(best.get(sample.day) ?? -Infinity, sample.value));
    }
    return [...best].map(([day, value]) => ({ day, value }));
  }

  /**
   * Exercises with at least one completed working set in the window, listed
   * alphabetically; the most recently trained one is in `defaultExercise`.
   *
   * The list is alphabetical because that is how someone looks one up. The
   * *default* is not, because alphabetical order opens the screen on whatever
   * happens to start with an A — in this catalog an ab wheel rollout, which
   * carries no load and so has nothing to plot.
   */
  readonly trainedExercises = computed(() => {
    const byId = this.library.byId();
    const seen = new Map<string, string>();

    for (const set of this._sets() ?? []) {
      if (!set.isCompleted || !isWorkingSet(set.setType)) continue;
      const last = seen.get(set.exerciseId);
      if (last === undefined || set.dayKey > last) seen.set(set.exerciseId, set.dayKey);
    }

    return [...seen]
      .flatMap(([id, lastTrained]) => {
        const exercise = byId.get(id);
        return exercise ? [{ id, name: exercise.nameEn, lastTrained }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The exercise the strength tab opens on: the one trained most recently. */
  readonly defaultExercise = computed(() => {
    const ranked = [...this.trainedExercises()].sort((a, b) =>
      b.lastTrained.localeCompare(a.lastTrained),
    );
    return ranked[0]?.id ?? '';
  });

  // -------------------------------------------------------------- volume

  /** Volume per bucket. Zero where nothing was trained, because that is true. */
  volumeSeries(): Point[] {
    const samples: Sample[] = this.workingSets('volume').flatMap((set) =>
      set.volumeKg === null ? [] : [{ day: set.dayKey, value: set.volumeKg }],
    );
    return totalSeries(samples, this.bucketsOf('volume'), this.bucketOf('volume'));
  }

  setCountSeries(): Point[] {
    const samples: Sample[] = this.workingSets('volume').map((set) => ({
      day: set.dayKey,
      value: 1,
    }));
    return totalSeries(samples, this.bucketsOf('volume'), this.bucketOf('volume'));
  }

  sessionSeries(): Point[] {
    const samples: Sample[] = this.inWindow(this._workouts(), 'volume', (workout) =>
      workout.startedAt.slice(0, 10),
    ).map((workout) => ({ day: workout.startedAt.slice(0, 10), value: 1 }));
    return totalSeries(samples, this.bucketsOf('volume'), this.bucketOf('volume'));
  }

  private workingSets(tab: AnalyticsTab): SetLog[] {
    return this.inWindow(
      (this._sets() ?? []).filter((set) => set.isCompleted && isWorkingSet(set.setType)),
      tab,
      (set) => set.dayKey,
    );
  }

  /**
   * Muscle-group share, joined to the cached library.
   *
   * A set whose exercise is not in the library is skipped rather than bucketed
   * as "other": attributing it to a group would invent a fact, and a missing
   * exercise is a data problem the integrity check exists to report.
   */
  readonly muscleDistribution = computed(() => {
    const byId = this.library.byId();
    const rows: DistributionInput[] = this.workingSets('volume').flatMap((set) => {
      const exercise = byId.get(set.exerciseId);
      // The *first* primary muscle, so every set is counted exactly once and
      // the per-group counts sum to the sets actually performed. Splitting a
      // set across two primaries would give fractional set counts, and
      // counting it under both would make the totals larger than the training.
      const muscle = exercise?.primaryMuscles[0];
      return muscle === undefined ? [] : [{ muscle, sets: 1, volumeKg: set.volumeKg ?? 0 }];
    });
    return distribution(rows);
  });

  /** Sets the distribution could not place, so the screen can say so. */
  readonly unplacedSets = computed(() => {
    const byId = this.library.byId();
    return this.workingSets('volume').filter((set) => {
      const exercise = byId.get(set.exerciseId);
      return exercise === undefined || exercise.primaryMuscles.length === 0;
    }).length;
  });

  // ---------------------------------------------------------------- body

  weightSeries(): Point[] {
    const samples: Sample[] = this.inWindow(
      this._measurements().filter((entry) => entry.weightKg !== null),
      'body',
      (entry) => entry.measuredAt,
    ).map((entry) => ({ day: entry.measuredAt, value: entry.weightKg as number }));

    return measurementSeries(samples, this.bucketsOf('body'), this.bucketOf('body'));
  }

  /** Calculated, drawn dashed, and named in the caption. */
  weightAverage(): Point[] {
    return movingAverage(this.weightSeries(), this.averageWindow());
  }

  averageWindow(): number {
    // Four buckets: four weeks of weigh-ins, or four months of them. Long
    // enough to flatten day-to-day noise, short enough to still turn.
    return 4;
  }

  measurementSeriesFor(field: 'waistCm' | 'chestCm' | 'hipsCm' | 'bodyFatPct'): Point[] {
    const samples: Sample[] = this.inWindow(
      this._measurements().filter((entry) => entry[field] !== null),
      'body',
      (entry) => entry.measuredAt,
    ).map((entry) => ({ day: entry.measuredAt, value: entry[field] as number }));

    return measurementSeries(samples, this.bucketsOf('body'), this.bucketOf('body'));
  }

  // --------------------------------------------------------- consistency

  /** Sessions per week across the volume window, for the consistency read. */
  readonly weeklyTallies = computed<WeekTally[]>(() => {
    const weekStart = this.weekStart();
    const buckets = bucketsIn(this.windowOf('volume'), 'week', weekStart);
    const counts = new Map<string, number>();

    for (const workout of this.inWindow(this._workouts(), 'volume', (w) =>
      w.startedAt.slice(0, 10),
    )) {
      const key = bucketKeyOf(workout.startedAt.slice(0, 10), 'week', weekStart);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return buckets.map((week) => ({ week, sessions: counts.get(week) ?? 0 }));
  });

  consistencyFor(sessionsPerWeek: number | null) {
    return consistency(this.weeklyTallies(), sessionsPerWeek);
  }

  streakFor(sessionsPerWeek: number | null): number {
    return longestStreak(this.weeklyTallies(), sessionsPerWeek);
  }

  /** Exposed so a caller can label an axis without rebuilding the scale. */
  readonly scaleFor = scaleFor;
}
