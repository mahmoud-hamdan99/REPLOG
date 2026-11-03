import { inject, Service } from '@angular/core';
import { validationError } from '../../core/errors/app-error';
import { IMAGE_CODEC } from '../../data/image-codec';
import type { PhotoProcessor, ProcessedPhoto } from '../../data/photo-processor';
import { readExif } from '../../domain/photos/exif';
import {
  FULL_EDGE,
  FULL_QUALITY,
  THUMB_EDGE,
  THUMB_QUALITY,
  checkSource,
  fitWithin,
} from '../../domain/photos/sizing';

/**
 * Turns a picked file into the two images this app stores.
 *
 * The order of operations is the whole design, and it is not interchangeable.
 * The date is read from the original bytes **first**, because the next step
 * destroys it: re-encoding through a canvas is how the metadata is stripped,
 * and the EXIF GPS goes with it. Read it afterwards and every photo is dated
 * the day it was imported.
 *
 * Then the output is read back and checked. A re-encode that preserved
 * metadata would be a silent privacy failure — the photo would look identical
 * and carry the user's home address — so the pipeline refuses to hand back an
 * image it cannot confirm is clean. It costs one parse of a quarter-megabyte
 * per import, and it turns a promise into a check.
 */
@Service()
export class CanvasPhotoProcessor implements PhotoProcessor {
  private readonly codec = inject(IMAGE_CODEC);

  async process(file: File): Promise<ProcessedPhoto> {
    const check = checkSource(file);
    if (check.status === 'reject') {
      throw validationError(`Unsupported image: ${file.type || 'unknown'} (${file.size} bytes)`, {
        messageKey: check.messageKey,
      });
    }

    // Before the re-encode, which is what removes it.
    const takenOn = readExif(await file.arrayBuffer()).takenOn;

    const image = await this.decode(file);
    try {
      const fullSize = fitWithin(image, FULL_EDGE);
      const full = await this.codec.encode(image, fullSize, FULL_QUALITY);
      const thumb = await this.codec.encode(image, fitWithin(image, THUMB_EDGE), THUMB_QUALITY);

      await this.assertStripped(full);

      return {
        full,
        thumb,
        width: fullSize.width,
        height: fullSize.height,
        takenOn,
        // What the encoder actually produced. An engine without WebP encoding
        // hands back a PNG or a JPEG, and storing the type we asked for would
        // make every later read a lie.
        mimeType: full.type,
      };
    } finally {
      // Roughly 48 MB of pixels for a 12 MP photo. Held past here, two
      // imports in a row are what reloads the tab.
      image.close();
    }
  }

  private async decode(file: File) {
    try {
      return await this.codec.decode(file);
    } catch (error) {
      throw validationError(`Could not decode ${file.type}`, {
        messageKey: 'photos.invalid.decode',
        cause: error,
      });
    }
  }

  /** Refuses an output that still carries a GPS block. */
  private async assertStripped(full: Blob): Promise<void> {
    if (readExif(await full.arrayBuffer()).hasGps) {
      throw validationError('Re-encoding did not remove the location data', {
        messageKey: 'photos.invalid.metadata',
      });
    }
  }
}
