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

/**
 * Display granularity for a *load*. Stored values keep full precision.
 *
 * Sized for plates: you cannot load 80.4 kg on a bar, so showing it would be
 * precision the gym does not have.
 */
export const MASS_STEP: Readonly<Record<WeightUnit, number>> = Object.freeze({
  kg: 0.25,
  lb: 0.5,
});

/**
 * Display granularity for a *measurement*, which is a different question.
 *
 * A scale reads 80.4 kg and the app has to show 80.4 kg. Snapping a
 * measurement to the plate grid would quietly rewrite what the user read off
 * the display in front of them — the same fabrication the clamping rule in
 * DATABASE_SPEC section 10 exists to prevent, just rounded instead of capped.
 *
 * One tenth in every unit, deliberately. A coarser grid would be defensible
 * as "what scales read", but it would fail to round-trip a value someone
 * typed: 177.3 lb on a 0.2 grid comes back as 177.2. The step is here to hide
 * floating-point noise after a conversion, not to have an opinion about how
 * precisely a body can be measured.
 */
export const MEASUREMENT_STEP = 0.1;

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

/** Canonical kilograms to a display load, snapped to the plate grid. */
export function toDisplayMass(kg: number, unit: WeightUnit): number {
  const raw = unit === 'kg' ? kg : kg / KG_PER_LB;
  return roundToStep(raw, MASS_STEP[unit]);
}

/** Canonical kilograms to a displayed *measurement*, at scale precision. */
export function toDisplayBodyMass(kg: number, unit: WeightUnit): number {
  const raw = unit === 'kg' ? kg : kg / KG_PER_LB;
  return roundToStep(raw, MEASUREMENT_STEP);
}

/** Canonical centimetres to a displayed *measurement*, at tape precision. */
export function toDisplayBodyLength(cm: number, unit: LengthUnit): number {
  const raw = unit === 'cm' ? cm : cm / CM_PER_IN;
  return roundToStep(raw, MEASUREMENT_STEP);
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
