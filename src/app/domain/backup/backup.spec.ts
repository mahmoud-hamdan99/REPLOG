import { canonicalize, integrityPayload } from './canonical';
import { FORMAT_NAME, FORMAT_VERSION, backupFileName, projectedBytes } from './envelope';
import { CHUNK_SIZE, chunk, planMerge, resolve } from './merge';
import { checkReferences, validateBackup } from './validate';

/**
 * The backup rules, which are the ones with the least room for error.
 *
 * A bug in a chart draws something wrong and somebody notices. A bug here
 * silently loses training history, or silently refuses to give it back, and
 * the moment anyone finds out is the moment they needed it.
 */

/** A minimal well-formed file, with whatever a test wants to change. */
function file(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    schemaVersion: 1,
    appVersion: '1.0.0',
    exportedAt: '2026-11-04T09:00:00.000Z',
    deviceId: 'device-1',
    options: { includePhotos: false, includeDeleted: false },
    counts: {},
    integrity: { algorithm: 'sha-256', value: 'abc' },
    prefs: {},
    data: { workouts: [], setLogs: [] },
    photoBlobs: [],
    ...over,
  });
}

const row = (id: string, updatedAt = '2026-11-01T00:00:00.000Z') => ({ id, updatedAt });

describe('canonical serialisation', () => {
  it('sorts keys, so the same data always hashes the same', () => {
    // JSON.stringify follows insertion order, which is a property of how the
    // object was built rather than of what it contains: a patched record and
    // an inserted one would hash differently.
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe(canonicalize({ b: 1, a: 2 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalize({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('keeps array order, which is the order records are restored in', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no whitespace', () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('treats undefined the way JSON.stringify does, so the hash matches the file', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('writes the values JSON has no syntax for as null, as the file will', () => {
    expect(canonicalize({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).toBe(
      '{"a":null,"b":null}',
    );
  });

  it('refuses a BigInt rather than inventing a representation', () => {
    expect(() => canonicalize({ a: 1n })).toThrow(TypeError);
  });

  it('hashes only the data, never the envelope that carries the hash', () => {
    const payload = integrityPayload({ data: { workouts: [] }, photoBlobs: [] });

    expect(payload).toBe('{"data":{"workouts":[]},"photoBlobs":[]}');
    // Two exports of identical data taken at different moments must agree.
    expect(payload).not.toContain('exportedAt');
  });
});

describe('the envelope', () => {
  it('names a file so a folder of them sorts by date', () => {
    expect(backupFileName(new Date(2026, 10, 4, 9, 5))).toBe('replog-backup-2026-11-04-0905.json');
  });

  it('projects a bigger file when photos are included', () => {
    const without = projectedBytes({
      recordCount: 5000,
      photoBytes: 12_000_000,
      includePhotos: false,
    });
    const withPhotos = projectedBytes({
      recordCount: 5000,
      photoBytes: 12_000_000,
      includePhotos: true,
    });

    // Base64 inflates by a third, which is the number the sheet has to show
    // before a phone spends a minute building the file.
    expect(withPhotos).toBeGreaterThan(without + 12_000_000);
  });
});

describe('validating a file', () => {
  it('accepts a well-formed backup', () => {
    const report = validateBackup(file());

    expect(report.importable).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('reports unparseable text rather than throwing', () => {
    const report = validateBackup('{ not json');

    expect(report.importable).toBe(false);
    expect(report.problems[0]).toMatchObject({ kind: 'unparseable', blocking: true });
  });

  it('refuses something that is not a backup at all', () => {
    expect(validateBackup('{"hello":"world"}').problems[0]?.kind).toBe('not-a-backup');
    expect(validateBackup('[]').problems[0]?.kind).toBe('not-a-backup');
  });

  it('refuses a file from a newer version rather than guessing at it', () => {
    // A newer file may carry fields whose meaning this version would guess at,
    // and guessing at somebody's training history is worse than saying no.
    const report = validateBackup(file({ formatVersion: FORMAT_VERSION + 1 }));

    expect(report.problems[0]).toMatchObject({ kind: 'future-version', blocking: true });
    expect(report.importable).toBe(false);
  });

  it('accepts a file from an older version, which the migrations handle', () => {
    expect(validateBackup(file({ formatVersion: 0 })).importable).toBe(true);
  });

  it('refuses a file with no data block', () => {
    expect(validateBackup(file({ data: undefined })).problems[0]?.kind).toBe('missing-data');
    expect(validateBackup(file({ data: 'nope' })).problems[0]?.kind).toBe('missing-data');
  });

  it('counts the records it would import', () => {
    const report = validateBackup(
      file({ data: { workouts: [row('a'), row('b')], setLogs: [row('c')] } }),
    );

    expect(report.counts['workouts']).toBe(2);
    expect(report.counts['setLogs']).toBe(1);
  });

  it('drops a malformed record and says how many, rather than refusing the file', () => {
    // A backup is the last copy of a training history. Throwing away years of
    // data because one row lost its id is the wrong trade.
    const report = validateBackup(
      file({ data: { workouts: [row('a'), { noId: true }, null, 'text'] } }),
    );

    expect(report.importable).toBe(true);
    expect(report.problems).toContainEqual(
      expect.objectContaining({ kind: 'bad-record', count: 3, blocking: false }),
    );
    expect(report.counts['workouts']).toBe(1);
  });

  it('counts a duplicate id, which the merge rule then resolves', () => {
    const report = validateBackup(file({ data: { workouts: [row('a'), row('a')] } }));

    expect(report.problems).toContainEqual(
      expect.objectContaining({ kind: 'duplicate', count: 1 }),
    );
    expect(report.counts['workouts']).toBe(1);
  });

  it('mentions a store it does not know without treating it as an error', () => {
    const report = validateBackup(file({ data: { workouts: [], somethingNew: [] } }));

    expect(report.importable).toBe(true);
    expect(report.problems).toContainEqual(
      expect.objectContaining({ kind: 'unknown-field', blocking: false }),
    );
  });

  it('finds records whose parent is not in the file', () => {
    const problems = checkReferences({
      workouts: [row('w1')],
      workoutExercises: [
        { ...row('we1'), workoutId: 'w1' },
        { ...row('we2'), workoutId: 'gone' },
      ],
      setLogs: [{ ...row('s1'), workoutExerciseId: 'nope' }],
      plans: [],
      routines: [{ ...row('r1'), planId: 'missing' }],
    });

    expect(problems.map((problem) => problem.store)).toEqual([
      'setLogs',
      'workoutExercises',
      'routines',
    ]);
    expect(problems.every((problem) => !problem.blocking)).toBe(true);
  });

  it('finds no reference problems in a consistent file', () => {
    expect(
      checkReferences({
        workouts: [row('w1')],
        workoutExercises: [{ ...row('we1'), workoutId: 'w1' }],
        setLogs: [{ ...row('s1'), workoutExerciseId: 'we1' }],
      }),
    ).toEqual([]);
  });
});

describe('merge rules', () => {
  it('takes the incoming record when it is newer', () => {
    expect(
      resolve(row('a', '2026-01-01T00:00:00.000Z'), row('a', '2026-06-01T00:00:00.000Z')),
    ).toBe('incoming');
  });

  it('keeps the local record when it is newer', () => {
    expect(
      resolve(row('a', '2026-06-01T00:00:00.000Z'), row('a', '2026-01-01T00:00:00.000Z')),
    ).toBe('local');
  });

  it('leaves an identical record alone, so importing your own backup is a no-op', () => {
    // The first thing anyone does is export and re-import to check it works.
    // Rewriting every row would bump each rev and make that look like a change.
    expect(resolve(row('a'), row('a'))).toBe('unchanged');
  });

  it('takes a record the database does not have', () => {
    expect(resolve(undefined, row('a'))).toBe('incoming');
  });

  it('never deletes a local record the file does not mention', () => {
    // A file is a snapshot of one moment. Treating its absences as deletions
    // would make importing an old backup destroy everything logged since.
    const plan = planMerge([row('local-only'), row('shared')], [row('shared')]);

    expect(plan.write).toEqual([]);
    expect(plan.kept).toBe(1);
  });

  it('counts what it would add and what it would update', () => {
    const plan = planMerge(
      [row('old', '2026-01-01T00:00:00.000Z')],
      [row('old', '2026-06-01T00:00:00.000Z'), row('new')],
    );

    expect(plan.added).toBe(1);
    expect(plan.updated).toBe(1);
    expect(plan.write).toHaveLength(2);
  });

  it('resolves a file carrying the same id twice to the newer copy', () => {
    const plan = planMerge(
      [],
      [row('a', '2026-01-01T00:00:00.000Z'), row('a', '2026-06-01T00:00:00.000Z')],
    );

    expect(plan.write).toHaveLength(1);
    expect(plan.write[0]?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('chunks rows without losing or reordering any', () => {
    const rows = Array.from({ length: 1201 }, (_, index) => index);
    const chunks = chunk(rows);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(201);
    expect(chunks.flat()).toEqual(rows);
  });

  it('chunks an empty list into nothing', () => {
    expect(chunk([])).toEqual([]);
  });
});
