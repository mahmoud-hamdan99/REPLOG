#!/usr/bin/env node
/**
 * The deployable build: production, under the repository subpath, with the
 * two files GitHub Pages needs that Angular does not produce.
 *
 * **This is the single source of the base href** (ARCHITECTURE section 10.3).
 * It was briefly in two places — this script and the deploy workflow's `env`
 * — which is the arrangement that doc exists to forbid: two copies of a path
 * drift, and the symptom is a site that serves a white page with four
 * 404s in the console and nothing else to go on.
 *
 * Override with BASE_HREF to stage under a different repository name:
 *
 *   BASE_HREF=/REPLOG-staging/ npm run build:pages
 *
 * No manifest or service-worker patching happens here, deliberately. The
 * manifest's `start_url`, `scope` and icon paths are relative, so they
 * resolve against wherever the manifest itself is served; the worker's
 * `navigationUrls` are matched inside its own scope, which *is* the base
 * href. Both are correct under any subpath without being rewritten, which
 * removes the whole class of bug where the app works locally and 404s on
 * Pages.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'REPLOG', 'browser');

const BASE_HREF = process.env['BASE_HREF'] ?? '/REPLOG/';

if (!BASE_HREF.startsWith('/') || !BASE_HREF.endsWith('/')) {
  // A base href missing either slash produces a build that looks fine and
  // resolves every asset one directory from where it lives.
  console.error(`build-pages: BASE_HREF must start and end with "/", got "${BASE_HREF}"`);
  process.exit(1);
}

console.log(`build-pages: building for ${BASE_HREF}`);

// The CLI's own entry point, run by this Node, rather than `npx ng`. Spawning
// `npx.cmd` needs a shell on Windows, and a shell is what turns a POSIX-style
// base href into a Windows path: Git Bash rewrites "/REPLOG/" to
// "C:/Program Files/Git/REPLOG/" and bakes that into <base href> and
// ngsw.json. The build still succeeds, which is the dangerous part.
execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
    'build',
    '--configuration',
    'production',
    '--base-href',
    BASE_HREF,
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

// GitHub Pages serves 404.html for any path it has no file for, with a 404
// status. Angular's router then resolves the URL client-side. Without this
// every deep link is a dead end for anyone who did not arrive at the root —
// which is everyone who follows a link to a specific screen.
copyFileSync(join(OUT, 'index.html'), join(OUT, '404.html'));

// Pages runs Jekyll over the artifact unless told not to, and Jekyll drops
// files and directories whose names begin with an underscore.
writeFileSync(join(OUT, '.nojekyll'), '');

console.log(`build-pages: wrote 404.html and .nojekyll into ${OUT}`);
