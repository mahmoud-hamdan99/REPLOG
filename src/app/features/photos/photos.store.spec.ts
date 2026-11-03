import { TestBed } from '@angular/core/testing';
import { OBJECT_URLS, type ObjectUrls } from '../../data/object-urls';
import { PHOTO_BLOB_STORE } from '../../data/photo-blobs';
import {
  PHOTO_PROCESSOR,
  type PhotoProcessor,
  type ProcessedPhoto,
} from '../../data/photo-processor';
import { MEASUREMENTS_REPO, PHOTOS_REPO } from '../../data/tokens';
import { flag, type Draft } from '../../domain/models/entity';
import type { Measurement } from '../../domain/models/body';
import {
  FakeClock,
  setupIdb,
  type IdbHarness,
} from '../../infrastructure/idb/testing/idb-test-kit';
import { PhotosStore } from './photos.store';

/**
 * The photo library against real transactions.
 *
 * Two things are being pinned here that nothing else can pin. Pixels and the
 * metadata that names them must land together or not at all — a half-written
 * import is either a broken thumbnail or a quarter-megabyte leak. And the
 * gallery must not hold an object URL for every photo it has ever shown,
 * because each one keeps its blob resident until revoked.
 */

/** Counts what it hands out, which is the only way to assert the lifecycle. */
class CountingUrls implements ObjectUrls {
  created = 0;
  revoked = 0;
  readonly live = new Set<string>();

  create(): string {
    const url = `blob:fake/${++this.created}`;
    this.live.add(url);
    return url;
  }

  revoke(url: string): void {
    this.revoked++;
    this.live.delete(url);
  }
}

class FakeProcessor implements PhotoProcessor {
  takenOn: string | null = null;
  calls = 0;

  async process(file: File): Promise<ProcessedPhoto> {
    this.calls++;
    if (file.type === 'video/mp4') throw new Error('not an image');
    return {
      full: new Blob([new Uint8Array(1200)], { type: 'image/webp' }),
      thumb: new Blob([new Uint8Array(90)], { type: 'image/webp' }),
      width: 1600,
      height: 1200,
      takenOn: this.takenOn,
      mimeType: 'image/webp',
    };
  }
}

function picked(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(32)], name, { type });
}

describe('PhotosStore', () => {
  let h: IdbHarness;
  let store: PhotosStore;
  let urls: CountingUrls;
  let processor: FakeProcessor;

  beforeEach(async () => {
    urls = new CountingUrls();
    processor = new FakeProcessor();
    h = await setupIdb({
      providers: [
        { provide: OBJECT_URLS, useValue: urls },
        { provide: PHOTO_PROCESSOR, useValue: processor },
      ],
    });
    store = TestBed.inject(PhotosStore);
    await store.load();
  });

  afterEach(async () => {
    await h.dispose();
  });

  const add = (over: Partial<Parameters<PhotosStore['add']>[0]> = {}) =>
    store.add({ file: picked(), pose: 'front', takenAt: '2026-03-02', notes: null, ...over });

  /** A weighed measurement on a given day, for the snapshot tests. */
  async function seedWeight(measuredAt: string, weightKg: number) {
    await TestBed.inject(MEASUREMENTS_REPO).put({
      measuredAt,
      recordedAt: `${measuredAt}T07:00:00.000Z`,
      weightKg,
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
  }

  // ------------------------------------------------------------------ import

  it('writes both blobs and the metadata that names them', async () => {
    const photo = await add();

    const blobs = TestBed.inject(PHOTO_BLOB_STORE);
    await expect(blobs.get(photo.fullBlobId)).resolves.toBeTruthy();
    await expect(blobs.get(photo.thumbBlobId)).resolves.toBeTruthy();
    expect(photo).toMatchObject({ width: 1600, height: 1200, mimeType: 'image/webp' });
    // The full blob's size, which is what the storage meter sums.
    expect(photo.byteSize).toBe(1200);
  });

  it('leaves nothing behind when the metadata write fails', async () => {
    // Blobs and metadata share one transaction, so a failure halfway must
    // take the pixels with it rather than orphaning a quarter of a megabyte
    // that the meter counts and nothing can reclaim. A note that is not
    // structured-cloneable makes IndexedDB refuse the metadata write *after*
    // both blobs have gone in — the exact shape of a mid-transaction failure.
    const notCloneable = (() => undefined) as unknown as string;

    await expect(add({ notes: notCloneable })).rejects.toThrow();

    expect(await TestBed.inject(PHOTO_BLOB_STORE).totalBytes()).toBe(0);
    expect(store.photos()).toEqual([]);
  });

  it('does not write anything when the file cannot be processed', async () => {
    await expect(add({ file: picked('clip.mp4', 'video/mp4') })).rejects.toThrow();

    expect(store.photos()).toEqual([]);
    expect(await TestBed.inject(PHOTO_BLOB_STORE).totalBytes()).toBe(0);
  });

  it('snapshots the weight nearest the day the photo was taken', async () => {
    // Not the latest weight: a photo backdated to March belongs beside
    // March's number, whatever the scale says the day it was imported.
    await seedWeight('2026-03-01', 82.5);
    await seedWeight('2026-06-20', 78);

    const photo = await add({ takenAt: '2026-03-02' });

    expect(photo.weightKg).toBe(82.5);
    expect(photo.measurementId).not.toBeNull();
  });

  it('has no weight when nothing was ever recorded', async () => {
    const photo = await add();

    // Null, not a guess. A caption is a claim about the day in the picture.
    expect(photo.weightKg).toBeNull();
    expect(photo.measurementId).toBeNull();
  });

  it('keeps the library newest first as photos arrive out of order', async () => {
    await add({ takenAt: '2026-03-02' });
    await add({ takenAt: '2026-06-20' });
    await add({ takenAt: '2026-01-04' });

    expect(store.photos()?.map((photo) => photo.takenAt)).toEqual([
      '2026-06-20',
      '2026-03-02',
      '2026-01-04',
    ]);
  });

  it('survives a reload with its metadata intact', async () => {
    const photo = await add();

    const reloaded = TestBed.inject(PhotosStore);
    await reloaded.load({ force: true });

    expect(reloaded.byId(photo.id)?.fullBlobId).toBe(photo.fullBlobId);
  });

  // ------------------------------------------------------------------ pixels

  it('hands out a thumbnail URL once the blob has been read', async () => {
    const photo = await add();

    // The first read is a miss by design: asking for it is what starts the
    // fetch, so the tile renders its placeholder for one tick.
    expect(store.thumbUrl(photo)).toBeNull();
    await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());

    expect(urls.created).toBe(1);
  });

  it('reads a blob once however many times the grid re-renders', async () => {
    const photo = await add();

    for (let render = 0; render < 20; render++) store.thumbUrl(photo);
    await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());
    for (let render = 0; render < 20; render++) store.thumbUrl(photo);

    // A grid re-renders many times per scroll. One URL, not forty.
    expect(urls.created).toBe(1);
  });

  it('holds no more thumbnail URLs than a screen and its buffer', async () => {
    const photos = [];
    for (let index = 0; index < 60; index++) {
      photos.push(await add({ takenAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}` }));
    }

    for (const photo of photos) {
      store.thumbUrl(photo);
      await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());
    }

    // Every object URL pins its blob until revoked. Sixty at once is the whole
    // library resident; the cap is what makes that impossible rather than
    // unlikely.
    expect(urls.live.size).toBeLessThanOrEqual(48);
    expect(urls.created - urls.revoked).toBe(urls.live.size);
  });

  it('evicts the thumbnail nobody has looked at longest', async () => {
    const photos = [];
    for (let index = 0; index < 49; index++) {
      photos.push(await add({ takenAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}` }));
    }

    const first = photos[0] as (typeof photos)[number];
    for (const photo of photos.slice(0, 48)) {
      store.thumbUrl(photo);
      await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());
    }
    // Touch the first again, so it is the most recently used rather than the
    // oldest, then push one more in.
    store.thumbUrl(first);
    const last = photos[48] as (typeof photos)[number];
    store.thumbUrl(last);
    await vi.waitFor(() => expect(store.thumbUrl(last)).not.toBeNull());

    expect(store.thumbUrl(first)).not.toBeNull();
  });

  it('revokes everything when the gallery is left', async () => {
    const photo = await add();
    store.thumbUrl(photo);
    await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());

    store.releaseUrls();

    // A root service outlives the screen; a library still pinned after the
    // user navigated away is the leak this design exists to prevent.
    expect(urls.live.size).toBe(0);
    expect(store.liveUrlCount()).toBe(0);
  });

  it('keeps full-size URLs to a handful', async () => {
    const photos = [];
    for (let index = 0; index < 6; index++) {
      photos.push(await add({ takenAt: `2026-03-0${index + 1}` }));
    }

    for (const photo of photos) {
      store.fullUrl(photo);
      await vi.waitFor(() => expect(store.fullUrl(photo)).not.toBeNull());
    }

    // 1600 px images: two for a comparison and one spare is the whole need.
    expect(urls.live.size).toBeLessThanOrEqual(3);
  });

  // ------------------------------------------------------------------ delete

  it('tombstones the metadata and hard-deletes both blobs', async () => {
    const photo = await add();

    await store.remove(photo.id);

    const blobs = TestBed.inject(PHOTO_BLOB_STORE);
    // The asymmetry the dialog warns about: the record can be recovered, the
    // pixels cannot. Holding 300 kB for thirty days against an undo nobody
    // asked for is the opposite of helpful where photos are the quota.
    await expect(blobs.get(photo.fullBlobId)).resolves.toBeUndefined();
    await expect(blobs.get(photo.thumbBlobId)).resolves.toBeUndefined();
    expect(await blobs.totalBytes()).toBe(0);

    const tombstoned = await TestBed.inject(PHOTOS_REPO).get(photo.id, { includeDeleted: true });
    expect(tombstoned?.deletedAt).not.toBeNull();
    expect(store.photos()).toEqual([]);
  });

  it('revokes a deleted photo URL rather than pointing at bytes that are gone', async () => {
    const photo = await add();
    store.thumbUrl(photo);
    await vi.waitFor(() => expect(store.thumbUrl(photo)).not.toBeNull());

    await store.remove(photo.id);

    expect(urls.live.size).toBe(0);
  });

  it('reclaims every blob when several photos are deleted', async () => {
    const first = await add({ takenAt: '2026-03-01' });
    const second = await add({ takenAt: '2026-03-02' });

    await store.removeMany([first.id, second.id]);

    expect(await TestBed.inject(PHOTO_BLOB_STORE).totalBytes()).toBe(0);
    expect(store.photos()).toEqual([]);
  });

  it('refuses to delete a photo it does not have', async () => {
    await expect(store.remove('nope')).rejects.toThrow();
  });

  // ------------------------------------------------------------------- edits

  it('marks a favourite without touching the pixels', async () => {
    const photo = await add();
    const before = await TestBed.inject(PHOTO_BLOB_STORE).totalBytes();

    await store.setFavorite(photo.id, true);

    expect(store.byId(photo.id)?.isFavorite).toBe(true);
    expect(await TestBed.inject(PHOTO_BLOB_STORE).totalBytes()).toBe(before);
  });

  it('edits a note', async () => {
    const photo = await add();

    await store.setNotes(photo.id, 'Week 6, morning');

    expect(store.byId(photo.id)?.notes).toBe('Week 6, morning');
  });

  it('reports the bytes photos are holding', async () => {
    await add();
    await add({ takenAt: '2026-03-03' });

    // Full plus thumb, twice: what the storage meter shows.
    expect(await store.totalBytes()).toBe((1200 + 90) * 2);
  });

  it('uses the clock for the day a new import defaults to', () => {
    expect(store.today()).toBe('2026-03-02');
    (h.clock as FakeClock).set(Date.UTC(2026, 5, 20, 9, 0, 0));
    expect(store.today()).toBe('2026-06-20');
  });
});
