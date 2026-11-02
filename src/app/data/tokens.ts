import { InjectionToken } from '@angular/core';
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
import type { Repository } from './repository';
import type { EntityStoreName, StoreEntityMap } from './stores';

/**
 * One injection token per aggregate.
 *
 * Stores inject these, so a test provides an in-memory fake and a Version 2
 * cloud repository binds to the same token without a single caller changing.
 */
export const PROFILE_REPO = new InjectionToken<Repository<Profile>>('PROFILE_REPO');
export const EXERCISES_REPO = new InjectionToken<Repository<Exercise>>('EXERCISES_REPO');
export const PLANS_REPO = new InjectionToken<Repository<Plan>>('PLANS_REPO');
export const ROUTINES_REPO = new InjectionToken<Repository<Routine>>('ROUTINES_REPO');
export const WORKOUTS_REPO = new InjectionToken<Repository<Workout>>('WORKOUTS_REPO');
export const WORKOUT_EXERCISES_REPO = new InjectionToken<Repository<WorkoutExercise>>(
  'WORKOUT_EXERCISES_REPO',
);
export const SET_LOGS_REPO = new InjectionToken<Repository<SetLog>>('SET_LOGS_REPO');
export const MEASUREMENTS_REPO = new InjectionToken<Repository<Measurement>>('MEASUREMENTS_REPO');
export const CUSTOM_MEASUREMENT_DEFS_REPO = new InjectionToken<Repository<CustomMeasurementDef>>(
  'CUSTOM_MEASUREMENT_DEFS_REPO',
);
export const PHOTOS_REPO = new InjectionToken<Repository<Photo>>('PHOTOS_REPO');
export const PERSONAL_RECORDS_REPO = new InjectionToken<Repository<PersonalRecord>>(
  'PERSONAL_RECORDS_REPO',
);
export const OUTBOX_REPO = new InjectionToken<Repository<OutboxEntry>>('OUTBOX_REPO');

export type RepositoryTokens = {
  [N in EntityStoreName]: InjectionToken<Repository<StoreEntityMap[N]>>;
};

/** Lets the composition root provide every repository in one loop. */
export const REPOSITORY_TOKENS: RepositoryTokens = {
  profile: PROFILE_REPO,
  exercises: EXERCISES_REPO,
  plans: PLANS_REPO,
  routines: ROUTINES_REPO,
  workouts: WORKOUTS_REPO,
  workoutExercises: WORKOUT_EXERCISES_REPO,
  setLogs: SET_LOGS_REPO,
  measurements: MEASUREMENTS_REPO,
  customMeasurementDefs: CUSTOM_MEASUREMENT_DEFS_REPO,
  photos: PHOTOS_REPO,
  personalRecords: PERSONAL_RECORDS_REPO,
  outbox: OUTBOX_REPO,
};
