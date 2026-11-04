import { computed, inject, Service, signal } from '@angular/core';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { CLOCK } from '../../data/clock';
import type { Repository } from '../../data/repository';
import {
  MEASUREMENTS_REPO,
  PLANS_REPO,
  ROUTINES_REPO,
  SET_LOGS_REPO,
  WORKOUTS_REPO,
} from '../../data/tokens';
import { daysLeft, partitionByWindow } from '../../domain/backup/recovery';
import type { Entity } from '../../domain/models/entity';
import { MeasurementsStore } from '../body/measurements.store';
import { HistoryStore } from '../history/history.store';
import { PlannerStore } from '../planner/planner.store';

export type DeletedKind = 'workout' | 'measurement' | 'plan' | 'routine';

export interface DeletedItem {
  kind: DeletedKind;
  id: string;
  /** What the thing was, in the user's words. */
  title: string;
  /** What is inside it, so a restore is not a guess. */
  detail: string;
  deletedAt: string;
  daysLeft: number;
}

/**
 * The 30-day recovery list (DATABASE_SPEC section 9.3).
 *
 * Restores are delegated to the store that owns each kind rather than
 * reimplemented here. That matters because restoring is not "clear the
 * tombstone": a workout has to bring back exactly the children that went
 * down with it and recompute its totals and personal records, and a plan has
 * to bring back exactly the routines the cascade took. The stores already
 * know those rules; a second implementation on this screen would be a second
 * chance to get them wrong.
 */
@Service()
export class RecentlyDeletedStore {
  private readonly workouts = inject(WORKOUTS_REPO);
  private readonly setLogs = inject(SET_LOGS_REPO);
  private readonly measurements = inject(MEASUREMENTS_REPO);
  private readonly plans = inject(PLANS_REPO);
  private readonly routines = inject(ROUTINES_REPO);
  private readonly clock = inject(CLOCK);
  private readonly i18n = inject(I18n);
  private readonly fmt = inject(DisplayFormat);

  private readonly history = inject(HistoryStore);
  private readonly body = inject(MeasurementsStore);
  private readonly planner = inject(PlannerStore);

  private readonly _items = signal<DeletedItem[] | null>(null);
  private readonly _expired = signal(0);
  private readonly _busy = signal(false);

  /** Null means not loaded yet; an empty array means nothing is recoverable. */
  readonly items = this._items.asReadonly();
  /** How many tombstones are past the window and only a purge can reach. */
  readonly expiredCount = this._expired.asReadonly();
  readonly isBusy = this._busy.asReadonly();
  readonly isEmpty = computed(() => this._items()?.length === 0);

  async load(): Promise<void> {
    this._busy.set(true);
    try {
      const now = this.clock.now();
      const [workouts, measurements, plans, routines] = await Promise.all([
        this.workouts.list({ includeDeleted: true }),
        this.measurements.list({ includeDeleted: true }),
        this.plans.list({ includeDeleted: true }),
        this.routines.list({ includeDeleted: true }),
      ]);

      const workoutSplit = partitionByWindow(workouts, now);
      const measurementSplit = partitionByWindow(measurements, now);
      const planSplit = partitionByWindow(plans, now);
      const routineSplit = partitionByWindow(routines, now);

      // A routine tombstoned by its plan's cascade is not its own entry: it
      // comes back with the plan, and offering it separately would invite a
      // restore that puts a routine into a plan that is still deleted.
      const deletedPlanIds = new Set(planSplit.recoverable.map((p) => p.id));

      const items: DeletedItem[] = [
        ...(await Promise.all(
          workoutSplit.recoverable.map(async (workout) => ({
            kind: 'workout' as const,
            id: workout.id,
            title: workout.name || this.i18n.t('page.train.title'),
            detail: this.i18n.join([
              this.fmt.weekdayDay(workout.dayKey),
              this.i18n.t('count.sets', {
                count: await this.setLogs.count({
                  index: 'by_workoutId',
                  equals: workout.id,
                  includeDeleted: true,
                }),
              }),
            ]),
            deletedAt: workout.deletedAt ?? '',
            daysLeft: daysLeft(workout.deletedAt ?? '', now),
          })),
        )),
        ...measurementSplit.recoverable.map((measurement) => ({
          kind: 'measurement' as const,
          id: measurement.id,
          // The day it was taken is the only name a measurement has, so it
          // is the title rather than a second copy of the screen's name.
          title: this.fmt.weekdayDay(measurement.measuredAt),
          detail: measurement.weightKg === null ? '' : this.fmt.massWithUnit(measurement.weightKg),
          deletedAt: measurement.deletedAt ?? '',
          daysLeft: daysLeft(measurement.deletedAt ?? '', now),
        })),
        ...planSplit.recoverable.map((plan) => ({
          kind: 'plan' as const,
          id: plan.id,
          title: plan.name,
          // Its routines come back with it, so say how many rather than
          // nothing: that is the fact that decides whether to restore.
          detail: this.i18n.t('count.routines', {
            count: routines.filter(
              (routine) => routine.planId === plan.id && routine.deletedAt !== null,
            ).length,
          }),
          deletedAt: plan.deletedAt ?? '',
          daysLeft: daysLeft(plan.deletedAt ?? '', now),
        })),
        ...routineSplit.recoverable
          .filter((routine) => routine.planId === null || !deletedPlanIds.has(routine.planId))
          .map((routine) => ({
            kind: 'routine' as const,
            id: routine.id,
            title: routine.name,
            detail: this.i18n.t('page.plans.title'),
            deletedAt: routine.deletedAt ?? '',
            daysLeft: daysLeft(routine.deletedAt ?? '', now),
          })),
      ];

      items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

      this._items.set(items);
      this._expired.set(
        workoutSplit.expired.length +
          measurementSplit.expired.length +
          planSplit.expired.length +
          routineSplit.expired.length,
      );
    } finally {
      this._busy.set(false);
    }
  }

  /** Hands the restore to whoever owns the rules for that kind. */
  async restore(item: DeletedItem): Promise<void> {
    switch (item.kind) {
      case 'workout':
        await this.history.restoreWorkout(item.id);
        break;
      case 'measurement':
        await this.body.restore(item.id);
        break;
      case 'plan':
        await this.planner.restorePlan(item.id);
        break;
      case 'routine':
        await this.planner.restoreRoutine(item.id);
        break;
    }
    await this.load();
  }

  /**
   * Hard-deletes everything already past the window.
   *
   * Explicit rather than automatic. Nothing here is reachable from any other
   * screen, so leaving it costs only space; running it silently on page load
   * would mean the one destructive action in the app that nobody chose.
   */
  async purgeExpired(): Promise<number> {
    const now = this.clock.now();
    let purged = 0;

    // Typed as the common shape rather than the union: every branch does the
    // same two things, and the four record types have nothing else in common.
    const repos: readonly Repository<Entity>[] = [
      this.workouts,
      this.measurements,
      this.plans,
      this.routines,
    ];

    for (const repo of repos) {
      const rows = await repo.list({ includeDeleted: true });
      for (const row of partitionByWindow(rows, now).expired) {
        await repo.remove(row.id, { hard: true });
        purged++;
      }
    }

    await this.load();
    return purged;
  }
}
