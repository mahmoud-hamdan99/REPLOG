import type { MeasurementUnitType } from '../models/enums';
import { unitTypeOf, type MeasurementField } from './fields';

/**
 * Measurement validation.
 *
 * The rule that shapes this module is DATABASE_SPEC section 10's last line:
 * **out-of-range values are questioned, not silently clamped.** Clamping user
 * data is a form of fabrication — it replaces what someone typed with what the
 * app would have preferred, and they never find out.
 *
 * So there are two bands per field. Outside the *hard* band the value is not a
 * measurement at all (negative length, 4 000 % body fat) and is refused.
 * Outside the *plausible* band it is merely surprising, and the form asks:
 * "That's unusually heavy — is 650 kg right?" with Confirm and Edit.
 *
 * Shared with the import validator in Phase 11, which is why it lives in
 * `domain/` and takes canonical units rather than whatever a form had on
 * screen.
 */

export type CheckStatus = 'ok' | 'question' | 'reject';

export interface Check {
  status: CheckStatus;
  /** Translation key for the question or the refusal. */
  messageKey?: string;
  params?: Record<string, number>;
}

const OK: Check = { status: 'ok' };

export interface Band {
  min: number;
  max: number;
}

export interface Limits {
  /** Outside this, the value is not a measurement. Refused. */
  hard: Band;
  /** Outside this, the value is surprising. Questioned. */
  plausible: Band;
}

/**
 * Limits per unit type, in canonical units (kg, cm, %).
 *
 * The plausible bands come from DATABASE_SPEC section 10. The hard bands are
 * deliberately wide: their job is to catch a typo that produced nonsense, not
 * to have an opinion about an unusual body.
 */
export const LIMITS: Readonly<Record<MeasurementUnitType, Limits>> = Object.freeze({
  mass: { hard: { min: 0, max: 2000 }, plausible: { min: 20, max: 500 } },
  length: { hard: { min: 0, max: 1000 }, plausible: { min: 1, max: 300 } },
  percent: { hard: { min: 0, max: 100 }, plausible: { min: 1, max: 70 } },
  // A count is whatever the user is counting; the app has no view on it.
  count: { hard: { min: 0, max: 1_000_000 }, plausible: { min: 0, max: 1_000_000 } },
});

/**
 * Checks one value, in canonical units.
 *
 * `null` is always fine: every measurement is optional, and "I did not measure
 * that today" is the normal case rather than an error.
 */
export function checkValue(unitType: MeasurementUnitType, value: number | null): Check {
  if (value === null) return OK;

  if (!Number.isFinite(value)) {
    return { status: 'reject', messageKey: 'body.invalid.notANumber' };
  }

  const { hard, plausible } = LIMITS[unitType];
  if (value < hard.min || value > hard.max) {
    return {
      status: 'reject',
      messageKey: 'body.invalid.outOfRange',
      params: { min: hard.min, max: hard.max },
    };
  }

  if (value < plausible.min || value > plausible.max) {
    return { status: 'question', messageKey: 'body.confirm.unusual' };
  }

  return OK;
}

export function checkField(field: MeasurementField, value: number | null): Check {
  return checkValue(unitTypeOf(field), value);
}

/**
 * Whether a measurement date is acceptable.
 *
 * A day of slack into the future, because a phone in one timezone and a user
 * in another legitimately disagree about today. Beyond that it is a typo.
 */
export function checkDay(dayKey: string, todayKey: string): Check {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return { status: 'reject', messageKey: 'body.invalid.date' };
  }
  if (dayKey > nextDay(todayKey)) {
    return { status: 'reject', messageKey: 'body.invalid.future' };
  }
  return OK;
}

/** The day after a key, by calendar rather than by adding milliseconds. */
function nextDay(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return date.toISOString().slice(0, 10);
}

export const MAX_NOTE_LENGTH = 2000;
export const MAX_LABEL_LENGTH = 80;

/** A custom measurement's label: present, trimmed, and not a paragraph. */
export function checkLabel(label: string): Check {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return { status: 'reject', messageKey: 'body.invalid.labelEmpty' };
  }
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return {
      status: 'reject',
      messageKey: 'body.invalid.labelLong',
      params: { max: MAX_LABEL_LENGTH },
    };
  }
  return OK;
}
