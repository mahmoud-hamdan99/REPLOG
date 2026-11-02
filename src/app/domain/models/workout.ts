import type { Entity } from './entity';
import type {
  Feeling,
  Laterality,
  LoadType,
  ScheduleType,
  SetType,
  Side,
  WorkoutSource,
  WorkoutStatus,
} from './enums';
import type { TrackingMode } from './prefs';
import type { RoutineExercise } from './training';

/** An open-ended `until` means the workout is paused right now. */
export interface Pause {
  at: string;
  until: string | null;
}

/**
 * Frozen copy of the plan a workout came from.
 *
 * PRODUCT_SPEC section 4.6: editing a workout template must never silently
 * modify completed history. Every read path renders from this snapshot, and
 * `planId`/`routineId` are kept only as provenance. Deleting a routine
 * therefore cannot orphan or mutate a past workout.
 */
export interface PlanSnapshot {
  planId: string | null;
  planName: string | null;
  routineId: string | null;
  routineName: string;
  routineRevision: number;
  scheduleType: ScheduleType;
}

export interface Workout extends Entity {
  /** At most one `active` or `paused` record exists; checked at boot. */
  status: WorkoutStatus;
  startedAt: string;
  finishedAt: string | null;
  /**
   * Local calendar day derived from `startedAt` at write time and stored so it
   * can be indexed. Local, not UTC: a 23:30 session belongs to its own day.
   */
  dayKey: string;
  name: string;
  planId: string | null;
  routineId: string | null;
  planSnapshot: PlanSnapshot | null;
  source: WorkoutSource;
  pauses: Pause[];
  /** Active time, excluding pauses. Authoritative once completed. */
  durationSec: number;
  /** Working sets only. Zero until the workout is completed. */
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  exerciseCount: number;
  /** Snapshot of the nearest body weight, so bodyweight volume is meaningful. */
  bodyWeightKg: number | null;
  notes: string | null;
  perceivedEffort: number | null;
  feeling: Feeling | null;
  /** Cached for the history list badge. */
  prCount: number;
  trackingMode: TrackingMode;
  /** Owning tab while the session is live, for the multi-tab guard. */
  tabId: string | null;
  heartbeatAt: string | null;
  discardedReason: string | null;
  /** Set when a completed workout is corrected after the fact. */
  editedAt: string | null;
}

/** What the plan asked for, frozen at the moment the workout started. */
export type TargetSnapshot = Pick<
  RoutineExercise,
  'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'targetWeightKg' | 'targetRpe' | 'restSec'
>;

export interface WorkoutExercise extends Entity {
  workoutId: string;
  /** Denormalised so per-exercise history is one indexed cursor, not a scan. */
  exerciseId: string;
  variantKey: string;
  nameSnapshot: string;
  /** Links back to the plan slot, or `null` for an ad-hoc addition. */
  routineExerciseUid: string | null;
  /** Denormalised from the workout to support the compound index. */
  startedAt: string;
  dayKey: string;
  orderIndex: number;
  supersetGroup: string | null;
  supersetOrder: number | null;
  targetSnapshot: TargetSnapshot | null;
  /** Snapshotted so historical rendering never depends on a later library edit. */
  loadType: LoadType;
  laterality: Laterality;
  restSec: number | null;
  notes: string | null;
  /** Skipped but retained, so the plan's intent stays visible in history. */
  isSkipped: boolean;
  completedSetCount: number;
  volumeKg: number;
}

/** The atomic record of training. */
export interface SetLog extends Entity {
  workoutId: string;
  workoutExerciseId: string;
  /** The denormalised chain is the cost of IndexedDB having no joins. */
  exerciseId: string;
  variantKey: string;
  dayKey: string;
  /** Zero-based within the exercise, including warm-ups. */
  setIndex: number;
  setType: SetType;
  /** `both` unless the exercise is `unilateral-separate`. */
  side: Side;
  weightKg: number | null;
  /** For bodyweight-plus and assisted work; negative means assistance. */
  extraWeightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  rir: number | null;
  /** `false` marks a planned or draft row that was never confirmed. */
  isCompleted: boolean;
  /** Cached badge. `personalRecords` remains the authoritative source. */
  isPr: boolean;
  completedAt: string | null;
  /** Measured, not planned. */
  restTakenSec: number | null;
  /** Precomputed. `null` when not computable rather than a fabricated number. */
  e1rmKg: number | null;
  volumeKg: number | null;
  notes: string | null;
}
