import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { netChange, pointCount, type Point } from '../../domain/analytics/series';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { SectionHeader } from '../../shared/ui/section-header';
import { Sparkline } from '../../shared/ui/sparkline';
import { StatTile } from '../../shared/ui/stat-tile';
import { BackupReminderStore } from '../backup/reminder.store';
import { PlannerStore } from '../planner/planner.store';
import { RecordsStore } from '../records/records.store';
import { AnalyticsStore } from '../analytics/analytics.store';

/**
 * Home.
 *
 * Every figure here is a count or a reading, never a score. The rule the
 * acceptance criterion states — *every number on the dashboard is reproducible
 * by hand from the stored records* — is what rules out the composite
 * "fitness score" this kind of screen usually grows: a number nobody can
 * check is a number nobody should trust.
 *
 * So: sessions this week is a count of completed workouts. Body weight is the
 * last reading on the scale. Consistency is weeks met over weeks counted, with
 * both halves shown. Nothing is normalised, weighted or smoothed.
 */
@Component({
  selector: 'rl-dashboard-page',
  styleUrl: './dashboard.page.css',
  imports: [
    AppHeader,
    Badge,
    Button,
    Card,
    EmptyState,
    RouterLink,
    SectionHeader,
    Sparkline,
    StatTile,
  ],
  template: `
    <rl-app-header titleKey="page.dashboard.title" />

    <div class="page">
      @if (loading()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (isEmpty()) {
        <rl-empty-state
          titleKey="dashboard.empty.title"
          bodyKey="dashboard.empty.body"
          actionKey="dashboard.empty.action"
          (actioned)="goTrain()"
        />
      } @else {
        <!-- Non-blocking and snoozable, per DATABASE_SPEC section 9.4. It sits
             above the tiles because a reminder below the fold is not one, and
             it is a card rather than a dialog because nothing here is urgent
             enough to stand between someone and their training. -->
        @if (reminders.reminder(); as due) {
          <rl-card>
            <rl-section-header titleKey="reminder.title" />
            <p class="t-body reminder__body">
              {{
                due.reason === 'never-exported'
                  ? i18n.t('reminder.never')
                  : i18n.t('reminder.stale', { count: due.daysSinceExport })
              }}
            </p>
            <div class="reminder__actions">
              <rl-button variant="primary" routerLink="/settings/data">
                {{ i18n.t('reminder.action') }}
              </rl-button>
              <rl-button variant="ghost" (click)="snoozeReminder()">
                {{ i18n.t('reminder.snooze') }}
              </rl-button>
            </div>
          </rl-card>
        }

        <div class="tiles">
          <rl-stat-tile
            labelKey="dashboard.thisWeek"
            [value]="format.number(sessionsThisWeek())"
            [footnoteKey]="'dashboard.thisWeekNote'"
          />
          <rl-stat-tile
            labelKey="dashboard.consistency"
            [value]="consistencyValue()"
            [footnoteText]="consistencyNote()"
            emptyHintKey="analytics.noPlan"
          />
        </div>

        @if (weightPoints().length > 0) {
          <rl-card class="weight">
            <rl-section-header titleKey="analytics.weight" />
            <div class="weight__row">
              <span class="t-stat">{{ latestWeight() }}</span>
              @if (weightChange() !== null) {
                <rl-badge kind="count">{{ format.delta('mass', weightChange()) }}</rl-badge>
              }
            </div>
            <!-- Shape only; the number above it is the fact. -->
            <rl-sparkline [points]="weightPoints()" />
            <p class="t-caption note">{{ i18n.t('chart.points', { count: weightCount() }) }}</p>
          </rl-card>
        }

        @if (records().length > 0) {
          <section>
            <rl-section-header titleKey="dashboard.recentRecords" />
            @for (record of records(); track record.id) {
              <rl-card class="row">
                <span class="t-body">{{ record.nameSnapshot }}</span>
                <span class="t-caption">{{ format.recordType(record) }}</span>
                <span class="t-body-strong">{{ format.recordValue(record) }}</span>
              </rl-card>
            }
            <a class="more t-label" routerLink="/records">{{ i18n.t('dashboard.allRecords') }}</a>
          </section>
        }

        <a class="more t-label" routerLink="/history">{{ i18n.t('dashboard.allHistory') }}</a>
      }
    </div>
  `,
})
export class DashboardPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  private readonly analytics = inject(AnalyticsStore);
  private readonly recordsStore = inject(RecordsStore);
  private readonly planner = inject(PlannerStore);
  protected readonly reminders = inject(BackupReminderStore);

  protected readonly loading = signal(true);
  private readonly version = signal(0);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    // The analytics store already reads everything this screen needs over the
    // widest open window; a second set of queries here would read the same
    // rows again for the same answers.
    await Promise.all([
      this.analytics.load(),
      this.recordsStore.load(),
      this.planner.load(),
      this.reminders.check(),
    ]);
    this.version.update((value) => value + 1);
    this.loading.set(false);
  }

  protected async snoozeReminder(): Promise<void> {
    await this.reminders.snooze();
  }

  /** Completed sessions in the current week — Q2, counted, not estimated. */
  protected readonly sessionsThisWeek = computed(() => {
    this.version();
    const weeks = this.analytics.weeklyTallies();
    return weeks[weeks.length - 1]?.sessions ?? 0;
  });

  protected readonly weightPoints = computed<Point[]>(() => {
    this.version();
    return this.analytics.weightSeries();
  });

  protected readonly weightCount = computed(() => pointCount(this.weightPoints()));

  protected readonly latestWeight = computed(() => {
    const points = this.weightPoints();
    for (let index = points.length - 1; index >= 0; index--) {
      const value = points[index]?.value;
      if (value !== null && value !== undefined) return this.format.byUnitType('mass', value);
    }
    return this.format.byUnitType('mass', null);
  });

  protected readonly weightChange = computed(() => netChange(this.weightPoints()));

  protected readonly records = computed(() => {
    this.version();
    return this.recordsStore.recent().slice(0, 3);
  });

  /**
   * Weeks met over weeks counted — never a bare percentage.
   *
   * Null when there is no plan: having no target is not the same as missing
   * one, and the tile says so rather than showing a confident zero.
   */
  private readonly consistency = computed(() => {
    this.version();
    return this.analytics.consistencyFor(this.sessionsPerWeek());
  });

  protected readonly consistencyValue = computed(() => {
    const result = this.consistency();
    return result.rate === null ? null : this.i18n.formatNumber(result.weeksHit);
  });

  /** The denominator, which is what stops the figure reading as a score. */
  protected readonly consistencyNote = computed(() => {
    const result = this.consistency();
    return result.rate === null
      ? ''
      : this.i18n.t('dashboard.ofWeeks', { count: result.weeksCounted });
  });

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

  protected readonly isEmpty = computed(() => {
    this.version();
    return (
      this.analytics.weeklyTallies().every((week) => week.sessions === 0) &&
      this.weightCount() === 0
    );
  });

  private readonly router = inject(Router);

  protected goTrain(): void {
    void this.router.navigateByUrl('/train');
  }
}
