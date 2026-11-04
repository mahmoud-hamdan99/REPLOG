import { computed, inject, Service, signal } from '@angular/core';
import { storageError, validationError } from '../../core/errors/app-error';
import { CLOCK } from '../../data/clock';
import { OBJECT_URLS } from '../../data/object-urls';
import { PHOTO_BLOB_STORE } from '../../data/photo-blobs';
import { PHOTO_PROCESSOR } from '../../data/photo-processor';
import { STORAGE_PROBE } from '../../data/platform';
import { isAtQuota } from '../../domain/storage/quota';
import { MEASUREMENTS_REPO, PHOTOS_REPO } from '../../data/tokens';
import { ID_FACTORY } from '../../data/ids';
import { UNIT_OF_WORK } from '../../data/unit-of-work';
import { nearestWeight } from '../../domain/body/compare';
import type { Photo } from '../../domain/models/body';
import type { Pose } from '../../domain/models/enums';
import type { Draft } from '../../domain/models/entity';
import { sortNewestFirst } from '../../domain/photos/gallery';
import { dayKeyAt } from '../../domain/time/day-key';

/** What the import sheet collects. Everything but the file is optional. */
export interface PhotoDraft {
  file: File;
  pose: Pose;
  /** `YYYY-MM-DD`; the sheet prefills it from EXIF and the user may change it. */
  takenAt: string;
  notes: string | null;
}

/**
 * How many thumbnails may hold an object URL at once.
 *
 * Three columns and roughly eight rows fit a phone, so this is the screen plus
 * a screen of buffer in each direction. The cap is what makes "the gallery
 * holds no more URLs than it is showing" true by construction rather than by
 * hoping scroll handlers fire in the right order — every object URL pins its
 * blob in memory until it is revoked, and a 300-photo library pinned at once
 * is the whole quota.
 */
const THUMB_URL_LIMIT = 48;

/** Full-size images are 1600 px; two for a comparison, one spare. */
const FULL_URL_LIMIT = 3;

/**
 * The photo library.
 *
 * Metadata is resident and pixels are not. A photo record is a few hundred
 * bytes, so five hundred of them is a list the gallery can group, filter and
 * sort in memory; the images behind them are a quarter of a megabyte each and
 * are fetched only for what is on screen.
 *
 * This store owns every object URL in the feature, as UI_UX_SPEC section 6.2
 * requires. A component that created its own would have to revoke it on
 * destroy, on input change, on list reorder and on delete, and the first of
 * those it missed would leak a photo's worth of memory with nothing to show
 * for it.
 */
@Service()
export class PhotosStore {
  private readonly repo = inject(PHOTOS_REPO);
  private readonly measurements = inject(MEASUREMENTS_REPO);
  private readonly blobs = inject(PHOTO_BLOB_STORE);
  private readonly uow = inject(UNIT_OF_WORK);
  private readonly urls = inject(OBJECT_URLS);
  private readonly processor = inject(PHOTO_PROCESSOR);
  private readonly storage = inject(STORAGE_PROBE);
  private readonly ids = inject(ID_FACTORY);
  private readonly clock = inject(CLOCK);

  private readonly _photos = signal<Photo[] | null>(null);
  private readonly _error = signal<string | null>(null);

  /** `null` means not loaded; an empty array means loaded and genuinely empty. */
  readonly photos = this._photos.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isLoading = computed(() => this._photos() === null && this._error() === null);

  /**
   * Live object URLs, newest use last — a plain insertion-ordered map doubling
   * as the eviction queue.
   */
  private readonly thumbUrls = new Map<string, string>();
  private readonly fullUrls = new Map<string, string>();
  /** Mirrors the maps for the template, because a Map is not reactive. */
  private readonly urlVersion = signal(0);
  private readonly inFlight = new Set<string>();

  /**
   * The local day, read fresh.
   *
   * A method rather than a computed: the clock is not a signal, so a computed
   * would cache the first reading and keep handing back yesterday to an app
   * left open overnight.
   */
  today(): string {
    return dayKeyAt(this.clock.now(), this.clock.timezoneOffsetMinutes());
  }

  async load(options: { force?: boolean } = {}): Promise<void> {
    if (this._photos() !== null && !options.force) return;
    this._error.set(null);

    try {
      const rows = await this.repo.list({ index: 'by_takenAt', direction: 'prev' });
      this._photos.set(sortNewestFirst(rows));
    } catch (error) {
      this._photos.set(null);
      this._error.set(error instanceof Error ? error.message : 'Photos could not load');
    }
  }

  byId(id: string): Photo | undefined {
    return this._photos()?.find((photo) => photo.id === id);
  }

  // -------------------------------------------------------------- pixels

  /**
   * The thumbnail's URL, or null while it is being fetched.
   *
   * Reading it is what requests it: the grid asks for what it is rendering,
   * which is exactly the set that should be resident. Null is a loading state,
   * not a failure — the tile shows its placeholder until the next tick.
   */
  thumbUrl(photo: Photo): string | null {
    this.urlVersion();
    return this.urlFor(this.thumbUrls, photo.thumbBlobId, THUMB_URL_LIMIT);
  }

  fullUrl(photo: Photo): string | null {
    this.urlVersion();
    return this.urlFor(this.fullUrls, photo.fullBlobId, FULL_URL_LIMIT);
  }

  /** Every URL currently held, for the test that counts them. */
  liveUrlCount(): number {
    return this.thumbUrls.size + this.fullUrls.size;
  }

  /**
   * Revokes everything.
   *
   * Called when the gallery is left. Not in a destructor on the store: this is
   * a root service that outlives the screen, and a photo library still pinned
   * after the user navigated to Settings is the leak this whole design exists
   * to prevent.
   */
  releaseUrls(): void {
    for (const map of [this.thumbUrls, this.fullUrls]) {
      for (const url of map.values()) this.urls.revoke(url);
      map.clear();
    }
    this.urlVersion.update((version) => version + 1);
  }

  private urlFor(map: Map<string, string>, blobId: string, limit: number): string | null {
    const existing = map.get(blobId);
    if (existing !== undefined) {
      // Re-insert so the most recently used is last, and eviction takes the
      // one nobody has looked at longest.
      map.delete(blobId);
      map.set(blobId, existing);
      return existing;
    }

    void this.fetchBlob(map, blobId, limit);
    return null;
  }

  private async fetchBlob(map: Map<string, string>, blobId: string, limit: number): Promise<void> {
    // A grid re-renders many times per scroll; without this every render would
    // start another read of the same blob.
    if (this.inFlight.has(blobId)) return;
    this.inFlight.add(blobId);

    try {
      const blob = await this.blobs.get(blobId);
      // Deleted while the read was in flight, or never written — the tile
      // falls back to its broken-image state rather than an empty box.
      if (blob === undefined) return;

      map.set(blobId, this.urls.create(blob));
      this.evict(map, limit);
      this.urlVersion.update((version) => version + 1);
    } finally {
      this.inFlight.delete(blobId);
    }
  }

  private evict(map: Map<string, string>, limit: number): void {
    while (map.size > limit) {
      const [oldest] = map.keys();
      if (oldest === undefined) return;
      const url = map.get(oldest);
      if (url !== undefined) this.urls.revoke(url);
      map.delete(oldest);
    }
  }

  // ------------------------------------------------------------- mutation

  /**
   * Processes a file and stores it.
   *
   * The processing happens *before* the transaction and the bytes are read
   * before it too, because an IndexedDB transaction commits the moment the
   * microtask queue drains: awaiting a decode inside one would close it and
   * the next write would throw. By the time the transaction opens, everything
   * it needs is in memory.
   */
  async add(draft: PhotoDraft): Promise<Photo> {
    // Checked before the decode, not after: processing a 12 MP image costs
    // seconds and memory, and failing afterwards would spend both to arrive
    // at the same refusal. A browser that will not report its quota does not
    // block anything — see usageFraction.
    if (isAtQuota(await this.storage.estimate())) {
      throw storageError('Photo storage is at quota', {
        messageKey: 'data.storage.full',
        retryable: false,
      });
    }

    const processed = await this.processor.process(draft.file);

    const [fullData, thumbData] = await Promise.all([
      processed.full.arrayBuffer(),
      processed.thumb.arrayBuffer(),
    ]);

    const measurement = nearestWeight(await this.weighedMeasurements(), draft.takenAt);

    const fullBlobId = this.ids.newId();
    const thumbBlobId = this.ids.newId();

    const saved = await this.uow.run(['photos', 'photoBlobs'], 'readwrite', async (tx) => {
      const blobs = tx.blobs();
      await blobs.put(fullBlobId, fullData, processed.mimeType);
      await blobs.put(thumbBlobId, thumbData, processed.thumb.type);

      return tx.repo('photos').put({
        takenAt: draft.takenAt,
        recordedAt: this.clock.nowIso(),
        pose: draft.pose,
        fullBlobId,
        thumbBlobId,
        width: processed.width,
        height: processed.height,
        byteSize: fullData.byteLength,
        mimeType: processed.mimeType,
        // Snapshotted, like every other caption in this app: the weight shown
        // under a photo is what it was when the photo was taken, whatever the
        // measurement is edited to later.
        weightKg: measurement?.weightKg ?? null,
        measurementId: measurement?.id ?? null,
        notes: draft.notes,
        isFavorite: false,
      } satisfies Draft<Photo>);
    });

    this._photos.update((photos) => sortNewestFirst([...(photos ?? []), saved]));
    return saved;
  }

  /**
   * Removes a photo and its pixels.
   *
   * The metadata is tombstoned and both blobs are **hard**-deleted, in one
   * transaction (DATABASE_SPEC section 3.12). That asymmetry is deliberate and
   * the dialog says so: holding a quarter of a megabyte for thirty days
   * against an undo nobody asked for is the opposite of helpful on a device
   * where photos are the quota.
   */
  async remove(id: string): Promise<void> {
    const photo = this.byId(id);
    if (!photo) throw validationError('No such photo', { messageKey: 'state.error.title' });

    await this.uow.run(['photos', 'photoBlobs'], 'readwrite', async (tx) => {
      await tx.repo('photos').remove(id);
      const blobs = tx.blobs();
      await blobs.remove(photo.fullBlobId);
      await blobs.remove(photo.thumbBlobId);
    });

    this.forget(photo);
    this._photos.update((photos) => photos?.filter((candidate) => candidate.id !== id) ?? photos);
  }

  async removeMany(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.remove(id);
  }

  async setFavorite(id: string, isFavorite: boolean): Promise<void> {
    const saved = await this.repo.patch(id, { isFavorite });
    this._photos.update(
      (photos) => photos?.map((photo) => (photo.id === id ? saved : photo)) ?? photos,
    );
  }

  async setNotes(id: string, notes: string | null): Promise<void> {
    const saved = await this.repo.patch(id, { notes });
    this._photos.update(
      (photos) => photos?.map((photo) => (photo.id === id ? saved : photo)) ?? photos,
    );
  }

  /** Bytes held by photo pixels, for the storage meter. */
  totalBytes(): Promise<number> {
    return this.blobs.totalBytes();
  }

  // -------------------------------------------------------------- private

  /** Revokes a deleted photo's URLs, so nothing points at bytes that are gone. */
  private forget(photo: Photo): void {
    for (const [map, blobId] of [
      [this.thumbUrls, photo.thumbBlobId],
      [this.fullUrls, photo.fullBlobId],
    ] as const) {
      const url = map.get(blobId);
      if (url !== undefined) {
        this.urls.revoke(url);
        map.delete(blobId);
      }
    }
    this.urlVersion.update((version) => version + 1);
  }

  /**
   * Entries that recorded a weight, through the index the schema keeps for it.
   *
   * Only weighed entries are fetched: a run of waist-only entries is ordinary
   * and reading them all to discard them would be work for nothing.
   */
  private weighedMeasurements() {
    return this.measurements.list({ index: 'by_hasWeight', equals: 1 });
  }
}
