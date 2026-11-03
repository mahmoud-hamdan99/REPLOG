import { computed, inject, Service, signal } from '@angular/core';
import { CLOCK } from '../../data/clock';
import { CUSTOM_MEASUREMENT_DEFS_REPO, MEASUREMENTS_REPO } from '../../data/tokens';
import { compare, lastRecording, type ComparisonRow } from '../../domain/body/compare';
import { MEASUREMENT_FIELDS, isEmpty, type MeasurementField } from '../../domain/body/fields';
import { checkDay, checkField, checkLabel, checkValue } from '../../domain/body/validation';
import type { CustomMeasurementDef, Measurement } from '../../domain/models/body';
import type { Draft } from '../../domain/models/entity';
import type { MeasurementUnitType } from '../../domain/models/enums';
import { flag } from '../../domain/models/entity';
import { nextOrderIndex, sortByOrder } from '../../domain/planner/ordering';
import { dayKeyAt } from '../../domain/time/day-key';
import { validationError } from '../../core/errors/app-error';

/** What the entry sheet hands back. Every value is canonical. */
export interface MeasurementDraft {
  /** Omitted for a new entry. */
  id?: string;
  measuredAt: string;
  values: Partial<Record<MeasurementField, number | null>>;
  custom: Record<string, number>;
  notes: string | null;
}

/**
 * Body measurements.
 *
 * The whole history is held in memory. DATABASE_SPEC section 11 puts five
 * years of measurements at roughly 250 kB — a few hundred records, because
 * the frequency is bounded by how often a person steps on a scale. That makes
 * the ghost values, the deltas and the comparison table plain array work
 * rather than a query per field, and it is only a safe trade because the data
 * is genuinely small. Workout history, which is not, is paged.
 *
 * Every field is optional and a partial entry is the normal case: "today I
 * only weighed myself" has to be as easy to record as a full set of
 * measurements, and has to render as a complete entry rather than a failed one.
 */
@Service()
export class MeasurementsStore {
  private readonly repo = inject(MEASUREMENTS_REPO);
  private readonly defsRepo = inject(CUSTOM_MEASUREMENT_DEFS_REPO);
  private readonly clock = inject(CLOCK);

  private readonly _entries = signal<Measurement[] | null>(null);
  private readonly _definitions = signal<CustomMeasurementDef[]>([]);
  private readonly _error = signal<string | null>(null);

  /** `null` means not loaded; an empty array means loaded and genuinely empty. */
  readonly entries = this._entries.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isLoading = computed(() => this._entries() === null && this._error() === null);

  /** Live definitions, in display order. Archived ones stay readable in history. */
  readonly definitions = computed(() =>
    sortByOrder(this._definitions().filter((definition) => definition.isArchived === 0)),
  );

  /** Including archived, for rendering values recorded before archiving. */
  readonly allDefinitions = this._definitions.asReadonly();

  /**
   * The most recent recorded body weight.
   *
   * Not what the tracker reads: a tracker that injected this store would make
   * starting a workout wait on the body screen's data, and would couple two
   * features that have no other reason to know about each other. It reads the
   * `by_hasWeight` index itself. The two agree by both asking the same
   * question — the newest entry that recorded a weight — of the same rows.
   *
   * Here for the photo capture caption (Phase 9) and the body chart's latest
   * reading (Phase 10); nothing links to it yet.
   */
  readonly latestWeightKg = computed(
    () => lastRecording(this._entries() ?? [], 'weightKg')?.weightKg ?? null,
  );

  /**
   * The local day, read fresh.
   *
   * A method rather than a computed: the clock is not a signal, so a computed
   * would cache the first reading and keep handing back yesterday to an app
   * left open overnight.
   */
  today(): string {
    return dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes());
  }

  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._entries() !== null && !options.force) {
      return;
    }
    this._error.set(null);

    try {
      const [entries, definitions] = await Promise.all([
        this.repo.list({ index: 'by_measuredAt', direction: 'prev' }),
        this.defsRepo.list(),
      ]);
      this._entries.set(entries);
      this._definitions.set(definitions);
    } catch (error) {
      this._entries.set(null);
      this._error.set(error instanceof Error ? error.message : 'Measurements could not load');
    }
  }

  // ----------------------------------------------------------------- queries

  byId(id: string): Measurement | undefined {
    return this._entries()?.find((entry) => entry.id === id);
  }

  /**
   * The last entry that recorded a field, for the ghost value and the delta.
   *
   * Walks back rather than taking the latest entry: the last time you measured
   * your waist is the comparison you want, however many weigh-ins came after.
   */
  previousFor(field: MeasurementField, excludeId?: string): Measurement | null {
    return lastRecording(this._entries() ?? [], field, excludeId);
  }

  /**
   * Other entries already recorded on a day.
   *
   * Several a day are allowed — the schema says so — but two is usually a
   * mistake, so the sheet offers to merge rather than silently stacking them.
   */
  sameDay(dayKey: string, excludeId?: string): Measurement[] {
    return (this._entries() ?? []).filter(
      (entry) => entry.measuredAt === dayKey && entry.id !== excludeId,
    );
  }

  /** Two entries side by side, with deltas only where both have a value. */
  comparison(fromId: string, toId: string): ComparisonRow[] {
    const from = this.byId(fromId);
    const to = this.byId(toId);
    return from && to ? compare(from, to, this._definitions()) : [];
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Creates or updates an entry.
   *
   * Refuses values that are not measurements at all; a merely *surprising*
   * value is the sheet's business to question before it gets here, and by the
   * time it does the user has confirmed it. Nothing is ever clamped.
   */
  async save(draft: MeasurementDraft): Promise<Measurement> {
    const day = checkDay(draft.measuredAt, this.today());
    if (day.status === 'reject') {
      throw validationError(day.messageKey ?? 'Invalid date', {
        messageKey: day.messageKey ?? '',
      });
    }

    for (const [field, value] of Object.entries(draft.values)) {
      const check = checkField(field as MeasurementField, value ?? null);
      if (check.status === 'reject') {
        throw validationError(`${field} is out of range`, {
          messageKey: check.messageKey ?? '',
        });
      }
    }

    for (const [definitionId, value] of Object.entries(draft.custom)) {
      const definition = this._definitions().find((item) => item.id === definitionId);
      if (!definition) {
        throw validationError(`Unknown custom measurement ${definitionId}`, {
          messageKey: 'body.invalid.customUnknown',
        });
      }
      const check = checkValue(definition.unitType, value);
      if (check.status === 'reject') {
        throw validationError(`${definition.label} is out of range`, {
          messageKey: check.messageKey ?? '',
        });
      }
    }

    const existing = draft.id === undefined ? undefined : this.byId(draft.id);
    const values = fullValues(draft.values, existing);

    if (isEmpty({ ...values, custom: draft.custom })) {
      throw validationError('Nothing to save', { messageKey: 'body.invalid.empty' });
    }

    const saved = await this.repo.put({
      ...(draft.id === undefined ? {} : { id: draft.id }),
      measuredAt: draft.measuredAt,
      // Preserved on an edit, so the same-day ordering of an entry does not
      // jump to the moment it was corrected.
      recordedAt: existing?.recordedAt ?? this.clock.nowIso(),
      ...values,
      // Mirrors `weightKg !== null` because IndexedDB cannot index a boolean.
      hasWeight: flag(values.weightKg !== null),
      custom: draft.custom,
      notes: draft.notes,
      source: existing?.source ?? 'manual',
    } satisfies Draft<Measurement>);

    this.replace(saved);
    return saved;
  }

  /** Soft delete, so the undo toast has something to bring back. */
  async remove(id: string): Promise<void> {
    await this.repo.remove(id);
    this._entries.update((entries) =>
      entries === null ? entries : entries.filter((entry) => entry.id !== id),
    );
  }

  async restore(id: string): Promise<void> {
    const tombstoned = await this.repo.get(id, { includeDeleted: true });
    if (!tombstoned) return;
    this.replace(await this.repo.put({ ...tombstoned, deletedAt: null }));
  }

  /**
   * Folds one entry into another and removes the source.
   *
   * The target wins wherever both have a value: it is the entry the user chose
   * to keep, and a merge that overwrote it with the other one's numbers would
   * be a replacement wearing a different name. The source only fills gaps.
   */
  async merge(targetId: string, sourceId: string): Promise<Measurement | null> {
    const target = this.byId(targetId);
    const source = this.byId(sourceId);
    if (!target || !source) return null;

    const values: Partial<Record<MeasurementField, number | null>> = {};
    for (const field of MEASUREMENT_FIELDS) {
      values[field] = target[field] ?? source[field];
    }

    const merged = await this.save({
      id: targetId,
      measuredAt: target.measuredAt,
      values,
      custom: { ...source.custom, ...target.custom },
      notes: joinNotes(target.notes, source.notes),
    });

    await this.remove(sourceId);
    return merged;
  }

  // ------------------------------------------------------------- definitions

  async addDefinition(label: string, unitType: MeasurementUnitType): Promise<CustomMeasurementDef> {
    const check = checkLabel(label);
    if (check.status === 'reject') {
      throw validationError('Invalid label', { messageKey: check.messageKey ?? '' });
    }

    const created = await this.defsRepo.put({
      label: label.trim(),
      unitType,
      orderIndex: nextOrderIndex(this._definitions()),
      isArchived: 0,
    } satisfies Draft<CustomMeasurementDef>);

    this._definitions.update((definitions) => [...definitions, created]);
    return created;
  }

  /**
   * Archives a definition rather than deleting it.
   *
   * The values recorded against it stay in their entries and stay readable;
   * archiving only stops it appearing in new ones. Deleting the definition
   * outright would orphan real measurements, which is why the schema has an
   * archive flag and no delete.
   */
  async archiveDefinition(id: string, archived: boolean): Promise<void> {
    const updated = await this.defsRepo.patch(id, { isArchived: flag(archived) });
    this._definitions.update((definitions) =>
      definitions.map((definition) => (definition.id === id ? updated : definition)),
    );
  }

  async renameDefinition(id: string, label: string): Promise<void> {
    const check = checkLabel(label);
    if (check.status === 'reject') {
      throw validationError('Invalid label', { messageKey: check.messageKey ?? '' });
    }
    const updated = await this.defsRepo.patch(id, { label: label.trim() });
    this._definitions.update((definitions) =>
      definitions.map((definition) => (definition.id === id ? updated : definition)),
    );
  }

  definitionById(id: string): CustomMeasurementDef | undefined {
    return this._definitions().find((definition) => definition.id === id);
  }

  // ----------------------------------------------------------------- private

  /** Keeps the list newest-first without a reload. */
  private replace(saved: Measurement): void {
    this._entries.update((entries) => {
      if (entries === null) return entries;
      const without = entries.filter((entry) => entry.id !== saved.id);
      return [...without, saved].sort(byRecency);
    });
  }
}

/** Newest first, with the entry time breaking ties within a day. */
function byRecency(a: Measurement, b: Measurement): number {
  const byDay = b.measuredAt.localeCompare(a.measuredAt);
  return byDay !== 0 ? byDay : b.recordedAt.localeCompare(a.recordedAt);
}

/**
 * A complete field set, from a partial draft.
 *
 * A field the draft does not mention keeps whatever the record had; a field it
 * mentions as `null` is being cleared. Treating "absent" and "null" alike
 * would make editing one value wipe the rest of the entry.
 */
function fullValues(
  values: Partial<Record<MeasurementField, number | null>>,
  existing: Measurement | undefined,
): Record<MeasurementField, number | null> {
  const result = {} as Record<MeasurementField, number | null>;
  for (const field of MEASUREMENT_FIELDS) {
    result[field] = field in values ? (values[field] ?? null) : (existing?.[field] ?? null);
  }
  return result;
}

function joinNotes(target: string | null, source: string | null): string | null {
  if (target && source && target !== source) return `${target}\n${source}`;
  return target ?? source;
}
