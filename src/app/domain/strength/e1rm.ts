import type { E1rmFormulaName } from '../models/enums';

/**
 * Estimated one-rep maximum.
 *
 * PRODUCT_SPEC section 4.9 forbids fabricating numbers. Both formulas here are
 * regressions fitted to sets of roughly one to ten reps; past about twelve they
 * diverge wildly from reality (Brzycki's denominator reaches zero at 37 reps and
 * goes negative after). So above `MAX_REPS` this returns `null` rather than a
 * confident-looking figure, and the UI says it has no estimate instead of
 * printing one.
 *
 * Every value that comes out of here is an estimate and is marked as one on
 * screen; see the `estimate` badge.
 */

/** Beyond this, a one-rep estimate is not a prediction but a guess. */
export const MAX_REPS = 12;

export interface E1rm {
  value: number;
  formula: E1rmFormulaName;
  isEstimate: true;
}

/** Epley: `w × (1 + reps/30)`. The project default. */
function epley(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/** Brzycki: `w × 36/(37 − reps)`. Offered as a setting. */
function brzycki(weightKg: number, reps: number): number {
  return (weightKg * 36) / (37 - reps);
}

/**
 * Estimates a one-rep max, or returns `null` when no honest estimate exists.
 *
 * `null` for: a non-positive load, zero or negative reps, more than `MAX_REPS`
 * reps, or a non-finite input. A single rep is returned unchanged — it is not
 * an estimate at all, it is the measurement, and both formulas agree.
 */
export function estimate1Rm(
  weightKg: number | null,
  reps: number | null,
  formula: E1rmFormulaName = 'epley',
): E1rm | null {
  if (weightKg === null || reps === null) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg <= 0 || reps <= 0 || reps > MAX_REPS) return null;

  const raw =
    reps === 1 ? weightKg : formula === 'brzycki' ? brzycki(weightKg, reps) : epley(weightKg, reps);

  // Two decimals: the inputs are gym plates, so more precision is noise that
  // would also make two mathematically equal records compare unequal.
  return { value: Math.round(raw * 100) / 100, formula, isEstimate: true };
}
