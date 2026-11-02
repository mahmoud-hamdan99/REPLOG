import { remainingSeconds } from '../time/duration';

/**
 * Rest timer state.
 *
 * A timestamp and a target, never a counter (docs/ARCHITECTURE.md section 7.3).
 * iOS suspends timers in a backgrounded tab, so anything that decrements drifts
 * or freezes; `target − (now − startedAt)` is correct the instant the app comes
 * back, however long it was away.
 */

export const REST_ADJUST_SEC = 15;
export const MAX_REST_SEC = 3600;

export interface RestState {
  startedAtMs: number;
  targetSec: number;
  /** What the timer is resting *for*, so the sheet can say what comes next. */
  exerciseId: string | null;
  setId: string | null;
}

export function restRemainingSec(state: RestState, nowMs: number): number {
  return remainingSeconds(state.startedAtMs, state.targetSec, nowMs);
}

export function restElapsedSec(state: RestState, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - state.startedAtMs) / 1000));
}

export function isRestDone(state: RestState, nowMs: number): boolean {
  return restRemainingSec(state, nowMs) === 0;
}

/** Ring fill from 1 (just started) down to 0 (elapsed). */
export function restProgress(state: RestState, nowMs: number): number {
  if (state.targetSec <= 0) return 0;
  return Math.min(1, Math.max(0, restRemainingSec(state, nowMs) / state.targetSec));
}

/**
 * Moves the target by `deltaSec`.
 *
 * The target is clamped to the time already elapsed rather than to the original
 * value, so pressing −15 s with 5 s left ends the rest immediately instead of
 * producing a negative countdown. `startedAtMs` is never touched: it is the one
 * fact the timer is derived from.
 */
export function adjustRest(state: RestState, deltaSec: number, nowMs: number): RestState {
  const elapsed = restElapsedSec(state, nowMs);
  const target = Math.min(MAX_REST_SEC, Math.max(elapsed, state.targetSec + deltaSec));
  return { ...state, targetSec: target };
}
