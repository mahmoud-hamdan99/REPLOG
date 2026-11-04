import { BACKUP_STORE_NAMES, type EntityStoreName } from '../models/stores';
import { FORMAT_NAME, FORMAT_VERSION, type Backup } from './envelope';

/**
 * Reading a file somebody may have edited, truncated or written by hand.
 *
 * The output is a **report, not a boolean** (DATABASE_SPEC section 9.2). A
 * backup is the last copy of a training history; refusing it outright because
 * one set log lost its parent would be throwing away years of data to avoid
 * importing a flawed row. So problems are sorted into two kinds:
 *
 *   - **blocking** — the file cannot be understood at all, or was written by a
 *     newer version of the app whose shape this one does not know.
 *   - **repairable** — something is wrong with a record, and the fix is
 *     stated: an unknown enum becomes its fallback, an orphan is dropped, a
 *     duplicate id resolves to the newer `updatedAt`.
 *
 * Nothing here mutates the input. The report says what *would* happen, the
 * user looks at it, and only then does anything get written.
 */

export type ProblemKind =
  | 'unparseable'
  | 'not-a-backup'
  | 'future-version'
  | 'missing-data'
  | 'bad-record'
  | 'orphan'
  | 'duplicate'
  | 'unknown-field'
  | 'hash-mismatch';

export interface Problem {
  kind: ProblemKind;
  blocking: boolean;
  /** Translation key for the sentence shown to the user. */
  messageKey: string;
  params?: Record<string, string | number>;
  /** Which store it was found in, where that is meaningful. */
  store?: EntityStoreName;
  count?: number;
}

export interface ValidationReport {
  /** Null when the file could not be understood far enough to read one. */
  backup: Backup | null;
  problems: Problem[];
  /** Records per store that would be imported, after repairs. */
  counts: Record<string, number>;
  photoCount: number;
  /** True when nothing blocking was found. */
  importable: boolean;
}

const blocking = (
  kind: ProblemKind,
  messageKey: string,
  params?: Record<string, string | number>,
): Problem => ({ kind, blocking: true, messageKey, ...(params === undefined ? {} : { params }) });

const repairable = (
  kind: ProblemKind,
  messageKey: string,
  extra: Partial<Problem> = {},
): Problem => ({ kind, blocking: false, messageKey, ...extra });

/**
 * Validates a parsed backup, or the text of one.
 *
 * Takes text rather than a parsed object because "this is not JSON" is the
 * most common failure and the only place that can be caught cleanly.
 */
export function validateBackup(text: string): ValidationReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty([blocking('unparseable', 'import.problem.unparseable')]);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty([blocking('not-a-backup', 'import.problem.notABackup')]);
  }

  const file = parsed as Record<string, unknown>;
  if (file['format'] !== FORMAT_NAME) {
    return empty([blocking('not-a-backup', 'import.problem.notABackup')]);
  }

  const formatVersion = typeof file['formatVersion'] === 'number' ? file['formatVersion'] : 0;
  if (formatVersion > FORMAT_VERSION) {
    // Refused rather than attempted: a newer file may carry fields whose
    // meaning this version would guess at, and guessing at someone's training
    // history is worse than telling them to update.
    return empty([
      blocking('future-version', 'import.problem.futureVersion', {
        found: formatVersion,
        supported: FORMAT_VERSION,
      }),
    ]);
  }

  const data = file['data'];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return empty([blocking('missing-data', 'import.problem.missingData')]);
  }

  const problems: Problem[] = [];
  const counts: Record<string, number> = {};
  const records = data as Record<string, unknown>;

  for (const store of BACKUP_STORE_NAMES) {
    const rows = records[store];
    if (rows === undefined) {
      counts[store] = 0;
      continue;
    }

    if (!Array.isArray(rows)) {
      problems.push(repairable('bad-record', 'import.problem.notAList', { store, count: 0 }));
      counts[store] = 0;
      continue;
    }

    const kept = checkStore(store, rows, problems);
    counts[store] = kept;
  }

  const unknownStores = Object.keys(records).filter(
    (name) => !BACKUP_STORE_NAMES.includes(name as EntityStoreName),
  );
  if (unknownStores.length > 0) {
    // Not an error: a newer file carrying a store this version does not know
    // is readable, and saying so is more useful than silence.
    problems.push(
      repairable('unknown-field', 'import.problem.unknownStores', {
        count: unknownStores.length,
      }),
    );
  }

  const photoBlobs = Array.isArray(file['photoBlobs']) ? file['photoBlobs'] : [];

  return {
    backup: file as unknown as Backup,
    problems,
    counts,
    photoCount: photoBlobs.length,
    importable: !problems.some((problem) => problem.blocking),
  };
}

/**
 * Checks one store's rows, counting what survives.
 *
 * Every record needs an id and the envelope the repository stamps; a row
 * without them is not a record this app wrote, and importing it would create
 * something no other code could read back.
 */
function checkStore(store: EntityStoreName, rows: unknown[], problems: Problem[]): number {
  let malformed = 0;
  const seen = new Set<string>();
  let duplicates = 0;

  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      malformed++;
      continue;
    }

    const record = row as Record<string, unknown>;
    if (typeof record['id'] !== 'string' || record['id'] === '') {
      malformed++;
      continue;
    }
    if (typeof record['updatedAt'] !== 'string') {
      malformed++;
      continue;
    }

    if (seen.has(record['id'])) duplicates++;
    else seen.add(record['id']);
  }

  if (malformed > 0) {
    problems.push(
      repairable('bad-record', 'import.problem.malformed', { store, count: malformed }),
    );
  }
  if (duplicates > 0) {
    // Resolved rather than refused: the newest `updatedAt` wins, which is the
    // same rule the merge uses, so the outcome is predictable either way.
    problems.push(
      repairable('duplicate', 'import.problem.duplicates', { store, count: duplicates }),
    );
  }

  return seen.size;
}

/**
 * Referential checks across stores, run after each store is individually sane.
 *
 * Separate from `checkStore` because an orphan is a relationship problem, not
 * a record problem: the set log itself is perfectly well formed, it just
 * points at an exercise slot that is not in the file.
 */
export function checkReferences(data: Record<string, unknown[]>): Problem[] {
  const problems: Problem[] = [];
  const idsOf = (store: EntityStoreName) =>
    new Set((data[store] ?? []).map((row) => (row as { id?: string }).id ?? ''));

  const links: { store: EntityStoreName; field: string; parent: EntityStoreName }[] = [
    { store: 'setLogs', field: 'workoutExerciseId', parent: 'workoutExercises' },
    { store: 'workoutExercises', field: 'workoutId', parent: 'workouts' },
    { store: 'routines', field: 'planId', parent: 'plans' },
  ];

  for (const link of links) {
    const parents = idsOf(link.parent);
    const orphans = (data[link.store] ?? []).filter((row) => {
      const value = (row as Record<string, unknown>)[link.field];
      return typeof value === 'string' && !parents.has(value);
    }).length;

    if (orphans > 0) {
      problems.push(
        repairable('orphan', 'import.problem.orphans', { store: link.store, count: orphans }),
      );
    }
  }

  return problems;
}

/** The report for a file that never got as far as having records. */
function empty(problems: Problem[]): ValidationReport {
  return { backup: null, problems, counts: {}, photoCount: 0, importable: false };
}
