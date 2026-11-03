/**
 * How reliably someone is actually training, against what they planned.
 *
 * The number is deliberately blunt. A percentage with no denominator invites
 * the reading "I am 75 % good at this"; the shape returned here forces the
 * screen to show "3 of 4 weeks", which is a fact someone can do something
 * about.
 */

export interface WeekTally {
  /** Day key of the week's first day. */
  week: string;
  sessions: number;
}

export interface Consistency {
  /** Weeks in the window that met the target. */
  weeksHit: number;
  weeksCounted: number;
  /** Sessions actually completed in the window. */
  sessions: number;
  /** Sessions the active plan asked for across the window. */
  planned: number;
  /**
   * Weeks hit over weeks counted, 0–1, or `null` when there is no plan to
   * measure against. Null rather than zero: no target is not failure.
   */
  rate: number | null;
}

/**
 * Consistency over the weeks in a window.
 *
 * Measured in **weeks met**, not sessions completed, because the two say
 * different things and only one is about consistency. Someone who trains eight
 * times in one week and not at all for three has a session count that looks
 * fine; what they do not have is a habit.
 *
 * The current week is included only if it is already complete, which the
 * caller decides by what it passes — a partial week scored against a full
 * target would report a failure every Monday morning.
 */
export function consistency(
  weeks: readonly WeekTally[],
  sessionsPerWeek: number | null,
): Consistency {
  const sessions = weeks.reduce((total, week) => total + week.sessions, 0);

  if (sessionsPerWeek === null || sessionsPerWeek <= 0) {
    return {
      weeksHit: 0,
      weeksCounted: weeks.length,
      sessions,
      planned: 0,
      rate: null,
    };
  }

  const weeksHit = weeks.filter((week) => week.sessions >= sessionsPerWeek).length;

  return {
    weeksHit,
    weeksCounted: weeks.length,
    sessions,
    planned: sessionsPerWeek * weeks.length,
    rate: weeks.length === 0 ? null : weeksHit / weeks.length,
  };
}

/**
 * The longest run of consecutive weeks that met the target.
 *
 * A streak is the one consistency number people chase, so it has to be
 * measured the same way the rate is: on weeks met, over consecutive weeks,
 * with a missed week breaking it. Weeks must arrive in order.
 */
export function longestStreak(weeks: readonly WeekTally[], sessionsPerWeek: number | null): number {
  if (sessionsPerWeek === null || sessionsPerWeek <= 0) return 0;

  let best = 0;
  let run = 0;
  for (const week of weeks) {
    run = week.sessions >= sessionsPerWeek ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
