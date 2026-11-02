import type { Exercise } from './exercise';

/**
 * A built-in exercise as it ships.
 *
 * Deliberately not a full `Exercise`: the envelope is applied at seed time, and
 * the user-owned fields (`isFavorite`, `userEdited`, `notes`) are absent so a
 * catalog update can never overwrite them.
 *
 * The normalised search keys are absent too. They are computed during seeding
 * with the same `normalizeSearchText` the query path uses — baking them into
 * the JSON would mean a second implementation in the build script that could
 * drift from the real one, producing searches that fail only for some inputs.
 */
export type CatalogExercise = Omit<
  Exercise,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'rev'
  | 'origin'
  | 'nameNormEn'
  | 'nameNormAr'
  | 'isFavorite'
  | 'userEdited'
  | 'notes'
  | 'builtInVersion'
> & { id: string };

export interface ExerciseCatalog {
  /** Bumped when the catalog content changes; drives re-seed reconciliation. */
  version: number;
  exercises: CatalogExercise[];
}

/**
 * Current catalog revision. Increment whenever the shipped content changes so
 * existing installs reconcile on next launch (DATABASE_SPEC section 6.2).
 */
export const CATALOG_VERSION = 1;
