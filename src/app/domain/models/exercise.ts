import type { Entity, Flag } from './entity';
import type {
  Equipment,
  ExerciseType,
  ForceVector,
  Laterality,
  LoadType,
  Mechanics,
  MovementPattern,
  MuscleGroup,
} from './enums';

/** Bundled SVG for built-ins, or a user photo for a custom exercise. */
export type Illustration =
  { kind: 'asset'; path: string } | { kind: 'blob'; blobId: string } | null;

export interface Exercise extends Entity {
  nameEn: string;
  /** Required for built-ins. A custom exercise falls back to `nameEn`. */
  nameAr: string;
  /** True once the user supplies a real Arabic name for a custom exercise. */
  isArTranslated: boolean;

  /**
   * Search and sort keys: lowercased, with Latin diacritics and Arabic tashkeel
   * stripped and alef/ya/ta-marbuta forms folded. Stored rather than derived so
   * an index can be built on them.
   */
  nameNormEn: string;
  nameNormAr: string;
  /** Extra search terms: "bench", "BP", "رفرفة". */
  aliases: string[];

  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  exerciseType: ExerciseType;
  movementPattern: MovementPattern;
  mechanics: Mechanics;
  force: ForceVector | null;
  laterality: Laterality;
  loadType: LoadType;

  instructionsEn: string[];
  instructionsAr: string[];
  cuesEn: string[];
  cuesAr: string[];
  illustration: Illustration;

  /** Overrides the global default rest when set. */
  defaultRestSec: number | null;
  /**
   * Smallest sensible load step for this exercise, in kilograms. Drives
   * progression rounding and the numeric pad's quick-adjust buttons.
   */
  weightIncrementKg: number;

  /** Indexed (by_isCustom), so stored as a flag rather than a boolean. */
  isCustom: Flag;
  /** Hidden from pickers, retained in history. Indexed with nameNormEn. */
  isArchived: Flag;
  /** Not indexed: favourites are filtered from the resident library cache. */
  isFavorite: boolean;

  /** Catalog revision a built-in came from. `null` for custom exercises. */
  builtInVersion: number | null;
  /**
   * Set once the user edits a built-in. Re-seeding must then leave it alone,
   * or a catalog update would silently discard their change.
   */
  userEdited: boolean;

  notes: string | null;
}

/**
 * The scope within which performance is comparable.
 *
 * PRODUCT_SPEC section 4.10 forbids comparing incompatible variations without
 * making the distinction clear. Personal records, "previous performance" and
 * progression suggestions are all keyed by this, so a dumbbell press can never
 * displace a barbell press record.
 */
export function variantKey(exercise: Pick<Exercise, 'id' | 'equipment' | 'laterality'>): string {
  return `${exercise.id}|${exercise.equipment}|${exercise.laterality}`;
}

/** The exercise id a variant key was built from. */
export function exerciseIdFromVariantKey(key: string): string {
  const separator = key.indexOf('|');
  return separator === -1 ? key : key.slice(0, separator);
}
