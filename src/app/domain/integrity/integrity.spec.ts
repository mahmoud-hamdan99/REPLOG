import { isHealthy, runChecks, type IntegrityInput } from './checks';

/**
 * The states a database should never be in.
 *
 * Every one of these is rare enough that nobody will ever produce it by hand
 * while clicking around, which is exactly why they are worth constructing
 * here: a check that has only ever been run against a healthy database has
 * not been run.
 */

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const HOURS = 60 * 60 * 1000;

function input(over: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    workouts: [],
    workoutExercises: [],
    setLogs: [],
    photos: [],
    blobs: [],
    schemaVersion: 1,
    expectedSchemaVersion: 1,
    nowMs: NOW,
    ...over,
  };
}

const workout = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'completed',
  startedAt: new Date(NOW - 2 * HOURS).toISOString(),
  totalVolumeKg: null,
  totalSets: null,
  ...over,
});

const set = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workoutId: 'w1',
  workoutExerciseId: 'we1',
  isCompleted: true,
  setType: 'working',
  volumeKg: 100,
  ...over,
});

const find = (findings: ReturnType<typeof runChecks>, kind: string) =>
  findings.find((finding) => finding.kind === kind);

describe('integrity checks', () => {
  it('says nothing about a healthy database', () => {
    const findings = runChecks(
      input({
        workouts: [workout('w1', { totalVolumeKg: 300 })],
        workoutExercises: [{ id: 'we1', workoutId: 'w1' }],
        setLogs: [set('s1'), set('s2'), set('s3')],
      }),
    );

    expect(findings).toEqual([]);
    expect(isHealthy(findings)).toBe(true);
  });

  it('finds a session left running overnight', () => {
    // Paused for a day is not paused; it is forgotten, and it keeps the
    // tracker claiming a workout is in progress.
    const findings = runChecks(
      input({
        workouts: [
          workout('old', { status: 'active', startedAt: new Date(NOW - 30 * HOURS).toISOString() }),
        ],
      }),
    );

    expect(find(findings, 'stale-active-workout')).toMatchObject({ count: 1, ids: ['old'] });
  });

  it('leaves a session started an hour ago alone', () => {
    const findings = runChecks(
      input({
        workouts: [
          workout('now', { status: 'active', startedAt: new Date(NOW - HOURS).toISOString() }),
        ],
      }),
    );

    expect(find(findings, 'stale-active-workout')).toBeUndefined();
  });

  it('keeps the newest when two sessions are live', () => {
    // Two tabs raced, or a crash left a pointer behind. The one the user was
    // actually in is the newer.
    const findings = runChecks(
      input({
        workouts: [
          workout('older', { status: 'active', startedAt: '2026-11-04T08:00:00.000Z' }),
          workout('newer', { status: 'paused', startedAt: '2026-11-04T11:00:00.000Z' }),
        ],
      }),
    );

    expect(find(findings, 'multiple-active-workouts')).toMatchObject({
      count: 1,
      ids: ['older'],
    });
  });

  it('finds set logs whose exercise slot is gone', () => {
    const findings = runChecks(
      input({
        workouts: [workout('w1')],
        workoutExercises: [{ id: 'we1', workoutId: 'w1' }],
        setLogs: [set('s1'), set('s2', { workoutExerciseId: 'missing' })],
      }),
    );

    expect(find(findings, 'orphan-set-logs')).toMatchObject({ count: 1, ids: ['s2'] });
  });

  it('finds exercise slots whose workout is gone', () => {
    const findings = runChecks(
      input({
        workouts: [workout('w1')],
        workoutExercises: [
          { id: 'we1', workoutId: 'w1' },
          { id: 'we2', workoutId: 'vanished' },
        ],
      }),
    );

    expect(find(findings, 'orphan-workout-exercises')).toMatchObject({ count: 1, ids: ['we2'] });
  });

  it('finds a cached total that no longer matches its sets', () => {
    const findings = runChecks(
      input({
        workouts: [workout('w1', { totalVolumeKg: 999 })],
        workoutExercises: [{ id: 'we1', workoutId: 'w1' }],
        setLogs: [set('s1')],
      }),
    );

    expect(find(findings, 'stale-rollups')).toMatchObject({ count: 1, ids: ['w1'] });
  });

  it('counts a rollup the same way the tracker wrote it', () => {
    // Warm-ups and unconfirmed sets are excluded on the way in, so excluding
    // them here is what makes a match mean the cache is correct.
    const findings = runChecks(
      input({
        workouts: [workout('w1', { totalVolumeKg: 100 })],
        workoutExercises: [{ id: 'we1', workoutId: 'w1' }],
        setLogs: [set('s1'), set('s2', { setType: 'warmup' }), set('s3', { isCompleted: false })],
      }),
    );

    expect(find(findings, 'stale-rollups')).toBeUndefined();
  });

  it('ignores a workout that caches no total', () => {
    const findings = runChecks(
      input({ workouts: [workout('w1')], setLogs: [set('s1', { workoutExerciseId: 'we1' })] }),
    );

    expect(find(findings, 'stale-rollups')).toBeUndefined();
  });

  it('reports pixels nothing points at, with the bytes they would free', () => {
    // "Free 14 MB" is the only reason anyone says yes to a clean-up.
    const findings = runChecks(
      input({
        photos: [{ id: 'p1', fullBlobId: 'full-1', thumbBlobId: 'thumb-1' }],
        blobs: [
          { id: 'full-1', byteSize: 200_000 },
          { id: 'thumb-1', byteSize: 20_000 },
          { id: 'stray', byteSize: 180_000 },
        ],
      }),
    );

    expect(find(findings, 'orphan-blobs')).toMatchObject({
      count: 1,
      ids: ['stray'],
      reclaimableBytes: 180_000,
    });
  });

  it('reports a photo whose pixels are missing', () => {
    const findings = runChecks(
      input({
        photos: [{ id: 'p1', fullBlobId: 'gone', thumbBlobId: 'thumb-1' }],
        blobs: [{ id: 'thumb-1', byteSize: 20_000 }],
      }),
    );

    expect(find(findings, 'missing-blobs')).toMatchObject({ count: 1, ids: ['p1'] });
  });

  it('reports a schema version that does not match the code', () => {
    // Not a repair: the app goes into safe mode rather than offering to fix a
    // migration it has already failed to run.
    const findings = runChecks(input({ schemaVersion: 2, expectedSchemaVersion: 1 }));

    expect(find(findings, 'schema-mismatch')).toMatchObject({ count: 1 });
  });

  it('reports several problems at once rather than stopping at the first', () => {
    const findings = runChecks(
      input({
        workouts: [workout('w1', { status: 'active', startedAt: '2026-11-01T00:00:00.000Z' })],
        setLogs: [set('s1', { workoutExerciseId: 'missing' })],
        schemaVersion: 7,
      }),
    );

    expect(findings.map((finding) => finding.kind).sort()).toEqual([
      'orphan-set-logs',
      'schema-mismatch',
      'stale-active-workout',
    ]);
  });
});
