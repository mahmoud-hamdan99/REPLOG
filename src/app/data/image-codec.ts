import { InjectionToken } from '@angular/core';
import type { Size } from '../domain/photos/sizing';

/**
 * A decoded image, held outside the JavaScript heap.
 *
 * `close()` is not optional politeness. A decoded 12 MP photo is roughly
 * 48 MB of pixels, and on the phones this app targets a handful of them held
 * at once is the difference between an import and a reloaded tab.
 */
export interface DecodedImage {
  /** As displayed — any orientation tag has already been applied. */
  readonly width: number;
  readonly height: number;
  close(): void;
}

/**
 * The two browser capabilities the photo pipeline needs, and nothing else.
 *
 * A seam rather than direct calls, for one reason: everything *interesting*
 * about the pipeline — what it refuses, what sizes it picks, that it reads the
 * date before stripping, that it checks its own output — is orchestration, and
 * orchestration over a seam can be tested. `createImageBitmap` and
 * `canvas.toBlob` cannot run under the test environment, so the part that
 * cannot be tested is kept down to the two calls that wrap them.
 */
export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedImage>;

  /**
   * Re-encodes at `size`. The output carries no metadata, because re-encoding
   * is how metadata is stripped (DATABASE_SPEC section 3.12).
   *
   * The returned blob's `type` is authoritative: an engine without WebP
   * encoding falls back, and the caller stores what it was actually given
   * rather than what it asked for.
   */
  encode(image: DecodedImage, size: Size, quality: number): Promise<Blob>;
}

export const IMAGE_CODEC = new InjectionToken<ImageCodec>('IMAGE_CODEC');
