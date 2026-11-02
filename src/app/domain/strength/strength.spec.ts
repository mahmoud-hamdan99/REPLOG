import { MAX_REPS, estimate1Rm } from './e1rm';
import {
  effectiveWeightKg,
  isWorkingSet,
  sessionTotals,
  setVolumeKg,
  type VolumeInput,
} from './volume';

const set = (overrides: Partial<VolumeInput> = {}): VolumeInput => ({
  loadType: 'external',
  weightKg: 100,
  extraWeightKg: null,
  bodyWeightKg: 80,
  setType: 'working',
  reps: 5,
  isCompleted: true,
  ...overrides,
});

describe('estimate1Rm', () => {
  it('applies Epley by default', () => {
    // 100 × (1 + 5/30) = 116.666…
    expect(estimate1Rm(100, 5)).toEqual({ value: 116.67, formula: 'epley', isEstimate: true });
  });

  it('applies Brzycki when asked', () => {
    // 100 × 36/32 = 112.5
    expect(estimate1Rm(100, 5, 'brzycki')?.value).toBe(112.5);
  });

  it('returns a single rep unchanged, because that is a measurement', () => {
    expect(estimate1Rm(140, 1)?.value).toBe(140);
    expect(estimate1Rm(140, 1, 'brzycki')?.value).toBe(140);
  });

  it('estimates at the rep ceiling but not past it', () => {
    expect(estimate1Rm(60, MAX_REPS)).not.toBeNull();
    expect(estimate1Rm(60, MAX_REPS + 1)).toBeNull();
  });

  it('refuses to fabricate a value from unusable input', () => {
    expect(estimate1Rm(null, 5)).toBeNull();
    expect(estimate1Rm(100, null)).toBeNull();
    expect(estimate1Rm(0, 5)).toBeNull();
    expect(estimate1Rm(-20, 5)).toBeNull();
    expect(estimate1Rm(100, 0)).toBeNull();
    expect(estimate1Rm(100, -3)).toBeNull();
    expect(estimate1Rm(Number.NaN, 5)).toBeNull();
    expect(estimate1Rm(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('always marks itself as an estimate and names its formula', () => {
    const result = estimate1Rm(100, 8, 'brzycki');
    expect(result?.isEstimate).toBe(true);
    expect(result?.formula).toBe('brzycki');
  });
});

describe('isWorkingSet', () => {
  it('counts working and back-off sets only', () => {
    expect(isWorkingSet('working')).toBe(true);
    expect(isWorkingSet('backoff')).toBe(true);
    expect(isWorkingSet('warmup')).toBe(false);
    expect(isWorkingSet('dropset')).toBe(false);
    expect(isWorkingSet('failure')).toBe(false);
  });
});

describe('effectiveWeightKg', () => {
  it('uses the bar for external load', () => {
    expect(
      effectiveWeightKg({
        loadType: 'external',
        weightKg: 95,
        extraWeightKg: null,
        bodyWeightKg: 80,
      }),
    ).toBe(95);
  });

  it('uses body weight for bodyweight work', () => {
    expect(
      effectiveWeightKg({
        loadType: 'bodyweight',
        weightKg: null,
        extraWeightKg: null,
        bodyWeightKg: 80,
      }),
    ).toBe(80);
  });

  it('adds the belt plate, and subtracts assistance', () => {
    expect(
      effectiveWeightKg({
        loadType: 'bodyweight-plus',
        weightKg: null,
        extraWeightKg: 20,
        bodyWeightKg: 80,
      }),
    ).toBe(100);
    expect(
      effectiveWeightKg({
        loadType: 'assisted',
        weightKg: null,
        extraWeightKg: -25,
        bodyWeightKg: 80,
      }),
    ).toBe(55);
  });

  it('returns null rather than inventing a body weight', () => {
    expect(
      effectiveWeightKg({
        loadType: 'bodyweight',
        weightKg: null,
        extraWeightKg: null,
        bodyWeightKg: null,
      }),
    ).toBeNull();
    expect(
      effectiveWeightKg({
        loadType: 'bodyweight-plus',
        weightKg: null,
        extraWeightKg: 20,
        bodyWeightKg: null,
      }),
    ).toBeNull();
  });

  it('has no concept of weight for time or distance work', () => {
    expect(
      effectiveWeightKg({
        loadType: 'time',
        weightKg: null,
        extraWeightKg: null,
        bodyWeightKg: 80,
      }),
    ).toBeNull();
    expect(
      effectiveWeightKg({
        loadType: 'distance',
        weightKg: null,
        extraWeightKg: null,
        bodyWeightKg: 80,
      }),
    ).toBeNull();
  });
});

describe('setVolumeKg', () => {
  it('multiplies the effective load by the reps', () => {
    expect(setVolumeKg(set())).toBe(500);
  });

  it('ignores an unconfirmed set', () => {
    expect(setVolumeKg(set({ isCompleted: false }))).toBeNull();
  });

  it('ignores a warm-up', () => {
    expect(setVolumeKg(set({ setType: 'warmup' }))).toBeNull();
  });

  it('returns null, not zero, when a plank has no volume', () => {
    expect(setVolumeKg(set({ loadType: 'time', weightKg: null, reps: 1 }))).toBeNull();
    expect(setVolumeKg(set({ loadType: 'distance', weightKg: null, reps: 1 }))).toBeNull();
  });

  it('returns null for a missing or impossible rep count', () => {
    expect(setVolumeKg(set({ reps: null }))).toBeNull();
    expect(setVolumeKg(set({ reps: 0 }))).toBeNull();
  });
});

describe('sessionTotals', () => {
  it('sums completed working sets only', () => {
    const totals = sessionTotals([
      set({ weightKg: 40, reps: 10, setType: 'warmup' }),
      set({ weightKg: 100, reps: 5 }),
      set({ weightKg: 100, reps: 5 }),
      set({ weightKg: 95, reps: 6 }),
      set({ weightKg: 95, reps: 6, isCompleted: false }),
    ]);

    expect(totals).toEqual({
      totalVolumeKg: 1570,
      totalSets: 3,
      totalReps: 16,
      uncountedSets: 0,
    });
  });

  it('counts a set it cannot value, so the total is never silently partial', () => {
    const totals = sessionTotals([
      set({ weightKg: 100, reps: 5 }),
      set({ loadType: 'bodyweight', weightKg: null, bodyWeightKg: null, reps: 12 }),
    ]);

    expect(totals.totalVolumeKg).toBe(500);
    expect(totals.totalSets).toBe(2);
    expect(totals.totalReps).toBe(17);
    expect(totals.uncountedSets).toBe(1);
  });

  it('is zero for an empty session', () => {
    expect(sessionTotals([])).toEqual({
      totalVolumeKg: 0,
      totalSets: 0,
      totalReps: 0,
      uncountedSets: 0,
    });
  });
});
