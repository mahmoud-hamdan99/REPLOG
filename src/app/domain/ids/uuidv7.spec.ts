import { createUuidV7, isUuidV7, timestampOf } from './uuidv7';

/** Deterministic, so every assertion here is reproducible. */
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('uuidv7', () => {
  it('produces a well-formed v7 uuid', () => {
    const next = createUuidV7(sequenceRandom([0.5]));
    const id = next(Date.UTC(2026, 2, 2, 12, 0, 0));
    expect(isUuidV7(id)).toBe(true);
    expect(id).toHaveLength(36);
  });

  it('encodes the timestamp so ids sort chronologically', () => {
    const next = createUuidV7(sequenceRandom([0.1, 0.9, 0.4]));
    const early = next(1_700_000_000_000);
    const late = next(1_800_000_000_000);

    expect(timestampOf(early)).toBe(1_700_000_000_000);
    expect(timestampOf(late)).toBe(1_800_000_000_000);
    expect(early < late).toBe(true);
  });

  /**
   * The property the whole choice of v7 rests on. Several records are routinely
   * created in the same millisecond — the sets of one exercise, a seeded
   * catalog — and if their ids did not increase, the id could not be used as a
   * creation cursor.
   */
  it('stays monotonic within a single millisecond', () => {
    const next = createUuidV7(sequenceRandom([0.5]));
    const ids = Array.from({ length: 500 }, () => next(1_750_000_000_000));

    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps increasing when the 12-bit counter saturates', () => {
    const next = createUuidV7(sequenceRandom([0.5]));
    // 4096 is the counter's capacity; the 4097th must borrow from the future.
    const ids = Array.from({ length: 4100 }, () => next(1_750_000_000_000));

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(timestampOf(ids[4099] as string)).toBeGreaterThan(1_750_000_000_000);
  });

  it('keeps increasing when the clock moves backwards', () => {
    const next = createUuidV7(sequenceRandom([0.5]));
    const first = next(1_750_000_000_000);
    // An NTP correction or a manual clock change.
    const second = next(1_749_999_999_000);

    expect(second > first).toBe(true);
    expect(isUuidV7(second)).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false);
    // A valid v4 uuid is not a v7 one.
    expect(isUuidV7('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d')).toBe(false);
  });

  it('is deterministic given the same clock and randomness', () => {
    const a = createUuidV7(sequenceRandom([0.25, 0.75]));
    const b = createUuidV7(sequenceRandom([0.25, 0.75]));
    expect(a(1_750_000_000_000)).toBe(b(1_750_000_000_000));
  });
});
