/**
 * Enumerations. All string literal unions, never numeric: a numeric enum is
 * unreadable in an exported backup and in DevTools, and renumbering one would
 * silently recategorise history.
 *
 * See docs/DATABASE_SPEC.md section 4.
 */

/**
 * The *data* taxonomy: fine-grained, so muscle-distribution analytics can tell
 * front delts from rear delts. The *filter* taxonomy the UI shows is coarser
 * (PRODUCT_SPEC section 4.3); `MUSCLE_ROLLUP` maps one onto the other.
 */
export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'lats'
  | 'upper-back'
  | 'lower-back'
  | 'shoulders'
  | 'front-delts'
  | 'side-delts'
  | 'rear-delts'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'adductors'
  | 'abductors'
  | 'calves'
  | 'abs'
  | 'obliques'
  | 'neck'
  | 'full-body'
  | 'cardio';

/** The twelve categories the exercise library filters by. */
export type MuscleFilter =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs'
  | 'full-body';

export const MUSCLE_FILTERS: readonly MuscleFilter[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
  'full-body',
];

/** Data taxonomy rolled up to the filter the user sees. */
export const MUSCLE_ROLLUP: Readonly<Record<MuscleGroup, MuscleFilter>> = Object.freeze({
  chest: 'chest',
  back: 'back',
  lats: 'back',
  'upper-back': 'back',
  'lower-back': 'back',
  shoulders: 'shoulders',
  'front-delts': 'shoulders',
  'side-delts': 'shoulders',
  'rear-delts': 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  quadriceps: 'quadriceps',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  adductors: 'quadriceps',
  abductors: 'glutes',
  calves: 'calves',
  abs: 'abs',
  obliques: 'abs',
  neck: 'full-body',
  'full-body': 'full-body',
  cardio: 'full-body',
} satisfies Record<MuscleGroup, MuscleFilter>);

export const MUSCLE_GROUPS = Object.keys(MUSCLE_ROLLUP) as readonly MuscleGroup[];

/**
 * Equipment participates in the variant key, so PRs are never compared across
 * it. Adding a value is additive and cannot recategorise existing history.
 */
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'ez-bar'
  | 'trap-bar'
  | 'kettlebell'
  | 'machine'
  | 'cable'
  | 'smith-machine'
  | 'bodyweight'
  | 'pull-up-bar'
  | 'dip-bar'
  | 'bands'
  | 'suspension'
  | 'medicine-ball'
  | 'sled'
  | 'plate'
  | 'bench'
  | 'other';

export const EQUIPMENT: readonly Equipment[] = [
  'barbell',
  'dumbbell',
  'ez-bar',
  'trap-bar',
  'kettlebell',
  'machine',
  'cable',
  'smith-machine',
  'bodyweight',
  'pull-up-bar',
  'dip-bar',
  'bands',
  'suspension',
  'medicine-ball',
  'sled',
  'plate',
  'bench',
  'other',
];

export type ExerciseType =
  'strength' | 'bodyweight' | 'machine' | 'cable' | 'cardio' | 'stretch' | 'olympic' | 'plyometric';

export type MovementPattern =
  | 'horizontal-push'
  | 'vertical-push'
  | 'horizontal-pull'
  | 'vertical-pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'carry'
  | 'rotation'
  | 'isolation'
  | 'other';

export const EXERCISE_TYPES: readonly ExerciseType[] = [
  'strength',
  'bodyweight',
  'machine',
  'cable',
  'cardio',
  'stretch',
  'olympic',
  'plyometric',
];

export const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  'horizontal-push',
  'vertical-push',
  'horizontal-pull',
  'vertical-pull',
  'squat',
  'hinge',
  'lunge',
  'carry',
  'rotation',
  'isolation',
  'other',
];

export type Mechanics = 'compound' | 'isolation';
export type ForceVector = 'push' | 'pull' | 'static';

export const MECHANICS: readonly Mechanics[] = ['compound', 'isolation'];
export const FORCE_VECTORS: readonly ForceVector[] = ['push', 'pull', 'static'];

/** `unilateral-separate` splits set logging per side. */
export type Laterality = 'bilateral' | 'unilateral-alternating' | 'unilateral-separate';

export const LATERALITIES: readonly Laterality[] = [
  'bilateral',
  'unilateral-alternating',
  'unilateral-separate',
];

/**
 * Decides which inputs the tracker shows and how volume and estimated 1RM are
 * computed. A time- or distance-based effort has no meaningful volume, and the
 * UI says so rather than reporting zero.
 */
export type LoadType =
  'external' | 'bodyweight' | 'bodyweight-plus' | 'assisted' | 'time' | 'distance';

export const LOAD_TYPES: readonly LoadType[] = [
  'external',
  'bodyweight',
  'bodyweight-plus',
  'assisted',
  'time',
  'distance',
];

/** Only `working` and `backoff` count toward volume and personal records. */
export type SetType = 'warmup' | 'working' | 'dropset' | 'failure' | 'backoff';

export type Side = 'both' | 'left' | 'right';

export type ScheduleType = 'scheduled' | 'flexible';

export type WorkoutStatus = 'active' | 'paused' | 'completed' | 'discarded';

/** `repeat` means the structure was cloned from a past workout. */
export type WorkoutSource = 'routine' | 'quick' | 'repeat';

export type Feeling = 'great' | 'good' | 'ok' | 'rough';

export type PrType =
  'maxWeight' | 'maxRepsAtWeight' | 'estimated1RM' | 'maxSessionVolume' | 'maxSetVolume';

export type E1rmFormulaName = 'epley' | 'brzycki';

export type Pose = 'front' | 'side-left' | 'side-right' | 'back' | 'other';

export type MeasurementUnitType = 'length' | 'mass' | 'percent' | 'count';

export type RecordSource = 'manual' | 'import';

export type Sex = 'male' | 'female' | 'unspecified';

export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance' | 'general';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

/** 0 = Sunday, matching `Date.prototype.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
