import { Service } from '@angular/core';
import type { Clock } from '../../data/clock';

/** The real clock. Swapped for a fake in tests. */
@Service()
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  timezoneOffsetMinutes(): number {
    return -new Date().getTimezoneOffset();
  }
}
