import type { Entity, Flag } from './entity';
import type { ScheduleType, TrainingGoal, Weekday } from './enums';
import type { TrackingMode } from './prefs';

/** A program: a named collection of routines, e.g. "Push/Pull/Legs 2026". */
export interface Plan extends Entity {
  name: string;
  description: string | null;
  goal: TrainingGoal | null;
  /** Mirrors the display preference at creation time. */
  weekStartsOn: Weekday;
  /** A token name from the design system, never a free hex value. */
  accentColor: string | null;
  /** Indexed (by_isArchived), so stored as a flag. */
  isArchived: Flag;
  /**
   * Sparse integers (1000, 2000, ...) so a reorder is one write rather than a
   * renumber of the whole list.
   */
  orderIndex: number;
  /** Informational only; Version 1 has no periodisation. */
  durationWeeks: number | null;
}

/**
 * One exercise slot inside a routine.
 *
 * Embedded in the routine document rather than stored separately: these are
 * always read and written together, a reorder should be atomic, and a routine
 * with fifteen exercises is roughly 4 kB. See docs/ARCHITECTURE.md decision D9.
 */
export interface RoutineExercise {
  /** Stable within the routine, and survives reordering. */
  uid: string;
  exerciseId: string;
  /**
   * Rendered if the exercise is later deleted. Deliberately not kept in step
   * with a renamed exercise: the routine records what was chosen at the time.
   */
  nameSnapshot: string;
  orderIndex: number;
  /** Shared by grouped exercises; `null` means standalone. */
  supersetGroup: string | null;
  supersetOrder: number | null;
  targetSets: number;
  targetRepsMin: number | null;
  /** Equal to `targetRepsMin` for a fixed target rather than a range. */
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
  restSec: number | null;
  warmupSets: number;
  trackingMode: TrackingMode | null;
  notes: string | null;
  isOptional: boolean;
}

/** A single workout day. */
export interface Routine extends Entity {
  /** `null` for a standalone flexible routine owned by no plan. */
  planId: string | null;
  name: string;
  scheduleType: ScheduleType;
  /** Empty for a flexible routine; `[1, 4]` means Monday and Thursday. */
  weekdays: Weekday[];
  orderIndex: number;
  estimatedDurationMin: number | null;
  notes: string | null;
  exercises: RoutineExercise[];
  /**
   * Incremented on any structural edit and copied into workout snapshots, so
   * history can say which revision it was based on.
   */
  revision: number;
  isArchived: boolean;
}
