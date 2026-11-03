/**
 * What a progress photo is reduced to before it is stored.
 *
 * The numbers come from DATABASE_SPEC section 3.12, and they are a storage
 * decision before they are an image-quality one: section 11 puts photos at
 * roughly 250 kB each against an iOS origin quota of about a gigabyte, which
 * is the difference between a few hundred photos and a few thousand. A
 * progress photo is looked at beside another progress photo on a phone, so
 * 1600 px on the long edge is already more than the comparison can use.
 */

/** Largest file accepted. Beyond this the decode itself is the risk. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Long edge of the stored image, and of its thumbnail. */
export const FULL_EDGE = 1600;
export const THUMB_EDGE = 320;

/**
 * Encoder quality.
 *
 * The thumbnail is lower because it is never seen at full size: at 320 px the
 * artefacts 0.7 introduces are below what the grid can show, and the saving is
 * the difference between a gallery that loads at once and one that does not.
 */
export const FULL_QUALITY = 0.82;
export const THUMB_QUALITY = 0.7;

/**
 * Formats a browser will decode for us.
 *
 * HEIC is deliberately absent: Safari decodes it and other engines do not, and
 * accepting it would mean a photo that imports on the user's phone and fails
 * on their laptop. iOS converts to JPEG when a photo leaves the library
 * through a file input, so in practice this costs nothing.
 */
export const ACCEPTED_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export interface Size {
  width: number;
  height: number;
}

export type SourceCheck =
  { status: 'ok' } | { status: 'reject'; messageKey: string; params?: Record<string, number> };

/**
 * Whether a file is worth trying to decode.
 *
 * Checked before anything is read, so a 60 MB video picked by mistake costs
 * one message rather than a decode attempt the tab may not survive.
 */
export function checkSource(file: { type: string; size: number }): SourceCheck {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { status: 'reject', messageKey: 'photos.invalid.type' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return {
      status: 'reject',
      messageKey: 'photos.invalid.tooLarge',
      params: { max: Math.round(MAX_SOURCE_BYTES / (1024 * 1024)) },
    };
  }
  if (file.size === 0) {
    return { status: 'reject', messageKey: 'photos.invalid.empty' };
  }
  return { status: 'ok' };
}

/**
 * The size an image becomes when its long edge is capped at `maxEdge`.
 *
 * Never upscales: a 240 px image asked to fit 320 stays 240. Enlarging it
 * would spend bytes inventing detail that was never photographed, and the grid
 * would show the invention at full confidence.
 *
 * Rounds rather than truncates, and never returns a zero dimension — a canvas
 * of zero width throws, and a one-pixel sliver is a strange image but a real
 * one.
 */
export function fitWithin(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= 0) return { width: 1, height: 1 };
  if (longest <= maxEdge) return { width: size.width, height: size.height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
