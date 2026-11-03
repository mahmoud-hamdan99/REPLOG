import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 acceptance checks that need a real browser.
 *
 * The pipeline's ordering is pinned by unit tests against a fake codec; what
 * those cannot show is what a *real* decoder and encoder produce, and that is
 * exactly where the privacy promise lives. So these tests build a genuine
 * JPEG carrying a genuine EXIF GPS block, push it through the real canvas
 * pipeline, and read the stored bytes back out of IndexedDB to check what
 * survived.
 */

// Importing a 12 MP image through a real canvas is not fast, and the first run
// also seeds the exercise catalog.
test.describe.configure({ timeout: 180_000 });

/**
 * Installs a photo factory in the page.
 *
 * The image is drawn rather than loaded from a fixture: a checked-in JPEG
 * would be opaque, and nobody reading this could say what makes it a
 * GPS-bearing file. Here the GPS block is assembled in view, byte by byte.
 */
async function installPhotoFactory(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { makePhoto: () => Promise<File> }).makePhoto = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3024;
      canvas.height = 4032;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#2b4162');
      grad.addColorStop(1, '#bfd7ea');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e0ff4f';
      ctx.fillRect(900, 1200, 1200, 1600);
      const base = (await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      )) as Blob;
      const bytes = new Uint8Array(await base.arrayBuffer());

      // IFD0 with an Exif pointer and a GPS pointer; the Exif IFD carries
      // DateTimeOriginal and the GPS IFD carries a latitude reference.
      const date = '2026:06:14 08:12:30\0';
      const ifd0Size = 2 + 2 * 12 + 4;
      const exifStart = 8 + ifd0Size;
      const exifSize = 2 + 12 + 4;
      const gpsStart = exifStart + exifSize;
      const gpsSize = 2 + 12 + 4;
      const heap = gpsStart + gpsSize;

      const tiff = new Uint8Array(heap + date.length);
      const v = new DataView(tiff.buffer);
      v.setUint16(0, 0x4949, true);
      v.setUint16(2, 42, true);
      v.setUint32(4, 8, true);
      v.setUint16(8, 2, true);
      v.setUint16(10, 0x8769, true);
      v.setUint16(12, 4, true);
      v.setUint32(14, 1, true);
      v.setUint32(18, exifStart, true);
      v.setUint16(22, 0x8825, true);
      v.setUint16(24, 4, true);
      v.setUint32(26, 1, true);
      v.setUint32(30, gpsStart, true);
      v.setUint16(exifStart, 1, true);
      v.setUint16(exifStart + 2, 0x9003, true);
      v.setUint16(exifStart + 4, 2, true);
      v.setUint32(exifStart + 6, date.length, true);
      v.setUint32(exifStart + 10, heap, true);
      v.setUint16(gpsStart, 1, true);
      v.setUint16(gpsStart + 2, 0x0001, true);
      v.setUint16(gpsStart + 4, 2, true);
      v.setUint32(gpsStart + 6, 2, true);
      v.setUint8(gpsStart + 10, 78);
      for (let i = 0; i < date.length; i++) v.setUint8(heap + i, date.charCodeAt(i));

      const app1 = new Uint8Array(4 + 6 + tiff.length);
      const a = new DataView(app1.buffer);
      a.setUint16(0, 0xffe1);
      a.setUint16(2, 2 + 6 + tiff.length);
      app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
      app1.set(tiff, 10);

      const out = new Uint8Array(2 + app1.length + (bytes.length - 2));
      out.set(bytes.subarray(0, 2), 0);
      out.set(app1, 2);
      out.set(bytes.subarray(2), 2 + app1.length);
      return new File([out], 'IMG_0421.jpg', { type: 'image/jpeg' });
    };
  });
}

/** Picks the generated photo in the open import sheet, as a file input would. */
async function choosePhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const make = (window as unknown as { makePhoto: () => Promise<File> }).makePhoto;
    const input = document.querySelector(
      'rl-sheet dialog[open] input[type="file"]',
    ) as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(await make());
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Imports one photo end to end, leaving the gallery showing it. */
async function importPhoto(page: Page, options: { pose?: string } = {}): Promise<void> {
  await page
    .getByRole('button', { name: /Add your first photo|Add a photo/ })
    .first()
    .click();

  const sheet = page.locator('rl-sheet dialog[open]').first();
  await expect(sheet).toBeVisible();

  await installPhotoFactory(page);
  await choosePhoto(page);
  await expect(sheet.getByText('IMG_0421.jpg')).toBeVisible();

  if (options.pose !== undefined) {
    await sheet.getByRole('button', { name: options.pose, exact: true }).click();
  }

  await sheet.getByRole('button', { name: 'Save photo' }).click();
  await expect(sheet).toBeHidden({ timeout: 60_000 });
}

/** Photo metadata and blob summaries, straight out of IndexedDB. */
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('replog');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (store: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const photos = await all('photos');
    const blobs = await all('photoBlobs');
    db.close();

    const latin = (buffer: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(buffer));
    return {
      photos: photos.map((photo) => ({
        takenAt: photo['takenAt'],
        pose: photo['pose'],
        width: photo['width'],
        height: photo['height'],
        byteSize: photo['byteSize'],
        mimeType: photo['mimeType'],
        deleted: photo['deletedAt'] !== null,
      })),
      blobs: blobs.map((blob) => {
        const data = blob['data'] as ArrayBuffer;
        return {
          mimeType: blob['mimeType'],
          byteSize: blob['byteSize'],
          container: `${latin(data.slice(0, 4))}/${latin(data.slice(8, 12))}`,
          // The whole privacy claim, read back off the stored bytes.
          carriesExif: latin(data.slice(0, 8192)).includes('Exif'),
        };
      }),
    };
  });
}

test('a stored photo carries no location data', async ({ page }) => {
  await page.goto('/photos');
  await importPhoto(page);

  const { photos, blobs } = await stored(page);

  // The source had a real GPS block. Re-encoding through a canvas is what
  // removes it, and this reads the output back rather than trusting that.
  expect(blobs).toHaveLength(2);
  for (const blob of blobs) {
    expect(blob.carriesExif).toBe(false);
    expect(blob.container).toBe('RIFF/WEBP');
  }
  // Long edge capped at 1600, aspect ratio kept, and well inside the budget.
  expect(photos[0]).toMatchObject({ width: 1200, height: 1600, mimeType: 'image/webp' });
  expect(photos[0]?.byteSize as number).toBeLessThanOrEqual(350 * 1024);
});

test('the capture date is read from the file before it is stripped', async ({ page }) => {
  await page.goto('/photos');
  await page
    .getByRole('button', { name: /Add your first photo|Add a photo/ })
    .first()
    .click();

  const sheet = page.locator('rl-sheet dialog[open]').first();
  await installPhotoFactory(page);
  await choosePhoto(page);

  // Read after the re-encode, every import would be dated the day it was
  // imported rather than the day it was taken.
  await expect(sheet.locator('input[type="date"]')).toHaveValue('2026-06-14');
});

test('no request leaves the device while a photo is imported', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/^(blob:|data:|about:)/.test(url) && !url.startsWith('http://localhost:4200')) {
      external.push(url);
    }
  });

  await page.goto('/photos');
  await importPhoto(page);

  // PRODUCT_SPEC section 4.8: photos must remain local. Nothing was uploaded,
  // and nothing was fetched from anywhere but the dev server itself.
  expect(external).toEqual([]);
});

test('deleting a photo reclaims both blobs for good', async ({ page }) => {
  await page.goto('/photos');
  await importPhoto(page);

  await page.getByRole('button', { name: 'Select' }).click();
  await page.locator('rl-photo-thumb .pt__button').first().click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.locator('.bar').getByRole('button', { name: 'Delete' }).click();

  // Not "you can undo this": the pixels go with the record, and the dialog
  // has to say so rather than implying a recovery that does not exist.
  await expect(page.getByText(/cannot be recovered/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  await expect(page.locator('rl-photo-thumb')).toHaveCount(0);
  const { photos, blobs } = await stored(page);
  expect(blobs).toEqual([]);
  // The record is tombstoned, which is what keeps the deletion replicable.
  expect(photos[0]?.deleted).toBe(true);
});

test('the import sheet says where photos go and what is removed', async ({ page }) => {
  await page.goto('/photos');
  await page.getByRole('button', { name: 'Add your first photo' }).click();

  const sheet = page.locator('rl-sheet dialog[open]').first();
  await expect(
    sheet.getByText('Photos stay on this device. Location data is removed when a photo is added.'),
  ).toBeVisible();
});

test('the privacy blur hides a thumbnail until it is tapped', async ({ page }) => {
  await page.goto('/photos');
  await importPhoto(page);

  await page.goto('/settings');
  await page.getByRole('checkbox', { name: 'Hide thumbnails until tapped' }).check();
  // The app says what it does not do, rather than letting a blur read as a lock.
  await expect(page.getByText(/There is no app lock/)).toBeVisible();

  await page.goto('/photos');
  const tile = page.locator('rl-photo-thumb').first();
  await expect(tile).toHaveClass(/pt--blurred/);

  // The first tap reveals and nothing more: checking which photo it is should
  // not throw it full-screen.
  await tile.locator('.pt__button').click();
  await expect(tile).not.toHaveClass(/pt--blurred/);
  await expect(page.locator('rl-sheet dialog[open]')).toHaveCount(0);
});

test('the Progress screens link to each other', async ({ page }) => {
  // Three routes with nothing linking to them are three routes nobody can
  // reach on a phone.
  await page.goto('/progress');
  await page.getByRole('link', { name: 'Photos' }).click();
  await expect(page).toHaveURL(/\/photos$/);

  await page.getByRole('link', { name: 'Measurements' }).click();
  await expect(page).toHaveURL(/\/body$/);
});
