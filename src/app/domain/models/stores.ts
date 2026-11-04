import type {
  CustomMeasurementDef,
  Exercise,
  Measurement,
  OutboxEntry,
  PersonalRecord,
  Photo,
  Plan,
  Profile,
  Routine,
  SetLog,
  Workout,
  WorkoutExercise,
} from './index';

/**
 * What the database holds, named once.
 *
 * In `domain/` rather than in `data/` because the backup format needs it and
 * `domain/` may not import from `data/`. The storage layer re-exports these,
 * so there is still one list: a store added here appears in the repository
 * tokens, the export, the import validator and the integrity check together,
 * rather than in whichever of them somebody remembered.
 */
export interface StoreEntityMap {
  profile: Profile;
  exercises: Exercise;
  plans: Plan;
  routines: Routine;
  workouts: Workout;
  workoutExercises: WorkoutExercise;
  setLogs: SetLog;
  measurements: Measurement;
  customMeasurementDefs: CustomMeasurementDef;
  photos: Photo;
  personalRecords: PersonalRecord;
  outbox: OutboxEntry;
}

export type EntityStoreName = keyof StoreEntityMap;

/**
 * Order matters on import: a parent is written before the children that
 * reference it, so a failure halfway leaves orphans rather than danglers.
 */
export const ENTITY_STORE_NAMES: readonly EntityStoreName[] = [
  'profile',
  'exercises',
  'plans',
  'routines',
  'workouts',
  'workoutExercises',
  'setLogs',
  'measurements',
  'customMeasurementDefs',
  'photos',
  'personalRecords',
  'outbox',
];

/**
 * Stores a backup carries.
 *
 * `outbox` is excluded: it is a queue of pending sync work for a Version 2
 * that does not exist yet, and restoring one device's queue onto another is
 * meaningless at best.
 */
export const BACKUP_STORE_NAMES: readonly EntityStoreName[] = ENTITY_STORE_NAMES.filter(
  (store) => store !== 'outbox',
);
