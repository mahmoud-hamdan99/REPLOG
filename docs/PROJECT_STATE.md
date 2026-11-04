# Project state and handover

Written to be read first by whoever — or whatever — picks REPLOG up next, with
no memory of how it got here. It says where the project stands, how it has been
worked on, and which of its hard-won lessons cost hours to learn.

Everything factual here was true at commit `75d7a66`, 5 November 2026. Where a
figure might drift, the command that produces it is given rather than the
number alone.

---

## 1. Where it stands

**Version 1 is complete and deployed.** Phases 0–14 of
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) are built, tested and
documented.

- **Live:** <https://mahmoud-hamdan99.github.io/REPLOG/>
- **Repository:** <https://github.com/mahmoud-hamdan99/REPLOG> — public, so
  GitHub Pages serves it on the free plan. A push to `main` deploys after every
  gate passes.
- **Not tagged.** `v1.0.0` is deliberately absent; see §5.

What the suites say, and the commands that say it:

| | Command |
|---|---|
| 832 unit tests, coverage above the 85 % floor | `npm run check` |
| 179 browser tests on Chromium, WebKit and mobile Safari | `npm run test:e2e` |
| 18 tests against a real production build | `npm run test:pwa` |
| The same 18 under the `/REPLOG/` subpath, as CI runs them | `npm run test:pages` |

---

## 2. How this project has been worked on

The method below produced every phase. It is not ceremony — each rule exists
because skipping it cost something.

### The unit of work is a phase

The user drives development with a single line: **"Start Phase N"**. That means
build every task in the phase, verify it, update the design docs, and commit —
not ask which parts to do, and not deliver a subset silently.

Read the phase's tasks **and** the spec sections it references before writing
code. The four specs in `docs/` are the specification; the plan is the order.

### Verify by exit code, never by reading output

`npm run check` either exits 0 or it does not. Grepping a log for "passed" has
twice here reported success over a failing run. Capture `$?`.

### Look at the running app, in both languages

Open it and use it, in English **and** in Arabic with the layout mirrored. This
has found a real defect in every single phase that compiling never would:
bidi-mangled callouts, mirrored inset arrows, clipped labels, an untranslated
confirmation gate, a picker listing English names in an Arabic interface.

`npm start`, then `/settings` to switch language.

### Prove a new regression test fails first

After writing a test for a bug, **revert the fix, watch the test fail, restore
it.** A `cp` backup or an inline `sed` is enough.

The reason this is a rule: the Phase 11 import was destroying `createdAt`,
`updatedAt` and `origin` on every restored record while the round-trip test
passed — because that test ran on a frozen clock with one device id, so every
envelope field coincided by accident. A test that cannot fail is documentation,
not a guard. Phase 14 found four more of the same shape.

Watch especially for frozen clocks and single-identity fixtures hiding time- and
origin-related bugs. Advance `FakeClock` across the operation under test.

### Tick a box only with evidence

An acceptance criterion gets `[x]` only when something was run and observed, and
the line says what. Otherwise it stays `[ ]` **with the reason written out**.
Unticked items across past phases are a trail, not a failure — ten of them are
live right now and every one names why.

Never write "verified" where "not verified, because no iPhone exists here" is
the truth.

### Re-verify the committed tree

A lint-staged pre-commit hook **reformats files after you have verified them**.
Run the gates again on the tree that actually landed, not the one you tested.

### Commits

Authored and pushed as Mahmoud Hamdan alone. **No Claude co-author line, no
"Generated with", no AI attribution anywhere in the repository** — asked for
explicitly, and it applies to commit messages, PR bodies and file contents
alike. If a harness adds an attribution footer by default, remove it.

GitHub links a commit to a profile by *email*. The commits use
`mahmoud.hamdan@acs-techs.com`; if they should display as
**@mahmoud-hamdan99**, that address needs adding to the GitHub account rather
than rewriting history.

Commit messages here are prose, not bullet lists: what changed, why, and what
is still not done.

---

## 3. Environment, and the traps in it

Windows 11, PowerShell, Node 22. A Bash tool is available and both get used.

**Git Bash rewrites absolute paths, silently, and the build still succeeds.**
MSYS turns `--base-href /REPLOG/` into `--base-href "C:/Program Files/Git/REPLOG/"`
and bakes that into `<base href>` and `ngsw.json`. This cost an hour twice —
once on the build, once on `serve-dist.mjs --base`. npm scripts are safe because
npm runs them through `cmd.exe`, and `build-pages.mjs` avoids the shell
entirely. Prefix with `MSYS_NO_PATHCONV=1` if you must.

**`gh` is not installed.** Use the GitHub REST API over `curl` for repository,
workflow and deployment state. Job *logs* need repo-admin auth and will 403;
deployment *statuses* are public and their timestamps are often enough to
diagnose a failure — a `deploy-pages` step that fails in seconds is a
configuration problem, one that fails after ten minutes is a timeout.

**`spawnSync` on `npx.cmd` throws `EINVAL`.** Node needs a shell for `.cmd`.
Invoke a CLI's JS entry point with `process.execPath` instead — see
`scripts/build-pages.mjs`.

**The in-app browser pane will not register service workers.** Anything about
offline behaviour has to run through Playwright's Chromium. This looked like an
app bug for a while; it is not.

**`page.waitForFunction` does not await an async predicate.** It resolves on the
first poll against a truthy Promise, so the assertion passes immediately and
proves nothing. Use `expect.poll` with `page.evaluate`.

**Three scripts are deliberately left unformatted** — `build-catalog.mjs`,
`check-i18n.mjs`, `stamp-build.mjs`. `npm run format` will reflow them and add
~120 lines of noise to an unrelated diff. Revert them unless you are actually
changing them.

**The coverage run can crash workers under machine load.** `0xC0000409` across
several workers means contention, not a defect; a quiet machine passes. Do not
run three dev servers alongside it.

---

## 4. The map

| Question | Document |
|---|---|
| What is the app for, and what must it do? | [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) |
| What does each screen look like, and what are the design tokens? | [`UI_UX_SPEC.md`](UI_UX_SPEC.md) |
| What are the stores, indexes, queries and the backup format? | [`DATABASE_SPEC.md`](DATABASE_SPEC.md) |
| How is the code layered, and why is the tracker built that way? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What was built, in what order, and what is still not verified? | [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) |
| How does somebody *use* the app? | [`USER_GUIDE.md`](USER_GUIDE.md) |
| How would a database and sync be added? | [`SYNC_PLAN.md`](SYNC_PLAN.md) |
| How do I run, build and deploy it? | [`../README.md`](../README.md) |
| What are the coding conventions? | [`../CLAUDE.md`](../CLAUDE.md) |

The plan's §19 is the honest scorecard: fifteen criteria, each marked verified,
partly verified or not verified, with the evidence named.

---

## 5. What is deliberately not done

Each of these is a decision, not an oversight. Reversing one is fine; assuming
it was forgotten is not.

- **`v1.0.0` is untagged.** A tag claims a released version. Now that the site is
  live this could reasonably be tagged — it was held back while nothing was
  deployed.
- **The exercise catalog has 168 entries, not the 180–260 targeted**, and 17 of
  them carry written instructions. Breadth was chosen over written content;
  the re-seed path exists to add more incrementally.
- **No drag-and-drop reordering.** Move up / move down only — the accessible
  alternative the spec required is the one that shipped.
- **The exercise list is not virtualised.** 168 plain rows render acceptably;
  the spec asks for virtualisation past 40 results and it is outstanding.
- **The planner has its own exercise picker**, duplicating `rl-exercise-picker`.
  Collapsing them is a real refactor, carried forward.
- **No unsaved-changes guard in the plan editor**, because every change writes
  through immediately and no work exists only in memory.

---

## 6. What cannot be verified here, and needs you

Everything in this list has one cause: **no iPhone and no human hands in this
environment.** They are the ten unticked boxes in the plan.

- Installing from Safari and launching standalone.
- Safe-area insets in standalone mode.
- The 20-scenario interruption script: force-quit mid-set, iOS memory reclaim.
- Scrolling at 60 fps, and the one-handed-reach claim.
- A real 12 MP photo through the pipeline.
- VoiceOver.
- The soak dataset's performance on a phone.
- Lighthouse against the deployed site.
- The service worker's scope on the live origin (the local suite proves it
  against a Pages-shaped server, which is a weaker claim).

If you are reading this *with* a phone to hand, these are the highest-value
hours available to this project. Each one is a box that can finally be ticked
with evidence instead of a reason.

---

## 7. What to do next

In rough order of value:

1. **Use it for a month.** It has never tracked a real training block. That will
   find more than any audit.
2. **Tick what the phone can now verify** (§6), and update §19.
3. **Tag `v1.0.0`** once the install path is confirmed on a device.
4. **Phases 15 and 16 of [`SYNC_PLAN.md`](SYNC_PLAN.md)** — the sync and auth
   interfaces, then the outbox. They need no account, no network and no new
   dependency, leave behaviour unchanged, and are the hard part of sync done
   where nothing can break yet.
5. The carried-forward items in §5, when they start to bite.

---

## 8. One thing to hold on to

The habit that produced this codebase, stated once:

**A green test suite is a claim, not a fact, until you have seen it fail for the
right reason.** Nearly every serious bug found in this project was one the
existing tests agreed with — an import destroying sync envelopes, a chart role
hiding its own buttons from screen readers, a caption colour failing contrast on
fourteen screens while the gate that checked it passed, a setting read by
nothing at all.

The app is honest with its user — it says what it cannot do, marks every
estimate, and refuses to draw a line through data it does not have. Hold the
code to the same standard it holds the interface.
