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
} from '../domain/models';

/**
 * Maps a store name to the entity it holds, so `tx.repo('setLogs')` is typed
 * without the caller restating the entity type.
 *
 * `appMeta` and `photoBlobs` are absent on purpose: neither holds `Entity`
 * records. appMeta is a key/value table of app-local pointers, and photoBlobs
 * holds raw pixels. Both get their own narrow accessors rather than being
 * forced through a repository that would stamp them with a sync envelope they
 * have no use for.
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

export type StoreName = EntityStoreName | 'appMeta' | 'photoBlobs';

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

export const STORE_NAMES: readonly StoreName[] = [...ENTITY_STORE_NAMES, 'appMeta', 'photoBlobs'];
