import { SystemClock } from './system-clock';

describe('SystemClock', () => {
  it('reports the current epoch milliseconds', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('formats the current instant as ISO-8601 UTC', () => {
    expect(new SystemClock().nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reports the timezone offset with the sign convention callers expect', () => {
    // getTimezoneOffset returns minutes *behind* UTC; the clock inverts it so
    // that east of UTC is positive, which is how day-key maths reads.
    expect(new SystemClock().timezoneOffsetMinutes()).toBe(-new Date().getTimezoneOffset());
  });
});
