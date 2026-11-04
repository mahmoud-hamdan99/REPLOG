/**
 * When to remind someone to export (DATABASE_SPEC section 9.4).
 *
 * The rule has two halves and both matter: more than fourteen days since the
 * last export, **and** training logged since that export. Without the second
 * half the card nags someone who has not trained in a month about losing work
 * they have not done — which teaches them to ignore it, and then it is not
 * there when it matters.
 *
 * Snoozing is real: a snoozed reminder stays quiet until the date passes,
 * rather than returning on the next launch.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Long enough that it is not noise; short enough to lose only one block. */
export const EXPORT_REMINDER_DAYS = 14;

export interface ReminderInput {
  /** Null when the user has never exported. */
  lastExportAt: string | null;
  /** The most recent completed session, or null if there are none. */
  lastWorkoutAt: string | null;
  /** Set by the Snooze action; the card stays hidden until then. */
  snoozedUntil: string | null;
  nowMs: number;
}

export type ReminderReason = 'never-exported' | 'stale-export';

export interface Reminder {
  reason: ReminderReason;
  /** Days since the last export; zero when there has never been one. */
  daysSinceExport: number;
}

/**
 * The reminder to show, or null for silence.
 *
 * Returns the reason rather than a boolean so the card can say the true
 * thing. "You have never exported" and "it has been three weeks" need
 * different sentences, and a single message covering both would be vague
 * enough to be ignored.
 */
export function dueReminder(input: ReminderInput): Reminder | null {
  if (input.lastWorkoutAt === null) return null;

  if (input.snoozedUntil !== null) {
    const until = Date.parse(input.snoozedUntil);
    if (!Number.isNaN(until) && until > input.nowMs) return null;
  }

  if (input.lastExportAt === null) {
    // Never exported, but there is something to lose. This is the one case
    // where the reminder does not wait fourteen days: a user one session in
    // has the most to gain from learning the export exists.
    return { reason: 'never-exported', daysSinceExport: 0 };
  }

  const exportedAt = Date.parse(input.lastExportAt);
  if (Number.isNaN(exportedAt)) return { reason: 'never-exported', daysSinceExport: 0 };

  // Trained since the last export? If not, the file they already have is a
  // complete copy and there is nothing to remind them about.
  const workedOutAt = Date.parse(input.lastWorkoutAt);
  if (Number.isNaN(workedOutAt) || workedOutAt <= exportedAt) return null;

  const days = Math.floor((input.nowMs - exportedAt) / DAY_MS);
  if (days <= EXPORT_REMINDER_DAYS) return null;

  return { reason: 'stale-export', daysSinceExport: days };
}

/** Snoozing pushes the card out by a week, not forever. */
export const SNOOZE_DAYS = 7;

/**
 * When a card dismissed at `dismissedAt` is allowed back.
 *
 * Takes the dismissal rather than "now" so the caller can store the plain
 * fact — when the user tapped Not now — and derive the deadline from it. A
 * stored deadline would bake today's snooze length into the database, and
 * changing that length later would leave old rows meaning something else.
 */
export function snoozedUntil(dismissedAt: string | null): string | null {
  if (dismissedAt === null) return null;
  const at = Date.parse(dismissedAt);
  return Number.isNaN(at) ? null : new Date(at + SNOOZE_DAYS * DAY_MS).toISOString();
}
