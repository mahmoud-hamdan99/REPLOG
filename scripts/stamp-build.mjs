#!/usr/bin/env node
/**
 * Writes the build identity into `src/app/core/build-info.ts`.
 *
 * Run by CI immediately before the production build. It is *not* run locally,
 * and that is deliberate: a generated file that rewrites itself on every
 * `npm start` shows up in `git status` forever and eventually gets committed
 * by accident with somebody's machine details in it. The committed file holds
 * development defaults, and About says so rather than printing a version that
 * means nothing.
 *
 * Two facts, both verifiable by whoever reads them: the commit the build came
 * from, and when it was built. Nothing derived, nothing guessed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'src', 'app', 'core', 'build-info.ts');

/** Short SHA, or null where git is unavailable (a tarball build, say). */
function commitSha() {
  // GitHub Actions hands it over without a git call, and a shallow checkout
  // can make `git rev-parse` unreliable.
  const fromCi = process.env['GITHUB_SHA'];
  if (typeof fromCi === 'string' && fromCi.length >= 7) return fromCi.slice(0, 7);

  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const commit = commitSha();
const builtAt = new Date().toISOString();

const source = `/**
 * Build identity. **Generated — do not edit.**
 *
 * The committed copy holds development defaults; \`scripts/stamp-build.mjs\`
 * overwrites it in CI before the production build. A null \`commit\` means
 * this build was never stamped, and About says exactly that rather than
 * printing a value nobody can trace back to anything.
 */
export interface BuildInfo {
  version: string;
  /** Short SHA of the commit this was built from, or null when unstamped. */
  commit: string | null;
  /** ISO instant the build ran, or null when unstamped. */
  builtAt: string | null;
}

export const BUILD_INFO: BuildInfo = {
  version: ${JSON.stringify(version)},
  commit: ${JSON.stringify(commit)},
  builtAt: ${JSON.stringify(builtAt)},
};
`;

writeFileSync(TARGET, source);
console.log(
  `stamp-build: ${version} ${commit ?? '(no commit)'} at ${builtAt}`,
);
