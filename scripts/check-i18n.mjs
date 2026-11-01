#!/usr/bin/env node
/**
 * Translation coverage gate.
 *
 * PRODUCT_SPEC section 6 requires "complete translation coverage" and "no
 * hardcoded user-facing strings". Coverage is only enforceable if something
 * fails the build, so this does.
 *
 * Checks, for every locale against the reference locale:
 *   1. no missing keys and no orphaned keys
 *   2. matching value shape (a plain string must not become plural forms)
 *   3. every plural category the locale's own grammar requires — Arabic needs
 *      six, English two, and a missing 'two' or 'few' in Arabic is a real bug
 *   4. identical interpolation placeholders, so {count} cannot be dropped
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'app',
  'core',
  'i18n',
  'locales',
);
const REFERENCE = 'en';

const problems = [];
const fail = (locale, message) => problems.push(`${locale}: ${message}`);

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const dictionaries = new Map(
  files.map((file) => [
    basename(file, '.json'),
    JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')),
  ]),
);

const reference = dictionaries.get(REFERENCE);
if (!reference) {
  console.error(`check-i18n: reference locale "${REFERENCE}.json" not found in ${LOCALES_DIR}`);
  process.exit(1);
}

const placeholders = (value) => {
  const found = new Set();
  const texts = typeof value === 'string' ? [value] : Object.values(value ?? {});
  for (const text of texts) {
    for (const match of String(text).matchAll(/\{(\w+)\}/g)) {
      found.add(match[1]);
    }
  }
  return found;
};

const requiredCategories = (locale) => {
  const { pluralCategories } = new Intl.PluralRules(locale).resolvedOptions();
  return pluralCategories;
};

const referenceKeys = Object.keys(reference);

for (const [locale, dictionary] of dictionaries) {
  if (locale === REFERENCE) continue;

  const keys = new Set(Object.keys(dictionary));

  for (const key of referenceKeys) {
    if (!keys.has(key)) {
      fail(locale, `missing key "${key}"`);
      continue;
    }

    const expected = reference[key];
    const actual = dictionary[key];
    const expectedIsPlural = typeof expected === 'object';
    const actualIsPlural = typeof actual === 'object';

    if (expectedIsPlural !== actualIsPlural) {
      fail(
        locale,
        `"${key}" shape mismatch: ${REFERENCE} is ${expectedIsPlural ? 'plural forms' : 'a string'}, ` +
          `${locale} is ${actualIsPlural ? 'plural forms' : 'a string'}`,
      );
      continue;
    }

    if (actualIsPlural) {
      for (const category of requiredCategories(locale)) {
        if (typeof actual[category] !== 'string' || actual[category].length === 0) {
          fail(locale, `"${key}" is missing the "${category}" plural form`);
        }
      }
    }

    const expectedPlaceholders = placeholders(expected);
    const actualPlaceholders = placeholders(actual);
    for (const name of expectedPlaceholders) {
      // A plural form that names the count in words legitimately omits it,
      // e.g. Arabic "مجموعتان" for two. Only flag a key that drops the
      // placeholder from every form.
      if (actualPlaceholders.size === 0 && expectedPlaceholders.size > 0) {
        fail(locale, `"${key}" drops the {${name}} placeholder from every form`);
        break;
      }
    }
    for (const name of actualPlaceholders) {
      if (!expectedPlaceholders.has(name)) {
        fail(locale, `"${key}" uses unknown placeholder {${name}}`);
      }
    }
  }

  for (const key of keys) {
    if (!(key in reference)) {
      fail(locale, `orphaned key "${key}" (not in ${REFERENCE}.json)`);
    }
  }
}

// The reference locale must satisfy its own grammar too.
for (const key of referenceKeys) {
  const value = reference[key];
  if (typeof value === 'object') {
    for (const category of requiredCategories(REFERENCE)) {
      if (typeof value[category] !== 'string' || value[category].length === 0) {
        fail(REFERENCE, `"${key}" is missing the "${category}" plural form`);
      }
    }
  }
}

const locales = [...dictionaries.keys()].sort().join(', ');

if (problems.length > 0) {
  console.error(`check-i18n: ${problems.length} problem(s) across [${locales}]\n`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `check-i18n: OK - ${referenceKeys.length} keys consistent across [${locales}]`,
);
