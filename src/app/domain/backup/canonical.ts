/**
 * Canonical serialisation, for a hash that means something.
 *
 * `JSON.stringify` makes no promise about key order — it happens to follow
 * insertion order for string keys, which is a property of how the object was
 * built, not of what it contains. Two exports of identical data could then
 * hash differently because one record was patched and the other inserted.
 *
 * So the bytes that get hashed are produced here: keys sorted, no whitespace,
 * arrays in their given order (which *is* meaningful — it is the order the
 * records will be restored in).
 */

/**
 * A value as a canonical JSON string.
 *
 * Mirrors `JSON.stringify`'s own rules for what it cannot represent:
 * `undefined` and functions vanish from objects and become `null` in arrays.
 * Doing anything else here would make the hash disagree with the file.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return primitive(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => (isOmitted(item) ? 'null' : canonicalize(item))).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => !isOmitted(item))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);

  return `{${entries.join(',')}}`;
}

function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/**
 * Primitives, with the two cases JSON has no syntax for.
 *
 * `NaN` and `Infinity` serialise as `null` under `JSON.stringify`, and a hash
 * that disagreed with the file it describes would be worse than no hash.
 */
function primitive(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  if (typeof value === 'bigint') {
    throw new TypeError('canonicalize: BigInt cannot be serialised to JSON');
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The exact block a backup's integrity hash covers.
 *
 * `data` and `photoBlobs` only — not the envelope. The envelope carries the
 * hash itself, and a hash over something containing itself is not computable;
 * it also carries `exportedAt`, so including it would make two exports of
 * identical data hash differently, which is precisely what the hash exists to
 * detect the absence of.
 */
export function integrityPayload(input: { data: unknown; photoBlobs: unknown }): string {
  return canonicalize({ data: input.data, photoBlobs: input.photoBlobs });
}
