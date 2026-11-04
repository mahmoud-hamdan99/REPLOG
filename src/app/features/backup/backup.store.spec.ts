import { TestBed } from '@angular/core/testing';
import { APP_META_STORE } from '../../data/app-meta';
import { PHOTO_BLOB_STORE } from '../../data/photo-blobs';
import { FILE_IO, HASHER, type FileIo, type Hasher } from '../../data/platform';
import { MEASUREMENTS_REPO, PHOTOS_REPO, SET_LOGS_REPO, WORKOUTS_REPO } from '../../data/tokens';
import type { Backup } from '../../domain/backup/envelope';
import { flag, type Draft } from '../../domain/models/entity';
import type { Measurement } from '../../domain/models/body';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { BackupStore } from './backup.store';

/**
 * The promise this whole feature exists to keep.
 *
 * The app stores everything on one device and offers no cloud, so a file is
 * the only thing standing between a lost phone and a lost training history.
 * The test that matters is therefore not "does export produce a file" but
 * **export, destroy everything, import, and check it is all still there** —
 * which is the thing a user will do exactly once, in the worst week of their
 * training year, with no second chance.
 */

/** Captures the download instead of offering it, and can hand it back. */
class CapturingFileIo implements FileIo {
  lastName = '';
  lastText = '';

  download(fileName: string, blob: Blob): void {
    this.lastName = fileName;
    // Captured synchronously as text: a Blob in this environment cannot be
    // read back by the usual means, and the content is what a test wants.
    void blob.text().then((text) => {
      this.lastText = text;
    });
  }

  async pickText(): Promise<{ name: string; text: string } | null> {
    return { name: this.lastName, text: this.lastText };
  }
}

/** A real digest would need a secure context; this only has to be stable. */
class StableHasher implements Hasher {
  async sha256Hex(text: string): Promise<string> {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}

describe('BackupStore', () => {
  let h: IdbHarness;
  let store: BackupStore;
  let files: CapturingFileIo;

  beforeEach(async () => {
    files = new CapturingFileIo();
    h = await setupIdb({
      providers: [
        { provide: FILE_IO, useValue: files },
        { provide: HASHER, useClass: StableHasher },
      ],
    });
    store = TestBed.inject(BackupStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  /** A small but real history: a session, its sets, and a weigh-in. */
  async function seed() {
    const workout = await TestBed.inject(WORKOUTS_REPO).put({
      name: 'Push A',
      status: 'completed',
      startedAt: '2026-11-01T17:00:00.000Z',
      endedAt: '2026-11-01T18:00:00.000Z',
      dayKey: '2026-11-01',
      planId: null,
      routineId: null,
      planSnapshot: null,
      bodyWeightKg: 80,
      totalVolumeKg: 1000,
      totalSets: 2,
      totalReps: 10,
      durationSec: 3600,
      notes: null,
      source: 'manual',
    } as never);

    for (const index of [0, 1]) {
      await TestBed.inject(SET_LOGS_REPO).put({
        workoutId: workout.id,
        workoutExerciseId: 'we-1',
        exerciseId: 'barbell-bench-press',
        variantKey: 'barbell-bench-press|barbell|bilateral',
        dayKey: '2026-11-01',
        setIndex: index,
        setType: 'working',
        side: 'both',
        weightKg: 100,
        extraWeightKg: null,
        reps: 5,
        durationSec: null,
        distanceM: null,
        rpe: null,
        rir: null,
        isCompleted: true,
        isPr: false,
        completedAt: '2026-11-01T17:30:00.000Z',
        restTakenSec: null,
        e1rmKg: 116.7,
        volumeKg: 500,
        notes: null,
      } as never);
    }

    await TestBed.inject(MEASUREMENTS_REPO).put({
      measuredAt: '2026-11-01',
      recordedAt: '2026-11-01T07:00:00.000Z',
      weightKg: 80.4,
      hasWeight: flag(true),
      heightCm: null,
      neckCm: null,
      shouldersCm: null,
      chestCm: null,
      waistCm: 86.4,
      hipsCm: null,
      bicepsLeftCm: null,
      bicepsRightCm: null,
      forearmLeftCm: null,
      forearmRightCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfLeftCm: null,
      calfRightCm: null,
      bodyFatPct: null,
      custom: {},
      notes: null,
      source: 'manual',
    } satisfies Draft<Measurement>);

    return workout;
  }

  /** One measurement as it would appear inside a backup file. */
  function measurementRow(id: string) {
    return {
      id,
      createdAt: '2026-01-04T06:00:00.000Z',
      updatedAt: '2026-01-04T06:00:00.000Z',
      deletedAt: null,
      rev: 1,
      origin: 'an-older-phone',
      measuredAt: '2026-01-04',
      recordedAt: '2026-01-04T06:00:00.000Z',
      weightKg: 70,
      hasWeight: flag(true),
      bodyFatPct: null,
      heightCm: null,
      neckCm: null,
      shouldersCm: null,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      bicepsLeftCm: null,
      bicepsRightCm: null,
      forearmLeftCm: null,
      forearmRightCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfLeftCm: null,
      calfRightCm: null,
      custom: {},
      notes: null,
      source: 'manual',
    };
  }

  /** A minimal well-formed file around a list of measurements. */
  function backupOf(measurements: readonly Record<string, unknown>[]): Backup {
    return {
      format: 'replog-backup',
      formatVersion: 1,
      schemaVersion: 1,
      appVersion: '0.0.0',
      exportedAt: '2026-01-04T06:05:00.000Z',
      deviceId: 'an-older-phone',
      options: { includePhotos: false, includeDeleted: false },
      counts: { measurements: measurements.length },
      integrity: { algorithm: 'sha-256', value: '00000000' },
      prefs: { language: 'en', numerals: 'latn', theme: 'dark' },
      data: { measurements: [...measurements] },
      photoBlobs: [],
    } as unknown as Backup;
  }

  const snapshot = async () => ({
    workouts: await TestBed.inject(WORKOUTS_REPO).list({ includeDeleted: true }),
    setLogs: await TestBed.inject(SET_LOGS_REPO).list({ includeDeleted: true }),
    measurements: await TestBed.inject(MEASUREMENTS_REPO).list({ includeDeleted: true }),
  });

  const exported = async () => {
    await store.exportAll({ includePhotos: false, includeDeleted: true });
    await vi.waitFor(() => expect(files.lastText).not.toBe(''));
    return JSON.parse(files.lastText) as Backup;
  };

  // ------------------------------------------------------------- the round trip

  it('reproduces the database exactly after export, reset and import', async () => {
    await seed();
    const before = await snapshot();
    const backup = await exported();

    await store.resetAll();
    expect((await snapshot()).workouts).toEqual([]);

    // A restore happens on a different day than the export — that is the whole
    // situation. With the clock held still this test passed while the import
    // was rewriting createdAt, updatedAt and origin on every record, because
    // "now" during the import happened to equal "now" during the seed.
    h.clock.advance(3 * 24 * 60 * 60 * 1000);

    await store.apply(backup, 'replace', async () => undefined);

    // Every field, not just the counts: an import that restored the right
    // number of rows with the wrong contents would pass a count check and
    // lose the history anyway.
    expect(await snapshot()).toEqual(before);
  }, 30_000);

  it('brings the photo pixels back, byte for byte', async () => {
    // The only part of a backup that is not JSON. Photos travel as base64,
    // which is where a round trip quietly loses bytes: a wrong slice, a
    // mangled padding character or a charset assumption all survive the
    // counts and produce an image that no longer decodes.
    const blobs = TestBed.inject(PHOTO_BLOB_STORE);
    const pixels = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x7f, 0x80, 0x01]);
    await blobs.put('blob-full', new Blob([pixels], { type: 'image/webp' }));
    await blobs.put('blob-thumb', new Blob([pixels.slice(0, 4)], { type: 'image/webp' }));

    await TestBed.inject(PHOTOS_REPO).put({
      takenAt: '2026-11-01',
      recordedAt: '2026-11-01T07:05:00.000Z',
      pose: 'front',
      fullBlobId: 'blob-full',
      thumbBlobId: 'blob-thumb',
      width: 3,
      height: 3,
      byteSize: pixels.byteLength,
      mimeType: 'image/webp',
      weightKg: null,
      measurementId: null,
      isFavorite: flag(false),
      notes: null,
    } as never);

    await store.exportAll({ includePhotos: true, includeDeleted: false });
    await vi.waitFor(() => expect(files.lastText).not.toBe(''));
    const backup = JSON.parse(files.lastText) as Backup;

    await store.resetAll();
    expect(await blobs.ids()).toEqual([]);

    h.clock.advance(3 * 24 * 60 * 60 * 1000);
    await store.apply(backup, 'replace', async () => undefined);

    const restored = await blobs.get('blob-full');
    expect(restored).toBeDefined();
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(pixels);
    expect((await TestBed.inject(PHOTOS_REPO).list())[0]).toMatchObject({
      fullBlobId: 'blob-full',
      thumbBlobId: 'blob-thumb',
    });
  }, 30_000);

  it('writes a file that says what it contains', async () => {
    await seed();
    const backup = await exported();

    expect(backup.format).toBe('replog-backup');
    expect(backup.counts['workouts']).toBe(1);
    expect(backup.counts['setLogs']).toBe(2);
    expect(files.lastName).toMatch(/^replog-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  });

  it('still produces a file when the database refuses writes', async () => {
    // Safe mode — a database at a version this build does not know — blocks
    // every write, and is exactly the state in which getting the data out
    // matters most. Recording the export is a write; it must not be able to
    // fail the export. Before this, the file reached the user's downloads
    // folder and the screen then told them it had failed.
    await seed();
    const meta = TestBed.inject(APP_META_STORE);
    vi.spyOn(meta, 'set').mockRejectedValue(new Error('REPLOG is in safe mode'));

    await expect(
      store.exportAll({ includePhotos: false, includeDeleted: false }),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => expect(files.lastText).not.toBe(''));
    expect((JSON.parse(files.lastText) as Backup).format).toBe('replog-backup');
  });

  it('carries a hash of its own contents', async () => {
    await seed();
    const backup = await exported();

    const report = await store.inspect(JSON.stringify(backup));
    expect(report.problems.map((problem) => problem.kind)).not.toContain('hash-mismatch');
  });

  it('warns about an edited file without refusing it', async () => {
    // A hand-edited backup is still better than no backup, so this is a
    // warning with a preview rather than a wall.
    await seed();
    const backup = await exported();
    (backup.data['workouts']?.[0] as { name: string }).name = 'Edited by hand';

    const report = await store.inspect(JSON.stringify(backup));

    expect(report.importable).toBe(true);
    expect(report.problems.map((problem) => problem.kind)).toContain('hash-mismatch');
  });

  // -------------------------------------------------------------------- merge

  it('merges without deleting records the file does not mention', async () => {
    await seed();
    const backup = await exported();

    const extra = await TestBed.inject(MEASUREMENTS_REPO).put({
      measuredAt: '2026-11-03',
      recordedAt: '2026-11-03T07:00:00.000Z',
      weightKg: 79.8,
      hasWeight: flag(true),
      heightCm: null,
      neckCm: null,
      shouldersCm: null,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      bicepsLeftCm: null,
      bicepsRightCm: null,
      forearmLeftCm: null,
      forearmRightCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfLeftCm: null,
      calfRightCm: null,
      bodyFatPct: null,
      custom: {},
      notes: null,
      source: 'manual',
    } satisfies Draft<Measurement>);

    await store.apply(backup, 'merge', async () => undefined);

    // Importing an old backup must not destroy everything logged since.
    const after = await TestBed.inject(MEASUREMENTS_REPO).get(extra.id);
    expect(after).toBeDefined();
  });

  it('leaves everything alone when its own backup is re-imported', async () => {
    await seed();
    const backup = await exported();
    const before = await snapshot();

    const outcome = await store.apply(backup, 'merge', async () => undefined);

    expect(outcome.added).toBe(0);
    expect(outcome.updated).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('takes the newer copy when the file has one', async () => {
    const workout = await seed();
    const backup = await exported();

    const row = backup.data['workouts']?.[0] as Record<string, unknown>;
    row['name'] = 'Renamed in the file';
    row['updatedAt'] = '2099-01-01T00:00:00.000Z';

    await store.apply(backup, 'merge', async () => undefined);

    const after = await TestBed.inject(WORKOUTS_REPO).get(workout.id);
    expect(after?.name).toBe('Renamed in the file');
  });

  // ------------------------------------------------------------------ records

  it('rebuilds personal records rather than trusting the file', async () => {
    // An edited backup must not be able to inject achievements nobody earned.
    await seed();
    const backup = await exported();
    backup.data['personalRecords'] = [
      { id: 'fake', updatedAt: '2099-01-01T00:00:00.000Z', value: 500 } as never,
    ];

    let rebuilt = false;
    await store.apply(backup, 'replace', async () => {
      rebuilt = true;
    });

    expect(rebuilt).toBe(true);
  });

  // ------------------------------------------------------------------- reset

  it('leaves nothing behind after a reset', async () => {
    await seed();

    await store.resetAll();

    const after = await snapshot();
    expect(after.workouts).toEqual([]);
    expect(after.setLogs).toEqual([]);
    expect(after.measurements).toEqual([]);
    expect(await TestBed.inject(PHOTO_BLOB_STORE).totalBytes()).toBe(0);
  });

  it('keeps the envelope a backup carries instead of restamping it', async () => {
    const backup = backupOf([
      {
        ...measurementRow('from-another-phone'),
        createdAt: '2026-01-04T06:00:00.000Z',
        updatedAt: '2026-01-04T06:00:00.000Z',
        rev: 7,
        origin: 'an-older-phone',
      },
    ]);

    await store.apply(backup, 'merge', async () => undefined);

    const [restored] = await TestBed.inject(MEASUREMENTS_REPO).list({ includeDeleted: true });
    expect(restored).toMatchObject({
      id: 'from-another-phone',
      createdAt: '2026-01-04T06:00:00.000Z',
      updatedAt: '2026-01-04T06:00:00.000Z',
      rev: 7,
      origin: 'an-older-phone',
    });
  });

  it('does not let an old backup overwrite a record edited since', async () => {
    // The consequence of restamping, and the reason it matters: if an import
    // dates every record to the moment it ran, every record in an old backup
    // outranks the local copy, and restoring last winter's file silently
    // throws away everything logged since.
    const old = backupOf([
      { ...measurementRow('shared-id'), updatedAt: '2026-01-04T06:00:00.000Z', weightKg: 70 },
    ]);
    await store.apply(old, 'merge', async () => undefined);

    h.clock.advance(60_000);
    await TestBed.inject(MEASUREMENTS_REPO).patch('shared-id', { weightKg: 82 });

    const outcome = await store.apply(old, 'merge', async () => undefined);

    expect(outcome.kept).toBe(1);
    expect(outcome.updated).toBe(0);
    expect((await TestBed.inject(MEASUREMENTS_REPO).get('shared-id'))?.weightKg).toBe(82);
  });

  it('dismissing a report leaves no report rather than a complaint', async () => {
    // clearReport used to inspect an empty string, which is unparseable, so
    // dismissing a bad file produced a fresh error about a file the user had
    // never chosen — and hid the picker behind it.
    await store.inspect('{"not":"a backup"}');
    expect(store.report()).not.toBeNull();

    store.clearReport();

    expect(store.report()).toBeNull();
  });

  it('reports a size estimate the export sheet can show', async () => {
    await seed();

    const estimate = await store.sizeEstimate();

    expect(estimate.records).toBeGreaterThan(0);
    expect(store.projectedSize(estimate, true)).toBeGreaterThanOrEqual(
      store.projectedSize(estimate, false),
    );
  });
});
