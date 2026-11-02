import {
  CM_PER_IN,
  KG_PER_LB,
  LENGTH_STEP,
  MASS_STEP,
  displayIncrement,
  roundToStep,
  stepGrid,
  toCanonicalLength,
  toCanonicalMass,
  toDisplayLength,
  toDisplayMass,
} from './convert';

describe('unit conversion', () => {
  describe('roundToStep', () => {
    it('snaps to the step without float drift', () => {
      expect(roundToStep(0.1 + 0.2, 0.25)).toBe(0.25);
      expect(roundToStep(2.4999, 0.25)).toBe(2.5);
      expect(roundToStep(102.34, 0.1)).toBe(102.3);
      expect(roundToStep(7.3, 0.5)).toBe(7.5);
    });

    it('produces clean decimals rather than binary artefacts', () => {
      // The naive v/step*step form yields 0.30000000000000004 here.
      expect(String(roundToStep(0.3, 0.1))).toBe('0.3');
      expect(String(roundToStep(70.1, 0.1))).toBe('70.1');
    });

    it('returns the value unchanged for a non-positive step', () => {
      expect(roundToStep(3.14159, 0)).toBe(3.14159);
    });
  });

  describe('mass', () => {
    it('treats kilograms as canonical', () => {
      expect(toCanonicalMass(100, 'kg')).toBe(100);
      expect(toDisplayMass(100, 'kg')).toBe(100);
    });

    it('converts pounds using the exact international definition', () => {
      expect(toCanonicalMass(1, 'lb')).toBe(KG_PER_LB);
      expect(toDisplayMass(KG_PER_LB, 'lb')).toBe(1);
    });

    it('keeps full precision in storage and rounds only for display', () => {
      const canonical = toCanonicalMass(225, 'lb');
      expect(canonical).toBeCloseTo(102.05828325, 8);
      // Nothing was snapped on the way in.
      expect(canonical).not.toBe(roundToStep(canonical, MASS_STEP.kg));
    });
  });

  describe('length', () => {
    it('treats centimetres as canonical', () => {
      expect(toCanonicalLength(42, 'cm')).toBe(42);
      expect(toDisplayLength(42, 'cm')).toBe(42);
    });

    it('converts inches exactly', () => {
      expect(toCanonicalLength(1, 'in')).toBe(CM_PER_IN);
      expect(toDisplayLength(CM_PER_IN, 'in')).toBe(1);
    });
  });

  /**
   * The property the whole canonical-storage decision rests on: a value the
   * user can actually dial in must survive a trip through storage unchanged.
   * If this fails, switching units silently rewrites training history.
   */
  describe('round-trip property', () => {
    it('holds for every displayable kilogram value from 0 to 500', () => {
      const offenders = stepGrid(0, 500, MASS_STEP.kg).filter(
        (value) => toDisplayMass(toCanonicalMass(value, 'kg'), 'kg') !== value,
      );
      expect(offenders).toEqual([]);
    });

    it('holds for every displayable pound value from 0 to 1000', () => {
      const offenders = stepGrid(0, 1000, MASS_STEP.lb).filter(
        (value) => toDisplayMass(toCanonicalMass(value, 'lb'), 'lb') !== value,
      );
      expect(offenders).toEqual([]);
    });

    it('holds for every displayable centimetre value from 0 to 300', () => {
      const offenders = stepGrid(0, 300, LENGTH_STEP.cm).filter(
        (value) => toDisplayLength(toCanonicalLength(value, 'cm'), 'cm') !== value,
      );
      expect(offenders).toEqual([]);
    });

    it('holds for every displayable inch value from 0 to 120', () => {
      const offenders = stepGrid(0, 120, LENGTH_STEP.in).filter(
        (value) => toDisplayLength(toCanonicalLength(value, 'in'), 'in') !== value,
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('displayIncrement', () => {
    it('keeps plate jumps intact in kilograms', () => {
      expect(displayIncrement(2.5, 'kg')).toBe(2.5);
      expect(displayIncrement(5, 'kg')).toBe(5);
    });

    it('snaps to a dialable number in pounds rather than converting literally', () => {
      // 2.5 kg is 5.5115... lb; nobody dials that.
      expect(displayIncrement(2.5, 'lb')).toBe(5.5);
      expect(displayIncrement(1, 'lb')).toBe(2);
    });
  });

  describe('stepGrid', () => {
    it('includes both endpoints and avoids accumulated float error', () => {
      const grid = stepGrid(0, 1, 0.25);
      expect(grid).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });
  });
});
