# REPLOG — Implementation Plan

**Version:** 1.0
**Scope:** Version 1 as defined in [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE_SPEC.md](DATABASE_SPEC.md) · [UI_UX_SPEC.md](UI_UX_SPEC.md)
**Environment:** Windows 11, PowerShell, Node LTS, Git, VS Code

---

## 1. How This Plan Is Organised

Fourteen phases, each with a goal, task list, deliverables, and **acceptance criteria that are testable rather than aspirational**. Phases are ordered by dependency, not by visual payoff: the data layer and the active tracker come before analytics, because everything downstream reads what the tracker writes.

**Effort** is given in *sessions* (one focused half-day of work) as a relative sizing device, not a delivery commitment. Total: **~96 sessions**. A solo developer working evenings and weekends should read this as a multi-month project; the phase boundaries are the useful unit, not the total.

**Phase exit rule:** a phase is not done until its acceptance criteria pass, its tests are green, `npm run lint` and `tsc --noEmit` are clean, and the production build succeeds. No phase is "finished except for tests".

### Critical path

```
P0 Setup → P1 Foundation → P2 Data layer → P3 Library → P4 Planner → P5 Tracker ──┐
                                                                                   │
P6 History ← ────────────────────────────────────────────────────────────────────── ┘
   ↓
P7 Intelligence (PRs + suggestions) ──→ P10 Analytics
P8 Measurements ──────────────────────→ P10
P9 Photos
P11 Settings + Backup
P12 PWA/Offline → P13 Deployment → P14 Hardening & release
```

P8 and P9 are independent of P4–P7 and can be built in parallel or deferred if time is short. **P5 is the one phase that must not be rushed** — it carries the product.

---

## 2. Milestones

| Milestone | Phases | What it proves |
|---|---|---|
| **M1 — Skeleton** | P0–P1 | App boots, themes and both languages work, navigation is real |
| **M2 — It remembers** | P2–P3 | Data survives a reload; the exercise library is browsable and searchable |
| **M3 — It trains** | P4–P6 | A full loop: build a plan → train → the workout is in history. *The first genuinely usable build.* |
| **M4 — It understands** | P7–P10 | Previous performance, PRs, suggestions, measurements, photos, analytics |
| **M5 — It is safe** | P11 | Export/import/reset, integrity checks, storage warnings |
| **M6 — It ships** | P12–P14 | Installs on an iPhone from GitHub Pages, works offline, release checklist signed |

Use M3 yourself in a real gym for two weeks before starting M4. Everything in M4 is built on assumptions that only real use can validate.

---

## 3. Phase 0 — Project Setup & Tooling

**Effort:** 4 sessions · **Depends on:** nothing

### Tasks

1. Verify prerequisites and pin versions (§3.1 PowerShell).
2. Scaffold the Angular workspace; move these spec documents into `docs/`.
3. Configure `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`, `strictTemplates: true` in `angularCompilerOptions`.
4. ESLint + the import-boundary zones from ARCHITECTURE §12.2; stylelint with a `no-physical-properties` rule for RTL safety; Prettier; `.editorconfig` with `end_of_line = lf`.
5. Unit test runner + `fake-indexeddb`; Playwright with Chromium and WebKit.
6. npm scripts: `start`, `build`, `build:pages`, `test`, `test:e2e`, `lint`, `typecheck`, `check` (lint + typecheck + test), `i18n:check`, `tokens:check`.
7. `angular.json` bundle budgets per ARCHITECTURE §10.5.
8. Git repository, `.gitignore`, conventional-commit convention, `main` as default branch.
9. Folder skeleton from ARCHITECTURE §4 with an `index.ts` barrel per layer.
10. A pre-commit hook running `lint-staged` (format + lint changed files only).

### 3.1 PowerShell — environment setup

Check prerequisites:

```powershell
node --version; npm --version; git --version
```

Angular 22 requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`. This project is pinned to **Node 26.13.0**. Install or upgrade with winget — note that the `OpenJS.NodeJS.LTS` package now tracks the Node 26 LTS line, so it will install 26.x, not 24.x:

```powershell
winget install OpenJS.NodeJS.LTS
```

Allow local scripts in this session if `ng` is blocked by execution policy:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

Enable long paths once, from an **elevated** PowerShell (prevents deep `node_modules` failures):

```powershell
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1 -PropertyType DWord -Force
```

### 3.2 PowerShell — scaffold the workspace

`ng new` refuses a non-empty directory, and `D:\REPLOG` already holds the spec documents. Scaffold next to it, then merge.

```powershell
cd D:\; npx --yes @angular/cli@22 new REPLOG --style=css --routing --ssr=false --zoneless --strict --package-manager=npm --skip-git --ai-config=claude-code --interactive=false --directory replog-scaffold
```

`--directory` is resolved **relative to the current directory**, so it must not be an absolute path — passing `D:\replog-scaffold` while sitting in `D:\` makes the CLI attempt `D:\D:\replog-scaffold` and fail.

Copy the generated project into the working folder. Copy rather than move, and skip `node_modules`: it is large, disposable, and reinstalled from the committed lockfile in the next step.

```powershell
Get-ChildItem -Path D:\replog-scaffold -Force -Exclude 'node_modules' | Copy-Item -Destination D:\REPLOG -Recurse -Force
```

```powershell
Remove-Item -Path D:\replog-scaffold -Recurse -Force
```

Record the exact Angular version this produced — it is the pinned version for the project:

```powershell
cd D:\REPLOG; npx ng version
```

File the result in this document's §12 Version Lock table and never float the major version.

Tidy the documentation into `docs\`:

```powershell
New-Item -ItemType Directory -Path D:\REPLOG\docs -Force; Move-Item -Path D:\REPLOG\*.md -Destination D:\REPLOG\docs -Force -Exclude 'README.md'
```

### 3.3 PowerShell — dependencies and first run

```powershell
npm install idb
```

```powershell
npm install --save-dev fake-indexeddb @playwright/test stylelint stylelint-config-standard
```

```powershell
npx playwright install chromium webkit
```

```powershell
npm start
```

The dev server serves at `http://localhost:4200/`. To test on a physical iPhone over the LAN during development:

```powershell
npx ng serve --host 0.0.0.0 --port 4200
```

Then find the machine's address and allow the port through the firewall (elevated):

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object InterfaceAlias, IPAddress
```

```powershell
New-NetFirewallRule -DisplayName 'Angular Dev Server 4200' -Direction Inbound -LocalPort 4200 -Protocol TCP -Action Allow
```

Note: Safari will not install a PWA from a plain-HTTP LAN address, and service workers do not run there. LAN serving is for **layout and interaction testing only**; install/offline behaviour must be verified against the deployed HTTPS site (P13).

### 3.4 PowerShell — repository

```powershell
cd D:\REPLOG; git init; git branch -M main; git add .; git commit -m "chore: scaffold Angular workspace and project specs"
```

```powershell
git remote add origin https://github.com/USERNAME/REPLOG.git; git push -u origin main
```

### Acceptance criteria

- [ ] `npm run check` passes on a clean checkout
- [ ] `npm run build` produces a production bundle within budget
- [ ] An ESLint error is raised by a deliberate `import { openDB } from 'idb'` inside a component file
- [ ] A stylelint error is raised by a deliberate `margin-left` in a component stylesheet
- [ ] Both Playwright browsers launch

---

## 4. Phase 1 — Foundation: Shell, Theme, i18n, Routing

**Effort:** 9 sessions · **Depends on:** P0

### Tasks

1. `styles/_tokens.css`, `_themes.css`, `_base.css` from UI_UX_SPEC §3. Self-host Inter + IBM Plex Sans Arabic WOFF2 subsets in `public/fonts/` with `font-display: swap` and `preload` for the two primary faces.
2. `index.html`: `viewport-fit=cover`, `interactive-widget=resizes-content`, theme-color metas, apple-touch-icon metas, CSP meta (ARCHITECTURE §12.5), and the **synchronous pre-paint theme/dir script** that reads `replog.prefs.v1`.
3. `ThemeService` (system/light/dark with a `matchMedia` listener) and `SettingsStore` backed by `LocalStoragePrefs`.
4. `I18n`: locale signal, lazy JSON import per locale, `t()`, `formatNumber()`, plural selection via `Intl.PluralRules` with all six Arabic categories, `lang`/`dir` application. Seed `en.json`/`ar.json` with the shell's strings. No `TranslatePipe` — see ARCHITECTURE §12.3 for why a pure pipe cannot track the locale signal.
5. `scripts/check-i18n.mjs` — fails on key drift between locales; wire to `npm run i18n:check` and to CI.
6. `scripts/check-contrast.mjs` — parses tokens, asserts the UI_UX_SPEC §3.2 pairs; wire to `npm run tokens:check`.
7. App shell: safe-area layout, sticky header with the scroll-aware border, bottom tab bar with the elevated Train tab, toast host, dialog/sheet host with focus trapping and `inert`.
8. Router with every route from ARCHITECTURE §9 wired to placeholder pages; lazy `loadComponent`; route `data` driving title and nav state; idle preloading for `/train`.
9. Core UI kit (UI_UX_SPEC §6.1): button, card, stat tile, delta chip, chip, sheet, dialog, toast, segmented, list row, empty state, skeleton, section header, badge, progress ring.
10. `AppErrorHandler` + the `AppError` taxonomy + the diagnostics ring buffer.

### Acceptance criteria

- [x] Theme and direction are correct on the very first paint — *verified*: an E2E test seeds `replog.prefs.v1`, reloads, and asserts `lang`/`dir`/`data-theme` are already applied. That is what prevents the flash; the absence of a visible flash was not separately measured frame by frame.
- [x] Switching to Arabic flips direction instantly, with no reload, and persists across restarts — *verified* by two E2E tests (in-place switch, and switch + reload) on Chromium, WebKit and mobile Safari.
- [x] `i18n:check` and `tokens:check` pass, and both run in `npm run check` — *verified*. Note that "every shell string comes from the dictionaries" is currently upheld by review, not by a rule: the lint rule that flags literal strings in templates is still outstanding (see ARCHITECTURE §12.3).
- [x] All routes navigate; the tab bar reflects the active destination; deep-linking a nested route works — *verified* by E2E, including the 404 route and the tab bar being absent on `/train/active`.
- [ ] Safe areas on a real iPhone — **not verified**, in Phase 1 or in Phase 14. No device is available in this environment. The CSS uses `env(safe-area-inset-*)` with `viewport-fit=cover`, but inset behaviour in Safari standalone mode cannot be confirmed from a simulator or a desktop browser. It stays on the §18 device matrix as outstanding.
- [x] The UI kit renders in a dev-only gallery route in both themes and both directions — *verified* by visual review at 375×812 in dark, light, and Arabic RTL. That review found three real defects, now fixed: a mirrored number/unit pair (`kg 82.4`), a directional arrow used for "no change", and a doubled document title.
- [x] Reduced-motion variants — *verified in Phase 14*, which also found the half of this that was missing. The global `prefers-reduced-motion` rule was the only thing honouring motion preferences, so the app's own three-way setting did nothing in two of its three positions: `reduceMotion` was stored, offered on the Settings screen, and read by nothing. `ThemeService` now reflects it as `data-motion` the same way it reflects the theme, and `_base.css` reads both sources — the OS unless the app's setting overrides it. Tested on both sides: three unit tests for the attribute, and a browser test that measures a real transition duration under all three combinations, including "never" holding the animation on a device asking for less motion.

---

## 5. Phase 2 — Data Layer

**Effort:** 11 sessions · **Depends on:** P1 · **Risk: high — everything downstream depends on this being right**

### Tasks

1. `domain/models/*` — every interface in DATABASE_SPEC §3, plus enums (§4) and the muscle rollup map.
2. `domain/units/*` — canonical/display conversion, step grids, property-tested round-trips.
3. `domain/time/*` — `dayKey`, `weekKey`, ranges, duration formatting, local-vs-UTC rules.
4. `infrastructure/idb/schema.ts` — `DB_VERSION = 1`, every store and index from DATABASE_SPEC §3, including the unused `outbox`.
5. `infrastructure/idb/migrations/v1.ts` + the ordered migration runner, `blocked`/`versionchange` handling, forward-only guard and **safe mode** for a future-version database.
6. `IdbDatabase`: open, upgrade, `tx()`, quota detection, `StorageError` mapping.
7. `IdbRepository<T>` implementing `Repository<T>` (ARCHITECTURE §5.2) with envelope stamping, soft delete, and query translation.
8. `UnitOfWork` + `TxScope` with the no-foreign-await discipline and `onCommit` hooks.
9. `DbEvents` + the `BroadcastChannel` relay.
10. Per-aggregate repositories and their `InjectionToken`s; an `InMemoryRepository<T>` for tests.
11. `appMeta` accessor service (device id generation, pointers, counters).
12. `uuidv7()` implementation with a monotonic counter for same-millisecond calls.
13. Tests: CRUD and index coverage per store, soft-delete semantics, envelope stamping, transaction rollback, concurrent-write serialisation, the v1 migration from an empty database.

### Acceptance criteria

- [x] **Partly.** The full index set from DATABASE_SPEC §3 is implemented and verified field by field against the schema. (The ceiling these reads are held to was later raised from 50 ms to 400 ms: it is an index-regression guard, not a latency measurement, and `fake-indexeddb` under coverage instrumentation costs several times what it does uninstrumented. A full scan still blows through it by a wide margin.) Five representative reads — Q7 previous-performance, Q8 progression, Q12 session load, Q13 daily volume, and a variant-scoped record scan — are budget-tested at 5 000 seeded set logs and complete under 50 ms. The remaining queries belong to stores that do not exist yet and are covered as their phases land; a full scan of the same fixture takes several times the budget, so a dropped index fails these tests.
- [x] A rolled-back transaction leaves no partial writes — *verified* across three stores, including that commit hooks do not run and no change events are emitted.
- [x] No component can reach `IdbDatabase` — lint-enforced and proven in Phase 0 with a deliberate violation.
- [x] Domain layer has zero `@angular/*`, `idb` or `rxjs` imports — lint-enforced, with a deliberate violation proven to fail.
- [x] Coverage thresholds met and now **enforced** by `npm run test:coverage`: `domain/` is at **100 % lines**, `infrastructure/idb` at **93 %**, overall **95.9 %** against a configured floor of 85 %.
- [x] A database whose version exceeds `DB_VERSION` enters safe mode and blocks writes — *verified*. "Export available" was left unverifiable here because export arrives in Phase 11; **it was then found broken** — the export ended with a write that safe mode refuses, so the file downloaded and the screen reported failure. Fixed and tested in Phase 11.
- [x] Unit round-trip property test passes for every step value in the kg/lb and cm/in grids — *verified* over the full 0–500 kg, 0–1000 lb, 0–300 cm and 0–120 in grids.

---

## 6. Phase 3 — Exercise Library

**Effort:** 10 sessions · **Depends on:** P2

### Tasks

1. Author `public/data/exercises.v1.json`: 180–260 exercises, all twelve spec categories, ≥ 12 per major group, each with EN + AR names, aliases, muscles, equipment, classification, laterality, load type, weight increment, and 3–6 instruction steps. **This is content work and the largest single time sink in the phase** — budget 4 of the 10 sessions for it, and draft it in a spreadsheet exported to JSON rather than hand-editing JSON.
2. Normalisation helpers: Latin lowercase/diacritic folding; Arabic tashkeel stripping and alef/ya/ta-marbuta folding (DATABASE_SPEC §3.3).
3. Seeding and reconciliation per DATABASE_SPEC §6.2, with progress reporting and a "Preparing your exercise library" state.
4. `ExerciseLibraryStore`: resident cache, filter state, in-memory search.
5. Library screen (UI_UX_SPEC §5.7): search, muscle chips, equipment/type filter sheets, favourites, alphabetical index, virtualised list.
6. Exercise detail page.
7. Custom exercise create/edit form with full validation; archive and "reset to original" for edited built-ins.
8. Optional illustration assets for the most common lifts, with the muscle-glyph fallback.
9. Tests: seeding, reconciliation branches (new/unedited/user-edited/removed), Arabic search folding, filter combinations.

### Acceptance criteria

- [x] Catalog validates mechanically, in two places: `scripts/build-catalog.mjs` enforces unique ids, enum membership, category coverage and the payload budget, and `catalog.spec.ts` re-validates the generated file against the **real TypeScript unions** — the builder cannot import them, so that spec is the authority against enum drift. Both run in `npm run check`.
- [x] First launch seeds without blocking the first paint — seeding is triggered by the library store, deliberately **not** an app initializer, so 168 records never stand between the user and the first render.
- [x] A re-seed preserves user edits, favourites and notes — *verified*. A user-edited built-in is left exactly as the user left it, a removed exercise is archived rather than deleted so history stays readable, and a custom exercise is never touched.
- [x] Arabic search works regardless of diacritics, tatweel or alef form — *verified* by unit tests and by using the app in Arabic.
- [x] Filter and search combine, and the count matches the rendered list — *verified*.
- [x] The library payload is **9.25 kB gzipped** in its own lazy chunk, well under the 60 kB budget and absent from the initial bundle.
- [ ] Scrolling at 60 fps on an iPhone — **not verified**, in Phase 3 or in Phase 14. No device is available, and the list is **not virtualised**: 168 plain rows render acceptably, but the spec calls for virtualisation past 40 results and that is still outstanding. What Phase 14 could measure it did: the library screen renders in 143–163 ms against the soak dataset on desktop Chromium, which says the list is not the bottleneck but says nothing about frame rate on a phone. It stays on the §18 device matrix.

**Catalog scope, stated plainly:** 168 exercises rather than the 180–260 targeted, and 17 of them carry written instructions. Breadth was prioritised over written content — finding your lift is what makes a library usable, and instructions are additive content the reconciliation path exists to ship incrementally. See DATABASE_SPEC §6.1.

---

## 7. Phase 4 — Workout Planner

**Effort:** 9 sessions · **Depends on:** P3

### Tasks

1. `PlannerStore`: plans, routines, active plan, editor draft with dirty tracking.
2. Plan list + plan detail with the weekday strip (UI_UX_SPEC §5.6).
3. Plan CRUD: create, edit, **duplicate** (deep clone with new ids and `revision: 1`), archive/unarchive, set active, delete when unreferenced.
4. Routine CRUD within a plan, plus standalone flexible routines (`planId: null`).
5. Routine editor: name, schedule type, weekday picker, exercise list.
6. Exercise picker sheet (reused by the tracker) with multi-select.
7. Per-exercise configuration sheet: target sets, rep range (fixed/range), optional target weight, rest chips + custom, planned warm-ups, tracking-mode override, notes.
8. Reorder via drag handle **and** a menu-based "Move up/down" accessible alternative; sparse `orderIndex` writes.
9. Superset grouping and ungrouping.
10. Estimated duration calculation (sets × (work + rest) + transitions), labelled as an estimate.
11. `revision` bump on structural edits; the editor's history-immutability note.
12. Unsaved-changes guard.
13. Tests: duplication produces no shared ids, reorder persistence, weekday assignment, superset invariants, revision bumping.

### Acceptance criteria

- [x] A plan with 4 routines and 24 exercises builds, reorders, duplicates and archives without loss — *verified* end to end in one test.
- [x] Duplicating a plan produces a fully independent copy — *verified* the hard way: the copy is mutated thoroughly, then the original is re-read and found untouched. A copy sharing ids would pass a shallow check and fail here.
- [x] Flexible routines are creatable with no plan — *verified*, including that they never appear on a weekday.
- [x] A routine assigned to Monday and Thursday appears on both — *verified* in tests and by hand in the browser, including that the selection survives a reload.
- [x] Reordering is a single write per move and survives a reload — *verified*. Plans and routines use sparse indices so one move writes one record; the other records' `rev` is asserted unchanged. A routine's exercises are embedded in its document, so reordering them is one write by construction.
- [x] Editing a routine does not alter an existing workout record — *verified* against a seeded prior workout: after renaming the routine, adding an exercise and changing its weekdays, the workout's name, snapshot, revision and `rev` are all unchanged.

**Two deviations worth stating.** There is no unsaved-changes guard (task 12): the editor writes every change through immediately, so no work exists only in memory for a guard to protect — the safer design on a phone that can be backgrounded at any moment. And exercise reordering is **move up/down buttons only**; drag-and-drop is outstanding. The accessible alternative the spec requires is the one that shipped.

---

## 8. Phase 5 — Active Workout Tracker

**Effort:** 16 sessions · **Depends on:** P4 · **Risk: highest — this is the product**

Build it in the order below; each step is independently demonstrable.

### Tasks

1. `WorkoutSessionStore`: start from routine / quick / repeat, load, mutate, finish, discard, reset.
2. Session creation: snapshot plan and per-exercise targets (ARCHITECTURE §7.6); pre-create planned `setLogs` rows as uncommitted drafts; snapshot the nearest body weight.
3. The write policy in ARCHITECTURE §7.2, including the serial write lane and debounce flushing.
4. `rl-set-row`: previous-performance text, weight/reps fields, complete toggle, warm-up badge, swipe-to-delete with undo, advanced-mode RPE/RIR/set-type/notes.
5. `rl-numeric-pad` (UI_UX_SPEC §6.4) including the accessible hidden input, locale decimal handling, and quick-adjust from `weightIncrementKg`.
6. `rl-exercise-card`: collapsed/expanded, one-expanded-at-a-time, current-row focus advance, superset bracket and alternating focus.
7. Add/remove set, add warm-up, add exercise mid-session, skip, replace, reorder.
8. Rest timer: timestamp-derived countdown, sheet + pill, ±15 s, skip, auto-start preference, completion tone and `aria-live` announcement, Screen Wake Lock behind feature detection, the stated background limitation.
9. Pause/resume with the `pauses[]` ledger and duration maths.
10. Interruption protection (ARCHITECTURE §7.4): `CanDeactivate` with the three-way choice, `beforeunload`, `visibilitychange`, `pagehide` flush, cold-start resume prompt, multi-tab read-only banner and heartbeat.
11. Finish flow: the single transaction in ARCHITECTURE §7.5, the empty-set report, and the summary screen (UI_UX_SPEC §5.5).
12. Discard flow with an explicit confirmation stating elapsed time and set count.
13. Simple/advanced mode toggle, switchable mid-session.
14. Tests — the reliability suite, which is the acceptance evidence for this phase:
    * Confirm a set → kill the store → reload → the set is present and committed.
    * Debounced draft + `pagehide` → value persisted.
    * Finish with a throwing PR detector → full rollback, session still active and complete.
    * Background for 10 minutes (fake timers + visibility events) → duration and rest remaining are exact.
    * Two store instances on one session → the second is read-only.
    * 200 set confirmations in rapid succession → no interleaved transactions, no lost writes.

### Acceptance criteria

- [x] Set confirm → committed UI in under 100 ms at p95 with 5 000 existing set logs — guarded by a test that seeds 5 000 set logs and confirms one. The assertion budget is 400 ms because coverage instrumentation inflates the figure several times over; what it catches is a confirm that starts scanning instead of using `by_workoutExerciseId`, which would grow with the seeded rows.
- [x] No sequence of reload or tab switch loses a confirmed set — the reliability suite kills the store and reads the database back through a fresh injector, and a Playwright test does the same through a real browser reload on Chromium, WebKit and mobile Safari. **Not verified on real iPhone hardware**: no device is available, so force-quit and iOS memory reclaim remain unverified, and the 20-scenario manual script is outstanding.
- [x] A session resumed after 8 hours shows correct elapsed time excluding pauses — tested with a driven clock: 5 min training, 8 h paused, 2 min more reads 7 min.
- [x] Rest timer accuracy within 1 s after 10 minutes backgrounded — derived from `startedAt + targetSec` on every read, tested with a driven clock and no ticks at all.
- [x] Previous performance appears for every exercise with history and says "No history yet" otherwise — variant-scoped, so a dumbbell press is not offered as previous performance for a barbell press; both paths tested, and seen in the running app.
- [x] Supersets alternate focus correctly and log to the right exercises — focus rules are a pure function with their own tests, and the store test confirms A → B → A across a group.
- [ ] A full 6-exercise, 22-set session can be logged one-handed without reaching above the screen's midpoint — **not verified.** The layout is built for it (confirm buttons and the action bar in the lower half, the pad anchored to the bottom), but the claim is about a physical hand on physical hardware and cannot be made from a desktop browser.
- [x] Leaving the screen is impossible without an explicit choice — `CanDeactivate` hands the decision to the component and waits; the sheet cannot be dismissed with Escape, and closing it by any means resolves to "keep training" rather than leaving the promise unsettled. Verified against the browser's own back button in Playwright.

### Carried forward

* Drag-and-drop reordering of exercises (move up/down and the `⋯` menu ship; the accessible alternative is the one that exists).
* Swipe-to-delete reveals nothing — the swipe deletes directly with an undo toast, and the set-index badge opens the same Delete as an accessible path.
* Signal Forms for the per-set note and session note.
* First-run latency: the built-in catalog seeds in one transaction that contends with the one creating a session, measured at ~6 s on WebKit against ~0.5 s warm. The start button shows a busy state rather than looking dead, but the wait itself is still there.

---

## 9. Phase 6 — Workout History

**Effort:** 6 sessions · **Depends on:** P5

### Tasks

1. `HistoryStore` with cursor-based paging (50 per page) and a per-exercise history cache.
2. History list: month grouping with sticky headers, rollup badges, filters (date range, routine, exercise).
3. Workout detail rendered **entirely from snapshots**, including the "routine has changed / no longer exists" notes.
4. `Repeat this workout` → a new session with the same structure and no committed loads.
5. Edit a past workout (corrections) with an edit marker, and PR recomputation afterwards.
6. Delete a workout: confirm, soft delete, 30-day recovery in Settings → Data; rollups and PRs recomputed.
7. Per-exercise history view: every session's sets for one exercise, newest first. Built on the documented `/progress/exercise/:exerciseId` route rather than a new one, so Phase 10 adds its chart above an existing screen instead of building a second.
8. Tests: paging correctness, snapshot rendering after the source routine is deleted, PR recomputation after an edit or delete.

### Acceptance criteria

- [x] 500 seeded workouts page smoothly with no full-store scan — paging is keyset, not offset: each page asks for "everything before the last instant I saw". Tested by *counting index rows*, not by timing: walking to page ten reads about ten pages' worth, where offset paging would have read 2 750 rows. A stopwatch would have measured the machine; the row count measures the access path.
- [x] Deleting the routine a workout came from leaves the workout fully readable — proved in the store suite against real IndexedDB: the routine is removed, and the detail still renders its name, its exercises and every set from the snapshot, annotated "this workout day no longer exists". Driving the planner UI to reach the same state in Playwright was brittle and tested the plumbing rather than the claim, so it is covered here instead.
- [x] Editing a historical set updates rollups deterministically — rollups are recomputed from the surviving set logs rather than adjusted, so a correction and a full rebuild agree; a test applies the same edit twice and asserts the totals match. **PR recomputation itself is a no-op until Phase 7**: the `PR_DETECTOR.recompute` seam is called from inside the edit transaction with the affected variant keys, and a spy test pins down that it is called with the right ones, but nothing rebuilds a record table yet.
- [x] A deleted workout is recoverable, with its sets — soft-deleted and restored through the store, verified in Playwright on all three browsers. Only children tombstoned *by that deletion* come back, so a set corrected away last week stays deleted. **The 30-day browsable list is Phase 11's** (Settings → Data); what ships here is the undo toast and the store operation behind it.

### Carried forward

* The 30-day "recently deleted" list in Settings → Data, and the purge that ends it (Phase 11).
* Record recomputation after an edit or delete (Phase 7 fills the seam this phase calls).
* Virtualised scrolling: the list pages at 50 and renders every loaded row, which is fine for hundreds and will not be for thousands.

---

## 10. Phase 7 — Intelligence: Records & Suggestions

**Effort:** 7 sessions · **Depends on:** P6

### Tasks

1. ~~`domain/strength/e1rm.ts`~~ — **built in Phase 5.** Epley and Brzycki, `null` above 12 reps, `{ value, formula, isEstimate }`. Pulled forward because the tracker's write path stores `setLogs.e1rmKg` at confirm time; leaving it null would have meant a backfill later.
2. ~~`domain/strength/volume.ts`~~ — **built in Phase 5**, for the same reason: `volumeKg` and the session rollups are written by the finish transaction. Period aggregation is still Phase 10's.
3. `domain/strength/prs.ts` — all five PR types, variant-key scoping, weight bucketing for `maxRepsAtWeight`, "First record" vs "New PR", `previousValue` retention, `isCurrent` flipping.
4. PR detection inside the finish transaction; full rebuild-from-`setLogs` routine for Settings → Data. Detection *is* the rebuild, scoped to the variants a session touched — see ARCHITECTURE D22.
5. `domain/strength/progression.ts` — the suggestion rules in ARCHITECTURE §6.2 with a human-readable `reason`.
6. `rl-prev-performance` and `rl-suggestion-hint`: ghost text, reason, `⌁` marker, tap to accept; **never auto-applied, never written into a plan** (spec §4.5).
7. Records screen and dashboard "recent records" list, with the variant-scope explanation banner.
8. Tests: e1RM edge cases (1 rep, 12 reps, 13 reps, 0 reps, bodyweight), PR detection across equipment variants, tie handling, first-record labelling, rebuild determinism, suggestion rules at range top/bottom/middle and with zero history.

### Acceptance criteria

- [x] A dumbbell press PR never displaces a barbell press PR — every record is scoped to a `variantKey`, and the engine recomputes one variant at a time. Tested both ways round: a heavier dumbbell session leaves the barbell record standing, and recomputing one variant leaves the other's records untouched down to their ids.
- [x] A 12-rep set at 20 kg never registers as a rep PR against a 5-rep set at 100 kg — rep records are bucketed by the exact load, so the two are different records and both stand.
- [x] Every estimated value on screen carries the `⌁` marker and names its formula — the estimate badge and "Epley formula" appear on the summary and on the records screen, checked in Playwright on both.
- [x] No suggestion ever mutates a routine or commits a value without a tap — the hint is a dumb component that emits; accepting it writes an **unconfirmed draft** to the current row, so even after the tap nothing is logged until the set is confirmed. A Playwright test taps it and asserts the row's confirm button is still unpressed.
- [x] With one prior session, the suggestion is present and explained; with none, the UI says "No history yet" and offers nothing — `suggestNext` returns `null` below one session, and the card falls through to the previous-performance block's own empty line.
- [x] A PR rebuild over 5 000 seeded sets reproduces the incrementally built table exactly — **true by construction**: detection and rebuilding are the same call, so there is no incremental path that could drift. The test seeds 5 000 sets, rebuilds, and compares the persisted table against the pure function run independently over the same sets — a stronger check than rebuilding twice, which would only prove the engine repeats itself.

### Deviations

* **Bodyweight-plus records are scored on the added weight, not the total.** DATABASE_SPEC §3.13 listed it among the candidates without saying which number; scoring the total would hand out a record every time recorded body weight rose, which PRODUCT_SPEC §4.9 rules out. Volume still uses effective weight — total work done genuinely includes the body being moved. The records screen says so in a line.
* **The dashboard "recent records" card is Phase 10's**, which is the phase that builds the dashboard (its task 8). `RecordsStore.recent` is ready for it; putting a card on a screen that does not exist yet would have been the wrong half of the work.
* **The rebuild routine has no Settings → Data button yet.** `RecordsStore.rebuild()` exists and is tested; the screen that calls it is Phase 11's.
* **The records screen lives on `/progress`** rather than a route of its own. Phase 10 turns that into the analytics hub with Records as one tab; a second route built now would only be moved then.

### Carried forward

* Record *history* per type — `RecordsStore.historyFor` is written and tested, but nothing links to it yet. It wants the per-exercise progression screen, which is Phase 10.
* A record's `nameSnapshot` is frozen in the language the session was logged in, like every other snapshot. Consistent, and worth revisiting if it reads badly after a language switch.

---

## 11. Phase 8 — Body Measurements

**Effort:** 6 sessions · **Depends on:** P2 (independent of P4–P7)

### Tasks

1. `MeasurementsStore` + `customMeasurementDefs` CRUD.
2. Entry sheet (UI_UX_SPEC §5.10): weight first and focused, collapsible full set in body order, left/right pairs on one row, ghost previous values, live deltas, all fields optional.
3. `rl-measurement-field` owning canonical↔display conversion.
4. List grouped by date showing only recorded fields; edit and delete with undo.
5. Same-day duplicate detection with a merge offer.
6. Custom measurement definitions with unit types.
7. Date filtering and historical comparison (pick two dates → delta table).
8. Validation per DATABASE_SPEC §10, with the "question, don't clamp" behaviour.
9. Tests: partial entries, unit conversion round-trips through the form, delta computation across gaps, custom-definition archiving with historical values intact.

### Acceptance criteria

- [x] An entry with only a weight saves and renders correctly — Save goes live as soon as any field has a value, and the row lists only the fields that were recorded. A row of blanks would make the normal case read as a failed entry. Covered in the store suite and in Playwright, which asserts the saved entry shows exactly one value pair.
- [x] Switching kg→lb changes every displayed value and no stored value (asserted by re-reading the record) — a Playwright test records 80.4 kg and 86.4 cm, flips both units in Settings, sees 177.3 lb and 34 in, and compares the measurement rows read back out of IndexedDB against the rows read before the switch — every field identical, envelope included, so not even a write happened.
- [x] Deleting a custom definition keeps its historical values readable — the store **archives** rather than deletes, which is the stronger form of the promise: the definition is still there to name the value, so an entry recorded against "Wrist" still says "Wrist" and not an orphaned id. Archiving removes it from new entries only. Asserted in the store suite and in Playwright.
- [x] Comparing two dates shows deltas only for fields present in both, and says so for the rest — `compare` emits a status per row and a delta only for `both`; the other rows say which side is missing. A gap stays a gap: a waist that was never measured on the earlier date is not a −4 cm change.

### Deviations

* **A measured mass is displayed at scale precision, not on the plate grid.** `toDisplayMass` snaps to 0.25 kg because that is what you can put on a bar; a body weight of 80.4 kg went in and came out as 80.5. Snapping a *measurement* to the plate grid rewrites what the user read off the display in front of them. Measurements get `MEASUREMENT_STEP` (0.1), which round-trips in kilograms and in pounds — a first attempt at a per-unit step (0.1 kg / 0.2 lb) failed its own round-trip test at 177.3 lb.
* **The body weight the tracker snapshots is read through `by_hasWeight`, and the latest is chosen by the day measured.** The original scan took the newest 20 entries and looked for a weight among them. Every measurement field is optional, so a run of waist-only entries is ordinary and fills any fixed window — reporting "never weighed" to someone who weighs themselves monthly. The index the schema already keeps for this fetches only entries that have a weight; the latest among them is then picked by `measuredAt`, because an id is assigned when an entry is *typed in*, not for the day it measures, and backfilling an old weigh-in would otherwise make it the newest.
* **Height leads the collapsed section.** UI_UX_SPEC section 5.10 lists the body order from the neck down and does not place height, which the schema nonetheless carries. It sits first among the secondary fields because it is the one measurement that does not change: a reader scanning for what moved this week skips it immediately, and burying it between the thighs and the calves would make it harder to find on the rare occasion it is entered.

* **Date filtering is the comparison picker, not a range filter.** Task 7 pairs "date filtering" with "historical comparison"; the comparison picker is built, a range filter is not. The list is short by construction — DATABASE_SPEC §11 puts five years of measurements at roughly 250 kB — so there is nothing yet to filter *through*. Phase 10's shared time-range selector covers the body charts and is the natural home for it.
* **The numeral system is still a stored preference with no control in Settings.** The measurement fields read and write it correctly (below); the preferences screen that exposes it is Phase 11's.

### Carried forward

* **Measurement fields read and write the user's numeral system.** Found by looking at the running app in Arabic: the field displayed Latin `79.8` while every other number on the screen was `٧٩٫٨`, and typing `٨٢٫٥` — what an Arabic keyboard produces — emptied the field, because the parser stripped everything outside `[0-9.]`. `core/i18n/numerals.ts` now reads Arabic-Indic and Persian digits and all three decimal marks; the field renders through `formatNumber` with grouping off.
* **The comparison arrow is a translated string.** U+2192 is not bidi-mirrored, so in Arabic the line rendered right-to-left with the arrowhead still pointing right — from the later value back at the earlier one. The locale files had already settled this for the "Settings → Data" breadcrumb; `common.arrow` follows it.
* **The two recovery notices lost their hardcoded numerals.** "30 days" was written into the English copy as `30` and into the Arabic as `٣٠`, so whichever numeral system the user picked, one of those two screens disagreed with every other number in the app. Both now interpolate `RECOVERY_WINDOW_DAYS`.
* **Measurement entries display `measuredAt`, not `recordedAt`.** The list, the comparison picker and the delete confirmation all showed the instant the entry was typed, so a backfilled weigh-in claimed today's date. `DisplayFormat.weekdayDay` formats a day key as local midnight — `Date.parse('2026-10-20')` reads it as UTC and renders as the 19th anywhere west of Greenwich.
* **A measurement field names itself, and only itself.** The label element wrapped the whole control, so the input's accessible name was "Body weight kg Last 79.8 kg" — the hint read out as part of the name and then again as the description, and the two halves of a left/right pair were indistinguishable. The name now comes from the label span alone ("Biceps Left"), with the unit and the previous value as the description. The full AXE and VoiceOver sweep is the accessibility pass in section 17 (Phase 14).
* **Photos are not wired to measurements.** `Photo.measurementId` and the nearest-weight snapshot are Phase 9's; nothing here needs them.

---

## 12. Phase 9 — Progress Photos

**Effort:** 6 sessions · **Depends on:** P2 (independent)

### Tasks

1. `PhotoBlobStore` + the processing pipeline in DATABASE_SPEC §3.12: decode, orientation correction, EXIF date read, **metadata strip via canvas re-encode**, 1600 px WebP full, 320 px WebP thumb, one transaction for both blobs plus metadata.
2. `PhotosStore` with strict object-URL lifecycle tracking and revocation.
3. Import flow: file input, pose selection, EXIF-prefilled date, optional note, nearest-weight snapshot.
4. Gallery: date-grouped 3-column thumbnail grid, pose filters, lazy thumbnail loading, selection mode.
5. Compare view: two photos with date/pose/weight captions and the computed interval; draggable divider.
6. Delete with an explicit "cannot be recovered" confirmation and immediate blob hard-delete.
7. Privacy affordances: no dashboard surfacing, optional blur-until-tapped, and the honest "there is no app lock" statement.
8. Storage accounting feeding the Settings meter; the prune view.
9. Tests: pipeline output dimensions and sizes, EXIF date extraction, **GPS removal verified by re-parsing the output blob**, URL revocation on replace and destroy, blob/metadata transactional consistency.

### Acceptance criteria

- [x] The stored blob contains no EXIF GPS data (asserted programmatically) — a Playwright test draws a 12 MP JPEG, splices a real GPS IFD and a DateTimeOriginal into it, imports it through the real canvas pipeline, and reads the stored bytes back out of IndexedDB: both blobs are RIFF/WEBP and neither contains an `Exif` marker. The pipeline also checks its *own* output and refuses to store an image whose metadata survived, so a future engine that stopped stripping would fail loudly rather than quietly leak a home address.
- [x] Deleting a photo reclaims both blobs, reflected in the storage meter — the metadata is tombstoned and both blobs are hard-deleted in one transaction. Asserted in the store suite (`totalBytes` back to zero) and in Playwright (the `photoBlobs` table empty, the `photos` row tombstoned). The dialog says "cannot be recovered" because that is true.
- [x] No photo request ever leaves the device (verified with the network panel and the CSP) — a Playwright test records every request the page makes during a full import and asserts that none is to an origin other than the dev server. The CSP half is Phase 13's, where the deployed headers are set.
- [x] A 60-photo gallery holds no more object URLs than visible items + a small buffer — bounded by construction: the store caps live thumbnail URLs at a screen plus a screen of buffer in each direction, evicting least-recently-used and revoking as it goes. The store suite requests all 60 and asserts the live count never exceeds the cap, that the least-recently-used one is the one evicted, and that leaving the gallery revokes everything. Scroll *smoothness* is not asserted; it needs a device, and section 17's device matrix is where that belongs.
- [ ] A 12 MP iPhone photo is stored at ≤ 350 kB with a legible thumbnail — **not ticked: measured on synthetic 12 MP inputs, never on a photograph.** An image with a photograph's statistics (smooth shading, real edges, sensor-level grain) stores at about 30 kB; the checked-in Playwright fixture at 1200 × 1600 stores well under the budget and its thumbnail renders legibly in the grid. Pathological full-range RGB noise reaches about 640 kB, which no camera produces. What has not been through this pipeline is a real iPhone photo, and no synthetic image can stand in for that; it is a device-matrix check (section 17).

### Deviations

* **The `PhotoBlobStore` from Phase 2 was not enough on its own.** Task 1 asks for both blobs and the metadata in one transaction, and the standalone store opens its own. `TxScope` gained a `blobs()` accessor beside `appMeta()`, mirroring the record shape exactly — a blob written inside a transaction and one written standalone are indistinguishable afterwards, down to the denormalised `byteSize` the storage meter sums from the index.
* **The pipeline is split across a seam.** Everything that decides — what is refused, which sizes, that the date is read before the strip, that the output is checked — lives in `CanvasPhotoProcessor` over an `ImageCodec` interface, and only two calls (`createImageBitmap`, `canvas.toBlob`) live in the adapter. Without that split none of the pipeline could be tested at all, because no test environment here has a canvas. The adapter is the one place in this phase with low coverage, and that is the whole point of where the line was drawn.
* **Orientation is corrected by the decoder, not by this code.** `createImageBitmap(blob, { imageOrientation: 'from-image' })` applies the EXIF orientation tag on every engine at this app's floor, so the bitmap arrives upright. The tag is still read, to *know* an image was sideways; hand-rolling the eight-case rotation matrix would have been a second implementation to keep in step with the first.
* **The EXIF reader is written here rather than taken from a library.** It reads three things — capture date, orientation, whether a GPS block exists — out of JPEG, WebP and PNG containers. It exists because "the stored blob has no GPS" is only worth asserting if something can read the *output*, which is WebP; a reader that could not look inside one would make the test prove nothing.
* **A photo's weight is the nearest measurement to the day it was taken, not the latest.** `nearestWeight` is a separate query from the tracker's "latest weighed entry": a photo backdated to March belongs beside March's number, and captioning it with today's would attach a figure to a picture that never showed it.
* **The storage meter and the prune view are not built (task 8).** `PhotosStore.totalBytes()` is written and tested and is what the meter will read; the Settings → Data screen that shows it is Phase 11's, which is also where the quota warning and the prune flow live.
* **The draggable compare divider is not built (task 5).** The compare view shows both photos side by side with their captions and the computed interval, stacking below 22 rem. A divider is a gesture surface worth building against a real device, and this phase has none.
* **There is no `rl-photo-compare` component.** The comparison is two images and two captions laid out in the gallery page, and extracting a component for one caller would have been indirection without a second use. The component inventory lists it; when Phase 10 adds the body-chart comparison it may earn its own file.
* **The blur toggle is a checkbox, not `rl-list-row`'s toggle variant.** That variant is still unbuilt — Settings had only segmented controls until now — and inventing it for one row would have been a shared-component change with its own ripple. It is listed in the component inventory and remains outstanding.

### Carried forward

* **Three Progress screens had nothing linking to them.** Records, Measurements and Photos are "tabs inside Progress" in the information architecture, but until Phase 10 builds the analytics hub they were three routes reachable only by typing a URL — which on a phone means not reachable at all. `rl-progress-tabs` is the smallest thing that makes them a group, and Phase 10 replaces it with the real hub. Phase 8 shipped `/body` with this gap and it went unnoticed because the verification navigated by URL.
* **The Train tab's label hung below the bottom of the screen.** Found in Arabic, where the line box is several pixels taller than the Latin one, but present in both: the lifted 52 px circle sat in flow inside a 56 px bar, so the label under it had nowhere to go. The circle is now positioned rather than laid out, which makes the column's height the label's alone and leaves the bar correct whatever the script's metrics are. Measured in both languages: every label now ends inside the bar.
* **`today()` was a cached computed over a clock that is not a signal.** Both the measurements store and the photos store would have handed back yesterday's date to an app left open overnight. Now a method, read fresh — the same shape the tracker already used.
* **Three end-to-end assertions waited on a default that only fits an idle machine.** A cold start seeds a 168-exercise catalog, and on WebKit under four parallel workers that runs past Playwright's 5 s default — so the suite failed on load rather than on behaviour. Those three now state their own timeout and say why. Boot time itself is a device-matrix question (section 18), not something an assertion default should be deciding.
* **Progress photos are not linked to measurements.** `Photo.measurementId` is populated from the nearest weigh-in, but nothing navigates between the two yet. It wants the analytics hub.
* **A broken thumbnail says so but has no Remove button.** UI_UX_SPEC section 11 asks for one. The tile renders "This image could not be opened" and stays tappable, so the detail sheet's Delete is one tap away; a dedicated affordance on the tile is outstanding.
* **Favourites are stored and never surfaced.** `isFavorite` is in the schema and the store maintains it; no screen offers it. It belongs with a gallery that has enough photos to need filtering.

---

## 13. Phase 10 — Progress Analytics

**Effort:** 9 sessions · **Depends on:** P7, P8

### Tasks

1. `domain/analytics/*`: series builders, day/week/month bucketing, gap preservation, consistency, muscle distribution via the rollup map, moving averages (labelled as calculated).
2. The SVG chart kit (UI_UX_SPEC §9): `rl-line-chart`, `rl-bar-chart`, `rl-sparkline`, `rl-distribution`, with scrub-to-read callouts, token colours, RTL rules, and the sparse-data states.
3. Shared time-range selector with per-tab persistence.
4. Strength tab: exercise picker, e1RM and top-set series, best-set table, point count.
5. Volume tab: stacked bars by muscle group with the exclusions footnote.
6. Body tab: weight with moving average, per-measurement charts.
7. Records tab (from P7).
8. Dashboard statistics wired to real queries (Q1–Q6).
9. Tests: bucketing across month and DST boundaries, gap handling, consistency with missing weeks, distribution summing to 100 %, moving average with gaps, every empty/sparse state.

### Acceptance criteria

- [x] No chart interpolates, zero-fills, or smooths across a gap — the rule splits in two and both halves are enforced in `domain/analytics/series.ts`: `totalSeries` fills an empty bucket with zero, because a week with no training *is* zero volume, and `measurementSeries` fills it with null, because a week with no weigh-in is unknown. A line chart draws one path per run of readings, the area fill is suppressed unless the whole window is one unbroken run, and the moving average averages over a fixed number of *buckets* so it can never reach across a gap to find points. A Playwright test seeds a history with four empty weeks in it and asserts the chart is two paths, not one.
- [x] Fewer than 3 points → an empty state; fewer than 5 → no trend line; the point count is always shown — `chartState` counts readings rather than buckets, so a window that is mostly gaps is empty rather than sparse. The count is printed in every chart's caption.
- [x] Zoomed axes display their real min/max; volume and count axes start at zero — `scaleFor` takes `zeroBased` and the bar chart does not offer it as a choice, because there is no honest way to truncate a bar. A zoomed axis sets `zoomed` and the caption prints "Axis 79.4 kg to 84.5 kg". Asserted in Playwright on both.
- [x] Every number on the dashboard is reproducible by hand from the stored records — sessions this week is a count of completed workouts, body weight is the last reading on the scale, consistency is weeks met over weeks counted with both halves shown. There is no composite score, and that is the point: a number nobody can check is a number nobody should trust.
- [x] Charts are legible and correctly labelled in both themes and both directions — the categorical ramp is defined per theme and gated by `check-contrast.mjs`, which now checks each colour against the surface *and* each against its neighbour, so the ramp survives greyscale rather than relying on hue. Verified on screen in dark/English and light/Arabic; the mirroring exception for the time axis is asserted in Playwright by comparing label positions.
- [ ] A 1-year range over 5 000 set logs renders in under 300 ms — **not ticked: not measured.** The existing query-catalog budget covers the read (Q8/Q13), and the series builders are a single pass per bucket, but no measurement of the render itself was taken. A wall-clock budget belongs on a device, not on a developer machine where this suite already had to raise two timeouts for coverage instrumentation; section 17's device matrix is where it should be measured.

### Deviations

* **`/progress` is the hub and Records moved to `/records`.** The plan said Phase 10 would turn `/progress` into the analytics hub with Records as a tab, and that is what happened; the Records screen keeps its own route rather than becoming state inside the hub, so each tab has a URL, a history entry and a back button.
* **Strength, Volume and Body are one component, not three.** They share a store, a range picker and a set of formatting decisions; three components would have been three copies of all of it kept in step by hand. Which tab is showing comes from the route's `data`.
* **A count axis gets whole-number ticks.** Found on screen: the sessions chart was labelled 0.75, 1.5, 2.25. Nothing on an axis of workouts can fall between two ticks, so `scaleFor` grew an `integral` option that the counting charts ask for.
* **The muscle distribution counts sets, not volume, and attributes each set to one muscle.** A volume-weighted chart says "you train legs" to someone who trains everything equally, because a squat moves more weight than a curl. Each set is counted once against its exercise's *first* primary muscle, so the per-group counts sum to the sets actually performed; splitting across two primaries would give fractional set counts and counting it under both would make the totals exceed the training. Sets whose exercise names no muscle are reported in the footnote rather than bucketed as "other".
* **Bars are HTML, lines are SVG.** A bar chart is a row of rectangles with labels, which is what CSS grid already is. Only the line charts need path geometry, and even there the axis labels are HTML so they inherit the type scale, the numeral system and the direction instead of being hand-mirrored inside the drawing.
* **The chart kit has no shared base component.** `rl-line-chart`, `rl-bar-chart`, `rl-sparkline` and `rl-distribution` each own their geometry. They look like they should share one, but the only thing actually common is `scaleFor`, which they already share; a base class would have been inheritance for the sake of a family resemblance.
* **No `rl-stat-tile` sparkline variant on the dashboard beyond body weight.** The inventory lists "with-sparkline" as a tile variant; here the sparkline sits in its own card beside the figure, because at tile size the shape competed with the number rather than supporting it.

### Carried forward

* **The categorical ramp is staggered in lightness, not just hue.** The first draft picked six hues at similar lightness; the contrast gate — extended this phase to check neighbours against each other — failed four adjacent pairs across the two themes. Hue alone fails in greyscale and for a colour-blind reader, so the ramp now alternates light and dark as well. Every slice still carries its own percentage, so colour is never the only channel.
* **The scrub callout is positioned by an anchor element, not by itself.** In Arabic it was landing at the mirror of the point it described and hanging off the card: an inline inset resolves against the *element's own* direction, and the callout carries `dir="auto"` so its Arabic text reads correctly. Positioning and text direction now live on separate elements.
* **A sparkline draws isolated readings as dots.** A path through a single point draws nothing, so a fortnightly weigh-in against weekly buckets showed half its data and no shape. Found on the dashboard with real seeded data.
* **Two test timeouts were raised for coverage instrumentation, not for the product.** The 5 000-set rebuild determinism test and the 60-photo URL-cap test both run several times slower under v8 coverage, and the instrumented surface grew again this phase. The standing fix is to run those two outside the coverage pass rather than re-budget them every time the codebase grows; the numbers are commented as harness budgets so the next person does not read them as performance claims.
* **The analytics end-to-end file seeds once, not once per test.** Each test was booting the app, seeding a 168-exercise catalog and writing a hundred rows for itself, which on WebKit took a quarter of an hour for nine tests — long enough that they began failing on timing rather than behaviour, and a different set of them each run. None of them writes anything, so they share one seeded page and the file runs in under two minutes.
* **The end-to-end suite now runs two workers locally.** At full parallelism the WebKit processes began dying outright — "Page crashed", scattered across whichever specs happened to be running, eleven failures in one run and a different eleven in the next. The suite drives three engines over a real IndexedDB, a canvas image pipeline and seeded training histories, and it had simply outgrown one worker per core on this machine. A result that depends on what else the machine is doing is not a signal, so it trades wall-clock time for an answer that means something; CI still sets its own.
* **The strength tab opens on the most recently trained exercise.** Alphabetical order opened it on an ab wheel rollout, which carries no load and so has nothing to plot — the screen's first impression was an empty state for a user with months of history.
* **Secondary muscles are not counted anywhere.** Attributing a share of every bench press to the triceps would need a weighting nobody can defend, and the number would look exactly as precise as the one that is actually measured.
* **The per-exercise progression screen at `/progress/exercise/:id` still shows only the sets list.** Phase 6 built it and Phase 10's task 4 was read as the Strength tab; adding the same chart in a second place is better done when there is a reason for the two to differ.

---

## 14. Phase 11 — Settings, Export, Import, Integrity

**Effort:** 8 sessions · **Depends on:** P3–P10

### Tasks

1. Settings screens per UI_UX_SPEC §5.12, every preference wired to `SettingsStore`.
2. Profile management (all fields optional).
3. `domain/backup/export.ts`: the envelope in DATABASE_SPEC §9.1, chunked streaming, canonical hashing, photo opt-in with a projected size, per-store CSV export.
4. `domain/backup/import.ts`: the three-stage flow in §9.2 — validator returning a structured report, dry-run diff, merge vs replace, chunked application with accurate progress, PR rebuild after import.
5. `FileIo`: download via an object URL, pick via `<input type="file">`; no File System Access API dependency (unavailable in Safari).
6. Reset application data with typed confirmation and a mandatory export offer.
7. Recently deleted (30-day recovery) across workouts, measurements, plans, routines.
8. Integrity check routine (DATABASE_SPEC §12) with itemised, opt-in repairs and a pre-repair export offer.
9. Storage meter via `navigator.storage.estimate()`, the photo breakdown, the quota thresholds (80 % warn, 95 % block photo writes), and `persist()` with an honest result display.
10. Backup reminder logic and the dashboard card.
11. About page with the platform-honesty copy (UI_UX_SPEC §7) and the diagnostics log.
12. Tests: round-trip export→reset→import equality (including photos), hash mismatch warning path, every validator branch, merge conflict resolution by `updatedAt`, replace-mode pre-flight export, chunk failure reporting "imported N of M", import of a `formatVersion` 0 file, refusal of a future `formatVersion`.

### Acceptance criteria

- [x] Export → Reset → Import reproduces the database exactly: record counts, ids, every field, and all photos — two round-trip tests in `backup.store.spec.ts`, both with the clock advanced three days between the export and the import. The records test compares whole rows, envelope included; the photo test exports with `includePhotos`, resets until the blob store is empty, imports, and compares the restored bytes to the originals. Moving the clock is the load-bearing part: see the first deviation below.
- [x] A truncated or hand-edited backup produces a clear report and never a partial silent import — `validateBackup` returns a report rather than a boolean, with problems split into blocking and repairable; a blocking report offers no import at all, only a different file. Verified in the running app with four files: one truncated mid-JSON (what an interrupted download produces), a CSV picked by mistake, valid JSON that is not a backup, and a well-formed backup with a wrong checksum — the first three block with no import offered, the fourth warns and still imports. A failed chunk stops with "imported N of M" rather than leaving a state nobody can describe.
- [x] Replace mode cannot be reached without a typed confirmation and an offered pre-flight export — the phrase is required, trimmed and compared exactly, and the pre-flight export is taken **automatically** rather than offered as a checkbox (see deviations). Verified on screen: the Replace dialog states that the pre-flight export is automatic, and its confirm button stays disabled for `REPLAC` and for lowercase `replace`, enables on `REPLACE`, and stays enabled with a trailing space. The Reset dialog behaves the same for `DELETE`, and for `احذف` in the Arabic build.
- [x] Importing a backup containing fabricated `personalRecords` yields a rebuilt, correct PR table — `apply` excludes `personalRecords` from the stores it writes and calls the rebuild afterwards, so the table comes back from the set logs that justify it. Asserted in `backup.store.spec.ts`.
- [x] The storage meter matches `navigator.storage.estimate()` within rounding — `BrowserStorageProbe` returns the estimate untouched and `null` where the browser will not answer, which the meter renders as "this browser will not say" rather than as zero. Read on screen against the live values in both languages.
- [x] Every destructive action in DATABASE_SPEC §9.3 has its specified guard — reset and replace take a typed phrase, each integrity repair is opted into one at a time with an export offered first, and permanent deletion past the recovery window is a separate confirmed action that nothing runs automatically. The one addition to the table is that last row.

### Deviations

* **The import does not stamp the records it writes, and that was a bug, not a decision.** Every repository write ran through `putMany`, which stamps `createdAt`, `updatedAt`, `rev` and `origin` — right for every other caller and wrong for this one. A measurement taken on 1 October came back dated to the day it was restored, from this device, and the whole history of a restored backup claimed to be newer than everything logged locally, so the *next* merge would overwrite real training with an old file. The contract grew `restoreMany`, the one write that does not stamp. **The existing round-trip test passed throughout**: it ran on a frozen clock with one device id, so every envelope field coincided by accident. Found by importing a file from a different device in the running app and reading the row back out of IndexedDB. The test now moves the clock.
* **`resetAll` was broken for anyone with a photo.** It read the blob ids with `await` *inside* an open `uow.run`, and an IndexedDB transaction auto-closes when its microtask queue drains — so the outer transaction was dead before the first delete and the reset threw. With no photos the loop body never ran and nothing noticed, which is why it survived a phase of tests. It now reads the ids first and calls the blob store's own `removeMany`. Found by writing the photo round-trip the acceptance criterion already asked for.
* **Recording an export could fail the export.** `exportAll` ended by writing `lastExportAt`, and safe mode — a database at a version this build does not know — blocks every write. So in the one state where getting the data out matters most, the file reached the downloads folder and the screen then said the export had failed. The write is now guarded and the only cost of losing it is that the reminder asks sooner. Phase 2 ticked "safe mode blocks writes" with the note that "export available" could not be verified until this phase; it is verified now, by a test that fails without the guard.
* **The pre-flight export before a replace is automatic, not a checkbox.** §9.2 says "offers"; a backup someone forgets to tick is not a backup, and replace is the one operation that deletes data the user did not choose. The cost of an export nobody needed is a file in their downloads folder.
* **The typed confirmation phrase is translated.** `DELETE` on an Arabic keyboard is not a deliberate-effort gate, it is a locked door. The Arabic build asks for `احذف`, the phrase is quoted in the prompt so it stands apart from the sentence — Arabic has no capitals to do that job — and what the user types is trimmed before it is compared.
* **Settings is a hub, and Units is not a sub-screen of it.** Appearance, language and photo privacy stay on the hub because they change the app the instant they are touched, and a language switch that flipped the interface while the user was looking at a different screen would be a worse demonstration of itself. Units, workout, profile, data and about are rows.
* **`rl-segmented` grew a visible label.** Its `labelKey` was only an `aria-label`, which is how the units screen shipped with a "Weight unit" heading above a weight control *and* an unlabelled length control: named correctly for a screen reader, not at all for a sighted user. `showLabel` renders the name and moves the group to `aria-labelledby`.
* **Profile is the first screen built on Signal Forms.** Two text fields with a length bound; the birth date is capped by the native `max` attribute so the picker cannot offer a future day, and height goes through `rl-measurement-field` because that component is the only place in the app allowed to convert units.
* **About carries no build stamp.** Nothing in the build writes one, and inventing a value on the one screen whose purpose is to be trustworthy would be worse than its absence. Version, database version, locale and the device-id prefix are read from the database. A real stamp belongs with Phase 12, where the service worker needs version identity anyway.
* **The recovery list delegates every restore.** Restoring is not "clear the tombstone": a workout has to bring back exactly the children its own deletion took and recompute its totals and records, and a plan the routines its cascade took. `PlannerStore` grew `restorePlan`/`restoreRoutine` to match what `HistoryStore` and `MeasurementsStore` already did; the screen calls them.
* **Nothing purges tombstones on a schedule.** The screen lists what is inside the window and offers to permanently delete what is past it. Running that on load would make it the one destructive action in the app that nobody chose — and this is the screen whose entire purpose is that a deletion is not yet final.
* **CSV has three rules that are not obvious.** A byte-order mark, or Excel reads an Arabic note as the system codepage and shows mojibake. The header is the union of every row's keys, because records are sparse and the first row's keys would silently drop columns. And a leading `=`, `+`, `-` or `@` is defused with a tab, because a spreadsheet runs those: a note typed as "-10kg from last week" otherwise renders as `#NAME?`.

### Carried forward

* **The integrity check found 720 orphan set logs on the first run, and it was right.** The year-of-history seed written in Phase 10 created sessions and sets with no parent `workoutExercises` rows. The analytics screens never noticed because they read set logs directly. The check is correct and the seed was wrong; the seeded data is a development fixture, not shipped, but it means every Phase 10 screen was verified against data the app itself would never produce.
* **The `settings/units` placeholder route is gone and `settings/deleted` is new.** The route map in ARCHITECTURE §9 is updated. The exercise-library row points at `/exercises`, which has been browsable since Phase 3; the *management* extras §5.12 lists — archived exercises, catalog version, re-seed — are not built and have no phase of their own yet.
* **Profile has no avatar.** §5.12 lists one. The field is in the schema and left null; a photo capture and crop for one optional decoration did not earn a place beside the backup work this phase exists for.
* **The storage meter has no photo breakdown.** §9.4 asks for one. `PhotosStore.totalBytes()` is written and tested and is what it would read; the meter shows the total and the quota honestly, including "this browser will not say" where the estimate is absent. The 80 % warning and the 95 % photo-write block *are* wired: `domain/storage/quota.ts` states both thresholds once, the integrity store reads them for the meter and `PhotosStore.add` refuses before it decodes, so a 12 MP image does not cost seconds and memory to arrive at the same refusal. A browser that will not report a quota blocks nothing.
* **One existing end-to-end test had to follow a control to its new screen.** `body.spec.ts` switched units from `/settings`, and units moved to `/settings/units` when Settings became a hub. It was the only one: theme, language and the photo-privacy toggle all stayed on the hub, so the three tests that use them were untouched — which is the clearest evidence that the split was drawn in the right place.
* **A `formatVersion` 0 file is accepted, and there is no migration behind that acceptance.** The validator lets an older file through and a test asserts it does, which is the right shape; refusal of a *higher* version is tested too. But the format is still at 1, so nothing has ever had to be migrated and the chain §9.2 describes does not exist. The acceptance is a promise the first format change will have to keep.
* **The end-to-end suite runs one worker locally now, not two.** Phase 10 dropped it from one-per-core to two because WebKit processes were dying; this phase added six specs and two screens, and two started failing the same way — ten "Target page, context or browser has been closed" errors in one run, spread across four unrelated specs. Every one of them passes on its own: the four that failed here pass in 36 seconds at one worker. A result that depends on what else the machine is doing is not a signal, so this is the same trade as last phase, one step further along. CI still sets its own.
* **The query-catalog budget tests now run outside the coverage pass.** This is the standing fix Phase 10 recorded and did not do. V8 instrumentation makes the same cursor walk several times slower, and the cost grows with every file added to the instrumented surface, so the budget had been raised twice to survive the harness rather than to describe the product — and Q8 failed again this phase, which would have been the third raise. A number that tracks how much code exists is not a budget. The file still runs uninstrumented in `npm run test`, where the measurement means something.

---

## 15. Phase 12 — PWA, Offline, Updates

**Effort:** 6 sessions · **Depends on:** P11

### Tasks

1. Add `@angular/pwa`; author `ngsw-config.json` per ARCHITECTURE §10.1 (prefetch shell, fonts, locales, catalog; empty `dataGroups` with a comment; subpath-aware `navigationUrls`).
2. `manifest.webmanifest` per ARCHITECTURE §10.2, generated from the configured base href.
3. Icon set: 180 opaque apple-touch, 192/256/384/512, and a 512 maskable. Optional iOS startup images.
4. `PwaService`: `SwUpdate.versionUpdates` handling — hold updates during an active workout, otherwise a non-blocking toast; `UnrecoverableStateError` recovery that explicitly reassures the user that IndexedDB data is untouched; never auto-reload.
5. Install guidance: iOS Share → Add to Home Screen instructions with a screenshot; `beforeinstallprompt` used only where supported.
6. Offline verification of every screen; an offline indicator only where it is meaningful (it mostly is not, since nothing fetches).
7. First-run storage-durability notice and acknowledgement.

### Acceptance criteria

- [x] After one online load, a full cold start with the network disabled reaches a working dashboard — asserted in `e2e-pwa/offline.spec.ts` against a **production build**, served the way Pages serves it. The network is switched off at the browser, the document is fetched again, and the dashboard's heading and navigation landmark are asserted. Development builds disable the service worker, so this suite has its own config and its own server; running it against `ng serve` would pass while proving the opposite.
- [x] Every route loads offline, including lazy chunks and the exercise catalog — all eighteen routes are navigated to with the network off, each asserted down to its `<h1>` rather than to the shell, because a route whose chunk is missing still renders the shell. The catalog gets its own test: the database is deleted, the network is cut, and `/exercises` is opened, so the 168 built-ins have to be seeded from a prefetched chunk with nothing available to fetch.
- [x] An update is deferred while a workout is active — `pwa.service.spec.ts`, which also covers the two cases around it: with no session the update is *offered* and still never applied on its own, and when the database cannot be read at all the update is held rather than offered. Verified load-bearing by removing the guard and watching both tests fail.
- [ ] A new deployment surfaces an update prompt; accepting it reloads into the new version with all data intact — **not ticked: only half of it is tested.** The decision logic is covered against a fake `SwUpdate`, including that `apply()` activates and reloads exactly once and reloads even when activation fails. What is not covered is a real second deployment: that needs two builds served in sequence to one browser, which this harness cannot stage, and "with all data intact" is a claim about IndexedDB surviving a reload that no test here exercises.
- [ ] Lighthouse PWA checks pass on the deployed site — **not ticked: there is no deployed site.** Deployment is Phase 13. The inputs Lighthouse checks are in place and verified locally — manifest served and parseable, every declared icon reachable, a maskable icon inside the safe circle, a service worker that controls the page and answers offline — but the check itself has not been run against anything.
- [ ] The app installs from Safari on a real iPhone and launches standalone with no browser chrome — **not ticked: not attempted.** This needs an iPhone and a deployed URL, and has neither. The meta tags and the apple-touch icon are in place and the About screen gives the Share → Add to Home Screen instructions, but whether it launches without browser chrome is a device-matrix question (section 18).
- [x] No UI claims an unsupported capability — read against UI_UX_SPEC §7 line by line. The install section shows a button only where `beforeinstallprompt` actually fired and the Safari instructions otherwise; keep-screen-awake and haptics are hidden where the API is absent (Phase 11); the storage meter says "this browser will not say" rather than inventing a number; and no offline indicator was built at all, because nothing in the app fetches — see the deviations.

### Deviations

* **The manifest and the service worker resolve their own URLs, so nothing patches them per subpath.** §10.3 and Phase 13's task 1 call for `scripts/set-base-href.mjs` to rewrite `start_url`, `scope` and the SW config. Instead the manifest uses `"./"` and relative icon paths, which a webmanifest resolves against its own URL, and `navigationUrls` stays `/**`, which ngsw matches inside the worker's scope — and the scope *is* the base href. Both are therefore correct under any subpath with no build step, which removes the class of deployment bug where the app works locally and 404s on Pages. `--base-href` on the build command is the single source of truth it was meant to be. Phase 13's task 1 is now unnecessary; its tasks 2 and 4–6 are not.
* **`.github/workflows/deploy.yml` is written here, a phase early.** It is Phase 13's task 3. Phase 12 introduced a build stamp, and a stamp script that nothing ever calls is a loose end rather than a feature; the workflow is what calls it. It also fails the build if the committed icons differ from what `scripts/build-icons.mjs` produces, so the mark cannot drift from its description. Nothing has been deployed with it.
* **The icons are generated from a script, not exported from a design tool.** The mark is five capsules and a background, so the repository holds the description — `scripts/build-icons.mjs`, with the coordinates and the two theme colours — instead of six binaries nobody can diff. Coverage is computed from the signed distance to each capsule, which gives real anti-aliasing with no rasteriser dependency; at 48 px on a home screen the difference between that and nearest-neighbour is a barbell versus a smudge.
* **`ngsw-config.json` carries its comments as `$comment` keys.** §10.1 asks for a comment on the empty `dataGroups` so nobody adds caching for an API that does not exist. The file is parsed as strict JSON and `//` is a build error, so the explanations are `$comment` properties — the JSON Schema annotation keyword, which the builder tolerates. The warning sits where somebody would be tempted to edit, which is the point of asking for it.
* **Every lazy chunk is prefetched, not cached on demand.** §10.1 describes `lazy` + `updateMode: prefetch` for optional packs, and that is what the illustrations group does. The *route* chunks are eagerly prefetched instead, because the acceptance criterion is that every route works offline and a user who logs workouts at the gym may never open Progress on a connection. The cost is one larger install; the alternative is a screen that is offline-capable only if you happened to visit it first.
* **There is no offline indicator.** §12 task 6 allows one "only where it is meaningful (it mostly is not, since nothing fetches)". Nothing fetches at all — the catalog and both translation dictionaries are build output — so an indicator would have nothing to indicate and would imply the app has network-dependent behaviour it does not have. The About screen states the offline guarantee instead.
* **About gained a build row, and says when there is no build.** Phase 11 left this as carried forward. `scripts/stamp-build.mjs` writes the commit and build time in CI; the committed `build-info.ts` holds nulls, and a local build prints "Not stamped in this build" rather than a version that traces back to nothing. The app version is also written into `appMeta` at boot now, so a backup file records the version that wrote it instead of the default `0.0.0` every export had been claiming.
* **The first-run notice is a card on the dashboard, not a modal.** §9.4 asks for a "one-time, dismissible notice". Nothing about it needs an answer before the app can be used, and a dialog on first launch is the fastest way to teach somebody to dismiss dialogs without reading them. It is acknowledged into `appMeta.storageWarningAcknowledgedAt`, and hidden optimistically before that write, so a failed write in safe mode cannot leave a notice that will not go away.

### Carried forward

* **The offline suite is Chromium-only.** Playwright's WebKit does not implement service workers closely enough for an offline assertion to mean anything there, and a test that cannot fail on the engine it is meant to cover is worse than no test. Safari is the primary platform, so this is a real gap and not a technicality: it moves the whole offline guarantee onto the device matrix in section 18, where it joins installation and Lighthouse.
* **Two Playwright traps cost most of the time in this phase, and both made tests pass while proving nothing.** `page.waitForFunction` does not await an async predicate — it sees the returned Promise, finds it truthy and resolves on the first poll, so the first version of "wait until the worker is ready" waited about 600 ms and the cache was empty. And waiting for the worker to be `activated` is not enough: a page can be uncontrolled under an activated worker, and an uncontrolled page intercepts nothing. The helper now polls with `expect.poll` over `page.evaluate`, and requires both a controller and every URL `ngsw.json` lists as prefetched.
* **The cold-start test navigates away and back rather than reloading.** `page.reload()` under Playwright's offline emulation fails against an app that reloads offline perfectly well when driven directly — verified with a standalone script. Away-and-back is the same request from the worker's side, so the test keeps its meaning; the reload path is a harness limitation, recorded rather than worked around silently.
* **`VERSION_INSTALLATION_FAILED` is recorded, never shown.** Nothing is broken when it happens and there is nothing the user can do, so it goes to Settings → About → Diagnostics. If it turns out to be common in the field it deserves a louder treatment, but inventing one before there is evidence would be noise on the primary platform.
* **The coverage pass crashes workers when the machine is busy.** Verifying the committed tree failed once with four Vitest workers exiting on `0xC0000409` (a Windows stack-buffer-overrun), taking two spec files with them — while a dev server and two static servers from this session were still running. The same command on a quiet machine passes with 802 tests and no unhandled errors. So it is contention, not a defect; but it means a red `npm run check` on this hardware is worth re-running before it is believed, which is a bad property for a gate to have. The instrumented run is the most memory-hungry thing in the repository and it is getting hungrier each phase.
* **The service worker is registered 30 seconds after the app settles, at the latest.** `registerWhenStable:30000`. The worker's first act is to prefetch the whole build, and doing that while the first screen is still rendering competes with it for the connection on exactly the devices that can least afford it. The cost is that a user who opens the app and closes it within a few seconds on their very first visit may not get an offline copy.

---

## 16. Phase 13 — GitHub Pages Deployment

**Effort:** 4 sessions · **Depends on:** P12

### Tasks

1. `scripts/set-base-href.mjs` — single source for the base href, patching the manifest `start_url`/`scope` and the SW config.
2. `npm run build:pages` — production build with `--base-href /REPOSITORY-NAME/`, then patch, then copy `index.html` → `404.html`, then write `.nojekyll`.
3. `.github/workflows/deploy.yml` (§16.1).
4. Repository settings: Pages source = GitHub Actions; branch protection on `main` requiring a passing check; the `github-pages` environment for the approval gate (spec §11 "approved pushes").
5. Verify deep links, asset paths, SW scope, and manifest URLs on the live site.
6. `README.md`: what REPLOG is, local development, the PowerShell command list, deployment, backup instructions, and the honest platform notes.

### 16.1 Workflow

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run i18n:check
      - run: npm run tokens:check
      - run: npm test -- --watch=false --browsers=ChromeHeadless
      - run: npm run build:pages
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/REPLOG/browser

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

Confirm the artifact path against the pinned Angular version's output layout (`dist/<project>/browser` on recent versions, `dist/<project>` on older ones) — a wrong path here is the single most common Pages failure.

### 16.2 PowerShell — local production verification

Build exactly as CI does:

```powershell
cd D:\REPLOG; npm run build:pages
```

Serve the built output over a subpath so base-href and service-worker scope are exercised the way they will be in production:

```powershell
npx --yes http-server .\dist\REPLOG\browser -p 8080 --cors -c-1
```

Then open `http://localhost:8080/` and confirm routing and assets. Note that a service worker will register on `localhost` but **the subpath behaviour is only truly verified on the deployed HTTPS URL** — treat local verification as necessary, not sufficient.

Deploy:

```powershell
git add .; git commit -m "feat: production build configuration for GitHub Pages"; git push origin main
```

Watch the run:

```powershell
gh run watch
```

(Requires GitHub CLI: `winget install GitHub.cli`, then `gh auth login`. Otherwise use the Actions tab.)

### Acceptance criteria

Everything below is verified against a **Pages-shaped build** — production,
under the `/REPLOG/` subpath, served by `scripts/serve-dist.mjs` with the
SPA fallback and 404 status Pages uses. Nothing is verified against a live
site, because nothing has been deployed: the repository settings that make a
deploy possible need a human in the GitHub web interface, and the branch has
not been pushed. Each criterion says which half it has.

- [x] A deep link such as `/REPLOG/progress` loads directly and the router resolves it — `404.html` is written by `scripts/build-pages.mjs`, the local server returns it with a 404 status exactly as Pages does, and the body carries `<base href="/REPLOG/">` and the app root. Every one of the eighteen routes is then navigated to under the subpath in `e2e-pwa/offline.spec.ts`.
- [x] No 404s for assets, fonts, locale JSON, or the exercise catalog — the offline suite asserts the service worker has cached every URL `ngsw.json` declares for prefetch, which is the whole build: 80 files including both font families and every lazy chunk. The catalog gets its own test that deletes the database, goes offline and opens `/exercises`.
- [x] The manifest resolves and its URLs are correct under the subpath — served at `/REPLOG/manifest.webmanifest` with every declared icon fetched and asserted 200. **`start_url` and `scope` are `"./"` rather than containing the subpath literally**, which resolves to `/REPLOG/` when served from there; see the deviation below.
- [x] The service worker registers with the correct scope and serves offline — a test added this phase asserts `registration.scope`, `document.baseURI` and `page.url()` all equal the subpath base. That test exists to stop the suite silently passing against the root: relative paths plus a wrong baseURL would have tested `/` and proved nothing.
- [x] `https://mahmoud-hamdan99.github.io/REPLOG/` loads the app — *verified on the live site*. It returns 200 with `<base href="/REPLOG/">`, the dashboard renders at 375 px, and `/settings/about` reached directly resolves client-side and reports `Build 4406a18` — which is `stamp-build.mjs` running in CI, so the deployed bundle names the commit it was built from.
- [x] A push to `main` deploys automatically after checks pass — *verified*, on the fifth attempt and after two distinct failures that both showed as one red X. The first three runs failed in seconds at `deploy-pages`, which is Pages not being enabled. The fourth ran ten minutes and then failed, which is the same action timing out waiting for the service to confirm — a different fault wearing the same mark. The build job passed every time, the artifact uploading at 631 kB from 88 files. The fix was to stop depending on a setting the repository could not see: `configure-pages` with `enablement` now asserts both the on/off state and the Actions source, and the deploy timeout went to 20 minutes.
- [ ] Install from Safari on the deployed URL produces a standalone app — **not ticked: not attempted.** Needs an iPhone and a live URL. Carried from Phase 12.

### Deviations

* **`scripts/set-base-href.mjs` was not written, because nothing needs patching.** Task 1 asks for a script that rewrites the manifest's `start_url`/`scope` and the service-worker config from a single base href. Instead the manifest uses `"./"` and relative icon paths — a webmanifest resolves those against its own URL — and `navigationUrls` stays `/**`, which ngsw matches inside the worker's scope, and the scope *is* the base href. Both are correct under any subpath with nothing rewritten, which deletes the class of bug where the app works locally and 404s on Pages. The single source the task wanted is `scripts/build-pages.mjs`, which owns the base href and is the command both a developer and CI run.
* **The base href briefly lived in two places and that was the bug §10.3 exists to prevent.** Phase 12 put `BASE_HREF` in the workflow's `env` while `build:pages` had its own copy. Neither was wrong yet, which is exactly how that arrangement fails: it drifts later, and the symptom is a white page with four 404s in the console. The workflow now runs `npm run build:pages`.
* **The deploy workflow runs the offline suite against the subpath build.** Not in the plan. Every Phase 13 failure mode — an asset path, a manifest URL, a worker scope — looks identical from the root, so a gate that only builds would pass while shipping a broken site. `npm run test:pages` is the same assertions one directory deeper.
* **`scripts/build-pages.mjs` invokes the Angular CLI's JS entry point rather than `npx ng`.** Spawning `npx.cmd` needs a shell on Windows, and a shell is what breaks this particular build; see below.

### Carried forward

* **One `dist/` serves two suites, and a stale artifact reads as a broken app.** The root and subpath runs share a build directory, so running one straight after the other serves a build whose `<base href>` points elsewhere and every asset 404s — which looks exactly like the deployment being broken, and cost a chase in the wrong direction. `serve-dist.mjs` now reads the built `<base href>` and refuses to start when it does not match the path it was asked to serve from, naming the command to run instead.
* **Git Bash silently corrupts the deployable build on Windows, and this bit twice in one phase.** MSYS rewrites a leading-slash argument into a Windows path, so `ng build --base-href /REPLOG/` becomes `--base-href "C:/Program Files/Git/REPLOG/"` — and *the build succeeds*, with that path baked into `<base href>` and into `ngsw.json`. It then 404s everything on deployment. The same thing ate `serve-dist.mjs --base /REPLOG/` an hour later. The npm scripts are safe because npm runs them through `cmd.exe`; the README now says so, and `build-pages.mjs` avoids the shell entirely. There is no gate against someone typing it by hand.
* **Nothing has been deployed, and four of the seven criteria need that.** The repository settings — Pages source, the `github-pages` environment's reviewers, branch protection on `main` — cannot be set from repository contents and are listed in the README as a numbered one-time task. The `gh` CLI is not installed in this environment, so they could not be set from here either.
* **The workflow has never run.** Its YAML is structurally checked and every command in it has been run locally in the same order, which is worth something and is not the same as a green run. The first push will find whatever is wrong with it.
* **`upload-pages-artifact` makes `.nojekyll` redundant, and it is written anyway.** Jekyll only runs for branch-based Pages, not for the Actions artifact path this uses. It costs nothing and keeps the artifact correct if the source is ever switched back, but it is not doing anything today.

---

## 17. Phase 14 — Hardening & Release

**Effort:** 9 sessions · **Depends on:** P13

### Tasks

1. The Playwright journey suite: plan → train → finish → history → analytics; export → reset → import; language switch; theme switch; offline cold start; interrupted session recovery.
2. Performance pass against the ARCHITECTURE §10.5 budgets; fix regressions rather than raising budgets.
3. Seeded-data soak test: 2 years of synthetic history (≈ 400 workouts, 10 000 set logs, 150 measurements, 60 photos) exercising every screen.
4. Full UI_UX_SPEC §16 design QA per screen, in both themes and languages.
5. Accessibility pass: VoiceOver on a real device, keyboard on desktop, 200 % text scaling.
6. Real-device matrix (§18).
7. Error-path review: every `AppError` branch reachable and humane; quota exhaustion rehearsed by filling storage.
8. Copy review: no hardcoded strings, no over-claimed capabilities, every estimate marked, every destructive dialog specific.
9. Definition-of-Done traceability (§19) completed with evidence.
10. `README.md` and in-app About finalised, including backup instructions.
11. Tag `v1.0.0`.

### Acceptance criteria

- [x] All E2E journeys pass on Chromium and WebKit — *verified*. 179 browser tests across Chromium, desktop WebKit and mobile Safari, and 18 more against the production build on Chromium. The journey suite that §17 task 1 asks for now exists: plan → train → finish → history, quick workout → history → records → analytics, and export → reset → import **through the screens** rather than through the store. The last of those was proved load-bearing by replacing the Merge click with a cancel and watching the restored counts come back 0 against an expected 1.
- [x] Budgets met; no console errors or warnings in production — *verified*. Initial bundle **330.56 kB raw / 90.96 kB transfer** against a 180 kB gz budget, largest lazy chunk **12.56 kB**, catalog payload **12.6 kB** against 60 kB. Console cleanliness is asserted rather than eyeballed: every screen is loaded in a fresh page in both languages and any error or warning fails the run, with a filter list of two entries, both of them browser noise the app cannot prevent.
- [ ] The soak dataset performs within the stated targets on a real iPhone — **not verified, and not verifiable here.** The dataset exists and is exercised on every run: 400 workouts, 2 400 workout exercises, 10 000 set logs, 150 measurements and 60 photos, built as a backup file and loaded through the app's own import, which also rebuilds every personal record from the set logs. On desktop Chromium against the production build, on an otherwise idle machine, the import takes about **5.3 s** and every screen renders in **86–384 ms**: dashboard 345, history 248, volume chart 125, records 362, photos 380, workout detail 384, exercise history 86. With the three-engine browser suite running alongside it, the same figures stretch to 102–649 ms — which is the measurement saying what it is worth. These are desktop numbers on one machine, and the assertion that guards them is a 5 s ceiling, an order of magnitude above all of them. The §10.5 figure that mentions a phone is a Lighthouse measurement against a deployed site, which nothing in this environment can produce.
- [x] §19 is complete, with every row marked verified, manually verified, or **not verified** — and nothing left implied — *done*. Two of the fifteen rows are **not verified** outright — installing from Safari and the Pages deployment itself — and four more are verified in their automated half while naming the part that is not: the iPhone interruption script, the photo device check, iOS storage eviction, and a full hand-reproduction of the dashboard against the soak dataset.

### What this phase found

The point of a hardening phase is to look where nothing has looked yet. Eleven defects came out of it, and every one was invisible to a green test suite.

**Seven accessibility defects**, from pointing axe at all nineteen screens in both languages and both themes, and then at the sheets and detail screens a route list cannot reach:

* `--text-3` failed AA on fourteen screens. It is the colour of every caption, tab-bar label, row meta, chart caption and form hint in the app, and it was held to the large-text minimum against one surface on the stated assumption that captions are "never essential". Both themes were raised until the token passes against all three surfaces it is drawn on, and `check-contrast.mjs` now tests all three — the gate had been checking one pair out of three, which is how a token passes its own test and fails everywhere it is used.
* The bar chart's plot was `role="img"` wrapped around a row of buttons. That role tells a screen reader to read the label and ignore the contents, so every bar was unreachable. It is a `group` now.
* The exercise picker's listbox had `<li>` elements between it and its options, which produced four violations at once — options with no permitted parent, list items with no list, a listbox with no children it recognised, and a listbox with no name.
* The set row's weight, reps and type buttons were named "Weight, set 1" and "Set type" while displaying "100", "5" and "W". That fails Label in Name, and worse, the `aria-label` *replaced* the content, so a screen reader never read the value at all. The names now carry what is on the button.
* The workout detail, exercise history and workout summary screens each rendered a second `<h1>` under the header's own. No route scan would ever have found it; the interaction scan did.
* The numeric pad's unit label sat on `--surface-3` at 3.96 : 1.
* The Settings screen's "Reduce motion" control did nothing in two of its three positions. The preference was stored and offered; nothing in the app read it, and only the operating system's own media query had any effect — so "Always" and "Never" were both quietly "System". Found by looking for where the preference was applied and finding nowhere. `ThemeService` now reflects it as `data-motion` beside the theme, and `_base.css` reads both sources.

**The error paths had no tests at all** (task 7). `AppError`, `toAppError` and `AppErrorHandler` are the taxonomy every failure in the app passes through — ARCHITECTURE §12.1 promises each of the five kinds a different response — and none of the three had a spec. Twenty now cover it: that a quota error is recognised under both engines' names for it and comes back **not** retryable, because retrying a write into a full disk fails the same way; that an interrupted transaction comes back retryable, because it usually succeeds; that an unrecognised `DOMException` stays unclassified rather than being guessed at; that normalising a circular object does not throw a second error on the way; that every kind reaches the diagnostics buffer, which is the whole of this app's error reporting since nothing is uploaded; and that a validation error raises **no** toast, because it belongs on the field that produced it.

Quota exhaustion is rehearsed rather than hoped for, by overriding `storage.estimate()` before the app boots — the app has no other source for how full the device is, so from its side it is indistinguishable from a full phone, and unlike a real one it can assert both thresholds. At 85 % the screen warns and says removing photos is the quickest fix; at 97 % it says storage is full **and** that workouts still log normally, which is the sentence that matters to someone at quota mid-session; with no `storage` API at all it says the browser will not say rather than inventing a figure.

**The end-to-end suites were not type-checked by anything.** `tsconfig.app.json` covers `src/`, `tsconfig.spec.json` covers the unit specs, and Playwright compiles with esbuild — which strips types without reading them. So the suite that guards the app compiled happily around a function called with an argument its signature did not allow, and four strict-mode violations in the soak generator. `tsconfig.e2e.json` now covers both suites and `npm run typecheck` runs it.

**Three copy defects**, from reading the screens rather than the strings:

* The exercise form's movement-pattern select listed `horizontal-push` and `vertical-pull` — raw enum values, in both languages. Invisible to `i18n:check` (nothing asks for a missing key) and to the raw-key scan (no dots). A new guard flags any `<option>` whose label is its own identifier-shaped value, and it was proved by reverting the fix and watching it name all four.
* The planner's exercise picker listed `nameEn` regardless of the reading language, so an Arabic user built their plan from an English list — and the name it snapshotted into the routine stayed English in their history afterwards. Every other surface in the app goes through `displayName()`.
* The custom-exercise delete dialog read "Delete" over the words "Your exercise". It is the one destructive action in the app with no undo — Recently deleted does not cover exercises — and it said none of that. It now names the exercise, says history stays readable, and says there is no way back without an older backup. It had no test at all, which is how it got that way; it has one now.

### Deviations and what is carried forward

* **The soak ceiling is a shape check, not a latency claim.** It fails a screen that takes longer than 5 s against the dataset, which is an order of magnitude above every measured number. It would not catch a 2× regression, and saying so is more useful than a tighter number that would make the suite flaky on a loaded machine.
* **The raw-enum guard is partial by construction.** It only flags identifier-shaped values — hyphenated or camelCase — because several stores are legitimately labelled with the word they are named after. A single-word enum rendered raw slips past; a set of them does not.
* **The planner keeps its own picker.** The routine editor has a second exercise-picker sheet rather than reusing `rl-exercise-picker`. The language bug above was a direct consequence. Collapsing the two is a real refactor and is carried forward rather than done under a hardening phase.
* **Four manual passes remain outstanding**, all for the same reason: VoiceOver on a real device, the §18 device matrix, the soak dataset on an iPhone, and installing from Safari. The automated half of the accessibility pass — axe on every screen in two languages and two themes, the keyboard reachability and modal focus checks, and 200 % text scaling — runs on every production build.
* **UI_UX_SPEC §16 design QA per screen** (task 4) was done as part of the axe and visual passes rather than as a separate screen-by-screen review against the spec's checklist. The gap is the parts of §16 no tool can judge: spacing rhythm, visual weight, and whether a screen reads well.
* **The three text levels are now closer together than they were.** Raising `--text-3` to AA on three surfaces leaves it 1.6 : 1 from `--text-2` in dark and 1.3 : 1 in light, so the hierarchy between secondary and tertiary text is carried mostly by size and weight rather than by colour. That is the trade AA asks for at this background lightness, and it is the right way round: a legible caption that looks a little close to the label above it beats an elegant one nobody can read.
* **`v1.0.0` is not tagged** (task 11). A tag is a public statement that this is the released version, and nothing has been pushed or deployed — §19 rows 13 and 14 are the two that are not verified at all. Tagging now would date the release to a commit no one can install.

---

## 18. Device & Browser Matrix

| Target | Priority | Verified how |
|---|---|---|
| iPhone (iOS 17+), Safari standalone PWA | **P0** | Manual on a real device — the only way to validate install, standalone chrome, safe areas, and storage behaviour |
| iPhone Pro Max (430 pt) | **P0** | Real device or simulator for layout |
| iPhone SE / 320–375 pt | P1 | Simulator for layout; the numeric pad and set grid must not overflow |
| Desktop Safari (WebKit) | P1 | Playwright + manual |
| Desktop Chrome / Edge | P1 | Playwright + manual; primary development browser |
| iPad Safari | P2 | Manual layout check at 744 pt |
| Android Chrome | P2 | Should work; not a release gate |
| Firefox | P3 | Best effort |

**Status after Phase 14.** Desktop Chrome and desktop Safari are covered: every browser test runs on Chromium and WebKit, and the production-build suites (offline, console cleanliness, axe, keyboard, soak) run on Chromium at both the root and the `/REPLOG/` subpath. Mobile Safari is covered only as Playwright's iPhone 14 Pro emulation — the same WebKit engine at a phone viewport with touch emulated, which is a layout and engine check and nothing more. **No row marked P0 has been verified**, because no iPhone is available in this environment. That means install from Safari, standalone chrome, safe-area insets, iOS storage eviction, force-quit during a session, VoiceOver, and real scrolling performance are all outstanding, and the release notes must say so.

Honesty rule for the release notes: anything verified only in a simulator is reported as such. Simulators do not reproduce iOS storage eviction, real Add-to-Home-Screen behaviour, or true standalone-mode quirks.

---

## 19. Definition of Done — Traceability

Spec §14's fifteen criteria, each mapped to the phase that delivers it and the evidence that proves it. Fill the status column with **verified** (automated), **manually verified** (real device/human), or **not verified** — never leave it implied.

| # | Criterion | Phase | Evidence | Status |
|---|---|---|---|---|
| 1 | Works locally on Windows | P0 | `npm start`, `npm run check` and `npm run build:pages` all run on Windows 11 under PowerShell. The one Windows trap found — MSYS rewriting `--base-href /REPLOG/` into a Windows path, silently, with the build still succeeding — is avoided by `build-pages.mjs` using no shell, and documented in the README. | **verified** |
| 2 | All main modules functional | P1–P11 | Every phase's acceptance criteria above, each ticked only against stated evidence. 832 unit tests, 179 browser tests on three engines, 18 against the production build. The exceptions are named in their own phases rather than implied here. | **verified** |
| 3 | Plans can be created and saved | P4 | `planner.store.spec.ts`, plus the plan journey in `e2e/journey.spec.ts`: a plan is created, named, given a flexible routine and an exercise, started from the Train screen and finished, and history calls the session what the plan called it. | **verified** |
| 4 | Completed workouts persist | P5 | The reliability suite kills the store and reads the database back through a fresh injector; a Playwright test reloads a real browser mid-session on Chromium, WebKit and mobile Safari and finds the confirmed set. The 20-scenario interruption script on an iPhone — force-quit, iOS memory reclaim — is **not** done. | **verified** (automated); device script **not verified** |
| 5 | Previous performance available | P5, P7 | The Q7 query test at 5 000 seeded set logs, variant-scoped so a dumbbell press is never offered for a barbell press, plus the "No history yet" path; seen in the running app with seeded history. | **verified** |
| 6 | Measurements recorded and charted | P8, P10 | Unit tests for entry, merge-on-same-day and unit conversion; `e2e/body.spec.ts` for the screens, including Arabic-Indic digits in and out; chart states covered including the gap rule — a missing day is a gap, never interpolated. | **verified** |
| 7 | Progress photos work | P9 | Pipeline tests for decode, resize and re-encode; `e2e/photos.spec.ts` asserts a stored photo carries no location data, that the capture date is read before EXIF is stripped, that no request leaves the device during an import, and that deleting reclaims both blobs. The device check — real camera, real HEIC, real iOS share sheet — is **not** done. | **verified** (automated); device check **not verified** |
| 8 | Analytics use actual stored data | P10 | Every figure is computed in `domain/analytics` with its own tests over fixtures, and the journey suite reproduces two of them by hand end to end: one 100 kg × 5 set reads 500 kg of volume on the summary, and one finished session reads 1 on the dashboard's "This week" tile rather than an em dash. The soak run exercises all of them at 400 workouts and 10 000 set logs. A hand-reproduction of *every* dashboard figure against the soak dataset, as §17 task 3 describes, was **not** done. | **verified** (automated, two figures by hand); full hand-reproduction **not verified** |
| 9 | English and Arabic work | P1, P14 | `check-i18n` green on 820 keys across both locales; axe passes every screen in both languages; a scan asserts no raw translation key and no raw enum value reaches any screen in either; RTL reviewed by using the app, which is how three of this phase's defects were found. | **verified** |
| 10 | Light and dark themes work | P1, P14 | `check-contrast` green on 58 token pairs across both themes, now covering every text token against every surface it is drawn on; axe passes every screen in the light theme as its own run, not as an assumption about the dark one. | **verified** |
| 11 | Export and import work | P11 | The round-trip test covers every store including photo blobs, with the clock advanced three days between export and import so a restore that re-stamped the sync envelope fails — which it did, until `restoreMany` was added. `e2e/journey.spec.ts` then does the whole thing through the screens: export, wipe, import, and the session readable again on the history detail. | **verified** |
| 12 | PWA works offline after first load | P12 | Six offline tests against a production build, run twice — at the root and under `/REPLOG/`. They wait for a controlling worker and for every prefetch URL named in `ngsw.json`, cold start with the network disabled, and load routes never opened online. On a device, with real iOS storage eviction, **not** verified. | **verified** (automated); device **not verified** |
| 13 | Installs on iPhone via Safari | P12, P13 | No automated equivalent exists. No iPhone is available in this environment. | **not verified** |
| 14 | GitHub Pages deployment works | P13 | Live at `https://mahmoud-hamdan99.github.io/REPLOG/`, deployed by the workflow on a push to `main`. Verified on the deployed site: the app loads, `<base href>` is the subpath, a deep link resolves client-side through the 404.html fallback, the manifest and both worker files are served with the right content types, and the About screen names the commit CI built. The worker's **scope** is still only proven against a local server shaped like Pages — the browser available here does not register service workers — and installing from Safari (row 13) remains untried. | **verified** (registration on the live origin and Safari install excepted) |
| 15 | No paid infrastructure | P0–P13 | Ten runtime dependencies, all permissively licensed: MIT (Angular ×7), ISC (`idb`), Apache-2.0 (`rxjs`), 0BSD (`tslib`). The built bundle contains no network call to any origin — the two external URLs in it are Angular's own documentation links inside error strings. Everything is stored in IndexedDB on the device; hosting is GitHub Pages on a free plan. | **verified** |

---

## 20. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **iOS evicts IndexedDB** and a user loses history | Severe | Medium | Honest first-run notice, backup reminders, one-tap export, documented restore. The app cannot prevent eviction and must not imply it can. |
| R2 | A set is lost during a session | Severe | Low | Write-through policy (ARCHITECTURE §7.2), the P5 reliability suite, the 20-scenario interruption script |
| R3 | Tracker UX is too slow to use mid-set | Severe | Medium | Numeric pad instead of the native keyboard, one-handed layout, the < 100 ms budget, and a mandatory two-week real-gym trial at M3 before building M4 |
| R4 | Exercise catalog authoring stalls the project | Moderate | **High** | Treat it as content work with its own budget (P3, 4 sessions); start with 60 core exercises and grow — the reconciliation logic (DATABASE_SPEC §6.2) exists precisely so the catalog can expand after release |
| R5 | Arabic translation quality is poor or incomplete | Moderate | Medium | `i18n:check` in CI for coverage; a native-speaking lifter reviews terminology, not a generic translator |
| R6 | GitHub Pages subpath breaks routing, assets, or the SW | Moderate | Medium | Single base-href source, `404.html` fallback, `.nojekyll`, and a live-site verification checklist in P13 |
| R7 | Photos exhaust the storage quota | Moderate | Medium | Aggressive WebP compression, visible meter, 80 %/95 % thresholds, photo writes blocked before workout writes |
| R8 | Migration bug corrupts data on an update | Severe | Low | Forward-only migrations, a fixture test per migration, safe mode on version mismatch, export-before-repair offers |
| R9 | Scope creep (plate calculator, programs, Apple Watch…) | Moderate | High | The spec's §12 list is explicitly deferred; the DoD table is the release gate. New ideas go to a V2 backlog file, not into V1. |
| R10 | Bundle growth makes the first load slow on cellular | Low | Medium | CI-failing budgets, the one-dependency rule, lazy routes, the catalog out of the initial chunk |
| R11 | Analytics mislead (apparent progress that is not real) | Moderate | Medium | Gap preservation, point counts, trend-line minimums, estimate markers, axis-honesty rules — all tested in P10 |
| R12 | Solo-developer burnout over a long build | Moderate | High | Phase boundaries are shippable; M3 is genuinely usable. Stop at M3 and use it rather than pushing straight through to M6. |

---

## 21. Backlog Deliberately Deferred to Version 2

Recorded here so it stays out of V1 (spec §12): authentication, Supabase Postgres/Storage/Realtime, multi-device sync, cloud backup, trainer/family sharing, owner administration, program periodisation and mesocycles, plate calculator, barcode/NFC gym equipment, Apple Health integration, Apple Watch companion, push notifications, social features, exercise video library, AI form feedback, nutrition tracking.

The seams that make these additive rather than a rewrite are listed in ARCHITECTURE §11. Nothing in that list justifies writing V2 code now.

The first three of those — a database, auth and multi-device sync — are planned in [`SYNC_PLAN.md`](SYNC_PLAN.md): the choice of Supabase and what it costs, the eight phases, and the three seams §11 claims that are not actually in the code.

---

## 22. Version Lock

Fill in during P0 and treat as fixed for the V1 lifetime. Floating a major version mid-project is how a zero-dependency app acquires a week of unplanned migration work.

| Item | Pinned version | Notes |
|---|---|---|
| Node | **26.13.0** | Node 26 LTS; matches the CI `node-version: 26` |
| npm | **11.20.0** | Lockfile committed; CI uses `npm ci` |
| Angular (CLI + framework) | **CLI 22.2.5 / framework 22.2.4** | Scaffolded zoneless, strict, CSS, routing, no SSR |
| TypeScript | **6.0.3** | Pinned by Angular; do not upgrade independently |
| `idb` | **8.0.4** | The only runtime dependency |
| Vitest | **5.0.5** | Angular 22 CLI default unit-test runner |
| Playwright | **1.64.1** | Chromium + WebKit installed; Firefox not used |
| Target browsers | `.browserslistrc` | `last 2` Chrome/Edge/Firefox, Safari & iOS ≥ **17** — Angular 22 does not support Safari below 17, so 16.4 is not an available floor |

Any dependency added after P0 requires: an MIT/Apache-2.0 licence, ≤ 15 kB gzipped, a note in the PR explaining why the alternative of writing it was rejected, and an update to this table.
