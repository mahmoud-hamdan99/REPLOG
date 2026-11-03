import type { Photo } from '../models/body';
import { isSideways, readExif } from './exif';
import {
  defaultPair,
  filterByPose,
  groupByMonth,
  intervalBetween,
  sortNewestFirst,
} from './gallery';
import {
  ACCEPTED_TYPES,
  FULL_EDGE,
  MAX_SOURCE_BYTES,
  THUMB_EDGE,
  checkSource,
  fitWithin,
} from './sizing';

/**
 * The parts of the photo feature that can be proved without a canvas.
 *
 * The EXIF fixtures are assembled byte by byte rather than loaded from a
 * sample file. A checked-in JPEG would be opaque — nobody reading the test
 * could say what makes it a GPS-bearing file — and the point of these tests is
 * that "the stored image has no location in it" is something the app can
 * actually read back, not something it asserts about itself.
 */

// --------------------------------------------------------------- fixtures

interface TagSpec {
  tag: number;
  /** 2 = ASCII, 3 = SHORT, 4 = LONG. */
  type: number;
  value: number | string;
}

/**
 * A TIFF block: header, IFD0, and an optional Exif sub-IFD after it.
 *
 * Little-endian, because that is what phones write.
 */
function tiffBlock(ifd0: TagSpec[], exifIfd: TagSpec[] = []): Uint8Array {
  const header = 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const exifStart = header + ifd0Size;
  const exifSize = exifIfd.length === 0 ? 0 : 2 + exifIfd.length * 12 + 4;

  // ASCII values longer than four bytes live past both directories.
  const heapStart = exifStart + exifSize;
  const heap: number[] = [];

  const bytes = new Uint8Array(heapStart + asciiBytes(ifd0) + asciiBytes(exifIfd));
  const view = new DataView(bytes.buffer);

  // "II", 42, offset of IFD0.
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, header, true);

  const writeIfd = (at: number, entries: TagSpec[], next: number) => {
    view.setUint16(at, entries.length, true);
    entries.forEach((entry, index) => {
      const offset = at + 2 + index * 12;
      view.setUint16(offset, entry.tag, true);
      view.setUint16(offset + 2, entry.type, true);

      if (entry.type === 2) {
        const text = `${String(entry.value)}\0`;
        view.setUint32(offset + 4, text.length, true);
        if (text.length <= 4) {
          for (let i = 0; i < text.length; i++) view.setUint8(offset + 8 + i, text.charCodeAt(i));
        } else {
          view.setUint32(offset + 8, heapStart + heap.length, true);
          for (const character of text) heap.push(character.charCodeAt(0));
        }
      } else {
        view.setUint32(offset + 4, 1, true);
        if (entry.type === 3) view.setUint16(offset + 8, Number(entry.value), true);
        else view.setUint32(offset + 8, Number(entry.value), true);
      }
    });
    view.setUint32(at + 2 + entries.length * 12, next, true);
  };

  writeIfd(header, ifd0, 0);
  if (exifIfd.length > 0) writeIfd(exifStart, exifIfd, 0);
  heap.forEach((byte, index) => view.setUint8(heapStart + index, byte));

  return bytes;
}

function asciiBytes(entries: TagSpec[]): number {
  return entries
    .filter((entry) => entry.type === 2 && String(entry.value).length + 1 > 4)
    .reduce((total, entry) => total + String(entry.value).length + 1, 0);
}

/** A JPEG whose only segment is the APP1 Exif block. */
function jpegWith(tiff: Uint8Array): ArrayBuffer {
  const payload = 6 + tiff.length;
  const bytes = new Uint8Array(4 + payload + 2);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0xffd8); // SOI
  view.setUint16(2, 0xffe1); // APP1
  view.setUint16(4, payload + 2);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6); // "Exif\0\0"
  bytes.set(tiff, 12);
  view.setUint16(bytes.length - 2, 0xffd9); // EOI

  return bytes.buffer;
}

/** A WebP whose RIFF container carries an EXIF chunk — what a re-encode drops. */
function webpWith(tiff: Uint8Array | null): ArrayBuffer {
  const chunk = tiff === null ? 0 : 8 + tiff.length + (tiff.length % 2);
  const bytes = new Uint8Array(12 + 8 + chunk);
  const view = new DataView(bytes.buffer);
  const ascii = (text: string, at: number) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii('RIFF', 0);
  view.setUint32(4, bytes.length - 8, true);
  ascii('WEBP', 8);
  ascii('VP8 ', 12);
  view.setUint32(16, 0, true);

  if (tiff !== null) {
    ascii('EXIF', 20);
    view.setUint32(24, tiff.length, true);
    bytes.set(tiff, 28);
  }

  return bytes.buffer;
}

/** A JPEG with a JFIF segment first, then the Exif one — the usual layout. */
function jpegAfterJfif(tiff: Uint8Array): ArrayBuffer {
  const jfif = 16;
  const app1 = 4 + 6 + tiff.length;
  const bytes = new Uint8Array(2 + jfif + app1 + 2);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe0); // APP0
  view.setUint16(4, jfif - 2);
  view.setUint16(2 + jfif, 0xffe1); // APP1
  view.setUint16(4 + jfif, app1 - 2);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6 + jfif);
  bytes.set(tiff, 12 + jfif);
  view.setUint16(bytes.length - 2, 0xffd9);

  return bytes.buffer;
}

/** A JPEG that reaches the image data without ever carrying metadata. */
function jpegWithoutExif(): ArrayBuffer {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe0);
  view.setUint16(4, 4);
  view.setUint16(8, 0xffda); // Start of scan: no more segments follow.
  view.setUint16(10, 2);
  return bytes.buffer;
}

/** A PNG with an optional eXIf chunk, which carries the same TIFF payload. */
function pngWith(tiff: Uint8Array | null): ArrayBuffer {
  const chunk = tiff === null ? 0 : 12 + tiff.length;
  const bytes = new Uint8Array(8 + 25 + chunk + 12);
  const view = new DataView(bytes.buffer);
  const ascii = (text: string, at: number) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  ascii('IHDR', 12);

  let offset = 8 + 25;
  if (tiff !== null) {
    view.setUint32(offset, tiff.length);
    ascii('eXIf', offset + 4);
    bytes.set(tiff, offset + 8);
    offset += 12 + tiff.length;
  }
  view.setUint32(offset, 0);
  ascii('IEND', offset + 4);

  return bytes.buffer;
}

const DATE_TAG = 0x9003;
const ORIENTATION_TAG = 0x0112;
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;

// ------------------------------------------------------------------ tests

describe('exif', () => {
  it('reads the capture day, dropping the clock time', () => {
    // A progress photo belongs to a day. The time EXIF carries has no zone
    // attached, so keeping it would invent precision.
    const exif = readExif(
      jpegWith(
        tiffBlock(
          [{ tag: EXIF_POINTER, type: 4, value: 8 + 2 + 12 + 4 }],
          [{ tag: DATE_TAG, type: 2, value: '2026:03:20 07:41:02' }],
        ),
      ),
    );

    expect(exif.takenOn).toBe('2026-03-20');
  });

  it('reads the orientation tag', () => {
    const exif = readExif(jpegWith(tiffBlock([{ tag: ORIENTATION_TAG, type: 3, value: 6 }])));

    expect(exif.orientation).toBe(6);
    expect(isSideways(6)).toBe(true);
    expect(isSideways(1)).toBe(false);
    expect(isSideways(null)).toBe(false);
  });

  it('sees a GPS block in a file that has one', () => {
    const exif = readExif(jpegWith(tiffBlock([{ tag: GPS_POINTER, type: 4, value: 200 }])));

    expect(exif.hasGps).toBe(true);
  });

  it('sees no GPS block in a file that has none', () => {
    const exif = readExif(jpegWith(tiffBlock([{ tag: ORIENTATION_TAG, type: 3, value: 1 }])));

    expect(exif.hasGps).toBe(false);
  });

  it('reads a WebP that carries EXIF, so an empty one means something', () => {
    // The pipeline writes WebP. Unless this reader can find GPS *in* a WebP,
    // "the stored blob has no GPS" would only prove the reader cannot look.
    const carrying = readExif(webpWith(tiffBlock([{ tag: GPS_POINTER, type: 4, value: 200 }])));
    const stripped = readExif(webpWith(null));

    expect(carrying.hasGps).toBe(true);
    expect(stripped.hasGps).toBe(false);
  });

  it('walks past the segments that come before the Exif one', () => {
    // A phone writes JFIF first. Giving up at the first non-Exif segment
    // would mean reading no date off any real photo.
    const exif = readExif(jpegAfterJfif(tiffBlock([{ tag: GPS_POINTER, type: 4, value: 200 }])));

    expect(exif.hasGps).toBe(true);
  });

  it('stops at the image data rather than reading pixels as tags', () => {
    expect(readExif(jpegWithoutExif())).toMatchObject({ takenOn: null, hasGps: false });
  });

  it('reads a PNG that carries an eXIf chunk', () => {
    const carrying = readExif(pngWith(tiffBlock([{ tag: GPS_POINTER, type: 4, value: 200 }])));
    const plain = readExif(pngWith(null));

    expect(carrying.hasGps).toBe(true);
    expect(plain.hasGps).toBe(false);
  });

  it('accepts a RIFF EXIF chunk with the redundant "Exif" prefix some writers add', () => {
    const tiff = tiffBlock([{ tag: GPS_POINTER, type: 4, value: 200 }]);
    const prefixed = new Uint8Array(6 + tiff.length);
    prefixed.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    prefixed.set(tiff, 6);

    expect(readExif(webpWith(prefixed)).hasGps).toBe(true);
  });

  it('is empty rather than throwing for anything it cannot read', () => {
    // A date that fails to parse means the form opens on today, not an error
    // the user has to dismiss.
    expect(readExif(new ArrayBuffer(0))).toMatchObject({ takenOn: null, hasGps: false });
    expect(readExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer)).toMatchObject({
      takenOn: null,
    });
    // A JPEG that claims an Exif segment and then stops.
    expect(
      readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20]).buffer).takenOn,
    ).toBeNull();
  });

  it('refuses a camera clock that was never set', () => {
    const exif = readExif(
      jpegWith(
        tiffBlock(
          [{ tag: EXIF_POINTER, type: 4, value: 8 + 2 + 12 + 4 }],
          [{ tag: DATE_TAG, type: 2, value: '0000:00:00 00:00:00' }],
        ),
      ),
    );

    expect(exif.takenOn).toBeNull();
  });
});

describe('sizing', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, FULL_EDGE)).toEqual({
      width: 1600,
      height: 1200,
    });
    expect(fitWithin({ width: 3024, height: 4032 }, THUMB_EDGE)).toEqual({
      width: 240,
      height: 320,
    });
  });

  it('never upscales', () => {
    // Enlarging would spend bytes inventing detail that was never there.
    expect(fitWithin({ width: 240, height: 180 }, THUMB_EDGE)).toEqual({
      width: 240,
      height: 180,
    });
  });

  it('never produces a zero dimension', () => {
    // A canvas of zero width throws; a one-pixel sliver is at least an image.
    expect(fitWithin({ width: 10_000, height: 1 }, THUMB_EDGE)).toEqual({ width: 320, height: 1 });
    expect(fitWithin({ width: 0, height: 0 }, THUMB_EDGE)).toEqual({ width: 1, height: 1 });
  });

  it('accepts the formats every engine decodes', () => {
    for (const type of ACCEPTED_TYPES) {
      expect(checkSource({ type, size: 1024 })).toEqual({ status: 'ok' });
    }
  });

  it('refuses what is not an image this app can decode', () => {
    // HEIC imports on Safari and fails everywhere else, which would be worse
    // than refusing it.
    expect(checkSource({ type: 'image/heic', size: 1024 }).status).toBe('reject');
    expect(checkSource({ type: 'video/mp4', size: 1024 }).status).toBe('reject');
  });

  it('refuses a file too large to decode safely, and says the limit', () => {
    const check = checkSource({ type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 });

    expect(check).toMatchObject({ status: 'reject', params: { max: 25 } });
  });

  it('refuses an empty file', () => {
    expect(checkSource({ type: 'image/jpeg', size: 0 }).status).toBe('reject');
  });
});

describe('gallery', () => {
  const photo = (id: string, takenAt: string, over: Partial<Photo> = {}): Photo =>
    ({
      id,
      takenAt,
      recordedAt: `${takenAt}T08:00:00.000Z`,
      pose: 'front',
      fullBlobId: `${id}-full`,
      thumbBlobId: `${id}-thumb`,
      width: 1600,
      height: 1200,
      byteSize: 200_000,
      mimeType: 'image/webp',
      weightKg: null,
      measurementId: null,
      notes: null,
      isFavorite: false,
      createdAt: `${takenAt}T08:00:00.000Z`,
      updatedAt: `${takenAt}T08:00:00.000Z`,
      deletedAt: null,
      rev: 1,
      origin: 'test',
      ...over,
    }) as Photo;

  it('groups by the month taken, newest first', () => {
    const groups = groupByMonth([
      photo('a', '2026-01-04'),
      photo('b', '2026-03-20'),
      photo('c', '2026-03-02'),
    ]);

    expect(groups.map((group) => group.month)).toEqual(['2026-03', '2026-01']);
    expect(groups[0]?.photos.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('keeps the arrival order for two photos taken the same day', () => {
    const first = photo('first', '2026-03-20', { recordedAt: '2026-03-20T08:00:00.000Z' });
    const second = photo('second', '2026-03-20', { recordedAt: '2026-03-20T09:00:00.000Z' });

    expect(sortNewestFirst([first, second]).map((p) => p.id)).toEqual(['second', 'first']);
  });

  it('filters by pose, and an empty selection is no filter', () => {
    const photos = [
      photo('a', '2026-03-20', { pose: 'front' }),
      photo('b', '2026-03-20', { pose: 'back' }),
    ];

    expect(filterByPose(photos, ['back']).map((p) => p.id)).toEqual(['b']);
    expect(filterByPose(photos, [])).toHaveLength(2);
  });

  it('measures the interval between two photos in whole weeks', () => {
    // Eleven days is one week and some. Rounding up would overstate the gap
    // the picture covers.
    expect(intervalBetween('2026-03-01', '2026-03-12')).toMatchObject({ days: 11, weeks: 1 });
    expect(intervalBetween('2026-01-01', '2026-04-09')).toMatchObject({ days: 98, weeks: 14 });
  });

  it('measures the same interval whichever photo was picked first', () => {
    expect(intervalBetween('2026-04-09', '2026-01-01').days).toBe(98);
  });

  it('says when two photos are the same day rather than calling it zero apart', () => {
    expect(intervalBetween('2026-03-20', '2026-03-20')).toMatchObject({ days: 0, sameDay: true });
  });

  it('opens a comparison on the oldest and the newest', () => {
    const pair = defaultPair([
      photo('mid', '2026-02-01'),
      photo('new', '2026-03-20'),
      photo('old', '2026-01-04'),
    ]);

    expect(pair?.from.id).toBe('old');
    expect(pair?.to.id).toBe('new');
  });

  it('has no default pair below two photos', () => {
    // One photo shown twice would invite a reading of "no change" that the
    // data does not support.
    expect(defaultPair([photo('only', '2026-03-20')])).toBeNull();
    expect(defaultPair([])).toBeNull();
  });
});
