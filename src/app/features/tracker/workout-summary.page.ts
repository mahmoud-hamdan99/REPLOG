import { DisplayFormat } from '../../core/format/display-format.service';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/toast/toast.service';
import {
  PERSONAL_RECORDS_REPO,
  SET_LOGS_REPO,
  WORKOUTS_REPO,
  WORKOUT_EXERCISES_REPO,
} from '../../data/tokens';
import type { Feeling } from '../../domain/models/enums';
import type { PersonalRecord } from '../../domain/models/records';
import type { SetLog, Workout, WorkoutExercise } from '../../domain/models/workout';
import { sortByOrder } from '../../domain/planner/ordering';
import { sessionTotals } from '../../domain/strength/volume';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { EmptyState } from '../../shared/ui/empty-state';
import { SectionHeader } from '../../shared/ui/section-header';
import { StatTile } from '../../shared/ui/stat-tile';
import { TrackerStore } from './tracker.store';

const FEELINGS: readonly Feeling[] = ['great', 'good', 'ok', 'rough'];

/**
 * Workout summary.
 *
 * Celebration without fiction. Every figure here is measured: duration from
 * timestamps, volume from working sets only, records from `personalRecords`.
 * Where a number is not computable it is reported as missing rather than
 * rounded to zero, and a first-ever record reads "First record", not "New
 * record" — a record needs something to beat before it is an improvement.
 *
 * Rendered entirely from the workout's own snapshots, so it keeps working
 * after the routine behind it is edited or deleted.
 */
@Component({
  selector: 'rl-workout-summary-page',
  styleUrl: './workout-summary.page.css',
  imports: [AppHeader, Badge, Button, Card, Chip, EmptyState, SectionHeader, StatTile],
  template: `
    <rl-app-header titleKey="summary.title" />

    <div class="page">
      @if (workout() === null) {
        <rl-empty-state titleKey="summary.notFound" bodyKey="tracker.notFound.body" />
      } @else {
        <h1 class="t-h1 sum__name">{{ workout()!.name }}</h1>
        <p class="t-caption">{{ format.shortDate(workout()!.startedAt) }}</p>

        <div class="sum__stats">
          <rl-stat-tile labelKey="summary.duration" [value]="durationText()" [hero]="true" />
          <rl-stat-tile
            labelKey="summary.volume"
            [value]="volumeText()"
            [unit]="format.unitShort()"
          />
          <rl-stat-tile labelKey="summary.sets" [value]="setsText()" />
          <rl-stat-tile labelKey="summary.reps" [value]="repsText()" />
        </div>

        @if (droppedCount() > 0) {
          <p class="t-caption sum__caveat">
            {{ i18n.t('summary.dropped', { count: droppedCount() }) }}
          </p>
        }
        @if (uncountedCount() > 0) {
          <p class="t-caption sum__caveat">
            {{ i18n.t('summary.uncounted', { count: uncountedCount() }) }}
          </p>
        }

        <rl-section-header titleKey="summary.records" />
        @if (records().length === 0) {
          <p class="t-body sum__none">{{ i18n.t('summary.noRecords') }}</p>
        } @else {
          @for (record of records(); track record.id) {
            <rl-card class="pr">
              <div class="pr__head">
                <span class="t-body-strong">{{ record.nameSnapshot }}</span>
                <rl-badge [kind]="record.previousValue === null ? 'count' : 'pr'">
                  {{ format.recordDelta(record) }}
                </rl-badge>
              </div>
              <p class="rec__type t-caption">{{ format.recordType(record) }}</p>
              <p class="rec__value">
                <span class="t-body-strong">{{ format.recordValue(record) }}</span>
                @if (record.isEstimate) {
                  <rl-badge kind="estimate">{{ format.recordFormula(record) }}</rl-badge>
                }
              </p>
            </rl-card>
          }
        }

        <rl-section-header titleKey="summary.exercises" />
        @for (row of rollups(); track row.exercise.id) {
          <div class="ex">
            <span class="t-body">{{ row.exercise.nameSnapshot }}</span>
            <span class="t-caption">{{ row.summary }}</span>
          </div>
        }

        <label class="field">
          <span class="t-label">{{ i18n.t('summary.note') }}</span>
          <textarea
            class="field__input"
            rows="3"
            [value]="workout()!.notes ?? ''"
            (change)="saveNote($any($event.target).value)"
          ></textarea>
        </label>

        <p class="t-label">{{ i18n.t('summary.feeling') }}</p>
        <div class="chips">
          @for (feeling of feelings; track feeling) {
            <rl-chip [selected]="workout()!.feeling === feeling" (toggled)="setFeeling(feeling)">
              {{ i18n.t('summary.feeling.' + feeling) }}
            </rl-chip>
          }
        </div>

        <div class="sum__actions">
          <rl-button variant="secondary" [full]="true" (click)="copy()">
            {{ i18n.t('summary.share') }}
          </rl-button>
          <rl-button variant="primary" size="lg" [full]="true" (click)="done()">
            {{ i18n.t('summary.done') }}
          </rl-button>
        </div>
      }
    </div>
  `,
})
export class WorkoutSummaryPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  private readonly workouts = inject(WORKOUTS_REPO);
  private readonly exercisesRepo = inject(WORKOUT_EXERCISES_REPO);
  private readonly setsRepo = inject(SET_LOGS_REPO);
  private readonly recordsRepo = inject(PERSONAL_RECORDS_REPO);
  private readonly tracker = inject(TrackerStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly workoutId = input.required<string>();

  protected readonly feelings = FEELINGS;

  private readonly _workout = signal<Workout | null>(null);
  private readonly _exercises = signal<WorkoutExercise[]>([]);
  private readonly _sets = signal<SetLog[]>([]);
  private readonly _records = signal<PersonalRecord[]>([]);

  readonly workout = this._workout.asReadonly();
  readonly records = this._records.asReadonly();

  protected readonly durationText = computed(() =>
    this.format.clock(this._workout()?.durationSec ?? 0),
  );

  protected readonly volumeText = computed(() => {
    const kg = this._workout()?.totalVolumeKg ?? 0;
    return kg === 0 ? null : this.format.mass(kg);
  });

  protected readonly setsText = computed(() =>
    this.i18n.formatNumber(this._workout()?.totalSets ?? 0),
  );

  protected readonly repsText = computed(() =>
    this.i18n.formatNumber(this._workout()?.totalReps ?? 0),
  );

  /**
   * Rows dropped for never having been confirmed.
   *
   * Only available for the session that was just finished — it describes the
   * transaction, not the saved record — so opening an older summary shows
   * nothing rather than a figure it would have to invent.
   */
  protected readonly droppedCount = computed(() => {
    const last = this.tracker.lastFinish();
    return last?.workoutId === this.workoutId() ? last.droppedSetCount : 0;
  });

  /**
   * Sets with no computable volume, so the total is never silently partial.
   *
   * Recomputed rather than stored: the workout record keeps the total, not the
   * reason part of it is missing.
   */
  protected readonly uncountedCount = computed(() => {
    const byId = new Map(this._exercises().map((exercise) => [exercise.id, exercise]));
    return sessionTotals(
      this._sets().map((set) => ({
        loadType: byId.get(set.workoutExerciseId)?.loadType ?? 'external',
        weightKg: set.weightKg,
        extraWeightKg: set.extraWeightKg,
        bodyWeightKg: this._workout()?.bodyWeightKg ?? null,
        setType: set.setType,
        reps: set.reps,
        isCompleted: set.isCompleted,
      })),
    ).uncountedSets;
  });

  protected readonly rollups = computed(() =>
    sortByOrder(this._exercises()).map((exercise) => {
      const own = this._sets()
        .filter((set) => set.workoutExerciseId === exercise.id)
        .sort((a, b) => a.setIndex - b.setIndex);

      // An exercise whose rows were all unconfirmed keeps its line and says so.
      // A blank value beside a name reads as a rendering gap, not as "none".
      const summary = exercise.isSkipped
        ? this.i18n.t('tracker.exercise.skipped')
        : own.length === 0
          ? this.i18n.t('summary.noSets')
          : own.map((set) => this.format.setSummary(set)).join(', ');

      return { exercise, summary };
    }),
  );

  constructor() {
    // An effect, not a constructor call: a required input has no value during
    // construction, and reading one there throws NG0950. Running on the input
    // also means a navigation to a different summary reloads rather than
    // showing the previous workout's figures.
    effect(() => {
      void this.load(this.workoutId());
    });
  }

  private async load(workoutId: string): Promise<void> {
    const workout = await this.workouts.get(workoutId);
    if (!workout) {
      this._workout.set(null);
      return;
    }

    const [exercises, sets] = await Promise.all([
      this.exercisesRepo.list({ index: 'by_workoutId', equals: workout.id }),
      this.setsRepo.list({ index: 'by_workoutId', equals: workout.id }),
    ]);

    // Records are indexed by instant, not by workout, so the session's own
    // window is the cheap way in; the workout id then filters exactly.
    const achieved = await this.recordsRepo.list({
      index: 'by_achievedAt',
      range: { lower: workout.startedAt, upper: workout.finishedAt ?? workout.startedAt },
    });

    this._workout.set(workout);
    this._exercises.set(exercises);
    this._sets.set(sets);
    this._records.set(achieved.filter((record) => record.workoutId === workout.id));
  }

  protected async saveNote(notes: string): Promise<void> {
    const workout = this._workout();
    if (!workout) return;
    const trimmed = notes.trim();
    this._workout.set(
      await this.workouts.patch(workout.id, { notes: trimmed === '' ? null : trimmed }),
    );
  }

  protected async setFeeling(feeling: Feeling): Promise<void> {
    const workout = this._workout();
    if (!workout) return;
    this._workout.set(
      await this.workouts.patch(workout.id, {
        feeling: workout.feeling === feeling ? null : feeling,
      }),
    );
  }

  /**
   * Copies the summary as plain text.
   *
   * Clipboard, not a share sheet or an upload: PRODUCT_SPEC keeps this app off
   * the network, and plain text pastes anywhere the user actually wants it.
   */
  protected async copy(): Promise<void> {
    const workout = this._workout();
    if (!workout) return;

    const lines = [
      `${workout.name} — ${this.format.shortDate(workout.startedAt)}`,
      `${this.i18n.t('summary.duration')}: ${this.durationText()}`,
      `${this.i18n.t('summary.volume')}: ${this.format.massWithUnit(workout.totalVolumeKg)}`,
      `${this.i18n.t('summary.sets')}: ${this.setsText()}`,
      '',
      ...this.rollups().map((row) => `${row.exercise.nameSnapshot}: ${row.summary}`),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.toasts.success(this.i18n.t('summary.copied'));
    } catch {
      // Clipboard access is denied in several contexts, and there is nothing
      // useful to retry; say so rather than failing silently.
      this.toasts.error(this.i18n.t('summary.copyFailed'));
    }
  }

  protected done(): void {
    void this.router.navigate(['/train']);
  }
}
