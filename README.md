# REPLOG

A workout and strength tracker that keeps everything on your own device.

It is built for one person — you — logging sets in a gym, often with no
signal. There is no account, no server and nothing to sign up for. Your
training history lives in your browser's storage on the device you logged it
on, and the only copy that leaves is a backup file you export yourself.

English and Arabic, with full right-to-left layout. Dark and light. Designed
for an iPhone first and installable to the home screen.

**Using the app?** [**docs/USER_GUIDE.md**](docs/USER_GUIDE.md) is the complete
guide — every screen, every setting, how to back up, and what REPLOG
deliberately does not do. Everything below this line is for working on the code.

---

## What it does

- **Train** — a session tracker built for one-handed use between sets, with a
  rest timer that survives the phone locking, previous-performance figures on
  every row, and suggestions that are offered and never filled in for you.
- **Plan** — training plans and routines, with per-exercise targets that are
  snapshotted into a session so editing a plan never rewrites history.
- **Progress** — strength, volume and body charts that refuse to invent data:
  a week with no training is zero volume, a week with no weigh-in is a gap,
  and the two are drawn differently on purpose.
- **Records** — personal records detected per exercise _variant_, so a
  dumbbell press never beats a barbell press by accident.
- **Body** — measurements and progress photos, with location data stripped
  from every photo before it is stored.
- **Data** — export and import, an integrity check, a 30-day recovery list for
  anything deleted, and a storage meter that says "this browser will not say"
  rather than inventing a number.

## What it does not do

These are limits of the platform, not features waiting to be built. The app
says the same things on its About screen:

- **Nothing is uploaded.** There is no sync, no cloud and no account. A second
  device gets your history by importing a backup file you exported.
- **The browser can delete your data.** iOS may clear website data when
  storage runs low, and clearing site data or offloading the app removes it.
  `navigator.storage.persist()` is requested, and on iOS it is not granted.
  **Export a backup regularly** — the app will remind you.
- **Timers cannot alert you in the background.** They keep perfect time while
  REPLOG is open; iOS cannot notify you once the app is backgrounded or the
  screen is locked.
- **No notifications, no HealthKit, no Apple Watch, no background sync.**
  Haptics are used only where `navigator.vibrate` exists, which on iOS Safari
  it does not.

---

## Running it locally

Requires Node 22 or newer, and npm. CI pins 22.

```powershell
npm ci
```

```powershell
npm start
```

Then open `http://localhost:4200/`.

### Everyday commands

Run these from **PowerShell**, not Git Bash — see the warning below.

| Command               | What it does                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `npm start`           | Development server with hot reload                                                        |
| `npm run check`       | Everything CI runs: lint, styles, translations, contrast, catalog, types, tests, coverage |
| `npm test`            | Unit tests once                                                                           |
| `npm run test:watch`  | Unit tests in watch mode                                                                  |
| `npm run test:e2e`    | Playwright, across Chromium, WebKit and mobile Safari                                     |
| `npm run test:pwa`    | Everything that needs a real build: offline, console cleanliness, axe, keyboard, the soak |
| `npm run test:pages`  | The same, under the `/REPLOG/` subpath — the shape GitHub Pages serves. CI runs this one  |
| `npm run build:pages` | The deployable build, including `404.html` and `.nojekyll`                                |
| `npm run icons`       | Regenerates the icon set from `scripts/build-icons.mjs`                                   |
| `npm run format`      | Prettier over the repository                                                              |

### A warning about Git Bash on Windows

Git Bash rewrites POSIX-looking arguments into Windows paths. A command like
`ng build --base-href /REPLOG/` becomes `--base-href "C:/Program Files/Git/REPLOG/"`,
and **the build succeeds** — with that path baked into `<base href>` and into
the service worker's manifest. The site then 404s everything on deployment.

The npm scripts are safe because npm runs them through `cmd.exe`. If you must
run a command with a leading-slash argument by hand in Git Bash, prefix it:

```bash
MSYS_NO_PATHCONV=1 node scripts/serve-dist.mjs --base /REPLOG/
```

PowerShell has no such behaviour, which is why the table above assumes it.

---

## Deployment

Pushing to `main` builds and deploys to GitHub Pages at
`https://mahmoud-hamdan99.github.io/REPLOG/`. The workflow is
`.github/workflows/deploy.yml`, and it fails the deploy if any gate fails:
lint, styles, translations, contrast, the exercise catalog, types, the unit
suite, a check that the committed icons still match their generator, and the
offline suite run against the subpath build.

The repository subpath lives in exactly one place, `scripts/build-pages.mjs`.
Nothing else needs to know it: the manifest's `start_url`, `scope` and icon
paths are relative, so they resolve against wherever the manifest is served,
and the service worker's `navigationUrls` are matched inside its own scope,
which is the base href. To serve from a different repository name, override it:

```powershell
$env:BASE_HREF = "/REPLOG-staging/"; npm run build:pages
```

### One-time repository settings

These cannot be set from the repository contents and need doing once in the
GitHub web interface:

1. **Settings → Pages → Build and deployment → Source:** _GitHub Actions_.
   Without this the workflow runs and the deploy step fails.
2. **Settings → Environments → `github-pages`:** add the protection rules you
   want. Required reviewers here is what makes deployment an _approved_ push
   rather than an automatic one.
3. **Settings → Branches → branch protection on `main`:** require the deploy
   workflow's `build` job to pass before merging.

---

## Backing up your training

Settings → Data & backup.

- **Export** writes a readable JSON file containing everything, optionally
  including photos. Keep it anywhere you keep files you care about.
- **Import** reads one back in three steps: it tells you what the file
  contains and what is wrong with it, you choose _Merge_ or _Replace_, and
  only then is anything written. Replace takes a backup of your current data
  first, automatically.
- **Recently deleted** holds anything deleted in the last 30 days.
- **Check data integrity** looks for damage and offers to fix each finding
  separately, never all at once.

A backup file is the only copy of your training that survives a cleared
browser, a lost phone, or a reinstall. Nothing else in this app is a backup.

---

## How it is built

Angular with signals and standalone components, zoneless, strict TypeScript.
IndexedDB behind a repository contract, with every record carrying a
sync-ready envelope. Translations are runtime JSON with real plural rules for
both languages. No analytics, no trackers, no third-party requests at runtime.

### Accessibility

Held to WCAG AA, and checked rather than claimed. `npm run test:pwa` runs axe
over every screen in English and Arabic and in both themes, over the sheets and
detail screens a route list cannot reach, and then checks that the keyboard can
reach every control, that a modal keeps focus inside it, that nothing scrolls
sideways at 200 % text, and that the motion preference is honoured in all three
of its positions. `npm run check` holds every text colour to 4.5 : 1 against
every surface it is drawn on.

What that cannot cover is VoiceOver on a real iPhone, which is outstanding and
recorded as outstanding in the plan's §19.

The design documents in `docs/` are the specification and the record of what
was actually built, including what was left undone and why:

| Document                                                | What it covers                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)               | What the app is for and what it must do                                      |
| [`UI_UX_SPEC.md`](docs/UI_UX_SPEC.md)                   | Every screen, the component inventory, theming, accessibility                |
| [`DATABASE_SPEC.md`](docs/DATABASE_SPEC.md)             | Stores, indexes, queries, the backup format, destructive-action policy       |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md)               | Layering, data access, the tracker's reliability design, PWA and deployment  |
| [`IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | The phase plan, with acceptance criteria ticked only where there is evidence |
| [`USER_GUIDE.md`](docs/USER_GUIDE.md)                   | The end-user manual: every screen, every setting, backups, troubleshooting   |
| [`SYNC_PLAN.md`](docs/SYNC_PLAN.md)                     | Version 2: the database, auth and sync design, and what the free tier costs  |
