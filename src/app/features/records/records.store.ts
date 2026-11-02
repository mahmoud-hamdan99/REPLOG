import { computed, inject, Service, signal } from '@angular/core';
import { PERSONAL_RECORDS_REPO } from '../../data/tokens';
import type { StoreName } from '../../data/stores';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import type { PersonalRecord } from '../../domain/models/records';
import { PrEngine } from './pr-engine';

/** How many recent records the screen leads with. */
const RECENT_LIMIT = 5;

/** Stores a full rebuild touches. */
const REBUILD_STORES: readonly StoreName[] = ['personalRecords', 'setLogs', 'workoutExercises'];

export interface RecordGroup {
  variantKey: string;
  nameSnapshot: string;
  records: PersonalRecord[];
}

/**
 * Personal records, for reading.
 *
 * Writing is `PrEngine`'s job and happens inside the transaction that changed
 * the history. This store only reads — and the one thing it keeps straight is
 * that records are **variant-scoped**: grouped by `variantKey`, never merged
 * across equipment, because merging them is exactly the comparison
 * PRODUCT_SPEC section 4.10 forbids making silently.
 */
@Service()
export class RecordsStore {
  private readonly repo = inject(PERSONAL_RECORDS_REPO);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly engine = inject(PrEngine);

  private readonly _current = signal<PersonalRecord[] | null>(null);
  private readonly _error = signal<string | null>(null);

  /** `null` means not loaded; an empty array means loaded and genuinely empty. */
  readonly current = this._current.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isLoading = computed(() => this._current() === null && this._error() === null);

  /**
   * The most recently earned records that still stand.
   *
   * Derived from the current set rather than queried by date, so a superseded
   * achievement never appears beside the one that beat it — "1,050 kg, up from
   * 1,000" followed by "1,000 kg, first record" is two true statements that
   * read as a contradiction.
   *
   * The full progression of a record type is `historyFor`, which is a
   * different question asked deliberately.
   */
  readonly recent = computed(() =>
    [...(this._current() ?? [])]
      .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
      .slice(0, RECENT_LIMIT),
  );

  /**
   * Records that currently stand, grouped by variant.
   *
   * Sorted by the name the user reads, then by type, so a variant's records
   * read as a block rather than scattered through the list.
   */
  readonly groups = computed<RecordGroup[]>(() => {
    const byVariant = new Map<string, RecordGroup>();
    for (const record of this._current() ?? []) {
      const group = byVariant.get(record.variantKey);
      if (group) group.records.push(record);
      else
        byVariant.set(record.variantKey, {
          variantKey: record.variantKey,
          nameSnapshot: record.nameSnapshot,
          records: [record],
        });
    }

    return [...byVariant.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort((a, b) => a.prType.localeCompare(b.prType)),
      }))
      .sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot));
  });

  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._current() !== null && !options.force) {
      return;
    }
    this._error.set(null);

    try {
      this._current.set(await this.repo.list({ index: 'by_isCurrent', equals: 1 }));
    } catch (error) {
      this._current.set(null);
      this._error.set(error instanceof Error ? error.message : 'Records could not be loaded');
    }
  }

  /** Every achievement of one variant and type, oldest first. */
  async historyFor(variantKey: string, prType: PersonalRecord['prType']) {
    return this.repo.list({
      index: 'by_variantKey_type_achievedAt',
      range: { lower: [variantKey, prType], upper: [variantKey, prType, '￿'] },
    });
  }

  /**
   * Rebuilds every record table from the set logs.
   *
   * The Settings → Data routine, exposed here because this store owns the
   * read side and has to reload afterwards. Deterministic by construction:
   * it is the same call the finish transaction makes.
   */
  async rebuild(): Promise<number> {
    const variants = await this.uow.run(REBUILD_STORES, 'readwrite', (tx) =>
      this.engine.rebuildAll(tx),
    );
    await this.load({ force: true });
    return variants;
  }
}
