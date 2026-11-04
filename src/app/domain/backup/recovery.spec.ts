import { RECOVERY_WINDOW_DAYS } from '../models/entity';
import { daysLeft, isRecoverable, partitionByWindow } from './recovery';
import { EXPORT_REMINDER_DAYS, dueReminder, snoozedUntil } from './reminder';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('recovery window', () => {
  it('keeps a record deleted a moment ago', () => {
    expect(isRecoverable(ago(0), NOW)).toBe(true);
  });

  it('keeps a record on the last day of the window', () => {
    expect(isRecoverable(ago(RECOVERY_WINDOW_DAYS - 0.5), NOW)).toBe(true);
  });

  it('drops a record one day past the window', () => {
    expect(isRecoverable(ago(RECOVERY_WINDOW_DAYS + 1), NOW)).toBe(false);
  });

  it('counts whole days down, never promising a day that is not there', () => {
    expect(daysLeft(ago(0), NOW)).toBe(RECOVERY_WINDOW_DAYS);
    expect(daysLeft(ago(29.6), NOW)).toBe(0);
    expect(daysLeft(ago(100), NOW)).toBe(0);
  });

  it('separates what can come back from what cannot, newest first', () => {
    const { recoverable, expired } = partitionByWindow(
      [
        { id: 'old', deletedAt: ago(40) },
        { id: 'yesterday', deletedAt: ago(1) },
        { id: 'live', deletedAt: null },
        { id: 'lastWeek', deletedAt: ago(7) },
      ],
      NOW,
    );

    expect(recoverable.map((r) => r.id)).toEqual(['yesterday', 'lastWeek']);
    expect(expired.map((r) => r.id)).toEqual(['old']);
  });

  it('treats an unreadable date as expired rather than recoverable', () => {
    // Offering Restore on a record whose deletion date nothing can parse
    // would be a promise the purge cannot keep.
    const { recoverable, expired } = partitionByWindow([{ id: 'bad', deletedAt: 'nonsense' }], NOW);

    expect(recoverable).toEqual([]);
    expect(expired.map((r) => r.id)).toEqual(['bad']);
  });
});

describe('backup reminder', () => {
  const base = {
    lastExportAt: ago(30),
    lastWorkoutAt: ago(1),
    snoozedUntil: null,
    nowMs: NOW,
  };

  it('says nothing to someone who has never trained', () => {
    // Nothing to lose yet, and a reminder here teaches the user to ignore it.
    expect(dueReminder({ ...base, lastWorkoutAt: null, lastExportAt: null })).toBeNull();
  });

  it('asks for a first export as soon as there is something to lose', () => {
    expect(dueReminder({ ...base, lastExportAt: null })).toEqual({
      reason: 'never-exported',
      daysSinceExport: 0,
    });
  });

  it('stays quiet when the export is older than the last workout by date only', () => {
    // Exported after the last session: the file on disk is already complete,
    // however long ago that was.
    expect(dueReminder({ ...base, lastExportAt: ago(0), lastWorkoutAt: ago(10) })).toBeNull();
  });

  it('stays quiet inside the window even with new training', () => {
    expect(dueReminder({ ...base, lastExportAt: ago(EXPORT_REMINDER_DAYS) })).toBeNull();
  });

  it('speaks up past the window when there is new training', () => {
    expect(dueReminder({ ...base, lastExportAt: ago(EXPORT_REMINDER_DAYS + 1) })).toEqual({
      reason: 'stale-export',
      daysSinceExport: EXPORT_REMINDER_DAYS + 1,
    });
  });

  it('respects a snooze, and returns once it lapses', () => {
    const snoozed = snoozedUntil(ago(0));

    expect(dueReminder({ ...base, snoozedUntil: snoozed })).toBeNull();
    expect(dueReminder({ ...base, snoozedUntil: snoozed, nowMs: NOW + 8 * DAY })).not.toBeNull();
  });

  it('ignores an unreadable dismissal rather than hiding the card forever', () => {
    expect(snoozedUntil('nonsense')).toBeNull();
    expect(dueReminder({ ...base, snoozedUntil: snoozedUntil('nonsense') })).not.toBeNull();
  });

  it('treats an unreadable export date as never having exported', () => {
    expect(dueReminder({ ...base, lastExportAt: 'nonsense' })).toEqual({
      reason: 'never-exported',
      daysSinceExport: 0,
    });
  });
});
