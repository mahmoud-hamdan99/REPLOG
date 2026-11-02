/**
 * Duration maths.
 *
 * Everything here is derived from timestamps rather than from a counter that
 * ticks. iOS throttles and suspends timers in a backgrounded tab, so a
 * decrementing counter drifts or freezes, while `target - (now - startedAt)`
 * is correct the instant the app comes back. See docs/ARCHITECTURE.md
 * section 7.3.
 */

export interface Interval {
  at: string;
  until: string | null;
}

export function secondsBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
}

/** Total seconds covered by a list of pauses, treating an open pause as ongoing. */
export function pausedSeconds(pauses: readonly Interval[], nowIso: string): number {
  return pauses.reduce(
    (total, pause) => total + secondsBetween(pause.at, pause.until ?? nowIso),
    0,
  );
}

/** Elapsed working time: wall clock since the start, minus every pause. */
export function activeSeconds(
  startedAtIso: string,
  pauses: readonly Interval[],
  nowIso: string,
): number {
  return Math.max(0, secondsBetween(startedAtIso, nowIso) - pausedSeconds(pauses, nowIso));
}

/** Seconds left on a rest timer. Never negative; zero means it has elapsed. */
export function remainingSeconds(startedAtMs: number, targetSec: number, nowMs: number): number {
  return Math.max(0, Math.ceil((startedAtMs + targetSec * 1000 - nowMs) / 1000));
}

/**
 * `m:ss`, or `h:mm:ss` past an hour.
 *
 * Returns parts rather than a formatted string so the view layer controls the
 * numeral system: Arabic can render these with Eastern or Western digits.
 */
export function durationParts(totalSeconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(safe / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  };
}
