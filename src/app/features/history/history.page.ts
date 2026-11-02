import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import type { Workout } from '../../domain/models/workout';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { EmptyState } from '../../shared/ui/empty-state';
import { Sheet } from '../../shared/ui/sheet';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';
import { PlannerStore } from '../planner/planner.store';
import { HistoryStore } from './history.store';

/**
 * The history list.
 *
 * Grouped by month with a sticky header, newest first, paged on demand. Every
 * row renders from the workout's own record — its snapshotted name, its stored
 * rollups — so a row stays readable after the plan behind it is gone.
 *
 * Paging is a button rather than an infinite scroll. A list you can reach the
 * end of is a list you can trust; an infinite one hides how much there is and
 * fights the browser's own scroll restoration on the way back from a detail.
 */
@Component({
  selector: 'rl-history-page',
  styleUrl: './history.page.css',
  imports: [AppHeader, Badge, Button, Card, Chip, EmptyState, Sheet],
  template: `
    <rl-app-header titleKey="page.history.title">
      <button
        type="button"
        class="hdr-action"
        [class.hdr-action--on]="store.hasActiveFilters()"
        [attr.aria-label]="i18n.t('history.filters')"
        (click)="openFilters()"
      >
        <span aria-hidden="true">&#9776;</span>
      </button>
    </rl-app-header>

    <div class="page">
      @if (store.hasActiveFilters()) {
        <div class="active-filters">
          <span class="t-caption">{{ filterSummary() }}</span>
          <rl-button variant="ghost" size="sm" (click)="store.clearFilters()">
            {{ i18n.t('history.filters.clear') }}
          </rl-button>
        </div>
      }

      @if (store.isLoading()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (store.error(); as error) {
        <rl-empty-state titleKey="state.error.title" bodyKey="state.error.body" />
        <p class="t-caption">{{ error }}</p>
      } @else if ((store.workouts() ?? []).length === 0) {
        @if (store.hasActiveFilters()) {
          <rl-empty-state
            titleKey="history.noMatches.title"
            bodyKey="history.noMatches.body"
            actionKey="history.filters.clear"
            (actioned)="store.clearFilters()"
          />
        } @else {
          <rl-empty-state
            titleKey="history.empty.title"
            bodyKey="history.empty.body"
            actionKey="history.empty.action"
            (actioned)="goToTrain()"
          />
        }
      } @else {
        @for (month of store.months(); track month.key) {
          <section class="month">
            <h2 class="month__header t-micro">{{ monthLabel(month.key) }}</h2>

            @for (workout of month.workouts; track workout.id) {
              <rl-card class="row">
                <button type="button" class="row__btn" (click)="open(workout)">
                  <span class="row__head">
                    <span class="t-body-strong">{{ workout.name }}</span>
                    <span class="t-caption">{{ format.weekdayDate(workout.startedAt) }}</span>
                  </span>
                  <span class="row__stats t-caption">{{ rowSummary(workout) }}</span>
                  <span class="row__badges">
                    @if (workout.prCount > 0) {
                      <rl-badge kind="pr">
                        {{ i18n.t('count.records', { count: workout.prCount }) }}
                      </rl-badge>
                    }
                    @if (workout.editedAt !== null) {
                      <rl-badge kind="neutral">{{ i18n.t('history.edited') }}</rl-badge>
                    }
                  </span>
                </button>
              </rl-card>
            }
          </section>
        }

        @if (store.hasMore()) {
          <rl-button
            variant="secondary"
            [full]="true"
            [busy]="store.isPaging()"
            (click)="store.loadMore()"
          >
            {{ i18n.t('history.loadMore') }}
          </rl-button>
        }
      }
    </div>

    <rl-sheet [(open)]="filtersOpen" size="full" labelKey="history.filters">
      <h2 class="t-h2 sheet__title">{{ i18n.t('history.filters') }}</h2>

      <div class="field">
        <span class="t-label">{{ i18n.t('history.filters.routine') }}</span>
        <div class="chips">
          <rl-chip
            [selected]="store.filters().routineId === null"
            (toggled)="store.setFilters({ routineId: null })"
          >
            {{ i18n.t('history.filters.any') }}
          </rl-chip>
          @for (routine of routines(); track routine.id) {
            <rl-chip
              [selected]="store.filters().routineId === routine.id"
              (toggled)="store.setFilters({ routineId: routine.id })"
            >
              {{ routine.name }}
            </rl-chip>
          }
        </div>
      </div>

      <div class="field">
        <span class="t-label">{{ i18n.t('history.filters.exercise') }}</span>
        <select
          class="field__input"
          [attr.aria-label]="i18n.t('history.filters.exercise')"
          [value]="store.filters().exerciseId ?? ''"
          (change)="setExercise($any($event.target).value)"
        >
          <option value="">{{ i18n.t('history.filters.any') }}</option>
          @for (exercise of exerciseOptions(); track exercise.id) {
            <option [value]="exercise.id">{{ exercise.name }}</option>
          }
        </select>
      </div>

      <div class="field field--dates">
        <label class="date">
          <span class="t-label">{{ i18n.t('history.filters.from') }}</span>
          <input
            class="field__input"
            type="date"
            [value]="store.filters().fromDay ?? ''"
            (change)="store.setFilters({ fromDay: dayOrNull($any($event.target).value) })"
          />
        </label>
        <label class="date">
          <span class="t-label">{{ i18n.t('history.filters.to') }}</span>
          <input
            class="field__input"
            type="date"
            [value]="store.filters().toDay ?? ''"
            (change)="store.setFilters({ toDay: dayOrNull($any($event.target).value) })"
          />
        </label>
      </div>

      <div class="sheet-actions">
        <rl-button variant="secondary" [full]="true" (click)="store.clearFilters()">
          {{ i18n.t('history.filters.clear') }}
        </rl-button>
        <rl-button variant="primary" [full]="true" (click)="filtersOpen.set(false)">
          {{ i18n.t('history.filters.apply') }}
        </rl-button>
      </div>
    </rl-sheet>
  `,
})
export class HistoryPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(HistoryStore);
  private readonly planner = inject(PlannerStore);
  private readonly library = inject(ExerciseLibraryStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  protected readonly filtersOpen = signal(false);

  protected readonly routines = computed(() =>
    (this.planner.routines() ?? []).filter((routine) => !routine.isArchived),
  );

  /**
   * Exercises that could plausibly be filtered on.
   *
   * A `<select>` rather than the full picker: this is a filter over history,
   * not a choice of what to train, and a native select is one tap on a phone.
   */
  protected readonly exerciseOptions = computed(() =>
    (this.library.all() ?? [])
      .map((exercise) => ({ id: exercise.id, name: this.library.displayName(exercise) }))
      .sort((a, b) => a.name.localeCompare(b.name, this.i18n.locale())),
  );

  constructor() {
    void this.store.load();
    void this.planner.load();
    void this.library.load();
  }

  /** "January 2026", in the reading language and numeral system. */
  protected monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(`${this.i18n.locale()}-u-nu-${this.settings.numerals()}`, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year ?? 1970, (month ?? 1) - 1, 1));
  }

  protected rowSummary(workout: Workout): string {
    return this.i18n.join([
      this.format.clock(workout.durationSec),
      this.format.setCount(workout.totalSets),
      workout.totalVolumeKg > 0 ? this.format.massWithUnit(workout.totalVolumeKg) : null,
    ]);
  }

  protected filterSummary(): string {
    const filters = this.store.filters();
    const routine = this.routines().find((item) => item.id === filters.routineId);
    const exercise = this.exerciseOptions().find((item) => item.id === filters.exerciseId);

    return this.i18n.join([
      routine?.name,
      exercise?.name,
      filters.fromDay !== null || filters.toDay !== null
        ? `${filters.fromDay ?? ''}–${filters.toDay ?? ''}`
        : null,
    ]);
  }

  protected openFilters(): void {
    this.filtersOpen.set(true);
  }

  protected setExercise(value: string): void {
    void this.store.setFilters({ exerciseId: value === '' ? null : value });
  }

  /** An empty date field is "no bound", not an empty-string day key. */
  protected dayOrNull(value: string): string | null {
    return value === '' ? null : value;
  }

  protected open(workout: Workout): void {
    void this.router.navigate(['/history', workout.id]);
  }

  protected goToTrain(): void {
    void this.router.navigate(['/train']);
  }
}
