import type { CustomMeasurementDef, Measurement } from '../models/body';
import { compare, customDeltaFor, deltaFor, lastRecording, type ComparisonRow } from './compare';
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_ROWS,
  isEmpty,
  recordedFields,
  sideOf,
  unitTypeOf,
} from './fields';
import { LIMITS, checkDay, checkField, checkLabel, checkValue } from './validation';

let counter = 0;

function entry(overrides: Partial<Measurement> = {}): Measurement {
  counter += 1;
  return {
    id: `m${counter}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    origin: 'test',
    measuredAt: '2026-01-01',
    recordedAt: '2026-01-01T08:00:00.000Z',
    weightKg: null,
    hasWeight: 0,
    bodyFatPct: null,
    heightCm: null,
    neckCm: null,
    shouldersCm: null,
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    bicepsLeftCm: null,
    bicepsRightCm: null,
    forearmLeftCm: null,
    forearmRightCm: null,
    thighLeftCm: null,
    thighRightCm: null,
    calfLeftCm: null,
    calfRightCm: null,
    custom: {},
    notes: null,
    source: 'manual',
    ...overrides,
  };
}

const definition = (overrides: Partial<CustomMeasurementDef> = {}): CustomMeasurementDef =>
  ({
    id: 'def-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    rev: 1,
    origin: 'test',
    label: 'Ankle',
    unitType: 'length',
    orderIndex: 1000,
    isArchived: 0,
    ...overrides,
  }) as CustomMeasurementDef;

describe('measurement catalogue', () => {
  it('puts body weight first and alone above the fold', () => {
    expect(MEASUREMENT_ROWS[0]?.fields).toEqual(['weightKg']);
    expect(MEASUREMENT_ROWS[0]?.primary).toBe(true);
    expect(MEASUREMENT_ROWS.filter((row) => row.primary)).toHaveLength(1);
  });

  it('runs down the body in the order the spec asks for', () => {
    const groups = MEASUREMENT_ROWS.map((row) => row.group);
    const order = ['neck', 'shoulders', 'chest', 'waist', 'hips'];

    const positions = order.map((group) => groups.indexOf(group));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((position) => position > 0)).toBe(true);
  });

  it('pairs left and right on one row', () => {
    const biceps = MEASUREMENT_ROWS.find((row) => row.group === 'biceps');

    expect(biceps?.fields).toEqual(['bicepsLeftCm', 'bicepsRightCm']);
    expect(sideOf('bicepsLeftCm')).toBe('left');
    expect(sideOf('bicepsRightCm')).toBe('right');
    expect(sideOf('waistCm')).toBeNull();
  });

  it('knows the unit type of each field', () => {
    expect(unitTypeOf('weightKg')).toBe('mass');
    expect(unitTypeOf('waistCm')).toBe('length');
    expect(unitTypeOf('bodyFatPct')).toBe('percent');
  });

  it('covers every field exactly once', () => {
    expect(new Set(MEASUREMENT_FIELDS).size).toBe(MEASUREMENT_FIELDS.length);
    expect(MEASUREMENT_FIELDS).toContain('weightKg');
    expect(MEASUREMENT_FIELDS).toContain('hipsCm');
  });

  it('reports only the fields an entry actually carries', () => {
    const recorded = recordedFields(entry({ weightKg: 80, waistCm: 82 }));
    expect(recorded).toEqual(['weightKg', 'waistCm']);
  });

  it('treats an entry with nothing in it as empty', () => {
    expect(isEmpty(entry())).toBe(true);
    expect(isEmpty(entry({ weightKg: 80 }))).toBe(false);
    // A custom value alone is still an entry worth saving.
    expect(isEmpty(entry({ custom: { 'def-1': 22 } }))).toBe(false);
  });
});

describe('validation', () => {
  it('accepts a missing value: every measurement is optional', () => {
    expect(checkValue('mass', null).status).toBe('ok');
    expect(checkField('waistCm', null).status).toBe('ok');
  });

  it('accepts ordinary values', () => {
    expect(checkField('weightKg', 80).status).toBe('ok');
    expect(checkField('waistCm', 82).status).toBe('ok');
    expect(checkField('bodyFatPct', 18).status).toBe('ok');
  });

  it('questions a surprising value rather than clamping it', () => {
    const heavy = checkField('weightKg', 650);

    expect(heavy.status).toBe('question');
    expect(heavy.messageKey).toBe('body.confirm.unusual');
    // The point: the value is not altered, only queried.
    expect(checkField('weightKg', 650).status).not.toBe('ok');
    expect(checkField('bodyFatPct', 85).status).toBe('question');
    expect(checkField('waistCm', 320).status).toBe('question');
  });

  it('refuses a value that is not a measurement at all', () => {
    expect(checkField('weightKg', -5).status).toBe('reject');
    expect(checkField('waistCm', -1).status).toBe('reject');
    expect(checkField('bodyFatPct', 140).status).toBe('reject');
    expect(checkValue('mass', Number.NaN).status).toBe('reject');
    expect(checkValue('mass', Number.POSITIVE_INFINITY).status).toBe('reject');
  });

  it('has no opinion about a custom count', () => {
    expect(checkValue('count', 0).status).toBe('ok');
    expect(checkValue('count', 9999).status).toBe('ok');
    expect(LIMITS.count.plausible.max).toBe(LIMITS.count.hard.max);
  });

  it('allows a day of future slack for timezones, and no more', () => {
    expect(checkDay('2026-03-02', '2026-03-02').status).toBe('ok');
    expect(checkDay('2026-03-03', '2026-03-02').status).toBe('ok');
    expect(checkDay('2026-03-04', '2026-03-02').status).toBe('reject');
  });

  it('allows a date in the past', () => {
    expect(checkDay('2020-01-01', '2026-03-02').status).toBe('ok');
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(checkDay('2026-04-01', '2026-03-31').status).toBe('ok');
    expect(checkDay('2027-01-01', '2026-12-31').status).toBe('ok');
    expect(checkDay('2027-01-02', '2026-12-31').status).toBe('reject');
  });

  it('refuses a date that is not one', () => {
    expect(checkDay('yesterday', '2026-03-02').status).toBe('reject');
    expect(checkDay('2026-3-2', '2026-03-02').status).toBe('reject');
  });

  it('requires a custom label that is actually a label', () => {
    expect(checkLabel('Ankle').status).toBe('ok');
    expect(checkLabel('   ').status).toBe('reject');
    expect(checkLabel('a'.repeat(81)).status).toBe('reject');
    expect(checkLabel(`  ${'a'.repeat(80)}  `).status).toBe('ok');
  });
});

describe('deltas', () => {
  it('is null with nothing to compare against', () => {
    expect(deltaFor(null, 80, 'weightKg')).toBeNull();
  });

  it('is null when the value has not been entered yet', () => {
    expect(deltaFor(entry({ weightKg: 80 }), null, 'weightKg')).toBeNull();
  });

  it('is null when the earlier entry did not record that field', () => {
    // The gap stays a gap: "−4 cm" against a measurement nobody took would
    // be a number the data never supported.
    expect(deltaFor(entry({ weightKg: 80 }), 82, 'waistCm')).toBeNull();
  });

  it('is the change when both sides have a value', () => {
    expect(deltaFor(entry({ weightKg: 80 }), 78.5, 'weightKg')).toBe(-1.5);
    expect(deltaFor(entry({ waistCm: 86 }), 82, 'waistCm')).toBe(-4);
  });

  it('works the same way for a custom measurement', () => {
    expect(customDeltaFor(entry({ custom: { 'def-1': 22 } }), 23, 'def-1')).toBe(1);
    expect(customDeltaFor(entry({ custom: {} }), 23, 'def-1')).toBeNull();
  });
});

describe('lastRecording', () => {
  it('walks back to the last entry that measured the field', () => {
    // Three weigh-ins since the waist was last measured.
    const entries = [
      entry({ measuredAt: '2026-01-04', weightKg: 80 }),
      entry({ measuredAt: '2026-01-03', weightKg: 80.5 }),
      entry({ measuredAt: '2026-01-02', weightKg: 81 }),
      entry({ measuredAt: '2026-01-01', waistCm: 86 }),
    ];

    expect(lastRecording(entries, 'waistCm')?.measuredAt).toBe('2026-01-01');
    expect(lastRecording(entries, 'weightKg')?.measuredAt).toBe('2026-01-04');
  });

  it('is null when nothing ever recorded it', () => {
    expect(lastRecording([entry({ weightKg: 80 })], 'neckCm')).toBeNull();
  });

  it('skips the entry being edited', () => {
    const being = entry({ measuredAt: '2026-01-02', weightKg: 79 });
    const earlier = entry({ measuredAt: '2026-01-01', weightKg: 80 });

    expect(lastRecording([being, earlier], 'weightKg', being.id)?.id).toBe(earlier.id);
  });
});

describe('compare', () => {
  const find = (rows: readonly ComparisonRow[], key: string) => rows.find((row) => row.key === key);

  it('gives a delta only where both sides have a value', () => {
    const rows = compare(
      entry({ weightKg: 82, waistCm: 86 }),
      entry({ weightKg: 78, waistCm: null }),
    );

    expect(find(rows, 'weightKg')).toMatchObject({ delta: -4, status: 'both' });
    expect(find(rows, 'waistCm')).toMatchObject({ delta: null, status: 'missing-to' });
  });

  it('says which side is missing', () => {
    const rows = compare(entry({ weightKg: 82 }), entry({ weightKg: 78, neckCm: 38 }));

    expect(find(rows, 'neckCm')).toMatchObject({ from: null, to: 38, status: 'missing-from' });
  });

  it('names which of a pair each row is', () => {
    // Both halves share a group name, so without the side the table shows two
    // rows called "Biceps" and the reader cannot tell which arm moved.
    const rows = compare(
      entry({ bicepsLeftCm: 38, bicepsRightCm: 38 }),
      entry({ bicepsLeftCm: 39, bicepsRightCm: 38 }),
    );

    expect(find(rows, 'bicepsLeftCm')).toMatchObject({ side: 'left', delta: 1 });
    expect(find(rows, 'bicepsRightCm')).toMatchObject({ side: 'right', delta: 0 });
  });

  it('leaves a single field and a custom row without a side', () => {
    const rows = compare(entry({ weightKg: 82 }), entry({ weightKg: 78 }));

    expect(find(rows, 'weightKg')?.side).toBeNull();
  });

  it('leaves out fields neither entry mentions', () => {
    const rows = compare(entry({ weightKg: 82 }), entry({ weightKg: 78 }));

    expect(rows).toHaveLength(1);
    expect(find(rows, 'thighLeftCm')).toBeUndefined();
  });

  it('compares custom measurements through their definitions', () => {
    const rows = compare(entry({ custom: { 'def-1': 22 } }), entry({ custom: { 'def-1': 23.5 } }), [
      definition(),
    ]);

    expect(find(rows, 'def-1')).toMatchObject({
      label: 'Ankle',
      unitType: 'length',
      delta: 1.5,
      status: 'both',
    });
  });

  it('keeps a custom row readable after its definition is archived', () => {
    // Archiving hides it from new entries; the history it holds stays.
    const rows = compare(entry({ custom: { 'def-1': 22 } }), entry({ custom: { 'def-1': 23 } }), [
      definition({ isArchived: 1 }),
    ]);

    expect(find(rows, 'def-1')?.delta).toBe(1);
  });

  it('is empty when there is nothing to compare', () => {
    expect(compare(entry(), entry())).toEqual([]);
  });

  it('reports the unit type so the view can convert correctly', () => {
    const rows = compare(
      entry({ weightKg: 82, bodyFatPct: 20 }),
      entry({ weightKg: 78, bodyFatPct: 18 }),
    );

    expect(find(rows, 'weightKg')?.unitType).toBe('mass');
    expect(find(rows, 'bodyFatPct')?.unitType).toBe('percent');
  });
});
