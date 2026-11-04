import { computed, inject, Service, signal } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import { APP_META_STORE } from '../../data/app-meta';
import { CLOCK } from '../../data/clock';
import { PHOTO_BLOB_STORE } from '../../data/photo-blobs';
import { FILE_IO, HASHER } from '../../data/platform';
import { REPOSITORY_TOKENS } from '../../data/tokens';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import { integrityPayload } from '../../domain/backup/canonical';
import { csvFileName, toCsv } from '../../domain/backup/csv';
import {
  FORMAT_NAME,
  FORMAT_VERSION,
  backupFileName,
  projectedBytes,
  type Backup,
  type BackupOptions,
  type BackupPhotoBlob,
} from '../../domain/backup/envelope';
import { chunk, planMerge, type Mergeable } from '../../domain/backup/merge';
import {
  checkReferences,
  validateBackup,
  type Problem,
  type ValidationReport,
} from '../../domain/backup/validate';
import { BACKUP_STORE_NAMES, type EntityStoreName } from '../../domain/models/stores';

/** Progress for the bar, and for the "imported N of M" report on failure. */
export interface Progress {
  done: number;
  total: number;
  /** Already-translated label for what is happening now. */
  label: string;
}

export interface ImportOutcome {
  mode: 'merge' | 'replace';
  added: number;
  updated: number;
  kept: number;
  /** Set when a chunk failed, so the screen can say how far it got. */
  failedAfter?: number;
  problems: Problem[];
}

/**
 * Taking the database out to a file and back in.
 *
 * The whole feature exists because this app promises no cloud, which means a
 * lost phone is a lost training history unless the user has a file. Three
 * things follow from that and shape everything here:
 *
 *   - **The file is readable.** Pretty-printed JSON somebody can open in a
 *     text editor, not a binary blob only this app understands.
 *   - **An import never silently half-happens.** It is chunked, and a failed
 *     chunk stops with a count rather than leaving a database in a state
 *     nobody can describe.
 *   - **Records derived from other records are rebuilt, not trusted.**
 *     Personal records come back from the set logs, so an edited file cannot
 *     inject achievements nobody earned.
 */
@Service()
export class BackupStore {
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly blobs = inject(PHOTO_BLOB_STORE);
  private readonly meta = inject(APP_META_STORE);
  private readonly settings = inject(SettingsStore);
  private readonly files = inject(FILE_IO);
  private readonly hasher = inject(HASHER);
  private readonly clock = inject(CLOCK);

  /**
   * Every backed-up store's repository, resolved once.
   *
   * `inject()` works only in an injection context, so a lookup per call would
   * throw the moment an export ran. Resolving the whole map in a field
   * initialiser also states plainly that this feature touches all of them.
   */
  private readonly repos = new Map(
    BACKUP_STORE_NAMES.map((store) => [store, inject(REPOSITORY_TOKENS[store])] as const),
  );

  private readonly _progress = signal<Progress | null>(null);
  private readonly _report = signal<ValidationReport | null>(null);

  readonly progress = this._progress.asReadonly();
  readonly report = this._report.asReadonly();
  readonly isBusy = computed(() => this._progress() !== null);

  // ------------------------------------------------------------- exporting

  /** Record and photo-byte totals, for the projected size on the sheet. */
  async sizeEstimate(): Promise<{ records: number; photoBytes: number }> {
    const counts = await Promise.all(BACKUP_STORE_NAMES.map((store) => this.repo(store).count()));
    return {
      records: counts.reduce((total, count) => total + count, 0),
      photoBytes: await this.blobs.totalBytes(),
    };
  }

  projectedSize(estimate: { records: number; photoBytes: number }, includePhotos: boolean): number {
    return projectedBytes({
      recordCount: estimate.records,
      photoBytes: estimate.photoBytes,
      includePhotos,
    });
  }

  /**
   * Builds a backup and hands it to the browser as a download.
   *
   * Reads store by store rather than in one transaction: a read of every
   * record in the database inside a single transaction would hold it open for
   * as long as the serialisation takes, and IndexedDB transactions are not
   * built to be held. A backup is a snapshot of "about now", which is what a
   * backup is anyway.
   */
  async exportAll(options: BackupOptions): Promise<void> {
    this._progress.set({ done: 0, total: BACKUP_STORE_NAMES.length + 2, label: 'export' });

    try {
      const data: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};

      for (const [index, store] of BACKUP_STORE_NAMES.entries()) {
        const rows = await this.repo(store).list({ includeDeleted: options.includeDeleted });
        data[store] = rows;
        counts[store] = rows.length;
        this.step(index + 1, 'export');
      }

      const photoBlobs = options.includePhotos ? await this.readBlobs(data['photos'] ?? []) : [];
      this.step(BACKUP_STORE_NAMES.length + 1, 'export');

      const backup: Backup = {
        format: FORMAT_NAME,
        formatVersion: FORMAT_VERSION,
        schemaVersion: await this.meta.get('schemaVersion'),
        appVersion: await this.meta.get('appVersion'),
        exportedAt: this.clock.nowIso(),
        deviceId: await this.meta.get('deviceId'),
        options,
        counts,
        integrity: {
          algorithm: 'sha-256',
          value: await this.hasher.sha256Hex(integrityPayload({ data, photoBlobs })),
        },
        prefs: this.settings.prefs(),
        data,
        photoBlobs,
      };

      const text = JSON.stringify(backup, null, 2);
      this.files.download(
        backupFileName(new Date(this.clock.now())),
        new Blob([text], { type: 'application/json' }),
      );

      // Recording the export must not be able to fail the export. Safe mode
      // blocks every write, and a database too new to open for writing is
      // exactly when getting the data out matters most — so this would have
      // thrown *after* the file reached the user's downloads folder, and the
      // screen would have told them the export failed while they held it. The
      // only cost of losing the timestamp is that the reminder asks sooner.
      try {
        await this.meta.set('lastExportAt', this.clock.nowIso());
      } catch {
        // Deliberately swallowed; see above.
      }
    } finally {
      this._progress.set(null);
    }
  }

  /**
   * One store as a spreadsheet.
   *
   * Export only. CSV has nowhere to put a photo, a nested snapshot or the
   * sync envelope, so this file is for reading and charting elsewhere; the
   * JSON backup remains the only thing that restores. The screen says so
   * rather than offering a CSV import that would quietly lose half of each
   * record.
   */
  async exportStoreCsv(store: EntityStoreName): Promise<number> {
    const rows = (await this.repo(store).list()) as unknown as Record<string, unknown>[];
    this.files.download(
      csvFileName(store, new Date(this.clock.now())),
      // The charset matters: an Arabic note in a file served as plain text/csv
      // is read as the system codepage by Excel and arrives as mojibake.
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
    );
    return rows.length;
  }

  /** Base64 for the file. Read one at a time: a library at once is the heap. */
  private async readBlobs(photos: readonly unknown[]): Promise<BackupPhotoBlob[]> {
    const ids = photos.flatMap((photo) => {
      const row = photo as { fullBlobId?: string; thumbBlobId?: string };
      return [row.fullBlobId, row.thumbBlobId].filter((id): id is string => typeof id === 'string');
    });

    const out: BackupPhotoBlob[] = [];
    for (const id of ids) {
      const blob = await this.blobs.get(id);
      if (blob === undefined) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      out.push({
        id,
        mimeType: blob.type,
        bytes: bytes.byteLength,
        dataBase64: toBase64(bytes),
      });
    }
    return out;
  }

  // ------------------------------------------------------------- importing

  /** Reads a file and produces the report the dry-run screen shows. */
  async inspect(text: string): Promise<ValidationReport> {
    const report = validateBackup(text);

    if (report.backup !== null) {
      report.problems.push(...checkReferences(report.backup.data));

      const expected = report.backup.integrity?.value;
      const actual = await this.hasher.sha256Hex(
        integrityPayload({ data: report.backup.data, photoBlobs: report.backup.photoBlobs ?? [] }),
      );
      if (typeof expected === 'string' && expected !== actual) {
        // A warning, not a refusal: a hand-edited backup is still better than
        // no backup, and the user is told exactly what does not add up.
        report.problems.push({
          kind: 'hash-mismatch',
          blocking: false,
          messageKey: 'import.problem.hashMismatch',
        });
      }
    }

    this._report.set(report);
    return report;
  }

  /**
   * Puts the import sheet back to its resting state.
   *
   * Its own method rather than inspecting an empty string, which is what this
   * used to be: empty text is unparseable, so dismissing a report produced a
   * fresh report complaining about a file the user had not chosen, and left
   * the picker unreachable behind it.
   */
  clearReport(): void {
    this._report.set(null);
  }

  /**
   * Applies a validated backup.
   *
   * Replace wipes first, then restores; merge writes only what the file has a
   * newer copy of. Either way the write is chunked and the personal records
   * are rebuilt at the end rather than taken from the file.
   */
  async apply(
    backup: Backup,
    mode: 'merge' | 'replace',
    rebuild: () => Promise<void>,
  ): Promise<ImportOutcome> {
    const outcome: ImportOutcome = { mode, added: 0, updated: 0, kept: 0, problems: [] };
    const stores = BACKUP_STORE_NAMES.filter((store) => store !== 'personalRecords');
    let completed = 0;

    this._progress.set({ done: 0, total: stores.length + 1, label: 'import' });

    try {
      if (mode === 'replace') {
        // Children first: clearing a parent store while children still point
        // at it would leave a window where the database is inconsistent if the
        // next clear fails.
        for (const store of [...stores].reverse()) await this.repo(store).clear();
      }

      for (const store of stores) {
        const incoming = (backup.data[store] ?? []) as Mergeable[];
        const local =
          mode === 'replace'
            ? []
            : ((await this.repo(store).list({ includeDeleted: true })) as Mergeable[]);

        const plan = planMerge(local, incoming);
        outcome.added += plan.added;
        outcome.updated += plan.updated;
        outcome.kept += plan.kept;

        // restoreMany, not putMany: an import must keep the envelope the
        // file carries. putMany would stamp every row with this device and
        // this instant, which is what makes a restored backup outrank newer
        // local records on the next merge.
        for (const rows of chunk(plan.write)) {
          await this.repo(store).restoreMany(rows as never[]);
        }

        completed++;
        this.step(completed, 'import');
      }

      if (backup.photoBlobs?.length) await this.restoreBlobs(backup.photoBlobs);

      // Derived, so rebuilt: a file claiming a 300 kg bench cannot produce one
      // here, because the records come back from the set logs that justify them.
      await rebuild();
      this.step(stores.length + 1, 'import');

      if (backup.prefs) this.settings.patch(backup.prefs);
    } catch (error) {
      // An accurate "imported N of M" beats a silent partial state: the user
      // knows what to do next only if they know where it stopped.
      outcome.failedAfter = completed;
      outcome.problems.push({
        kind: 'bad-record',
        blocking: true,
        messageKey: 'import.problem.stopped',
        params: { done: completed, total: stores.length },
      });
      if (!(error instanceof Error)) throw error;
    } finally {
      this._progress.set(null);
    }

    return outcome;
  }

  private async restoreBlobs(blobs: readonly BackupPhotoBlob[]): Promise<void> {
    for (const record of blobs) {
      const bytes = fromBase64(record.dataBase64);
      await this.blobs.put(record.id, new Blob([bytes], { type: record.mimeType }));
    }
  }

  /** Wipes everything. The guards live in the screen, not here. */
  async resetAll(): Promise<void> {
    this._progress.set({ done: 0, total: BACKUP_STORE_NAMES.length, label: 'reset' });

    try {
      for (const [index, store] of [...BACKUP_STORE_NAMES].reverse().entries()) {
        await this.repo(store).clear();
        this.step(index + 1, 'reset');
      }
      // The ids are read first, outside any transaction, and the deletion is
      // handed to the blob store's own call. Reading them *inside* a
      // uow.run — which is what this was — awaits a second transaction from
      // within the first, and an IndexedDB transaction auto-closes the moment
      // its microtask queue drains. The outer one was therefore dead before
      // the first remove, so a reset threw for anyone who had a single photo
      // and left every blob on disk. With no photos the loop never ran and
      // nothing noticed.
      await this.blobs.removeMany(await this.blobs.ids());
    } finally {
      this._progress.set(null);
    }
  }

  // --------------------------------------------------------------- private

  private repo(store: EntityStoreName) {
    const repo = this.repos.get(store);
    if (repo === undefined) throw new Error(`No repository for ${store}`);
    return repo;
  }

  private step(done: number, label: string): void {
    this._progress.update((current) => (current === null ? current : { ...current, done, label }));
  }
}

/** Base64 without a data URL round-trip, which would copy the bytes twice. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
