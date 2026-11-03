import { Service } from '@angular/core';
import type { ObjectUrls } from '../../data/object-urls';

/** The platform's own object URLs. Nothing to add; the seam is for testing. */
@Service()
export class BrowserObjectUrls implements ObjectUrls {
  create(blob: Blob): string {
    return URL.createObjectURL(blob);
  }

  revoke(url: string): void {
    URL.revokeObjectURL(url);
  }
}
