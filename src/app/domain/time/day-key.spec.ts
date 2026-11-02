import {
  addDays,
  dayKey,
  dayKeyAt,
  dayKeysBetween,
  daysBetween,
  monthKey,
  parseDayKey,
  startOfDay,
  startOfWeek,
  weekKey,
} from './day-key';

describe('calendar keys', () => {
  it('uses the local calendar day, not UTC', () => {
    // A late-evening session belongs to that evening. Formatting via toISOString
    // would push anything after the UTC rollover onto the next day.
    const lateEvening = new Date(2026, 2, 2, 23, 30, 0);
    expect(dayKey(lateEvening)).toBe('2026-03-02');

    const justAfterMidnight = new Date(2026, 2, 3, 0, 10, 0);
    expect(dayKey(justAfterMidnight)).toBe('2026-03-03');
  });

  it('pads months and days', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(monthKey(new Date(2026, 0, 5))).toBe('2026-01');
  });

  it('round-trips a day key through parsing', () => {
    expect(dayKey(parseDayKey('2026-07-19'))).toBe('2026-07-19');
  });

  it('parses to local midnight', () => {
    const parsed = parseDayKey('2026-07-19');
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
  });

  it('startOfDay strips the time', () => {
    const stripped = startOfDay(new Date(2026, 5, 9, 17, 45, 31, 123));
    expect(stripped.getHours()).toBe(0);
    expect(stripped.getMilliseconds()).toBe(0);
    expect(dayKey(stripped)).toBe('2026-06-09');
  });

  describe('addDays', () => {
    it('crosses month and year boundaries', () => {
      expect(dayKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
      expect(dayKey(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
      expect(dayKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
    });

    it('handles a leap day', () => {
      expect(dayKey(addDays(new Date(2028, 1, 28), 1))).toBe('2028-02-29');
    });

    /**
     * The reason addDays builds a new local date instead of adding 86_400_000 ms:
     * across a DST boundary a day is 23 or 25 hours, so millisecond arithmetic
     * lands on the wrong calendar date in any observing timezone. In a UTC test
     * environment this simply still passes.
     */
    it('advances by one calendar day regardless of DST', () => {
      for (const start of [new Date(2026, 2, 28), new Date(2026, 9, 24)]) {
        const next = addDays(start, 1);
        expect(daysBetween(dayKey(start), dayKey(next))).toBe(1);
      }
    });
  });

  describe('startOfWeek and weekKey', () => {
    // 2026-03-02 is a Monday.
    const wednesday = new Date(2026, 2, 4);

    it('honours a Monday week start', () => {
      expect(dayKey(startOfWeek(wednesday, 1))).toBe('2026-03-02');
      expect(weekKey(wednesday, 1)).toBe('2026-03-02');
    });

    it('honours a Sunday week start', () => {
      expect(weekKey(wednesday, 0)).toBe('2026-03-01');
    });

    it('honours a Saturday week start', () => {
      expect(weekKey(wednesday, 6)).toBe('2026-02-28');
    });

    it('returns the day itself when it is the first day of the week', () => {
      const monday = new Date(2026, 2, 2);
      expect(weekKey(monday, 1)).toBe('2026-03-02');
    });

    it('produces keys that sort chronologically as strings', () => {
      const keys = [
        weekKey(new Date(2026, 11, 30), 1),
        weekKey(new Date(2026, 0, 2), 1),
        weekKey(new Date(2026, 5, 15), 1),
      ];
      expect([...keys].sort()).toEqual([keys[1], keys[2], keys[0]]);
    });
  });

  describe('dayKeysBetween', () => {
    it('is inclusive of both ends', () => {
      expect(dayKeysBetween(new Date(2026, 2, 1), new Date(2026, 2, 4))).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
      ]);
    });

    it('returns a single key when both ends are the same day', () => {
      expect(dayKeysBetween(new Date(2026, 2, 1, 8), new Date(2026, 2, 1, 22))).toEqual([
        '2026-03-01',
      ]);
    });

    it('returns nothing when the range is inverted', () => {
      expect(dayKeysBetween(new Date(2026, 2, 4), new Date(2026, 2, 1))).toEqual([]);
    });
  });

  describe('daysBetween', () => {
    it('counts whole days', () => {
      expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
      expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
      expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    });

    it('counts across a year boundary', () => {
      expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    });
  });

  describe('dayKeyAt', () => {
    it('reads the day in the offset the clock reports, not the machine zone', () => {
      const instant = Date.UTC(2026, 2, 2, 22, 30, 0);

      expect(dayKeyAt(instant, 0)).toBe('2026-03-02');
      // UTC+3: 01:30 the next morning is already the next day there.
      expect(dayKeyAt(instant, 180)).toBe('2026-03-03');
      // UTC−5: still the afternoon of the same day.
      expect(dayKeyAt(instant, -300)).toBe('2026-03-02');
    });

    it('keeps a late-evening session on its own evening', () => {
      expect(dayKeyAt(Date.UTC(2026, 2, 2, 23, 30, 0), 0)).toBe('2026-03-02');
      expect(dayKeyAt(Date.UTC(2026, 2, 3, 0, 10, 0), 0)).toBe('2026-03-03');
    });
  });
});
