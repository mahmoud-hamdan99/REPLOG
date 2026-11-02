import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { Badge } from '../../shared/ui/badge';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';
import { HistoryStore, type ExerciseSession } from './history.store';

/**
 * Every session of one exercise, newest first.
 *
 * The list half of the per-exercise progression screen; Phase 10 adds the
 * chart above it. Built here because it is a history read — one backwards
 * cursor on `workoutExercises.by_exerciseId_startedAt` — and because the
 * workout detail needs somewhere to send you when you tap an exercise.
 *
 * Sessions are listed **as performed**. Two sessions of the same exercise on
 * different equipment are different variants and are not merged into one
 * progression, which the note on screen says out loud rather than leaving the
 * reader to assume otherwise.
 */
@Component({
  selector: 'rl-exercise-history-page',
  styleUrl: './exercise-history.page.css',
  imports: [AppHeader, Badge, Card, EmptyState],
  template: `
    <rl-app-header titleKey="exerciseHistory.title" [showBack]="true" />

    <div class="page">
      <h1 class="t-h1 xh__name">{{ exerciseName() }}</h1>

      @if (sessions() === null) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if ((sessions() ?? []).length === 0) {
        <rl-empty-state
          titleKey="exerciseHistory.empty.title"
          bodyKey="exerciseHistory.empty.body"
        />
      } @else {
        <p class="xh__note t-caption">{{ i18n.t('exerciseHistory.variantNote') }}</p>

        @for (session of sessions() ?? []; track session.workoutId) {
          <rl-card class="sess">
            <button type="button" class="sess__btn" (click)="open(session)">
              <span class="sess__head">
                <span class="t-body-strong">{{ format.weekdayDate(session.performedAt) }}</span>
                <span class="t-caption">{{ session.workoutName }}</span>
              </span>
              <span class="sess__sets t-caption">{{ setsText(session) }}</span>
              @if (session.volumeKg > 0) {
                <span class="sess__volume">
                  <rl-badge kind="count">{{ format.massWithUnit(session.volumeKg) }}</rl-badge>
                </span>
              }
            </button>
          </rl-card>
        }
      }
    </div>
  `,
})
export class ExerciseHistoryPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  private readonly store = inject(HistoryStore);
  private readonly library = inject(ExerciseLibraryStore);
  private readonly router = inject(Router);

  readonly exerciseId = input.required<string>();

  private readonly _sessions = signal<ExerciseSession[] | null>(null);
  readonly sessions = this._sessions.asReadonly();

  /**
   * The library's current name, falling back to the snapshot.
   *
   * The *title* may follow a rename — it names the exercise, not a past
   * performance. The sets below are snapshots and never change.
   */
  protected readonly exerciseName = computed(() => {
    const exercise = this.library.byId().get(this.exerciseId());
    if (exercise) return this.library.displayName(exercise);
    return this._sessions()?.[0]?.workoutName ?? '';
  });

  constructor() {
    void this.library.load();
    effect(() => {
      void this.load(this.exerciseId());
    });
  }

  private async load(exerciseId: string): Promise<void> {
    this._sessions.set(null);
    this._sessions.set(await this.store.exerciseHistory(exerciseId));
  }

  protected setsText(session: ExerciseSession): string {
    return session.sets.map((set) => this.format.setSummary(set)).join(',  ');
  }

  protected open(session: ExerciseSession): void {
    void this.router.navigate(['/history', session.workoutId]);
  }
}
