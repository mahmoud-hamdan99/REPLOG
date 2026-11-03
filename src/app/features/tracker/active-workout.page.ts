import { DisplayFormat } from '../../core/format/display-format.service';
import { Component, computed, DestroyRef, DOCUMENT, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import type { SetType } from '../../domain/models/enums';
import { variantKey } from '../../domain/models/exercise';
import { suggestNext, type Suggestion } from '../../domain/strength/progression';
import type { MuscleGroup } from '../../domain/models/enums';
import { MUSCLE_ROLLUP } from '../../domain/models/enums';
import type { ExerciseFacts } from '../../domain/tracker/session';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { ExercisePicker, type PickerItem } from '../../shared/ui/exercise-picker';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import { Sheet } from '../../shared/ui/sheet';
import { ExerciseLibraryStore } from '../exercises/exercise-library.store';
import { ExerciseCard } from './components/exercise-card';
import { NumericPad, type PadValue } from '../../shared/ui/numeric-pad';
import { RestPill, RestTimer } from './components/rest-timer';
import type { PreviousPerformance } from './previous-performance.service';
import { TrackerStore, type SessionBlock } from './tracker.store';
import { RECOVERY_WINDOW_DAYS } from '../../domain/models/entity';

const SET_TYPES: readonly SetType[] = ['warmup', 'working', 'dropset', 'failure', 'backoff'];
/** 5–10 in half steps: the range anyone actually reports. */
const RPE_VALUES = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const RIR_VALUES = [0, 1, 2, 3, 4, 5];
/** How long the finished rest sheet stays up before dismissing itself. */
const REST_DISMISS_MS = 2000;

/** Filters whose default load jump is the bigger one. */
const LOWER_BODY: readonly string[] = ['quadriceps', 'hamstrings', 'glutes', 'calves'];

/**
 * Whether an exercise's default progression step is the lower-body one.
 *
 * Decided from the rolled-up filter taxonomy rather than the fine-grained
 * muscles, so adductors and abductors come along without a second list.
 */
function isLowerBody(primaryMuscles: readonly MuscleGroup[]): boolean {
  return primaryMuscles.some((muscle) => LOWER_BODY.includes(MUSCLE_ROLLUP[muscle]));
}

interface WakeLockLike {
  release(): Promise<void>;
}

/**
 * The active tracker — the screen the product lives on.
 *
 * Three things shape it. It is used one-handed, standing, mid-set, so the
 * controls that matter sit in the lower half and the confirm button is the
 * biggest target on the row. It is *modal*: there is no tab bar, and leaving
 * requires an explicit choice, because a stray tap must not abandon a workout.
 * And it never shows a state the database has not reached — every tick comes
 * from a committed write.
 *
 * Interruption protection (docs/ARCHITECTURE.md section 7.4) is wired here
 * because it is inherently DOM-bound: `visibilitychange`, `pagehide` and
 * `beforeunload` are the last hooks before iOS can evict the page.
 */
@Component({
  selector: 'rl-active-workout-page',
  styleUrl: './active-workout.page.css',
  imports: [
    Button,
    Chip,
    Dialog,
    EmptyState,
    ExerciseCard,
    ExercisePicker,
    NumericPad,
    RestPill,
    RestTimer,
    Segmented,
    Sheet,
  ],
  template: `
    @if (store.isLoading() && !store.hasSession()) {
      <!-- "No workout in progress" is a claim, and it must not be made while
           the answer is still being looked up. -->
      <div class="page">
        <p class="t-body" role="status">{{ i18n.t('state.loading.label') }}</p>
      </div>
    } @else if (!store.hasSession()) {
      <div class="page">
        <rl-empty-state
          titleKey="tracker.notFound.title"
          bodyKey="tracker.notFound.body"
          actionKey="page.train.title"
          (actioned)="leaveToTrain()"
        />
      </div>
    } @else {
      <header class="bar">
        <button
          type="button"
          class="bar__btn"
          [attr.aria-label]="store.isPaused() ? i18n.t('tracker.resume') : i18n.t('tracker.pause')"
          [disabled]="store.isReadOnly()"
          (click)="togglePause()"
        >
          <span aria-hidden="true">{{ store.isPaused() ? '▶' : '‖' }}</span>
        </button>

        <div class="bar__main">
          <h1 class="bar__name t-body-strong">{{ store.workout()?.name }}</h1>
          <p class="bar__meta t-caption">{{ progressText() }}</p>
        </div>

        <span class="bar__time t-stat-sm" [attr.aria-label]="i18n.t('tracker.elapsed')">
          {{ format.clock(store.elapsedSec()) }}
        </span>

        <button
          type="button"
          class="bar__btn"
          [attr.aria-label]="i18n.t('tracker.menu')"
          (click)="workoutMenuOpen.set(true)"
        >
          <span aria-hidden="true">&#8943;</span>
        </button>
      </header>

      <div
        class="progress"
        role="progressbar"
        [attr.aria-valuenow]="store.progress().completed"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="store.progress().planned"
        [attr.aria-label]="i18n.t('tracker.progress', progressParams())"
      >
        <span class="progress__fill" [style.inline-size.%]="store.progress().ratio * 100"></span>
      </div>

      @if (store.isReadOnly()) {
        <div class="notice" role="status">
          <p class="t-body-strong">{{ i18n.t('tracker.readOnly.title') }}</p>
          <p class="t-caption">{{ i18n.t('tracker.readOnly.body') }}</p>
        </div>
      }

      @if (store.isPaused() && !store.awaitingResumeChoice()) {
        <div class="notice" role="status">
          <p class="t-body-strong">{{ i18n.t('tracker.paused.title') }}</p>
          <p class="t-caption">{{ i18n.t('tracker.paused.body') }}</p>
          <rl-button variant="primary" [full]="true" (click)="togglePause()">
            {{ i18n.t('tracker.resume') }}
          </rl-button>
        </div>
      }

      <div class="page page--tracker">
        @if (store.cards().length === 0) {
          <rl-empty-state
            titleKey="tracker.empty.title"
            bodyKey="tracker.empty.body"
            actionKey="tracker.addExercise"
            (actioned)="openPicker()"
          />
        }

        @for (block of store.blocks(); track blockKey(block)) {
          <div class="block" [class.block--superset]="block.group !== null">
            @if (block.group !== null) {
              <p class="block__label t-micro">
                {{ i18n.t('tracker.exercise.superset', { group: block.group }) }}
              </p>
            }
            @for (card of block.cards; track card.exercise.id) {
              <rl-exercise-card
                [card]="card"
                [position]="positionOf(card.exercise.id)"
                [expanded]="store.expandedId() === card.exercise.id"
                [focusSetId]="store.focusSetId()"
                [isAdvanced]="store.isAdvanced()"
                [readOnly]="store.isReadOnly()"
                [previous]="previousFor(card.exercise.id)"
                [suggestionText]="suggestionFor(card.exercise.id)"
                (toggled)="toggleCard(card.exercise.id)"
                (menuOpened)="openExerciseMenu(card.exercise.id)"
                (setToggled)="toggleSet($event)"
                (weightRequested)="openPad($event, 'weight')"
                (repsRequested)="openPad($event, 'reps')"
                (setDeleted)="deleteSet($event)"
                (setOpened)="openSetSheet($event)"
                (setAdded)="store.addSet(card.exercise.id)"
                (warmupAdded)="store.addWarmup(card.exercise.id)"
                (suggestionAccepted)="applySuggestion(card.exercise.id)"
              />
            }
          </div>
        }

        @if (!store.isReadOnly() && store.cards().length > 0) {
          <rl-button variant="ghost" [full]="true" (click)="openPicker()">
            {{ i18n.t('tracker.addExercise') }}
          </rl-button>
        }

        <p class="note t-caption">{{ i18n.t('tracker.volumeNote') }}</p>
      </div>

      <div class="actions">
        @if (store.rest() !== null) {
          <rl-rest-pill
            [remainingSec]="store.restRemainingSec()"
            [isDone]="store.restJustFinished()"
            (opened)="restOpen.set(true)"
          />
        } @else {
          <rl-button variant="secondary" [disabled]="store.isReadOnly()" (click)="startRest()">
            {{ i18n.t('tracker.rest.start') }}
          </rl-button>
        }
        <rl-button variant="primary" [disabled]="store.isReadOnly()" (click)="finishOpen.set(true)">
          {{ i18n.t('tracker.finish') }}
        </rl-button>
      </div>
    }

    <!-- Cold-start recovery. Never resumes or discards on its own. -->
    <rl-sheet
      [open]="store.awaitingResumeChoice()"
      [dismissible]="false"
      labelKey="tracker.resumePrompt.title"
    >
      <h2 class="t-h2 sheet__title">{{ i18n.t('tracker.resumePrompt.title') }}</h2>
      <p class="t-body">{{ resumeSummary() }}</p>
      <div class="choices">
        <rl-button variant="primary" size="lg" [full]="true" (click)="store.acceptResume()">
          {{ i18n.t('train.resume') }}
        </rl-button>
        <rl-button variant="secondary" [full]="true" (click)="resumeThenFinish()">
          {{ i18n.t('train.finishNow') }}
        </rl-button>
        <rl-button variant="danger" [full]="true" (click)="discardOpen.set(true)">
          {{ i18n.t('tracker.leave.discard') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- The three-way leave choice the route guard waits on. -->
    <rl-sheet
      [(open)]="leaveOpen"
      [dismissible]="false"
      labelKey="tracker.leave.title"
      (closed)="resolveLeave(false)"
    >
      <h2 class="t-h2 sheet__title">{{ i18n.t('tracker.leave.title') }}</h2>
      <p class="t-body">{{ i18n.t('tracker.leave.body') }}</p>
      <div class="choices">
        <rl-button variant="primary" size="lg" [full]="true" (click)="resolveLeave(false)">
          {{ i18n.t('tracker.leave.keep') }}
        </rl-button>
        <rl-button variant="secondary" [full]="true" (click)="pauseAndLeave()">
          {{ i18n.t('tracker.leave.pauseExit') }}
        </rl-button>
        <rl-button variant="danger" [full]="true" (click)="discardFromLeave()">
          {{ i18n.t('tracker.leave.discard') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- Workout menu -->
    <rl-sheet [(open)]="workoutMenuOpen" labelKey="tracker.menu">
      <h2 class="t-h2 sheet__title">{{ i18n.t('tracker.menu') }}</h2>

      <div class="field">
        <span class="t-label">{{ i18n.t('tracker.mode.label') }}</span>
        <rl-segmented
          name="trackingMode"
          labelKey="tracker.mode.label"
          [options]="modeOptions"
          [value]="store.trackingMode()"
          (valueChange)="store.setTrackingMode($event)"
        />
      </div>

      <div class="choices">
        <rl-button variant="secondary" [full]="true" (click)="openPicker()">
          {{ i18n.t('tracker.addExercise') }}
        </rl-button>
        <rl-button variant="danger" [full]="true" (click)="openDiscardFromMenu()">
          {{ i18n.t('tracker.leave.discard') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- Per-exercise menu -->
    <rl-sheet [(open)]="exerciseMenuOpen" labelKey="tracker.exercise.replace">
      @if (menuCard(); as card) {
        <h2 class="t-h2 sheet__title">{{ card.exercise.nameSnapshot }}</h2>
        <div class="choices">
          <rl-button variant="secondary" [full]="true" (click)="moveExercise(-1)">
            {{ i18n.t('tracker.exercise.moveUp') }}
          </rl-button>
          <rl-button variant="secondary" [full]="true" (click)="moveExercise(1)">
            {{ i18n.t('tracker.exercise.moveDown') }}
          </rl-button>
          @if (card.exercise.supersetGroup === null) {
            <rl-button variant="secondary" [full]="true" (click)="group()">
              {{ i18n.t('tracker.exercise.group') }}
            </rl-button>
          } @else {
            <rl-button variant="secondary" [full]="true" (click)="ungroup()">
              {{ i18n.t('tracker.exercise.ungroup') }}
            </rl-button>
          }
          <rl-button variant="secondary" [full]="true" (click)="openReplace()">
            {{ i18n.t('tracker.exercise.replace') }}
          </rl-button>
          <rl-button variant="secondary" [full]="true" (click)="toggleSkip()">
            {{
              card.exercise.isSkipped
                ? i18n.t('tracker.exercise.unskip')
                : i18n.t('tracker.exercise.skip')
            }}
          </rl-button>
        </div>
      }
    </rl-sheet>

    <!-- Per-set detail: the accessible route to everything the swipe hides. -->
    <rl-sheet [(open)]="setSheetOpen" labelKey="tracker.setType">
      @if (sheetSet(); as set) {
        <h2 class="t-h2 sheet__title">{{ i18n.t('tracker.setType') }}</h2>

        <div class="chips">
          @for (type of setTypes; track type) {
            <rl-chip [selected]="set.setType === type" (toggled)="setType(type)">
              {{ i18n.t('tracker.setType.' + type) }}
            </rl-chip>
          }
        </div>

        @if (store.isAdvanced()) {
          <p class="t-label field__label">{{ i18n.t('tracker.rpe') }}</p>
          <div class="chips">
            @for (value of rpeValues; track value) {
              <rl-chip [selected]="set.rpe === value" (toggled)="setRpe(value)">
                {{ i18n.formatNumber(value) }}
              </rl-chip>
            }
          </div>

          <p class="t-label field__label">{{ i18n.t('tracker.rir') }}</p>
          <div class="chips">
            @for (value of rirValues; track value) {
              <rl-chip [selected]="set.rir === value" (toggled)="setRir(value)">
                {{ i18n.formatNumber(value) }}
              </rl-chip>
            }
          </div>

          <label class="field">
            <span class="t-label">{{ i18n.t('tracker.setNote') }}</span>
            <textarea
              class="field__input"
              rows="2"
              [value]="set.notes ?? ''"
              (input)="setNote($any($event.target).value)"
            ></textarea>
          </label>
        }

        <div class="choices">
          <rl-button variant="danger" [full]="true" (click)="deleteFromSheet()">
            {{ i18n.t('tracker.set.delete', { index: i18n.formatNumber(set.setIndex + 1) }) }}
          </rl-button>
        </div>
      }
    </rl-sheet>

    <!-- The pad, the picker, the rest sheet and the two confirmations. -->
    @if (padSet(); as set) {
      <rl-numeric-pad
        [(open)]="padOpen"
        [titleText]="padTitle()"
        [initialWeight]="format.massDisplay(set.weightKg)"
        [initialReps]="set.reps"
        [showWeight]="padShowsWeight()"
        [startField]="padField()"
        [unitShort]="format.unitShort()"
        [increment]="padIncrement()"
        [previousText]="padPrevious()"
        (changed)="padChanged($event)"
        (done)="padDone()"
      />
    }

    <!-- The query drives the library store's own ranked search rather than a
         second filter here: relevance ordering is not worth reimplementing. -->
    <rl-exercise-picker
      [(open)]="pickerOpen"
      [query]="library.filters().query"
      (queryChange)="library.setQuery($event)"
      [titleKey]="pickerMode() === 'replace' ? 'picker.replaceTitle' : 'picker.title'"
      [items]="pickerItems()"
      [loading]="library.isLoading() || library.isSeeding()"
      [multiple]="pickerMode() === 'add'"
      (picked)="picked($event)"
    />

    <rl-rest-timer
      [(open)]="restOpen"
      [remainingSec]="store.restRemainingSec()"
      [progress]="store.restProgress()"
      [isDone]="store.restJustFinished()"
      [nextText]="restNextText()"
      (adjusted)="store.adjustRest($event)"
      (skipped)="skipRest()"
    />

    <!-- The dropped-set count is stated in the confirmation, not discovered
         afterwards: nothing is removed without the user being told first. -->
    <rl-dialog
      [(open)]="finishOpen"
      titleKey="tracker.finish.title"
      [bodyText]="finishSummary()"
      confirmKey="tracker.finish.confirm"
      (confirmed)="finish()"
    />

    <rl-dialog
      [(open)]="discardOpen"
      titleKey="tracker.discard.title"
      [bodyText]="discardSummary()"
      confirmKey="tracker.discard.confirm"
      [destructive]="true"
      (confirmed)="discard()"
    />
  `,
})
export class ActiveWorkoutPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(TrackerStore);
  protected readonly library = inject(ExerciseLibraryStore);
  private readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly setTypes = SET_TYPES;
  protected readonly rpeValues = RPE_VALUES;
  protected readonly rirValues = RIR_VALUES;

  protected readonly modeOptions: readonly SegmentedOption<'simple' | 'advanced'>[] = [
    { value: 'simple', labelKey: 'tracker.mode.simple' },
    { value: 'advanced', labelKey: 'tracker.mode.advanced' },
  ];

  protected readonly padOpen = signal(false);
  protected readonly restOpen = signal(false);
  protected readonly leaveOpen = signal(false);
  protected readonly finishOpen = signal(false);
  protected readonly discardOpen = signal(false);
  protected readonly workoutMenuOpen = signal(false);
  protected readonly exerciseMenuOpen = signal(false);
  protected readonly setSheetOpen = signal(false);
  protected readonly pickerOpen = signal(false);
  protected readonly pickerMode = signal<'add' | 'replace'>('add');

  private readonly padSetId = signal<string | null>(null);
  protected readonly padField = signal<'weight' | 'reps'>('weight');
  private readonly sheetSetId = signal<string | null>(null);
  private readonly menuExerciseId = signal<string | null>(null);

  /** Previous performance, fetched once per exercise and cached for the view. */
  private readonly previous = signal<ReadonlyMap<string, PreviousPerformance | null>>(new Map());

  /**
   * Suggestions, derived from previous performance and the plan's target.
   *
   * A computed rather than a second fetch: everything the rules need is
   * already loaded, so a suggestion costs nothing beyond the arithmetic and
   * cannot go stale against the history it was derived from.
   */
  private readonly suggestions = computed(() => {
    const result = new Map<string, Suggestion>();

    for (const card of this.store.cards()) {
      const last = this.previous().get(card.exercise.id);
      if (!last) continue;

      const library = this.library.byId().get(card.exercise.exerciseId);
      const target = card.exercise.targetSnapshot;
      const suggestion = suggestNext({
        lastSession: last.sets,
        sessionCount: last.sessionCount,
        targetRepsMin: target?.targetRepsMin ?? null,
        targetRepsMax: target?.targetRepsMax ?? null,
        incrementKg: library?.weightIncrementKg ?? 2.5,
        isLowerBody: isLowerBody(library?.primaryMuscles ?? []),
      });

      if (suggestion) result.set(card.exercise.id, suggestion);
    }

    return result;
  });

  private leaveResolver: ((leave: boolean) => void) | null = null;
  private wakeLock: WakeLockLike | null = null;
  private lastRestStart = 0;

  protected readonly padSet = computed(() => {
    const id = this.padSetId();
    return id === null ? null : (this.store.setById(id) ?? null);
  });

  private readonly padExercise = computed(() => {
    const set = this.padSet();
    return set ? (this.store.exerciseById(set.workoutExerciseId) ?? null) : null;
  });

  protected readonly padShowsWeight = computed(() => {
    const loadType = this.padExercise()?.loadType ?? 'external';
    return loadType !== 'time' && loadType !== 'distance';
  });

  protected readonly padTitle = computed(() =>
    this.i18n.t('pad.title', {
      name: this.padExercise()?.nameSnapshot ?? '',
      index: this.i18n.formatNumber((this.padSet()?.setIndex ?? 0) + 1),
    }),
  );

  protected readonly padIncrement = computed(() => {
    const exercise = this.padExercise();
    const library = exercise ? this.library.byId().get(exercise.exerciseId) : undefined;
    return this.format.increment(library?.weightIncrementKg ?? 2.5);
  });

  /**
   * The matching set from last time, as ghost text in the pad.
   *
   * Matched by position among working sets, falling back to the last one — on
   * set 5 of a session that was four sets last time, the closest honest
   * comparison is that fourth set.
   */
  protected readonly padPrevious = computed(() => {
    const set = this.padSet();
    if (!set) return null;
    const previous = this.previousFor(set.workoutExerciseId);
    if (!previous) return null;

    const working = previous.sets.filter((candidate) => candidate.setType !== 'warmup');
    const match = working[set.setIndex] ?? working.at(-1);
    return match ? this.format.setSummary(match) : null;
  });

  protected readonly sheetSet = computed(() => {
    const id = this.sheetSetId();
    return id === null ? null : (this.store.setById(id) ?? null);
  });

  protected readonly menuCard = computed(() => {
    const id = this.menuExerciseId();
    return id === null ? null : (this.store.cards().find((c) => c.exercise.id === id) ?? null);
  });

  protected readonly pickerItems = computed<PickerItem[]>(() =>
    this.library
      .results()
      .slice(0, 80)
      .map((exercise) => ({
        id: exercise.id,
        name: this.library.displayName(exercise),
        detail: this.i18n.t(`equipment.${exercise.equipment}`),
      })),
  );

  constructor() {
    void this.init();
    this.watchInterruptions();

    // Previous performance depends on the session's exercises, which change as
    // the user adds, replaces or skips. Refetching on that signal keeps the
    // "last time" line correct after a replace without a manual refresh.
    effect(() => {
      const ids = this.store.cards().map((card) => card.exercise.id);
      void this.loadPrevious(ids);
    });

    effect(() => {
      const wanted =
        this.store.hasSession() &&
        !this.store.isReadOnly() &&
        this.settings.prefs().keepScreenAwake;
      void this.applyWakeLock(wanted);
    });

    // The rest sheet follows the rest, including one started automatically by
    // a confirm. Keyed on the start timestamp rather than on the rest being
    // non-null, so dismissing the sheet does not immediately reopen it.
    effect(() => {
      const rest = this.store.rest();
      // Not while a recovered session is waiting for a decision: stacking a
      // rest sheet on the resume prompt buries the choice the user has to make.
      if (rest === null || this.store.awaitingResumeChoice()) return;
      if (rest.startedAtMs === this.lastRestStart) return;

      this.lastRestStart = rest.startedAtMs;
      this.restOpen.set(true);
    });

    // On completion: a cue, then the sheet gets out of the way on its own.
    effect(() => {
      if (!this.store.restJustFinished()) return;
      this.playCompletionTone();
      setTimeout(() => {
        this.store.acknowledgeRest();
        this.restOpen.set(false);
      }, REST_DISMISS_MS);
    });
  }

  /**
   * Finds the session first, and the library alongside it.
   *
   * Deliberately not sequential. The library is needed for the picker and for
   * load increments, not to render a session — and on a first run its load
   * includes seeding the whole catalog, measured at several seconds on WebKit.
   * Waiting for that before even looking for the active workout left the one
   * screen whose promise is "your session is safe" saying "No workout in
   * progress" for the duration.
   */
  private async init(): Promise<void> {
    const session = this.store.hasSession() ? Promise.resolve(true) : this.store.loadActive();

    await Promise.all([session, this.library.load()]);
  }

  // ------------------------------------------------------------------- views

  protected positionOf(exerciseId: string): number {
    return this.store.cards().findIndex((card) => card.exercise.id === exerciseId) + 1;
  }

  protected blockKey(block: SessionBlock): string {
    return `${block.group ?? 'single'}:${block.cards[0]?.exercise.id ?? ''}`;
  }

  protected previousFor(exerciseId: string): PreviousPerformance | null {
    return this.previous().get(exerciseId) ?? null;
  }

  /**
   * The next-set suggestion for one exercise, formatted for display.
   *
   * `null` whenever there is nothing honest to say: the preference is off,
   * there is no history, or the rules decline. The card then shows the
   * previous-performance block's own "No history yet" and offers nothing.
   */
  protected suggestionFor(exerciseId: string): { value: string; reason: string } | null {
    if (!this.settings.prefs().showSuggestions) return null;

    const suggestion = this.suggestions().get(exerciseId);
    if (!suggestion) return null;

    const weight =
      suggestion.suggestedWeightKg === null
        ? null
        : this.format.massWithUnit(suggestion.suggestedWeightKg);
    const reps =
      suggestion.suggestedReps === null ? null : this.format.repCount(suggestion.suggestedReps);

    return {
      value: this.i18n.join([weight, reps]),
      reason: this.i18n.t(suggestion.reasonKey, suggestion.reasonParams),
    };
  }

  /**
   * Fills the current row from a suggestion. **A draft, never a commit.**
   *
   * The values land in the row as an unconfirmed edit exactly as if typed;
   * the user still has to confirm the set. Nothing is written into the plan.
   */
  protected applySuggestion(exerciseId: string): void {
    const suggestion = this.suggestions().get(exerciseId);
    const card = this.store.cards().find((item) => item.exercise.id === exerciseId);
    const target = card?.sets.find((set) => !set.isCompleted);
    if (!suggestion || !target) return;

    this.store.editSet(target.id, {
      weightKg: suggestion.suggestedWeightKg,
      reps: suggestion.suggestedReps,
    });
    this.store.focusSet(target.id);
    this.toasts.show(this.i18n.t('suggest.applied'));
  }

  /**
   * "2 of 6 sets" — with the noun carried by the *planned* count.
   *
   * Arabic agreement depends on the number, so "{n} sets" has to go through
   * the plural forms; interpolating a bare numeral beside a fixed noun gives
   * "٦ مجموعة" where the language wants "٦ مجموعات".
   */
  protected progressParams(): Record<string, string> {
    const progress = this.store.progress();
    return {
      completed: this.i18n.formatNumber(progress.completed),
      planned: this.format.setCount(progress.planned),
    };
  }

  protected progressText(): string {
    return this.i18n.t('tracker.progress', this.progressParams());
  }

  protected resumeSummary(): string {
    return this.i18n.t('tracker.resumePrompt.body', {
      name: this.store.workout()?.name ?? '',
      duration: this.format.clock(this.store.elapsedSec()),
      sets: this.format.setCount(this.store.completedSetCount()),
    });
  }

  protected finishSummary(): string {
    const body = this.i18n.t('tracker.finish.body', {
      sets: this.format.setCount(this.store.completedSetCount()),
      duration: this.format.clock(this.store.elapsedSec()),
    });
    const unlogged = this.store
      .cards()
      .reduce((total, card) => total + card.sets.filter((set) => !set.isCompleted).length, 0);
    return unlogged === 0
      ? body
      : `${body} ${this.i18n.t('tracker.finish.dropped', { count: unlogged })}`;
  }

  protected discardSummary(): string {
    return this.i18n.t('tracker.discard.body', {
      days: RECOVERY_WINDOW_DAYS,
      duration: this.format.clock(this.store.elapsedSec()),
      sets: this.format.setCount(this.store.completedSetCount()),
    });
  }

  protected restNextText(): string {
    const setId = this.store.restNextSetId();
    const set = setId === null ? undefined : this.store.setById(setId);
    const exercise = set ? this.store.exerciseById(set.workoutExerciseId) : undefined;

    return exercise && set
      ? this.i18n.t('tracker.rest.next', {
          name: exercise.nameSnapshot,
          index: this.i18n.formatNumber(set.setIndex + 1),
        })
      : this.i18n.t('tracker.rest.nextNone');
  }

  // ------------------------------------------------------------------- cards

  protected toggleCard(exerciseId: string): void {
    this.store.expand(this.store.expandedId() === exerciseId ? null : exerciseId);
  }

  protected async toggleSet(setId: string): Promise<void> {
    const set = this.store.setById(setId);
    if (!set) return;
    if (set.isCompleted) await this.store.unconfirmSet(setId);
    else await this.store.confirmSet(setId);
  }

  protected async deleteSet(setId: string): Promise<void> {
    await this.store.deleteSet(setId);
    this.toasts.undo(this.i18n.t('tracker.set.deleted'), () => void this.store.restoreSet(setId));
  }

  // --------------------------------------------------------------- numeric pad

  protected openPad(setId: string, field: 'weight' | 'reps'): void {
    this.store.focusSet(setId);
    this.padSetId.set(setId);
    this.padField.set(field);
    this.padOpen.set(true);
  }

  /** Values arrive in display units; conversion to kilograms happens here. */
  protected padChanged(value: PadValue): void {
    const setId = this.padSetId();
    if (setId === null) return;
    this.store.editSet(setId, {
      weightKg: this.format.massCanonical(value.weight),
      reps: value.reps,
    });
  }

  protected async padDone(): Promise<void> {
    const setId = this.padSetId();
    if (setId === null) return;
    const set = this.store.setById(setId);
    if (set && !set.isCompleted) await this.store.confirmSet(setId);
  }

  // ---------------------------------------------------------------- set sheet

  protected openSetSheet(setId: string): void {
    this.sheetSetId.set(setId);
    this.setSheetOpen.set(true);
  }

  protected setType(setType: SetType): void {
    const set = this.sheetSet();
    if (!set) return;
    this.store.editSet(set.id, { setType });
    void this.store.flushPending();
  }

  protected setRpe(rpe: number): void {
    const set = this.sheetSet();
    if (!set) return;
    this.store.editSet(set.id, { rpe: set.rpe === rpe ? null : rpe });
  }

  protected setRir(rir: number): void {
    const set = this.sheetSet();
    if (!set) return;
    this.store.editSet(set.id, { rir: set.rir === rir ? null : rir });
  }

  protected setNote(notes: string): void {
    const set = this.sheetSet();
    if (!set) return;
    this.store.editSet(set.id, { notes: notes.trim() === '' ? null : notes });
  }

  protected async deleteFromSheet(): Promise<void> {
    const set = this.sheetSet();
    this.setSheetOpen.set(false);
    if (set) await this.deleteSet(set.id);
  }

  // --------------------------------------------------------------- exercises

  protected openExerciseMenu(exerciseId: string): void {
    this.menuExerciseId.set(exerciseId);
    this.exerciseMenuOpen.set(true);
  }

  protected async moveExercise(delta: number): Promise<void> {
    const id = this.menuExerciseId();
    if (id === null) return;
    const from = this.store.cards().findIndex((card) => card.exercise.id === id);
    await this.store.moveExercise(from, from + delta);
  }

  protected async group(): Promise<void> {
    const id = this.menuExerciseId();
    if (id !== null) await this.store.groupExerciseWithNext(id);
  }

  protected async ungroup(): Promise<void> {
    const id = this.menuExerciseId();
    if (id !== null) await this.store.ungroupExercise(id);
  }

  protected async toggleSkip(): Promise<void> {
    const card = this.menuCard();
    this.exerciseMenuOpen.set(false);
    if (card) await this.store.skipExercise(card.exercise.id, !card.exercise.isSkipped);
  }

  protected openPicker(): void {
    this.pickerMode.set('add');

    this.library.setQuery('');
    this.workoutMenuOpen.set(false);
    this.pickerOpen.set(true);
  }

  protected openReplace(): void {
    this.pickerMode.set('replace');

    this.library.setQuery('');
    this.exerciseMenuOpen.set(false);
    this.pickerOpen.set(true);
  }

  protected async picked(ids: readonly string[]): Promise<void> {
    if (this.pickerMode() === 'replace') {
      const target = this.menuExerciseId();
      const facts = this.factsFor(ids[0] ?? '');
      if (target !== null && facts) await this.store.replaceExercise(target, facts);
      return;
    }

    for (const id of ids) {
      const facts = this.factsFor(id);
      if (facts) await this.store.addExercise(facts);
    }
  }

  // -------------------------------------------------------------- rest timer

  protected startRest(): void {
    const focusId = this.store.focusSetId();
    const set = focusId === null ? undefined : this.store.setById(focusId);
    const exercise = set ? this.store.exerciseById(set.workoutExerciseId) : undefined;

    this.store.startRest(exercise?.restSec ?? this.settings.prefs().defaultRestSec, focusId);
    this.restOpen.set(true);
  }

  protected skipRest(): void {
    this.store.skipRest();
    this.restOpen.set(false);
  }

  // ------------------------------------------------------- pause and leaving

  protected async togglePause(): Promise<void> {
    if (this.store.isPaused()) await this.store.resumeSession();
    else await this.store.pause();
  }

  /**
   * What the route guard awaits.
   *
   * Resolves `true` only once the user has made a choice. There is no silent
   * exit: that is the whole point of UI_UX_SPEC's "leaving the screen is
   * impossible without an explicit choice".
   */
  canLeave(): Promise<boolean> {
    if (!this.store.hasSession() || this.store.isReadOnly()) {
      return Promise.resolve(true);
    }
    this.leaveOpen.set(true);
    return new Promise<boolean>((resolve) => {
      this.leaveResolver = resolve;
    });
  }

  protected resolveLeave(leave: boolean): void {
    this.leaveOpen.set(false);
    const resolve = this.leaveResolver;
    this.leaveResolver = null;
    resolve?.(leave);
  }

  protected async pauseAndLeave(): Promise<void> {
    await this.store.flushPending();
    await this.store.pause();
    this.resolveLeave(true);
  }

  protected discardFromLeave(): void {
    this.leaveOpen.set(false);
    this.discardOpen.set(true);
  }

  protected openDiscardFromMenu(): void {
    this.workoutMenuOpen.set(false);
    this.discardOpen.set(true);
  }

  protected async discard(): Promise<void> {
    await this.store.discard('user');
    this.resolveLeave(true);
    await this.router.navigate(['/train']);
  }

  protected leaveToTrain(): void {
    void this.router.navigate(['/train']);
  }

  // ------------------------------------------------------------------ finish

  protected async resumeThenFinish(): Promise<void> {
    await this.store.acceptResume();
    this.finishOpen.set(true);
  }

  protected async finish(): Promise<void> {
    try {
      const result = await this.store.finish();
      this.resolveLeave(true);
      await this.router.navigate(['/train/summary', result.workoutId]);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : this.i18n.t('state.error.title'));
    }
  }

  // ----------------------------------------------------------------- private

  private async loadPrevious(exerciseIds: readonly string[]): Promise<void> {
    const entries = await Promise.all(
      exerciseIds.map(async (id) => [id, await this.store.previousFor(id)] as const),
    );
    this.previous.set(new Map(entries));
  }

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

  /**
   * The last hooks before iOS can evict the page.
   *
   * `visibilitychange → hidden` and `pagehide` flush pending drafts;
   * `visibilitychange → visible` resyncs the clock, because a suspended tab's
   * timers may not have run. `beforeunload` is armed only while an unflushed
   * edit exists: Safari's dialog cannot be customised and is a backstop, not
   * the primary protection, so showing it when nothing is at risk would just
   * train the user to dismiss it.
   *
   * The honest limitation: a flush started on `pagehide` is asynchronous, and
   * the page can be killed before the transaction commits. That is the "at most
   * one in-flight edit" in the reliability contract — a confirmed set is
   * already written, so it is never the thing at risk.
   */
  private watchInterruptions(): void {
    const win = this.doc.defaultView;

    const onVisibility = (): void => {
      if (this.doc.visibilityState === 'hidden') void this.store.flushPending();
      else this.store.syncClock();
    };
    const onPageHide = (): void => {
      void this.store.flushPending();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!this.store.hasPendingWrites()) return;
      event.preventDefault();
    };

    this.doc.addEventListener('visibilitychange', onVisibility);
    win?.addEventListener('pagehide', onPageHide);
    win?.addEventListener('beforeunload', onBeforeUnload);

    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
      win?.removeEventListener('beforeunload', onBeforeUnload);
      void this.applyWakeLock(false);
    });
  }

  /**
   * A short tone when the rest ends.
   *
   * Synthesised rather than shipped as an audio file: it is two oscillator
   * beeps, and a bundled asset would cost more than it is worth. iOS only
   * allows audio after a user gesture, and the gesture that started this rest
   * was the set the user confirmed, so the context is already unlocked — but
   * the whole thing is best-effort and silent on failure. This is a foreground
   * cue only; the rest sheet says plainly that nothing can sound while the app
   * is backgrounded.
   */
  private playCompletionTone(): void {
    if (!this.settings.prefs().restTimerSound) return;

    try {
      const Ctor = (this.doc.defaultView as unknown as { AudioContext?: typeof AudioContext })
        ?.AudioContext;
      if (!Ctor) return;

      const context = new Ctor();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
      gain.connect(context.destination);

      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.12);
      oscillator.connect(gain);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);
      oscillator.onended = () => void context.close().catch(() => undefined);
    } catch {
      // Blocked autoplay, no Web Audio, or a suspended context. A missing
      // beep is not worth an error message.
    }
  }

  /**
   * Screen Wake Lock, behind feature detection.
   *
   * Absent before iOS 16.4 and in several browsers, and the request rejects if
   * the page is not visible. Both are expected, not errors, so neither is
   * surfaced — the app simply does not keep the screen awake, which is what
   * the rest sheet already says it cannot promise.
   */
  private async applyWakeLock(wanted: boolean): Promise<void> {
    const api = (
      this.doc.defaultView?.navigator as
        { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } } | undefined
    )?.wakeLock;
    if (!api) return;

    if (!wanted) {
      const held = this.wakeLock;
      this.wakeLock = null;
      await held?.release().catch(() => undefined);
      return;
    }

    if (this.wakeLock !== null) return;
    this.wakeLock = await api.request('screen').catch(() => null);
  }
}
