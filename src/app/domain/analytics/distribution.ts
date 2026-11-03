import { MUSCLE_ROLLUP, type MuscleFilter, type MuscleGroup } from '../models/enums';

/**
 * Which muscles a training block actually hit.
 *
 * Rolled up to the twelve categories the library filters by, because a chart
 * with twenty-three slices is a chart nobody reads — and because "lats" and
 * "upper back" being separate bars tells a lifter nothing they can act on.
 */

export interface DistributionInput {
  /** The exercise's primary muscle; secondaries are deliberately ignored. */
  muscle: MuscleGroup;
  sets: number;
  volumeKg: number;
}

export interface Slice {
  group: MuscleFilter;
  sets: number;
  volumeKg: number;
  /** Whole percent of total sets. The slices sum to exactly 100. */
  share: number;
}

/**
 * Share of training per muscle group, largest first.
 *
 * Counted by **sets**, not volume: a set of squats moves far more weight than
 * a set of curls, so a volume-weighted chart says "you train legs" to someone
 * who trains everything equally. Volume is carried alongside for the tooltip,
 * where it can be read as the separate fact it is.
 *
 * Only primary muscles count. Attributing a share of every bench press to the
 * triceps would need a weighting nobody can defend, and the number would look
 * exactly as precise as the one that is actually measured.
 */
export function distribution(rows: readonly DistributionInput[]): Slice[] {
  const groups = new Map<MuscleFilter, { sets: number; volumeKg: number }>();

  for (const row of rows) {
    const group = MUSCLE_ROLLUP[row.muscle];
    const held = groups.get(group) ?? { sets: 0, volumeKg: 0 };
    held.sets += row.sets;
    held.volumeKg += row.volumeKg;
    groups.set(group, held);
  }

  const totalSets = [...groups.values()].reduce((total, group) => total + group.sets, 0);
  if (totalSets === 0) return [];

  const slices = [...groups]
    .map(([group, totals]) => ({
      group,
      sets: totals.sets,
      volumeKg: Math.round(totals.volumeKg),
      share: 0,
    }))
    .sort((a, b) => (b.sets === a.sets ? a.group.localeCompare(b.group) : b.sets - a.sets));

  return withShares(slices, totalSets);
}

/**
 * Whole-percent shares that sum to exactly 100.
 *
 * Rounding each share independently gives 99 or 101 often enough that a reader
 * notices, and a distribution that does not add up undermines every other
 * number on the screen. Largest remainder: floor everything, then hand the
 * leftover points to whoever was cut by most.
 */
function withShares(slices: Slice[], totalSets: number): Slice[] {
  const exact = slices.map((slice) => (slice.sets / totalSets) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((total, value) => total + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  const shares = [...floors];
  for (const candidate of order) {
    if (remaining <= 0) break;
    shares[candidate.index] = (shares[candidate.index] ?? 0) + 1;
    remaining--;
  }

  return slices.map((slice, index) => ({ ...slice, share: shares[index] ?? 0 }));
}
