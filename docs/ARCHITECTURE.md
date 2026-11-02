# REPLOG — Technical Architecture

**Version:** 1.0
**Status:** Design baseline for Version 1
**Source of truth for requirements:** [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
**Companion documents:** [DATABASE_SPEC.md](DATABASE_SPEC.md) · [UI_UX_SPEC.md](UI_UX_SPEC.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

---

## 1. Architectural Goals

| # | Goal | Driven by | Consequence |
|---|---|---|---|
| G1 | Zero running cost, no backend in V1 | Spec §7, §10 | All state in IndexedDB + LocalStorage; static hosting only |
| G2 | Never lose a gym session | Spec §4.4, §8 | Write-through persistence on every set mutation; crash-safe resume |
| G3 | Sub-100 ms interaction during a workout | Spec §4.4 | In-memory signal store in front of IndexedDB; no network on critical path |
| G4 | Storage swappable for cloud later | Spec §7, §12 | Repository + Unit-of-Work abstraction; sync-ready record envelope |
| G5 | Business logic testable without a browser | Spec §13 | Pure `domain/` layer: no Angular, no IndexedDB, no DOM |
| G6 | Honest data | Spec §4.5, §4.9, §4.10 | Derived values carry an `isEstimate` provenance flag; no interpolation of missing data |
| G7 | Works offline, installs on iPhone | Spec §9 | Angular service worker, precached shell, subpath-safe manifest |
| G8 | Full EN/AR + LTR/RTL at runtime | Spec §6 | Runtime i18n service (not compile-time locale builds), logical CSS properties |

### Explicitly out of scope for V1

Authentication, cloud database, multi-device sync, sharing, push notifications, server-side anything. The architecture reserves seams for these (§11) but ships none of them.

---

## 2. Technology Decisions

| Concern | Decision | Rationale / alternatives rejected |
|---|---|---|
| Framework | **Angular 22.2.4** (pinned), standalone components only, no `NgModule` | Mandated by spec §10. Pinned at scaffold time and recorded in `IMPLEMENTATION_PLAN.md` §22. Never float the major. |
| Change detection | **Zoneless**; OnPush is the v22 default and is never written explicitly | Scaffolded via `ng new --zoneless`: Angular 22 leaves `zone.js` out of the dependency tree entirely, so there is no polyfill to strip and no migration to stage. Makes timer-heavy screens (the rest timer) cheap. Writing `changeDetection: OnPush` by hand is redundant in v22 and is forbidden by the project CLAUDE.md. |
| State | **Angular signals** + hand-written injectable stores | NgRx/NGXS add bundle weight and ceremony for a single-user offline app. `signal` / `computed` / `linkedSignal` / `effect` cover every case here. |
| Async data | `resource()` / explicit `async` loaders inside stores | No RxJS requirement in feature code; RxJS used only where streams are natural (timer, storage events). |
| Persistence | **IndexedDB** via [`idb`](https://github.com/jakearchibald/idb) (MIT, ~1 kB gz) behind our own repository layer | Hand-rolled IndexedDB wrapping is error-prone around transaction lifetimes. Dexie rejected: larger, and its own query DSL would leak through the repository boundary. |
| Preferences | **LocalStorage**, single namespaced JSON blob | Spec §7. Synchronous read at boot → no theme/direction flash. |
| Charts | **Bespoke SVG chart kit** in `shared/charts/` | Chart.js/ng2-charts are canvas-based: wrong typography, weak RTL, no theme-token awareness, ~60 kB. Our needs are 4 chart types (§UI_UX_SPEC §9) and SVG gives full token/RTL/a11y control at near-zero bundle cost. |
| i18n | **Runtime dictionary service**, JSON per locale, lazy-loaded | Angular's built-in `$localize` produces one build per locale — incompatible with runtime switching (spec §6) and doubles the GitHub Pages artifact. |
| Fonts | Self-hosted WOFF2, subset | Google Fonts CDN breaks the offline requirement (§9). |
| Dates | Native `Intl` + `Temporal` polyfill **only if needed**; otherwise ISO strings + small helpers in `domain/time` | No Luxon/date-fns needed; avoids 20–70 kB. |
| IDs | **UUIDv7** (time-sortable), tiny local implementation | Sortable keys give cheap chronological cursors and are collision-safe for future multi-device merge. |
| Testing | **Vitest 5.0.5** (the Angular 22 CLI default runner) for unit, **Playwright** (Chromium + WebKit) for E2E/PWA smoke | Both free, both run on Windows and in GitHub Actions. |
| CI/CD | GitHub Actions → GitHub Pages | Spec §11. |

**Dependency budget:** `idb` is the only runtime dependency beyond Angular itself. Any addition must be MIT/Apache-2.0, < 15 kB gzipped, and justified in the PR description.

---

## 3. Layered Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                         │
│  Routed feature pages · presentational components · shared UI kit     │
│  Reads signals, dispatches intents. No business rules, no storage.    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ signals in / method calls out
┌───────────────────────────────▼──────────────────────────────────────┐
│  APPLICATION (feature stores + orchestration services)                │
│  WorkoutSessionStore · PlannerStore · ProgressStore · SettingsStore   │
│  Owns UI-facing state, sequences repository calls, enforces           │
│  invariants that span aggregates, emits toasts/undo.                  │
└──────────────┬────────────────────────────────┬──────────────────────┘
               │ pure calls                     │ repository interfaces
┌──────────────▼───────────────┐  ┌─────────────▼──────────────────────┐
│  DOMAIN (pure TypeScript)     │  │  DATA ACCESS (abstraction)        │
│  Models · unit conversion ·   │  │  Repository<T> · UnitOfWork ·     │
│  e1RM · PR detection ·        │  │  Query objects · DbEvents         │
│  volume · consistency ·       │  └─────────────┬──────────────────────┘
│  progression suggestions ·    │                │ implemented by
│  import validation            │  ┌─────────────▼──────────────────────┐
│  No Angular. No IO. No DOM.   │  │  INFRASTRUCTURE                    │
└───────────────────────────────┘  │  IdbDatabase · idb repositories ·  │
                                   │  LocalStorage prefs · BlobStore ·  │
                                   │  FileExport · ServiceWorker glue   │
                                   └────────────────────────────────────┘
```

### Dependency rule

Arrows point **inward only**. Enforce mechanically:

* `domain/**` may import nothing but other `domain/**`. No `@angular/*`, no `idb`, no `window`.
* `data/**` declares interfaces; it must not import `infrastructure/**`.
* `features/**` must not import `infrastructure/**` — only interfaces + DI tokens.
* **UI components must never touch IndexedDB** (spec §7, hard requirement). A component importing `idb` or `IdbDatabase` is a build failure.

Enforced by an ESLint `no-restricted-imports` zone config (see §12.2) that runs in CI.

---

## 4. Source Layout

```
REPLOG/
├─ .github/workflows/deploy.yml        # build + deploy to Pages
├─ docs/                               # these specs
├─ public/
│  ├─ manifest.webmanifest
│  ├─ icons/                           # 180, 192, 256, 384, 512, maskable
│  ├─ splash/                          # optional iOS startup images
│  └─ exercise-art/                    # optional SVG illustrations
├─ src/
│  ├─ main.ts                          # bootstrapApplication
│  ├─ index.html
│  ├─ assets/fonts/                     # self-hosted woff2 + licences
│  ├─ styles/
│  │  ├─ _tokens.css                   # design tokens (UI_UX_SPEC §3)
│  │  ├─ _themes.css                   # light/dark/system
│  │  ├─ _base.css  _utilities.css
│  │  └─ styles.css                    # single global entry
│  └─ app/
│     ├─ app.config.ts                 # providers, router, SW, i18n bootstrap
│     ├─ app.routes.ts
│     ├─ app.component.ts              # shell: nav, safe areas, toaster
│     │
│     ├─ domain/                        # ← pure, framework-free
│     │  ├─ models/                     # Exercise, Plan, Routine, Workout, SetLog…
│     │  ├─ units/                      # kg↔lb, cm↔in, canonical storage rules
│     │  ├─ strength/                   # e1rm.ts, volume.ts, prs.ts, progression.ts
│     │  ├─ analytics/                  # series builders, bucketing, consistency
│     │  ├─ backup/                     # export envelope, import validator
│     │  ├─ time/                       # day keys, week keys, ranges, durations
│     │  └─ index.ts
│     │
│     ├─ data/                          # ← storage abstraction (interfaces only)
│     │  ├─ repository.ts               # Repository<T>, Query, Page
│     │  ├─ unit-of-work.ts             # UnitOfWork, TxScope
│     │  ├─ tokens.ts                   # InjectionTokens for every repository
│     │  ├─ db-events.ts                # change notification contract
│     │  └─ sync/                        # V2 seams: SyncEngine, Outbox, Clock
│     │
│     ├─ infrastructure/                # ← the only code that knows IndexedDB
│     │  ├─ idb/
│     │  │  ├─ schema.ts                # store + index definitions, DB_VERSION
│     │  │  ├─ migrations/               # v1.ts, v2.ts … one file per version
│     │  │  ├─ idb-database.ts           # open/upgrade/tx, quota handling
│     │  │  ├─ idb-repository.ts          # generic Repository<T> implementation
│     │  │  └─ repositories/              # per-aggregate specialisations
│     │  ├─ prefs/local-storage-prefs.ts
│     │  ├─ blobs/photo-blob-store.ts
│     │  ├─ files/file-io.ts              # download / pick / read JSON
│     │  └─ platform/                     # safe-area, wake-lock, haptics probes
│     │
│     ├─ core/                           # cross-cutting app services
│     │  ├─ i18n/                        # TranslationService, locales/*.json, dir
│     │  ├─ theme/theme.service.ts
│     │  ├─ settings/settings.store.ts
│     │  ├─ toast/  dialog/              # confirm, sheet, undo
│     │  ├─ errors/                      # ErrorHandler, AppError taxonomy
│     │  ├─ pwa/                         # update prompt, install hints, storage estimate
│     │  └─ nav/                         # bottom nav state, back behaviour
│     │
│     ├─ features/
│     │  ├─ dashboard/
│     │  ├─ planner/                    # plans, routines, routine editor
│     │  ├─ exercises/                  # library, filters, custom exercise CRUD
│     │  ├─ workout/                    # start, active tracker, summary
│     │  ├─ history/
│     │  ├─ body/                        # measurements + photos
│     │  ├─ progress/                    # analytics + records
│     │  └─ settings/
│     │
│     └─ shared/                         # presentational, zero business logic
│        ├─ ui/                          # button, card, sheet, chip, stepper…
│        ├─ charts/                      # line, bar, sparkline, distribution
│        ├─ forms/                       # numeric-pad, unit-input, date-field
│        └─ directives/ pipes/
└─ angular.json  package.json  tsconfig.json  eslint.config.js
```

Each `features/<name>/` folder holds `<name>.page.ts`, `<name>.store.ts`, local components, and `<name>.routes.ts`. Features never import each other's stores; shared needs move to `core/` or `domain/`.

---

## 5. Data Access Design

### 5.1 Record envelope

Every persisted entity carries a sync-ready envelope. This costs ~80 bytes per record in V1 and removes the need for a breaking migration in V2.

```ts
// domain/models/entity.ts
export interface Entity {
  readonly id: string;          // UUIDv7, time-sortable
  createdAt: string;            // ISO-8601 UTC
  updatedAt: string;            // ISO-8601 UTC — bumped on every write
  deletedAt: string | null;     // soft-delete tombstone (null = live)
  rev: number;                  // local revision counter, starts at 1
  origin: string;               // deviceId that last wrote (V2 conflict hints)
}
```

### 5.2 Repository contract

```ts
// data/repository.ts
/** Not IDBValidKey: a contract naming IndexedDB types is not replaceable. */
export type IndexKey = string | number | readonly (string | number)[];

export interface Query {
  index?: string;                      // named index on the store
  range?: { lower?: IndexKey; upper?: IndexKey; lowerOpen?: boolean; upperOpen?: boolean };
  equals?: IndexKey;
  direction?: 'next' | 'prev';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;            // default false
}

export interface Repository<T extends Entity> {
  /** Tombstoned records are hidden unless `includeDeleted` is passed. */
  get(id: string, options?: { includeDeleted?: boolean }): Promise<T | undefined>;
  list(query?: Query<T>): Promise<T[]>;
  count(query?: Query<T>): Promise<number>;
  /** Insert or full replace. Stamps updatedAt/rev/origin. */
  put(value: Draft<T>): Promise<T>;
  putMany(values: readonly Draft<T>[]): Promise<T[]>;
  /** Shallow field patch; throws if the record is missing. */
  patch(id: string, changes: Partial<Draft<T>>): Promise<T>;
  /** Soft delete by default; hard delete only for data reset / import replace. */
  remove(id: string, opts?: { hard?: boolean }): Promise<void>;
  clear(): Promise<void>;
}
```

`Draft<T> = Omit<T, 'createdAt' | 'updatedAt' | 'rev' | 'origin' | 'id' | 'deletedAt'> & { id?: string; deletedAt?: string | null }` — callers never hand-write envelope fields, and `deletedAt` is omitted too so an ordinary insert does not have to state that it is not deleted.

One `InjectionToken<Repository<X>>` per aggregate lives in `data/tokens.ts`. Stores inject tokens, so tests provide in-memory fakes with no IndexedDB and no fake-indexeddb shim.

### 5.3 Unit of Work

Multi-store writes must be atomic (finishing a workout touches `workouts`, `workoutExercises`, `setLogs`, `personalRecords`, `appMeta`). IndexedDB transactions auto-commit when the microtask queue drains, so the abstraction must own the whole critical section.

```ts
// data/unit-of-work.ts
export interface UnitOfWork {
  run<R>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    work: (tx: TxScope) => Promise<R>,
  ): Promise<R>;
}

export interface TxScope {
  // Keyed by store name rather than by DI token: the transaction is already
  // scoped to a fixed set of stores, and a `StoreEntityMap` gives the same
  // type safety without threading an Injector through a transaction.
  repo<N extends EntityStoreName>(store: N): Repository<StoreEntityMap[N]>;
  // appMeta is not an Entity store, but some of its pointers must move
  // atomically with the records they point at: clearing `activeWorkoutId` is
  // part of finishing a workout, and a pointer cleared by a transaction that
  // then rolls back would orphan a live session.
  appMeta(): TxAppMeta;
  /** Registered callbacks fire only after the transaction commits. */
  onCommit(fn: () => void): void;
}
```

Rules:

1. No `await` on anything other than `TxScope` calls inside `work` — awaiting a fetch or a `setTimeout` kills the transaction.
2. Change notifications and toasts fire from `onCommit`, never mid-transaction.
3. A failed transaction rolls back wholly; the application store keeps its previous snapshot and surfaces a retryable error.
4. Every store a transaction will touch is declared when it opens. Asking a `TxScope` for an undeclared store throws immediately, which surfaces the mistake at the call that made it rather than at some later line.
5. `tx.done`'s rejection is claimed as soon as the transaction opens. Aborting makes it reject, and an unclaimed rejection surfaces as an unhandled promise rejection that has nothing to do with the real failure.

### 5.4 Change notification

`DbEvents` publishes `{ store, ids, kind: 'put' | 'remove' | 'bulk' }` after commit. Stores that cache lists subscribe and invalidate. A `BroadcastChannel('replog-db')` relay keeps two open tabs consistent; the active-workout store additionally refuses to take over a session owned by another tab (§7.4).

### 5.5 Canonical units

**Storage is always metric: kilograms, centimetres, Celsius-free.** Conversion happens at the presentation edge only (`shared/forms/unit-input`, `domain/units`). This is non-negotiable: it keeps analytics, PR comparison, and export portable when the user flips units mid-history.

* Display rounding: kg → 0.25 steps, lb → 0.5 steps, cm → 0.1, in → 0.25.
* Round-trip rule: `toDisplay(toCanonical(x)) === x` must hold for every step value in the input grid — covered by a property test.
* Stored numbers keep full precision; rounding is a view concern.

---

## 6. Domain Layer

Pure, dependency-free, 100 % unit-tested. The functions the rest of the app is not allowed to reimplement:

| Module | Responsibility | Notes |
|---|---|---|
| `units/` | kg↔lb, cm↔in, canonical/display conversion, step grids | Property-tested round-trips |
| `strength/e1rm.ts` | Estimated 1RM | **Epley** `w × (1 + reps/30)` as default, Brzycki offered in settings. Returns `{ value, formula, isEstimate: true }`. Only valid for 1–12 reps; above that returns `null` rather than a fabricated number (spec §4.9 "do not fabricate"). |
| `strength/volume.ts` | Set/session/period volume = Σ(weight × reps) over **working sets only**; warm-ups excluded and the exclusion is stated in the UI | |
| `strength/prs.ts` | PR detection and classification | Compares within a **variant key** (§6.1) so a dumbbell press never beats a barbell press |
| `strength/progression.ts` | Next-session suggestions | Pure function of history; returns a reason string for display |
| `analytics/` | Series building, bucketing (day/week/month), consistency %, muscle distribution | Gaps stay gaps: returns `null` points, never interpolated values |
| `backup/` | Export envelope construction, import schema validation, dry-run diff | Validator returns a structured report, not a boolean |
| `time/` | `dayKey` (`YYYY-MM-DD`, local), `weekKey` (ISO week), range math, duration formatting | All comparisons on local day keys to avoid UTC off-by-one |

### 6.1 Variant key — the honesty mechanism for PRs

Spec §4.10 forbids comparing incompatible variations without making the distinction clear. Implementation:

```ts
variantKey(exercise) = `${exercise.id}|${exercise.equipment}|${exercise.laterality}`
```

PRs, "previous performance", and progression suggestions are all scoped to the variant key. When the UI shows a comparison that crosses variant keys (for example an exercise-family view), it is labelled as a family rollup and PR badges are suppressed.

### 6.2 Suggestion engine rules

```
Given: last N completed sessions for variantKey, target rep range, user preference
Produce: { suggestedWeightKg, suggestedReps, confidence, reason, isEstimate: true }
```

* If the last session hit the top of the rep range on all working sets → suggest +2.5 kg (upper body) / +5 kg (lower body), clamped to the equipment's smallest increment.
* If the last session missed the bottom of the range on 2+ sets → suggest a 5–10 % deload and say so.
* Otherwise → repeat last load, suggest +1 rep.
* Fewer than 1 prior session → **no suggestion**, show "No history yet".
* Suggestions are *never* written into a plan or prefilled as a committed value. They render as ghost text the user must accept (spec §4.5). Every suggestion surface shows the `reason` and an estimate marker.

---

## 7. Active Workout Tracker — Reliability Design

This is the module the product lives or dies on (spec §4.4). Its reliability contract:

> A set that the user has confirmed must survive an app kill, a Safari tab purge, an iOS memory reclaim, and a cold boot, with no more than the one in-flight edit lost.

### 7.1 Single source of truth

The active session is **not** a separate shadow format. It is a normal `workouts` record with `status: 'active' | 'paused'` plus its `workoutExercises` and `setLogs`. A pointer `appMeta.activeWorkoutId` identifies it. Benefits: no duplicated schema, no reconciliation on finish, history queries already work, and crash recovery is just "load the pointer".

### 7.2 Write policy

| Trigger | Write |
|---|---|
| Set confirmed (the user taps the check) | **Immediate, synchronous-to-the-user** `setLogs.put` inside a UoW; the row shows a committed state only after `onCommit` |
| Field typing (weight/reps mid-edit) | Debounced 400 ms draft write to the same record with `isCompleted: false` |
| Add/remove/reorder exercise, superset change | Immediate |
| Rest timer start/stop | Immediate, to `appMeta.activeRest` (timestamps, see §7.3) |
| Notes, RPE/RIR | Debounced 600 ms |
| Pause/resume | Immediate, appended to `pauses[]` |
| Any mutation | `workouts.updatedAt` bumped; `durationSec`/`totalVolumeKg` recomputed in memory, persisted on pause/finish |

Writes are queued through a serial write lane so a burst of taps cannot interleave transactions.

### 7.3 Timers are timestamps, not counters

iOS throttles and suspends JavaScript timers in background tabs; a decrementing counter would drift or freeze. Therefore:

* The rest timer stores `startedAt` (epoch ms) and `targetSec`, in `appMeta.activeRest` so a long rest survives a tab purge. The UI re-reads the clock every 250 ms while resting and every second otherwise — intervals rather than animation frames, because a frame is exactly what a throttled tab stops delivering. A rest that elapsed while the app was closed is restored already acknowledged: a cue for something that finished hours ago is noise, not information.
* Workout duration = `(now - startedAt) - Σ(pause durations)`, computed on read.
* On `visibilitychange → visible`, recompute everything from timestamps. Elapsed-while-backgrounded is therefore always correct.
* **Honest limitation to document in-app (spec §9):** when the PWA is backgrounded or the screen is locked, iOS gives no reliable way to fire a rest-timer alert. The app offers Screen Wake Lock where available (`'wakeLock' in navigator`, iOS 16.4+) and an in-app audible/visual cue while foregrounded; it does not promise background notifications.

### 7.4 Interruption protection

* **Route guard** (`CanDeactivate`) on `/train/active`: leaving requires an explicit choice — *Keep training* / *Pause and exit* / *Discard workout* (discard is a destructive confirm).
* **`beforeunload`** handler armed only while an active session has uncommitted drafts. Safari's dialog is non-customisable; treat it as a backstop, not the primary protection.
* **`visibilitychange → hidden`**: flush all pending debounces immediately.
* **`pagehide`**: final flush; on iOS this is the last reliable hook before eviction.
* **Cold start**: the tracker reads `activeWorkoutId` when it loads. If it finds a session *it did not start*, it shows a non-dismissible *Resume workout* prompt with elapsed time and completed sets, offering Resume / Finish now / Discard. Never silently resumes, never silently discards. "Did not start" is the load-bearing part: the Train screen loads in the background while the user starts a workout, and without that check a slow device lands them on "Resume your workout?" for the one they just began.
  * Implemented on the tracker screen rather than in the shell, as the plan first sketched. The behaviour is the same and the mechanism is local to the feature, which keeps tracker code out of the eagerly loaded shell bundle.
* **Second tab**: the store writes `{ tabId, heartbeatAt }` to the session. Another tab opening the same session shows a read-only banner ("This workout is open in another tab") rather than racing writes. A heartbeat older than 45 s means that tab is gone and ownership can be claimed, so a crash does not lock the user out of their own session.
* **Tab identity** comes from `sessionStorage` (`TAB_IDENTITY`), not from a fresh id per load. It has exactly the lifetime wanted: scoped to one tab, surviving that tab's reload, absent in a newly opened one. A generated-per-load id would make every refresh look like a second tab and lock the user out of their own workout for the heartbeat window.

### 7.5 Finishing a workout

One `UnitOfWork.run(['workouts','workoutExercises','setLogs','personalRecords','appMeta'], 'readwrite')`:

1. Drop empty/uncompleted trailing sets (with a count shown in the summary — nothing deleted silently).
2. Compute `durationSec`, `totalVolumeKg`, `totalSets`, `totalReps`.
3. Set `status: 'completed'`, `finishedAt`.
4. Run PR detection over the session's working sets through the `PR_DETECTOR` contract; upsert `personalRecords` with `previousValue` retained so history reads as a progression, not an overwrite. Detection itself is Phase 7 work, so the token is bound to a no-op until then — but it is declared and called from inside the transaction now, because that is the part that cannot be retrofitted.
5. Clear `appMeta.activeWorkoutId`.
6. `onCommit` → navigate to the summary screen, announce new PRs.

If step 4 throws, the whole transaction rolls back and the session stays active and intact. PR detection is never allowed to destroy a logged workout, and a test with a deliberately exploding detector pins that down.

Rows that were never confirmed are hard-deleted rather than tombstoned: a row the user did not log is not history, and a tombstone would leave it to be "recovered" into a session that never contained it. The count is stated in the finish confirmation before anything is removed, and again on the summary.

### 7.6 Template-vs-history immutability

Spec §4.6: editing a plan must never alter recorded history. Enforced by **snapshotting**: when a workout starts, the routine's relevant fields are copied into `workouts.planSnapshot` and each `workoutExercises.targetSnapshot`. Workout records hold `planId`/`routineId` only as a *provenance reference*, and every read path renders from the snapshot. Deleting a routine therefore cannot orphan or mutate history; the history screen shows the snapshot name with a "plan no longer exists" note where relevant.

---

## 8. Application State

### 8.1 Store pattern

```ts
@Service() // Angular 22: an auto-provided root singleton
export class MeasurementsStore {
  private readonly repo = inject(MEASUREMENTS_REPO);
  private readonly _items = signal<Measurement[] | null>(null);   // null = not loaded
  private readonly _status = signal<'idle'|'loading'|'ready'|'error'>('idle');

  readonly items   = this._items.asReadonly();
  readonly status  = this._status.asReadonly();
  readonly latest  = computed(() => this._items()?.at(-1) ?? null);
  readonly weightSeries = computed(() => buildWeightSeries(this._items() ?? []));  // domain fn

  async load(): Promise<void> { /* guard against concurrent loads, set status */ }
  async upsert(draft: Draft<Measurement>): Promise<void> { /* repo.put → optimistic patch → DbEvents */ }
}
```

Conventions:

* Private writable signals, public readonly views. Components never mutate store state directly.
* Every async method is idempotent and re-entrancy safe.
* Derived values come from `domain/` functions so the maths is tested without the store.
* `null` means "not loaded"; an empty array means "loaded, genuinely empty". The UI renders different states for each (UI_UX_SPEC §11).
* Stores are declared with `@Service()`, Angular 22's auto-provided root singleton. `@Injectable({ providedIn: 'root' })` survives only where a class is bound to a token it does not own, such as the `ErrorHandler` and the router strategies. `WorkoutSessionStore` is root-scoped but explicitly `reset()`-able.

### 8.2 Store inventory

| Store | Owns | Lifetime |
|---|---|---|
| `SettingsStore` | Prefs (language, theme, units, default rest, tracking mode), profile | App |
| `ExerciseLibraryStore` | Catalog + custom exercises, filter state, search index | App (lazy load) |
| `PlannerStore` | Plans, routines, active plan, editor draft | App |
| `WorkoutSessionStore` | The one active session, timers, per-set edit state | App, resettable |
| `HistoryStore` | Paged completed workouts, per-exercise history cache | App |
| `MeasurementsStore` | Measurements, custom definitions, series | App |
| `PhotosStore` | Photo metadata, object-URL lifecycle, compare selection | Route |
| `ProgressStore` | Analytics ranges, computed series, muscle distribution | Route |
| `RecordsStore` | PR list and PR history | App |
| `BackupStore` | Export/import progress, validation report | Route |

`PhotosStore` must `URL.revokeObjectURL` on every replaced or discarded blob URL — tracked in a `Map<id, string>` released in `ngOnDestroy`/`DestroyRef`. Leaking object URLs pins blobs in memory and is a known iOS crash vector on photo-heavy galleries.

---

## 9. Routing

Hash-free path routing with a GitHub Pages `404.html` fallback (§10.3).

| Path | Screen | Notes |
|---|---|---|
| `/` | Dashboard | Eager (part of the shell chunk) |
| `/plans` | Plan list | lazy |
| `/plans/:planId` | Plan detail (routines, weekday assignment) | lazy |
| `/plans/:planId/routines/:routineId` | Routine editor | lazy |
| `/exercises` | Library (filters, search) | lazy |
| `/exercises/new`, `/exercises/:id` | Custom exercise editor / detail | lazy |
| `/train` | Start screen (today's routine, pick routine, quick start) | lazy |
| `/train/active` | **Active tracker** | lazy, `activeSessionGuard` (redirects to `/train` with no session), `CanDeactivate` |
| `/train/summary/:workoutId` | Post-workout summary | lazy |
| `/history` | Chronological list | lazy |
| `/history/:workoutId` | Workout detail (read-only snapshot) | lazy |
| `/progress` | Analytics hub — tabs: Strength · Volume · Body · Photos · Records | lazy |
| `/progress/exercise/:exerciseId` | Per-exercise progression | lazy |
| `/body` | Measurements list + entry | lazy |
| `/settings` + `/settings/{profile,appearance,units,workout,data,about}` | Settings | lazy |
| `**` | Not found page | A 404 screen rather than a silent redirect: a broken link should be visible, not swallowed |

Bottom navigation exposes five destinations (Home · Plans · **Train** · Progress · More); the full map above is reachable from them. Tab state is preserved per destination; the tracker is modal-feeling and deliberately sits outside tab navigation.

Route-level `data: { title, navTab, hideNav }` drives the shell. Preloading: `/train` and `/train/active` are preloaded after idle, because a user opening the app at the gym almost always goes there.

---

## 10. PWA, Build & Deployment

### 10.1 Service worker

Angular's service worker (`@angular/pwa`) with a tuned `ngsw-config.json`:

* **`prefetch` asset group** — app shell, JS/CSS, fonts, icons, locale JSON, exercise illustrations under a size cap. Offline on first load after install.
* **`lazy` + `updateMode: prefetch`** for optional illustration packs.
* **No `dataGroups`** — there is no network data in V1. Explicitly empty, with a comment, so nobody adds caching for an API that does not exist.
* `navigationUrls` must respect the repository subpath (`/REPLOG/**`, excluding `/REPLOG/assets/**`).

Update handling (spec §9 "handle application updates correctly"):

```
SwUpdate.versionUpdates
  → VERSION_READY  → if an active workout is running: hold the update, show a quiet badge in More;
                      otherwise show a non-blocking "Update ready — Reload" toast.
  → VERSION_INSTALLATION_FAILED → log, keep running the current version.
UnrecoverableStateError → full-reload prompt explaining that cached files are damaged;
                          user data in IndexedDB is untouched and must be shown to be safe.
```

Never auto-reload. Reloading mid-set would violate G2.

### 10.2 Manifest & iOS specifics

```json
{
  "name": "REPLOG — Workout Tracker",
  "short_name": "REPLOG",
  "start_url": "/REPLOG/",
  "scope": "/REPLOG/",
  "display": "standalone",
  "background_color": "#0B0C0E",
  "theme_color": "#0B0C0E",
  "orientation": "portrait",
  "lang": "en",
  "dir": "auto",
  "icons": [ /* 192, 256, 384, 512 + maskable 512 */ ]
}
```

`index.html` additionally needs `apple-touch-icon` (180×180, no transparency — iOS does not apply maskable icons), `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `apple-mobile-web-app-title`, and `viewport-fit=cover` for safe-area insets.

Honest iOS statements for the About screen (spec §9 forbids claiming unsupported capabilities):

* Installation is via Safari → Share → **Add to Home Screen**; there is no install prompt API on iOS.
* Storage is subject to eviction by iOS; `navigator.storage.persist()` is requested but **not granted** on iOS. Backups are therefore mandatory, not optional — surfaced as a recurring reminder (§DATABASE_SPEC §9.4).
* No background sync, no background rest-timer notifications, no HealthKit, no haptics (`navigator.vibrate` is unavailable in iOS Safari — feature-detect and degrade to visual feedback).

### 10.3 GitHub Pages under a subpath

| Problem | Solution |
|---|---|
| App served from `/REPOSITORY-NAME/` | Build with `--base-href /REPOSITORY-NAME/`; all asset refs relative or base-href-derived. Never hardcode a leading `/`. |
| Deep links 404 on static hosting | Copy `index.html` → `404.html` in the deploy job. GitHub Pages serves it for unknown paths with a 404 status; Angular's router then resolves the URL client-side. |
| Jekyll strips `_`-prefixed files | Add an empty `.nojekyll` to the artifact. |
| Service worker scope | Scope is the base href; `start_url` and `scope` in the manifest must both include the subpath. |
| Hard-coded absolute URLs in the manifest | Generate/patch the manifest at build time from the configured base href. |
| Router base | `provideRouter` + `APP_BASE_HREF` from `<base href>` injected by the CLI. |

A single `BASE_HREF` value feeds the build flag, manifest, and SW config. It lives in one place (`scripts/set-base-href.mjs`, run in CI) so staging under a different repo name is a one-variable change.

### 10.4 CI/CD

`.github/workflows/deploy.yml`, triggered on push to `main` and `workflow_dispatch`:

```
checkout → setup-node (pinned, npm cache) → npm ci
  → lint → typecheck (tsc --noEmit) → unit tests → build --configuration production
  → patch manifest + base href → copy index.html → 404.html → touch .nojekyll
  → upload-pages-artifact → deploy-pages (environment: github-pages)
```

Permissions: `contents: read`, `pages: write`, `id-token: write`. Concurrency group `pages` with `cancel-in-progress: false`. A failing lint/test/build fails the deploy — spec §13 requires a green production build before release. "Automatic deployment on approved pushes" (§11) is satisfied by requiring PR review on `main` plus the `github-pages` environment's protection rules.

### 10.5 Performance budgets

| Metric | Budget | Enforcement |
|---|---|---|
| Initial JS (gz) | ≤ 180 kB | `angular.json` budgets, CI-failing |
| Initial CSS (gz) | ≤ 25 kB | budgets |
| Largest lazy chunk (gz) | ≤ 90 kB | budgets |
| Exercise catalog payload (gz) | ≤ 60 kB | lazy-loaded, never in the initial chunk |
| First Contentful Paint, iPhone 4G | < 1.5 s | Lighthouse CI (informational) |
| Set-confirm → committed UI | < 100 ms p95 | manual instrumentation in dev builds |

Angular's `budgets` measure **raw** bundle size, not compressed, so the configured thresholds are raw equivalents: `initial` 500 kB warning / 600 kB error, and 250 kB / 350 kB for any single chunk. At the ratio this project actually compresses at (~3.6x), a 600 kB raw initial bundle is roughly 165 kB gzipped, which keeps the real 180 kB gz target with headroom. Scaffold baseline for reference: **190.87 kB raw / 52.21 kB gzipped**.

---

## 11. Seams for Version 2

No V2 code ships, but these boundaries exist so V2 is additive:

| V2 need | Seam present in V1 |
|---|---|
| Cloud database | `Repository<T>` interface; a `SupabaseRepository<T>` can be provided against the same tokens. Stores are unchanged. |
| Sync | Record envelope (`updatedAt`, `rev`, `origin`, `deletedAt` tombstones) + a declared-but-unused `outbox` store + `data/sync/sync-engine.ts` interface (`push`, `pull`, `resolve`). Soft deletes mean deletions can replicate. |
| Multi-device conflict resolution | `rev` + `origin` + per-field `updatedAt` on high-contention records (profile, prefs). Documented LWW-with-tombstones default. |
| Auth | `AuthProvider` interface (`currentUser()`, `signIn()`, `signOut()`) with a `LocalOnlyAuthProvider` implementation returning a fixed local owner. All records already carry an `ownerId`-shaped slot via `origin`; a `userId` column is added by migration, defaulting to the local owner. |
| Storage for photos | `PhotoBlobStore` interface; V1 implementation is IndexedDB, V2 can be Supabase Storage with the same contract and a local cache. |
| Realtime | `DbEvents` already decouples writes from UI invalidation; a remote event source plugs into the same channel. |
| Sharing / trainer access | Aggregates are already id-addressable with no cross-aggregate foreign-key cascades, so scoping by owner is a filter, not a rewrite. |

**Non-goal:** do not build abstraction for abstraction's sake. Any seam not listed here should be added when V2 actually needs it.

---

## 12. Cross-Cutting Concerns

### 12.1 Error handling

```
AppError
├─ StorageError        (quota exceeded, blocked upgrade, aborted tx)   → retry + backup prompt
├─ MigrationError      (upgrade failed)                                 → safe mode, export-only UI
├─ ValidationError     (import/schema/form)                             → field-level messages
├─ NotFoundError       (dangling id)                                    → graceful empty state
└─ UnexpectedError                                                       → toast + copyable detail
```

A custom `ErrorHandler` maps throwables to `AppError`, logs to an in-memory ring buffer (viewable in Settings → About → Diagnostics, copy to clipboard), and shows a human message. No analytics, no telemetry, no network. `QuotaExceededError` gets dedicated treatment: block new photo writes, keep workout logging alive, and push the user to export and prune photos.

### 12.2 Lint-enforced boundaries

```js
// eslint.config.js (excerpt)
'no-restricted-imports': ['error', { patterns: [
  { group: ['**/infrastructure/**'], message: 'Features must depend on data/ interfaces, not infrastructure.' },
  { group: ['idb', 'idb/*'],          message: 'Only infrastructure/idb may import idb.' },
]}],
```
plus a stricter override block for `src/app/domain/**` forbidding `@angular/*`, `idb`, and `rxjs`. CI runs `npm run lint` and fails the build.

### 12.3 Internationalisation mechanics

* `I18n` derives the locale as a `computed` over `SettingsStore`, lazily imports `locales/<locale>.json` as its own chunk, and exposes `t(key, params?)` plus `formatNumber`.
* **`t()` is called directly from templates; there is no `TranslatePipe`.** A *pure* pipe memoises on its arguments, so it would not re-run when only the locale signal changed, and the original plan here was simply wrong. Calling `t()` in a template registers a read of the locale and dictionary signals against that component's reactive consumer, which is what makes language switching instant and reload-free. An impure pipe would also work, at the cost of running on every change detection.
* Keys are dot-namespaced by feature (`workout.set.markComplete`). A CI script diffs `en.json` against `ar.json` and fails on missing or orphaned keys — this is how §6 "complete translation coverage" becomes enforceable.
* A dev-mode lint rule flags literal strings in templates (spec §6 "no hardcoded user-facing strings").
* `document.documentElement.lang` and `dir` are set from the locale signal; direction changes require no reload.
* Numbers, dates, and relative times go through `Intl` with the active locale. Arabic uses Western (`latn`) digits by default with an optional `arab` numeral preference, because gym numbers are read fast and mixed numerals are error-prone.
* Layout uses CSS logical properties exclusively (`margin-inline-start`, `inset-inline-end`, `padding-block`) — see UI_UX_SPEC §12 for the mirroring rules, including which icons must *not* flip.

### 12.4 Accessibility

Minimum 44×44 pt touch targets, 4.5:1 text contrast in both themes (token pairs pre-validated in UI_UX_SPEC §3.2), visible focus rings, `prefers-reduced-motion` honoured, semantic landmarks, live-region announcements for set completion / PR / timer end, and full keyboard operability on desktop. The numeric pad is an accessible dialog with real input semantics, not a div grid.

### 12.5 Security & privacy posture

No network calls at runtime; no third-party scripts; no analytics. A strict CSP in two parts, since GitHub Pages cannot set headers. Script protection comes from the builder's `security.autoCsp`, enabled for the production configuration, which emits a hash-based `script-src` covering the inline pre-paint script in `index.html`. A hand-written `<meta http-equiv>` supplies the rest: `img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`. That meta deliberately omits `default-src`, `script-src` and `style-src`, because two policies intersect per directive: a `default-src` here would override autoCsp's hashes, and **`style-src 'self'` is not achievable at all** since Angular injects component styles as inline `<style>` elements. Imported JSON is parsed and validated, never `eval`'d; imported strings are rendered as text (Angular's default escaping) and never through `innerHTML`/`bypassSecurityTrust*`. Photos never leave the device.

---

## 13. Testing Strategy

| Layer | Tooling | What is tested | Target |
|---|---|---|---|
| Domain | Vitest, pure functions | e1RM edge cases, unit round-trips, PR detection across variants, volume with warm-ups, consistency with gaps, import validator | **≥ 95 % lines**, mandatory |
| Repositories | Vitest + `fake-indexeddb` | CRUD, indexes, soft delete, every migration path v(n-1)→v(n) with realistic fixtures | ≥ 85 % |
| Stores | Vitest with in-memory repository fakes | Active-session write policy, resume flows, optimistic update + rollback | ≥ 80 % |
| Components | Angular TestBed | Critical only: set row, numeric pad, rest timer, confirm dialogs | smoke |
| E2E | Playwright (Chromium + WebKit) | Plan → train → finish → history → analytics; export → reset → import; language + theme switch; offline reload | 8–10 journeys |
| PWA | Playwright offline mode + manual iOS device pass | Install, standalone launch, offline cold start, update prompt | checklist |

Spec §13 requires distinguishing tested from untested functionality: the release checklist in IMPLEMENTATION_PLAN §9 has an explicit **"verified on a real iPhone"** column, and anything not verifiable in CI (true Safari standalone behaviour, iOS storage eviction, Add to Home Screen) is marked as manually verified or not verified, never implied.

---

## 14. Decision Log

| ID | Decision | Alternative | Why |
|---|---|---|---|
| D1 | Signals-only state, no NgRx | NgRx Store/Signals | Single-user offline app; bundle and ceremony not justified |
| D2 | `idb` behind our repository layer | Dexie; raw IndexedDB | Dexie's DSL would leak through the abstraction; raw IDB is transaction-hazardous |
| D3 | Runtime i18n dictionaries | Angular `$localize` | Runtime switching required; one build only |
| D4 | Bespoke SVG charts | Chart.js / ng2-charts | Theme tokens, RTL, typography, bundle |
| D5 | Metric canonical storage | Store as entered | Unit switching must not corrupt history or analytics |
| D6 | Active session = normal workout record | Separate draft store | No reconciliation, crash recovery is trivial |
| D7 | Snapshot plan data into workouts | Join to live plan | Spec §4.6 history immutability |
| D8 | Separate `setLogs` store with `[exerciseId, completedAt]` index | Embed sets in the workout document | "Previous performance" and per-exercise analytics must not scan all history |
| D9 | Embed exercise definitions inside the routine document | Separate `routineExercises` store | Always read and written together; atomic edits; no orphan rows |
| D10 | Soft deletes + tombstones everywhere | Hard delete | Undo in V1, replicable deletions in V2 |
| D11 | `404.html` fallback for Pages routing | Hash routing | Clean shareable URLs, better PWA `start_url` behaviour |
| D12 | Timestamp-derived timers | Interval counters | iOS background throttling |
| D13 | No background notifications promised | Web Push on iOS 16.4+ | Requires a push service and user permission; out of scope and unreliable for rest timers; spec §9 forbids over-claiming |
| D14 | Tab identity in `sessionStorage` | A fresh id per page load | Must survive a reload of the same tab and differ between tabs; a per-load id makes every refresh look like a second tab and locks the user out of their own workout |
| D15 | PR detection behind a `PR_DETECTOR` token, no-op until Phase 7 | Write detection now, or call it after the finish transaction | Detection must run *inside* the finish transaction so a record bug rolls back instead of destroying a logged workout — the seam cannot be retrofitted, the implementation can |
| D16 | Sheet entry transition finished in code when the timeline is frozen | Trust `@starting-style`; or drop the slide entirely | An unrun transition holds its starting style, which for a slide-up is a viewport below the fold. Checking costs one timer and converts "looks broken" into "no animation" |
| D17 | Unconfirmed rows hard-deleted on finish | Keep them, or tombstone them | A row the user never confirmed is not history; a tombstone would let it be "recovered" into a session that never contained it. The count is stated before anything is removed |
