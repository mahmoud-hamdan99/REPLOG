#!/usr/bin/env node
/**
 * Runs the offline suite against a **Pages-shaped** build: production, under
 * the repository subpath, served the way GitHub Pages serves it.
 *
 * This exists because every Phase 13 failure mode looks identical from the
 * root: an asset path, a manifest URL or a worker scope that is correct at
 * `/` and wrong at `/REPLOG/`. Running the same assertions one directory
 * deeper is what tells them apart.
 *
 * A script rather than an inline `PAGES_BASE=... playwright test`, because
 * that syntax is not portable to the PowerShell this project is developed on,
 * and `cross-env` is a dependency for one variable.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env['PAGES_BASE'] ?? '/REPLOG/';

console.log(`test-pages: running the offline suite against ${BASE}`);

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    'playwright.pwa.config.ts',
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PAGES_BASE: BASE } },
);
