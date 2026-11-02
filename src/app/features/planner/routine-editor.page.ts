import { Component, computed, inject, input, signal } from '@angular/core';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import type { Weekday } from '../../domain/models/enums';
import type { RoutineExercise } from '../../domain/models/training';
import { supersetBlocks } from '../../domain/planner/supersets';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { SectionHeader } from '../../shared/ui/section-header';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import { Sheet } from '../../shared/ui/sheet';
import { PlannerStore } from './planner.store';

const REST_PRESETS = [60, 90, 120, 180, 240];

/**
 * Routine editor.
 *
 * Every change writes through immediately rather than accumulating into a
 * draft that must be saved. There is consequently no unsaved-changes guard to
 * write: a guard protects work that only exists in memory, and here none does.
 * On a phone, where the app can be backgrounded or killed at any moment, that
 * is the safer design — it is the same reasoning the workout tracker is built
 * on.
 */
@Component({
  selector: 'rl-routine-editor-page',
  styleUrl: './routine-editor.page.css',
  imports: [
    AppHeader,
    Badge,
    Button,
    Card,
    Chip,
    Dialog,
    EmptyState,
    SectionHeader,
    Segmented,
    Sheet,
  ],
  template: `
    <rl-app-header titleKey="page.plans.title" [showBack]="true" />

    @if (!routine()) {
      <div class="page">
        <rl-empty-state titleKey="page.notFound.title" bodyKey="state.empty.body" />
      </div>
    } @else {
      <div class="page">
        <label class="field">
          <span class="t-label">{{ i18n.t('planner.routine.name') }}</span>
          <input
            class="field__input"
            type="text"
            [value]="routine()!.name"
            (change)="rename($any($event.target).value)"
          />
        </label>

        <div class="field">
          <span class="t-label">{{ i18n.t('planner.routine.schedule') }}</span>
          <rl-segmented
            name="scheduleType"
            labelKey="planner.routine.schedule"
            [options]="scheduleOptions"
            [value]="routine()!.scheduleType"
            (valueChange)="setSchedule($event)"
          />
        </div>

        @if (routine()!.scheduleType === 'scheduled') {
          <div class="field">
            <span class="t-label">{{ i18n.t('planner.routine.weekdays') }}</span>
            <div class="days" role="group" [attr.aria-label]="i18n.t('planner.routine.weekdays')">
              @for (day of orderedWeek(); track day) {
                <button
                  type="button"
                  class="days__day"
                  [class.days__day--on]="routine()!.weekdays.includes(day)"
                  [attr.aria-pressed]="routine()!.weekdays.includes(day)"
                  (click)="toggleDay(day)"
                >
                  {{ i18n.t('weekday.' + day) }}
                </button>
              }
            </div>
          </div>
        }

        <rl-section-header titleKey="planner.routine.exercises" />

        @if (routine()!.exercises.length === 0) {
          <rl-empty-state
            titleKey="planner.routine.empty.title"
            bodyKey="planner.routine.empty.body"
            actionKey="planner.routine.addExercise"
            (actioned)="openPicker()"
          />
        } @else {
          @for (block of blocks(); track $index) {
            <rl-card class="block" [accentEdge]="block.group !== null">
              @if (block.group !== null) {
                <p class="t-micro block__label">
                  {{ i18n.t('planner.exercise.superset', { group: block.group }) }}
                </p>
              }
              @for (exercise of block.members; track exercise.uid) {
                <div class="item">
                  <div class="item__main">
                    <span class="t-body-strong">{{ exercise.nameSnapshot }}</span>
                    <span class="t-caption">{{ targets(exercise) }}</span>
                  </div>
                  <div class="item__actions">
                    <button
                      type="button"
                      class="item__btn"
                      [attr.aria-label]="i18n.t('planner.exercise.moveUp')"
                      [disabled]="indexOf(exercise) === 0"
                      (click)="move(exercise, -1)"
                    >
                      &#8593;
                    </button>
                    <button
                      type="button"
                      class="item__btn"
                      [attr.aria-label]="i18n.t('planner.exercise.moveDown')"
                      [disabled]="indexOf(exercise) === routine()!.exercises.length - 1"
                      (click)="move(exercise, 1)"
                    >
                      &#8595;
                    </button>
                    <button
                      type="button"
                      class="item__btn"
                      [attr.aria-label]="i18n.t('planner.exercise.configure')"
                      (click)="configure(exercise)"
                    >
                      &#9881;
                    </button>
                  </div>
                </div>
              }
            </rl-card>
          }

          <div class="add">
            <rl-button variant="secondary" [full]="true" (click)="openPicker()">
              {{ i18n.t('planner.routine.addExercise') }}
            </rl-button>
          </div>

          <!-- The badge carries the estimate marker, so the figure is never
               mistaken for a measured duration. -->
          <p class="estimate">
            <rl-badge kind="estimate">
              {{ i18n.t('planner.routine.estimate', { minutes: estimateMinutes() }) }}
            </rl-badge>
          </p>
        }

        <p class="t-caption note">{{ i18n.t('planner.routine.historyNote') }}</p>
      </div>
    }

    <!-- Exercise picker -->
    <rl-sheet [(open)]="pickerOpen" size="full" labelKey="planner.picker.title">
      <h2 class="t-h2 sheet__title">{{ i18n.t('planner.picker.title') }}</h2>
      <input
        class="field__input"
        type="search"
        [attr.placeholder]="i18n.t('exercises.search.placeholder')"
        [value]="library.filters().query"
        (input)="library.setQuery($any($event.target).value)"
      />
      <ul class="picks">
        @for (exercise of library.results().slice(0, 60); track exercise.id) {
          <li>
            <button
              type="button"
              class="picks__item"
              [class.picks__item--on]="selected().has(exercise.id)"
              [attr.aria-pressed]="selected().has(exercise.id)"
              (click)="toggleSelected(exercise.id, exercise.nameEn)"
            >
              <span>{{ exercise.nameEn }}</span>
            </button>
          </li>
        }
      </ul>
      <rl-button
        variant="primary"
        [full]="true"
        [disabled]="selected().size === 0"
        (click)="addSelected()"
      >
        {{ i18n.t('planner.picker.add', { count: selected().size }) }}
      </rl-button>
    </rl-sheet>

    <!-- Per-exercise configuration -->
    <rl-sheet [(open)]="configOpen" labelKey="planner.exercise.configure">
      @if (editing(); as exercise) {
        <h2 class="t-h2 sheet__title">{{ exercise.nameSnapshot }}</h2>

        <div class="cfg">
          <span class="t-label">{{ i18n.t('planner.exercise.sets') }}</span>
          <div class="stepper">
            <button type="button" class="stepper__btn" (click)="bumpSets(-1)" aria-label="-">
              &#8722;
            </button>
            <span class="stepper__value">{{ exercise.targetSets }}</span>
            <button type="button" class="stepper__btn" (click)="bumpSets(1)" aria-label="+">
              +
            </button>
          </div>
        </div>

        <div class="cfg">
          <span class="t-label">{{ i18n.t('planner.exercise.reps') }}</span>
          <div class="reps">
            <input
              class="field__input reps__input"
              type="number"
              inputmode="numeric"
              min="1"
              [value]="exercise.targetRepsMin ?? ''"
              (change)="setReps('min', $any($event.target).value)"
            />
            <span aria-hidden="true">–</span>
            <input
              class="field__input reps__input"
              type="number"
              inputmode="numeric"
              min="1"
              [value]="exercise.targetRepsMax ?? ''"
              (change)="setReps('max', $any($event.target).value)"
            />
          </div>
        </div>

        <div class="cfg cfg--stack">
          <span class="t-label">{{ i18n.t('planner.exercise.rest') }}</span>
          <div class="chips">
            @for (preset of restPresets; track preset) {
              <rl-chip [selected]="exercise.restSec === preset" (toggled)="setRest(preset)">
                {{ i18n.t('planner.rest.seconds', { seconds: preset }) }}
              </rl-chip>
            }
          </div>
        </div>

        <div class="cfg">
          <span class="t-label">{{ i18n.t('planner.exercise.warmups') }}</span>
          <div class="stepper">
            <button type="button" class="stepper__btn" (click)="bumpWarmups(-1)" aria-label="-">
              &#8722;
            </button>
            <span class="stepper__value">{{ exercise.warmupSets }}</span>
            <button type="button" class="stepper__btn" (click)="bumpWarmups(1)" aria-label="+">
              +
            </button>
          </div>
        </div>

        <div class="cfg">
          <span class="t-label">{{ i18n.t('planner.exercise.optional') }}</span>
          <rl-chip [selected]="exercise.isOptional" (toggled)="toggleOptional()">
            {{ i18n.t('planner.exercise.optional') }}
          </rl-chip>
        </div>

        <div class="cfg-actions">
          @if (exercise.supersetGroup === null) {
            <rl-button variant="secondary" [full]="true" (click)="group()">
              {{ i18n.t('planner.exercise.group') }}
            </rl-button>
          } @else {
            <rl-button variant="secondary" [full]="true" (click)="ungroupExercise()">
              {{ i18n.t('planner.exercise.ungroup') }}
            </rl-button>
          }
          <rl-button variant="danger" [full]="true" (click)="confirmRemove.set(true)">
            {{ i18n.t('planner.exercise.remove') }}
          </rl-button>
        </div>
      }
    </rl-sheet>

    <rl-dialog
      [(open)]="confirmRemove"
      titleKey="planner.exercise.remove"
      bodyKey="planner.routine.historyNote"
      confirmKey="planner.exercise.remove"
      [destructive]="true"
      (confirmed)="removeEditing()"
    />
  `,
})
export class RoutineEditorPage {
  protected readonly store = inject(PlannerStore);
  protected readonly library = inject(ExerciseLibraryStore);
  protected readonly i18n = inject(I18n);
  private readonly settings = inject(SettingsStore);

  readonly routineId = input.required<string>();

  protected readonly restPresets = REST_PRESETS;

  /**
   * The week rotated to start on the user's configured first day, matching the
   * plan's week strip. A picker that always began on Sunday while the strip
   * beside it began on Monday would make the two impossible to read together.
   */
  protected readonly orderedWeek = computed<Weekday[]>(() => {
    const start = this.settings.prefs().weekStartsOn;
    return Array.from({ length: 7 }, (_, i) => ((start + i) % 7) as Weekday);
  });

  protected readonly pickerOpen = signal(false);
  protected readonly configOpen = signal(false);
  protected readonly confirmRemove = signal(false);
  protected readonly editingUid = signal<string | null>(null);
  protected readonly selected = signal<Map<string, string>>(new Map());

  protected readonly scheduleOptions: readonly SegmentedOption<'scheduled' | 'flexible'>[] = [
    { value: 'scheduled', labelKey: 'planner.routine.scheduled' },
    { value: 'flexible', labelKey: 'planner.routine.flexible' },
  ];

  protected readonly routine = computed(() => this.store.routineById(this.routineId()));
  protected readonly blocks = computed(() => supersetBlocks(this.routine()?.exercises ?? []));
  protected readonly estimateMinutes = computed(() => {
    const routine = this.routine();
    return routine ? this.store.summaryFor(routine).minutes : 0;
  });

  protected readonly editing = computed<RoutineExercise | null>(() => {
    const uid = this.editingUid();
    return this.routine()?.exercises.find((exercise) => exercise.uid === uid) ?? null;
  });

  constructor() {
    void this.store.load();
    void this.library.load();
  }

  protected indexOf(exercise: RoutineExercise): number {
    return this.routine()?.exercises.findIndex((e) => e.uid === exercise.uid) ?? -1;
  }

  protected targets(exercise: RoutineExercise): string {
    const reps =
      exercise.targetRepsMin === null
        ? ''
        : exercise.targetRepsMax === null || exercise.targetRepsMax === exercise.targetRepsMin
          ? ` × ${exercise.targetRepsMin}`
          : ` × ${exercise.targetRepsMin}–${exercise.targetRepsMax}`;
    return `${exercise.targetSets}${reps}`;
  }

  protected async rename(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed) {
      await this.store.saveRoutine(this.routineId(), { name: trimmed });
    }
  }

  protected async setSchedule(scheduleType: 'scheduled' | 'flexible'): Promise<void> {
    await this.store.saveRoutine(this.routineId(), {
      scheduleType,
      // A flexible routine holds no weekday slots.
      ...(scheduleType === 'flexible' ? { weekdays: [] } : {}),
    });
  }

  protected async toggleDay(day: Weekday): Promise<void> {
    const current = this.routine()?.weekdays ?? [];
    const next = current.includes(day)
      ? current.filter((value) => value !== day)
      : [...current, day];
    await this.store.setWeekdays(this.routineId(), next);
  }

  protected async move(exercise: RoutineExercise, delta: number): Promise<void> {
    const from = this.indexOf(exercise);
    await this.store.moveExercise(this.routineId(), from, from + delta);
  }

  protected openPicker(): void {
    this.selected.set(new Map());
    this.library.setQuery('');
    this.pickerOpen.set(true);
  }

  protected toggleSelected(id: string, name: string): void {
    this.selected.update((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  protected async addSelected(): Promise<void> {
    for (const [exerciseId, nameSnapshot] of this.selected()) {
      await this.store.addExercise(this.routineId(), { exerciseId, nameSnapshot });
    }
    this.pickerOpen.set(false);
    this.selected.set(new Map());
  }

  protected configure(exercise: RoutineExercise): void {
    this.editingUid.set(exercise.uid);
    this.configOpen.set(true);
  }

  protected async bumpSets(delta: number): Promise<void> {
    const exercise = this.editing();
    if (!exercise) return;
    await this.patch({ targetSets: Math.max(1, exercise.targetSets + delta) });
  }

  protected async bumpWarmups(delta: number): Promise<void> {
    const exercise = this.editing();
    if (!exercise) return;
    await this.patch({ warmupSets: Math.max(0, exercise.warmupSets + delta) });
  }

  protected async setReps(which: 'min' | 'max', raw: string): Promise<void> {
    const value = raw === '' ? null : Math.max(1, Number(raw));
    await this.patch(which === 'min' ? { targetRepsMin: value } : { targetRepsMax: value });
  }

  protected async setRest(seconds: number): Promise<void> {
    const exercise = this.editing();
    await this.patch({ restSec: exercise?.restSec === seconds ? null : seconds });
  }

  protected async toggleOptional(): Promise<void> {
    const exercise = this.editing();
    if (!exercise) return;
    await this.patch({ isOptional: !exercise.isOptional });
  }

  protected async group(): Promise<void> {
    const uid = this.editingUid();
    if (uid) await this.store.groupExerciseWithNext(this.routineId(), uid);
  }

  protected async ungroupExercise(): Promise<void> {
    const uid = this.editingUid();
    if (uid) await this.store.ungroupExercise(this.routineId(), uid);
  }

  protected async removeEditing(): Promise<void> {
    const uid = this.editingUid();
    if (!uid) return;
    await this.store.removeRoutineExercise(this.routineId(), uid);
    this.configOpen.set(false);
    this.editingUid.set(null);
  }

  private async patch(changes: Partial<RoutineExercise>): Promise<void> {
    const uid = this.editingUid();
    if (uid) await this.store.configureExercise(this.routineId(), uid, changes);
  }
}
