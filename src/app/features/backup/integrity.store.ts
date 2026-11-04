import { computed, inject, Service, signal } from '@angular/core';
import { APP_META_STORE } from '../../data/app-meta';
import { CLOCK } from '../../data/clock';
import { PHOTO_BLOB_STORE } from '../../data/photo-blobs';
import { STORAGE_PROBE, type StorageEstimate } from '../../data/platform';
import {
  PHOTOS_REPO,
  SET_LOGS_REPO,
  WORKOUTS_REPO,
  WORKOUT_EXERCISES_REPO,
} from '../../data/tokens';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import { runChecks, type Finding } from '../../domain/integrity/checks';
import { isAtQuota, isNearQuota, usageFraction } from '../../domain/storage/quota';
import { EXPECTED_SCHEMA_VERSION } from '../../data/schema-version';

/**
 * Asking the database what is wrong with it, and fixing only what the user
 * says to fix.
 *
 * Every repair here deletes something or rewrites something, which makes the
 * whole screen a destructive action wearing a helpful hat. So: nothing runs
 * automatically, each finding is listed with its count, each repair is opted
 * into separately, and the dialog offers an export first. A "Fix everything"
 * button would be faster and would be the wrong shape.
 */
@Service()
export class IntegrityStore {
  private readonly workouts = inject(WORKOUTS_REPO);
  private readonly workoutExercises = inject(WORKOUT_EXERCISES_REPO);
  private readonly setLogs = inject(SET_LOGS_REPO);
  private readonly photos = inject(PHOTOS_REPO);
  private readonly blobStore = inject(PHOTO_BLOB_STORE);
  private readonly meta = inject(APP_META_STORE);
  private readonly probe = inject(STORAGE_PROBE);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly clock = inject(CLOCK);

  private readonly _findings = signal<Finding[] | null>(null);
  private readonly _storage = signal<StorageEstimate | null>(null);
  private readonly _running = signal(false);

  /** `null` means never run; an empty array means run and clean. */
  readonly findings = this._findings.asReadonly();
  readonly storage = this._storage.asReadonly();
  readonly isRunning = this._running.asReadonly();

  readonly isHealthy = computed(() => this._findings()?.length === 0);

  /**
   * The quota rule, read from the one place that states it.
   *
   * These used to be 0.8 and 0.95 written out here, with the same numbers
   * waiting to be written out again wherever a write is actually blocked. A
   * meter that warns at one number while the block bites at another is how a
   * user gets told "nearly full" by a screen that has already stopped saving.
   */
  readonly usageFraction = computed(() => {
    const storage = this._storage();
    return storage === null ? null : usageFraction(storage);
  });

  readonly isNearQuota = computed(() => {
    const storage = this._storage();
    return storage !== null && isNearQuota(storage);
  });

  readonly isAtQuota = computed(() => {
    const storage = this._storage();
    return storage !== null && isAtQuota(storage);
  });

  async check(): Promise<Finding[]> {
    this._running.set(true);
    try {
      const [workouts, workoutExercises, setLogs, photos, blobIds, schemaVersion] =
        await Promise.all([
          this.workouts.list({ includeDeleted: true }),
          this.workoutExercises.list({ includeDeleted: true }),
          this.setLogs.list({ includeDeleted: true }),
          this.photos.list({ includeDeleted: true }),
          this.blobStore.ids(),
          this.meta.get('schemaVersion'),
        ]);

      // Sizes come from the blob store rather than the metadata, because an
      // orphan blob is by definition one no metadata describes.
      const blobs = await Promise.all(
        blobIds.map(async (id) => ({
          id,
          byteSize: (await this.blobStore.get(id))?.size ?? 0,
        })),
      );

      const findings = runChecks({
        workouts,
        workoutExercises,
        setLogs,
        photos,
        blobs,
        schemaVersion,
        expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
        nowMs: this.clock.now(),
      });

      this._findings.set(findings);
      return findings;
    } finally {
      this._running.set(false);
    }
  }

  async refreshStorage(): Promise<void> {
    this._storage.set(await this.probe.estimate());
  }

  /** Asked once, and the answer displayed honestly rather than assumed. */
  async requestPersistence(): Promise<boolean> {
    const granted = await this.probe.requestPersistence();
    await this.refreshStorage();
    return granted;
  }

  /**
   * Applies one repair.
   *
   * One at a time by design: a single call that fixed everything would make
   * the per-item consent in the UI decorative.
   */
  async repair(finding: Finding, rebuildRecords: () => Promise<number>): Promise<void> {
    switch (finding.kind) {
      case 'orphan-set-logs':
        for (const id of finding.ids) await this.setLogs.remove(id, { hard: true });
        break;

      case 'orphan-workout-exercises':
        for (const id of finding.ids) await this.workoutExercises.remove(id, { hard: true });
        break;

      case 'stale-active-workout':
      case 'multiple-active-workouts':
        // Discarded, not deleted: the session happened, it just never ended,
        // and history should say so rather than pretend it did not exist.
        for (const id of finding.ids) await this.workouts.patch(id, { status: 'discarded' });
        await this.meta.set('activeWorkoutId', null);
        break;

      case 'stale-rollups':
        await this.recomputeRollups(finding.ids);
        break;

      case 'orphan-blobs':
        await this.uow.run(['photoBlobs'], 'readwrite', async (tx) => {
          for (const id of finding.ids) await tx.blobs().remove(id);
        });
        break;

      case 'missing-blobs':
        // The pixels are gone; the record can only render broken.
        for (const id of finding.ids) await this.photos.remove(id);
        break;

      case 'schema-mismatch':
        // Not repairable from here, and offering to would be a lie: the app
        // runs in safe mode until a migration succeeds.
        break;

      default:
        await rebuildRecords();
    }

    await this.check();
  }

  /** Recomputes a session's cached totals from the sets that justify them. */
  private async recomputeRollups(workoutIds: readonly string[]): Promise<void> {
    for (const workoutId of workoutIds) {
      const sets = await this.setLogs.list({ index: 'by_workoutId', equals: workoutId });
      const counted = sets.filter(
        (set) => set.isCompleted && (set.setType === 'working' || set.setType === 'backoff'),
      );

      await this.workouts.patch(workoutId, {
        totalVolumeKg: round2(counted.reduce((total, set) => total + (set.volumeKg ?? 0), 0)),
        totalSets: counted.length,
        totalReps: counted.reduce((total, set) => total + (set.reps ?? 0), 0),
      });
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
