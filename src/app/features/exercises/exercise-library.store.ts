import { computed, inject, Service, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { EXERCISES_REPO } from '../../data/tokens';
import { catalogFields } from '../../domain/catalog/reconcile';
import type { Draft } from '../../domain/models/entity';
import type { Equipment, ExerciseType, MuscleFilter } from '../../domain/models/enums';
import { MUSCLE_ROLLUP } from '../../domain/models/enums';
import type { Exercise } from '../../domain/models/exercise';
import { matchRank, matchesQuery, normalizeSearchText } from '../../domain/text/normalize';
import { CatalogSeeder } from './catalog.seeder';

export interface LibraryFilters {
  query: string;
  muscle: MuscleFilter | null;
  equipment: Equipment[];
  types: ExerciseType[];
  customOnly: boolean;
  favoritesOnly: boolean;
  includeArchived: boolean;
}

const NO_FILTERS: LibraryFilters = Object.freeze({
  query: '',
  muscle: null,
  equipment: [],
  types: [],
  customOnly: false,
  favoritesOnly: false,
  includeArchived: false,
});

/**
 * The exercise library.
 *
 * The whole catalog is held in memory — roughly 168 records, a few hundred
 * kilobytes. That is a deliberate trade of memory for simplicity and speed:
 * search and multi-criteria filtering then run synchronously over an array
 * instead of being bent into compound-index gymnastics, and the result is
 * instant on every keystroke. It is only a safe trade because the catalog is
 * bounded; workout history, which is not, is never cached like this.
 */
@Service()
export class ExerciseLibraryStore {
  private readonly repo = inject(EXERCISES_REPO);
  private readonly seeder = inject(CatalogSeeder);
  private readonly i18n = inject(I18n);

  private readonly _all = signal<Exercise[] | null>(null);
  private readonly _filters = signal<LibraryFilters>({ ...NO_FILTERS });
  private readonly _error = signal<string | null>(null);

  /** `null` means not loaded; an empty array means loaded and genuinely empty. */
  readonly all = this._all.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly error = this._error.asReadonly();
  readonly seedStatus = this.seeder.status;

  readonly isLoading = computed(() => this._all() === null && this._error() === null);
  readonly isSeeding = computed(() => this.seeder.isWorking());

  readonly byId = computed(() => new Map((this._all() ?? []).map((e) => [e.id, e])));

  /** Live exercises only, unless the filters ask for archived ones. */
  private readonly visible = computed(() => {
    const all = this._all() ?? [];
    return this._filters().includeArchived ? all : all.filter((e) => e.isArchived === 0);
  });

  readonly results = computed(() => {
    const filters = this._filters();
    const query = filters.query.trim();

    const filtered = this.visible().filter((exercise) => {
      if (filters.customOnly && exercise.isCustom !== 1) return false;
      if (filters.favoritesOnly && !exercise.isFavorite) return false;

      if (filters.muscle) {
        const rolled = exercise.primaryMuscles.map((m) => MUSCLE_ROLLUP[m]);
        if (!rolled.includes(filters.muscle)) return false;
      }
      if (filters.equipment.length > 0 && !filters.equipment.includes(exercise.equipment)) {
        return false;
      }
      if (filters.types.length > 0 && !filters.types.includes(exercise.exerciseType)) {
        return false;
      }
      if (query !== '') {
        return matchesQuery([exercise.nameEn, exercise.nameAr, ...exercise.aliases], query);
      }
      return true;
    });

    const locale = this.i18n.locale();

    if (query === '') {
      // No query: favourites first, then alphabetical *in the reading language*.
      return filtered.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return this.collate(a, b, locale);
      });
    }

    // With a query, relevance wins: "bench" must put Bench Press above
    // Close-Grip Bench Press.
    return filtered.sort((a, b) => {
      const rank =
        matchRank(this.primaryName(a, locale), this.alternateNames(a, locale), query) -
        matchRank(this.primaryName(b, locale), this.alternateNames(b, locale), query);
      return rank !== 0 ? rank : this.collate(a, b, locale);
    });
  });

  readonly resultCount = computed(() => this.results().length);
  readonly totalCount = computed(() => this.visible().length);
  readonly hasActiveFilters = computed(() => {
    const f = this._filters();
    return (
      f.query.trim() !== '' ||
      f.muscle !== null ||
      f.equipment.length > 0 ||
      f.types.length > 0 ||
      f.customOnly ||
      f.favoritesOnly
    );
  });

  /** Seeds if needed, then loads the library into memory. Idempotent. */
  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._all() !== null && !options.force) {
      return;
    }
    this._error.set(null);
    try {
      await this.seeder.ensureSeeded();
      this._all.set(await this.repo.list({ includeDeleted: false }));
    } catch (error) {
      this._all.set(null);
      this._error.set(error instanceof Error ? error.message : 'Failed to load exercises');
    }
  }

  setQuery(query: string): void {
    this._filters.update((current) => ({ ...current, query }));
  }

  setMuscle(muscle: MuscleFilter | null): void {
    this._filters.update((current) => ({ ...current, muscle }));
  }

  toggleEquipment(equipment: Equipment): void {
    this._filters.update((current) => ({
      ...current,
      equipment: current.equipment.includes(equipment)
        ? current.equipment.filter((value) => value !== equipment)
        : [...current.equipment, equipment],
    }));
  }

  toggleType(type: ExerciseType): void {
    this._filters.update((current) => ({
      ...current,
      types: current.types.includes(type)
        ? current.types.filter((value) => value !== type)
        : [...current.types, type],
    }));
  }

  patchFilters(changes: Partial<LibraryFilters>): void {
    this._filters.update((current) => ({ ...current, ...changes }));
  }

  clearFilters(): void {
    this._filters.set({ ...NO_FILTERS });
  }

  async toggleFavorite(id: string): Promise<void> {
    const current = this.byId().get(id);
    if (!current) return;
    const updated = await this.repo.patch(id, { isFavorite: !current.isFavorite });
    this.replace(updated);
  }

  /** Creates a custom exercise. Normalised keys are computed here, once. */
  async createCustom(
    input: Omit<
      Draft<Exercise>,
      'nameNormEn' | 'nameNormAr' | 'isCustom' | 'builtInVersion' | 'userEdited'
    >,
  ): Promise<Exercise> {
    const created = await this.repo.put({
      ...input,
      nameNormEn: normalizeSearchText(input.nameEn),
      nameNormAr: normalizeSearchText(input.nameAr),
      isCustom: 1,
      builtInVersion: null,
      userEdited: false,
    } as Draft<Exercise>);

    this._all.update((all) => (all === null ? all : [...all, created]));
    return created;
  }

  /**
   * Edits an exercise.
   *
   * Editing a *built-in* sets `userEdited`, which is what stops the next
   * catalog update from overwriting the change (DATABASE_SPEC section 6.2).
   */
  async update(id: string, changes: Partial<Exercise>): Promise<void> {
    const current = this.byId().get(id);
    if (!current) return;

    const patch: Partial<Exercise> = { ...changes };
    if (changes.nameEn !== undefined) patch.nameNormEn = normalizeSearchText(changes.nameEn);
    if (changes.nameAr !== undefined) patch.nameNormAr = normalizeSearchText(changes.nameAr);
    if (current.isCustom === 0) patch.userEdited = true;

    this.replace(await this.repo.patch(id, patch));
  }

  /** Restores a built-in to its shipped definition and clears the edited flag. */
  async resetToOriginal(id: string): Promise<void> {
    const current = this.byId().get(id);
    if (!current || current.isCustom === 1) return;

    const original = await this.seeder.originalFor(id);
    if (!original) return;

    this.replace(
      await this.repo.patch(id, {
        ...catalogFields(original, current.builtInVersion ?? 1),
        userEdited: false,
      }),
    );
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    this.replace(await this.repo.patch(id, { isArchived: archived ? 1 : 0 }));
  }

  /** Soft-deletes a custom exercise. Built-ins are archived instead. */
  async removeCustom(id: string): Promise<void> {
    const current = this.byId().get(id);
    if (!current || current.isCustom !== 1) return;

    await this.repo.remove(id);
    this._all.update((all) => (all === null ? all : all.filter((e) => e.id !== id)));
  }

  /**
   * The name in the reading language.
   *
   * Public because every surface that lists exercises needs it — the library,
   * the planner's picker, the tracker — and three copies of
   * `isArabic ? nameAr : nameEn` is three places to forget one.
   */
  displayName(exercise: Exercise): string {
    return this.primaryName(exercise, this.i18n.locale());
  }

  /**
   * Sorts by the name the user is actually reading.
   *
   * Ordering every locale by the English key puts an Arabic list in English
   * alphabetical order, which looks like no order at all to the person reading
   * it. `localeCompare` with the active locale also gets Arabic letter order
   * right, which a plain string comparison does not.
   */
  private collate(a: Exercise, b: Exercise, locale: string): number {
    const left = locale === 'ar' ? a.nameNormAr : a.nameNormEn;
    const right = locale === 'ar' ? b.nameNormAr : b.nameNormEn;
    return left.localeCompare(right, locale);
  }

  /** The name in the reading language; the other one becomes an alternate. */
  private primaryName(exercise: Exercise, locale: string): string {
    return locale === 'ar' ? exercise.nameAr : exercise.nameEn;
  }

  private alternateNames(exercise: Exercise, locale: string): string[] {
    const other = locale === 'ar' ? exercise.nameEn : exercise.nameAr;
    return [other, ...exercise.aliases];
  }

  private replace(updated: Exercise): void {
    this._all.update((all) =>
      all === null ? all : all.map((e) => (e.id === updated.id ? updated : e)),
    );
  }
}
