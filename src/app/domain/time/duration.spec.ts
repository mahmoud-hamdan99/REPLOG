import {
  activeSeconds,
  durationParts,
  pausedSeconds,
  remainingSeconds,
  secondsBetween,
} from './duration';

const iso = (minutes: number): string =>
  new Date(Date.UTC(2026, 2, 2, 18, minutes, 0)).toISOString();

describe('duration', () => {
  describe('secondsBetween', () => {
    it('measures forward time', () => {
      expect(secondsBetween(iso(0), iso(5))).toBe(300);
    });

    it('never goes negative', () => {
      expect(secondsBetween(iso(5), iso(0))).toBe(0);
    });
  });

  describe('pausedSeconds', () => {
    it('sums closed pauses', () => {
      expect(pausedSeconds([{ at: iso(1), until: iso(3) }], iso(10))).toBe(120);
    });

    it('treats an open pause as still running', () => {
      expect(pausedSeconds([{ at: iso(1), until: null }], iso(6))).toBe(300);
    });

    it('is zero with no pauses', () => {
      expect(pausedSeconds([], iso(10))).toBe(0);
    });
  });

  describe('activeSeconds', () => {
    it('excludes paused time', () => {
      const pauses = [
        { at: iso(10), until: iso(15) },
        { at: iso(30), until: iso(32) },
      ];
      // 60 minutes elapsed, 7 minutes paused.
      expect(activeSeconds(iso(0), pauses, iso(60))).toBe(53 * 60);
    });

    it('stops accumulating while paused', () => {
      const pauses = [{ at: iso(10), until: null }];
      expect(activeSeconds(iso(0), pauses, iso(40))).toBe(10 * 60);
      // Still ten minutes of work half an hour later.
      expect(activeSeconds(iso(0), pauses, iso(70))).toBe(10 * 60);
    });

    /**
     * The property that makes backgrounding safe: elapsed time is derived from
     * timestamps, so a session resumed after hours away reports the truth
     * rather than whatever a throttled interval managed to count.
     */
    it('is correct after a long gap with no ticks', () => {
      const started = new Date(Date.UTC(2026, 2, 2, 9, 0, 0)).toISOString();
      const eightHoursLater = new Date(Date.UTC(2026, 2, 2, 17, 0, 0)).toISOString();
      expect(activeSeconds(started, [], eightHoursLater)).toBe(8 * 3600);
    });
  });

  describe('remainingSeconds', () => {
    const start = 1_000_000;

    it('counts down from the target', () => {
      expect(remainingSeconds(start, 90, start)).toBe(90);
      expect(remainingSeconds(start, 90, start + 30_000)).toBe(60);
    });

    it('floors at zero rather than going negative', () => {
      expect(remainingSeconds(start, 90, start + 120_000)).toBe(0);
    });

    it('is exact after a backgrounded gap', () => {
      // Ten minutes away from a 90 second timer: elapsed, not frozen at 90.
      expect(remainingSeconds(start, 90, start + 600_000)).toBe(0);
    });
  });

  describe('durationParts', () => {
    it('splits into hours, minutes and seconds', () => {
      expect(durationParts(3725)).toEqual({ hours: 1, minutes: 2, seconds: 5 });
      expect(durationParts(59)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
      expect(durationParts(3600)).toEqual({ hours: 1, minutes: 0, seconds: 0 });
    });

    it('clamps negatives to zero', () => {
      expect(durationParts(-10)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    });
  });
});
