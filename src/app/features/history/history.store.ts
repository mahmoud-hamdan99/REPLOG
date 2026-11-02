import { computed, inject, Service, signal } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import { CLOCK } from '../../data/clock';
import { PR_DETECTOR } from '../../data/pr-detector';
import type { Query } from '../../data/repository';
import type { StoreName } from '../../data/stores';
import {
  ROUTINES_REPO,
  SET_LOGS_REPO,
  WORKOUTS_REPO,
  WORKOUT_EXERCISES_REPO,
} from '../../data/tokens';
import { UNIT_OF_WORK, type TxScope } from '../../data/unit-of-work';
import type { Patch } from '../../domain/models/entity';
import type { SetLog, Workout, WorkoutExercise } from '../../domain/models/workout';
import { sortByOrder } from '../../domain/planner/ordering';
import { estimate1Rm } from '../../domain/strength/e1rm';
import { sessionTotals, setVolumeKg } from '../../domain/strength/volume';

/** Rows per page: enough to fill a tall phone twice, small enough to be instant. */
export const PAGE_SIZE = 50;

/**
 * How many index rows a filtered scan will read before giving up on a page.
 *
 * A bound is necessary. With a filter that matches nothing, "keep reading
 * until the page is full" is a full-store scan wearing a disguise.
 */
const MAX_SCAN = PAGE_SIZE * 20;

/** Sorts above every ISO instant, so it stands in for "no upper bound". */
const MAX_KEY = '￿';

export interface HistoryFilters {
  routineId: string | null;
  exerciseId: string | null;
  /** Inclusive local day keys, matching what a date field hands back. */
  fromDay: string | null;
  toDay: string | null;
}

const NO_FILTERS: HistoryFilters = Object.freeze({
  routineId: null,
  exerciseId: null,
  fromDay: null,
  toDay: null,
});

export interface HistoryMonth {
  /** `YYYY-MM`, taken from the stored local day key rather than re-derived. */
  key: string;
  workouts: Workout[];
}

/** Whether the routine a workout came from is still what it was. */
export type RoutineState = 'same' | 'changed' | 'missing' | 'adhoc';

export interface WorkoutDetail {
  workout: Workout;
  exercises: WorkoutExercise[];
  setsByExercise: ReadonlyMap<string, SetLog[]>;
  routineState: RoutineState;
}

export interface ExerciseSession {
  workoutId: string;
  workoutName: string;
  performedAt: string;
  dayKey: string;
  variantKey: string;
  sets: SetLog[];
  volumeKg: number;
}

/** One batch of index rows, with how many were read to produce it. */
interface Batch {
  workouts: Workout[];
  /** Index rows consumed. Fewer than a page means the index is exhausted. */
  rowsRead: number;
}

/** Stores an edit or a deletion touches, declared once. */
const EDIT_STORES: readonly StoreName[] = [
  'workouts',
  'workoutExercises',
  'setLogs',
  'personalRecords',
];

/**
 * Completed workouts.
 *
 * Two things shape this store. **Paging is keyset, not offset**: the next page
 * asks for "everything before the last instant I saw" rather than "skip 450",
 * so page ten costs what page one did. Offset paging walks every skipped
 * record through the soft-delete filter, which is the full-store scan the
 * acceptance criteria rule out.
 *
 * And **history renders from snapshots**. A workout carries its own copy of
 * the plan's names, targets and revision; `planId` and `routineId` are
 * provenance only. Deleting the routine a workout came from therefore leaves
 * the workout perfectly readable, which is the point of
 * docs/ARCHITECTURE.md section 7.6 — the live routine is consulted only to
 * *annotate* the snapshot, never to render it.
 */
@Service()
export class HistoryStore {
  private readonly workoutsRepo = inject(WORKOUTS_REPO);
  private readonly exercisesRepo = inject(WORKOUT_EXERCISES_REPO);
  private readonly setsRepo = inject(SET_LOGS_REPO);
  private readonly routinesRepo = inject(ROUTINES_REPO);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly prDetector = inject(PR_DETECTOR);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(CLOCK);

  private readonly _workouts = signal<Workout[] | null>(null);
  private readonly _filters = signal<HistoryFilters>({ ...NO_FILTERS });
  private readonly _hasMore = signal(true);
  private readonly _paging = signal(false);
  private readonly _error = signal<string | null>(null);

  /** `null` means not loaded; an empty array means loaded and genuinely empty. */
  readonly workouts = this._workouts.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly isPaging = this._paging.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isLoading = computed(() => this._workouts() === null && this._error() === null);

  readonly hasActiveFilters = computed(() => {
    const filters = this._filters();
    return (
      filters.routineId !== null ||
      filters.exerciseId !== null ||
      filters.fromDay !== null ||
      filters.toDay !== null
    );
  });

  /**
   * Workouts grouped into months, newest first.
   *
   * Grouped on the stored `dayKey`, which is already the local calendar day the
   * session belongs to. Re-deriving a month from the UTC instant would file a
   * late-evening workout under the wrong month at a boundary.
   */
  readonly months = computed<HistoryMonth[]>(() => {
    const groups: HistoryMonth[] = [];
    for (const workout of this._workouts() ?? []) {
      const key = workout.dayKey.slice(0, 7);
      const last = groups.at(-1);
      if (last?.key === key) last.workouts.push(workout);
      else groups.push({ key, workouts: [workout] });
    }
    return groups;
  });

  /** Keyset cursor: the instant of the last index row read. */
  private cursor: string | null = null;
  /** Guards the duplicate two sessions sharing a `startedAt` would produce. */
  private readonly delivered = new Set<string>();
  /** Per-exercise history, dropped wholesale whenever an edit lands. */
  private readonly exerciseCache = new Map<string, ExerciseSession[]>();

  // ----------------------------------------------------------------- paging

  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._workouts() !== null && !options.force) {
      return;
    }
    await this.reload();
  }

  setFilters(changes: Partial<HistoryFilters>): Promise<void> {
    this._filters.update((current) => ({ ...current, ...changes }));
    return this.reload();
  }

  clearFilters(): Promise<void> {
    this._filters.set({ ...NO_FILTERS });
    return this.reload();
  }

  async loadMore(): Promise<void> {
    if (this._paging() || !this._hasMore()) {
      return;
    }
    this._paging.set(true);
    this._error.set(null);

    try {
      const { page, exhausted } = await this.fetchPage();
      this._workouts.update((current) => [...(current ?? []), ...page]);
      this._hasMore.set(!exhausted);
    } catch (error) {
      this._workouts.update((current) => current ?? []);
      this._error.set(message(error, 'History could not be loaded'));
      this._hasMore.set(false);
    } finally {
      this._paging.set(false);
    }
  }

  /** Discards the cursor and fetches page one. */
  private async reload(): Promise<void> {
    this.cursor = null;
    this.delivered.clear();
    this._workouts.set(null);
    this._hasMore.set(true);
    this._paging.set(false);
    await this.loadMore();
  }

  /**
   * One page of matches, walking back from the cursor.
   *
   * Filters an index can serve narrow the range; the rest are applied in
   * memory while the scan keeps pulling batches until the page is full.
   * `MAX_SCAN` bounds that loop.
   */
  private async fetchPage(): Promise<{ page: Workout[]; exhausted: boolean }> {
    const filters = this._filters();
    const page: Workout[] = [];
    let rowsRead = 0;
    let exhausted = false;

    while (page.length < PAGE_SIZE && rowsRead < MAX_SCAN && !exhausted) {
      const wanted = this.batchSize();
      const batch =
        filters.exerciseId === null
          ? await this.scanWorkouts(wanted)
          : await this.scanByExercise(filters.exerciseId, wanted);

      rowsRead += batch.rowsRead;
      if (batch.rowsRead === 0) {
        exhausted = true;
        break;
      }

      let filled = false;
      for (const workout of batch.workouts) {
        this.cursor = workout.startedAt;
        // The cursor bound is inclusive, so the row it names comes back once
        // more on the next batch; this is what stops it being listed twice.
        if (this.delivered.has(workout.id)) continue;
        this.delivered.add(workout.id);
        if (!this.matches(workout, filters)) continue;

        page.push(workout);
        if (page.length === PAGE_SIZE) {
          filled = true;
          break;
        }
      }

      // A short batch only means the index ran out if the batch was actually
      // read to the end. Stopping early because the page filled says nothing
      // about what is left, and treating it as the end loses whole pages.
      if (!filled && batch.rowsRead < wanted) exhausted = true;
    }

    return { page, exhausted };
  }

  /**
   * How many index rows to ask for.
   *
   * One more than a page once a cursor exists, because the inclusive bound
   * re-reads the row it names. Without the extra row every page would need a
   * second query to find its last entry, doubling the reads.
   */
  private batchSize(): number {
    return this.cursor === null ? PAGE_SIZE : PAGE_SIZE + 1;
  }

  /** The default path: Q11, one descending cursor on `by_status_startedAt`. */
  private async scanWorkouts(limit: number): Promise<Batch> {
    const workouts = await this.workoutsRepo.list(
      this.pageQuery('by_status_startedAt', ['completed'], limit),
    );
    return { workouts, rowsRead: workouts.length };
  }

  /**
   * The exercise-filtered path.
   *
   * Driven from `workoutExercises.by_exerciseId_startedAt` — the index
   * "previous performance" uses — so filtering by exercise stays O(result)
   * rather than reading every workout to ask what was in it.
   */
  private async scanByExercise(exerciseId: string, limit: number): Promise<Batch> {
    const slots = await this.exercisesRepo.list(
      this.pageQuery('by_exerciseId_startedAt', [exerciseId], limit),
    );

    const workouts: Workout[] = [];
    const seen = new Set<string>();
    for (const slot of slots) {
      if (seen.has(slot.workoutId)) continue;
      seen.add(slot.workoutId);

      const workout = await this.workoutsRepo.get(slot.workoutId);
      if (workout) workouts.push(workout);
    }

    // Rows read is the slot count, not the workout count: a session with the
    // same exercise twice is two rows, and the page budget has to see that.
    return { workouts, rowsRead: slots.length };
  }

  /**
   * A descending page bounded by the cursor and by any date filter.
   *
   * `upperOpen` is deliberately false: two sessions can share an instant, and
   * excluding the bound would silently drop the second.
   */
  private pageQuery(index: string, prefix: readonly string[], limit: number): Query {
    const filters = this._filters();
    const upper =
      this.cursor ?? (filters.toDay === null ? MAX_KEY : `${filters.toDay}T23:59:59.999Z`);
    const lower = filters.fromDay === null ? '' : `${filters.fromDay}T00:00:00.000Z`;

    return {
      index,
      range: { lower: [...prefix, lower], upper: [...prefix, upper] },
      direction: 'prev',
      limit,
    };
  }

  /** The predicates no index covers. */
  private matches(workout: Workout, filters: HistoryFilters): boolean {
    if (workout.status !== 'completed') return false;
    if (filters.routineId !== null && workout.routineId !== filters.routineId) return false;
    if (filters.fromDay !== null && workout.dayKey < filters.fromDay) return false;
    if (filters.toDay !== null && workout.dayKey > filters.toDay) return false;
    return true;
  }

  // ----------------------------------------------------------------- detail

  /**
   * A workout with its exercises and sets, read in one transaction (Q12).
   *
   * One transaction rather than three reads: a detail assembled across
   * separate transactions could show exercises from before an edit beside sets
   * from after it.
   */
  async detail(workoutId: string): Promise<WorkoutDetail | null> {
    const loaded = await this.uow.run(
      ['workouts', 'workoutExercises', 'setLogs'],
      'readonly',
      async (tx) => {
        const workout = await tx.repo('workouts').get(workoutId);
        if (!workout) return null;

        const exercises = sortByOrder(
          await tx.repo('workoutExercises').list({ index: 'by_workoutId', equals: workoutId }),
        );
        const sets = await tx.repo('setLogs').list({ index: 'by_workoutId', equals: workoutId });
        return { workout, exercises, sets };
      },
    );

    if (!loaded) return null;

    const setsByExercise = new Map<string, SetLog[]>();
    for (const exercise of loaded.exercises) {
      setsByExercise.set(
        exercise.id,
        loaded.sets
          .filter((set) => set.workoutExerciseId === exercise.id)
          .sort((a, b) => a.setIndex - b.setIndex),
      );
    }

    return {
      workout: loaded.workout,
      exercises: loaded.exercises,
      setsByExercise,
      routineState: await this.routineStateFor(loaded.workout),
    };
  }

  /**
   * Whether the plan behind a workout still matches its snapshot.
   *
   * Used only to annotate, never to render from. A soft-deleted routine reads
   * as missing rather than silently as unchanged, because the repository hides
   * tombstones by default and that is the honest answer here.
   */
  private async routineStateFor(workout: Workout): Promise<RoutineState> {
    const snapshot = workout.planSnapshot;
    if (!snapshot || snapshot.routineId === null) return 'adhoc';

    const routine = await this.routinesRepo.get(snapshot.routineId);
    if (!routine) return 'missing';
    return routine.revision === snapshot.routineRevision ? 'same' : 'changed';
  }

  // ------------------------------------------------------- per-exercise view

  /**
   * Every session that included an exercise, newest first.
   *
   * Cached per exercise, and invalidated wholesale on any edit — a cache that
   * has to reason about which session an edit touched is a cache that will be
   * wrong one day.
   */
  async exerciseHistory(exerciseId: string, limit = PAGE_SIZE): Promise<ExerciseSession[]> {
    const cached = this.exerciseCache.get(exerciseId);
    if (cached) return cached;

    const slots = await this.exercisesRepo.list({
      index: 'by_exerciseId_startedAt',
      range: { lower: [exerciseId, ''], upper: [exerciseId, MAX_KEY] },
      direction: 'prev',
      limit,
    });

    const sessions: ExerciseSession[] = [];
    for (const slot of slots) {
      const workout = await this.workoutsRepo.get(slot.workoutId);
      if (workout?.status !== 'completed') continue;

      const sets = (await this.setsRepo.list({ index: 'by_workoutExerciseId', equals: slot.id }))
        .filter((set) => set.isCompleted)
        .sort((a, b) => a.setIndex - b.setIndex);
      // A slot with nothing logged is not a session worth listing.
      if (sets.length === 0) continue;

      sessions.push({
        workoutId: workout.id,
        workoutName: workout.name,
        performedAt: slot.startedAt,
        dayKey: slot.dayKey,
        variantKey: slot.variantKey,
        sets,
        volumeKg: slot.volumeKg,
      });
    }

    this.exerciseCache.set(exerciseId, sessions);
    return sessions;
  }

  // -------------------------------------------------------------- mutations

  /**
   * Corrects a logged set.
   *
   * Everything downstream moves in the same transaction: the set's derived
   * values, its exercise's rollups, the workout's totals, the edit marker, and
   * the records for the affected variant. A correction that left the session
   * volume stale would make history disagree with itself.
   */
  async updateSet(setId: string, changes: Patch<SetLog>): Promise<void> {
    const workoutId = await this.uow.run(EDIT_STORES, 'readwrite', async (tx) => {
      const sets = tx.repo('setLogs');
      const existing = await sets.get(setId);
      if (!existing) return null;

      const exercise = await tx.repo('workoutExercises').get(existing.workoutExerciseId);
      const workout = await tx.repo('workouts').get(existing.workoutId);
      if (!exercise || !workout) return null;

      const merged = { ...existing, ...changes };
      const volumeKg = setVolumeKg(volumeInput(merged, exercise, workout));
      const e1rm =
        exercise.loadType === 'external'
          ? estimate1Rm(merged.weightKg, merged.reps, this.settings.prefs().e1rmFormula)
          : null;

      await sets.patch(setId, { ...changes, volumeKg, e1rmKg: e1rm?.value ?? null });
      await this.recomputeWorkout(tx, workout.id, { edited: true });
      await this.prDetector.recompute(tx, { variantKeys: [existing.variantKey] });
      return existing.workoutId;
    });

    await this.afterEdit(workoutId);
  }

  /** Removes a logged set. Soft, so a mis-tap is recoverable. */
  async deleteSet(setId: string): Promise<void> {
    const workoutId = await this.uow.run(EDIT_STORES, 'readwrite', async (tx) => {
      const existing = await tx.repo('setLogs').get(setId);
      if (!existing) return null;

      await tx.repo('setLogs').remove(setId);
      await this.recomputeWorkout(tx, existing.workoutId, { edited: true });
      await this.prDetector.recompute(tx, { variantKeys: [existing.variantKey] });
      return existing.workoutId;
    });

    await this.afterEdit(workoutId);
  }

  /** Undo for `deleteSet`: reaches past the tombstone on purpose. */
  async restoreSet(setId: string): Promise<void> {
    const workoutId = await this.uow.run(EDIT_STORES, 'readwrite', async (tx) => {
      const sets = tx.repo('setLogs');
      const tombstoned = await sets.get(setId, { includeDeleted: true });
      if (!tombstoned) return null;

      const restored = await sets.put({ ...tombstoned, deletedAt: null });
      await this.recomputeWorkout(tx, restored.workoutId, { edited: true });
      await this.prDetector.recompute(tx, { variantKeys: [restored.variantKey] });
      return restored.workoutId;
    });

    await this.afterEdit(workoutId);
  }

  /**
   * Soft-deletes a workout and everything under it.
   *
   * Soft because DATABASE_SPEC section 9.3 asks for a 30-day recovery window,
   * and because records derived from these sets have to be able to come back
   * with them. Tombstoned rows are excluded from every default query, so a
   * deleted session cannot feed a chart or a record in the meantime.
   */
  async deleteWorkout(workoutId: string): Promise<void> {
    await this.uow.run(EDIT_STORES, 'readwrite', async (tx) => {
      const { exercises, sets } = await this.children(tx, workoutId);

      // The workout is tombstoned *first*, and the cascade follows. Each write
      // takes its own reading of the clock, so stamping the parent first is
      // what makes "deleted at or after the workout was" identify the cascade
      // — and lets a set deleted last week keep its older timestamp and stay
      // deleted when the workout is restored.
      await tx.repo('workouts').remove(workoutId);
      for (const exercise of exercises) await tx.repo('workoutExercises').remove(exercise.id);
      for (const set of sets) await tx.repo('setLogs').remove(set.id);

      await this.prDetector.recompute(tx, { variantKeys: variantsOf(exercises) });
    });

    await this.afterMembershipChange();
  }

  /**
   * Brings a deleted workout back, with its records.
   *
   * Only children tombstoned *by that deletion* are restored. A set the user
   * deleted on its own last week carries an older `deletedAt` and stays
   * deleted: undoing a workout deletion must not quietly undo every correction
   * made before it.
   */
  async restoreWorkout(workoutId: string): Promise<void> {
    await this.uow.run(EDIT_STORES, 'readwrite', async (tx) => {
      const workouts = tx.repo('workouts');
      const workout = await workouts.get(workoutId, { includeDeleted: true });
      if (!workout || workout.deletedAt === null) return;

      const cascadedAt = workout.deletedAt;
      const { exercises, sets } = await this.children(tx, workoutId, { includeDeleted: true });

      await workouts.put({ ...workout, deletedAt: null });
      for (const exercise of exercises) {
        if (exercise.deletedAt !== null && exercise.deletedAt >= cascadedAt) {
          await tx.repo('workoutExercises').put({ ...exercise, deletedAt: null });
        }
      }
      for (const set of sets) {
        if (set.deletedAt !== null && set.deletedAt >= cascadedAt) {
          await tx.repo('setLogs').put({ ...set, deletedAt: null });
        }
      }

      await this.recomputeWorkout(tx, workoutId, { edited: false });
      await this.prDetector.recompute(tx, { variantKeys: variantsOf(exercises) });
    });

    await this.afterMembershipChange();
  }

  // ------------------------------------------------------------------ shared

  private async children(
    tx: TxScope,
    workoutId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<{ exercises: WorkoutExercise[]; sets: SetLog[] }> {
    const query = (index: string): Query => ({
      index,
      equals: workoutId,
      ...(options.includeDeleted ? { includeDeleted: true } : {}),
    });

    return {
      exercises: await tx.repo('workoutExercises').list(query('by_workoutId')),
      sets: await tx.repo('setLogs').list(query('by_workoutId')),
    };
  }

  /**
   * Rebuilds a workout's cached rollups from its surviving sets.
   *
   * Every number here is a cache of the set logs. Recomputing rather than
   * adjusting is what makes a correction and a full rebuild agree, which is
   * exactly the determinism the acceptance criteria ask for.
   */
  private async recomputeWorkout(
    tx: TxScope,
    workoutId: string,
    options: { edited: boolean },
  ): Promise<void> {
    const workout = await tx.repo('workouts').get(workoutId);
    if (!workout) return;

    const { exercises, sets } = await this.children(tx, workoutId);
    const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

    for (const exercise of exercises) {
      const own = sets.filter((set) => set.workoutExerciseId === exercise.id);
      const totals = sessionTotals(own.map((set) => volumeInput(set, exercise, workout)));
      await tx.repo('workoutExercises').patch(exercise.id, {
        completedSetCount: own.filter((set) => set.isCompleted).length,
        volumeKg: totals.totalVolumeKg,
      });
    }

    const totals = sessionTotals(
      sets.map((set) => volumeInput(set, byId.get(set.workoutExerciseId), workout)),
    );

    await tx.repo('workouts').patch(workoutId, {
      totalVolumeKg: totals.totalVolumeKg,
      totalSets: totals.totalSets,
      totalReps: totals.totalReps,
      exerciseCount: exercises.filter((exercise) => !exercise.isSkipped).length,
      // The marker is the honest part of an edit: a corrected workout is no
      // longer exactly what was recorded on the day, and says so.
      ...(options.edited ? { editedAt: this.clock.nowIso() } : {}),
    });
  }

  /**
   * One workout changed in place: refresh that row, keep the page.
   *
   * Awaited by the caller rather than fired from `onCommit`, so a mutation's
   * promise resolves only once the store agrees with the database. A caller
   * that awaits a delete and then reads the list should not see the old one.
   */
  private async afterEdit(workoutId: string | null): Promise<void> {
    this.exerciseCache.clear();
    if (workoutId !== null) await this.refreshRow(workoutId);
  }

  /** A workout entered or left the list: the page itself has to be rebuilt. */
  private async afterMembershipChange(): Promise<void> {
    this.exerciseCache.clear();
    if (this._workouts() !== null) await this.reload();
  }

  private async refreshRow(workoutId: string): Promise<void> {
    const updated = await this.workoutsRepo.get(workoutId);
    this._workouts.update((current) => {
      if (current === null) return current;
      return current.map((workout) => (workout.id === workoutId && updated ? updated : workout));
    });
  }
}

function variantsOf(exercises: readonly WorkoutExercise[]): string[] {
  return [...new Set(exercises.map((exercise) => exercise.variantKey))];
}

function volumeInput(set: SetLog, exercise: WorkoutExercise | undefined, workout: Workout) {
  return {
    loadType: exercise?.loadType ?? 'external',
    weightKg: set.weightKg,
    extraWeightKg: set.extraWeightKg,
    bodyWeightKg: workout.bodyWeightKg,
    setType: set.setType,
    reps: set.reps,
    isCompleted: set.isCompleted,
  } as const;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
