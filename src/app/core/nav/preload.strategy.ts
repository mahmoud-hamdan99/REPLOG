import { Injectable } from '@angular/core';
import type { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';

/**
 * Preloads only routes marked `data.preload`, and only once the browser is
 * idle.
 *
 * `PreloadAllModules` would pull every feature chunk down on launch, which
 * wastes cellular data for screens most sessions never open. The one route
 * worth preloading is the workout tracker: a user who opens REPLOG at the gym
 * is almost always going there, and it must not wait on a chunk fetch.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] !== true) {
      return EMPTY;
    }

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;

    if (typeof idle === 'function') {
      idle(() => void load().subscribe());
      return EMPTY;
    }

    return load();
  }
}
