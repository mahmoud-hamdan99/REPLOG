import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { netChange, pointCount, type Point } from '../../domain/analytics/series';
import type { TimeRange } from '../../domain/analytics/range';
import { Badge } from '../../shared/ui/badge';
import { BarChart, type Bar } from '../../shared/ui/bar-chart';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { DistributionChart } from '../../shared/ui/distribution-chart';
import { EmptyState } from '../../shared/ui/empty-state';
import { LineChart } from '../../shared/ui/line-chart';
import { ProgressTabs } from '../../shared/ui/progress-tabs';
import { RangePicker } from '../../shared/ui/range-picker';
import { SectionHeader } from '../../shared/ui/section-header';
import { PlannerStore } from '../planner/planner.store';
import { AnalyticsStore, type AnalyticsTab } from './analytics.store';

/**
 * The Progress hub: strength, volume and body trends.
 *
 * One component for three tabs because they share a store, a range picker and
 * a set of formatting decisions; three components would have meant three
 * copies of all of it kept in step by hand. Which tab is showing comes from
 * the route, so each is a place with its own URL and its own back behaviour.
 *
 * Every chart here is built on the same two rules. A bucket with no training
 * is zero and is drawn as zero, because not training is a fact. A bucket with
 * no reading is unknown and breaks the line, because inventing a value is the
 * one thing PRODUCT_SPEC section 4.9 forbids outright.
 */
@Component({
  selector: 'rl-analytics-page',
  styleUrl: './analytics.page.css',
  imports: [
    AppHeader,
    Badge,
    BarChart,
    Button,
    Card,
    DistributionChart,
    EmptyState,
    LineChart,
    ProgressTabs,
    RangePicker,
    RouterLink,
    SectionHeader,
  ],
  template: `
    <rl-app-header [titleKey]="titleKey()" />

    <div class="page">
      <rl-progress-tabs />

      <rl-range-picker [value]="range()" (selected)="setRange($event)" />

      @if (store.isLoading() && !store.hasData()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (store.error(); as error) {
        <rl-empty-state titleKey="state.error.title" bodyKey="state.error.body" />
        <p class="t-caption">{{ error }}</p>
      } @else {
        @switch (tab()) {
          @case ('strength') {
            @if (store.trainedExercises().length === 0) {
              <rl-empty-state titleKey="analytics.empty.title" bodyKey="analytics.empty.body" />
            } @else {
              <label class="field">
                <span class="t-label">{{ i18n.t('analytics.pickExercise') }}</span>
                <select
                  class="field__input"
                  [value]="exerciseId()"
                  (change)="exerciseId.set($any($event.target).value)"
                >
                  @for (exercise of store.trainedExercises(); track exercise.id) {
                    <option [value]="exercise.id">{{ exercise.name }}</option>
                  }
                </select>
              </label>

              <rl-card>
                <rl-section-header titleKey="analytics.topSet" />
                <rl-line-chart
                  [points]="topSet()"
                  [label]="i18n.t('analytics.topSet')"
                  [formatValue]="massFormatter"
                  [formatKey]="keyFormatter()"
                />
              </rl-card>

              <rl-card>
                <rl-section-header titleKey="analytics.e1rm" />
                <!-- Estimated, so it is drawn and captioned like every other
                     calculated value in this app rather than as a measurement. -->
                <rl-line-chart
                  [points]="e1rm()"
                  [label]="i18n.t('analytics.e1rm')"
                  [formatValue]="massFormatter"
                  [formatKey]="keyFormatter()"
                />
                <p class="t-caption note">{{ i18n.t('chart.gapNote') }}</p>
              </rl-card>
            }
          }

          @case ('volume') {
            <rl-card>
              <rl-section-header titleKey="analytics.volume" />
              <rl-bar-chart
                [bars]="volumeBars()"
                [label]="i18n.t('analytics.volume')"
                [formatValue]="massFormatter"
                [formatKey]="keyFormatter()"
              />
            </rl-card>

            <rl-card>
              <rl-section-header titleKey="analytics.sessions" />
              <rl-bar-chart
                [bars]="sessionBars()"
                [integral]="true"
                [label]="i18n.t('analytics.sessions')"
                [formatValue]="countFormatter"
                [formatKey]="keyFormatter()"
              />
              <p class="t-caption note">{{ consistencyLine() }}</p>
            </rl-card>

            <rl-card>
              <rl-section-header titleKey="analytics.distribution" />
              <rl-distribution
                [slices]="store.muscleDistribution()"
                [footnote]="distributionNote()"
              />
            </rl-card>
          }

          @case ('body') {
            @if (pointCount(weight()) === 0) {
              <rl-empty-state titleKey="analytics.empty.title" bodyKey="analytics.empty.body" />
            }

            <rl-card>
              <rl-section-header titleKey="analytics.weight" />
              <rl-line-chart
                [points]="weight()"
                [average]="weightAverage()"
                [averageWindow]="store.averageWindow()"
                [label]="i18n.t('analytics.weight')"
                [formatValue]="bodyMassFormatter"
                [formatKey]="keyFormatter()"
              />
              @if (weightChange() !== null) {
                <p class="t-caption note">
                  {{ i18n.t('analytics.netChange') }}
                  <rl-badge [kind]="changeKind()">
                    {{ format.delta('mass', weightChange()) }}
                  </rl-badge>
                </p>
              }
            </rl-card>

            @for (field of bodyFields; track field.key) {
              <!-- A card per measurement that was actually taken. A card
                   saying 'not enough data' for a field nobody has ever used
                   is three-quarters of this screen telling the reader off. -->
              @if (pointCount(seriesFor(field.key)) > 0) {
                <rl-card>
                  <rl-section-header [titleKey]="field.titleKey" />
                  <rl-line-chart
                    [points]="seriesFor(field.key)"
                    [label]="i18n.t(field.titleKey)"
                    [formatValue]="field.key === 'bodyFatPct' ? percentFormatter : lengthFormatter"
                    [formatKey]="keyFormatter()"
                  />
                </rl-card>
              }
            }

            <rl-button variant="secondary" [full]="true" routerLink="/body">
              {{ i18n.t('analytics.logMeasurement') }}
            </rl-button>
          }
        }
      }
    </div>
  `,
})
export class AnalyticsPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(AnalyticsStore);
  private readonly planner = inject(PlannerStore);

  /** Bound from the route, so each tab is its own URL. */
  readonly tab = input<AnalyticsTab>('strength');

  protected readonly bodyFields = [
    { key: 'waistCm', titleKey: 'analytics.waist' },
    { key: 'chestCm', titleKey: 'analytics.chest' },
    { key: 'hipsCm', titleKey: 'analytics.hips' },
    { key: 'bodyFatPct', titleKey: 'analytics.bodyFat' },
  ] as const;

  protected readonly exerciseId = signal('');
  /** Bumped after every load, so the series recompute off fresh rows. */
  private readonly version = signal(0);

  constructor() {
    void this.refresh();
    void this.planner.load();
  }

  protected titleKey(): string {
    return {
      strength: 'page.strength.title',
      volume: 'page.volume.title',
      body: 'page.bodyTrends.title',
    }[this.tab()];
  }

  protected range(): TimeRange {
    return this.store.rangeFor(this.tab());
  }

  protected async setRange(range: TimeRange): Promise<void> {
    this.store.setRange(this.tab(), range);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    await this.store.load();
    this.version.update((value) => value + 1);
    if (this.exerciseId() === '') {
      this.exerciseId.set(this.store.defaultExercise());
    }
  }

  // -------------------------------------------------------------- series

  protected readonly topSet = computed<Point[]>(() => {
    this.version();
    return this.exerciseId() === '' ? [] : this.store.topSetSeries(this.exerciseId());
  });

  protected readonly e1rm = computed<Point[]>(() => {
    this.version();
    return this.exerciseId() === '' ? [] : this.store.e1rmSeries(this.exerciseId());
  });

  protected readonly weight = computed<Point[]>(() => {
    this.version();
    return this.store.weightSeries();
  });

  protected readonly weightAverage = computed<Point[]>(() => {
    this.version();
    return this.store.weightAverage();
  });

  protected readonly pointCount = pointCount;

  protected readonly weightChange = computed(() => netChange(this.weight()));

  /**
   * Down is not automatically good, so this only marks a change as positive
   * when there is one; the badge states the number either way.
   */
  protected readonly changeKind = computed(() => (this.weightChange() === 0 ? 'neutral' : 'count'));

  protected seriesFor(field: (typeof this.bodyFields)[number]['key']): Point[] {
    this.version();
    return this.store.measurementSeriesFor(field);
  }

  protected readonly volumeBars = computed<Bar[]>(() => {
    this.version();
    return this.store.volumeSeries().map((point) => ({ key: point.key, value: point.value ?? 0 }));
  });

  protected readonly sessionBars = computed<Bar[]>(() => {
    this.version();
    return this.store.sessionSeries().map((point) => ({ key: point.key, value: point.value ?? 0 }));
  });

  // -------------------------------------------------------------- labels

  /**
   * Consistency against the active plan, or a line saying there is no plan.
   *
   * Never a bare percentage: "75 %" invites "I am 75 % good at this", while
   * "3 of 4 weeks" is a fact somebody can act on.
   */
  protected consistencyLine(): string {
    const perWeek = this.sessionsPerWeek();
    const result = this.store.consistencyFor(perWeek);
    if (result.rate === null) return this.i18n.t('analytics.noPlan');

    return this.i18n.join([
      this.i18n.t('analytics.consistencyValue', {
        hit: result.weeksHit,
        total: result.weeksCounted,
      }),
      this.i18n.t('analytics.streak', { count: this.store.streakFor(perWeek) }),
    ]);
  }

  /** Training days in the active plan, which is what a week is measured against. */
  private sessionsPerWeek(): number | null {
    const plan = this.planner.activePlan();
    if (!plan) return null;

    const days = new Set(
      (this.planner.routines() ?? [])
        .filter((routine) => routine.planId === plan.id)
        .flatMap((routine) => routine.weekdays),
    );
    return days.size === 0 ? null : days.size;
  }

  protected distributionNote(): string {
    const unplaced = this.store.unplacedSets();
    return unplaced === 0
      ? this.i18n.t('analytics.distributionNote')
      : this.i18n.join([
          this.i18n.t('analytics.distributionNote'),
          this.i18n.t('analytics.unplaced', { count: unplaced }),
        ]);
  }

  // ---------------------------------------------------------- formatters

  protected readonly massFormatter = (value: number): string => this.format.massWithUnit(value);
  protected readonly bodyMassFormatter = (value: number): string =>
    this.format.byUnitType('mass', value);
  protected readonly lengthFormatter = (value: number): string =>
    this.format.byUnitType('length', value);
  protected readonly percentFormatter = (value: number): string =>
    this.format.byUnitType('percent', value);
  protected readonly countFormatter = (value: number): string => this.format.number(value);

  /** A bucket key reads as a day, a week's start or a month. */
  protected readonly keyFormatter = computed(() => {
    const bucketing = this.store.bucketingOf(this.tab());
    return (key: string): string =>
      bucketing === 'month' ? this.format.monthLabel(key) : this.format.weekdayDay(key);
  });
}
