import { roundToStep } from '../units/convert';
import { isWorkingSet } from './volume';
import type { SetType } from '../models/enums';

/**
 * Next-session suggestions.
 *
 * A pure function of what was last logged, implementing the rules in
 * docs/ARCHITECTURE.md section 6.2. Three things it deliberately does not do:
 *
 *   - it never returns a suggestion without history. Fewer than one prior
 *     session produces `null`, and the UI says "No history yet" rather than
 *     offering a number pulled from nowhere
 *   - it never decides anything. The caller renders the result as ghost text
 *     the user must tap to accept; nothing here is written into a plan or
 *     prefilled as a committed value (PRODUCT_SPEC section 4.5)
 *   - it never hides its reasoning. Every suggestion carries the rule that
 *     produced it, as a translation key the view renders beside the number
 */

/** Default jumps, before the equipment's own increment is applied. */
export const UPPER_BODY_STEP_KG = 2.5;
export const LOWER_BODY_STEP_KG = 5;
/** How far a deload backs off. Within the 5–10 % the architecture allows. */
export const DELOAD_FRACTION = 0.1;

export type SuggestionRule = 'increase' | 'deload' | 'repeat';
export type Confidence = 'low' | 'medium' | 'high';

export interface ProgressionSet {
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
}

export interface ProgressionInput {
  /** The most recent completed session's sets for this variant. */
  lastSession: readonly ProgressionSet[];
  /** How many completed sessions exist, so confidence can be honest. */
  sessionCount: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  /** The exercise's own smallest sensible jump, in kilograms. */
  incrementKg: number;
  /** Lower-body work takes the bigger default step. */
  isLowerBody: boolean;
}

export interface Suggestion {
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  rule: SuggestionRule;
  confidence: Confidence;
  /** Translation key; the view supplies the words. */
  reasonKey: string;
  reasonParams: Record<string, number>;
  /** Always. A suggestion is a projection, never a measurement. */
  isEstimate: true;
}

/**
 * What to try next, or `null` when there is nothing to go on.
 *
 * `null` is a real answer here and the common one for a new exercise. The
 * alternative — guessing a starting weight — would be the app inventing a
 * number and presenting it as advice.
 */
export function suggestNext(input: ProgressionInput): Suggestion | null {
  const working = input.lastSession.filter(
    (set) => isWorkingSet(set.setType) && set.reps !== null && set.reps > 0,
  );
  if (input.sessionCount < 1 || working.length === 0) {
    return null;
  }

  // The load to progress from is the heaviest the lifter actually worked at.
  const topWeight = working.reduce<number | null>(
    (best, set) =>
      set.weightKg !== null && (best === null || set.weightKg > best) ? set.weightKg : best,
    null,
  );
  const topReps = working.reduce((best, set) => Math.max(best, set.reps ?? 0), 0);
  const step = input.isLowerBody ? LOWER_BODY_STEP_KG : UPPER_BODY_STEP_KG;
  const increment = input.incrementKg > 0 ? input.incrementKg : step;
  const confidence: Confidence =
    input.sessionCount >= 3 ? 'high' : input.sessionCount === 2 ? 'medium' : 'low';

  const { targetRepsMin, targetRepsMax } = input;

  // Every working set at the top of the range: the range is done its job.
  if (targetRepsMax !== null && working.every((set) => (set.reps ?? 0) >= targetRepsMax)) {
    const jump = Math.max(increment, roundToStep(step, increment));
    return {
      suggestedWeightKg: topWeight === null ? null : round2(topWeight + jump),
      suggestedReps: targetRepsMin ?? targetRepsMax,
      rule: 'increase',
      confidence,
      reasonKey: 'suggest.reason.increase',
      reasonParams: { reps: targetRepsMax, jump: round2(jump) },
      isEstimate: true,
    };
  }

  // Two or more sets short of the bottom: the load, not the effort, is wrong.
  const missed =
    targetRepsMin === null ? 0 : working.filter((set) => (set.reps ?? 0) < targetRepsMin).length;
  if (missed >= 2 && topWeight !== null) {
    const backOff = Math.max(increment, roundToStep(topWeight * DELOAD_FRACTION, increment));
    const deloaded = Math.max(increment, round2(topWeight - backOff));
    return {
      suggestedWeightKg: deloaded,
      suggestedReps: targetRepsMin,
      rule: 'deload',
      confidence,
      reasonKey: 'suggest.reason.deload',
      reasonParams: { sets: missed, percent: Math.round(DELOAD_FRACTION * 100) },
      isEstimate: true,
    };
  }

  // Mid-range: stay at the load and win a rep.
  const nextReps = targetRepsMax === null ? topReps + 1 : Math.min(topReps + 1, targetRepsMax);
  return {
    suggestedWeightKg: topWeight,
    suggestedReps: nextReps,
    rule: 'repeat',
    confidence,
    reasonKey: 'suggest.reason.repeat',
    reasonParams: { reps: nextReps },
    isEstimate: true,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
