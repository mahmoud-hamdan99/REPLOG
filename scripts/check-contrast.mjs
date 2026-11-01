#!/usr/bin/env node
/**
 * Colour contrast gate.
 *
 * Asserts the token pairs documented in docs/UI_UX_SPEC.md section 3.2 against
 * WCAG 2.1 contrast minimums, by parsing the real token files rather than a
 * copy of them. Changing a colour and breaking a pair fails the build.
 *
 * It also asserts one pair MUST fail: lime as text on a light surface is
 * 1.4:1. That rule is the reason --accent-ink exists, so it is worth a test
 * that would notice if someone "fixed" it by making lime darker.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');

const AA_TEXT = 4.5; // normal body text
const AA_LARGE = 3.0; // large text and UI component boundaries
const AAA_TEXT = 7.0;

/** Extracts custom properties from the first block matching `selector`. */
function readTokens(file, selector) {
  const css = readFileSync(join(STYLES, file), 'utf8');
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`check-contrast: selector "${selector}" not found in ${file}`);
  }
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);

  const tokens = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[`--${match[1]}`] = match[2].trim();
  }
  return tokens;
}

/** Resolves var() aliases against the theme, then the dark base. */
function resolve(name, theme, base, seen = new Set()) {
  if (seen.has(name)) {
    throw new Error(`check-contrast: circular token reference at ${name}`);
  }
  seen.add(name);

  const raw = theme[name] ?? base[name];
  if (raw === undefined) {
    throw new Error(`check-contrast: unknown token ${name}`);
  }
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  return alias ? resolve(alias[1], theme, base, seen) : raw;
}

function parseHex(value) {
  const hex = value.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`check-contrast: "${value}" is not an opaque hex colour`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = relativeLuminance(parseHex(a));
  const lb = relativeLuminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const base = readTokens('_tokens.css', ':root {');
const light = readTokens('_themes.css', ':root[data-theme="light"]');

const themes = {
  dark: {},
  light,
};

/** [foreground, background, minimum, note] */
const PAIRS = [
  ['--text-1', '--bg', AAA_TEXT, 'primary text'],
  ['--text-1', '--surface-1', AAA_TEXT, 'primary text on cards'],
  ['--text-2', '--surface-1', AA_TEXT, 'secondary text'],
  ['--text-3', '--surface-1', AA_LARGE, 'captions (large only, never essential)'],
  ['--accent-ink', '--bg', AA_TEXT, 'accent text'],
  ['--accent-ink', '--surface-1', AA_TEXT, 'accent text on cards'],
  ['--on-accent', '--accent', AA_TEXT, 'text on accent fills'],
  ['--positive', '--surface-1', AA_TEXT, 'gains'],
  ['--danger', '--surface-1', AA_TEXT, 'destructive'],
  ['--warning', '--surface-1', AA_TEXT, 'warnings'],
  ['--info', '--surface-1', AA_TEXT, 'estimates'],
  ['--accent-ink', '--surface-2', AA_LARGE, 'focus ring on inputs'],
];

const failures = [];
const lines = [];

for (const [themeName, overrides] of Object.entries(themes)) {
  for (const [fg, bg, minimum, note] of PAIRS) {
    const ratio = contrast(resolve(fg, overrides, base), resolve(bg, overrides, base));
    const ok = ratio >= minimum;
    lines.push(
      `  ${ok ? 'ok  ' : 'FAIL'} ${themeName.padEnd(5)} ${fg} on ${bg} = ${ratio.toFixed(2)}:1 ` +
        `(needs ${minimum}) - ${note}`,
    );
    if (!ok) {
      failures.push(
        `${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${minimum}:1 (${note})`,
      );
    }
  }
}

// Inverted assertion: lime must NOT be legible as text on a light surface.
const limeOnWhite = contrast(resolve('--accent', light, base), resolve('--surface-1', light, base));
if (limeOnWhite >= AA_LARGE) {
  failures.push(
    `light: --accent on --surface-1 is ${limeOnWhite.toFixed(2)}:1. The rule that lime is a ` +
      `fill-only colour in light theme assumes it is illegible as text; if this is now ` +
      `readable, revisit UI_UX_SPEC section 3.2 and the --accent-ink indirection.`,
  );
}
lines.push(
  `  note  light --accent on --surface-1 = ${limeOnWhite.toFixed(2)}:1 ` +
    `(intentionally unusable as text; use --accent-ink)`,
);

console.log('check-contrast: WCAG pairs from UI_UX_SPEC section 3.2');
console.log(lines.join('\n'));

if (failures.length > 0) {
  console.error(`\ncheck-contrast: ${failures.length} failure(s)`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`\ncheck-contrast: OK - ${PAIRS.length * 2} pairs pass`);
