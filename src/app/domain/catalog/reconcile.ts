import type { CatalogExercise } from '../models/catalog';
import type { Exercise } from '../models/exercise';
import { normalizeSearchText } from '../text/normalize';

/**
 * The fields the shipped catalog owns. Everything else on an exercise belongs
 * to the user and is never written by a catalog update.
 */
export type CatalogOwnedFields = Pick<
  Exercise,
  | 'nameEn'
  | 'nameAr'
  | 'isArTranslated'
  | 'nameNormEn'
  | 'nameNormAr'
  | 'aliases'
  | 'primaryMuscles'
  | 'secondaryMuscles'
  | 'equipment'
  | 'exerciseType'
  | 'movementPattern'
  | 'mechanics'
  | 'force'
  | 'laterality'
  | 'loadType'
  | 'instructionsEn'
  | 'instructionsAr'
  | 'cuesEn'
  | 'cuesAr'
  | 'illustration'
  | 'defaultRestSec'
  | 'weightIncrementKg'
  | 'builtInVersion'
>;

export interface ReconcilePlan {
  /** Exercises in the catalog that the database has never seen. */
  inserts: { id: string; fields: CatalogOwnedFields }[];
  /** Built-ins the user has not edited; definition fields are refreshed. */
  updates: { id: string; fields: CatalogOwnedFields }[];
  /** Built-ins the user edited. Left untouched, and reported so the UI can offer a diff. */
  preserved: string[];
  /** Built-ins no longer in the catalog. Archived, never deleted. */
  archives: string[];
}

export const EMPTY_PLAN: ReconcilePlan = Object.freeze({
  inserts: [],
  updates: [],
  preserved: [],
  archives: [],
});

/**
 * Maps a catalog entry onto the fields a stored exercise takes from it.
 *
 * The normalised search keys are computed here, with the same function the
 * query path uses, so the stored key and the typed query can never disagree.
 */
export function catalogFields(entry: CatalogExercise, version: number): CatalogOwnedFields {
  return {
    nameEn: entry.nameEn,
    nameAr: entry.nameAr,
    isArTranslated: entry.isArTranslated,
    nameNormEn: normalizeSearchText(entry.nameEn),
    nameNormAr: normalizeSearchText(entry.nameAr),
    aliases: entry.aliases,
    primaryMuscles: entry.primaryMuscles,
    secondaryMuscles: entry.secondaryMuscles,
    equipment: entry.equipment,
    exerciseType: entry.exerciseType,
    movementPattern: entry.movementPattern,
    mechanics: entry.mechanics,
    force: entry.force,
    laterality: entry.laterality,
    loadType: entry.loadType,
    instructionsEn: entry.instructionsEn,
    instructionsAr: entry.instructionsAr,
    cuesEn: entry.cuesEn,
    cuesAr: entry.cuesAr,
    illustration: entry.illustration,
    defaultRestSec: entry.defaultRestSec,
    weightIncrementKg: entry.weightIncrementKg,
    builtInVersion: version,
  };
}

/**
 * Decides what a catalog update should do to the stored library.
 *
 * Pure, so every branch is testable without a database. The rules come from
 * DATABASE_SPEC section 6.2, and all of them exist to protect work the user
 * has done:
 *
 *   - a custom exercise is never touched, under any circumstances
 *   - a built-in the user has edited is left exactly as they left it; a
 *     catalog update silently discarding their correction would be worse than
 *     shipping a stale definition
 *   - a built-in that disappears from the catalog is archived, never deleted,
 *     because completed workouts reference it and history must stay readable
 *   - favourites, notes and the user's own archive choice survive every update
 */
export function reconcileCatalog(
  existing: readonly Exercise[],
  catalog: readonly CatalogExercise[],
  version: number,
): ReconcilePlan {
  const byId = new Map(existing.map((exercise) => [exercise.id, exercise]));
  const catalogIds = new Set(catalog.map((entry) => entry.id));

  const inserts: ReconcilePlan['inserts'] = [];
  const updates: ReconcilePlan['updates'] = [];
  const preserved: string[] = [];

  for (const entry of catalog) {
    const current = byId.get(entry.id);
    const fields = catalogFields(entry, version);

    if (!current) {
      inserts.push({ id: entry.id, fields });
      continue;
    }

    // A custom exercise that happens to share an id is the user's, not ours.
    if (current.isCustom === 1) {
      preserved.push(entry.id);
      continue;
    }

    if (current.userEdited) {
      preserved.push(entry.id);
      continue;
    }

    if (current.builtInVersion === version) {
      continue; // Already current; nothing to write.
    }

    updates.push({ id: entry.id, fields });
  }

  const archives = existing
    .filter(
      (exercise) =>
        exercise.isCustom === 0 &&
        exercise.isArchived === 0 &&
        exercise.deletedAt === null &&
        !catalogIds.has(exercise.id),
    )
    .map((exercise) => exercise.id);

  return { inserts, updates, preserved, archives };
}

/** True when the plan would change nothing, so the write can be skipped. */
export function isNoOp(plan: ReconcilePlan): boolean {
  return plan.inserts.length === 0 && plan.updates.length === 0 && plan.archives.length === 0;
}
