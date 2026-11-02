/**
 * UUIDv7: a 48-bit millisecond timestamp followed by randomness.
 *
 * Chosen over v4 because the id sorts chronologically, so it doubles as a
 * creation cursor and keeps IndexedDB's primary-key B-tree appending rather
 * than inserting at random. It is also collision-safe enough for a future
 * multi-device merge, which a local counter would not be.
 *
 * Pure: the clock and the randomness are both supplied, so tests can make
 * generation fully deterministic.
 */

/** Returns a value in [0, 1), like `Math.random`. */
export type RandomSource = () => number;

const MAX_COUNTER = 0xfff; // 12 bits of rand_a, used as a monotonic counter

export type UuidV7Generator = (nowMs: number) => string;

/**
 * Creates a generator that stays monotonic within a millisecond.
 *
 * Two records created in the same millisecond must still sort in creation
 * order, so the 12-bit `rand_a` field is used as a counter rather than as
 * randomness. If that counter saturates, the timestamp is nudged forward by a
 * millisecond, which keeps ordering correct at the cost of a few microseconds
 * of accuracy.
 */
export function createUuidV7(random: RandomSource): UuidV7Generator {
  let lastMs = -1;
  let counter = 0;

  return (nowMs: number): string => {
    let ms = Math.max(0, Math.floor(nowMs));

    if (ms === lastMs) {
      counter += 1;
      if (counter > MAX_COUNTER) {
        // Borrow from the future rather than emit a non-monotonic id.
        lastMs += 1;
        ms = lastMs;
        counter = 0;
      }
    } else if (ms < lastMs) {
      // The clock moved backwards (NTP correction, manual change). Keep
      // issuing increasing ids instead of trusting the wall clock.
      lastMs += 1;
      ms = lastMs;
      counter = 0;
    } else {
      lastMs = ms;
      counter = 0;
    }

    const timeHex = ms.toString(16).padStart(12, '0').slice(-12);
    const counterHex = counter.toString(16).padStart(3, '0');

    // 62 bits of randomness, emitted as 16 hex digits with the variant applied.
    const randomHex = hex(random, 16);
    const variantNibble = ((parseInt(randomHex[0] ?? '0', 16) & 0x3) | 0x8).toString(16);

    return [
      timeHex.slice(0, 8),
      timeHex.slice(8, 12),
      `7${counterHex}`,
      `${variantNibble}${randomHex.slice(1, 4)}`,
      randomHex.slice(4, 16),
    ].join('-');
  };
}

function hex(random: RandomSource, digits: number): string {
  let out = '';
  while (out.length < digits) {
    out += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  }
  return out.slice(0, digits);
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/** Milliseconds encoded in a v7 id, for debugging and integrity checks. */
export function timestampOf(uuid: string): number {
  return parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}
