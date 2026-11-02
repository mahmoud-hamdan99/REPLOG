import { computed, inject, Service, signal } from '@angular/core';
import { APP_META_STORE } from '../../data/app-meta';
import { EXERCISES_REPO } from '../../data/tokens';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import { CATALOG_VERSION, type CatalogExercise } from '../../domain/models/catalog';
import { isNoOp, reconcileCatalog, type ReconcilePlan } from '../../domain/catalog/reconcile';
import type { Exercise } from '../../domain/models/exercise';

export type SeedPhase = 'idle' | 'checking' | 'loading' | 'writing' | 'ready' | 'failed';

export interface SeedStatus {
  phase: SeedPhase;
  /** Records written so far, for the progress indicator. */
  done: number;
  total: number;
}

/**
 * Loads the shipped catalog as its own lazy chunk.
 *
 * A static import would put 168 exercises in the initial bundle for a user who
 * may never open the library. As a dynamic import it is a separate chunk,
 * fetched on demand, precached by the service worker, and therefore available
 * offline without any runtime fetch of our own.
 */
async function loadCatalog(): Promise<{ version: number; exercises: CatalogExercise[] }> {
  const module = await import('./data/exercises.v1.json');
  return module.default as unknown as { version: number; exercises: CatalogExercise[] };
}

/**
 * Seeds and reconciles the built-in exercise library.
 *
 * Deliberately *not* an app initializer: seeding 168 records must not stand
 * between the user and the first paint. The library store calls this when it
 * first needs the data, and the shell can warm it on idle.
 */
@Service()
export class CatalogSeeder {
  private readonly repo = inject(EXERCISES_REPO);
  private readonly appMeta = inject(APP_META_STORE);
  private readonly uow = inject(UNIT_OF_WORK);

  private readonly _status = signal<SeedStatus>({ phase: 'idle', done: 0, total: 0 });
  private inFlight: Promise<void> | null = null;

  readonly status = this._status.asReadonly();
  readonly isWorking = computed(() => {
    const phase = this._status().phase;
    return phase === 'checking' || phase === 'loading' || phase === 'writing';
  });

  /**
   * Brings the stored library up to date with the shipped catalog.
   *
   * Safe to call repeatedly and from several places at once: concurrent callers
   * share one run rather than racing to seed the same records twice.
   */
  async ensureSeeded(): Promise<void> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    try {
      this._status.set({ phase: 'checking', done: 0, total: 0 });

      const installed = await this.appMeta.get('builtInCatalogVersion');
      if (installed === CATALOG_VERSION) {
        // Nothing to do, and the catalog chunk is never even fetched.
        this._status.set({ phase: 'ready', done: 0, total: 0 });
        return;
      }

      this._status.set({ phase: 'loading', done: 0, total: 0 });
      const catalog = await loadCatalog();
      const existing = await this.repo.list({ includeDeleted: true });
      const plan = reconcileCatalog(existing, catalog.exercises, catalog.version);

      if (isNoOp(plan)) {
        await this.appMeta.set('builtInCatalogVersion', catalog.version);
        this._status.set({ phase: 'ready', done: 0, total: 0 });
        return;
      }

      await this.apply(plan, existing);
      await this.appMeta.set('builtInCatalogVersion', catalog.version);

      const total = plan.inserts.length + plan.updates.length + plan.archives.length;
      this._status.set({ phase: 'ready', done: total, total });
    } catch (error) {
      this._status.set({ phase: 'failed', done: 0, total: 0 });
      throw error;
    }
  }

  /**
   * Applies the plan in one transaction, so a failure part-way through leaves
   * the library exactly as it was rather than half-updated.
   */
  private async apply(plan: ReconcilePlan, existing: readonly Exercise[]): Promise<void> {
    const total = plan.inserts.length + plan.updates.length + plan.archives.length;
    this._status.set({ phase: 'writing', done: 0, total });

    const byId = new Map(existing.map((exercise) => [exercise.id, exercise]));
    let done = 0;

    await this.uow.run(['exercises'], 'readwrite', async (tx) => {
      const exercises = tx.repo('exercises');

      for (const insert of plan.inserts) {
        await exercises.put({
          id: insert.id,
          ...insert.fields,
          // User-owned fields get their initial values only on insert.
          isCustom: 0,
          isArchived: 0,
          isFavorite: false,
          userEdited: false,
          notes: null,
        });
        done += 1;
      }

      for (const update of plan.updates) {
        // patch, not put: it merges, so favourites, notes and the user's own
        // archive choice are preserved by construction rather than by my
        // remembering to copy them across.
        await exercises.patch(update.id, update.fields);
        done += 1;
      }

      for (const id of plan.archives) {
        const current = byId.get(id);
        if (current) {
          await exercises.patch(id, { isArchived: 1 });
        }
        done += 1;
      }

      tx.onCommit(() => this._status.set({ phase: 'ready', done, total }));
    });
  }

  /** The shipped definition of one built-in, for "reset to original". */
  async originalFor(id: string): Promise<CatalogExercise | undefined> {
    const catalog = await loadCatalog();
    return catalog.exercises.find((entry) => entry.id === id);
  }
}
