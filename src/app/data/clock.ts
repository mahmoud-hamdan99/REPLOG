import { InjectionToken } from '@angular/core';

/**
 * Time source. Injected rather than reading `Date.now()` inline, for two
 * reasons: the project forbids assuming globals, and every timer in the app is
 * derived from timestamps rather than counters (docs/ARCHITECTURE.md section
 * 7.3), so tests must be able to advance time deterministically.
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** ISO-8601 UTC instant. */
  nowIso(): string;
  /** Minutes offset from UTC, for local day-key maths. */
  timezoneOffsetMinutes(): number;
}

export const CLOCK = new InjectionToken<Clock>('CLOCK');
