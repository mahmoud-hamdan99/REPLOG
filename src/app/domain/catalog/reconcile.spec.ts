import type { CatalogExercise } from '../models/catalog';
import type { Exercise } from '../models/exercise';
import { catalogFields, isNoOp, reconcileCatalog, EMPTY_PLAN } from './reconcile';

const entry = (id: string, overrides: Partial<CatalogExercise> = {}): CatalogExercise =>
  ({
    id,
    nameEn: 'Bench Press',
    nameAr: 'ضغط البنش',
    isArTranslated: true,
    aliases: ['bench'],
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: 'barbell',
    exerciseType: 'strength',
    movementPattern: 'horizontal-push',
    mechanics: 'compound',
    force: 'push',
    laterality: 'bilateral',
    loadType: 'external',
    instructionsEn: [],
    instructionsAr: [],
    cuesEn: [],
    cuesAr: [],
    illustration: null,
    defaultRestSec: 180,
    weightIncrementKg: 2.5,
    isCustom: 0,
    isArchived: 0,
    ...overrides,
  }) as CatalogExercise;

const stored = (id: string, overrides: Partial<Exercise> = {}): Exercise =>
  ({
    ...entry(id),
    nameNormEn: 'bench press',
    nameNormAr: 'ضغط البنش',
    builtInVersion: 1,
    isFavorite: false,
    userEdited: false,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    origin: 'device',
    ...overrides,
  }) as Exercise;

describe('catalogFields', () => {
  it('computes normalised search keys with the query-path normaliser', () => {
    const fields = catalogFields(entry('x', { nameEn: 'Close-Grip Bench', nameAr: 'ضَغْط' }), 3);
    expect(fields.nameNormEn).toBe('close grip bench');
    expect(fields.nameNormAr).toBe('ضغط');
  });

  it('stamps the catalog version it came from', () => {
    expect(catalogFields(entry('x'), 7).builtInVersion).toBe(7);
  });

  it('carries no user-owned fields', () => {
    const fields = catalogFields(entry('x'), 1) as Record<string, unknown>;
    expect('isFavorite' in fields).toBe(false);
    expect('notes' in fields).toBe(false);
    expect('userEdited' in fields).toBe(false);
    expect('isArchived' in fields).toBe(false);
  });
});

describe('reconcileCatalog', () => {
  it('inserts everything into an empty library', () => {
    const plan = reconcileCatalog([], [entry('a'), entry('b')], 1);

    expect(plan.inserts.map((i) => i.id)).toEqual(['a', 'b']);
    expect(plan.updates).toEqual([]);
    expect(plan.archives).toEqual([]);
  });

  it('does nothing when every built-in is already at the current version', () => {
    const plan = reconcileCatalog([stored('a', { builtInVersion: 2 })], [entry('a')], 2);

    expect(isNoOp(plan)).toBe(true);
  });

  it('refreshes an unedited built-in when the catalog version moves on', () => {
    const existing = stored('a', { builtInVersion: 1, nameEn: 'Old Name' });
    const plan = reconcileCatalog([existing], [entry('a', { nameEn: 'New Name' })], 2);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.fields.nameEn).toBe('New Name');
    expect(plan.updates[0]?.fields.builtInVersion).toBe(2);
  });

  /**
   * The rule that matters most: a catalog update silently discarding a user's
   * correction would be worse than shipping a stale definition.
   */
  it('leaves a user-edited built-in exactly as the user left it', () => {
    const edited = stored('a', { builtInVersion: 1, userEdited: true, nameEn: 'My Version' });
    const plan = reconcileCatalog([edited], [entry('a', { nameEn: 'Upstream Name' })], 2);

    expect(plan.updates).toEqual([]);
    expect(plan.preserved).toEqual(['a']);
  });

  it('never touches a custom exercise, even on an id collision', () => {
    const custom = stored('a', { isCustom: 1, builtInVersion: null, nameEn: 'Mine' });
    const plan = reconcileCatalog([custom], [entry('a', { nameEn: 'Upstream' })], 2);

    expect(plan.updates).toEqual([]);
    expect(plan.archives).toEqual([]);
    expect(plan.preserved).toEqual(['a']);
  });

  it('inserts a newly added exercise alongside existing ones', () => {
    const plan = reconcileCatalog(
      [stored('a', { builtInVersion: 2 })],
      [entry('a'), entry('b')],
      2,
    );

    expect(plan.inserts.map((i) => i.id)).toEqual(['b']);
    expect(plan.updates).toEqual([]);
  });

  /**
   * Completed workouts reference exercises by id, so a removed exercise is
   * archived rather than deleted: history has to stay readable.
   */
  it('archives a built-in that left the catalog, rather than deleting it', () => {
    const plan = reconcileCatalog([stored('gone', { builtInVersion: 1 })], [entry('a')], 2);

    expect(plan.archives).toEqual(['gone']);
    expect(plan.inserts.map((i) => i.id)).toEqual(['a']);
  });

  it('does not archive a custom exercise just because it is not in the catalog', () => {
    const plan = reconcileCatalog([stored('mine', { isCustom: 1 })], [entry('a')], 2);
    expect(plan.archives).toEqual([]);
  });

  it('does not re-archive something already archived', () => {
    const plan = reconcileCatalog([stored('gone', { isArchived: 1 })], [entry('a')], 2);
    expect(plan.archives).toEqual([]);
  });

  it('does not archive a soft-deleted record', () => {
    const plan = reconcileCatalog(
      [stored('gone', { deletedAt: '2026-02-01T00:00:00.000Z' })],
      [entry('a')],
      2,
    );
    expect(plan.archives).toEqual([]);
  });

  it('handles a realistic mixed update in one pass', () => {
    const existing = [
      stored('unchanged', { builtInVersion: 2 }),
      stored('stale', { builtInVersion: 1 }),
      stored('edited', { builtInVersion: 1, userEdited: true }),
      stored('custom', { isCustom: 1 }),
      stored('removed', { builtInVersion: 1 }),
    ];
    const catalog = [entry('unchanged'), entry('stale'), entry('edited'), entry('added')];

    const plan = reconcileCatalog(existing, catalog, 2);

    expect(plan.inserts.map((i) => i.id)).toEqual(['added']);
    expect(plan.updates.map((u) => u.id)).toEqual(['stale']);
    expect(plan.preserved).toEqual(['edited']);
    expect(plan.archives).toEqual(['removed']);
    expect(isNoOp(plan)).toBe(false);
  });
});

describe('isNoOp', () => {
  it('is true for the empty plan', () => {
    expect(isNoOp(EMPTY_PLAN)).toBe(true);
  });

  it('ignores preserved entries, which write nothing', () => {
    expect(isNoOp({ ...EMPTY_PLAN, preserved: ['a'] })).toBe(true);
  });
});
