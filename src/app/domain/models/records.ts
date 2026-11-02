import type { Entity, Flag } from './entity';
import type { E1rmFormulaName, PrType } from './enums';

/**
 * One achievement event, so personal-record *history* is preserved rather than
 * overwritten. PRODUCT_SPEC section 4.10 asks for a record history, and a
 * progression reads better than a single current value.
 */
export interface PersonalRecord extends Entity {
  exerciseId: string;
  /** Comparison is always variant-scoped. See `variantKey` in exercise.ts. */
  variantKey: string;
  nameSnapshot: string;
  prType: PrType;
  /** Kilograms, reps, or kg-reps depending on `prType`. */
  value: number;
  weightKg: number | null;
  reps: number | null;
  /**
   * For `maxRepsAtWeight`: the exact weight bucket this record belongs to, so
   * twelve reps at 20 kg cannot beat five reps at 100 kg.
   */
  repBucket: number | null;
  /** True only for `estimated1RM`. Drives the visual estimate marker. */
  isEstimate: boolean;
  /** Non-null if and only if `isEstimate`. */
  formula: E1rmFormulaName | null;
  achievedAt: string;
  /** Provenance: tapping a record opens the exact set that produced it. */
  workoutId: string;
  setLogId: string;
  /**
   * Enables "+5 kg over your last best" without a second query. `null` marks a
   * first-ever record, which the UI labels "First record", not "New PR".
   */
  previousValue: number | null;
  previousAchievedAt: string | null;
  /** Exactly one per (variantKey, prType, repBucket). Indexed, so a flag. */
  isCurrent: Flag;
}
