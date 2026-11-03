/**
 * Reading EXIF, and proving it is gone.
 *
 * Two jobs, and the second is why this is a parser rather than a lookup in a
 * library. The pipeline strips metadata by re-encoding through a canvas
 * (DATABASE_SPEC section 3.12), and "the stored blob contains no GPS" is an
 * acceptance criterion. A claim like that is only worth something if the
 * output is parsed back and found empty, so the same reader has to work on
 * what goes in — a JPEG off a phone — and on what comes out, a WebP.
 *
 * Deliberately partial. It reads the capture date, the orientation tag and
 * whether a GPS block exists, and ignores everything else: those are the three
 * facts the app acts on, and a full EXIF reader would be several hundred lines
 * of tag tables serving nobody.
 */

export interface ExifSummary {
  /** Capture day as `YYYY-MM-DD`, or null when the file does not say. */
  takenOn: string | null;
  /** The orientation tag, 1–8, or null. See `isOrientationApplied`. */
  orientation: number | null;
  /** Whether a GPS block is present at all — location, or a timestamp. */
  hasGps: boolean;
}

const EMPTY: ExifSummary = Object.freeze({ takenOn: null, orientation: null, hasGps: false });

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
/** IFD0's own date, the fallback when the Exif sub-IFD has none. */
const TAG_DATE_TIME = 0x0132;

/**
 * Reads what the app needs out of an image's metadata.
 *
 * Returns an empty summary rather than throwing for anything it does not
 * understand — a truncated file, an unknown container, a tag table that runs
 * off the end. An unreadable date is not an error the user should see: it
 * means the date field starts at today instead of at the capture date.
 */
export function readExif(bytes: ArrayBuffer): ExifSummary {
  try {
    const view = new DataView(bytes);
    const exif = locateExif(view);
    return exif === null ? EMPTY : readTiff(view, exif);
  } catch {
    return EMPTY;
  }
}

/**
 * Whether the decoder has already applied an orientation tag.
 *
 * `createImageBitmap(blob, { imageOrientation: 'from-image' })` rotates for us
 * on every engine this app supports, so the tag is read to *know* the image
 * was sideways, not to rotate it a second time. Anything other than 1 means
 * the pixels and the stored dimensions disagree until the decoder fixes it.
 */
export function isSideways(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8;
}

// ------------------------------------------------------------- containers

/** Byte offset of the TIFF header inside whichever container this is. */
function locateExif(view: DataView): number | null {
  if (view.byteLength < 12) return null;

  // JPEG: 0xFFD8, then segments, one of which is APP1 "Exif\0\0".
  if (view.getUint16(0) === 0xffd8) return locateInJpeg(view);

  // RIFF/WEBP: a chunked container that may carry an "EXIF" chunk. The output
  // of this app's pipeline is WebP, so this branch is what makes "no GPS in
  // the stored blob" a test rather than an assumption.
  if (readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WEBP') {
    return locateInRiff(view);
  }

  // PNG: an optional "eXIf" chunk, same TIFF payload.
  if (view.getUint32(0) === 0x89504e47) return locateInPng(view);

  return null;
}

function locateInJpeg(view: DataView): number | null {
  let offset = 2;

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;

    const marker = view.getUint8(offset + 1);
    // Start of scan: the entropy-coded image data begins, and no more
    // metadata segments follow.
    if (marker === 0xda) return null;

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;

    if (marker === 0xe1 && readAscii(view, offset + 4, 4) === 'Exif') {
      // "Exif" + two padding zero bytes, then the TIFF header.
      return offset + 10;
    }
    offset += 2 + length;
  }

  return null;
}

function locateInRiff(view: DataView): number | null {
  let offset = 12;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'EXIF') {
      const start = offset + 8;
      // Some writers prefix the TIFF header with "Exif\0\0" even here.
      return readAscii(view, start, 4) === 'Exif' ? start + 6 : start;
    }
    // Chunks are padded to an even length.
    offset += 8 + size + (size % 2);
  }

  return null;
}

function locateInPng(view: DataView): number | null {
  let offset = 8;

  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset);
    const type = readAscii(view, offset + 4, 4);
    if (type === 'eXIf') return offset + 8;
    if (type === 'IDAT' || type === 'IEND') return null;
    // Length, type, data, CRC.
    offset += 12 + size;
  }

  return null;
}

// -------------------------------------------------------------- tiff/ifd

function readTiff(view: DataView, tiff: number): ExifSummary {
  if (tiff + 8 > view.byteLength) return EMPTY;

  const endian = view.getUint16(tiff);
  if (endian !== 0x4949 && endian !== 0x4d4d) return EMPTY;
  const little = endian === 0x4949;

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  const entries = readIfd(view, tiff, ifd0, little);

  const exifIfd = entries.get(TAG_EXIF_IFD);
  const exifEntries =
    typeof exifIfd === 'number' ? readIfd(view, tiff, tiff + exifIfd, little) : new Map();

  const orientation = entries.get(TAG_ORIENTATION);
  const date =
    exifEntries.get(TAG_DATE_TIME_ORIGINAL) ??
    exifEntries.get(TAG_DATE_TIME_DIGITIZED) ??
    entries.get(TAG_DATE_TIME);

  return {
    takenOn: typeof date === 'string' ? toDayKey(date) : null,
    orientation: typeof orientation === 'number' ? orientation : null,
    hasGps: entries.has(TAG_GPS_IFD),
  };
}

/**
 * One IFD as a tag map.
 *
 * Only the two value types the wanted tags use are decoded: SHORT for
 * orientation and the sub-IFD pointers, ASCII for the dates. Everything else
 * is skipped rather than guessed at.
 */
function readIfd(
  view: DataView,
  tiff: number,
  ifd: number,
  little: boolean,
): Map<number, number | string> {
  const values = new Map<number, number | string>();
  if (ifd + 2 > view.byteLength) return values;

  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const length = view.getUint32(entry + 4, little);

    if (type === 3) {
      // SHORT. One or more, but every tag read here uses the first.
      values.set(tag, view.getUint16(entry + 8, little));
    } else if (type === 4) {
      // LONG, which is how the sub-IFD pointers are stored.
      values.set(tag, view.getUint32(entry + 8, little));
    } else if (type === 2) {
      // ASCII. Values of five bytes or more live elsewhere in the file.
      const start = length <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little);
      values.set(tag, readAscii(view, start, length).replace(/\0.*$/, ''));
    }
  }

  return values;
}

// ----------------------------------------------------------------- bytes

function readAscii(view: DataView, offset: number, length: number): string {
  if (offset < 0 || offset + length > view.byteLength) return '';

  let out = '';
  for (let index = 0; index < length; index++) {
    out += String.fromCharCode(view.getUint8(offset + index));
  }
  return out;
}

/**
 * EXIF writes `2026:03:20 07:41:02`, which is not a date any parser accepts.
 *
 * Only the day is kept. The clock time would be the phone's local time with no
 * zone attached, and a progress photo belongs to a day, not an instant.
 * A date of all zeros — which cameras write when the clock was never set — is
 * no date at all.
 */
function toDayKey(raw: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  if (year === '0000' || month === '00' || day === '00') return null;

  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;

  return `${year}-${month}-${day}`;
}
