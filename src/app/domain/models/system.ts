import type { RestState } from '../tracker/rest';
import type { Entity } from './entity';
import type { ExperienceLevel, Sex, TrainingGoal } from './enums';

/** The single user record in Version 1. Every field beyond the id is optional. */
export interface Profile extends Entity {
  displayName: string | null;
  birthDate: string | null;
  sex: Sex;
  /** Mirrors the latest measurement for convenience. */
  heightCm: number | null;
  goal: TrainingGoal | null;
  experienceLevel: ExperienceLevel | null;
  avatarBlobId: string | null;
}

export const PROFILE_ID = 'me';

/**
 * Singleton key/value store. Not an `Entity`: these are app-local pointers and
 * counters, not user records, and they take no part in sync.
 */
export interface AppMeta {
  schemaVersion: number;
  appVersion: string;
  /** Generated once; becomes `origin` on every write. */
  deviceId: string;
  /** Pointer to the in-progress session. See ARCHITECTURE section 7.1. */
  activeWorkoutId: string | null;
  activeTab: { tabId: string; heartbeatAt: string } | null;
  /**
   * The running rest timer, as a timestamp and a target rather than a count.
   *
   * Stored so a rest survives an iOS tab purge: a three-minute squat rest is
   * long enough for Safari to evict the page, and coming back to a dead timer
   * is the difference between a tool and a toy. See ARCHITECTURE section 7.3.
   */
  activeRest: RestState | null;
  activePlanId: string | null;
  /** Drives the re-seed reconciliation in DATABASE_SPEC section 6.2. */
  builtInCatalogVersion: number;
  lastExportAt: string | null;
  lastBackupReminderAt: string | null;
  firstRunCompletedAt: string | null;
  storageWarningAcknowledgedAt: string | null;
}

export type AppMetaKey = keyof AppMeta;

export const APP_META_DEFAULTS: Readonly<AppMeta> = Object.freeze({
  schemaVersion: 0,
  appVersion: '0.0.0',
  deviceId: '',
  activeWorkoutId: null,
  activeTab: null,
  activeRest: null,
  activePlanId: null,
  builtInCatalogVersion: 0,
  lastExportAt: null,
  lastBackupReminderAt: null,
  firstRunCompletedAt: null,
  storageWarningAcknowledgedAt: null,
} satisfies AppMeta);

/** How a single appMeta entry is physically stored. */
export interface AppMetaRow {
  key: AppMetaKey;
  value: unknown;
}

/**
 * Declared at schema version 1 and deliberately unused in Version 1.
 *
 * Creating it now means Version 2 sync needs no `onupgradeneeded` against a
 * database already full of user data. A test asserts it stays empty.
 */
export interface OutboxEntry extends Entity {
  store: string;
  recordId: string;
  op: 'put' | 'remove';
  payloadRev: number;
  state: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
}
