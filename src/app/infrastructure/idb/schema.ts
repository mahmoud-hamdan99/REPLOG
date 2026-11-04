import { EXPECTED_SCHEMA_VERSION } from '../../data/schema-version';
import type { StoreName } from '../../data/stores';

export const DB_NAME = 'replog';

/**
 * The database version, which is the expected schema version.
 *
 * Re-exported from `data/` rather than declared here: the integrity check is
 * a feature and may not import from `infrastructure/`, so the number lives in
 * the layer both are allowed to see.
 */
export const DB_VERSION = EXPECTED_SCHEMA_VERSION;

export interface IndexDef {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

export interface StoreDef {
  name: StoreName;
  keyPath: string;
  indexes: readonly IndexDef[];
}

/**
 * Every store and index, mirroring docs/DATABASE_SPEC.md section 3.
 *
 * The index set is derived backwards from the query catalog in section 8: each
 * one exists to make a specific screen's read O(result) instead of a full scan.
 * An index with no query behind it is dead weight on every write.
 *
 * Note on nullable index key paths: IndexedDB silently omits a record whose key
 * path is null. That is relied on deliberately — an uncompleted set has a null
 * `completedAt` and is therefore absent from the progression indexes, which is
 * exactly what a progression chart wants.
 */
export const STORES: readonly StoreDef[] = [
  { name: 'appMeta', keyPath: 'key', indexes: [] },

  { name: 'profile', keyPath: 'id', indexes: [] },

  {
    name: 'exercises',
    keyPath: 'id',
    indexes: [
      { name: 'by_primaryMuscle', keyPath: 'primaryMuscles', options: { multiEntry: true } },
      { name: 'by_equipment', keyPath: 'equipment' },
      { name: 'by_type', keyPath: 'exerciseType' },
      { name: 'by_movementPattern', keyPath: 'movementPattern' },
      { name: 'by_isCustom', keyPath: 'isCustom' },
      { name: 'by_nameNorm', keyPath: 'nameNormEn' },
      // Q18: the default library listing (live, alphabetical) in one cursor.
      { name: 'by_isArchived_nameNorm', keyPath: ['isArchived', 'nameNormEn'] },
    ],
  },

  {
    name: 'plans',
    keyPath: 'id',
    indexes: [
      { name: 'by_isArchived', keyPath: 'isArchived' },
      { name: 'by_updatedAt', keyPath: 'updatedAt' },
      { name: 'by_orderIndex', keyPath: 'orderIndex' },
    ],
  },

  {
    name: 'routines',
    keyPath: 'id',
    indexes: [
      { name: 'by_planId', keyPath: 'planId' },
      { name: 'by_planId_orderIndex', keyPath: ['planId', 'orderIndex'] },
      // Q4: what is scheduled today.
      { name: 'by_weekday', keyPath: 'weekdays', options: { multiEntry: true } },
      { name: 'by_scheduleType', keyPath: 'scheduleType' },
    ],
  },

  {
    name: 'workouts',
    keyPath: 'id',
    indexes: [
      { name: 'by_startedAt', keyPath: 'startedAt' },
      { name: 'by_status', keyPath: 'status' },
      // Q2, Q11: completed history without filtering in JavaScript.
      { name: 'by_status_startedAt', keyPath: ['status', 'startedAt'] },
      { name: 'by_dayKey', keyPath: 'dayKey' },
      { name: 'by_routineId', keyPath: 'routineId' },
    ],
  },

  {
    name: 'workoutExercises',
    keyPath: 'id',
    indexes: [
      { name: 'by_workoutId', keyPath: 'workoutId' },
      { name: 'by_workoutId_orderIndex', keyPath: ['workoutId', 'orderIndex'] },
      { name: 'by_exerciseId', keyPath: 'exerciseId' },
      // Q7: "previous performance" is one backwards cursor hit on this.
      { name: 'by_exerciseId_startedAt', keyPath: ['exerciseId', 'startedAt'] },
    ],
  },

  {
    name: 'setLogs',
    keyPath: 'id',
    indexes: [
      { name: 'by_workoutExerciseId', keyPath: 'workoutExerciseId' },
      { name: 'by_workoutExerciseId_setIndex', keyPath: ['workoutExerciseId', 'setIndex'] },
      { name: 'by_workoutId', keyPath: 'workoutId' },
      // Q8: progression charts and personal-record scans.
      { name: 'by_exerciseId_completedAt', keyPath: ['exerciseId', 'completedAt'] },
      { name: 'by_variantKey_completedAt', keyPath: ['variantKey', 'completedAt'] },
      { name: 'by_dayKey', keyPath: 'dayKey' },
    ],
  },

  {
    name: 'measurements',
    keyPath: 'id',
    indexes: [
      { name: 'by_measuredAt', keyPath: 'measuredAt' },
      { name: 'by_hasWeight', keyPath: 'hasWeight' },
    ],
  },

  {
    name: 'customMeasurementDefs',
    keyPath: 'id',
    indexes: [{ name: 'by_isArchived_orderIndex', keyPath: ['isArchived', 'orderIndex'] }],
  },

  {
    name: 'photos',
    keyPath: 'id',
    indexes: [
      { name: 'by_takenAt', keyPath: 'takenAt' },
      { name: 'by_pose_takenAt', keyPath: ['pose', 'takenAt'] },
    ],
  },

  {
    name: 'photoBlobs',
    keyPath: 'id',
    // Lets the storage meter sum image sizes by walking index keys, without
    // loading a single buffer into memory.
    indexes: [{ name: 'by_byteSize', keyPath: 'byteSize' }],
  },

  {
    name: 'personalRecords',
    keyPath: 'id',
    indexes: [
      // Q9, Q10: current record is the last entry; history is the full range.
      {
        name: 'by_variantKey_type_achievedAt',
        keyPath: ['variantKey', 'prType', 'achievedAt'],
      },
      { name: 'by_isCurrent', keyPath: 'isCurrent' },
      { name: 'by_achievedAt', keyPath: 'achievedAt' },
      { name: 'by_exerciseId', keyPath: 'exerciseId' },
    ],
  },

  {
    // Declared now and unused in Version 1, so Version 2 sync needs no upgrade
    // against a database already full of user data. A test asserts it is empty.
    name: 'outbox',
    keyPath: 'id',
    indexes: [
      { name: 'by_createdAt', keyPath: 'createdAt' },
      { name: 'by_state', keyPath: 'state' },
    ],
  },
];

export const STORE_DEFS_BY_NAME: ReadonlyMap<StoreName, StoreDef> = new Map(
  STORES.map((store) => [store.name, store]),
);
