import type { LengthUnit, WeightUnit } from '../models/prefs';

/**
 * Unit conversion.
 *
 * **Storage is always metric.** Kilograms and centimetres are canonical, and
 * conversion happens only at the presentation edge. This is not negotiable: if
 * values were stored as entered, switching units mid-history would corrupt
 * analytics, make personal records incomparable, and produce an export that
 * could not be interpreted without also knowing which unit was active on each
 * day. See docs/ARCHITECTURE.md section 5.5.
 */

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

/** Display granularity. Stored values keep full precision; this is a view concern. */
export const MASS_STEP: Readonly<Record<WeightUnit, number>> = Object.freeze({
  kg: 0.25,
  lb: 0.5,
});

export const LENGTH_STEP: Readonly<Record<LengthUnit, number>> = Object.freeze({
  cm: 0.1,
  in: 0.25,
});

/**
 * Rounds to a step without float drift.
 *
 * `Math.round(v / step) * step` reintroduces binary error (0.1 + 0.2 territory),
 * so the multiply-first form is used and the result is re-rounded to the step's
 * own decimal precision.
 */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  const inverse = 1 / step;
  const snapped = Math.round(value * inverse) / inverse;
  const decimals = decimalPlaces(step);
  return Number(snapped.toFixed(decimals));
}

function decimalPlaces(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Display value to canonical kilograms. */
export function toCanonicalMass(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

/** Canonical kilograms to a display value, snapped to the unit's step. */
export function toDisplayMass(kg: number, unit: WeightUnit): number {
  const raw = unit === 'kg' ? kg : kg / KG_PER_LB;
  return roundToStep(raw, MASS_STEP[unit]);
}

/** Display value to canonical centimetres. */
export function toCanonicalLength(value: number, unit: LengthUnit): number {
  return unit === 'cm' ? value : value * CM_PER_IN;
}

/** Canonical centimetres to a display value, snapped to the unit's step. */
export function toDisplayLength(cm: number, unit: LengthUnit): number {
  const raw = unit === 'cm' ? cm : cm / CM_PER_IN;
  return roundToStep(raw, LENGTH_STEP[unit]);
}

/**
 * The smallest load change that is meaningful in the display unit.
 *
 * A 2.5 kg plate jump is 5.5 lb, which is not a number anyone dials on a
 * machine, so in pounds the increment snaps to the unit's own step rather than
 * converting literally.
 */
export function displayIncrement(incrementKg: number, unit: WeightUnit): number {
  return unit === 'kg'
    ? roundToStep(incrementKg, MASS_STEP.kg)
    : roundToStep(incrementKg / KG_PER_LB, MASS_STEP.lb);
}

/** Every valid display value in a range, for round-trip property testing. */
export function stepGrid(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  const decimals = decimalPlaces(step);
  for (let value = from; value <= to + step / 2; value += step) {
    values.push(Number(value.toFixed(decimals)));
  }
  return values;
}
