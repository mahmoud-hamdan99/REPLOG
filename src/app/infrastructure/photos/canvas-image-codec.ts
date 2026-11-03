import { Service } from '@angular/core';
import type { DecodedImage, ImageCodec } from '../../data/image-codec';
import type { Size } from '../../domain/photos/sizing';

/** Preferred output, and what every engine this app supports can fall back to. */
const WEBP = 'image/webp';
const JPEG = 'image/jpeg';

/**
 * A decoded bitmap, with the handle the canvas needs to draw it.
 *
 * `DecodedImage` deliberately does not expose the bitmap: the processor has no
 * business holding a `CanvasImageSource`, and a seam that leaked one would be
 * no easier to fake than the browser API it replaced.
 */
class BitmapImage implements DecodedImage {
  constructor(readonly bitmap: ImageBitmap) {}

  get width(): number {
    return this.bitmap.width;
  }

  get height(): number {
    return this.bitmap.height;
  }

  close(): void {
    this.bitmap.close();
  }
}

/**
 * The real decoder and encoder.
 *
 * Deliberately the thinnest thing that can satisfy `ImageCodec`: every
 * decision the pipeline makes lives in `PhotoProcessor`, where a fake codec
 * can exercise it. What is left here is two browser calls, which no test
 * environment without a real canvas can run.
 *
 * `imageOrientation: 'from-image'` is why there is no rotation code. Every
 * engine at this app's floor applies the EXIF orientation tag during decode,
 * so the bitmap arrives upright and `width`/`height` are already as the photo
 * is seen. Hand-rolling the eight-case rotation matrix would be a second
 * implementation to keep in step with the first.
 */
@Service()
export class CanvasImageCodec implements ImageCodec {
  async decode(blob: Blob): Promise<DecodedImage> {
    return new BitmapImage(await createImageBitmap(blob, { imageOrientation: 'from-image' }));
  }

  async encode(image: DecodedImage, size: Size, quality: number): Promise<Blob> {
    if (!(image instanceof BitmapImage)) {
      throw new Error('CanvasImageCodec can only encode an image it decoded');
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D canvas context unavailable');

    // The source is always at least as large as the target here, and
    // downscaling in one step is what the browser's own resampler is for.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.bitmap, 0, 0, size.width, size.height);

    const blob = await toBlob(canvas, WEBP, quality);
    // Safari gained WebP encoding in 16.4 and this app's floor is iOS 17, so
    // the fallback should never fire. It exists because a silent `null` here
    // would lose the photo, and a JPEG is a far better outcome than that.
    return blob ?? ((await toBlob(canvas, JPEG, quality)) as Blob);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      // An engine that cannot encode `type` hands back null, or a blob of a
      // different type. Both count as "that did not work".
      (result) => resolve(result !== null && result.type === type ? result : null),
      type,
      quality,
    );
  });
}
