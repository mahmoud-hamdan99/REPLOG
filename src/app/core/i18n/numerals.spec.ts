import { normaliseDigits } from './numerals';

/**
 * The reading half of the numeral contract.
 *
 * `I18n.formatNumber` renders ٨٠٫٤ on an Arabic screen; this is what has to
 * come back when the user edits it. Without it the measurement fields display
 * numbers an Arabic keyboard cannot retype.
 */
describe('normaliseDigits', () => {
  it('passes Western digits through unchanged', () => {
    expect(normaliseDigits('80.4')).toBe('80.4');
  });

  it('reads Arabic-Indic digits and their decimal mark', () => {
    expect(normaliseDigits('٨٠٫٤')).toBe('80.4');
    expect(normaliseDigits('٠')).toBe('0');
    expect(normaliseDigits('٩٩٩')).toBe('999');
  });

  it('reads Persian digits', () => {
    expect(normaliseDigits('۸۰۴')).toBe('804');
  });

  it('accepts a comma as a decimal mark whatever the keyboard', () => {
    // A Latin keyboard on an Arabic interface, and the reverse, both work.
    expect(normaliseDigits('80,4')).toBe('80.4');
    expect(normaliseDigits('٨٠,٤')).toBe('80.4');
    expect(normaliseDigits('80٫4')).toBe('80.4');
  });

  it('drops anything that is not a digit or a decimal mark', () => {
    expect(normaliseDigits(' 80 kg ')).toBe('80');
    expect(normaliseDigits('٨٠ كجم')).toBe('80');
    // A pasted grouping separator, Western or Arabic.
    expect(normaliseDigits('1,234.5'.replace(',', '٬'))).toBe('1234.5');
  });

  it('is empty when nothing numeric was typed', () => {
    expect(normaliseDigits('')).toBe('');
    expect(normaliseDigits('abc')).toBe('');
  });

  it('leaves a half-typed decimal visible rather than guessing', () => {
    // "12." is a number in progress. Committing it as 12 would decide for the
    // user; that call belongs to the field, which waits.
    expect(normaliseDigits('12.')).toBe('12.');
  });
});
