import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '../../core/settings/settings.store';
import { APP_META_STORE } from '../../data/app-meta';
import { EXERCISES_REPO } from '../../data/tokens';
import { CATALOG_VERSION } from '../../domain/models/catalog';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { CatalogSeeder } from './catalog.seeder';
import { ExerciseLibraryStore } from './exercise-library.store';

/**
 * Exercised against the real IndexedDB stack rather than an in-memory double:
 * seeding is a transactional, multi-step operation, and a fake that could not
 * roll back would hide the failure mode worth catching.
 */
describe('ExerciseLibraryStore', () => {
  let h: IdbHarness;
  let store: ExerciseLibraryStore;

  beforeEach(async () => {
    h = await setupIdb();
    store = TestBed.inject(ExerciseLibraryStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  describe('seeding', () => {
    it('populates an empty library from the shipped catalog', async () => {
      await store.load();

      expect(store.all()?.length).toBeGreaterThan(100);
      expect(store.seedStatus().phase).toBe('ready');
      expect(await TestBed.inject(APP_META_STORE).get('builtInCatalogVersion')).toBe(
        CATALOG_VERSION,
      );
    });

    it('computes normalised search keys at seed time', async () => {
      await store.load();
      const bench = store.byId().get('barbell-bench-press');

      expect(bench?.nameNormEn).toBe('barbell bench press');
      expect(bench?.nameNormAr).toBeTruthy();
    });

    it('marks everything it seeds as a live built-in', async () => {
      await store.load();
      const all = store.all() ?? [];

      expect(all.every((e) => e.isCustom === 0)).toBe(true);
      expect(all.every((e) => e.isArchived === 0)).toBe(true);
      expect(all.every((e) => e.builtInVersion === CATALOG_VERSION)).toBe(true);
      expect(all.every((e) => e.userEdited === false)).toBe(true);
    });

    it('does not re-seed when the installed version already matches', async () => {
      await store.load();
      const first = store.all()?.length ?? 0;

      const seeder = TestBed.inject(CatalogSeeder);
      await seeder.ensureSeeded();
      await store.load({ force: true });

      expect(store.all()?.length).toBe(first);
    });

    it('shares one run between concurrent callers', async () => {
      const seeder = TestBed.inject(CatalogSeeder);
      await Promise.all([seeder.ensureSeeded(), seeder.ensureSeeded(), seeder.ensureSeeded()]);

      const count = await TestBed.inject(EXERCISES_REPO).count();
      expect(count).toBeGreaterThan(100);

      // Seeding three times over would have produced duplicates.
      await store.load();
      const ids = (store.all() ?? []).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.load();
    });

    it('finds a staple lift by a partial English name', async () => {
      store.setQuery('bench');
      const names = store.results().map((e) => e.nameEn);

      expect(names.length).toBeGreaterThan(0);
      // Relevance: the plain lift outranks its variations.
      expect(names[0]).toBe('Barbell Bench Press');
    });

    it('finds an exercise by alias', () => {
      store.setQuery('rdl');
      expect(store.results().map((e) => e.id)).toContain('romanian-deadlift');
    });

    /**
     * PRODUCT_SPEC section 6: Arabic is a first-class language, and a search
     * must not depend on the user reaching for diacritics or a particular
     * alef form on a phone keyboard.
     */
    it('finds an exercise by its Arabic name', () => {
      store.setQuery('بنش');
      expect(store.results().map((e) => e.id)).toContain('barbell-bench-press');
    });

    it('ignores Arabic diacritics in the query', () => {
      store.setQuery('ضَغْط');
      expect(store.resultCount()).toBeGreaterThan(0);
    });

    it('ignores the alef form in the query', () => {
      store.setQuery('الرفعه');
      const withPlainAlef = store.resultCount();
      store.setQuery('الرفعة');
      expect(store.resultCount()).toBe(withPlainAlef);
      expect(withPlainAlef).toBeGreaterThan(0);
    });

    it('returns nothing for a query that matches nothing', () => {
      store.setQuery('zzzznotathing');
      expect(store.resultCount()).toBe(0);
    });

    it('restores the full list when the query is cleared', () => {
      const total = store.totalCount();
      store.setQuery('bench');
      expect(store.resultCount()).toBeLessThan(total);
      store.setQuery('');
      expect(store.resultCount()).toBe(total);
    });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await store.load();
    });

    it('filters by muscle category', () => {
      store.setMuscle('chest');
      const results = store.results();

      expect(results.length).toBeGreaterThanOrEqual(12);
      expect(results.every((e) => e.primaryMuscles.length > 0)).toBe(true);
      expect(results.map((e) => e.id)).toContain('barbell-bench-press');
      expect(results.map((e) => e.id)).not.toContain('back-squat');
    });

    it('filters by equipment', () => {
      store.toggleEquipment('barbell');
      expect(store.results().every((e) => e.equipment === 'barbell')).toBe(true);
    });

    it('combines several equipment values as a union', () => {
      store.toggleEquipment('barbell');
      store.toggleEquipment('dumbbell');
      expect(
        store.results().every((e) => e.equipment === 'barbell' || e.equipment === 'dumbbell'),
      ).toBe(true);
    });

    it('combines filters with search, and the count matches the list', () => {
      store.setMuscle('chest');
      store.toggleEquipment('dumbbell');
      store.setQuery('press');

      const results = store.results();
      expect(store.resultCount()).toBe(results.length);
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every((e) => e.equipment === 'dumbbell' && e.primaryMuscles.includes('chest')),
      ).toBe(true);
    });

    it('reports whether any filter is active', () => {
      expect(store.hasActiveFilters()).toBe(false);
      store.setMuscle('back');
      expect(store.hasActiveFilters()).toBe(true);
      store.clearFilters();
      expect(store.hasActiveFilters()).toBe(false);
    });

    it('hides archived exercises unless asked for them', async () => {
      const id = 'barbell-calf-raise';
      await store.setArchived(id, true);

      expect(store.results().map((e) => e.id)).not.toContain(id);
      store.patchFilters({ includeArchived: true });
      expect(store.results().map((e) => e.id)).toContain(id);
    });

    it('lists favourites first when there is no query', async () => {
      await store.toggleFavorite('back-squat');
      expect(store.results()[0]?.id).toBe('back-squat');
    });

    /**
     * Found by looking at the library in Arabic: ordering every locale by the
     * English key put the Arabic list in English alphabetical order, which
     * reads as no order at all to the person using it.
     */
    it('sorts alphabetically in the reading language', () => {
      const settings = TestBed.inject(SettingsStore);

      settings.set('language', 'en');
      const english = store.results().map((e) => e.nameNormEn);
      expect([...english]).toEqual([...english].sort((a, b) => a.localeCompare(b, 'en')));

      settings.set('language', 'ar');
      const arabic = store.results().map((e) => e.nameNormAr);
      expect([...arabic]).toEqual([...arabic].sort((a, b) => a.localeCompare(b, 'ar')));

      // And the two orders genuinely differ, or the test proves nothing.
      settings.set('language', 'en');
      const englishIds = store.results().map((e) => e.id);
      settings.set('language', 'ar');
      const arabicIds = store.results().map((e) => e.id);
      expect(arabicIds).not.toEqual(englishIds);
    });

    it('searches against the reading language first', () => {
      const settings = TestBed.inject(SettingsStore);
      settings.set('language', 'ar');

      store.setQuery('القرفصاء بالبار');
      expect(store.results()[0]?.id).toBe('back-squat');
    });
  });

  describe('custom exercises', () => {
    beforeEach(async () => {
      await store.load();
    });

    it('creates one with computed search keys', async () => {
      const created = await store.createCustom({
        nameEn: 'Jefferson Curl',
        nameAr: 'انحناء جيفرسون',
        isArTranslated: true,
        aliases: [],
        primaryMuscles: ['lower-back'],
        secondaryMuscles: ['hamstrings'],
        equipment: 'barbell',
        exerciseType: 'strength',
        movementPattern: 'hinge',
        mechanics: 'compound',
        force: 'pull',
        laterality: 'bilateral',
        loadType: 'external',
        instructionsEn: [],
        instructionsAr: [],
        cuesEn: [],
        cuesAr: [],
        illustration: null,
        defaultRestSec: null,
        weightIncrementKg: 2.5,
        isArchived: 0,
        isFavorite: false,
        notes: null,
      });

      expect(created.isCustom).toBe(1);
      expect(created.nameNormEn).toBe('jefferson curl');
      expect(created.builtInVersion).toBeNull();

      store.setQuery('jefferson');
      expect(store.results().map((e) => e.id)).toContain(created.id);
    });

    it('filters to custom exercises only', async () => {
      await store.createCustom({
        nameEn: 'My Lift',
        nameAr: 'تمريني',
        isArTranslated: true,
        aliases: [],
        primaryMuscles: ['chest'],
        secondaryMuscles: [],
        equipment: 'other',
        exerciseType: 'strength',
        movementPattern: 'other',
        mechanics: 'compound',
        force: null,
        laterality: 'bilateral',
        loadType: 'external',
        instructionsEn: [],
        instructionsAr: [],
        cuesEn: [],
        cuesAr: [],
        illustration: null,
        defaultRestSec: null,
        weightIncrementKg: 2.5,
        isArchived: 0,
        isFavorite: false,
        notes: null,
      });

      store.patchFilters({ customOnly: true });
      expect(store.results()).toHaveLength(1);
      expect(store.results()[0]?.nameEn).toBe('My Lift');
    });
  });

  describe('editing a built-in', () => {
    beforeEach(async () => {
      await store.load();
    });

    /**
     * Setting userEdited is what stops the next catalog update overwriting the
     * change. Without it a user's correction would silently vanish on upgrade.
     */
    it('marks it as user-edited', async () => {
      await store.update('barbell-bench-press', { nameEn: 'Flat Barbell Press' });
      const edited = store.byId().get('barbell-bench-press');

      expect(edited?.nameEn).toBe('Flat Barbell Press');
      expect(edited?.userEdited).toBe(true);
      expect(edited?.nameNormEn).toBe('flat barbell press');
    });

    it('does not mark a custom exercise as user-edited', async () => {
      const created = await store.createCustom({
        nameEn: 'Mine',
        nameAr: 'تمريني',
        isArTranslated: true,
        aliases: [],
        primaryMuscles: ['abs'],
        secondaryMuscles: [],
        equipment: 'bodyweight',
        exerciseType: 'bodyweight',
        movementPattern: 'isolation',
        mechanics: 'isolation',
        force: null,
        laterality: 'bilateral',
        loadType: 'bodyweight',
        instructionsEn: [],
        instructionsAr: [],
        cuesEn: [],
        cuesAr: [],
        illustration: null,
        defaultRestSec: null,
        weightIncrementKg: 1.25,
        isArchived: 0,
        isFavorite: false,
        notes: null,
      });

      await store.update(created.id, { nameEn: 'Mine v2' });
      expect(store.byId().get(created.id)?.userEdited).toBe(false);
    });

    it('restores the shipped definition and clears the edited flag', async () => {
      await store.update('barbell-bench-press', { nameEn: 'Something Else' });
      await store.resetToOriginal('barbell-bench-press');

      const restored = store.byId().get('barbell-bench-press');
      expect(restored?.nameEn).toBe('Barbell Bench Press');
      expect(restored?.userEdited).toBe(false);
    });

    it('preserves a favourite across a reset', async () => {
      await store.toggleFavorite('barbell-bench-press');
      await store.update('barbell-bench-press', { nameEn: 'Something Else' });
      await store.resetToOriginal('barbell-bench-press');

      expect(store.byId().get('barbell-bench-press')?.isFavorite).toBe(true);
    });
  });
});
