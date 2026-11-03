import { InjectionToken } from '@angular/core';

/**
 * Object URLs, behind a seam.
 *
 * `URL.createObjectURL` pins its blob in memory until the matching
 * `revokeObjectURL` — there is no garbage collection for them. A gallery that
 * creates one per thumbnail and never revokes holds the whole photo library
 * resident, which on the phones this app targets is how a tab gets reclaimed
 * mid-scroll.
 *
 * It is a seam rather than two direct calls because "the gallery holds no more
 * URLs than it is showing" is an acceptance criterion, and the only way to
 * assert it is to count the creates and the revokes.
 */
export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export const OBJECT_URLS = new InjectionToken<ObjectUrls>('OBJECT_URLS');
