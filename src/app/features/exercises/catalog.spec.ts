import {
  EQUIPMENT,
  EXERCISE_TYPES,
  FORCE_VECTORS,
  LATERALITIES,
  LOAD_TYPES,
  MECHANICS,
  MOVEMENT_PATTERNS,
  MUSCLE_FILTERS,
  MUSCLE_GROUPS,
  MUSCLE_ROLLUP,
  type MuscleGroup,
} from '../../domain/models/enums';
import { CATALOG_VERSION } from '../../domain/models/catalog';
import { normalizeSearchText } from '../../domain/text/normalize';
import catalogJson from './data/exercises.v1.json';

/**
 * Validates the shipped catalog against the real TypeScript unions.
 *
 * `scripts/build-catalog.mjs` runs the same structural checks for fast
 * feedback, but it cannot import TypeScript, so its enum lists are a copy that
 * could drift. This spec is the authority: it imports the actual exported
 * arrays, so adding a value to an enum without teaching the builder about it
 * fails here rather than shipping a catalog the app cannot interpret.
 */
const catalog = catalogJson as {
  version: number;
  exercises: Record<string, unknown>[];
};

const exercises = catalog.exercises;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Contains at least one character in the Arabic block. */
const hasArabic = (value: string): boolean => /[؀-ۿ]/.test(value);

describe('shipped exercise catalog', () => {
  it('declares the version the app expects', () => {
    expect(catalog.version).toBe(CATALOG_VERSION);
  });

  it('is not empty', () => {
    expect(exercises.length).toBeGreaterThan(100);
  });

  it('gives every exercise a unique kebab-case id', () => {
    const ids = exercises.map((e) => str(e['id']));
    expect(new Set(ids).size).toBe(ids.length);

    const malformed = ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
    expect(malformed).toEqual([]);
  });

  it('uses only declared enum members', () => {
    const problems: string[] = [];
    const check = (id: string, field: string, value: unknown, allowed: readonly string[]) => {
      if (!allowed.includes(str(value))) {
        problems.push(`${id}.${field} = ${JSON.stringify(value)}`);
      }
    };

    for (const exercise of exercises) {
      const id = str(exercise['id']);
      check(id, 'equipment', exercise['equipment'], EQUIPMENT);
      check(id, 'exerciseType', exercise['exerciseType'], EXERCISE_TYPES);
      check(id, 'movementPattern', exercise['movementPattern'], MOVEMENT_PATTERNS);
      check(id, 'mechanics', exercise['mechanics'], MECHANICS);
      check(id, 'laterality', exercise['laterality'], LATERALITIES);
      check(id, 'loadType', exercise['loadType'], LOAD_TYPES);

      if (exercise['force'] !== null) {
        check(id, 'force', exercise['force'], FORCE_VECTORS);
      }
      for (const muscle of [
        ...arr(exercise['primaryMuscles']),
        ...arr(exercise['secondaryMuscles']),
      ]) {
        check(id, 'muscle', muscle, MUSCLE_GROUPS);
      }
    }

    expect(problems).toEqual([]);
  });

  it('gives every exercise at least one primary muscle', () => {
    const without = exercises
      .filter((e) => arr(e['primaryMuscles']).length === 0)
      .map((e) => str(e['id']));
    expect(without).toEqual([]);
  });

  it('names every exercise in both languages', () => {
    const missingEn = exercises.filter((e) => str(e['nameEn']).trim() === '');
    const missingAr = exercises.filter((e) => str(e['nameAr']).trim() === '');
    expect(missingEn.map((e) => str(e['id']))).toEqual([]);
    expect(missingAr.map((e) => str(e['id']))).toEqual([]);
  });

  it('writes the Arabic name in Arabic script', () => {
    // Catches a copy-paste that left the English name in the Arabic field.
    const notArabic = exercises
      .filter((e) => !hasArabic(str(e['nameAr'])))
      .map((e) => str(e['id']));
    expect(notArabic).toEqual([]);
  });

  /**
   * A filter chip that returns nothing is a broken promise. PRODUCT_SPEC
   * section 4.3 lists twelve categories; each must be worth tapping.
   */
  it('covers every filter category with at least twelve exercises', () => {
    const counts = new Map<string, number>(MUSCLE_FILTERS.map((filter) => [filter, 0]));

    for (const exercise of exercises) {
      const filters = new Set(
        arr(exercise['primaryMuscles']).map((m) => MUSCLE_ROLLUP[m as MuscleGroup]),
      );
      for (const filter of filters) {
        if (filter && counts.has(filter)) {
          counts.set(filter, (counts.get(filter) ?? 0) + 1);
        }
      }
    }

    const thin = [...counts.entries()].filter(([, count]) => count < 12);
    expect(thin).toEqual([]);
  });

  it('keeps English and Arabic instruction steps in step', () => {
    const mismatched = exercises
      .filter((e) => arr(e['instructionsEn']).length !== arr(e['instructionsAr']).length)
      .map((e) => str(e['id']));
    expect(mismatched).toEqual([]);
  });

  it('gives every exercise a positive weight increment', () => {
    const bad = exercises
      .filter(
        (e) =>
          typeof e['weightIncrementKg'] !== 'number' || (e['weightIncrementKg'] as number) <= 0,
      )
      .map((e) => str(e['id']));
    expect(bad).toEqual([]);
  });

  it('ships every exercise as a live built-in', () => {
    // isCustom and isArchived are indexable flags, not booleans.
    const wrong = exercises
      .filter((e) => e['isCustom'] !== 0 || e['isArchived'] !== 0)
      .map((e) => str(e['id']));
    expect(wrong).toEqual([]);
  });

  it('omits the fields that belong to the user, not the catalog', () => {
    // A catalog update must never be able to overwrite a favourite or a note.
    const leaked = exercises.filter(
      (e) => 'isFavorite' in e || 'userEdited' in e || 'notes' in e || 'rev' in e,
    );
    expect(leaked.map((e) => str(e['id']))).toEqual([]);
  });

  it('omits normalised search keys, which are computed at seed time', () => {
    const leaked = exercises.filter((e) => 'nameNormEn' in e || 'nameNormAr' in e);
    expect(leaked.map((e) => str(e['id']))).toEqual([]);
  });

  it('has no two exercises whose normalised English names collide', () => {
    const byName = new Map<string, string[]>();
    for (const exercise of exercises) {
      const key = normalizeSearchText(str(exercise['nameEn']));
      byName.set(key, [...(byName.get(key) ?? []), str(exercise['id'])]);
    }
    const collisions = [...byName.entries()].filter(([, ids]) => ids.length > 1);
    expect(collisions).toEqual([]);
  });

  it('includes the staple lifts a user will look for first', () => {
    const ids = new Set(exercises.map((e) => str(e['id'])));
    for (const staple of [
      'barbell-bench-press',
      'back-squat',
      'deadlift',
      'overhead-press',
      'pull-up',
      'barbell-row',
    ]) {
      expect(ids.has(staple), `missing staple: ${staple}`).toBe(true);
    }
  });
});
