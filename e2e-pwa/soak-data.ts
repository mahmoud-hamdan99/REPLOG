import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import catalog from '../src/app/features/exercises/data/exercises.v1.json' with { type: 'json' };
import { integrityPayload } from '../src/app/domain/backup/canonical';
import { DEFAULT_PREFS } from '../src/app/domain/models/prefs';

/**
 * Two years of synthetic training history, as a backup file.
 *
 * IMPLEMENTATION_PLAN §17 task 3 asks for a soak dataset — ≈400 workouts,
 * 10 000 set logs, 150 measurements, 60 photos — exercising every screen. It
 * is built as a *backup file* and loaded through the app's own import, rather
 * than written into IndexedDB from the test, for two reasons:
 *
 *   - The app's validator then checks this generator. A record shaped wrongly
 *     shows up as a problem on the import screen, naming the store, instead of
 *     as a mystery further down.
 *   - Importing 10 000 records and rebuilding every personal record from them
 *     is itself one of the heaviest operations the app has. Getting the soak
 *     dataset in is part of the soak.
 *
 * `exercises` is deliberately absent: the app seeds its own catalog, and the
 * dataset references those ids, so the history points at the real library
 * rather than at 168 records this file invented.
 */

/** Weeks of history, and the weekdays trained in each. 100 × 4 = 400 sessions. */
const WEEKS = 100;
const TRAINING_DAYS = [1, 2, 4, 5] as const;

/** Six exercises per session, 25 sets per session → exactly 10 000 set logs. */
const SETS_PER_EXERCISE = [5, 4, 4, 4, 4, 4] as const;

const MEASUREMENTS = 150;
const MEASUREMENT_EVERY_DAYS = 4;
const PHOTOS = 60;
const PHOTO_EVERY_DAYS = 11;

const DEVICE = 'soak-fixture';

interface CatalogEntry {
  id: string;
  nameEn: string;
  equipment: string;
  laterality: string;
  loadType: string;
  defaultRestSec: number;
}

/**
 * The exercises the history is built from, taken from the real catalog.
 *
 * Chosen by property rather than by id: a hardcoded id that was renamed in the
 * catalog would make this dataset reference nothing, and the symptom would be
 * a blank screen rather than a failure that says so. Spread across the list so
 * the muscle rollups in the analytics screens have something to divide.
 */
function pickExercises(): CatalogEntry[] {
  const all = (catalog as { exercises: CatalogEntry[] }).exercises;
  const external = all.filter((entry) => entry.loadType === 'external');
  if (external.length < SETS_PER_EXERCISE.length) {
    throw new Error(`soak-data: the catalog has only ${external.length} loadable exercises`);
  }

  const stride = Math.floor(external.length / SETS_PER_EXERCISE.length);
  return SETS_PER_EXERCISE.map((_, index) => {
    const entry = external[index * stride];
    if (entry === undefined) throw new Error(`soak-data: no exercise at ${index * stride}`);
    return entry;
  });
}

const variantKey = (entry: CatalogEntry) => `${entry.id}|${entry.equipment}|${entry.laterality}`;

/** Local calendar day, which is what `dayKey` means. */
function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The envelope the repository would have stamped. */
function envelope(id: string, at: string) {
  return { id, createdAt: at, updatedAt: at, deletedAt: null, rev: 1, origin: DEVICE };
}

const pad = (value: number, width = 4) => String(value).padStart(width, '0');

/**
 * A deterministic pseudo-random sequence.
 *
 * Seeded rather than `Math.random`, so a run that finds something slow can be
 * re-run on the same data. Mulberry32: short, and good enough for load.
 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny solid-colour PNG, so the gallery has real pixels to decode. */
function png(size: number, rgb: [number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface SoakDataset {
  /** The file's text, ready to hand to the import picker. */
  text: string;
  /** What it should restore, for the test to assert against. */
  counts: {
    workouts: number;
    workoutExercises: number;
    setLogs: number;
    measurements: number;
    photos: number;
  };
  /** The first exercise's name, which several screens should end up showing. */
  leadExerciseName: string;
  bytes: number;
}

/** Builds the dataset, ending `endingDaysAgo` days before `now`. */
export function buildSoakDataset(now = new Date()): SoakDataset {
  const exercises = pickExercises();
  const dice = random(20_261_104);

  const workouts: unknown[] = [];
  const workoutExercises: unknown[] = [];
  const setLogs: unknown[] = [];
  const measurements: unknown[] = [];
  const photos: unknown[] = [];
  const photoBlobs: { id: string; mimeType: string; bytes: number; dataBase64: string }[] = [];

  // Oldest first, so ids sort the way uuidv7 ids would.
  const firstMonday = new Date(now);
  firstMonday.setHours(18, 0, 0, 0);
  firstMonday.setDate(firstMonday.getDate() - WEEKS * 7);

  let workoutNumber = 0;
  for (let week = 0; week < WEEKS; week++) {
    for (const weekday of TRAINING_DAYS) {
      const started = new Date(firstMonday);
      started.setDate(firstMonday.getDate() + week * 7 + weekday - 1);

      const workoutId = `soak-w-${pad(workoutNumber)}`;
      const startedAt = started.toISOString();
      const key = dayKey(started);

      // Progressive overload across the two years: about 30 % more load at the
      // end than at the start, so the charts have a trend to draw and the
      // record engine has a reason to fire repeatedly.
      const progress = 1 + (week / WEEKS) * 0.3;

      let volume = 0;
      let sets = 0;
      let reps = 0;

      exercises.forEach((exercise, slot) => {
        const weId = `${workoutId}-e${slot}`;
        let exerciseVolume = 0;
        let completed = 0;

        const setCount = SETS_PER_EXERCISE[slot] ?? 0;
        for (let setIndex = 0; setIndex < setCount; setIndex++) {
          const base = 40 + slot * 15;
          const weightKg = Math.round(base * progress * (0.9 + dice() * 0.1) * 2) / 2;
          const setReps = 5 + Math.floor(dice() * 6);
          const setVolume = weightKg * setReps;
          const completedAt = new Date(started.getTime() + (slot * 10 + setIndex * 2) * 60_000);

          setLogs.push({
            ...envelope(`${weId}-s${setIndex}`, completedAt.toISOString()),
            workoutId,
            workoutExerciseId: weId,
            exerciseId: exercise.id,
            variantKey: variantKey(exercise),
            dayKey: key,
            setIndex,
            setType: setIndex === 0 ? 'warmup' : 'working',
            side: 'both',
            weightKg,
            extraWeightKg: null,
            reps: setReps,
            durationSec: null,
            distanceM: null,
            rpe: null,
            rir: null,
            isCompleted: true,
            isPr: false,
            completedAt: completedAt.toISOString(),
            restTakenSec: 90,
            e1rmKg: Math.round(weightKg * (1 + setReps / 30) * 10) / 10,
            // Warm-ups carry no volume, the same rule the tracker applies.
            volumeKg: setIndex === 0 ? null : setVolume,
            notes: null,
          });

          if (setIndex > 0) {
            exerciseVolume += setVolume;
            reps += setReps;
            sets++;
          }
          completed++;
        }

        workoutExercises.push({
          ...envelope(weId, startedAt),
          workoutId,
          exerciseId: exercise.id,
          variantKey: variantKey(exercise),
          nameSnapshot: exercise.nameEn,
          routineExerciseUid: null,
          startedAt,
          dayKey: key,
          orderIndex: (slot + 1) * 1000,
          supersetGroup: null,
          supersetOrder: null,
          targetSnapshot: null,
          loadType: exercise.loadType,
          laterality: exercise.laterality,
          restSec: exercise.defaultRestSec,
          notes: null,
          isSkipped: false,
          completedSetCount: completed,
          volumeKg: exerciseVolume,
        });

        volume += exerciseVolume;
      });

      const finished = new Date(started.getTime() + 68 * 60_000);
      workouts.push({
        ...envelope(workoutId, startedAt),
        status: 'completed',
        startedAt,
        finishedAt: finished.toISOString(),
        dayKey: key,
        name: ['Push', 'Pull', 'Legs', 'Upper'][weekday % 4],
        planId: null,
        routineId: null,
        planSnapshot: null,
        source: 'quick',
        pauses: [],
        durationSec: 68 * 60,
        totalVolumeKg: volume,
        totalSets: sets,
        totalReps: reps,
        exerciseCount: exercises.length,
        bodyWeightKg: 82,
        notes: null,
        perceivedEffort: null,
        feeling: null,
        prCount: 0,
        trackingMode: 'simple',
        tabId: null,
        heartbeatAt: null,
        discardedReason: null,
        editedAt: null,
      });

      workoutNumber++;
    }
  }

  // Body weight drifting down over the window, with day-to-day noise, so the
  // body charts have a real trend and a real spread rather than a straight
  // line nothing could be read from.
  for (let index = 0; index < MEASUREMENTS; index++) {
    const at = new Date(now);
    at.setHours(7, 30, 0, 0);
    at.setDate(at.getDate() - (MEASUREMENTS - index) * MEASUREMENT_EVERY_DAYS);
    const iso = at.toISOString();

    measurements.push({
      ...envelope(`soak-m-${pad(index)}`, iso),
      measuredAt: dayKey(at),
      recordedAt: iso,
      weightKg: Math.round((88 - (index / MEASUREMENTS) * 6 + (dice() - 0.5)) * 10) / 10,
      hasWeight: 1,
      bodyFatPct: index % 5 === 0 ? Math.round((22 - (index / MEASUREMENTS) * 4) * 10) / 10 : null,
      heightCm: null,
      neckCm: null,
      shouldersCm: null,
      chestCm: index % 10 === 0 ? 104 : null,
      waistCm: index % 3 === 0 ? Math.round((88 - (index / MEASUREMENTS) * 5) * 10) / 10 : null,
      hipsCm: null,
      bicepsLeftCm: null,
      bicepsRightCm: index % 10 === 0 ? 36 : null,
      forearmLeftCm: null,
      forearmRightCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfLeftCm: null,
      calfRightCm: null,
      custom: {},
      notes: null,
      source: 'manual',
    });
  }

  const POSES = ['front', 'side-left', 'back'] as const;
  for (let index = 0; index < PHOTOS; index++) {
    const at = new Date(now);
    at.setHours(7, 0, 0, 0);
    at.setDate(at.getDate() - (PHOTOS - index) * PHOTO_EVERY_DAYS);
    const iso = at.toISOString();

    // Each photo a slightly different colour, so the gallery and the compare
    // view are visibly showing different images rather than one cached one.
    const shade: [number, number, number] = [60 + index * 3, 80, 200 - index * 2];
    const full = png(64, shade);
    const thumb = png(16, shade);
    const fullId = `soak-b-${pad(index)}-full`;
    const thumbId = `soak-b-${pad(index)}-thumb`;

    photoBlobs.push(
      {
        id: fullId,
        mimeType: 'image/png',
        bytes: full.length,
        dataBase64: full.toString('base64'),
      },
      {
        id: thumbId,
        mimeType: 'image/png',
        bytes: thumb.length,
        dataBase64: thumb.toString('base64'),
      },
    );

    photos.push({
      ...envelope(`soak-p-${pad(index)}`, iso),
      takenAt: dayKey(at),
      recordedAt: iso,
      pose: POSES[index % POSES.length],
      fullBlobId: fullId,
      thumbBlobId: thumbId,
      width: 64,
      height: 64,
      byteSize: full.length,
      mimeType: 'image/png',
      weightKg: 88 - (index / PHOTOS) * 6,
      measurementId: null,
      notes: null,
      isFavorite: index % 20 === 0,
    });
  }

  const data: Record<string, unknown[]> = {
    workouts,
    workoutExercises,
    setLogs,
    measurements,
    photos,
  };

  const counts = Object.fromEntries(
    Object.entries(data).map(([store, rows]) => [store, rows.length]),
  );

  const backup = {
    format: 'replog-backup',
    formatVersion: 1,
    schemaVersion: 1,
    appVersion: 'soak',
    exportedAt: now.toISOString(),
    deviceId: DEVICE,
    options: { includePhotos: true, includeDeleted: false },
    counts,
    integrity: {
      algorithm: 'sha-256',
      value: createHash('sha256').update(integrityPayload({ data, photoBlobs })).digest('hex'),
    },
    // English and metric, because the measurements the test makes are read off
    // the screen and a language switch mid-import would change them.
    prefs: { ...DEFAULT_PREFS, theme: 'dark' },
    data,
    photoBlobs,
  };

  const text = JSON.stringify(backup);

  return {
    text,
    counts: {
      workouts: workouts.length,
      workoutExercises: workoutExercises.length,
      setLogs: setLogs.length,
      measurements: measurements.length,
      photos: photos.length,
    },
    leadExerciseName: exercises[0]?.nameEn ?? '',
    bytes: Buffer.byteLength(text),
  };
}
