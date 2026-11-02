import { DisplayFormat } from '../../core/format/display-format.service';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import { CLOCK } from '../../data/clock';
import type { Weekday } from '../../domain/models/enums';
import type { Routine, RoutineExercise } from '../../domain/models/training';
import type { ExerciseFacts } from '../../domain/tracker/session';
import { daysBetween, dayKeyAt } from '../../domain/time/day-key';
import { variantKey } from '../../domain/models/exercise';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { SectionHeader } from '../../shared/ui/section-header';
import { Sheet } from '../../shared/ui/sheet';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';
import { PlannerStore } from '../planner/planner.store';
import { TrackerStore } from './tracker.store';
import { TrainOverview } from './train-overview.service';

/**
 * The Train start screen.
 *
 * Its job is to get the user into the right session in as few taps as
 * possible, and to make starting the *wrong* one hard. Tapping a day opens a
 * pre-flight sheet — one extra tap that prevents the most common mistake,
 * and the only place to skip an exercise before you begin.
 *
 * An in-progress session takes the top of the screen with Resume and Finish,
 * because a half-logged workout is the most urgent thing the app can be
 * holding.
 */
@Component({
  selector: 'rl-train-page',
  styleUrl: './train.page.css',
  imports: [AppHeader, Badge, Button, Card, EmptyState, SectionHeader, Sheet],
  template: `
    <rl-app-header titleKey="page.train.title" />

    <div class="page">
      @if (tracker.hasSession()) {
        <rl-card class="live" [accentEdge]="true">
          <div class="live__head">
            <span class="t-body-strong">{{ i18n.t('train.inProgress.title') }}</span>
            <span class="live__time t-stat-sm">{{ format.clock(tracker.elapsedSec()) }}</span>
          </div>
          <p class="t-caption">
            {{ i18n.join([tracker.workout()?.name, format.setCount(tracker.completedSetCount())]) }}
          </p>
          <div class="live__actions">
            <rl-button variant="primary" (click)="openActive()">
              {{ i18n.t('train.resume') }}
            </rl-button>
            <rl-button variant="secondary" (click)="openActive()">
              {{ i18n.t('train.finishNow') }}
            </rl-button>
          </div>
        </rl-card>
      }

      @if (todaysRoutines().length > 0) {
        <rl-section-header titleKey="train.today" />
        @for (routine of todaysRoutines(); track routine.id) {
          <rl-card class="day">
            <button type="button" class="day__btn" (click)="openPreflight(routine)">
              <span class="day__head">
                <span class="t-body-strong">{{ routine.name }}</span>
                <span aria-hidden="true">&#8250;</span>
              </span>
              <span class="t-caption">{{ exercisePreview(routine) }}</span>
              <span class="t-caption">{{ subtitle(routine) }}</span>
            </button>
          </rl-card>
        }
      }

      @if (otherRoutines().length > 0) {
        <rl-section-header titleKey="train.otherRoutines" />
        @for (routine of otherRoutines(); track routine.id) {
          <rl-card class="day">
            <button type="button" class="day__btn" (click)="openPreflight(routine)">
              <span class="day__head">
                <span class="t-body-strong">{{ routine.name }}</span>
                <span class="t-caption">{{ dayList(routine) }}</span>
              </span>
              <span class="t-caption">{{ subtitle(routine) }}</span>
            </button>
          </rl-card>
        }
      }

      @if (!hasAnyRoutine() && !tracker.hasSession()) {
        <rl-empty-state
          titleKey="train.empty.title"
          bodyKey="train.empty.body"
          actionKey="train.empty.action"
          (actioned)="goToPlans()"
        />
      }

      @if (!tracker.hasSession()) {
        <div class="starters">
          <rl-button variant="secondary" [full]="true" [busy]="starting()" (click)="startQuick()">
            {{ i18n.t('train.quick') }}
          </rl-button>
          @if (overview.canRepeat()) {
            <rl-button variant="secondary" [full]="true" [busy]="starting()" (click)="repeatLast()">
              {{ i18n.t('train.repeatLast') }}
            </rl-button>
          }
        </div>
      }
    </div>

    <!-- Pre-flight: confirm the day, and decide what to skip today. -->
    <rl-sheet [(open)]="preflightOpen" size="full" labelKey="train.preflight.start">
      @if (preflight(); as routine) {
        <h2 class="t-h2 pre__title">
          {{ i18n.t('train.preflight.title', { name: routine.name }) }}
        </h2>
        <p class="t-caption pre__hint">{{ i18n.t('train.preflight.hint') }}</p>

        <ul class="pre__list">
          @for (exercise of orderedExercises(routine); track exercise.uid) {
            <li>
              <button
                type="button"
                class="pre__item"
                [class.pre__item--off]="skipped().has(exercise.uid)"
                [attr.aria-pressed]="skipped().has(exercise.uid)"
                (click)="toggleSkip(exercise.uid)"
              >
                <span class="pre__name t-body">{{ exercise.nameSnapshot }}</span>
                <span class="t-caption">{{ targetText(exercise) }}</span>
                @if (skipped().has(exercise.uid)) {
                  <rl-badge kind="neutral">{{ i18n.t('train.preflight.skipped') }}</rl-badge>
                }
              </button>
            </li>
          }
        </ul>

        <div class="pre__actions">
          <rl-button
            variant="primary"
            size="lg"
            [full]="true"
            [busy]="starting()"
            (click)="start(routine)"
          >
            {{ i18n.t('train.preflight.start') }}
          </rl-button>
        </div>
      }
    </rl-sheet>
  `,
})
export class TrainPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly tracker = inject(TrackerStore);
  protected readonly overview = inject(TrainOverview);
  private readonly planner = inject(PlannerStore);
  private readonly library = inject(ExerciseLibraryStore);
  private readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly clock = inject(CLOCK);

  /**
   * A start is in flight.
   *
   * Worth showing. On a first run the built-in catalog is still seeding, and
   * its transaction and the one that creates the session both touch appMeta,
   * so IndexedDB serialises them — measured at roughly six seconds on WebKit,
   * against under half a second once the catalog is on disk. The wait is
   * correct (the seed has to be atomic), but a button that does nothing for
   * six seconds looks broken, so it says it is working instead.
   */
  protected readonly starting = signal(false);
  protected readonly preflightOpen = signal(false);
  private readonly preflightId = signal<string | null>(null);
  protected readonly skipped = signal<ReadonlySet<string>>(new Set());

  protected readonly preflight = computed(() => {
    const id = this.preflightId();
    return id === null ? null : (this.planner.routineById(id) ?? null);
  });

  private readonly today = computed<Weekday>(() => {
    const key = dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes());
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getDay() as Weekday;
  });

  protected readonly todaysRoutines = computed(() => this.planner.routinesOnWeekday(this.today()));

  /** Everything startable that is not already in the Today list. */
  protected readonly otherRoutines = computed(() => {
    const shown = new Set(this.todaysRoutines().map((routine) => routine.id));
    const planId = this.planner.activePlanId();
    return (this.planner.routines() ?? [])
      .filter(
        (routine) =>
          !routine.isArchived &&
          !shown.has(routine.id) &&
          (routine.planId === null || planId === null || routine.planId === planId),
      )
      .sort((a, b) => a.orderIndex - b.orderIndex);
  });

  protected readonly hasAnyRoutine = computed(
    () => this.todaysRoutines().length > 0 || this.otherRoutines().length > 0,
  );

  constructor() {
    void this.init();
  }

  /**
   * The in-progress session is looked for first, not behind the catalog.
   *
   * On a first run the library load seeds 168 exercises; holding the "workout
   * in progress" card behind that would hide the most urgent thing on the
   * screen for seconds.
   */
  private async init(): Promise<void> {
    const session = this.tracker.loadActive();
    await Promise.all([session, this.planner.load(), this.library.load()]);
    await this.overview.load((this.planner.routines() ?? []).map((routine) => routine.id));
  }

  // ------------------------------------------------------------------ views

  protected orderedExercises(routine: Routine): RoutineExercise[] {
    return [...routine.exercises].sort((a, b) => a.orderIndex - b.orderIndex);
  }

  protected exercisePreview(routine: Routine): string {
    const names = this.orderedExercises(routine)
      .slice(0, 3)
      .map((exercise) => exercise.nameSnapshot);
    return this.i18n.join(names);
  }

  protected subtitle(routine: Routine): string {
    const summary = this.planner.summaryFor(routine);
    const exercises = this.i18n.t('count.exercises', { count: summary.exercises });
    return this.i18n.join([exercises, this.lastDoneText(routine.id)]);
  }

  protected dayList(routine: Routine): string {
    if (routine.scheduleType === 'flexible' || routine.weekdays.length === 0) {
      return this.i18n.t('train.flexible');
    }
    return routine.weekdays.map((day) => this.i18n.t(`weekday.${day}`)).join(', ');
  }

  protected targetText(exercise: RoutineExercise): string {
    const reps =
      exercise.targetRepsMin === null
        ? ''
        : exercise.targetRepsMax === null || exercise.targetRepsMax === exercise.targetRepsMin
          ? ` × ${this.i18n.formatNumber(exercise.targetRepsMin)}`
          : ` × ${this.i18n.formatNumber(exercise.targetRepsMin)}–${this.i18n.formatNumber(exercise.targetRepsMax)}`;
    return `${this.i18n.formatNumber(exercise.targetSets)}${reps}`;
  }

  private lastDoneText(routineId: string): string {
    const last = this.overview.lastDone(routineId);
    if (last === undefined) return this.i18n.t('train.neverDone');

    const days = daysBetween(
      dayKeyAt(Date.parse(last), this.clock.timezoneOffsetMinutes()),
      dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes()),
    );
    return this.i18n.t('train.lastDone', { when: this.format.relativeDays(days) });
  }

  // --------------------------------------------------------------- starting

  protected openPreflight(routine: Routine): void {
    this.preflightId.set(routine.id);
    this.skipped.set(new Set());
    this.preflightOpen.set(true);
  }

  protected toggleSkip(uid: string): void {
    this.skipped.update((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  protected async start(routine: Routine): Promise<void> {
    this.preflightOpen.set(false);
    await this.guarded(() =>
      this.tracker.startFromRoutine(routine.id, {
        facts: (id) => this.factsFor(id),
        skipUids: this.skipped(),
        plan: routine.planId === null ? null : (this.planner.planById(routine.planId) ?? null),
      }),
    );
  }

  protected async startQuick(): Promise<void> {
    await this.guarded(() => this.tracker.startQuick(this.i18n.t('train.quick.name')));
  }

  protected async repeatLast(): Promise<void> {
    const last = this.overview.lastWorkout();
    if (!last) return;
    await this.guarded(() => this.tracker.startFromWorkout(last.id));
  }

  /**
   * Starting can legitimately fail — a session may already be live, started in
   * another tab. The refusal belongs on screen, not in the console.
   */
  private async guarded(start: () => Promise<string>): Promise<void> {
    if (this.starting()) return;
    this.starting.set(true);
    try {
      await start();
      await this.router.navigate(['/train/active']);
    } catch {
      this.toasts.error(this.i18n.t('train.startFailed'));
      await this.tracker.loadActive();
    } finally {
      this.starting.set(false);
    }
  }

  protected openActive(): void {
    void this.router.navigate(['/train/active']);
  }

  protected goToPlans(): void {
    void this.router.navigate(['/plans']);
  }

  /**
   * Freezes what the library knows about an exercise into the session.
   *
   * `undefined` for an exercise that is gone, which the planner handles by
   * falling back to the routine's own name snapshot rather than failing.
   */
  private factsFor(exerciseId: string): ExerciseFacts | undefined {
    const exercise = this.library.byId().get(exerciseId);
    if (!exercise) return undefined;

    return {
      exerciseId: exercise.id,
      variantKey: variantKey(exercise),
      name: this.library.displayName(exercise),
      loadType: exercise.loadType,
      laterality: exercise.laterality,
      defaultRestSec: exercise.defaultRestSec,
    };
  }
}
