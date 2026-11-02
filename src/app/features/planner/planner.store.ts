import { computed, inject, Service, signal } from '@angular/core';
import { APP_META_STORE } from '../../data/app-meta';
import { ID_FACTORY } from '../../data/ids';
import { PLANS_REPO, ROUTINES_REPO, WORKOUTS_REPO } from '../../data/tokens';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import type { Draft } from '../../domain/models/entity';
import type { Weekday } from '../../domain/models/enums';
import type { Plan, Routine, RoutineExercise } from '../../domain/models/training';
import { estimateRoutineDuration, totalPlannedSets } from '../../domain/planner/duration';
import {
  indexForMove,
  moveWithin,
  nextOrderIndex,
  sortByOrder,
} from '../../domain/planner/ordering';
import {
  bumpsRevision,
  duplicatePlan,
  duplicateRoutine,
  newRoutineExercise,
  removeExercise,
} from '../../domain/planner/plan-ops';
import { groupWithNext, normaliseSupersets, ungroup } from '../../domain/planner/supersets';

/**
 * Plans and routines.
 *
 * A plan is a program; a routine is one workout day inside it. Routines can
 * also stand alone with `planId: null` — PRODUCT_SPEC section 4.2 requires both
 * fixed weekly schedules and flexible unscheduled workouts.
 */
@Service()
export class PlannerStore {
  private readonly plansRepo = inject(PLANS_REPO);
  private readonly routinesRepo = inject(ROUTINES_REPO);
  private readonly workoutsRepo = inject(WORKOUTS_REPO);
  private readonly appMeta = inject(APP_META_STORE);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly ids = inject(ID_FACTORY);

  private readonly _plans = signal<Plan[] | null>(null);
  private readonly _routines = signal<Routine[] | null>(null);
  private readonly _activePlanId = signal<string | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly plans = this._plans.asReadonly();
  readonly routines = this._routines.asReadonly();
  readonly activePlanId = this._activePlanId.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isLoading = computed(() => this._plans() === null && this._error() === null);

  /** Live plans in display order. Archived ones are a separate view. */
  readonly livePlans = computed(() =>
    sortByOrder((this._plans() ?? []).filter((plan) => plan.isArchived === 0)),
  );

  readonly archivedPlans = computed(() =>
    sortByOrder((this._plans() ?? []).filter((plan) => plan.isArchived === 1)),
  );

  readonly activePlan = computed(
    () => this._plans()?.find((plan) => plan.id === this._activePlanId()) ?? null,
  );

  /** Routines with no plan: the flexible workouts the Train screen offers. */
  readonly flexibleRoutines = computed(() =>
    sortByOrder((this._routines() ?? []).filter((r) => r.planId === null && !r.isArchived)),
  );

  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._plans() !== null && !options.force) {
      return;
    }
    this._error.set(null);
    try {
      const [plans, routines, activePlanId] = await Promise.all([
        this.plansRepo.list(),
        this.routinesRepo.list(),
        this.appMeta.get('activePlanId'),
      ]);
      this._plans.set(plans);
      this._routines.set(routines);
      this._activePlanId.set(activePlanId);
    } catch (error) {
      this._plans.set(null);
      this._error.set(error instanceof Error ? error.message : 'Failed to load plans');
    }
  }

  // ---------------------------------------------------------------- queries

  planById(id: string): Plan | undefined {
    return this._plans()?.find((plan) => plan.id === id);
  }

  routineById(id: string): Routine | undefined {
    return this._routines()?.find((routine) => routine.id === id);
  }

  routinesForPlan(planId: string): Routine[] {
    return sortByOrder(
      (this._routines() ?? []).filter((r) => r.planId === planId && !r.isArchived),
    );
  }

  /**
   * Routines scheduled on a weekday, within the active plan.
   *
   * A routine assigned to Monday and Thursday appears on both, which is the
   * point of `weekdays` being a list rather than a single day.
   */
  routinesOnWeekday(weekday: Weekday): Routine[] {
    const planId = this._activePlanId();
    return sortByOrder(
      (this._routines() ?? []).filter(
        (routine) =>
          !routine.isArchived &&
          routine.scheduleType === 'scheduled' &&
          routine.weekdays.includes(weekday) &&
          (planId === null || routine.planId === planId),
      ),
    );
  }

  summaryFor(routine: Routine): { sets: number; minutes: number; exercises: number } {
    const estimate = estimateRoutineDuration(routine.exercises);
    return {
      sets: totalPlannedSets(routine.exercises),
      minutes: estimate.minutes,
      exercises: routine.exercises.filter((exercise) => !exercise.isOptional).length,
    };
  }

  // ------------------------------------------------------------------ plans

  async createPlan(name: string): Promise<Plan> {
    const created = await this.plansRepo.put({
      name,
      description: null,
      goal: null,
      weekStartsOn: 1,
      accentColor: null,
      isArchived: 0,
      orderIndex: nextOrderIndex(this._plans() ?? []),
      durationWeeks: null,
    } satisfies Draft<Plan>);

    this._plans.update((plans) => (plans === null ? plans : [...plans, created]));
    if (this._activePlanId() === null) {
      await this.setActivePlan(created.id);
    }
    return created;
  }

  async updatePlan(id: string, changes: Partial<Plan>): Promise<void> {
    this.replacePlan(await this.plansRepo.patch(id, changes));
  }

  async setPlanArchived(id: string, archived: boolean): Promise<void> {
    this.replacePlan(await this.plansRepo.patch(id, { isArchived: archived ? 1 : 0 }));
    if (archived && this._activePlanId() === id) {
      await this.setActivePlan(null);
    }
  }

  async setActivePlan(id: string | null): Promise<void> {
    await this.appMeta.set('activePlanId', id);
    this._activePlanId.set(id);
  }

  /**
   * Deep-copies a plan and all its routines in one transaction.
   *
   * Atomic because a half-copied plan — routines pointing at a plan that was
   * never written, or a plan with none of its days — is worse than no copy.
   */
  async duplicatePlanById(id: string, name: string): Promise<Plan | undefined> {
    const source = this.planById(id);
    if (!source) return undefined;

    const sourceRoutines = (this._routines() ?? []).filter((r) => r.planId === id);
    const copy = duplicatePlan(source, sourceRoutines, {
      name,
      newId: () => this.ids.newId(),
    });

    const created = await this.uow.run(['plans', 'routines'], 'readwrite', async (tx) => {
      const plan = await tx.repo('plans').put(copy.plan);
      for (const routine of copy.routines) {
        await tx.repo('routines').put(routine);
      }
      return plan;
    });

    await this.load({ force: true });
    return created;
  }

  /**
   * True when no completed workout references any of the plan's routines.
   *
   * History is rendered from snapshots, so deleting a plan cannot corrupt it —
   * but a plan the user has actually trained is worth keeping, and archiving
   * is offered instead.
   */
  async canDeletePlan(id: string): Promise<boolean> {
    const routines = (this._routines() ?? []).filter((routine) => routine.planId === id);
    for (const routine of routines) {
      const used = await this.workoutsRepo.count({ index: 'by_routineId', equals: routine.id });
      if (used > 0) return false;
    }
    return true;
  }

  async deletePlan(id: string): Promise<void> {
    const routines = (this._routines() ?? []).filter((routine) => routine.planId === id);

    await this.uow.run(['plans', 'routines'], 'readwrite', async (tx) => {
      for (const routine of routines) {
        await tx.repo('routines').remove(routine.id);
      }
      await tx.repo('plans').remove(id);
    });

    if (this._activePlanId() === id) {
      await this.setActivePlan(null);
    }
    await this.load({ force: true });
  }

  async movePlan(fromIndex: number, toIndex: number): Promise<void> {
    const ordered = this.livePlans();
    const next = indexForMove(ordered, fromIndex, toIndex);
    if (next === null) return;

    const moved = ordered[fromIndex];
    if (!moved) return;
    this.replacePlan(await this.plansRepo.patch(moved.id, { orderIndex: next }));
  }

  // --------------------------------------------------------------- routines

  async createRoutine(options: {
    planId: string | null;
    name: string;
    scheduleType?: Routine['scheduleType'];
  }): Promise<Routine> {
    const siblings = (this._routines() ?? []).filter((r) => r.planId === options.planId);

    const created = await this.routinesRepo.put({
      planId: options.planId,
      name: options.name,
      scheduleType: options.scheduleType ?? (options.planId === null ? 'flexible' : 'scheduled'),
      weekdays: [],
      orderIndex: nextOrderIndex(siblings),
      estimatedDurationMin: null,
      notes: null,
      exercises: [],
      revision: 1,
      isArchived: false,
    } satisfies Draft<Routine>);

    this._routines.update((routines) => (routines === null ? routines : [...routines, created]));
    return created;
  }

  /**
   * Saves a routine, bumping `revision` only for a structural change.
   *
   * Renaming a routine does not make a past workout "based on a different
   * revision"; changing what is performed, how much, or when does.
   */
  async saveRoutine(id: string, changes: Partial<Routine>): Promise<void> {
    const current = this.routineById(id);
    if (!current) return;

    const merged = { ...current, ...changes };
    const patch: Partial<Routine> = { ...changes };

    if (bumpsRevision(current, merged)) {
      patch.revision = current.revision + 1;
    }
    if (changes.exercises) {
      patch.exercises = normaliseSupersets(changes.exercises);
      patch.estimatedDurationMin = estimateRoutineDuration(patch.exercises).minutes;
    }

    this.replaceRoutine(await this.routinesRepo.patch(id, patch));
  }

  async duplicateRoutineById(id: string, name: string): Promise<Routine | undefined> {
    const source = this.routineById(id);
    if (!source) return undefined;

    const created = await this.routinesRepo.put(
      duplicateRoutine(source, { name, newId: () => this.ids.newId() }),
    );
    this._routines.update((routines) => (routines === null ? routines : [...routines, created]));
    return created;
  }

  async setRoutineArchived(id: string, archived: boolean): Promise<void> {
    this.replaceRoutine(await this.routinesRepo.patch(id, { isArchived: archived }));
  }

  async deleteRoutine(id: string): Promise<void> {
    await this.routinesRepo.remove(id);
    this._routines.update((routines) =>
      routines === null ? routines : routines.filter((routine) => routine.id !== id),
    );
  }

  async moveRoutine(planId: string, fromIndex: number, toIndex: number): Promise<void> {
    const ordered = this.routinesForPlan(planId);
    const next = indexForMove(ordered, fromIndex, toIndex);
    if (next === null) return;

    const moved = ordered[fromIndex];
    if (!moved) return;
    this.replaceRoutine(await this.routinesRepo.patch(moved.id, { orderIndex: next }));
  }

  async setWeekdays(id: string, weekdays: Weekday[]): Promise<void> {
    await this.saveRoutine(id, { weekdays: [...weekdays].sort((a, b) => a - b) });
  }

  // ------------------------------------------------------ routine exercises

  async addExercise(
    routineId: string,
    exercise: { exerciseId: string; nameSnapshot: string; restSec?: number | null },
  ): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;

    const added = newRoutineExercise({
      uid: this.ids.newId(),
      exerciseId: exercise.exerciseId,
      nameSnapshot: exercise.nameSnapshot,
      orderIndex: nextOrderIndex(routine.exercises),
      restSec: exercise.restSec ?? null,
    });

    await this.saveRoutine(routineId, { exercises: [...routine.exercises, added] });
  }

  async removeRoutineExercise(routineId: string, uid: string): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;
    await this.saveRoutine(routineId, { exercises: removeExercise(routine.exercises, uid) });
  }

  async configureExercise(
    routineId: string,
    uid: string,
    changes: Partial<RoutineExercise>,
  ): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;

    await this.saveRoutine(routineId, {
      exercises: routine.exercises.map((exercise) =>
        exercise.uid === uid ? { ...exercise, ...changes } : exercise,
      ),
    });
  }

  async moveExercise(routineId: string, fromIndex: number, toIndex: number): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;
    await this.saveRoutine(routineId, {
      exercises: moveWithin(routine.exercises, fromIndex, toIndex),
    });
  }

  async groupExerciseWithNext(routineId: string, uid: string): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;
    await this.saveRoutine(routineId, {
      exercises: groupWithNext(routine.exercises, (exercise) => exercise.uid === uid),
    });
  }

  async ungroupExercise(routineId: string, uid: string): Promise<void> {
    const routine = this.routineById(routineId);
    if (!routine) return;
    await this.saveRoutine(routineId, {
      exercises: ungroup(routine.exercises, (exercise) => exercise.uid === uid),
    });
  }

  // ---------------------------------------------------------------- private

  private replacePlan(updated: Plan): void {
    this._plans.update((plans) =>
      plans === null ? plans : plans.map((plan) => (plan.id === updated.id ? updated : plan)),
    );
  }

  private replaceRoutine(updated: Routine): void {
    this._routines.update((routines) =>
      routines === null
        ? routines
        : routines.map((routine) => (routine.id === updated.id ? updated : routine)),
    );
  }
}
