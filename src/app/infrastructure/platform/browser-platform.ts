import { Service } from '@angular/core';
import type { FileIo, Hasher, StorageEstimate, StorageProbe } from '../../data/platform';

/**
 * Downloads and file picking, the way Safari supports.
 *
 * An anchor with an object URL and a detached `<input type="file">`. The File
 * System Access API would be nicer — a real save dialog, a handle to write
 * back to — and Safari does not have it, so this is the implementation that
 * works everywhere rather than the one that works well in one browser.
 */
@Service()
export class BrowserFileIo implements FileIo {
  download(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    // Revoked on a later turn of the event loop: revoking synchronously races
    // the browser's own read of the URL, and a backup that downloads as an
    // empty file is the worst possible failure for this feature.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  pickText(accept: string): Promise<{ name: string; text: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve(null);
          return;
        }
        void file.text().then((text) => resolve({ name: file.name, text }));
      });

      // A cancelled picker fires nothing in older engines, so the promise
      // would hang. `cancel` is the modern signal; where it is absent the
      // promise simply stays pending until the next pick, which is harmless
      // because nothing is awaiting it except the sheet the user closed.
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
}

@Service()
export class SubtleHasher implements Hasher {
  async sha256Hex(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * What the browser will admit about storage.
 *
 * Every answer is treated as optional, because every one is: `estimate()` is
 * a heuristic that Safari rounds heavily, `persist()` can be refused without
 * explanation, and neither exists in every context the app might run in. A
 * meter that invented a number would be worse than one that says it cannot
 * tell.
 */
@Service()
export class BrowserStorageProbe implements StorageProbe {
  async estimate(): Promise<StorageEstimate> {
    const storage = navigator.storage as StorageManager | undefined;
    if (storage?.estimate === undefined) {
      return { usageBytes: null, quotaBytes: null, persisted: false };
    }

    try {
      const estimate = await storage.estimate();
      const persisted = (await storage.persisted?.()) ?? false;
      return {
        usageBytes: estimate.usage ?? null,
        quotaBytes: estimate.quota ?? null,
        persisted,
      };
    } catch {
      return { usageBytes: null, quotaBytes: null, persisted: false };
    }
  }

  async requestPersistence(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }
}
