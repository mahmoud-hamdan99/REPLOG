import { InjectionToken } from '@angular/core';

/** What one imported file becomes, before anything is written. */
export interface ProcessedPhoto {
  full: Blob;
  thumb: Blob;
  /** Dimensions of the stored full image, for layout without decoding. */
  width: number;
  height: number;
  /** The capture day from the original file, or null if it did not say. */
  takenOn: string | null;
  /** What the encoder actually produced, which is not always what was asked. */
  mimeType: string;
}

/**
 * Turns a picked file into the two images this app stores.
 *
 * A contract rather than a direct dependency because the implementation needs
 * a canvas, and a store that reached for one could not be tested at all. It is
 * also the seam a future worker-based pipeline would slot into without the
 * gallery noticing.
 */
export interface PhotoProcessor {
  process(file: File): Promise<ProcessedPhoto>;
}

export const PHOTO_PROCESSOR = new InjectionToken<PhotoProcessor>('PHOTO_PROCESSOR');
