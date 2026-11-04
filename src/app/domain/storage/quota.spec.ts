import { AT_QUOTA, NEAR_QUOTA, isAtQuota, isNearQuota, usageFraction } from './quota';

/**
 * The asymmetry these thresholds encode is the point: past 95 % photos stop
 * being written and workouts keep logging, because a set is a few hundred
 * bytes of something that happened and a photo is hundreds of kilobytes of
 * something that can be taken again.
 */
describe('storage quota', () => {
  const at = (fraction: number) => ({ usageBytes: fraction * 1000, quotaBytes: 1000 });

  it('reports the fraction in use', () => {
    expect(usageFraction(at(0.42))).toBeCloseTo(0.42);
  });

  it('says nothing rather than zero when the browser will not answer', () => {
    // The bug this prevents: treating "cannot tell" as "empty" is harmless on
    // a meter and catastrophic nowhere; treating it as *full* would block
    // photo writes on every browser that declines to report a quota.
    expect(usageFraction({ usageBytes: null, quotaBytes: 1000 })).toBeNull();
    expect(usageFraction({ usageBytes: 500, quotaBytes: null })).toBeNull();
    expect(usageFraction({ usageBytes: 500, quotaBytes: 0 })).toBeNull();

    expect(isNearQuota({ usageBytes: null, quotaBytes: null })).toBe(false);
    expect(isAtQuota({ usageBytes: null, quotaBytes: null })).toBe(false);
  });

  it('warns above the near threshold and not at it', () => {
    expect(isNearQuota(at(NEAR_QUOTA))).toBe(false);
    expect(isNearQuota(at(NEAR_QUOTA + 0.01))).toBe(true);
  });

  it('blocks above the hard threshold and not at it', () => {
    expect(isAtQuota(at(AT_QUOTA))).toBe(false);
    expect(isAtQuota(at(AT_QUOTA + 0.01))).toBe(true);
  });

  it('warns before it blocks', () => {
    // Being told "nearly full" by a screen that has already stopped saving is
    // the failure these two constants sharing a file exists to prevent.
    expect(NEAR_QUOTA).toBeLessThan(AT_QUOTA);
    expect(isNearQuota(at(AT_QUOTA + 0.01))).toBe(true);
  });
});
