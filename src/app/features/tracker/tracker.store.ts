import { computed, effect, inject, Service, signal } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import { APP_META_STORE } from '../../data/app-meta';
import { CLOCK } from '../../data/clock';
import { TAB_IDENTITY } from '../../data/tab-id';
import { PR_DETECTOR } from '../../data/pr-detector';
import type { StoreName } from '../../data/stores';
import {
  MEASUREMENTS_REPO,
  ROUTINES_REPO,
  SET_LOGS_REPO,
  WORKOUTS_REPO,
  WORKOUT_EXERCISES_REPO,
} from '../../data/tokens';
import { UNIT_OF_WORK, type TxScope } from '../../data/unit-of-work';
import type { Draft, Patch } from '../../domain/models/entity';
import type { TrackingMode } from '../../domain/models/prefs';
import type { PersonalRecord } from '../../domain/models/records';
import type { Plan } from '../../domain/models/training';
import type { SetLog, Workout, WorkoutExercise } from '../../domain/models/workout';
import { moveWithin, nextOrderIndex, sortByOrder } from '../../domain/planner/ordering';
import { groupWithNext, normaliseSupersets, ungroup } from '../../domain/planner/supersets';
import { estimate1Rm } from '../../domain/strength/e1rm';
import { sessionTotals, setVolumeKg, type SessionTotals } from '../../domain/strength/volume';
import {
  currentFocus,
  focusAfter,
  sessionProgress,
  type FocusExercise,
} from '../../domain/tracker/focus';
import {
  adjustRest as adjustRestState,
  isRestDone,
  restElapsedSec,
  restProgress,
  restRemainingSec,
  type RestState,
} from '../../domain/tracker/rest';
import {
  planAdHoc,
  planFromRoutine,
  renumber,
  warmupWeightKg,
  type ExerciseFacts,
  type PlannedExercise,
} from '../../domain/tracker/session';
import { activeSeconds } from '../../domain/time/duration';
import { dayKeyAt } from '../../domain/time/day-key';
import { SerialQueue } from '../../domain/async/serial-queue';
import { PreviousPerformanceLookup } from './previous-performance.service';

/** Debounce windows from docs/ARCHITECTURE.md section 7.2. */
const DRAFT_DEBOUNCE_MS = 400;
const NOTE_DEBOUNCE_MS = 600;

/** Heartbeat cadence, and the age at which another tab may take over. */
const HEARTBEAT_MS = 15_000;
const STALE_HEARTBEAT_MS = 45_000;

/** Tick cadence: fast enough for a countdown, slow enough to be free. */
const TICK_RESTING_MS = 250;
const TICK_IDLE_MS = 1000;

/** Fields whose edits are notes rather than numbers, and debounce slower. */
const SLOW_FIELDS: readonly (keyof SetLog)[] = ['notes', 'rpe', 'rir'];

/** One exercise and its rows, assembled for the view. */
export interface SessionCard {
  exercise: WorkoutExercise;
  sets: SetLog[];
  completedCount: number;
}

export interface SessionBlock {
  group: string | null;
  cards: SessionCard[];
}

export interface FinishResult {
  workoutId: string;
  totals: SessionTotals;
  durationSec: number;
  /** Rows that were never confirmed and so were not written into history. */
  droppedSetCount: number;
  records: PersonalRecord[];
}

export type StartSource = 'routine' | 'quick' | 'repeat';

/** Stores touched when finishing. Declared once; the list is load-bearing. */
const FINISH_STORES: readonly StoreName[] = [
  'workouts',
  'workoutExercises',
  'setLogs',
  'personalRecords',
  'appMeta',
];

/**
 * The active workout.
 *
 * The reliability contract this class exists to keep (docs/ARCHITECTURE.md
 * section 7): *a set the user has confirmed survives an app kill, a Safari tab
 * purge, an iOS memory reclaim and a cold boot, losing at most the one edit
 * still in flight.*
 *
 * Four things make that true, and each is here rather than in a component:
 *
 *   1. **No shadow state.** The live session is an ordinary `workouts` record
 *      with `status: 'active'`, plus its real `workoutExercises` and `setLogs`.
 *      Recovery is "read the pointer", not "replay a journal" (section 7.1).
 *   2. **Confirm writes before it shows.** A row renders as committed only from
 *      inside `onCommit`, so the tick the user sees is a fact about the disk.
 *   3. **One write at a time.** Every mutation goes through a serial lane, so a
 *      burst of taps cannot interleave two read-modify-write cycles and lose
 *      one of them (section 7.2).
 *   4. **Timestamps, never counters.** Duration and rest are computed from
 *      stored instants on every read, so a suspended tab cannot drift
 *      (section 7.3).
 */
@Service()
export class TrackerStore {
  private readonly workoutsRepo = inject(WORKOUTS_REPO);
  private readonly exercisesRepo = inject(WORKOUT_EXERCISES_REPO);
  private readonly setsRepo = inject(SET_LOGS_REPO);
  private readonly routinesRepo = inject(ROUTINES_REPO);
  private readonly measurementsRepo = inject(MEASUREMENTS_REPO);
  private readonly appMeta = inject(APP_META_STORE);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly clock = inject(CLOCK);
  private readonly settings = inject(SettingsStore);
  private readonly prDetector = inject(PR_DETECTOR);
  private readonly previous = inject(PreviousPerformanceLookup);

  /**
   * Identifies this tab for the multi-tab guard (section 7.4).
   *
   * Stable across a reload of this tab, which is the whole point: a fresh id
   * every load would make a refresh look like a second tab.
   */
  private readonly tabId = inject(TAB_IDENTITY).tabId;
  private readonly lane = new SerialQueue();

  /** Accumulated debounced edits, per set, with their pending timer. */
  private readonly drafts = new Map<string, Patch<SetLog>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  private readonly _workout = signal<Workout | null>(null);
  private readonly _exercises = signal<WorkoutExercise[]>([]);
  private readonly _sets = signal<SetLog[]>([]);
  private readonly _rest = signal<RestState | null>(null);
  private readonly _nowMs = signal(this.clock.now());
  private readonly _expandedId = signal<string | null>(null);
  private readonly _focusSetId = signal<string | null>(null);
  private readonly _readOnly = signal(false);
  private readonly _awaitingResumeChoice = signal(false);
  private readonly _restAcknowledged = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Mirror of `drafts.size`, because a Map cannot be depended on reactively. */
  private readonly _pendingWrites = signal(0);
  private readonly _lastFinish = signal<FinishResult | null>(null);

  readonly workout = this._workout.asReadonly();
  readonly rest = this._rest.asReadonly();
  readonly expandedId = this._expandedId.asReadonly();
  readonly isLoading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Another tab owns this session; this one renders but must not write. */
  readonly isReadOnly = this._readOnly.asReadonly();

  /**
   * The outcome of the last `finish()`.
   *
   * Kept so the summary screen can state how many unconfirmed rows were
   * dropped — a fact about the transaction, not about the saved workout, so
   * there is nothing in the record to read it back from.
   */
  readonly lastFinish = this._lastFinish.asReadonly();

  /**
   * A session was recovered from the pointer and the user has not yet chosen
   * what to do with it. Nothing resumes or discards on its own (section 7.4).
   */
  readonly awaitingResumeChoice = this._awaitingResumeChoice.asReadonly();

  readonly hasSession = computed(() => this._workout() !== null);
  readonly isPaused = computed(() => this._workout()?.status === 'paused');
  readonly trackingMode = computed<TrackingMode>(
    () => this._workout()?.trackingMode ?? this.settings.trackingMode(),
  );
  readonly isAdvanced = computed(() => this.trackingMode() === 'advanced');

  /** Exercises in order, each with its rows. The view's single source. */
  readonly cards = computed<SessionCard[]>(() => {
    const sets = this._sets();
    return sortByOrder(this._exercises()).map((exercise) => {
      const own = sets
        .filter((set) => set.workoutExerciseId === exercise.id)
        .sort((a, b) => a.setIndex - b.setIndex);
      return {
        exercise,
        sets: own,
        completedCount: own.filter((set) => set.isCompleted).length,
      };
    });
  });

  /** Cards grouped into supersets, so a bracket can be drawn around a run. */
  readonly blocks = computed<SessionBlock[]>(() => {
    const blocks: SessionBlock[] = [];
    for (const card of this.cards()) {
      const last = blocks.at(-1);
      const group = card.exercise.supersetGroup;
      if (group !== null && last?.group === group) last.cards.push(card);
      else blocks.push({ group, cards: [card] });
    }
    return blocks;
  });

  private readonly focusModel = computed<FocusExercise[]>(() =>
    this.cards().map((card) => ({
      id: card.exercise.id,
      supersetGroup: card.exercise.supersetGroup,
      isSkipped: card.exercise.isSkipped,
      sets: card.sets.map((set) => ({ id: set.id, isCompleted: set.isCompleted })),
    })),
  );

  /**
   * The one current row.
   *
   * An explicit choice wins while it is still pending — the user tapping a row
   * means they want that row. Once it is confirmed the derived rule takes over,
   * so focus is never left pointing at finished work.
   */
  readonly focusSetId = computed<string | null>(() => {
    const chosen = this._focusSetId();
    if (chosen !== null) {
      const set = this._sets().find((candidate) => candidate.id === chosen);
      if (set && !set.isCompleted) return chosen;
    }
    return currentFocus(this.focusModel())?.setId ?? null;
  });

  readonly progress = computed(() => sessionProgress(this.focusModel()));

  readonly exerciseCount = computed(
    () => this.cards().filter((card) => !card.exercise.isSkipped).length,
  );

  /** Elapsed working time, pauses excluded, recomputed from stored instants. */
  readonly elapsedSec = computed(() => {
    const workout = this._workout();
    if (!workout) return 0;
    return activeSeconds(workout.startedAt, workout.pauses, new Date(this._nowMs()).toISOString());
  });

  readonly completedSetCount = computed(() => this._sets().filter((set) => set.isCompleted).length);

  readonly liveTotals = computed(() =>
    sessionTotals(this._sets().map((set) => this.volumeInputFor(set))),
  );

  readonly restRemainingSec = computed(() => {
    const rest = this._rest();
    return rest === null ? 0 : restRemainingSec(rest, this._nowMs());
  });

  readonly restProgress = computed(() => {
    const rest = this._rest();
    return rest === null ? 0 : restProgress(rest, this._nowMs());
  });

  readonly isResting = computed(() => {
    const rest = this._rest();
    return rest !== null && !isRestDone(rest, this._nowMs());
  });

  /** True for the moment between the rest elapsing and the user acknowledging it. */
  readonly restJustFinished = computed(() => {
    const rest = this._rest();
    return rest !== null && isRestDone(rest, this._nowMs()) && !this._restAcknowledged();
  });

  /** The row the current rest is counting down for. */
  readonly restNextSetId = computed(() => this._rest()?.setId ?? null);

  /**
   * Unflushed edits exist, so `beforeunload` should be armed (section 7.4).
   *
   * Backed by a signal rather than read off `drafts.size`: a plain Map is not
   * reactive, so a computed over it would memoise the first answer and the
   * unload guard would arm, or fail to arm, based on stale information.
   */
  readonly hasPendingWrites = computed(() => this._pendingWrites() > 0);

  constructor() {
    effect(() => {
      // Ticking only while a session is live, and faster only while resting:
      // a countdown needs sub-second refresh, an elapsed clock does not.
      const live = this.hasSession() && !this.isReadOnly();
      const interval = live ? (this._rest() !== null ? TICK_RESTING_MS : TICK_IDLE_MS) : null;
      this.restartTicker(interval);
      this.restartHeartbeat(live && !this.isPaused());
    });
  }

  // ----------------------------------------------------------------- loading

  /**
   * Picks up whatever `appMeta.activeWorkoutId` points at.
   *
   * Never resumes on its own: a *recovered* session sets
   * `awaitingResumeChoice` and waits for Resume / Finish / Discard. Silently
   * continuing a session the user abandoned yesterday would corrupt its
   * duration and its intent.
   *
   * Recovered means "found, not started here". A session this instance already
   * holds is not a recovery, and asking about it would be absurd — the Train
   * screen loads in the background while the user starts a workout, and a
   * slower device would otherwise land them on "Resume your workout?" for the
   * one they just began.
   */
  async loadActive(): Promise<boolean> {
    if (this._loading()) return this.hasSession();
    this._loading.set(true);
    this._error.set(null);

    try {
      const activeId = await this.appMeta.get('activeWorkoutId');
      if (activeId !== null && this._workout()?.id === activeId) {
        return true;
      }
      if (activeId === null) {
        this.reset();
        return false;
      }

      const workout = await this.workoutsRepo.get(activeId);
      if (!workout || (workout.status !== 'active' && workout.status !== 'paused')) {
        // A dangling pointer is a bug, not a session. Clear it rather than
        // leaving the user with a workout they can never open or dismiss.
        await this.appMeta.patch({ activeWorkoutId: null, activeRest: null });
        this.reset();
        return false;
      }

      await this.hydrate(workout);

      const rest = await this.appMeta.get('activeRest');
      this._rest.set(rest);
      // A rest that elapsed while the app was closed is not news: restore it
      // already acknowledged, so coming back does not fire a completion cue
      // for something that finished hours ago.
      this._restAcknowledged.set(rest !== null && isRestDone(rest, this.clock.now()));
      this._awaitingResumeChoice.set(true);
      this.claimOrObserve(workout);
      this.syncClock();
      return true;
    } catch (error) {
      this._error.set(message(error, 'Could not open the active workout'));
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Recomputes every derived time from the clock.
   *
   * Called on `visibilitychange → visible`. While a tab is hidden iOS throttles
   * or suspends the ticker, so the first thing to do on coming back is ask the
   * clock rather than trust anything that was supposed to have been counting.
   * Because duration and rest are stored as instants, one read is enough.
   */
  syncClock(): void {
    this._nowMs.set(this.clock.now());
  }

  /** Accepts a recovered session and keeps training it. */
  async acceptResume(): Promise<void> {
    this._awaitingResumeChoice.set(false);
    const workout = this._workout();
    if (workout && workout.status === 'paused') {
      await this.resumeSession();
    }
  }

  // ---------------------------------------------------------------- starting

  /** Starts a session from a routine, freezing its plan into the record. */
  async startFromRoutine(
    routineId: string,
    options: {
      facts: (exerciseId: string) => ExerciseFacts | undefined;
      skipUids?: ReadonlySet<string>;
      plan?: Plan | null;
    } = {
      facts: () => undefined,
    },
  ): Promise<string> {
    const routine = await this.routinesRepo.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} no longer exists`);
    }

    const planned = planFromRoutine(routine.exercises, {
      facts: options.facts,
      defaultRestSec: this.settings.prefs().defaultRestSec,
      ...(options.skipUids ? { skipUids: options.skipUids } : {}),
    });

    return this.create({
      name: routine.name,
      source: 'routine',
      planId: routine.planId,
      routineId: routine.id,
      planSnapshot: {
        planId: routine.planId,
        planName: options.plan?.name ?? null,
        routineId: routine.id,
        routineName: routine.name,
        routineRevision: routine.revision,
        scheduleType: routine.scheduleType,
      },
      planned,
    });
  }

  /** An empty session the user fills as they go. */
  async startQuick(name: string): Promise<string> {
    return this.create({
      name,
      source: 'quick',
      planId: null,
      routineId: null,
      planSnapshot: null,
      planned: [],
    });
  }

  /**
   * Clones a past session's **structure**, never its loads.
   *
   * Repeating a workout means doing the same exercises, not claiming the same
   * numbers; every row starts empty so the user logs what they actually lift.
   */
  async startFromWorkout(workoutId: string): Promise<string> {
    const source = await this.workoutsRepo.get(workoutId);
    if (!source) {
      throw new Error(`Workout ${workoutId} no longer exists`);
    }

    const exercises = sortByOrder(
      await this.exercisesRepo.list({ index: 'by_workoutId', equals: workoutId }),
    );
    const sets = await this.setsRepo.list({ index: 'by_workoutId', equals: workoutId });

    const planned: PlannedExercise[] = exercises.map((exercise, index) => {
      const own = sets.filter((set) => set.workoutExerciseId === exercise.id);
      const working = own.filter((set) => set.setType !== 'warmup');
      const count = Math.max(1, working.length);

      return {
        exerciseId: exercise.exerciseId,
        variantKey: exercise.variantKey,
        nameSnapshot: exercise.nameSnapshot,
        routineExerciseUid: exercise.routineExerciseUid,
        orderIndex: (index + 1) * 1000,
        supersetGroup: exercise.supersetGroup,
        supersetOrder: exercise.supersetOrder,
        targetSnapshot: exercise.targetSnapshot,
        loadType: exercise.loadType,
        laterality: exercise.laterality,
        restSec: exercise.restSec,
        isSkipped: false,
        sets: Array.from({ length: count }, (_, setIndex) => ({
          setIndex,
          setType: 'working' as const,
          side: working[setIndex]?.side ?? 'both',
          weightKg: null,
          reps: null,
        })),
      };
    });

    return this.create({
      name: source.name,
      source: 'repeat',
      planId: source.planId,
      routineId: source.routineId,
      planSnapshot: source.planSnapshot,
      planned,
    });
  }

  private async create(input: {
    name: string;
    source: StartSource;
    planId: string | null;
    routineId: string | null;
    planSnapshot: Workout['planSnapshot'];
    planned: readonly PlannedExercise[];
  }): Promise<string> {
    const startedAt = this.clock.nowIso();
    const dayKey = this.today();
    const bodyWeightKg = await this.nearestBodyWeightKg();

    return this.lane.run(() =>
      this.uow.run(
        ['workouts', 'workoutExercises', 'setLogs', 'appMeta'],
        'readwrite',
        async (tx) => {
          const existing = await tx.appMeta().get('activeWorkoutId');
          if (existing !== null) {
            // The invariant from DATABASE_SPEC section 3.6: at most one live
            // session. Refusing here, inside the transaction, is the only
            // place a concurrent second start can be caught.
            throw new Error('A workout is already in progress');
          }

          const workout = await tx.repo('workouts').put({
            status: 'active',
            startedAt,
            finishedAt: null,
            dayKey,
            name: input.name,
            planId: input.planId,
            routineId: input.routineId,
            planSnapshot: input.planSnapshot,
            source: input.source,
            pauses: [],
            durationSec: 0,
            totalVolumeKg: 0,
            totalSets: 0,
            totalReps: 0,
            exerciseCount: input.planned.filter((item) => !item.isSkipped).length,
            bodyWeightKg,
            notes: null,
            perceivedEffort: null,
            feeling: null,
            prCount: 0,
            trackingMode: this.settings.trackingMode(),
            tabId: this.tabId,
            heartbeatAt: startedAt,
            discardedReason: null,
            editedAt: null,
          } satisfies Draft<Workout>);

          const exercises: WorkoutExercise[] = [];
          const sets: SetLog[] = [];

          for (const item of input.planned) {
            const exercise = await tx.repo('workoutExercises').put({
              workoutId: workout.id,
              exerciseId: item.exerciseId,
              variantKey: item.variantKey,
              nameSnapshot: item.nameSnapshot,
              routineExerciseUid: item.routineExerciseUid,
              startedAt,
              dayKey,
              orderIndex: item.orderIndex,
              supersetGroup: item.supersetGroup,
              supersetOrder: item.supersetOrder,
              targetSnapshot: item.targetSnapshot,
              loadType: item.loadType,
              laterality: item.laterality,
              restSec: item.restSec,
              notes: null,
              isSkipped: item.isSkipped,
              completedSetCount: 0,
              volumeKg: 0,
            } satisfies Draft<WorkoutExercise>);
            exercises.push(exercise);

            for (const planned of item.sets) {
              sets.push(
                await tx.repo('setLogs').put(
                  this.setDraft(workout, exercise, {
                    setIndex: planned.setIndex,
                    setType: planned.setType,
                    side: planned.side,
                    weightKg: planned.weightKg,
                    reps: planned.reps,
                  }),
                ),
              );
            }
          }

          await tx.appMeta().set('activeWorkoutId', workout.id);
          await tx.appMeta().set('activeRest', null);

          tx.onCommit(() => {
            this.previous.clear();
            this._workout.set(workout);
            this._exercises.set(exercises);
            this._sets.set(sets);
            this._rest.set(null);
            this._readOnly.set(false);
            this._awaitingResumeChoice.set(false);
            this._focusSetId.set(null);
            this._expandedId.set(exercises.find((item) => !item.isSkipped)?.id ?? null);
            this._error.set(null);
          });

          return workout.id;
        },
      ),
    );
  }

  // --------------------------------------------------------------------- view

  expand(exerciseId: string | null): void {
    this._expandedId.set(exerciseId);
  }

  focusSet(setId: string): void {
    this._focusSetId.set(setId);
    this._expandedId.set(
      this._sets().find((set) => set.id === setId)?.workoutExerciseId ?? this._expandedId(),
    );
  }

  setById(setId: string): SetLog | undefined {
    return this._sets().find((set) => set.id === setId);
  }

  exerciseById(id: string): WorkoutExercise | undefined {
    return this._exercises().find((exercise) => exercise.id === id);
  }

  /** "Last time" for one slot, variant-scoped. `null` means no history. */
  async previousFor(exerciseId: string) {
    const exercise = this.exerciseById(exerciseId);
    const workout = this._workout();
    if (!exercise || !workout) return null;
    return this.previous.forVariant(exercise.exerciseId, exercise.variantKey, workout.startedAt);
  }

  // ------------------------------------------------------------------- edits

  /**
   * Records an in-progress edit.
   *
   * The signal moves at once so typing feels immediate, and the write is
   * debounced into a draft row that keeps `isCompleted: false`. The value is
   * therefore on disk within 400 ms of the last keystroke, and immediately on
   * `visibilitychange` or `pagehide`, without a transaction per character.
   */
  editSet(setId: string, changes: Patch<SetLog>): void {
    if (this._readOnly()) return;

    this.patchSetLocally(setId, changes);
    this.drafts.set(setId, { ...this.drafts.get(setId), ...changes });
    this._pendingWrites.set(this.drafts.size);

    const slow = Object.keys(changes).some((key) => SLOW_FIELDS.includes(key as keyof SetLog));
    const existing = this.timers.get(setId);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(
      setId,
      setTimeout(() => void this.flushSet(setId), slow ? NOTE_DEBOUNCE_MS : DRAFT_DEBOUNCE_MS),
    );
  }

  /** Writes every outstanding draft now. The last hook before eviction. */
  async flushPending(): Promise<void> {
    const ids = [...this.drafts.keys()];
    await Promise.all(ids.map((id) => this.flushSet(id)));
    await this.lane.drain();
  }

  private async flushSet(setId: string): Promise<void> {
    const timer = this.timers.get(setId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(setId);
    }

    const changes = this.drafts.get(setId);
    if (!changes) return;
    this.drafts.delete(setId);
    this._pendingWrites.set(this.drafts.size);

    await this.write((tx) => this.persistSet(tx, setId, changes));
  }

  // ---------------------------------------------------------- confirming sets

  /**
   * Confirms a set.
   *
   * The row becomes "committed" only inside `onCommit`, so the tick the user
   * sees always means the row is on disk. Volume and estimated 1RM are computed
   * here and stored, because a chart should not have to re-derive them — and
   * both are `null` rather than fabricated when they are not computable.
   */
  async confirmSet(setId: string): Promise<void> {
    if (this._readOnly()) return;

    const pendingDraft = this.drafts.get(setId);
    this.drafts.delete(setId);
    this._pendingWrites.set(this.drafts.size);
    const timer = this.timers.get(setId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(setId);
    }

    const restTakenSec = this.restTakenForNextSet();

    await this.write(async (tx) => {
      const set = this.setById(setId);
      const exercise = set ? this.exerciseById(set.workoutExerciseId) : undefined;
      const workout = this._workout();
      if (!set || !exercise || !workout) return;

      const merged = { ...set, ...pendingDraft };
      const completedAt = this.clock.nowIso();
      const volumeKg = setVolumeKg({
        loadType: exercise.loadType,
        weightKg: merged.weightKg,
        extraWeightKg: merged.extraWeightKg,
        bodyWeightKg: workout.bodyWeightKg,
        setType: merged.setType,
        reps: merged.reps,
        isCompleted: true,
      });

      // Estimates only come from external load: an e1RM derived from an
      // unknown body weight would be a number with no basis.
      const e1rm =
        exercise.loadType === 'external'
          ? estimate1Rm(merged.weightKg, merged.reps, this.settings.prefs().e1rmFormula)
          : null;

      await this.persistSet(tx, setId, {
        ...pendingDraft,
        isCompleted: true,
        completedAt,
        volumeKg,
        e1rmKg: e1rm?.value ?? null,
        restTakenSec,
      });

      tx.onCommit(() => {
        this.afterConfirm(exercise.id, exercise.restSec);
      });
    });
  }

  /** Reverts a confirmed row, keeping the values the user entered. */
  async unconfirmSet(setId: string): Promise<void> {
    if (this._readOnly()) return;
    await this.write((tx) =>
      this.persistSet(tx, setId, {
        isCompleted: false,
        completedAt: null,
        volumeKg: null,
        e1rmKg: null,
        isPr: false,
      }),
    );
  }

  /**
   * Writes one set and refreshes its exercise's rollups in the same transaction.
   *
   * The rollups are recomputed from the rows **as the transaction sees them**,
   * not from the in-memory copy: read-your-writes inside the transaction makes
   * that authoritative, and it keeps a stale signal from ever becoming a stale
   * number on disk.
   */
  private async persistSet(tx: TxScope, setId: string, changes: Patch<SetLog>): Promise<void> {
    const sets = tx.repo('setLogs');
    const existing = await sets.get(setId);
    if (!existing) return;

    const updated = await sets.patch(setId, changes);
    await this.refreshRollups(tx, updated.workoutExerciseId);

    tx.onCommit(() => {
      this.cacheSet(updated);
    });
  }

  private async refreshRollups(tx: TxScope, workoutExerciseId: string): Promise<void> {
    const exercise = await tx.repo('workoutExercises').get(workoutExerciseId);
    if (!exercise) return;

    const rows = await tx
      .repo('setLogs')
      .list({ index: 'by_workoutExerciseId', equals: workoutExerciseId });
    const workout = this._workout();

    const totals = sessionTotals(
      rows.map((set) => ({
        loadType: exercise.loadType,
        weightKg: set.weightKg,
        extraWeightKg: set.extraWeightKg,
        bodyWeightKg: workout?.bodyWeightKg ?? null,
        setType: set.setType,
        reps: set.reps,
        isCompleted: set.isCompleted,
      })),
    );

    const updated = await tx.repo('workoutExercises').patch(workoutExerciseId, {
      completedSetCount: rows.filter((set) => set.isCompleted).length,
      volumeKg: totals.totalVolumeKg,
    });
    tx.onCommit(() => this.cacheExercise(updated));
  }

  // ------------------------------------------------------------------- rows

  /** Appends a row, prefilled from the last working set of the same exercise. */
  async addSet(exerciseId: string): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const workout = this._workout();
      const exercise = this.exerciseById(exerciseId);
      if (!workout || !exercise) return;

      const own = this.setsFor(exerciseId);
      const lastWorking = [...own].reverse().find((set) => set.setType !== 'warmup');

      const created = await tx.repo('setLogs').put(
        this.setDraft(workout, exercise, {
          setIndex: own.length,
          setType: 'working',
          side: lastWorking?.side ?? 'both',
          weightKg: lastWorking?.weightKg ?? null,
          reps: lastWorking?.reps ?? null,
        }),
      );

      await this.refreshRollups(tx, exerciseId);
      tx.onCommit(() => {
        this._sets.update((sets) => [...sets, created]);
        this._focusSetId.set(created.id);
      });
    });
  }

  /**
   * Inserts a warm-up row above the working sets.
   *
   * Prefilled with half the first working load, which is a starting point and
   * is shown as an editable value, not applied as advice.
   */
  async addWarmup(exerciseId: string): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const workout = this._workout();
      const exercise = this.exerciseById(exerciseId);
      if (!workout || !exercise) return;

      const own = this.setsFor(exerciseId);
      const firstWorking = own.find((set) => set.setType !== 'warmup');
      const warmupCount = own.filter((set) => set.setType === 'warmup').length;

      const created = await tx.repo('setLogs').put(
        this.setDraft(workout, exercise, {
          setIndex: warmupCount,
          setType: 'warmup',
          side: firstWorking?.side ?? 'both',
          weightKg: warmupWeightKg(firstWorking?.weightKg ?? null),
          reps: null,
        }),
      );

      // Inserting above the working sets shifts everything below it down.
      // Renumbering the whole list rather than adding one to each tail index
      // also repairs a gap, if an earlier delete ever left one.
      const byId = new Map<string, SetLog>([...own.map((set) => [set.id, set] as const)]);
      const persisted: SetLog[] = [];
      for (const set of renumber([
        ...own.slice(0, warmupCount),
        created,
        ...own.slice(warmupCount),
      ])) {
        const before = set.id === created.id ? created : byId.get(set.id);
        persisted.push(
          before && before.setIndex === set.setIndex
            ? before
            : await tx.repo('setLogs').patch(set.id, { setIndex: set.setIndex }),
        );
      }

      await this.refreshRollups(tx, exerciseId);
      tx.onCommit(() => {
        this._sets.update((sets) => [
          ...sets.filter((set) => set.workoutExerciseId !== exerciseId),
          ...persisted,
        ]);
        this._focusSetId.set(created.id);
      });
    });
  }

  /** Soft-deletes a row, so the undo toast has something to restore. */
  async deleteSet(setId: string): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const set = this.setById(setId);
      if (!set) return;

      await tx.repo('setLogs').remove(setId);
      await this.refreshRollups(tx, set.workoutExerciseId);
      tx.onCommit(() => {
        this._sets.update((sets) => sets.filter((candidate) => candidate.id !== setId));
      });
    });
  }

  /** Undo for `deleteSet`: reaches past the tombstone on purpose. */
  async restoreSet(setId: string): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const sets = tx.repo('setLogs');
      const tombstoned = await sets.get(setId, { includeDeleted: true });
      if (!tombstoned) return;

      const restored = await sets.put({ ...tombstoned, deletedAt: null });
      await this.refreshRollups(tx, restored.workoutExerciseId);
      tx.onCommit(() => {
        this._sets.update((current) => [...current, restored]);
      });
    });
  }

  // --------------------------------------------------------------- exercises

  /** Adds an exercise to the session in progress. */
  async addExercise(facts: ExerciseFacts): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const workout = this._workout();
      if (!workout) return;

      const planned = planAdHoc(facts, {
        orderIndex: nextOrderIndex(this._exercises()),
        defaultRestSec: this.settings.prefs().defaultRestSec,
      });

      const exercise = await tx.repo('workoutExercises').put({
        workoutId: workout.id,
        exerciseId: planned.exerciseId,
        variantKey: planned.variantKey,
        nameSnapshot: planned.nameSnapshot,
        routineExerciseUid: null,
        startedAt: workout.startedAt,
        dayKey: workout.dayKey,
        orderIndex: planned.orderIndex,
        supersetGroup: null,
        supersetOrder: null,
        targetSnapshot: null,
        loadType: planned.loadType,
        laterality: planned.laterality,
        restSec: planned.restSec,
        notes: null,
        isSkipped: false,
        completedSetCount: 0,
        volumeKg: 0,
      } satisfies Draft<WorkoutExercise>);

      const created: SetLog[] = [];
      for (const set of planned.sets) {
        created.push(
          await tx.repo('setLogs').put(
            this.setDraft(workout, exercise, {
              setIndex: set.setIndex,
              setType: set.setType,
              side: set.side,
              weightKg: null,
              reps: null,
            }),
          ),
        );
      }

      tx.onCommit(() => {
        this._exercises.update((list) => [...list, exercise]);
        this._sets.update((list) => [...list, ...created]);
        this._expandedId.set(exercise.id);
      });
    });
  }

  /**
   * Marks a slot skipped for today without removing it.
   *
   * The plan asked for it, and history should show that it was planned and not
   * done — deleting the row would erase the intent along with the omission.
   */
  async skipExercise(exerciseId: string, isSkipped: boolean): Promise<void> {
    await this.patchExercise(exerciseId, { isSkipped });
  }

  /**
   * Swaps the exercise in a slot.
   *
   * Everything that identifies the performance — exercise id, variant key,
   * name, load type — moves to the exercise actually performed, so history is
   * attributed correctly. Confirmed rows are re-stamped for the same reason.
   */
  async replaceExercise(exerciseId: string, facts: ExerciseFacts): Promise<void> {
    if (this._readOnly()) return;

    await this.write(async (tx) => {
      const exercise = await tx.repo('workoutExercises').get(exerciseId);
      if (!exercise) return;

      const updated = await tx.repo('workoutExercises').patch(exerciseId, {
        exerciseId: facts.exerciseId,
        variantKey: facts.variantKey,
        nameSnapshot: facts.name,
        loadType: facts.loadType,
        laterality: facts.laterality,
        // The old slot's target no longer describes this exercise.
        targetSnapshot: null,
        routineExerciseUid: null,
      });

      const rows = await tx
        .repo('setLogs')
        .list({ index: 'by_workoutExerciseId', equals: exerciseId });
      const restamped: SetLog[] = [];
      for (const row of rows) {
        restamped.push(
          await tx
            .repo('setLogs')
            .patch(row.id, { exerciseId: facts.exerciseId, variantKey: facts.variantKey }),
        );
      }

      await this.refreshRollups(tx, exerciseId);
      tx.onCommit(() => {
        this.cacheExercise(updated);
        this._sets.update((sets) => [
          ...sets.filter((set) => set.workoutExerciseId !== exerciseId),
          ...restamped,
        ]);
      });
    });
  }

  async moveExercise(fromIndex: number, toIndex: number): Promise<void> {
    if (this._readOnly()) return;

    const ordered = sortByOrder(this._exercises());
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= ordered.length) return;

    // Normalising after the move is what dissolves a superset the move broke
    // apart, rather than leaving a bracket spanning an exercise in between.
    await this.persistExerciseOrder(normaliseSupersets(moveWithin(ordered, fromIndex, toIndex)));
  }

  async groupExerciseWithNext(exerciseId: string): Promise<void> {
    if (this._readOnly()) return;
    await this.persistExerciseOrder(
      groupWithNext(sortByOrder(this._exercises()), (exercise) => exercise.id === exerciseId),
    );
  }

  async ungroupExercise(exerciseId: string): Promise<void> {
    if (this._readOnly()) return;
    await this.persistExerciseOrder(
      ungroup(sortByOrder(this._exercises()), (exercise) => exercise.id === exerciseId),
    );
  }

  private async persistExerciseOrder(next: readonly WorkoutExercise[]): Promise<void> {
    await this.write(async (tx) => {
      const updated: WorkoutExercise[] = [];
      for (const exercise of next) {
        const current = this.exerciseById(exercise.id);
        if (
          current &&
          current.orderIndex === exercise.orderIndex &&
          current.supersetGroup === exercise.supersetGroup &&
          current.supersetOrder === exercise.supersetOrder
        ) {
          updated.push(current);
          continue;
        }
        updated.push(
          await tx.repo('workoutExercises').patch(exercise.id, {
            orderIndex: exercise.orderIndex,
            supersetGroup: exercise.supersetGroup,
            supersetOrder: exercise.supersetOrder,
          }),
        );
      }
      tx.onCommit(() => this._exercises.set(updated));
    });
  }

  private async patchExercise(exerciseId: string, changes: Patch<WorkoutExercise>): Promise<void> {
    if (this._readOnly()) return;
    await this.write(async (tx) => {
      const updated = await tx.repo('workoutExercises').patch(exerciseId, changes);
      tx.onCommit(() => this.cacheExercise(updated));
    });
  }

  // -------------------------------------------------------------- rest timer

  /** Starts a rest, stored as a timestamp and a target. */
  startRest(targetSec: number, forSetId: string | null = null): void {
    if (this._readOnly()) return;

    const rest: RestState = {
      startedAtMs: this.clock.now(),
      targetSec: Math.max(0, Math.round(targetSec)),
      exerciseId: forSetId === null ? null : (this.setById(forSetId)?.workoutExerciseId ?? null),
      setId: forSetId,
    };
    this._rest.set(rest);
    this._restAcknowledged.set(false);
    this._nowMs.set(this.clock.now());
    void this.persistRest(rest);
  }

  adjustRest(deltaSec: number): void {
    const rest = this._rest();
    if (rest === null || this._readOnly()) return;

    const next = adjustRestState(rest, deltaSec, this.clock.now());
    this._rest.set(next);
    this._restAcknowledged.set(false);
    void this.persistRest(next);
  }

  /** Ends the rest. Also how the completion cue is dismissed. */
  skipRest(): void {
    if (this._rest() === null) return;
    this._rest.set(null);
    this._restAcknowledged.set(true);
    void this.persistRest(null);
  }

  acknowledgeRest(): void {
    this._restAcknowledged.set(true);
  }

  private persistRest(rest: RestState | null): Promise<void> {
    if (this._readOnly()) return Promise.resolve();
    return this.lane.run(() => this.appMeta.set('activeRest', rest));
  }

  /** Measured rest for the set about to be confirmed, or `null` if none ran. */
  private restTakenForNextSet(): number | null {
    const rest = this._rest();
    return rest === null ? null : restElapsedSec(rest, this.clock.now());
  }

  // ------------------------------------------------------------ pause/resume

  async pause(): Promise<void> {
    if (this._readOnly()) return;
    const workout = this._workout();
    if (!workout || workout.status === 'paused') return;

    const at = this.clock.nowIso();
    await this.write(async (tx) => {
      const updated = await tx.repo('workouts').patch(workout.id, {
        status: 'paused',
        pauses: [...workout.pauses, { at, until: null }],
        durationSec: this.elapsedSec(),
      });
      tx.onCommit(() => this._workout.set(updated));
    });
  }

  async resumeSession(): Promise<void> {
    if (this._readOnly()) return;
    const workout = this._workout();
    if (!workout || workout.status !== 'paused') return;

    const until = this.clock.nowIso();
    const pauses = workout.pauses.map((pause, index) =>
      index === workout.pauses.length - 1 && pause.until === null ? { ...pause, until } : pause,
    );

    await this.write(async (tx) => {
      const updated = await tx.repo('workouts').patch(workout.id, { status: 'active', pauses });
      tx.onCommit(() => this._workout.set(updated));
    });
  }

  async setTrackingMode(mode: TrackingMode): Promise<void> {
    this.settings.set('trackingMode', mode);
    const workout = this._workout();
    if (!workout || this._readOnly()) return;

    await this.write(async (tx) => {
      const updated = await tx.repo('workouts').patch(workout.id, { trackingMode: mode });
      tx.onCommit(() => this._workout.set(updated));
    });
  }

  async setNotes(notes: string | null, feeling: Workout['feeling'] = null): Promise<void> {
    const workout = this._workout();
    if (!workout) return;
    await this.write(async (tx) => {
      const updated = await tx
        .repo('workouts')
        .patch(workout.id, { notes, ...(feeling === null ? {} : { feeling }) });
      tx.onCommit(() => this._workout.set(updated));
    });
  }

  // ------------------------------------------------------------------ finish

  /**
   * Finishes the session in a single transaction (section 7.5).
   *
   * Everything happens together: unlogged rows go, rollups are computed, the
   * status flips, records are detected, and the active pointer is cleared. If
   * record detection throws, the whole thing rolls back and the session is
   * still active with every set intact — a bug in the clever part is never
   * allowed to destroy the part that matters.
   */
  async finish(): Promise<FinishResult> {
    if (this._readOnly()) {
      throw new Error('This workout is open in another tab');
    }
    await this.flushPending();

    const workout = this._workout();
    if (!workout) {
      throw new Error('No active workout to finish');
    }

    const finishedAt = this.clock.nowIso();
    const durationSec = this.elapsedSec();

    const result = await this.lane.run(() =>
      this.uow.run(FINISH_STORES, 'readwrite', async (tx): Promise<FinishResult> => {
        const unlogged = this._sets().filter((set) => !set.isCompleted);
        for (const set of unlogged) {
          // Hard delete: a row that was never confirmed is not history, and a
          // tombstone would leave it to be "recovered" into a session that
          // never contained it.
          await tx.repo('setLogs').remove(set.id, { hard: true });
        }

        const kept = await tx.repo('setLogs').list({ index: 'by_workoutId', equals: workout.id });
        const exercises = sortByOrder(
          await tx.repo('workoutExercises').list({ index: 'by_workoutId', equals: workout.id }),
        );
        const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

        const totals = sessionTotals(
          kept.map((set) => {
            const exercise = byId.get(set.workoutExerciseId);
            return {
              loadType: exercise?.loadType ?? 'external',
              weightKg: set.weightKg,
              extraWeightKg: set.extraWeightKg,
              bodyWeightKg: workout.bodyWeightKg,
              setType: set.setType,
              reps: set.reps,
              isCompleted: set.isCompleted,
            };
          }),
        );

        for (const exercise of exercises) {
          await this.refreshRollups(tx, exercise.id);
        }

        const completed = await tx.repo('workouts').patch(workout.id, {
          status: 'completed',
          finishedAt,
          durationSec,
          totalVolumeKg: totals.totalVolumeKg,
          totalSets: totals.totalSets,
          totalReps: totals.totalReps,
          exerciseCount: exercises.filter((exercise) => !exercise.isSkipped).length,
          tabId: null,
          heartbeatAt: null,
        });

        const records = await this.prDetector.detect(tx, {
          workout: completed,
          exercises,
          sets: kept,
        });

        const withRecords =
          records.length === 0
            ? completed
            : await tx.repo('workouts').patch(workout.id, { prCount: records.length });

        await tx.appMeta().set('activeWorkoutId', null);
        await tx.appMeta().set('activeRest', null);

        tx.onCommit(() => {
          this._workout.set(withRecords);
          this.reset();
        });

        return {
          workoutId: workout.id,
          totals,
          durationSec,
          droppedSetCount: unlogged.length,
          records,
        };
      }),
    );

    this._lastFinish.set(result);
    return result;
  }

  /**
   * Abandons the session.
   *
   * Soft-deletes the workout and everything under it, which keeps the 30-day
   * recovery window DATABASE_SPEC section 9.3 asks for while removing the sets
   * from every default query — a discarded session must not feed a progression
   * chart or a personal record.
   */
  async discard(reason: string): Promise<void> {
    if (this._readOnly()) return;
    const workout = this._workout();
    if (!workout) return;

    this.cancelDrafts();

    await this.lane.run(() =>
      this.uow.run(
        ['workouts', 'workoutExercises', 'setLogs', 'appMeta'],
        'readwrite',
        async (tx) => {
          for (const set of this._sets()) {
            await tx.repo('setLogs').remove(set.id);
          }
          for (const exercise of this._exercises()) {
            await tx.repo('workoutExercises').remove(exercise.id);
          }
          await tx.repo('workouts').patch(workout.id, {
            status: 'discarded',
            discardedReason: reason,
            finishedAt: this.clock.nowIso(),
            tabId: null,
            heartbeatAt: null,
          });
          await tx.repo('workouts').remove(workout.id);

          await tx.appMeta().set('activeWorkoutId', null);
          await tx.appMeta().set('activeRest', null);

          tx.onCommit(() => this.reset());
        },
      ),
    );
  }

  // ----------------------------------------------------------------- private

  /** Everything goes through the lane, so two writes never interleave. */
  private write(work: (tx: TxScope) => Promise<void>): Promise<void> {
    return this.lane.run(() =>
      this.uow.run(['workouts', 'workoutExercises', 'setLogs'], 'readwrite', work),
    );
  }

  private afterConfirm(exerciseId: string, restSec: number | null): void {
    const next = focusAfter(this.focusModel(), exerciseId);
    this._focusSetId.set(next?.setId ?? null);
    if (next && next.exerciseId !== exerciseId) {
      this._expandedId.set(next.exerciseId);
    }

    if (this.settings.prefs().autoStartRestTimer) {
      const target = restSec ?? this.settings.prefs().defaultRestSec;
      if (target > 0) this.startRest(target, next?.setId ?? null);
    }
  }

  private async hydrate(workout: Workout): Promise<void> {
    const [exercises, sets] = await Promise.all([
      this.exercisesRepo.list({ index: 'by_workoutId', equals: workout.id }),
      this.setsRepo.list({ index: 'by_workoutId', equals: workout.id }),
    ]);

    this._workout.set(workout);
    this._exercises.set(sortByOrder(exercises));
    this._sets.set(sets);
    this._focusSetId.set(null);
    this._expandedId.set(
      currentFocus(
        sortByOrder(exercises).map((exercise) => ({
          id: exercise.id,
          supersetGroup: exercise.supersetGroup,
          isSkipped: exercise.isSkipped,
          sets: sets
            .filter((set) => set.workoutExerciseId === exercise.id)
            .sort((a, b) => a.setIndex - b.setIndex)
            .map((set) => ({ id: set.id, isCompleted: set.isCompleted })),
        })),
      )?.exerciseId ?? null,
    );
  }

  /**
   * Takes ownership of the session, or observes it read-only.
   *
   * A second tab that wrote too would race the first and lose sets. A stale
   * heartbeat means the owning tab is gone, so ownership can be claimed —
   * otherwise a crashed tab would lock the session out for good.
   */
  private claimOrObserve(workout: Workout): void {
    const heartbeatAge =
      workout.heartbeatAt === null
        ? Number.POSITIVE_INFINITY
        : this.clock.now() - Date.parse(workout.heartbeatAt);
    const ownedElsewhere =
      workout.tabId !== null && workout.tabId !== this.tabId && heartbeatAge < STALE_HEARTBEAT_MS;

    this._readOnly.set(ownedElsewhere);
    if (!ownedElsewhere) {
      void this.beat();
    }
  }

  private async beat(): Promise<void> {
    const workout = this._workout();
    if (!workout || this._readOnly()) return;

    try {
      const updated = await this.workoutsRepo.patch(workout.id, {
        tabId: this.tabId,
        heartbeatAt: this.clock.nowIso(),
      });
      this._workout.set(updated);
    } catch {
      // A missed heartbeat is not worth surfacing: the next one is 15 s away,
      // and the only consequence is another tab being able to take over.
    }
  }

  private restartTicker(intervalMs: number | null): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (intervalMs === null) return;
    this.ticker = setInterval(() => this._nowMs.set(this.clock.now()), intervalMs);
  }

  private restartHeartbeat(enabled: boolean): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (!enabled) return;
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
  }

  private reset(): void {
    this.cancelDrafts();
    this._workout.set(null);
    this._exercises.set([]);
    this._sets.set([]);
    this._rest.set(null);
    this._expandedId.set(null);
    this._focusSetId.set(null);
    this._readOnly.set(false);
    this._awaitingResumeChoice.set(false);
    this.previous.clear();
  }

  private cancelDrafts(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.drafts.clear();
    this._pendingWrites.set(0);
  }

  private setsFor(exerciseId: string): SetLog[] {
    return this._sets()
      .filter((set) => set.workoutExerciseId === exerciseId)
      .sort((a, b) => a.setIndex - b.setIndex);
  }

  private setDraft(
    workout: Workout,
    exercise: WorkoutExercise,
    row: Pick<SetLog, 'setIndex' | 'setType' | 'side' | 'weightKg' | 'reps'>,
  ): Draft<SetLog> {
    return {
      workoutId: workout.id,
      workoutExerciseId: exercise.id,
      exerciseId: exercise.exerciseId,
      variantKey: exercise.variantKey,
      dayKey: workout.dayKey,
      setIndex: row.setIndex,
      setType: row.setType,
      side: row.side,
      weightKg: row.weightKg,
      extraWeightKg: null,
      reps: row.reps,
      durationSec: null,
      distanceM: null,
      rpe: null,
      rir: null,
      isCompleted: false,
      isPr: false,
      completedAt: null,
      restTakenSec: null,
      e1rmKg: null,
      volumeKg: null,
      notes: null,
    };
  }

  private volumeInputFor(set: SetLog) {
    const exercise = this.exerciseById(set.workoutExerciseId);
    return {
      loadType: exercise?.loadType ?? 'external',
      weightKg: set.weightKg,
      extraWeightKg: set.extraWeightKg,
      bodyWeightKg: this._workout()?.bodyWeightKg ?? null,
      setType: set.setType,
      reps: set.reps,
      isCompleted: set.isCompleted,
    } as const;
  }

  private patchSetLocally(setId: string, changes: Patch<SetLog>): void {
    this._sets.update((sets) =>
      sets.map((set) => (set.id === setId ? { ...set, ...changes } : set)),
    );
  }

  private cacheSet(updated: SetLog): void {
    this._sets.update((sets) => sets.map((set) => (set.id === updated.id ? updated : set)));
  }

  private cacheExercise(updated: WorkoutExercise): void {
    this._exercises.update((list) =>
      list.map((exercise) => (exercise.id === updated.id ? updated : exercise)),
    );
  }

  private today(): string {
    return dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes());
  }

  /**
   * The most recent recorded body weight.
   *
   * Snapshotted at the start so a bodyweight exercise has a meaningful volume,
   * and `null` when nothing has ever been recorded — in which case volume
   * reports as uncounted rather than as a guess.
   */
  private async nearestBodyWeightKg(): Promise<number | null> {
    const recent = await this.measurementsRepo.list({
      index: 'by_measuredAt',
      direction: 'prev',
      limit: 20,
    });
    return recent.find((entry) => entry.weightKg !== null)?.weightKg ?? null;
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
