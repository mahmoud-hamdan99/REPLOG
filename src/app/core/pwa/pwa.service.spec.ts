import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { APP_META_STORE, type AppMetaStore } from '../../data/app-meta';
import { CLOCK, type Clock } from '../../data/clock';
import { PREFS_STORE, type PrefsStore } from '../../data/prefs';
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from '../../domain/models/prefs';
import { DiagnosticsService } from '../errors/diagnostics.service';
import { ToastService } from '../toast/toast.service';
import { PwaService } from './pwa.service';

/**
 * The rule this whole service exists to keep: **never reload by itself**, and
 * never even offer to while a session is running.
 *
 * A reload mid-set loses the weight and reps someone typed but has not
 * confirmed. The person it happens to is under a loaded bar, and they will
 * not use the app again.
 */

class FakeSwUpdate {
  isEnabled = true;
  readonly versionUpdates = new Subject<VersionEvent>();
  readonly unrecoverable = new Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>();
  activateCalls = 0;

  async activateUpdate(): Promise<boolean> {
    this.activateCalls++;
    return true;
  }
}

function inMemoryPrefs(): PrefsStore {
  let current: Prefs = normalizePrefs({ ...DEFAULT_PREFS });
  return {
    read: () => current,
    write: (prefs) => {
      current = prefs;
    },
    clear: () => {
      current = { ...DEFAULT_PREFS };
    },
  };
}

/**
 * A window stand-in that counts reloads and remembers listeners.
 *
 * Counting rather than reloading, because a test that actually reloaded would
 * take the runner with it. The listener map is what lets a test fire
 * `beforeinstallprompt`, which is the only way to reach the install path.
 */
function fakeDocument() {
  const listeners = new Map<string, (event: Event) => void>();
  return {
    defaultView: {
      location: { reload: () => reloads++ },
      addEventListener: (type: string, handler: (event: Event) => void) => {
        listeners.set(type, handler);
      },
      dispatch: (type: string, event: Event) => listeners.get(type)?.(event),
      has: (type: string) => listeners.has(type),
    },
  };
}

const fixedClock: Clock = {
  now: () => Date.UTC(2026, 10, 4, 12, 0, 0),
  nowIso: () => new Date(Date.UTC(2026, 10, 4, 12, 0, 0)).toISOString(),
  timezoneOffsetMinutes: () => 0,
};

/** Only `get` is used here; the rest of the store is not this test's business. */
function metaStoreWith(activeWorkoutId: string | null): AppMetaStore {
  return {
    get: async (key: string) => (key === 'activeWorkoutId' ? activeWorkoutId : null),
  } as unknown as AppMetaStore;
}

let reloads = 0;

describe('PwaService', () => {
  let updates: FakeSwUpdate;
  let toasts: ToastService;

  function setup(activeWorkoutId: string | null): PwaService {
    TestBed.resetTestingModule();
    updates = new FakeSwUpdate();
    reloads = 0;

    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: PREFS_STORE, useValue: inMemoryPrefs() },
        { provide: CLOCK, useValue: fixedClock },
        { provide: APP_META_STORE, useValue: metaStoreWith(activeWorkoutId) },
        { provide: DOCUMENT, useValue: fakeDocument() },
      ],
    });

    toasts = TestBed.inject(ToastService);
    const service = TestBed.inject(PwaService);
    service.listen();
    return service;
  }

  const versionReady = (): VersionEvent =>
    ({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    }) as VersionEvent;

  it('offers a new version without applying it', async () => {
    const service = setup(null);

    updates.versionUpdates.next(versionReady());
    await Promise.resolve();
    await Promise.resolve();

    expect(service.updateReady()).toBe(true);
    expect(toasts.toasts()).toHaveLength(1);
    // The offer is an offer. Nothing has happened to the running app.
    expect(updates.activateCalls).toBe(0);
    expect(reloads).toBe(0);
  });

  it('says nothing while a workout is in progress', async () => {
    const service = setup('workout-1');

    updates.versionUpdates.next(versionReady());
    await Promise.resolve();
    await Promise.resolve();

    // Held, not dropped: the badge stays so the update can still be found.
    expect(service.updateReady()).toBe(true);
    expect(toasts.toasts()).toEqual([]);
    expect(reloads).toBe(0);
  });

  it('holds the update when it cannot tell whether a workout is running', async () => {
    // Safe mode, or the database blocked by another tab. Waiting costs
    // nothing; reloading over a session we could not see costs a workout.
    TestBed.resetTestingModule();
    updates = new FakeSwUpdate();
    reloads = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: PREFS_STORE, useValue: inMemoryPrefs() },
        { provide: CLOCK, useValue: fixedClock },
        {
          provide: APP_META_STORE,
          useValue: {
            get: () => Promise.reject(new Error('safe mode')),
          } as unknown as AppMetaStore,
        },
        { provide: DOCUMENT, useValue: fakeDocument() },
      ],
    });
    toasts = TestBed.inject(ToastService);
    const service = TestBed.inject(PwaService);
    service.listen();

    updates.versionUpdates.next(versionReady());
    await Promise.resolve();
    await Promise.resolve();

    expect(service.updateReady()).toBe(true);
    expect(toasts.toasts()).toEqual([]);
  });

  it('activates and reloads only when asked', async () => {
    const service = setup(null);

    await service.apply();

    expect(updates.activateCalls).toBe(1);
    expect(reloads).toBe(1);
  });

  it('still reloads when activation fails', async () => {
    const service = setup(null);
    updates.activateUpdate = () => Promise.reject(new Error('gone'));

    await service.apply();

    // The waiting worker may already have been replaced. Reloading lands on
    // whatever version is current, which is what the user asked for.
    expect(reloads).toBe(1);
  });

  it('records a failed installation without telling the user', async () => {
    const service = setup(null);
    const diagnostics = TestBed.inject(DiagnosticsService);

    updates.versionUpdates.next({
      type: 'VERSION_INSTALLATION_FAILED',
      version: { hash: 'new' },
      error: 'network died',
    } as VersionEvent);
    await Promise.resolve();

    // Nothing is broken and there is nothing to do about it, so it belongs in
    // the diagnostics log rather than in front of somebody mid-session.
    expect(diagnostics.entries()).toHaveLength(1);
    expect(toasts.toasts()).toEqual([]);
    expect(service.updateReady()).toBe(false);
  });

  it('reports a damaged cache as its own state', async () => {
    const service = setup(null);

    updates.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    await Promise.resolve();

    expect(service.isBroken()).toBe(true);
    // Separate from updateReady on purpose: the message has to say the
    // training history is untouched, which an update prompt does not.
    expect(service.updateReady()).toBe(false);
  });

  it('captures the install prompt and shows it only once', async () => {
    const service = setup(null);
    const window = TestBed.inject(DOCUMENT).defaultView as unknown as {
      dispatch: (type: string, event: Event) => void;
    };

    let prevented = false;
    let prompted = 0;
    const event = {
      preventDefault: () => {
        prevented = true;
      },
      prompt: async () => {
        prompted++;
      },
    } as unknown as Event;

    window.dispatch('beforeinstallprompt', event);

    // Deferred, not suppressed: without preventDefault the browser shows its
    // own bar wherever it likes, including over a working set.
    expect(prevented).toBe(true);
    expect(service.installPrompt()).not.toBeNull();

    await service.promptInstall();
    expect(prompted).toBe(1);

    // The browser discards the event after one use, so the offer goes with
    // it and About falls back to the Add to Home Screen instructions.
    expect(service.installPrompt()).toBeNull();
    await service.promptInstall();
    expect(prompted).toBe(1);
  });

  it('listens for an install prompt even where updates are disabled', async () => {
    // Development, or any browser without a service worker: installation and
    // updates are independent, and returning early from `listen` used to
    // skip both.
    TestBed.resetTestingModule();
    updates = new FakeSwUpdate();
    updates.isEnabled = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: PREFS_STORE, useValue: inMemoryPrefs() },
        { provide: CLOCK, useValue: fixedClock },
        { provide: APP_META_STORE, useValue: metaStoreWith(null) },
        { provide: DOCUMENT, useValue: fakeDocument() },
      ],
    });
    TestBed.inject(PwaService).listen();

    const window = TestBed.inject(DOCUMENT).defaultView as unknown as {
      has: (type: string) => boolean;
    };
    expect(window.has('beforeinstallprompt')).toBe(true);
  });

  it('does nothing at all when the service worker is disabled', async () => {
    TestBed.resetTestingModule();
    updates = new FakeSwUpdate();
    updates.isEnabled = false;
    reloads = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: PREFS_STORE, useValue: inMemoryPrefs() },
        { provide: CLOCK, useValue: fixedClock },
        { provide: APP_META_STORE, useValue: metaStoreWith(null) },
        { provide: DOCUMENT, useValue: fakeDocument() },
      ],
    });
    toasts = TestBed.inject(ToastService);
    const service = TestBed.inject(PwaService);
    service.listen();

    // In development there is no worker; subscribing anyway would be harmless
    // but asserting it stays quiet keeps `ng serve` free of update toasts.
    updates.versionUpdates.next(versionReady());
    await Promise.resolve();

    expect(service.updateReady()).toBe(false);
    expect(toasts.toasts()).toEqual([]);
  });
});
