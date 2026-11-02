/**
 * Search-key normalisation.
 *
 * Exercise names are typed fast, one-handed, mid-session, and often in a
 * different script from the one the catalog was authored in. A search that
 * only matches exact spelling is a search that fails. These functions produce
 * the folded keys stored on every exercise (`nameNormEn`, `nameNormAr`) so the
 * folding happens once at write time rather than on every keystroke.
 *
 * Pure: no Intl, no locale, no DOM. See docs/DATABASE_SPEC.md section 3.3.
 */

/**
 * Every combining mark, not just the Latin range.
 *
 * NFD decomposes أ into ا plus a *hamza above* at U+0654, and ؤ into و plus
 * the same mark. A Latin-only range (U+0300–U+036F) leaves those behind, and
 * the punctuation pass then turns each one into a space — silently splitting
 * مؤخرة into two tokens and breaking the search it was meant to fix.
 */
const COMBINING_MARKS = /\p{M}/gu;

/** Tatweel is a modifier letter, not a mark, so NFD leaves it in place. */
const TATWEEL = /ـ/g;

/** Anything that is not a letter, a digit, or an ASCII space. */
const PUNCTUATION = /[^\p{L}\p{N} ]/gu;

/**
 * Folds the Arabic letter forms that users type interchangeably.
 *
 * Someone searching for بنش will not reach down for the hamza on أ, and ة
 * versus ه at the end of a word is a coin flip on a phone keyboard. Folding
 * them into one representative form means the search matches what people
 * actually type.
 */
function foldArabicLetters(text: string): string {
  // Most of these are already handled by NFD plus the mark strip; they stay
  // for the forms that do not decompose (ٱ, ى, ة) and so the folding is still
  // correct if the input was never decomposed.
  return text
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي'); // ئ -> ي
}

/**
 * Folds Arabic-Indic and extended Arabic-Indic digits to ASCII, so a weight or
 * a variation number typed on an Arabic keyboard still matches.
 */
function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * The single normalisation used for both storage and query.
 *
 * Applying the same function to the stored key and to the typed query is what
 * makes the match symmetric; two different "nearly equivalent" functions would
 * drift apart and produce searches that fail only for certain inputs.
 */
export function normalizeSearchText(input: string): string {
  if (!input) {
    return '';
  }

  const decomposed = input.normalize('NFD').replace(COMBINING_MARKS, '').replace(TATWEEL, '');

  return foldDigits(foldArabicLetters(decomposed))
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised tokens of a string, for prefix matching. */
export function tokenize(input: string): string[] {
  const normalized = normalizeSearchText(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * True when every token of the query matches the start of some token in the
 * haystack, or appears anywhere in it.
 *
 * Token-prefix first because that is how people search — "bb ro" should find
 * "Barbell Row" — with a substring fallback so a mid-word memory ("cline" for
 * "Incline") still lands.
 */
export function matchesQuery(haystack: readonly string[], query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return true;
  }

  const fields = haystack.map((value) => normalizeSearchText(value)).filter(Boolean);
  if (fields.length === 0) {
    return false;
  }

  const haystackTokens = fields.flatMap((field) => field.split(' '));

  return queryTokens.every(
    (token) =>
      haystackTokens.some((candidate) => candidate.startsWith(token)) ||
      fields.some((field) => field.includes(token)),
  );
}

/**
 * Ranks a match so the result a user meant floats to the top. Lower is better.
 *
 * An **exact alias match ranks second, above any partial name match**. An alias
 * is curated: "bench" is listed on the barbell bench press precisely because
 * that is what people call it. Ranking alias matches below every name match
 * would answer "bench" with "Bench Dip", whose name merely happens to start
 * with the word — which is not what anyone meant.
 */
export function matchRank(primary: string, alternates: readonly string[], query: string): number {
  const q = normalizeSearchText(query);
  if (q === '') {
    return 0;
  }

  const name = normalizeSearchText(primary);
  if (name === q) return 0;

  const aliases = alternates.map((value) => normalizeSearchText(value)).filter(Boolean);
  if (aliases.includes(q)) return 1;

  if (name.startsWith(q)) return 2;

  const words = name.split(' ');
  if (words.some((word) => word.startsWith(q))) return 3;
  if (name.includes(q)) return 4;

  for (const alias of aliases) {
    if (alias.startsWith(q)) return 5;
    if (alias.includes(q)) return 6;
  }

  return 7;
}
