import { DisplayFormat } from '../../../core/format/display-format.service';
import { Component, computed, inject, input, output } from '@angular/core';
import { I18n } from '../../../core/i18n/i18n.service';
import type { SetLog } from '../../../domain/models/workout';
import type { PreviousPerformance } from '../previous-performance.service';
import type { SessionCard } from '../tracker.store';
import { SuggestionHint } from '../../../shared/ui/suggestion-hint';
import { PrevPerformance } from './prev-performance';
import { SetRow } from '../../../shared/ui/set-row';

/**
 * One exercise inside a session.
 *
 * Collapsed it is a one-line summary; expanded it is the set grid. Only one
 * card is expanded at a time — on a phone, two open cards mean the current row
 * is somewhere off screen, and scrolling to find it between sets is exactly
 * the friction this screen exists to remove.
 *
 * A skipped exercise stays visible and collapsed rather than disappearing: the
 * plan asked for it, and history should record that it was planned and not
 * done.
 */
@Component({
  selector: 'rl-exercise-card',
  styleUrl: './exercise-card.css',
  imports: [PrevPerformance, SetRow, SuggestionHint],
  host: { '[class.card--expanded]': 'expanded()' },
  template: `
    <div class="card" [class.card--skipped]="card().exercise.isSkipped">
      <div class="card__head">
        <button
          type="button"
          class="card__toggle"
          [attr.aria-expanded]="expanded()"
          (click)="toggled.emit()"
        >
          <span class="card__ordinal t-label">{{ i18n.formatNumber(position()) }}</span>
          <span class="card__name t-body-strong">{{ card().exercise.nameSnapshot }}</span>
          <span class="card__state" [class.card__state--done]="isDone()" aria-hidden="true">{{
            isDone() ? '✓' : '○'
          }}</span>
        </button>

        <button
          type="button"
          class="card__menu"
          [attr.aria-label]="
            i18n.t('tracker.exercise.menu', { name: card().exercise.nameSnapshot })
          "
          (click)="menuOpened.emit()"
        >
          <span aria-hidden="true">&#8943;</span>
        </button>
      </div>

      @if (card().exercise.isSkipped) {
        <p class="card__sub t-caption">{{ i18n.t('tracker.exercise.skipped') }}</p>
      } @else if (!expanded()) {
        <p class="card__sub t-caption">{{ summary() }}</p>
      } @else {
        <p class="card__sub t-caption">{{ targetText() }}</p>

        <rl-prev-performance class="card__prev" [previous]="previous()" />

        @if (suggestionText(); as suggestion) {
          <rl-suggestion-hint
            class="card__suggestion"
            [valueText]="suggestion.value"
            [reasonText]="suggestion.reason"
            (accepted)="suggestionAccepted.emit()"
          />
        }

        <div
          class="card__cols t-micro"
          [class.card__cols--noweight]="!showWeight()"
          aria-hidden="true"
        >
          <span>{{ i18n.t('tracker.col.set') }}</span>
          <span>{{ i18n.t('tracker.col.prev') }}</span>
          @if (showWeight()) {
            <span>{{ i18n.t('tracker.col.weight') }}</span>
          }
          <span>{{ i18n.t('tracker.col.reps') }}</span>
          <span></span>
        </div>

        @for (row of rows(); track row.set.id) {
          <rl-set-row
            [set]="row.set"
            [workingIndex]="row.workingIndex"
            [isCurrent]="row.set.id === focusSetId()"
            [isAdvanced]="isAdvanced()"
            [showWeight]="showWeight()"
            [readOnly]="readOnly()"
            [previousText]="row.previousText"
            (toggled)="setToggled.emit(row.set.id)"
            (editWeight)="weightRequested.emit(row.set.id)"
            (editReps)="repsRequested.emit(row.set.id)"
            (deleted)="setDeleted.emit(row.set.id)"
            (opened)="setOpened.emit(row.set.id)"
          />
        }

        @if (!readOnly()) {
          <div class="card__actions">
            <button type="button" class="card__action" (click)="setAdded.emit()">
              {{ i18n.t('tracker.addSet') }}
            </button>
            <button type="button" class="card__action" (click)="warmupAdded.emit()">
              {{ i18n.t('tracker.addWarmup') }}
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class ExerciseCard {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);

  readonly card = input.required<SessionCard>();
  readonly position = input.required<number>();
  readonly expanded = input(false);
  readonly focusSetId = input<string | null>(null);
  readonly isAdvanced = input(false);
  readonly readOnly = input(false);
  readonly previous = input<PreviousPerformance | null>(null);
  /**
   * The next-set suggestion, already formatted and translated.
   *
   * Passed in rather than computed here: the rules are a pure domain function
   * and the numbers need unit conversion, neither of which belongs in a card.
   */
  readonly suggestionText = input<{ value: string; reason: string } | null>(null);

  readonly toggled = output<void>();
  readonly menuOpened = output<void>();
  readonly setToggled = output<string>();
  readonly weightRequested = output<string>();
  readonly repsRequested = output<string>();
  readonly setDeleted = output<string>();
  readonly setOpened = output<string>();
  readonly setAdded = output<void>();
  readonly warmupAdded = output<void>();
  readonly suggestionAccepted = output<void>();

  /** Time and distance work has no load field to show. */
  protected readonly showWeight = computed(() => {
    const loadType = this.card().exercise.loadType;
    return loadType !== 'time' && loadType !== 'distance';
  });

  protected readonly isDone = computed(() => {
    const card = this.card();
    return card.sets.length > 0 && card.completedCount === card.sets.length;
  });

  /**
   * Rows with their working-set number and their matching previous set.
   *
   * Previous sets are matched by position among working sets, which is the
   * comparison the user is actually making: "set 3 last time" against "set 3
   * now". A warm-up has nothing to compare against.
   */
  protected readonly rows = computed(() => {
    const previousWorking = (this.previous()?.sets ?? []).filter((set) => set.setType !== 'warmup');
    let working = 0;

    return this.card().sets.map((set: SetLog) => {
      const isWarmup = set.setType === 'warmup';
      if (!isWarmup) working += 1;
      const match = isWarmup ? undefined : previousWorking[working - 1];

      return {
        set,
        workingIndex: working,
        previousText: match ? this.format.setSummary(match) : '',
      };
    });
  });

  /** Collapsed summary: what was actually logged, or what is planned. */
  protected readonly summary = computed(() => {
    const card = this.card();
    const done = card.sets.filter((set) => set.isCompleted && set.setType !== 'warmup');

    if (done.length === 0) return this.targetText();
    return this.i18n.join([
      this.format.setCount(done.length),
      done.map((set) => this.format.setSummary(set)).join(', '),
    ]);
  });

  protected readonly targetText = computed(() => {
    const exercise = this.card().exercise;
    const target = exercise.targetSnapshot;
    const rest =
      exercise.restSec === null
        ? null
        : this.i18n.t('tracker.exercise.rest', {
            seconds: this.i18n.formatNumber(exercise.restSec),
          });

    const reps =
      !target || target.targetRepsMin === null
        ? null
        : target.targetRepsMax === null || target.targetRepsMax === target.targetRepsMin
          ? this.i18n.formatNumber(target.targetRepsMin)
          : `${this.i18n.formatNumber(target.targetRepsMin)}–${this.i18n.formatNumber(
              target.targetRepsMax,
            )}`;

    // Without a plan behind it, the row count is the only honest target.
    const sets =
      reps === null
        ? this.i18n.t('tracker.exercise.targetSets', {
            sets: this.format.setCount(target?.targetSets ?? this.card().sets.length),
          })
        : this.i18n.t('tracker.exercise.target', {
            sets: this.i18n.formatNumber(target?.targetSets ?? 0),
            reps,
          });

    return this.i18n.join([sets, rest]);
  });
}
