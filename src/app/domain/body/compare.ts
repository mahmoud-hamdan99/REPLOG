import type { CustomMeasurementDef, Measurement } from '../models/body';
import type { MeasurementUnitType } from '../models/enums';
import { MEASUREMENT_FIELDS, sideOf, unitTypeOf, type MeasurementField } from './fields';

/**
 * Comparing two entries.
 *
 * The rule here is the one PRODUCT_SPEC section 4.9 keeps asking for: **a gap
 * stays a gap.** A delta exists only where both sides have a value, and where
 * one does not the row says which side is missing rather than treating the
 * absence as a zero. "Waist: −4 cm" when the earlier entry had no waist
 * measurement would be a number the data never supported.
 */

export type ComparisonStatus = 'both' | 'missing-from' | 'missing-to' | 'missing-both';

export interface ComparisonRow {
  /** Built-in field key, or the custom definition's id. */
  key: string;
  /** Translation key suffix for a built-in; null for a custom row. */
  group: string | null;
  /** The custom definition's label, when this is a custom row. */
  label: string | null;
  /**
   * Which of a pair this is, or null for a single field.
   *
   * Without it both halves of a pair render as "Biceps" and the table cannot
   * be read: the group name alone does not say which arm moved.
   */
  side: 'left' | 'right' | null;
  unitType: MeasurementUnitType;
  from: number | null;
  to: number | null;
  /** `null` whenever either side is missing — never a stand-in zero. */
  delta: number | null;
  status: ComparisonStatus;
}

function statusOf(from: number | null, to: number | null): ComparisonStatus {
  if (from !== null && to !== null) return 'both';
  if (from === null && to === null) return 'missing-both';
  return from === null ? 'missing-from' : 'missing-to';
}

function row(
  key: string,
  group: string | null,
  label: string | null,
  side: 'left' | 'right' | null,
  unitType: MeasurementUnitType,
  from: number | null,
  to: number | null,
): ComparisonRow {
  const status = statusOf(from, to);
  return {
    key,
    group,
    label,
    side,
    unitType,
    from,
    to,
    delta: status === 'both' ? round2((to as number) - (from as number)) : null,
    status,
  };
}

/**
 * Every field either entry mentions, with its change.
 *
 * Rows where neither side has a value are left out entirely: the table is
 * about what changed, and listing the measurements nobody took would bury it.
 */
export function compare(
  from: Measurement,
  to: Measurement,
  definitions: readonly CustomMeasurementDef[] = [],
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  for (const field of MEASUREMENT_FIELDS) {
    const built = row(
      field,
      groupOf(field),
      null,
      sideOf(field),
      unitTypeOf(field),
      from[field],
      to[field],
    );
    if (built.status !== 'missing-both') rows.push(built);
  }

  for (const definition of definitions) {
    const custom = row(
      definition.id,
      null,
      definition.label,
      null,
      definition.unitType,
      from.custom[definition.id] ?? null,
      to.custom[definition.id] ?? null,
    );
    if (custom.status !== 'missing-both') rows.push(custom);
  }

  return rows;
}

/**
 * The change in one field between an entry and the one before it.
 *
 * What the entry sheet shows live beside a field as it is typed. `null` when
 * there is nothing to compare against, which the field renders as no delta
 * rather than as a zero change.
 */
export function deltaFor(
  previous: Measurement | null,
  value: number | null,
  field: MeasurementField,
): number | null {
  if (previous === null || value === null) return null;
  const before = previous[field];
  return before === null ? null : round2(value - before);
}

/** The same, for a custom measurement. */
export function customDeltaFor(
  previous: Measurement | null,
  value: number | null,
  definitionId: string,
): number | null {
  if (previous === null || value === null) return null;
  const before = previous.custom[definitionId];
  return before === undefined ? null : round2(value - before);
}

/**
 * The most recent entry that recorded a field, for the ghost value.
 *
 * Walks back rather than taking the latest entry: the last time you measured
 * your waist is the comparison you want, even if you have weighed yourself
 * six times since.
 */
export function lastRecording(
  entries: readonly Measurement[],
  field: MeasurementField,
  excludeId?: string,
): Measurement | null {
  for (const entry of entries) {
    if (entry.id === excludeId) continue;
    if (entry[field] !== null) return entry;
  }
  return null;
}

/**
 * The weighed entry closest in time to a given day.
 *
 * Distinct from `lastRecording`, which walks back from now. A photo taken in
 * March and imported in July belongs beside March's weight: captioning it with
 * today's would attach a number to a picture that never showed it. Closest in
 * either direction, because a weigh-in two days after the photo describes it
 * better than one three weeks before.
 *
 * Ties go to the earlier entry, so the caption does not depend on the order
 * the list happened to arrive in.
 */
export function nearestWeight(entries: readonly Measurement[], day: string): Measurement | null {
  let best: Measurement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    if (entry.weightKg === null) continue;

    const distance = Math.abs(epochDay(entry.measuredAt) - epochDay(day));
    const closer = distance < bestDistance;
    const earlierTie =
      distance === bestDistance && best !== null && entry.measuredAt < best.measuredAt;

    if (closer || earlierTie) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * A `YYYY-MM-DD` key as a count of days.
 *
 * Built from UTC so the subtraction is whole days: a local-midnight
 * difference across a daylight-saving boundary is 23 or 25 hours, and the
 * distance between two weigh-ins should not depend on the time of year.
 */
function epochDay(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Translation-key suffix for a built-in field's row. */
function groupOf(field: MeasurementField): string {
  return field
    .replace(/(Kg|Cm|Pct)$/, '')
    .replace(/(Left|Right)$/, '')
    .replace(/^weight$/, 'weight');
}
