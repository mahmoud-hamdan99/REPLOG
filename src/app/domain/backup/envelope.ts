import type { Prefs } from '../models/prefs';

/**
 * The backup file format (DATABASE_SPEC section 9.1).
 *
 * A plain, pretty-printed JSON document rather than anything clever. Someone
 * who loses this app still has their training history in a file they can open,
 * read and grep — which is the entire point of a local-first app that promises
 * no cloud. Compressibility beats byte count here: these files are inspected.
 */

/** Bumped when the *file* shape changes, independently of the database. */
export const FORMAT_VERSION = 1;
export const FORMAT_NAME = 'replog-backup';

export interface BackupOptions {
  includePhotos: boolean;
  /** Tombstoned records. Off by default; a backup is of what you have. */
  includeDeleted: boolean;
}

export interface BackupIntegrity {
  algorithm: 'sha-256';
  /** Hex digest of the canonicalised `data` + `photoBlobs` block. */
  value: string;
}

export interface BackupPhotoBlob {
  id: string;
  mimeType: string;
  bytes: number;
  dataBase64: string;
}

export interface Backup {
  format: typeof FORMAT_NAME;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  deviceId: string;
  options: BackupOptions;
  counts: Record<string, number>;
  integrity: BackupIntegrity;
  prefs: Prefs;
  data: Record<string, unknown[]>;
  photoBlobs: BackupPhotoBlob[];
}

/**
 * The file name a backup is offered under.
 *
 * Sortable by name, because that is how a folder of them is read. Minutes
 * rather than seconds: two exports in the same minute is a double-tap, and the
 * browser will disambiguate the second download itself.
 */
export function backupFileName(exportedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}` +
    `-${pad(exportedAt.getHours())}${pad(exportedAt.getMinutes())}`;
  return `replog-backup-${stamp}.json`;
}

/**
 * Projected file size, so the export sheet can state it before writing.
 *
 * Base64 inflates bytes by a third plus padding, and a photo-heavy library
 * reaches tens of megabytes — a number worth seeing *before* a phone spends a
 * minute building it. Records are estimated from the sizes in
 * DATABASE_SPEC section 11; it is an estimate and the UI says so.
 */
export function projectedBytes(input: {
  recordCount: number;
  photoBytes: number;
  includePhotos: boolean;
}): number {
  const records = input.recordCount * 420;
  const photos = input.includePhotos ? Math.ceil(input.photoBytes * 1.37) : 0;
  return records + photos;
}
