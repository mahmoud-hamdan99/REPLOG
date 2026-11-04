import { InjectionToken } from '@angular/core';

/**
 * Getting a file out of the app and back in.
 *
 * An object URL and an `<input type="file">`, not the File System Access API:
 * Safari does not implement it, and Safari is the primary target. The
 * contract is deliberately this small so a test can take a backup without a
 * download folder.
 */
export interface FileIo {
  /** Offers `blob` to the user as a download named `fileName`. */
  download(fileName: string, blob: Blob): void;
  /** Opens a picker and resolves with the text, or null if cancelled. */
  pickText(accept: string): Promise<{ name: string; text: string } | null>;
}

export const FILE_IO = new InjectionToken<FileIo>('FILE_IO');

/**
 * A hash, behind a seam.
 *
 * `crypto.subtle` is async and unavailable outside a secure context, and the
 * integrity value is worth testing against known vectors without one.
 */
export interface Hasher {
  sha256Hex(text: string): Promise<string>;
}

export const HASHER = new InjectionToken<Hasher>('HASHER');

export interface StorageEstimate {
  /** Bytes in use, or null when the browser declines to say. */
  usageBytes: number | null;
  /** Bytes available, or null. */
  quotaBytes: number | null;
  /**
   * Whether the browser promised not to evict this origin.
   *
   * On iOS this is always best-effort, and Settings says so rather than
   * implying a permanence the platform does not offer.
   */
  persisted: boolean;
}

/**
 * What the browser will say about storage.
 *
 * Every field is nullable because every field is optional in practice:
 * `estimate()` is heuristic, `persist()` can be refused, and a meter that
 * invented a number would be worse than one that says it does not know.
 */
export interface StorageProbe {
  estimate(): Promise<StorageEstimate>;
  /** Asks once for persistent storage. Returns what was granted. */
  requestPersistence(): Promise<boolean>;
}

export const STORAGE_PROBE = new InjectionToken<StorageProbe>('STORAGE_PROBE');
