import type { MeasurementUnitType } from '../models/enums';
import type { Measurement } from '../models/body';

/**
 * The measurement catalogue.
 *
 * One list, in body order, used by the entry sheet, the list, the comparison
 * table and the import validator. Keeping the order and the unit type here
 * rather than in a template means a new measurement is one entry rather than
 * four edits that can disagree.
 */

/** Every built-in measurement field, as it is stored. */
export type MeasurementField =
  | 'weightKg'
  | 'heightCm'
  | 'neckCm'
  | 'shouldersCm'
  | 'chestCm'
  | 'waistCm'
  | 'hipsCm'
  | 'bicepsLeftCm'
  | 'bicepsRightCm'
  | 'forearmLeftCm'
  | 'forearmRightCm'
  | 'thighLeftCm'
  | 'thighRightCm'
  | 'calfLeftCm'
  | 'calfRightCm'
  | 'bodyFatPct';

/** A row in the entry sheet: one field, or a left/right pair on one line. */
export interface FieldRow {
  /** Translation key suffix, e.g. `body.field.biceps`. */
  group: string;
  unitType: MeasurementUnitType;
  /** One field, or exactly two for a paired row. */
  fields: readonly MeasurementField[];
  /**
   * Shown above the fold.
   *
   * Only body weight. UI_UX_SPEC section 5.10 puts it first and focused,
   * because weighing yourself is the measurement people actually repeat.
   */
  primary?: boolean;
}

/**
 * Rows in the order the spec asks for: weight, then neck down to calves,
 * then body fat. Height sits with the rarely-changing values near the top.
 */
export const MEASUREMENT_ROWS: readonly FieldRow[] = [
  { group: 'weight', unitType: 'mass', fields: ['weightKg'], primary: true },
  { group: 'height', unitType: 'length', fields: ['heightCm'] },
  { group: 'neck', unitType: 'length', fields: ['neckCm'] },
  { group: 'shoulders', unitType: 'length', fields: ['shouldersCm'] },
  { group: 'chest', unitType: 'length', fields: ['chestCm'] },
  { group: 'waist', unitType: 'length', fields: ['waistCm'] },
  { group: 'hips', unitType: 'length', fields: ['hipsCm'] },
  { group: 'biceps', unitType: 'length', fields: ['bicepsLeftCm', 'bicepsRightCm'] },
  { group: 'forearm', unitType: 'length', fields: ['forearmLeftCm', 'forearmRightCm'] },
  { group: 'thigh', unitType: 'length', fields: ['thighLeftCm', 'thighRightCm'] },
  { group: 'calf', unitType: 'length', fields: ['calfLeftCm', 'calfRightCm'] },
  { group: 'bodyFat', unitType: 'percent', fields: ['bodyFatPct'] },
];

/** Every field, flattened, in the same order. */
export const MEASUREMENT_FIELDS: readonly MeasurementField[] = MEASUREMENT_ROWS.flatMap(
  (row) => row.fields,
);

const UNIT_BY_FIELD = new Map<MeasurementField, MeasurementUnitType>(
  MEASUREMENT_ROWS.flatMap((row) => row.fields.map((field) => [field, row.unitType] as const)),
);

export function unitTypeOf(field: MeasurementField): MeasurementUnitType {
  return UNIT_BY_FIELD.get(field) ?? 'length';
}

/** Which half of a pair a field is, for the "Left"/"Right" sub-label. */
export function sideOf(field: MeasurementField): 'left' | 'right' | null {
  if (field.includes('Left')) return 'left';
  if (field.includes('Right')) return 'right';
  return null;
}

/** Reads a built-in field off a record, in canonical units. */
export function valueOf(entry: Measurement, field: MeasurementField): number | null {
  return entry[field];
}

/**
 * Fields a record actually carries.
 *
 * The list screen shows only these: a row of blanks for everything the user
 * did not measure says nothing, and makes a partial entry look like a failure
 * rather than the normal case it is.
 */
export function recordedFields(entry: Measurement): MeasurementField[] {
  return MEASUREMENT_FIELDS.filter((field) => entry[field] !== null);
}

/** Whether a record carries anything at all, including custom values. */
export function isEmpty(entry: Pick<Measurement, MeasurementField | 'custom'>): boolean {
  const hasBuiltIn = MEASUREMENT_FIELDS.some((field) => entry[field] !== null);
  return !hasBuiltIn && Object.keys(entry.custom ?? {}).length === 0;
}
