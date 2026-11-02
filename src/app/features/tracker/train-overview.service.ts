import { computed, inject, Service, signal } from '@angular/core';
import { WORKOUTS_REPO } from '../../data/tokens';
import type { Workout } from '../../domain/models/workout';

/**
 * What the Train start screen needs to know about the past.
 *
 * Only two questions: what was the last completed session (for "Repeat last
 * workout"), and when was each routine last performed (for "last done 7d ago").
 * Both come off indexes rather than a scan — `by_status_startedAt` descending
 * for the first, `by_routineId` for the second.
 *
 * Deliberately not a history store: paging, filtering and per-exercise caches
 * are Phase 6's problem, and building half of it here would mean building it
 * twice.
 */
@Service()
export class TrainOverview {
  private readonly workouts = inject(WORKOUTS_REPO);

  private readonly _last = signal<Workout | null>(null);
  private readonly _lastDone = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _loaded = signal(false);

  readonly lastWorkout = this._last.asReadonly();
  readonly isLoaded = this._loaded.asReadonly();
  readonly canRepeat = computed(() => this._last() !== null);

  /** ISO instant a routine was last performed, or `undefined` if never. */
  lastDone(routineId: string): string | undefined {
    return this._lastDone().get(routineId);
  }

  async load(routineIds: readonly string[]): Promise<void> {
    const [recent, perRoutine] = await Promise.all([
      this.workouts.list({
        index: 'by_status_startedAt',
        // A string range over the compound key: everything with status
        // 'completed', newest first.
        range: { lower: ['completed'], upper: ['completed', '￿'] },
        direction: 'prev',
        limit: 1,
      }),
      Promise.all(
        routineIds.map(async (routineId) => {
          const sessions = await this.workouts.list({
            index: 'by_routineId',
            equals: routineId,
          });
          const completed = sessions
            .filter((workout) => workout.status === 'completed')
            .map((workout) => workout.startedAt)
            .sort();
          return [routineId, completed.at(-1)] as const;
        }),
      ),
    ]);

    this._last.set(recent[0] ?? null);
    this._lastDone.set(
      new Map(
        perRoutine.filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
      ),
    );
    this._loaded.set(true);
  }
}
