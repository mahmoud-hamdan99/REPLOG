import { TestBed } from '@angular/core/testing';
import { AppError } from '../../core/errors/app-error';
import { IMAGE_CODEC, type DecodedImage, type ImageCodec } from '../../data/image-codec';
import type { Size } from '../../domain/photos/sizing';
import { CanvasPhotoProcessor } from './photo-processor';

/**
 * The pipeline's ordering guarantees.
 *
 * None of this touches a canvas. What is being tested is the sequence — date
 * read before the re-encode that destroys it, output checked before it is
 * handed back, decoded pixels released whatever happens — and a fake codec
 * records that sequence exactly as a real one would produce it.
 */

interface Encoded {
  size: Size;
  quality: number;
}

class FakeCodec implements ImageCodec {
  readonly encodes: Encoded[] = [];
  closed = 0;
  decodes = 0;

  /** Bytes the next `encode` hands back, so a test can return a GPS-bearing file. */
  output: ArrayBuffer = new ArrayBuffer(0);
  failDecode = false;

  constructor(
    private readonly width = 4032,
    private readonly height = 3024,
  ) {}

  async decode(): Promise<DecodedImage> {
    this.decodes++;
    if (this.failDecode) throw new Error('corrupt');
    return {
      width: this.width,
      height: this.height,
      close: () => {
        this.closed++;
      },
    };
  }

  async encode(_image: DecodedImage, size: Size, quality: number): Promise<Blob> {
    this.encodes.push({ size, quality });
    return new Blob([this.output], { type: 'image/webp' });
  }
}

/**
 * A JPEG carrying one IFD0 tag, which is enough to be found and read.
 * `0x8825` is the GPS pointer; `0x8769` points at a sub-IFD with the date.
 */
function jpegWithTag(tag: number, type: number, value: number): ArrayBuffer {
  const entries = 1;
  const tiff = new Uint8Array(8 + 2 + entries * 12 + 4);
  const tiffView = new DataView(tiff.buffer);
  tiffView.setUint16(0, 0x4949, true);
  tiffView.setUint16(2, 42, true);
  tiffView.setUint32(4, 8, true);
  tiffView.setUint16(8, entries, true);
  tiffView.setUint16(10, tag, true);
  tiffView.setUint16(12, type, true);
  tiffView.setUint32(14, 1, true);
  tiffView.setUint32(18, value, true);

  const bytes = new Uint8Array(12 + tiff.length + 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, 8 + tiff.length);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  bytes.set(tiff, 12);
  view.setUint16(bytes.length - 2, 0xffd9);
  return bytes.buffer;
}

/** A JPEG whose Exif sub-IFD carries DateTimeOriginal. */
function jpegTakenOn(date: string): ArrayBuffer {
  const ifd0Size = 2 + 12 + 4;
  const subStart = 8 + ifd0Size;
  const text = `${date}\0`;
  const heap = subStart + 2 + 12 + 4;

  const tiff = new Uint8Array(heap + text.length);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true); // Exif IFD pointer
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, subStart, true);

  view.setUint16(subStart, 1, true);
  view.setUint16(subStart + 2, 0x9003, true); // DateTimeOriginal
  view.setUint16(subStart + 4, 2, true);
  view.setUint32(subStart + 6, text.length, true);
  view.setUint32(subStart + 10, heap, true);
  for (let i = 0; i < text.length; i++) view.setUint8(heap + i, text.charCodeAt(i));

  const bytes = new Uint8Array(12 + tiff.length + 2);
  const outer = new DataView(bytes.buffer);
  outer.setUint16(0, 0xffd8);
  outer.setUint16(2, 0xffe1);
  outer.setUint16(4, 8 + tiff.length);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  bytes.set(tiff, 12);
  outer.setUint16(bytes.length - 2, 0xffd9);
  return bytes.buffer;
}

function file(content: ArrayBuffer, type = 'image/jpeg'): File {
  return new File([content], 'photo.jpg', { type });
}

describe('CanvasPhotoProcessor', () => {
  let codec: FakeCodec;
  let processor: CanvasPhotoProcessor;

  const setup = (fake = new FakeCodec()) => {
    codec = fake;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: IMAGE_CODEC, useValue: fake }] });
    processor = TestBed.inject(CanvasPhotoProcessor);
  };

  beforeEach(() => {
    setup();
  });

  it('writes a full image and a thumbnail at the spec sizes', async () => {
    const result = await processor.process(file(jpegWithTag(0x0112, 3, 1)));

    expect(codec.encodes).toEqual([
      { size: { width: 1600, height: 1200 }, quality: 0.82 },
      { size: { width: 320, height: 240 }, quality: 0.7 },
    ]);
    // The *stored* dimensions, so the gallery can lay out without decoding.
    expect(result).toMatchObject({ width: 1600, height: 1200, mimeType: 'image/webp' });
  });

  it('reads the capture date before the re-encode that destroys it', async () => {
    const result = await processor.process(file(jpegTakenOn('2026:03:20 07:41:02')));

    // Read afterwards, every imported photo would be dated the day it was
    // imported rather than the day it was taken.
    expect(result.takenOn).toBe('2026-03-20');
  });

  it('has no date when the file does not carry one', async () => {
    const result = await processor.process(file(jpegWithTag(0x0112, 3, 1)));

    // Null, not today: the form decides what to default to, and it should not
    // be told a guess is a fact.
    expect(result.takenOn).toBeNull();
  });

  it('refuses an output that still carries location data', async () => {
    // The whole privacy claim rests on the re-encode stripping metadata. An
    // engine that preserved it would produce a photo that looks identical and
    // carries the user's home address, so the pipeline checks rather than
    // trusts.
    codec.output = jpegWithTag(0x8825, 4, 200);

    await expect(processor.process(file(jpegWithTag(0x0112, 3, 1)))).rejects.toMatchObject({
      messageKey: 'photos.invalid.metadata',
    });
  });

  it('accepts an output with no metadata at all', async () => {
    codec.output = new Uint8Array([1, 2, 3, 4]).buffer;

    await expect(processor.process(file(jpegWithTag(0x0112, 3, 1)))).resolves.toBeTruthy();
  });

  it('never upscales a small photo', async () => {
    setup(new FakeCodec(240, 180));

    const result = await processor.process(file(jpegWithTag(0x0112, 3, 1)));

    expect(codec.encodes.map((encode) => encode.size)).toEqual([
      { width: 240, height: 180 },
      { width: 240, height: 180 },
    ]);
    expect(result.width).toBe(240);
  });

  it('refuses a file that is not an image it can decode', async () => {
    // Checked before anything is read, so a video picked by mistake costs one
    // message rather than a decode the tab may not survive.
    await expect(processor.process(file(new ArrayBuffer(8), 'video/mp4'))).rejects.toMatchObject({
      messageKey: 'photos.invalid.type',
    });
    expect(codec.decodes).toBe(0);
  });

  it('reports a decode failure as something the user can act on', async () => {
    codec.failDecode = true;

    const error = await processor.process(file(jpegWithTag(0x0112, 3, 1))).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ kind: 'validation', messageKey: 'photos.invalid.decode' });
  });

  it('releases the decoded pixels even when encoding throws', async () => {
    // Roughly 48 MB for a 12 MP photo. Leaked twice, the tab reloads.
    codec.encode = async () => {
      throw new Error('encoder died');
    };

    await expect(processor.process(file(jpegWithTag(0x0112, 3, 1)))).rejects.toThrow();
    expect(codec.closed).toBe(1);
  });

  it('releases the decoded pixels on success too', async () => {
    await processor.process(file(jpegWithTag(0x0112, 3, 1)));

    expect(codec.closed).toBe(1);
  });

  it('stores the type the encoder actually produced', async () => {
    // An engine without WebP encoding hands back something else, and storing
    // the type we asked for would make every later read a lie.
    codec.encode = async () => new Blob([new ArrayBuffer(4)], { type: 'image/jpeg' });

    const result = await processor.process(file(jpegWithTag(0x0112, 3, 1)));

    expect(result.mimeType).toBe('image/jpeg');
  });
});
