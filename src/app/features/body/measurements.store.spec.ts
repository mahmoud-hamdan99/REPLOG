import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import { MEASUREMENTS_REPO } from '../../data/tokens';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { MeasurementsStore } from './measurements.store';

/**
 * Against the real storage stack, because the behaviours that matter here are
 * about what reaches disk: that a partial entry is a complete record, that an
 * edit of one field does not wipe the others, and that archiving a custom
 * definition leaves the values recorded against it readable.
 */
describe('MeasurementsStore', () => {
  let h: IdbHarness;
  let store: MeasurementsStore;

  beforeEach(async () => {
    h = await setupIdb();
    store = TestBed.inject(MeasurementsStore);
    await store.load();
  });

  afterEach(async () => {
    await h.dispose();
  });

  /** The clock the harness provides, so "today" is predictable. */
  const TODAY = '2026-03-02';

  describe('saving', () => {
    it('saves an entry with only a weight', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80.4 },
        custom: {},
        notes: null,
      });

      expect(saved.weightKg).toBe(80.4);
      expect(saved.waistCm).toBeNull();
      // The indexable mirror, because IndexedDB cannot index a boolean.
      expect(saved.hasWeight).toBe(1);
      expect(store.entries()).toHaveLength(1);
    });

    it('reads back as a complete record', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: {},
        notes: null,
      });

      const stored = await TestBed.inject(MEASUREMENTS_REPO).get(saved.id);
      expect(stored?.weightKg).toBe(80);
      expect(stored?.neckCm).toBeNull();
      expect(stored?.custom).toEqual({});
    });

    it('refuses an entry with nothing in it', async () => {
      await expect(
        store.save({ measuredAt: TODAY, values: {}, custom: {}, notes: null }),
      ).rejects.toThrow();
    });

    it('accepts an entry that carries only a custom value', async () => {
      const definition = await store.addDefinition('Ankle', 'length');

      const saved = await store.save({
        measuredAt: TODAY,
        values: {},
        custom: { [definition.id]: 22 },
        notes: null,
      });

      expect(saved.custom[definition.id]).toBe(22);
      expect(saved.hasWeight).toBe(0);
    });

    it('refuses a value that is not a measurement', async () => {
      await expect(
        store.save({ measuredAt: TODAY, values: { weightKg: -5 }, custom: {}, notes: null }),
      ).rejects.toThrow();
    });

    it('accepts a surprising value once it reaches the store', async () => {
      // The sheet asks before calling save; by here the user has confirmed,
      // and nothing is clamped on the way through.
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 650 },
        custom: {},
        notes: null,
      });

      expect(saved.weightKg).toBe(650);
    });

    it('refuses a date too far in the future', async () => {
      await expect(
        store.save({
          measuredAt: '2026-04-01',
          values: { weightKg: 80 },
          custom: {},
          notes: null,
        }),
      ).rejects.toThrow();
    });

    it('refuses a custom value with no definition behind it', async () => {
      await expect(
        store.save({ measuredAt: TODAY, values: {}, custom: { ghost: 10 }, notes: null }),
      ).rejects.toThrow();
    });
  });

  describe('editing', () => {
    it('changes one field without clearing the rest', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80, waistCm: 86, neckCm: 38 },
        custom: {},
        notes: 'morning',
      });

      await store.save({
        id: saved.id,
        measuredAt: TODAY,
        values: { weightKg: 79.5 },
        custom: {},
        notes: 'morning',
      });

      const stored = await TestBed.inject(MEASUREMENTS_REPO).get(saved.id);
      expect(stored?.weightKg).toBe(79.5);
      expect(stored?.waistCm).toBe(86);
      expect(stored?.neckCm).toBe(38);
    });

    it('clears a field that is explicitly set to null', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80, waistCm: 86 },
        custom: {},
        notes: null,
      });

      await store.save({
        id: saved.id,
        measuredAt: TODAY,
        values: { waistCm: null },
        custom: {},
        notes: null,
      });

      const stored = await TestBed.inject(MEASUREMENTS_REPO).get(saved.id);
      expect(stored?.waistCm).toBeNull();
      expect(stored?.weightKg).toBe(80);
    });

    it('keeps the original entry time, so an edit does not reorder the day', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: {},
        notes: null,
      });
      h.clock.advance(3_600_000);

      await store.save({
        id: saved.id,
        measuredAt: TODAY,
        values: { weightKg: 81 },
        custom: {},
        notes: null,
      });

      expect((await TestBed.inject(MEASUREMENTS_REPO).get(saved.id))?.recordedAt).toBe(
        saved.recordedAt,
      );
    });

    it('removes and restores an entry', async () => {
      const saved = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: {},
        notes: null,
      });

      await store.remove(saved.id);
      expect(store.entries()).toHaveLength(0);
      expect(await TestBed.inject(MEASUREMENTS_REPO).get(saved.id)).toBeUndefined();

      await store.restore(saved.id);
      expect(store.entries()).toHaveLength(1);
      expect((await TestBed.inject(MEASUREMENTS_REPO).get(saved.id))?.deletedAt).toBeNull();
    });
  });

  describe('ordering and lookup', () => {
    async function seed(day: string, weightKg: number | null, waistCm: number | null = null) {
      return store.save({
        measuredAt: day,
        values: { weightKg, waistCm },
        custom: {},
        notes: null,
      });
    }

    it('lists newest first', async () => {
      await seed('2026-02-01', 82);
      await seed('2026-03-01', 80);
      await seed('2026-02-15', 81);

      expect((store.entries() ?? []).map((entry) => entry.measuredAt)).toEqual([
        '2026-03-01',
        '2026-02-15',
        '2026-02-01',
      ]);
    });

    it('orders two entries on one day by when they were recorded', async () => {
      const first = await seed(TODAY, 80);
      h.clock.advance(3_600_000);
      const second = await seed(TODAY, 79.8);

      expect((store.entries() ?? []).map((entry) => entry.id)).toEqual([second.id, first.id]);
    });

    it('finds the last entry that recorded a field, not just the last entry', async () => {
      await seed('2026-01-01', null, 86);
      await seed('2026-02-01', 81);
      await seed('2026-03-01', 80);

      expect(store.previousFor('waistCm')?.measuredAt).toBe('2026-01-01');
      expect(store.previousFor('weightKg')?.measuredAt).toBe('2026-03-01');
      expect(store.latestWeightKg()).toBe(80);
    });

    it('reports other entries on the same day', async () => {
      const first = await seed(TODAY, 80);
      const second = await seed(TODAY, 79);

      expect(store.sameDay(TODAY, second.id).map((entry) => entry.id)).toEqual([first.id]);
      expect(store.sameDay('2026-01-01')).toEqual([]);
    });
  });

  describe('merging a duplicate day', () => {
    it('keeps the target values and fills its gaps from the source', async () => {
      const target = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: {},
        notes: 'morning',
      });
      const source = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 81, waistCm: 86 },
        custom: {},
        notes: 'evening',
      });

      const merged = await store.merge(target.id, source.id);

      // The target was the entry the user chose to keep.
      expect(merged?.weightKg).toBe(80);
      expect(merged?.waistCm).toBe(86);
      expect(merged?.notes).toBe('morning\nevening');
      expect(store.entries()).toHaveLength(1);
    });

    it('merges custom values the same way', async () => {
      const definition = await store.addDefinition('Ankle', 'length');
      const other = await store.addDefinition('Wrist', 'length');

      const target = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: { [definition.id]: 22 },
        notes: null,
      });
      const source = await store.save({
        measuredAt: TODAY,
        values: {},
        custom: { [definition.id]: 23, [other.id]: 17 },
        notes: null,
      });

      const merged = await store.merge(target.id, source.id);

      expect(merged?.custom[definition.id]).toBe(22);
      expect(merged?.custom[other.id]).toBe(17);
    });

    it('does nothing when either entry is gone', async () => {
      expect(await store.merge('missing', 'also-missing')).toBeNull();
    });
  });

  describe('custom definitions', () => {
    it('creates one and offers it for new entries', async () => {
      const created = await store.addDefinition('  Ankle  ', 'length');

      expect(created.label).toBe('Ankle');
      expect(store.definitions()).toHaveLength(1);
    });

    it('refuses a label that is not one', async () => {
      await expect(store.addDefinition('   ', 'length')).rejects.toThrow();
      await expect(store.addDefinition('a'.repeat(81), 'length')).rejects.toThrow();
    });

    it('keeps historical values readable after archiving', async () => {
      const definition = await store.addDefinition('Ankle', 'length');
      const entry = await store.save({
        measuredAt: TODAY,
        values: { weightKg: 80 },
        custom: { [definition.id]: 22 },
        notes: null,
      });

      await store.archiveDefinition(definition.id, true);

      // Gone from the sheet, still present in the record and still nameable.
      expect(store.definitions()).toHaveLength(0);
      expect(store.allDefinitions()).toHaveLength(1);
      expect(store.definitionById(definition.id)?.label).toBe('Ankle');
      expect((await TestBed.inject(MEASUREMENTS_REPO).get(entry.id))?.custom[definition.id]).toBe(
        22,
      );
    });

    it('brings an archived definition back', async () => {
      const definition = await store.addDefinition('Ankle', 'length');
      await store.archiveDefinition(definition.id, true);
      await store.archiveDefinition(definition.id, false);

      expect(store.definitions()).toHaveLength(1);
    });

    it('renames one without touching the values recorded against it', async () => {
      const definition = await store.addDefinition('Ankle', 'length');
      const entry = await store.save({
        measuredAt: TODAY,
        values: {},
        custom: { [definition.id]: 22 },
        notes: null,
      });

      await store.renameDefinition(definition.id, 'Ankle circumference');

      expect(store.definitionById(definition.id)?.label).toBe('Ankle circumference');
      expect(store.byId(entry.id)?.custom[definition.id]).toBe(22);
    });
  });

  describe('comparison', () => {
    it('gives deltas only for fields present in both', async () => {
      const from = await store.save({
        measuredAt: '2026-01-01',
        values: { weightKg: 82, waistCm: 86 },
        custom: {},
        notes: null,
      });
      const to = await store.save({
        measuredAt: '2026-03-01',
        values: { weightKg: 78, neckCm: 38 },
        custom: {},
        notes: null,
      });

      const rows = store.comparison(from.id, to.id);
      const byKey = new Map(rows.map((row) => [row.key, row]));

      expect(byKey.get('weightKg')).toMatchObject({ delta: -4, status: 'both' });
      expect(byKey.get('waistCm')).toMatchObject({ delta: null, status: 'missing-to' });
      expect(byKey.get('neckCm')).toMatchObject({ delta: null, status: 'missing-from' });
      // Nothing measured either time is left out rather than shown as blank.
      expect(byKey.has('thighLeftCm')).toBe(false);
    });

    it('is empty when an entry is missing', async () => {
      expect(store.comparison('nope', 'also-nope')).toEqual([]);
    });
  });
});
