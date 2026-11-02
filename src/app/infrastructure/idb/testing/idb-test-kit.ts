import 'fake-indexeddb/auto';

import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideDataLayer } from '../../../app.providers';
import { CLOCK, type Clock } from '../../../data/clock';
import type { DbChange } from '../../../data/db-events';
import type { Repository } from '../../../data/repository';
import type { EntityStoreName, StoreEntityMap } from '../../../data/stores';
import type { UnitOfWork } from '../../../data/unit-of-work';
import { IdbDatabase } from '../idb-database';
import { IdbDbEvents } from '../idb-db-events';
import { IdbEnvironment } from '../idb-environment';
import { IdbRepository } from '../idb-repository';
import { IdbUnitOfWork, StandaloneRepoContext } from '../idb-unit-of-work';
import { DB_NAME } from '../schema';

/** A clock the test drives, so every timestamp in an assertion is predictable. */
export class FakeClock implements Clock {
  constructor(private current = Date.UTC(2026, 2, 2, 18, 0, 0)) {}

  now(): number {
    return this.current;
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  timezoneOffsetMinutes(): number {
    return 0;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

export interface IdbHarness {
  db: IdbDatabase;
  clock: FakeClock;
  uow: UnitOfWork;
  events: IdbDbEvents;
  /** Every change notification delivered since setup, in order. */
  changes: DbChange[];
  repo<N extends EntityStoreName>(store: N): Repository<StoreEntityMap[N]>;
  dispose(): Promise<void>;
}

/**
 * Builds a real IndexedDB stack over `fake-indexeddb`.
 *
 * Deliberately the real engine rather than the in-memory double: transactions,
 * index ordering, key-range semantics and the auto-commit rule are exactly the
 * behaviours these tests exist to pin down, and a fake that reimplemented them
 * would only prove the fake works.
 */
export async function setupIdb(options: HarnessOptions = {}): Promise<IdbHarness> {
  await deleteDatabase();
  return buildHarness(options);
}

/**
 * A fresh injector over the **same** database, without deleting it.
 *
 * The test equivalent of a reload, or of a second tab: new store instances,
 * new tab id, same data on disk. The reliability suite in Phase 5 is built on
 * this — "does a confirmed set survive a kill" is only a real question if the
 * test can actually kill something.
 */
export async function reopenIdb(options: HarnessOptions = {}): Promise<IdbHarness> {
  return buildHarness(options);
}

export interface HarnessOptions {
  /** Carried over by `reopenIdb`, so time does not jump back on a reload. */
  clock?: FakeClock;
  /** Extra providers, appended so they override the defaults. */
  providers?: Provider[];
}

async function buildHarness(options: HarnessOptions): Promise<IdbHarness> {
  const clock = options.clock ?? new FakeClock();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // The application's own wiring, with only the clock swapped. A separate
    // test-only provider list would drift from app.config and quietly stop
    // testing what actually ships.
    providers: [
      ...provideDataLayer({ clock: { provide: CLOCK, useValue: clock } }),
      ...(options.providers ?? []),
    ],
  });

  const db = TestBed.inject(IdbDatabase);
  const events = TestBed.inject(IdbDbEvents);
  const context = TestBed.inject(StandaloneRepoContext);
  const uow = TestBed.inject(IdbUnitOfWork);
  TestBed.inject(IdbEnvironment).setDeviceId('test-device');

  const changes: DbChange[] = [];
  events.subscribe((change) => changes.push(change));

  return {
    db,
    clock,
    uow,
    events,
    changes,
    repo: <N extends EntityStoreName>(store: N) =>
      new IdbRepository<StoreEntityMap[N]>(store, context),
    dispose: async () => {
      await db.close();
      await deleteDatabase();
    },
  };
}

export function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Minimal valid exercise, so tests state only what they care about. */
export function exerciseDraft(overrides: Record<string, unknown> = {}) {
  return {
    nameEn: 'Bench Press',
    nameAr: 'ضغط البنش',
    isArTranslated: true,
    nameNormEn: 'bench press',
    nameNormAr: 'ضغط البنش',
    aliases: ['bench'],
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: 'barbell',
    exerciseType: 'strength',
    movementPattern: 'horizontal-push',
    mechanics: 'compound',
    force: 'push',
    laterality: 'bilateral',
    loadType: 'external',
    instructionsEn: [],
    instructionsAr: [],
    cuesEn: [],
    cuesAr: [],
    illustration: null,
    defaultRestSec: null,
    weightIncrementKg: 2.5,
    isCustom: 0,
    isArchived: 0,
    isFavorite: false,
    builtInVersion: 1,
    userEdited: false,
    notes: null,
    ...overrides,
  };
}

/** Minimal valid set log. */
export function setLogDraft(overrides: Record<string, unknown> = {}) {
  return {
    workoutId: 'w1',
    workoutExerciseId: 'we1',
    exerciseId: 'bench-press',
    variantKey: 'bench-press|barbell|bilateral',
    dayKey: '2026-03-02',
    setIndex: 0,
    setType: 'working',
    side: 'both',
    weightKg: 100,
    extraWeightKg: null,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: null,
    rir: null,
    isCompleted: true,
    isPr: false,
    completedAt: '2026-03-02T18:00:00.000Z',
    restTakenSec: null,
    e1rmKg: null,
    volumeKg: 500,
    notes: null,
    ...overrides,
  };
}
