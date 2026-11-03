/** Arabic-Indic and Persian digit blocks, by the code point of their zero. */
const DIGIT_BLOCKS = [0x0660, 0x06f0];

/** Every decimal mark this app's locales and keyboards produce. */
const DECIMAL_MARKS = new Set(['.', ',', '٫']);

/**
 * What the user typed, as Western digits with a single `.`.
 *
 * The counterpart to `I18n.formatNumber`: that renders a number in the user's
 * numeral system, this reads one back. An Arabic keyboard emits Arabic-Indic
 * digits, and a field that silently dropped them would be unusable for exactly
 * the people the Arabic interface exists for.
 *
 * Anything else is dropped rather than rejected, so a stray space or a pasted
 * grouping separator costs the user nothing. A result of `''` means nothing
 * numeric was typed; a trailing `.` means a number still being typed, which is
 * the caller's business to recognise rather than this function's to guess at.
 */
export function normaliseDigits(raw: string): string {
  let out = '';

  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    const block = DIGIT_BLOCKS.find((zero) => code >= zero && code <= zero + 9);

    if (block !== undefined) {
      out += String(code - block);
    } else if (character >= '0' && character <= '9') {
      out += character;
    } else if (DECIMAL_MARKS.has(character)) {
      out += '.';
    }
  }

  return out;
}
