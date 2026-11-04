/**
 * Deciding which copy of a record wins.
 *
 * The rule from DATABASE_SPEC section 9.2, and the reason it is written down
 * rather than left to the import loop: **last write wins on `updatedAt`, and a
 * tie goes to the record already here.**
 *
 * The tie-break is the part that matters. Two records with the same
 * `updatedAt` are almost always the same record — the file was exported from
 * this device — and preferring the incoming copy would rewrite the local row
 * for no gain, bumping its `rev` and making a no-op import look like a change.
 * Preferring the local copy makes importing your own backup a genuine no-op,
 * which is what someone checking that their backup works will do first.
 */

export interface Mergeable {
  id: string;
  updatedAt: string;
}

export type MergeMode = 'merge' | 'replace';

export type Resolution = 'incoming' | 'local' | 'unchanged';

/** Which copy of one record should end up in the database. */
export function resolve(local: Mergeable | undefined, incoming: Mergeable): Resolution {
  if (local === undefined) return 'incoming';
  if (incoming.updatedAt > local.updatedAt) return 'incoming';
  // Equal or older: the local record stands. Returning 'unchanged' rather than
  // 'local' lets the caller skip the write entirely.
  return incoming.updatedAt === local.updatedAt ? 'unchanged' : 'local';
}

export interface MergePlan<T extends Mergeable> {
  /** Records to write: new ones and ones the file has a newer copy of. */
  write: T[];
  /** Records the file also has, but older or identical. Left alone. */
  kept: number;
  added: number;
  updated: number;
}

/**
 * What a merge would do, computed before anything is written.
 *
 * A merge **never deletes**. A record present locally and absent from the file
 * stays: the file is a snapshot of one moment, and treating its absences as
 * deletions would make importing an old backup destroy everything logged
 * since. Replace mode exists for the other intent, behind a typed
 * confirmation.
 */
export function planMerge<T extends Mergeable>(
  localRows: readonly T[],
  incomingRows: readonly T[],
): MergePlan<T> {
  const local = new Map(localRows.map((row) => [row.id, row]));
  const plan: MergePlan<T> = { write: [], kept: 0, added: 0, updated: 0 };

  // Newest first, so a file carrying the same id twice resolves to the newer
  // copy before the older one is ever considered.
  const seen = new Set<string>();
  const ordered = [...incomingRows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const incoming of ordered) {
    if (seen.has(incoming.id)) continue;
    seen.add(incoming.id);

    const outcome = resolve(local.get(incoming.id), incoming);
    if (outcome === 'incoming') {
      plan.write.push(incoming);
      if (local.has(incoming.id)) plan.updated++;
      else plan.added++;
    } else {
      plan.kept++;
    }
  }

  return plan;
}

/**
 * How many records a chunk holds.
 *
 * Five hundred is a compromise the spec names: large enough that a 5 000-set
 * history is ten transactions rather than five thousand, small enough that one
 * failing transaction loses a reportable amount and the progress bar moves
 * often enough to look alive.
 */
export const CHUNK_SIZE = 500;

/** Splits rows into chunks, preserving order. */
export function chunk<T>(rows: readonly T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
