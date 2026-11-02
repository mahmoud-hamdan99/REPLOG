import { MUSCLE_FILTERS, MUSCLE_GROUPS, MUSCLE_ROLLUP } from './enums';
import { exerciseIdFromVariantKey, variantKey } from './exercise';
import { flag } from './entity';

describe('muscle taxonomy', () => {
  it('maps every data-level muscle to a filter the UI offers', () => {
    const unmapped = MUSCLE_GROUPS.filter((group) => !MUSCLE_ROLLUP[group]);
    expect(unmapped).toEqual([]);
  });

  it('only ever rolls up into the twelve documented filters', () => {
    const allowed = new Set<string>(MUSCLE_FILTERS);
    const strays = Object.values(MUSCLE_ROLLUP).filter((filter) => !allowed.has(filter));
    expect(strays).toEqual([]);
  });

  it('keeps the shoulder heads separate in the data taxonomy', () => {
    // Distribution analytics needs front/side/rear delts distinguishable even
    // though the filter chip says only "Shoulders".
    expect(MUSCLE_ROLLUP['front-delts']).toBe('shoulders');
    expect(MUSCLE_ROLLUP['rear-delts']).toBe('shoulders');
    expect(MUSCLE_ROLLUP.lats).toBe('back');
  });
});

describe('variantKey', () => {
  const base = { id: 'bench-press', equipment: 'barbell', laterality: 'bilateral' } as const;

  it('includes equipment and laterality', () => {
    expect(variantKey(base)).toBe('bench-press|barbell|bilateral');
  });

  /**
   * The mechanism behind PRODUCT_SPEC section 4.10: a dumbbell press must never
   * displace a barbell press record.
   */
  it('separates the same movement on different equipment', () => {
    const dumbbell = { ...base, equipment: 'dumbbell' } as const;
    expect(variantKey(base)).not.toBe(variantKey(dumbbell));
  });

  it('separates bilateral from unilateral work', () => {
    const unilateral = { ...base, laterality: 'unilateral-separate' } as const;
    expect(variantKey(base)).not.toBe(variantKey(unilateral));
  });

  it('recovers the exercise id', () => {
    expect(exerciseIdFromVariantKey(variantKey(base))).toBe('bench-press');
  });

  it('recovers the id from a bare key with no separators', () => {
    expect(exerciseIdFromVariantKey('bench-press')).toBe('bench-press');
  });
});

describe('flag', () => {
  it('converts booleans to indexable numbers', () => {
    // IndexedDB cannot index `true`; an index on a boolean matches nothing.
    expect(flag(true)).toBe(1);
    expect(flag(false)).toBe(0);
  });
});
