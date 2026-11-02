import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { ToastService } from '../../core/toast/toast.service';
import type { SetLog, WorkoutExercise } from '../../domain/models/workout';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { NumericPad, type PadValue } from '../../shared/ui/numeric-pad';
import { SectionHeader } from '../../shared/ui/section-header';
import { SetRow } from '../../shared/ui/set-row';
import { StatTile } from '../../shared/ui/stat-tile';
import { TrackerStore } from '../tracker/tracker.store';
import { HistoryStore, type RoutineState, type WorkoutDetail } from './history.store';

/**
 * One recorded workout.
 *
 * Rendered **entirely from the snapshot** the session froze when it started:
 * the routine name, the targets, the exercise names, the body weight of the
 * day. The live plan is consulted for exactly one thing — a note saying it has
 * since changed or gone — and never to fill in a value. That is what makes
 * editing a plan safe (docs/ARCHITECTURE.md section 7.6), and it is only true
 * if this screen never reaches for the live record.
 *
 * Read-only until the user asks to correct something. Corrections write
 * through immediately and mark the workout as edited, because a record that
 * has been changed after the fact should say so.
 */
@Component({
  selector: 'rl-workout-detail-page',
  styleUrl: './workout-detail.page.css',
  imports: [
    AppHeader,
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    NumericPad,
    SectionHeader,
    SetRow,
    StatTile,
  ],
  template: `
    <rl-app-header titleKey="page.history.title" [showBack]="true" />

    <div class="page">
      @if (detail() === null) {
        <rl-empty-state titleKey="history.detail.notFound" bodyKey="history.empty.body" />
      } @else if (detail(); as view) {
        <h1 class="t-h1 det__name">{{ view.workout.name }}</h1>
        <p class="t-caption">
          {{
            i18n.join([
              format.shortDate(view.workout.startedAt),
              view.workout.planSnapshot?.planName,
            ])
          }}
        </p>

        @if (view.workout.editedAt !== null) {
          <p class="det__badges">
            <rl-badge kind="neutral">{{ i18n.t('history.edited') }}</rl-badge>
          </p>
        }

        <div class="det__stats">
          <rl-stat-tile
            labelKey="summary.duration"
            [value]="format.clock(view.workout.durationSec)"
            [hero]="true"
          />
          <rl-stat-tile
            labelKey="summary.volume"
            [value]="volumeText(view)"
            [unit]="format.unitShort()"
          />
          <rl-stat-tile labelKey="summary.sets" [value]="number(view.workout.totalSets)" />
          <rl-stat-tile labelKey="summary.reps" [value]="number(view.workout.totalReps)" />
        </div>

        @if (noteKey(view.routineState); as key) {
          <p class="det__note t-caption">{{ i18n.t(key) }}</p>
        }
        <p class="det__note t-caption">{{ i18n.t('history.detail.snapshot') }}</p>

        @if (view.workout.bodyWeightKg !== null) {
          <p class="t-caption">
            {{
              i18n.t('history.detail.bodyWeight', {
                value: format.massWithUnit(view.workout.bodyWeightKg),
              })
            }}
          </p>
        }

        @if (editing()) {
          <p class="det__editing t-caption" role="status">
            {{ i18n.t('history.detail.editing') }}
          </p>
        }

        <rl-section-header titleKey="summary.exercises" />

        @for (exercise of view.exercises; track exercise.id) {
          <rl-card class="ex">
            <div class="ex__head">
              <span class="t-body-strong">{{ exercise.nameSnapshot }}</span>
              <button
                type="button"
                class="ex__link t-caption"
                (click)="openExerciseHistory(exercise)"
              >
                {{ i18n.t('history.detail.exerciseHistory') }}
              </button>
            </div>

            @if (exercise.isSkipped) {
              <p class="t-caption">{{ i18n.t('history.detail.skipped') }}</p>
            } @else {
              <!-- Mirrors the row's own grid: without it the numbers are
                   unlabelled, and 61 × 8 is not self-evident at a glance. -->
              <div
                class="ex__cols t-micro"
                [class.ex__cols--noweight]="!showsWeight(exercise)"
                aria-hidden="true"
              >
                <span>{{ i18n.t('tracker.col.set') }}</span>
                @if (showsWeight(exercise)) {
                  <span>{{ i18n.t('tracker.col.weight') }}</span>
                }
                <span>{{ i18n.t('tracker.col.reps') }}</span>
              </div>

              @for (row of rowsFor(view, exercise); track row.set.id) {
                <rl-set-row
                  [set]="row.set"
                  [workingIndex]="row.workingIndex"
                  [isAdvanced]="true"
                  [showWeight]="showsWeight(exercise)"
                  [showPrevious]="false"
                  [showConfirm]="false"
                  [readOnly]="!editing()"
                  (editWeight)="openPad(row.set, 'weight')"
                  (editReps)="openPad(row.set, 'reps')"
                  (deleted)="removeSet(row.set)"
                  (opened)="openPad(row.set, 'weight')"
                />
              }
            }
          </rl-card>
        }

        <rl-section-header titleKey="history.detail.notes" />
        <p class="t-body det__notes">
          {{ view.workout.notes || i18n.t('history.detail.noNotes') }}
        </p>

        <div class="det__actions">
          <rl-button variant="primary" [full]="true" [busy]="repeating()" (click)="repeat(view)">
            {{ i18n.t('history.detail.repeat') }}
          </rl-button>
          <rl-button variant="secondary" [full]="true" (click)="editing.set(!editing())">
            {{ editing() ? i18n.t('history.detail.editDone') : i18n.t('history.detail.edit') }}
          </rl-button>
          <rl-button variant="danger" [full]="true" (click)="deleteOpen.set(true)">
            {{ i18n.t('history.detail.delete') }}
          </rl-button>
        </div>
      }
    </div>

    @if (padSet(); as set) {
      <rl-numeric-pad
        [(open)]="padOpen"
        [titleText]="padTitle()"
        [initialWeight]="format.massDisplay(set.weightKg)"
        [initialReps]="set.reps"
        [showWeight]="padShowsWeight()"
        [startField]="padField()"
        [unitShort]="format.unitShort()"
        (changed)="padChanged($event)"
      />
    }

    <rl-dialog
      [(open)]="deleteOpen"
      titleKey="history.detail.deleteTitle"
      [bodyText]="deleteBody()"
      confirmKey="history.detail.delete"
      [destructive]="true"
      (confirmed)="remove()"
    />
  `,
})
export class WorkoutDetailPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  private readonly store = inject(HistoryStore);
  private readonly tracker = inject(TrackerStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly workoutId = input.required<string>();

  private readonly _detail = signal<WorkoutDetail | null | undefined>(undefined);
  /** `undefined` while loading, `null` once we know it is not there. */
  protected readonly detail = computed(() => this._detail() ?? null);

  protected readonly editing = signal(false);
  protected readonly repeating = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly padOpen = signal(false);
  protected readonly padField = signal<'weight' | 'reps'>('weight');
  private readonly padSetId = signal<string | null>(null);

  protected readonly padSet = computed(() => {
    const id = this.padSetId();
    if (id === null) return null;
    const view = this.detail();
    if (!view) return null;
    for (const sets of view.setsByExercise.values()) {
      const found = sets.find((set) => set.id === id);
      if (found) return found;
    }
    return null;
  });

  private readonly padExercise = computed(() => {
    const set = this.padSet();
    return set
      ? (this.detail()?.exercises.find((item) => item.id === set.workoutExerciseId) ?? null)
      : null;
  });

  protected readonly padShowsWeight = computed(() =>
    this.padExercise() ? this.showsWeight(this.padExercise()!) : true,
  );

  protected readonly padTitle = computed(() =>
    this.i18n.t('pad.title', {
      name: this.padExercise()?.nameSnapshot ?? '',
      index: this.i18n.formatNumber((this.padSet()?.setIndex ?? 0) + 1),
    }),
  );

  constructor() {
    // An effect, not a constructor call: a required input has no value during
    // construction, and reading one there throws NG0950.
    effect(() => {
      void this.reload(this.workoutId());
    });
  }

  private async reload(workoutId: string): Promise<void> {
    this._detail.set(await this.store.detail(workoutId));
  }

  // ------------------------------------------------------------------ views

  protected number(value: number): string {
    return this.i18n.formatNumber(value);
  }

  protected volumeText(view: WorkoutDetail): string | null {
    return view.workout.totalVolumeKg > 0 ? this.format.mass(view.workout.totalVolumeKg) : null;
  }

  /** The note that tells the truth about the plan, or nothing to say. */
  protected noteKey(state: RoutineState): string | null {
    if (state === 'changed') return 'history.detail.routineChanged';
    if (state === 'missing') return 'history.detail.routineMissing';
    return null;
  }

  protected showsWeight(exercise: WorkoutExercise): boolean {
    return exercise.loadType !== 'time' && exercise.loadType !== 'distance';
  }

  /** Rows with their working-set number; warm-ups are not numbered. */
  protected rowsFor(view: WorkoutDetail, exercise: WorkoutExercise) {
    let working = 0;
    return (view.setsByExercise.get(exercise.id) ?? []).map((set) => {
      if (set.setType !== 'warmup') working += 1;
      return { set, workingIndex: working };
    });
  }

  protected deleteBody(): string {
    const view = this.detail();
    return this.i18n.t('history.detail.deleteBody', {
      sets: this.format.setCount(view?.workout.totalSets ?? 0),
    });
  }

  // ------------------------------------------------------------- correcting

  protected openPad(set: SetLog, field: 'weight' | 'reps'): void {
    if (!this.editing()) return;
    this.padSetId.set(set.id);
    this.padField.set(field);
    this.padOpen.set(true);
  }

  /** Values arrive in display units; conversion to kilograms happens here. */
  protected async padChanged(value: PadValue): Promise<void> {
    const setId = this.padSetId();
    if (setId === null) return;

    await this.store.updateSet(setId, {
      weightKg: this.format.massCanonical(value.weight),
      reps: value.reps,
    });
    await this.reload(this.workoutId());
  }

  protected async removeSet(set: SetLog): Promise<void> {
    if (!this.editing()) return;

    await this.store.deleteSet(set.id);
    await this.reload(this.workoutId());
    this.toasts.undo(this.i18n.t('tracker.set.deleted'), () => void this.undoSetDelete(set.id));
  }

  private async undoSetDelete(setId: string): Promise<void> {
    await this.store.restoreSet(setId);
    await this.reload(this.workoutId());
  }

  // ---------------------------------------------------------------- actions

  /**
   * Starts a new session with the same structure and no loads.
   *
   * Can legitimately fail when a workout is already in progress; the refusal
   * belongs on screen rather than in the console.
   */
  protected async repeat(view: WorkoutDetail): Promise<void> {
    if (this.repeating()) return;
    this.repeating.set(true);
    try {
      await this.tracker.startFromWorkout(view.workout.id);
      await this.router.navigate(['/train/active']);
    } catch {
      this.toasts.error(this.i18n.t('history.detail.repeatFailed'));
    } finally {
      this.repeating.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const workoutId = this.workoutId();
    await this.store.deleteWorkout(workoutId);
    await this.router.navigate(['/history']);

    // Soft-deleted, so the undo is a real restore rather than a re-import.
    this.toasts.undo(this.i18n.t('history.detail.deleted'), () => {
      void this.store.restoreWorkout(workoutId).then(() => {
        this.toasts.success(this.i18n.t('history.detail.restored'));
      });
    });
  }

  protected openExerciseHistory(exercise: WorkoutExercise): void {
    void this.router.navigate(['/progress/exercise', exercise.exerciseId]);
  }
}
