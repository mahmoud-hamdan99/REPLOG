#!/usr/bin/env node
/**
 * Builds the shipped exercise catalog from the terse authored sources.
 *
 * Authoring 150+ exercises as full records would be unreviewable and would
 * invite copy-paste drift, so each source entry states only what is specific to
 * that movement and this script applies the defaults. It also enforces the
 * catalog's own invariants: unique ids, valid enum members, category coverage,
 * and the payload budget.
 *
 *   node scripts/build-catalog.mjs            writes the catalog
 *   node scripts/build-catalog.mjs --check    fails if the committed file is stale
 *
 * The enum *values* are checked again by catalog.spec.ts against the real
 * TypeScript unions; this script cannot import them, so the two would otherwise
 * drift. That spec is the authority — this is the fast feedback.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'scripts', 'catalog', 'source');
const OUTPUT = join(ROOT, 'src', 'app', 'features', 'exercises', 'data', 'exercises.v1.json');

const CATALOG_VERSION = 1;
const PAYLOAD_BUDGET_BYTES = 60 * 1024;
const MIN_PER_CATEGORY = 12;

const MUSCLE_FILTERS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'abs', 'full-body',
];

const ROLLUP = {
  chest: 'chest', back: 'back', lats: 'back', 'upper-back': 'back', 'lower-back': 'back',
  shoulders: 'shoulders', 'front-delts': 'shoulders', 'side-delts': 'shoulders',
  'rear-delts': 'shoulders', biceps: 'biceps', triceps: 'triceps', forearms: 'forearms',
  quadriceps: 'quadriceps', hamstrings: 'hamstrings', glutes: 'glutes',
  adductors: 'quadriceps', abductors: 'glutes', calves: 'calves', abs: 'abs',
  obliques: 'abs', neck: 'full-body', 'full-body': 'full-body', cardio: 'full-body',
};

const EQUIPMENT = new Set([
  'barbell', 'dumbbell', 'ez-bar', 'trap-bar', 'kettlebell', 'machine', 'cable',
  'smith-machine', 'bodyweight', 'pull-up-bar', 'dip-bar', 'bands', 'suspension',
  'medicine-ball', 'sled', 'plate', 'bench', 'other',
]);
const TYPES = new Set([
  'strength', 'bodyweight', 'machine', 'cable', 'cardio', 'stretch', 'olympic', 'plyometric',
]);
const PATTERNS = new Set([
  'horizontal-push', 'vertical-push', 'horizontal-pull', 'vertical-pull', 'squat', 'hinge',
  'lunge', 'carry', 'rotation', 'isolation', 'other',
]);
const MECHANICS = new Set(['compound', 'isolation']);
const FORCES = new Set(['push', 'pull', 'static']);
const LATERALITY = new Set(['bilateral', 'unilateral-alternating', 'unilateral-separate']);
const LOAD_TYPES = new Set(['external', 'bodyweight', 'bodyweight-plus', 'assisted', 'time', 'distance']);
const MUSCLES = new Set(Object.keys(ROLLUP));

/** Smallest sensible load step per equipment, in kilograms. */
const INCREMENT_BY_EQUIPMENT = {
  barbell: 2.5, 'ez-bar': 2.5, 'trap-bar': 2.5, 'smith-machine': 2.5,
  dumbbell: 2, kettlebell: 4, machine: 5, cable: 2.5, plate: 1.25,
  bodyweight: 1.25, 'pull-up-bar': 1.25, 'dip-bar': 1.25, suspension: 1.25,
  bands: 1, 'medicine-ball': 1, sled: 5, bench: 2.5, other: 2.5,
};

const problems = [];
const fail = (message) => problems.push(message);

function readSources() {
  const files = readdirSync(SOURCE_DIR).filter((name) => name.endsWith('.json')).sort();
  const entries = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(SOURCE_DIR, file), 'utf8'));
    if (!Array.isArray(parsed)) {
      fail(`${file}: expected an array of entries`);
      continue;
    }
    for (const entry of parsed) {
      entries.push({ ...entry, __file: file });
    }
  }
  return entries;
}

function expand(entry) {
  const equipment = entry.eq;
  const loadType = entry.load ?? (equipment === 'bodyweight' || equipment === 'pull-up-bar' || equipment === 'dip-bar' ? 'bodyweight' : 'external');

  return {
    id: entry.id,
    nameEn: entry.en,
    nameAr: entry.ar,
    isArTranslated: true,
    aliases: entry.alias ?? [],
    primaryMuscles: entry.pri,
    secondaryMuscles: entry.sec ?? [],
    equipment,
    exerciseType: entry.type ?? defaultType(equipment),
    movementPattern: entry.pat,
    mechanics: entry.mech ?? (entry.pat === 'isolation' ? 'isolation' : 'compound'),
    force: entry.force ?? defaultForce(entry.pat),
    laterality: entry.lat ?? 'bilateral',
    loadType,
    instructionsEn: entry.steps?.en ?? [],
    instructionsAr: entry.steps?.ar ?? [],
    cuesEn: entry.cues?.en ?? [],
    cuesAr: entry.cues?.ar ?? [],
    illustration: null,
    defaultRestSec: entry.rest ?? null,
    weightIncrementKg: entry.inc ?? INCREMENT_BY_EQUIPMENT[equipment] ?? 2.5,
    isCustom: 0,
    isArchived: 0,
  };
}

function defaultType(equipment) {
  if (equipment === 'machine' || equipment === 'smith-machine') return 'machine';
  if (equipment === 'cable') return 'cable';
  if (equipment === 'bodyweight' || equipment === 'pull-up-bar' || equipment === 'dip-bar') {
    return 'bodyweight';
  }
  return 'strength';
}

function defaultForce(pattern) {
  if (['horizontal-push', 'vertical-push', 'squat', 'lunge'].includes(pattern)) return 'push';
  if (['horizontal-pull', 'vertical-pull', 'hinge'].includes(pattern)) return 'pull';
  if (pattern === 'carry') return 'static';
  return null;
}

function validate(exercises, sources) {
  const seen = new Set();

  exercises.forEach((exercise, index) => {
    const where = `${sources[index].__file}:${exercise.id ?? `#${index}`}`;
    const required = ['id', 'nameEn', 'nameAr', 'equipment', 'movementPattern'];
    for (const field of required) {
      if (!exercise[field]) fail(`${where}: missing ${field}`);
    }

    if (exercise.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(exercise.id)) {
      fail(`${where}: id must be kebab-case`);
    }
    if (seen.has(exercise.id)) fail(`${where}: duplicate id`);
    seen.add(exercise.id);

    if (!EQUIPMENT.has(exercise.equipment)) fail(`${where}: unknown equipment "${exercise.equipment}"`);
    if (!TYPES.has(exercise.exerciseType)) fail(`${where}: unknown exerciseType`);
    if (!PATTERNS.has(exercise.movementPattern)) fail(`${where}: unknown movementPattern`);
    if (!MECHANICS.has(exercise.mechanics)) fail(`${where}: unknown mechanics`);
    if (exercise.force !== null && !FORCES.has(exercise.force)) fail(`${where}: unknown force`);
    if (!LATERALITY.has(exercise.laterality)) fail(`${where}: unknown laterality`);
    if (!LOAD_TYPES.has(exercise.loadType)) fail(`${where}: unknown loadType`);

    if (!Array.isArray(exercise.primaryMuscles) || exercise.primaryMuscles.length === 0) {
      fail(`${where}: needs at least one primary muscle`);
    }
    for (const muscle of [...(exercise.primaryMuscles ?? []), ...(exercise.secondaryMuscles ?? [])]) {
      if (!MUSCLES.has(muscle)) fail(`${where}: unknown muscle "${muscle}"`);
    }
    if (exercise.weightIncrementKg <= 0) fail(`${where}: weightIncrementKg must be positive`);

    const steps = exercise.instructionsEn.length;
    const stepsAr = exercise.instructionsAr.length;
    if (steps !== stepsAr) {
      fail(`${where}: ${steps} English steps but ${stepsAr} Arabic steps`);
    }
  });

  // Category coverage: a filter chip that returns nothing is a broken promise.
  const counts = Object.fromEntries(MUSCLE_FILTERS.map((filter) => [filter, 0]));
  for (const exercise of exercises) {
    const filters = new Set(exercise.primaryMuscles.map((muscle) => ROLLUP[muscle]));
    for (const filter of filters) {
      if (filter in counts) counts[filter] += 1;
    }
  }
  for (const [filter, count] of Object.entries(counts)) {
    if (count < MIN_PER_CATEGORY) {
      fail(`category "${filter}" has only ${count} exercises (minimum ${MIN_PER_CATEGORY})`);
    }
  }

  return counts;
}

const sources = readSources();
const exercises = sources.map(expand).sort((a, b) => a.id.localeCompare(b.id));
const counts = validate(exercises, sources);

const catalog = { version: CATALOG_VERSION, exercises };
const json = `${JSON.stringify(catalog, null, 2)}\n`;
const gzipped = gzipSync(Buffer.from(json)).length;

if (gzipped > PAYLOAD_BUDGET_BYTES) {
  fail(
    `catalog is ${(gzipped / 1024).toFixed(1)} kB gzipped, over the ` +
      `${PAYLOAD_BUDGET_BYTES / 1024} kB budget. Split instructions into a ` +
      `separate lazily-loaded file rather than raising the budget.`,
  );
}

if (problems.length > 0) {
  console.error(`build-catalog: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  let committed = '';
  try {
    committed = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('build-catalog: no generated catalog found. Run: npm run catalog:build');
    process.exit(1);
  }
  if (committed !== json) {
    console.error(
      'build-catalog: the committed catalog is out of date with its sources.\n' +
        '  Run: npm run catalog:build',
    );
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT, json);
}

const withSteps = exercises.filter((e) => e.instructionsEn.length > 0).length;
console.log(
  `build-catalog: OK - ${exercises.length} exercises, ${(gzipped / 1024).toFixed(1)} kB gzipped ` +
    `(budget ${PAYLOAD_BUDGET_BYTES / 1024} kB), ${withSteps} with instructions`,
);
console.log(
  `  per category: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
);
