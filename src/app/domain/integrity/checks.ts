/**
 * What can be wrong with a database, stated as questions it can answer about
 * itself (DATABASE_SPEC section 12).
 *
 * Pure functions over rows the caller has already read. That shape is the
 * point: an integrity check that queried as it went would be hard to test
 * against the states it exists to find, and every one of these states is
 * rare enough that it will never occur to anyone to produce it by hand.
 *
 * Nothing here repairs anything. Each check returns a finding with a count and
 * an identifier; the screen lists them, the user opts in per item, and only
 * then does a repair run — with a pre-repair export offered first, because a
 * repair is a destructive action dressed as a helpful one.
 */

export type FindingKind =
  | 'stale-active-workout'
  | 'multiple-active-workouts'
  | 'orphan-set-logs'
  | 'orphan-workout-exercises'
  | 'stale-rollups'
  | 'orphan-blobs'
  | 'missing-blobs'
  | 'schema-mismatch';

export interface Finding {
  kind: FindingKind;
  /** How many records are affected. */
  count: number;
  /** Ids the repair would act on, for the ones where that is bounded. */
  ids: string[];
  /** Bytes a clean-up would reclaim, where that is meaningful. */
  reclaimableBytes?: number;
}

export interface IntegrityInput {
  workouts: readonly {
    id: string;
    status: string;
    startedAt: string;
    totalVolumeKg?: number | null;
    totalSets?: number | null;
  }[];
  workoutExercises: readonly { id: string; workoutId: string }[];
  setLogs: readonly {
    id: string;
    workoutId: string;
    workoutExerciseId: string;
    isCompleted: boolean;
    setType: string;
    volumeKg: number | null;
  }[];
  photos: readonly { id: string; fullBlobId: string; thumbBlobId: string }[];
  blobs: readonly { id: string; byteSize: number }[];
  schemaVersion: number;
  expectedSchemaVersion: number;
  /** Now, for the staleness window. */
  nowMs: number;
}

/** A session left running this long was forgotten, not paused. */
const STALE_ACTIVE_MS = 24 * 60 * 60 * 1000;

/** Rollups are cached sums; this is the tolerance before they count as wrong. */
const ROLLUP_TOLERANCE_KG = 0.5;

export function runChecks(input: IntegrityInput): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => {
    if (finding.count > 0) findings.push(finding);
  };

  const live = input.workouts.filter(
    (workout) => workout.status === 'active' || workout.status === 'paused',
  );

  const stale = live.filter(
    (workout) => input.nowMs - Date.parse(workout.startedAt) > STALE_ACTIVE_MS,
  );
  add({ kind: 'stale-active-workout', count: stale.length, ids: stale.map((w) => w.id) });

  if (live.length > 1) {
    // Only one session can be in progress; more than one means two tabs raced
    // or a crash left a pointer behind. The newest is the one the user was in.
    const sorted = [...live].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    add({
      kind: 'multiple-active-workouts',
      count: live.length - 1,
      ids: sorted.slice(1).map((workout) => workout.id),
    });
  }

  const exerciseIds = new Set(input.workoutExercises.map((exercise) => exercise.id));
  const orphanSets = input.setLogs.filter((set) => !exerciseIds.has(set.workoutExerciseId));
  add({ kind: 'orphan-set-logs', count: orphanSets.length, ids: orphanSets.map((s) => s.id) });

  const workoutIds = new Set(input.workouts.map((workout) => workout.id));
  const orphanExercises = input.workoutExercises.filter(
    (exercise) => !workoutIds.has(exercise.workoutId),
  );
  add({
    kind: 'orphan-workout-exercises',
    count: orphanExercises.length,
    ids: orphanExercises.map((exercise) => exercise.id),
  });

  add(checkRollups(input));
  for (const finding of blobFindings(input)) add(finding);

  if (input.schemaVersion !== input.expectedSchemaVersion) {
    // Not a count of records: it is one fact about the database, and the app
    // goes into safe mode rather than offering to "repair" a migration.
    findings.push({ kind: 'schema-mismatch', count: 1, ids: [] });
  }

  return findings;
}

/**
 * Cached session totals against a recomputation.
 *
 * Only completed working sets count toward volume, which is the same rule the
 * tracker writes with — so a disagreement means the cache went stale, not that
 * the two disagree about what a set is worth.
 */
function checkRollups(input: IntegrityInput): Finding {
  const byWorkout = new Map<string, number>();
  for (const set of input.setLogs) {
    if (!set.isCompleted) continue;
    if (set.setType !== 'working' && set.setType !== 'backoff') continue;
    byWorkout.set(set.workoutId, (byWorkout.get(set.workoutId) ?? 0) + (set.volumeKg ?? 0));
  }

  const wrong = input.workouts.filter((workout) => {
    if (workout.totalVolumeKg === undefined || workout.totalVolumeKg === null) return false;
    const recomputed = byWorkout.get(workout.id) ?? 0;
    return Math.abs(recomputed - workout.totalVolumeKg) > ROLLUP_TOLERANCE_KG;
  });

  return { kind: 'stale-rollups', count: wrong.length, ids: wrong.map((workout) => workout.id) };
}

/**
 * Pixels with no record, and records with no pixels.
 *
 * Two different problems with two different repairs: an orphan blob is storage
 * to reclaim, a missing blob is a photo that will render broken and whose
 * record should go. The bytes are reported for the first because "free 14 MB"
 * is the only reason anyone would say yes.
 */
function blobFindings(input: IntegrityInput): Finding[] {
  const referenced = new Set(
    input.photos.flatMap((photo) => [photo.fullBlobId, photo.thumbBlobId]),
  );
  const present = new Set(input.blobs.map((blob) => blob.id));

  const orphans = input.blobs.filter((blob) => !referenced.has(blob.id));
  const missing = input.photos.filter(
    (photo) => !present.has(photo.fullBlobId) || !present.has(photo.thumbBlobId),
  );

  return [
    {
      kind: 'orphan-blobs',
      count: orphans.length,
      ids: orphans.map((blob) => blob.id),
      reclaimableBytes: orphans.reduce((total, blob) => total + blob.byteSize, 0),
    },
    { kind: 'missing-blobs', count: missing.length, ids: missing.map((photo) => photo.id) },
  ];
}

/** True when nothing needs attention. */
export function isHealthy(findings: readonly Finding[]): boolean {
  return findings.length === 0;
}
