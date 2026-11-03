import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import type { StoreName } from '../../data/stores';
import { PERSONAL_RECORDS_REPO, SET_LOGS_REPO, WORKOUT_EXERCISES_REPO } from '../../data/tokens';
import type { Draft } from '../../domain/models/entity';
import type { LoadType } from '../../domain/models/enums';
import type { PersonalRecord } from '../../domain/models/records';
import type { SetLog, Workout, WorkoutExercise } from '../../domain/models/workout';
import { buildRecords } from '../../domain/strength/prs';
import { setupIdb, type IdbHarness } from '../../infrastructure/idb/testing/idb-test-kit';
import { HistoryStore } from '../history/history.store';
import { PrEngine } from './pr-engine';

const STORES: readonly StoreName[] = ['personalRecords', 'setLogs', 'workoutExercises'];

const BARBELL = 'bench|barbell|bilateral';
const DUMBBELL = 'bench|dumbbell|bilateral';

describe('PrEngine', () => {
  let h: IdbHarness;
  let engine: PrEngine;
  let history: HistoryStore;

  beforeEach(async () => {
    h = await setupIdb();
    engine = TestBed.inject(PrEngine);
    history = TestBed.inject(HistoryStore);
  });

  afterEach(async () => {
    await h.dispose();
  });

  // ------------------------------------------------------------------ seeds

  /** One session of one exercise, written straight to the stores. */
  async function seedSession(options: {
    day: number;
    variantKey?: string;
    exerciseId?: string;
    loadType?: LoadType;
    sets: { weightKg?: number | null; extraWeightKg?: number | null; reps: number | null }[];
  }): Promise<{ workoutId: string; exerciseId: string; setIds: string[] }> {
    const iso = `2026-01-${String(options.day).padStart(2, '0')}T10:00:00.000Z`;
    const exerciseId = options.exerciseId ?? 'bench';
    const variantKey = options.variantKey ?? BARBELL;

    // A real workout row, because the history store refuses to edit or restore
    // a session it cannot find — and a seed that skips it tests nothing.
    const workout = await h.repo('workouts').put({
      status: 'completed',
      startedAt: iso,
      finishedAt: iso,
      dayKey: iso.slice(0, 10),
      name: 'Session',
      planId: null,
      routineId: null,
      planSnapshot: null,
      source: 'quick',
      pauses: [],
      durationSec: 3600,
      totalVolumeKg: 0,
      totalSets: options.sets.length,
      totalReps: 0,
      exerciseCount: 1,
      bodyWeightKg: 80,
      notes: null,
      perceivedEffort: null,
      feeling: null,
      prCount: 0,
      trackingMode: 'simple',
      tabId: null,
      heartbeatAt: null,
      discardedReason: null,
      editedAt: null,
    } as Draft<Workout>);
    const workoutId = workout.id;

    const exercise = await h.repo('workoutExercises').put({
      workoutId,
      exerciseId,
      variantKey,
      nameSnapshot: 'Bench Press',
      routineExerciseUid: null,
      startedAt: iso,
      dayKey: iso.slice(0, 10),
      orderIndex: 1000,
      supersetGroup: null,
      supersetOrder: null,
      targetSnapshot: null,
      loadType: options.loadType ?? 'external',
      laterality: 'bilateral',
      restSec: 90,
      notes: null,
      isSkipped: false,
      completedSetCount: options.sets.length,
      volumeKg: 0,
    } satisfies Draft<WorkoutExercise>);

    const setIds: string[] = [];
    for (const [index, spec] of options.sets.entries()) {
      const weightKg = spec.weightKg ?? null;
      const extraWeightKg = spec.extraWeightKg ?? null;
      const load = weightKg ?? (extraWeightKg === null ? null : 80 + extraWeightKg);
      const created = await h.repo('setLogs').put({
        workoutId,
        workoutExerciseId: exercise.id,
        exerciseId,
        variantKey,
        dayKey: iso.slice(0, 10),
        setIndex: index,
        setType: 'working',
        side: 'both',
        weightKg,
        extraWeightKg,
        reps: spec.reps,
        durationSec: null,
        distanceM: null,
        rpe: null,
        rir: null,
        isCompleted: true,
        isPr: false,
        completedAt: iso,
        restTakenSec: null,
        e1rmKg: null,
        volumeKg: load === null || spec.reps === null ? null : load * spec.reps,
        notes: null,
      } satisfies Draft<SetLog>);
      setIds.push(created.id);
    }

    return { workoutId, exerciseId, setIds };
  }

  /** What the finish transaction does, for the variants a session touched. */
  function detectFor(variantKeys: readonly string[]): Promise<void> {
    return h.uow.run(STORES, 'readwrite', (tx) => engine.recompute(tx, { variantKeys }));
  }

  function rebuildAll(): Promise<number> {
    return h.uow.run(STORES, 'readwrite', (tx) => engine.rebuildAll(tx));
  }

  async function records(): Promise<PersonalRecord[]> {
    return (await TestBed.inject(PERSONAL_RECORDS_REPO).list()).sort((a, b) =>
      `${a.variantKey}${a.prType}${a.repBucket}${a.achievedAt}`.localeCompare(
        `${b.variantKey}${b.prType}${b.repBucket}${b.achievedAt}`,
      ),
    );
  }

  /** The record that currently stands, which is what a screen shows. */
  async function currentRecord(
    prType: string,
    variantKey = BARBELL,
    bucket: number | null = null,
  ): Promise<PersonalRecord | undefined> {
    return (await records()).find(
      (record) =>
        record.variantKey === variantKey &&
        record.prType === prType &&
        record.repBucket === bucket &&
        record.isCurrent === 1,
    );
  }

  // ------------------------------------------------------------- detection

  describe('detecting records', () => {
    it('writes a first record with no previous value', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await detectFor([BARBELL]);

      const record = await currentRecord('maxWeight');
      expect(record?.value).toBe(100);
      expect(record?.previousValue).toBeNull();
      expect(record?.nameSnapshot).toBe('Bench Press');
    });

    it('keeps the beaten record and flips it out of current', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await detectFor([BARBELL]);
      await seedSession({ day: 2, sets: [{ weightKg: 105, reps: 5 }] });
      await detectFor([BARBELL]);

      const all = (await records()).filter((record) => record.prType === 'maxWeight');
      expect(all).toHaveLength(2);
      expect(all.filter((record) => record.isCurrent === 1)).toHaveLength(1);
      expect((await currentRecord('maxWeight'))?.previousValue).toBe(100);
    });

    it('never lets a dumbbell record displace a barbell one', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await seedSession({
        day: 2,
        variantKey: DUMBBELL,
        sets: [{ weightKg: 40, reps: 12 }],
      });
      await detectFor([BARBELL, DUMBBELL]);

      // Both stand, each in its own scope; neither knows about the other.
      expect((await currentRecord('maxWeight', BARBELL))?.value).toBe(100);
      expect((await currentRecord('maxWeight', DUMBBELL))?.value).toBe(40);
    });

    it('does not let a heavier dumbbell session erase the barbell record', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 60, reps: 5 }] });
      await detectFor([BARBELL]);
      await seedSession({
        day: 2,
        variantKey: DUMBBELL,
        sets: [{ weightKg: 100, reps: 5 }],
      });
      await detectFor([DUMBBELL]);

      expect((await currentRecord('maxWeight', BARBELL))?.value).toBe(60);
      expect((await currentRecord('maxWeight', DUMBBELL))?.value).toBe(100);
    });

    it('keeps rep records in separate weight buckets', async () => {
      await seedSession({
        day: 1,
        sets: [
          { weightKg: 100, reps: 5 },
          { weightKg: 20, reps: 12 },
        ],
      });
      await detectFor([BARBELL]);

      expect((await currentRecord('maxRepsAtWeight', BARBELL, 100))?.value).toBe(5);
      expect((await currentRecord('maxRepsAtWeight', BARBELL, 20))?.value).toBe(12);
    });

    it('marks an estimated record as an estimate and names its formula', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await detectFor([BARBELL]);

      const record = await currentRecord('estimated1RM');
      expect(record?.isEstimate).toBe(true);
      expect(record?.formula).toBe('epley');
      expect(record?.value).toBe(116.67);
    });

    it('holds no record for plain bodyweight work', async () => {
      await seedSession({
        day: 1,
        loadType: 'bodyweight',
        sets: [{ weightKg: null, reps: 20 }],
      });
      await detectFor([BARBELL]);

      expect(await currentRecord('maxWeight')).toBeUndefined();
    });

    it('scores weighted bodyweight work on the added weight', async () => {
      await seedSession({
        day: 1,
        loadType: 'bodyweight-plus',
        sets: [{ weightKg: null, extraWeightKg: 25, reps: 5 }],
      });
      await detectFor([BARBELL]);

      expect((await currentRecord('maxWeight'))?.value).toBe(25);
      // No estimated one-rep max: the number would have no referent.
      expect(await currentRecord('estimated1RM')).toBeUndefined();
    });

    it('points a record at the exact set that produced it', async () => {
      const seeded = await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await detectFor([BARBELL]);

      const record = await currentRecord('maxWeight');
      expect(record?.setLogId).toBe(seeded.setIds[0]);
      expect(record?.workoutId).toBe(seeded.workoutId);
    });
  });

  // ----------------------------------------------------------- rebuilding

  describe('rebuilding', () => {
    /** Content, with the generated ids stripped. */
    const shape = (list: readonly PersonalRecord[]) =>
      list.map((record) => ({
        variantKey: record.variantKey,
        prType: record.prType,
        repBucket: record.repBucket,
        value: record.value,
        previousValue: record.previousValue,
        achievedAt: record.achievedAt,
        setLogId: record.setLogId,
        isCurrent: record.isCurrent,
      }));

    it('reproduces the incrementally built table exactly', async () => {
      // Build it the way the app does: one session at a time.
      for (let day = 1; day <= 12; day += 1) {
        await seedSession({
          day,
          sets: [
            { weightKg: 90 + day, reps: 5 },
            { weightKg: 90 + day, reps: 4 + (day % 3) },
          ],
        });
        await detectFor([BARBELL]);
      }

      const incremental = await records();
      expect(incremental.length).toBeGreaterThan(5);

      await rebuildAll();
      const rebuilt = await records();

      expect(shape(rebuilt)).toEqual(shape(incremental));
      // Reconciled, not re-created: a record keeps its identity.
      expect(rebuilt.map((record) => record.id)).toEqual(incremental.map((record) => record.id));
    });

    it('is stable: rebuilding twice changes nothing', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await seedSession({ day: 2, sets: [{ weightKg: 110, reps: 3 }] });
      await rebuildAll();

      const once = await records();
      await rebuildAll();

      expect(shape(await records())).toEqual(shape(once));
      expect((await records()).map((r) => r.id)).toEqual(once.map((r) => r.id));
    });

    it('builds the same table over five thousand sets as it does incrementally', async () => {
      // 500 sessions of 10 sets, the shape of a few years of training.
      // Seeded in two bulk writes rather than 501 transactions: the subject
      // of the test is the rebuild, and seeding it a row at a time spends all
      // the budget before the rebuild starts.
      const iso = (session: number) =>
        new Date(Date.UTC(2024, 0, 1) + session * 86_400_000).toISOString();

      const slots = await TestBed.inject(WORKOUT_EXERCISES_REPO).putMany(
        Array.from({ length: 500 }, (_, session) => ({
          workoutId: `bulk-${session}`,
          exerciseId: 'bench',
          variantKey: BARBELL,
          nameSnapshot: 'Bench Press',
          routineExerciseUid: null,
          startedAt: iso(session),
          dayKey: iso(session).slice(0, 10),
          orderIndex: 1000,
          supersetGroup: null,
          supersetOrder: null,
          targetSnapshot: null,
          loadType: 'external' as const,
          laterality: 'bilateral' as const,
          restSec: 90,
          notes: null,
          isSkipped: false,
          completedSetCount: 10,
          volumeKg: 0,
        })) satisfies Draft<WorkoutExercise>[],
      );

      const drafts: Draft<SetLog>[] = [];
      for (const [session, slot] of slots.entries()) {
        for (let index = 0; index < 10; index += 1) {
          const weightKg = 60 + ((session * 7 + index * 3) % 60);
          const reps = 1 + ((session + index) % 12);
          drafts.push({
            workoutId: `bulk-${session}`,
            workoutExerciseId: slot.id,
            exerciseId: 'bench',
            variantKey: BARBELL,
            dayKey: iso(session).slice(0, 10),
            setIndex: index,
            setType: 'working',
            side: 'both',
            weightKg,
            extraWeightKg: null,
            reps,
            durationSec: null,
            distanceM: null,
            rpe: null,
            rir: null,
            isCompleted: true,
            isPr: false,
            completedAt: iso(session),
            restTakenSec: null,
            e1rmKg: null,
            volumeKg: weightKg * reps,
            notes: null,
          } satisfies Draft<SetLog>);
        }
      }
      const allSets = await TestBed.inject(SET_LOGS_REPO).putMany(drafts);

      await rebuildAll();
      const stored = shape(await records());
      expect(stored.length).toBeGreaterThan(20);

      // Compared against the pure function run directly over the same sets,
      // not against a second rebuild. Rebuilding twice only proves the engine
      // repeats itself; this proves what it persisted is what the rules say,
      // and it costs one pass over five thousand rows instead of two.
      const expected = buildRecords(
        drafts.map((draft, index) => ({
          id: (allSets[index] as SetLog).id,
          workoutId: draft.workoutId,
          completedAt: draft.completedAt,
          isCompleted: true,
          setType: 'working' as const,
          loadType: 'external' as const,
          weightKg: draft.weightKg,
          extraWeightKg: null,
          reps: draft.reps,
          volumeKg: draft.volumeKg,
        })),
        {
          exerciseId: 'bench',
          variantKey: BARBELL,
          nameSnapshot: 'Bench Press',
          formula: 'epley',
        },
      );

      expect(stored).toEqual(
        expected
          .map((achievement) => ({
            variantKey: BARBELL,
            prType: achievement.prType,
            repBucket: achievement.repBucket,
            value: achievement.value,
            previousValue: achievement.previousValue,
            achievedAt: achievement.achievedAt,
            setLogId: achievement.setLogId,
            isCurrent: achievement.isCurrent,
          }))
          .sort((a, b) =>
            `${a.variantKey}${a.prType}${a.repBucket}${a.achievedAt}`.localeCompare(
              `${b.variantKey}${b.prType}${b.repBucket}${b.achievedAt}`,
            ),
          ),
      );
      // Headroom over the measured time under coverage instrumentation, which
      // runs several times slower than an ordinary test run — about a minute
      // of the suite uninstrumented. The figure tracks the harness rather
      // than the engine, so it has had to move as the instrumented surface
      // grew; the standing fix is to run this one outside the coverage pass
      // rather than re-budget it every time the codebase does.
    }, 300_000);

    it('clears records a variant can no longer support', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await rebuildAll();
      expect((await records()).length).toBeGreaterThan(0);

      for (const set of await TestBed.inject(SET_LOGS_REPO).list()) {
        await TestBed.inject(SET_LOGS_REPO).remove(set.id, { hard: true });
      }
      await rebuildAll();

      expect(await records()).toEqual([]);
    });
  });

  // --------------------------------------------------- history edits

  describe('after history changes', () => {
    it('promotes the previous best when the record set is corrected down', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      const second = await seedSession({ day: 2, sets: [{ weightKg: 120, reps: 3 }] });
      await rebuildAll();
      expect((await currentRecord('maxWeight'))?.value).toBe(120);

      // The 120 was a typo; it was really 95.
      await history.updateSet(second.setIds[0] as string, { weightKg: 95, reps: 3 });

      const record = await currentRecord('maxWeight');
      expect(record?.value).toBe(100);
      expect(record?.previousValue).toBeNull();
    });

    it('removes the records a deleted workout held', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      const second = await seedSession({ day: 2, sets: [{ weightKg: 120, reps: 3 }] });
      await rebuildAll();

      await history.deleteWorkout(second.workoutId);

      expect((await currentRecord('maxWeight'))?.value).toBe(100);
      expect((await records()).some((record) => record.workoutId === second.workoutId)).toBe(false);
    });

    it('restores them with the workout', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      const second = await seedSession({ day: 2, sets: [{ weightKg: 120, reps: 3 }] });
      await rebuildAll();

      h.clock.tickMs = 1;
      await history.deleteWorkout(second.workoutId);
      await history.restoreWorkout(second.workoutId);

      const record = await currentRecord('maxWeight');
      expect(record?.value).toBe(120);
      expect(record?.previousValue).toBe(100);
    });

    it('leaves other variants alone when one is recomputed', async () => {
      await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await seedSession({
        day: 2,
        variantKey: DUMBBELL,
        sets: [{ weightKg: 40, reps: 10 }],
      });
      await rebuildAll();

      const dumbbellBefore = await currentRecord('maxWeight', DUMBBELL);
      await detectFor([BARBELL]);

      expect((await currentRecord('maxWeight', DUMBBELL))?.id).toBe(dumbbellBefore?.id);
    });

    it('ignores a set whose exercise slot is gone rather than guessing its load', async () => {
      const seeded = await seedSession({ day: 1, sets: [{ weightKg: 100, reps: 5 }] });
      await rebuildAll();
      expect(await currentRecord('maxWeight')).toBeDefined();

      for (const slot of await TestBed.inject(WORKOUT_EXERCISES_REPO).list()) {
        await TestBed.inject(WORKOUT_EXERCISES_REPO).remove(slot.id, { hard: true });
      }
      await rebuildAll();

      // Orphaned data holds no record; inventing `external` from the presence
      // of a weight would turn a data error into an achievement.
      expect(await currentRecord('maxWeight')).toBeUndefined();
      expect(seeded.setIds).toHaveLength(1);
    });
  });
});
