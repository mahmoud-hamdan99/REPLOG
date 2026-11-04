# REPLOG — Database Specification

**Version:** 1.0
**Storage engine (V1):** IndexedDB (`replog` database) + LocalStorage (preferences only)
**Schema version:** 1
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [UI_UX_SPEC.md](UI_UX_SPEC.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

---

## 1. Storage Map

| Store | Engine | Contents | Why here |
|---|---|---|---|
| `replog` database | IndexedDB | All structured records and photo blobs | Transactional, indexable, large capacity |
| `replog.prefs.v1` | LocalStorage | Language, theme, units, default rest, tracking mode, last route | Synchronous read at boot → no theme/direction flash |
| `replog.session.v1` | SessionStorage | Per-tab id for the multi-tab guard | Must not survive a tab close |
| Object URLs | memory | Photo rendering only | Revoked on release; never a storage mechanism |

Nothing user-generated lives only in LocalStorage. Preferences are duplicated into the export envelope so a restore reproduces the full app state.

---

## 2. Conventions

### 2.1 Record envelope

Every object store (except `appMeta` and `photoBlobs`) stores records extending:

```ts
interface Entity {
  id: string;            // UUIDv7 — time-sortable, so `id` doubles as a creation cursor
  createdAt: string;     // ISO-8601 UTC, e.g. "2026-03-14T18:22:05.123Z"
  updatedAt: string;     // ISO-8601 UTC, bumped on every write
  deletedAt: string | null;  // soft-delete tombstone; null = live
  rev: number;           // local revision counter, starts at 1, +1 per write
  origin: string;        // deviceId of the last writer (V2 conflict hints)
}
```

### 2.2 Types and units

| Concept | Stored as | Notes |
|---|---|---|
| Mass | `number`, **kilograms** | Canonical. lb is a display conversion only (ARCHITECTURE §5.5) |
| Length | `number`, **centimetres** | Canonical; in is display-only |
| Percentage | `number`, 0–100 | Body fat, consistency |
| Instant | `string`, ISO-8601 **UTC** | Everything with a clock time |
| Calendar day | `string`, `YYYY-MM-DD` **local** | `measuredAt`, `takenAt`, day buckets. Deliberately not UTC: a 23:30 weigh-in must stay on its own day |
| Duration | `number`, **seconds** (integer) | Rest, workout duration |
| Weekday | `number`, 0 = Sunday … 6 = Saturday | Matches `Date.getDay()`; the UI's week start is a display preference |
| Enum | `string` literal union | Never numeric — readable in exports and DevTools |
| Indexed boolean | `0 \| 1` (`Flag`) | **IndexedDB has no boolean key type.** `true` is not a valid key, so an index on a boolean field silently matches nothing. Every flag an index ranges over is stored as 0 or 1; flags with no index behind them stay plain booleans, since the ergonomic cost only buys something where there is a query |
| Optional | `null`, never `undefined` | `undefined` keys vanish in structured clone and break `Object.keys` diffs during import |

### 2.3 Naming

Stores are `camelCase` plural. Indexes are named `by_<field>` or `by_<a>_<b>` for compound. Foreign keys are `<entity>Id`. Metric-suffixed fields are explicit (`weightKg`, `chestCm`) so a unit bug is visible at the call site.

### 2.4 Referential integrity

IndexedDB has no foreign keys. Rules the data layer enforces instead:

* **No cascade deletes across aggregates.** Deleting an exercise soft-deletes it; historical `setLogs` keep their `exerciseId` and render from the exercise's cached name snapshot.
* Every record that references another stores enough **denormalised snapshot** to render standalone (name, equipment, targets). This is what makes history immutable (ARCHITECTURE §7.6).
* Orphan reads resolve to a labelled placeholder ("Deleted exercise"), never a crash or a blank row.
* Hard deletes happen in exactly two places: *Reset application data* and *Import (replace mode)* — both behind a typed confirmation.

---

## 3. Object Stores

### 3.1 `appMeta` — singleton key/value

**Key:** `key` (string, out-of-line not used; `keyPath: 'key'`) · **Indexes:** none

| Key | Type | Purpose |
|---|---|---|
| `schemaVersion` | number | Last applied migration; cross-checked against `DB_VERSION` at boot |
| `appVersion` | string | Build version that last wrote |
| `deviceId` | string | UUID generated once; becomes `origin` on every write |
| `activeWorkoutId` | string \| null | Pointer to the in-progress session (ARCHITECTURE §7.1) |
| `activeTab` | `{ tabId, heartbeatAt }` \| null | Multi-tab guard |
| `activeRest` | `{ startedAtMs, targetSec, exerciseId, setId }` \| null | Running rest timer, so a three-minute rest survives an iOS tab purge (ARCHITECTURE §7.3) |
| `activePlanId` | string \| null | Plan whose weekday schedule drives the dashboard |
| `builtInCatalogVersion` | number | Version of the seeded exercise catalog; drives re-seed logic (§6) |
| `lastExportAt` | string \| null | Drives the backup reminder |
| `lastBackupReminderAt` | string \| null | Prevents nagging |
| `firstRunCompletedAt` | string \| null | Onboarding gate |
| `storageWarningAcknowledgedAt` | string \| null | "Local storage is not permanent" notice |

Read as a map at boot; written individually. Not part of the sync envelope.

---

### 3.2 `profile` — single user record

**Key:** `id` (always the literal `'me'` in V1) · **Indexes:** none

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | `'me'` | ✓ | Fixed; V2 replaces this with a real user id |
| `displayName` | string \| null | | Optional (spec §3 "optional personal profile") |
| `birthDate` | `YYYY-MM-DD` \| null | | Used only for optional age display; never required |
| `sex` | `'male' \| 'female' \| 'unspecified'` | ✓ | Default `'unspecified'`; affects nothing in V1 except optional reference ranges |
| `heightCm` | number \| null | | Mirrors the latest `measurements.heightCm` for convenience |
| `goal` | `'strength' \| 'hypertrophy' \| 'endurance' \| 'general' \| null` | | Biases suggestion rep targets |
| `experienceLevel` | `'beginner' \| 'intermediate' \| 'advanced' \| null` | | Biases progression increments |
| `avatarBlobId` | string \| null | | → `photoBlobs` |
| *envelope* | | ✓ | §2.1 |

---

### 3.3 `exercises` — library (built-in + custom)

**Key:** `id` · built-ins use stable slugs (`barbell-bench-press`), customs use UUIDv7

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_primaryMuscle` | `primaryMuscles` | multiEntry | Muscle-group filter |
| `by_equipment` | `equipment` | | Equipment filter |
| `by_type` | `exerciseType` | | Type filter |
| `by_movementPattern` | `movementPattern` | | Pattern filter |
| `by_isCustom` | `isCustom` | | "My exercises" |
| `by_nameNorm` | `nameNormEn` | | Alphabetical listing / prefix search |
| `by_isArchived_nameNorm` | `['isArchived','nameNormEn']` | compound | Default listing (live, sorted) in one cursor |

| Field | Type | Req | Notes |
|---|---|---|---|
| `nameEn` | string | ✓ | |
| `nameAr` | string | ✓ | Required for built-ins; for customs defaults to `nameEn` with a "not translated" flag |
| `nameNormEn` / `nameNormAr` | string | ✓ | Lowercased, diacritics/Arabic tashkeel stripped, `أإآ→ا`, `ى→ي`, `ة→ه`. Search and sort key |
| `aliases` | string[] | ✓ | `[]` default; feeds search ("bench", "BP") |
| `primaryMuscles` | MuscleGroup[] | ✓ | ≥ 1. Enum in §4.1 |
| `secondaryMuscles` | MuscleGroup[] | ✓ | `[]` allowed |
| `equipment` | Equipment | ✓ | §4.2 |
| `exerciseType` | `'strength' \| 'bodyweight' \| 'machine' \| 'cable' \| 'cardio' \| 'stretch' \| 'olympic' \| 'plyometric'` | ✓ | |
| `movementPattern` | `'horizontal-push' \| 'vertical-push' \| 'horizontal-pull' \| 'vertical-pull' \| 'squat' \| 'hinge' \| 'lunge' \| 'carry' \| 'rotation' \| 'isolation' \| 'other'` | ✓ | |
| `mechanics` | `'compound' \| 'isolation'` | ✓ | |
| `force` | `'push' \| 'pull' \| 'static' \| null` | | |
| `laterality` | `'bilateral' \| 'unilateral-alternating' \| 'unilateral-separate'` | ✓ | `unilateral-separate` splits set logging per side |
| `loadType` | `'external' \| 'bodyweight' \| 'bodyweight-plus' \| 'assisted' \| 'time' \| 'distance'` | ✓ | Decides which input fields the tracker shows and how volume/e1RM are computed |
| `instructionsEn` / `instructionsAr` | string[] | ✓ | `[]` allowed; ordered steps |
| `cuesEn` / `cuesAr` | string[] | ✓ | Short form cues |
| `illustration` | `{ kind: 'asset', path: string } \| { kind: 'blob', blobId: string } \| null` | | Built-ins use bundled SVG assets; customs may store a photo blob |
| `defaultRestSec` | number \| null | | Falls back to the global preference |
| `weightIncrementKg` | number | ✓ | 2.5 barbell, 1.0–2.5 dumbbell, machine-specific. Drives suggestion rounding |
| `isCustom` | `Flag` | ✓ | Indexed (`by_isCustom`) |
| `isArchived` | `Flag` | ✓ | Hidden from pickers, retained in history. Indexed with `nameNormEn` |
| `isFavorite` | boolean | ✓ | Not indexed: filtered from the resident library cache |
| `builtInVersion` | number \| null | ✓ for built-ins | Catalog revision this record came from |
| `userEdited` | boolean | ✓ | `true` once the user edits a built-in → re-seeding must not overwrite it (§6.2) |
| `notes` | string \| null | | User's own notes on the exercise |
| *envelope* | | ✓ | |

**Variant key** (derived, not stored): `` `${id}|${equipment}|${laterality}` `` — the comparison scope for PRs, previous-performance, and suggestions (ARCHITECTURE §6.1).

---

### 3.4 `plans` — programs

**Key:** `id` · **Indexes:** `by_isArchived` (`isArchived`), `by_updatedAt` (`updatedAt`), `by_orderIndex` (`orderIndex`)

| Field | Type | Req | Notes |
|---|---|---|---|
| `name` | string | ✓ | User-entered, single language |
| `description` | string \| null | | |
| `goal` | same enum as profile \| null | | |
| `weekStartsOn` | 0–6 | ✓ | Mirrors the display preference at creation |
| `accentColor` | token name \| null | | From a fixed token set, not free hex — keeps theming coherent |
| `isArchived` | `Flag` | ✓ | Indexed (`by_isArchived`) |
| `orderIndex` | number | ✓ | Manual ordering; sparse integers (1000, 2000…) so reorder is a single write |
| `durationWeeks` | number \| null | | Informational only; no program periodisation in V1 |
| *envelope* | | ✓ | |

Archiving, not deleting, is the default (spec §4.2). Hard delete is offered only for plans with zero referencing workouts.

---

### 3.5 `routines` — one workout day; **exercise definitions are embedded**

**Key:** `id`

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_planId` | `planId` | | Plan detail screen |
| `by_planId_orderIndex` | `['planId','orderIndex']` | compound | Ordered routines in one cursor |
| `by_weekday` | `weekdays` | multiEntry | "What's scheduled today" |
| `by_scheduleType` | `scheduleType` | | Flexible-routine picker |

| Field | Type | Req | Notes |
|---|---|---|---|
| `planId` | string \| null | ✓ | `null` = standalone flexible routine not owned by a plan |
| `name` | string | ✓ | e.g. "Push A" |
| `scheduleType` | `'scheduled' \| 'flexible'` | ✓ | Spec §4.2 requires both |
| `weekdays` | number[] | ✓ | `[]` for flexible; `[1,4]` = Mon & Thu |
| `orderIndex` | number | ✓ | Sparse |
| `estimatedDurationMin` | number \| null | | Computed suggestion, user-overridable |
| `notes` | string \| null | | |
| `exercises` | `RoutineExercise[]` | ✓ | **Embedded** — see below |
| `revision` | number | ✓ | +1 on any structural edit; copied into workout snapshots so history can say "based on revision 7" |
| `isArchived` | boolean | ✓ | |
| *envelope* | | ✓ | |

```ts
interface RoutineExercise {
  uid: string;                 // stable within the routine; survives reorder
  exerciseId: string;
  nameSnapshot: string;        // rendered if the exercise is later deleted
  orderIndex: number;          // sparse
  supersetGroup: string | null;// 'A','B'… shared by grouped exercises; null = standalone
  supersetOrder: number | null;// position inside the group
  targetSets: number;          // ≥ 1
  targetRepsMin: number | null;
  targetRepsMax: number | null;// equal to min for a fixed target
  targetWeightKg: number | null;      // optional explicit target
  targetRpe: number | null;           // 1–10, 0.5 steps
  restSec: number | null;             // overrides exercise/global default
  warmupSets: number;                 // planned warm-ups, default 0
  trackingMode: 'simple' | 'advanced';// per-exercise override of the global default
  notes: string | null;
  isOptional: boolean;
}
```

**Why embedded (ARCHITECTURE D9):** routine exercises are never queried independently of their routine, are always written as a set during editing, and benefit from atomic reorder. A routine with 15 exercises is ~4 kB — far below any document-size concern. The trade-off accepted: changing an exercise's name does not retro-update `nameSnapshot`, which is intentional.

---

### 3.6 `workouts` — sessions (active and completed)

**Key:** `id`

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_startedAt` | `startedAt` | | History list (descending cursor) |
| `by_status` | `status` | | Active-session lookup, discarded cleanup |
| `by_status_startedAt` | `['status','startedAt']` | compound | Completed history without filtering in JS |
| `by_dayKey` | `dayKey` | | Calendar / streak / consistency |
| `by_routineId` | `routineId` | | "Last time you did Push A" |

| Field | Type | Req | Notes |
|---|---|---|---|
| `status` | `'active' \| 'paused' \| 'completed' \| 'discarded'` | ✓ | At most one `active`/`paused` record exists; invariant checked at boot |
| `startedAt` | ISO instant | ✓ | |
| `finishedAt` | ISO instant \| null | ✓ | Set on completion |
| `dayKey` | `YYYY-MM-DD` local | ✓ | Derived from `startedAt` at write time, stored for indexing |
| `name` | string | ✓ | Defaults to the routine name, or "Quick workout" |
| `planId` / `routineId` | string \| null | ✓ | **Provenance only** — never joined for rendering |
| `planSnapshot` | `{ planId, planName, routineId, routineName, routineRevision, scheduleType } \| null` | ✓ | Immutable history (ARCHITECTURE §7.6) |
| `source` | `'routine' \| 'quick' \| 'repeat'` | ✓ | `repeat` = cloned from a past workout |
| `pauses` | `{ at: string; until: string \| null }[]` | ✓ | Open-ended last entry while paused |
| `durationSec` | number | ✓ | Active time excluding pauses; authoritative after completion, recomputed live before |
| `totalVolumeKg` | number | ✓ | Working sets only; 0 until completion |
| `totalSets` / `totalReps` | number | ✓ | Completed working sets only |
| `exerciseCount` | number | ✓ | Non-skipped |
| `bodyWeightKg` | number \| null | | Snapshot of the nearest measurement; makes bodyweight-exercise volume meaningful |
| `notes` | string \| null | | Session notes |
| `perceivedEffort` | 1–10 \| null | | Optional session RPE |
| `feeling` | `'great' \| 'good' \| 'ok' \| 'rough' \| null` | | One-tap mood |
| `prCount` | number | ✓ | Cached for the history list badge |
| `trackingMode` | `'simple' \| 'advanced'` | ✓ | Mode used for this session |
| `tabId` | string \| null | | Owner tab while active |
| `heartbeatAt` | ISO instant \| null | | Updated every 15 s while active; a stale heartbeat lets another tab take over |
| `discardedReason` | string \| null | | For `discarded` records, retained 30 days then purged |
| *envelope* | | ✓ | |

---

### 3.7 `workoutExercises` — per-exercise slot within a session

**Key:** `id`

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_workoutId` | `workoutId` | | Loading a session |
| `by_workoutId_orderIndex` | `['workoutId','orderIndex']` | compound | Ordered load in one cursor |
| `by_exerciseId` | `exerciseId` | | Per-exercise history |
| `by_exerciseId_startedAt` | `['exerciseId','startedAt']` | compound | **"Previous performance"** — one `prev()` cursor hit, no scan |

| Field | Type | Req | Notes |
|---|---|---|---|
| `workoutId` | string | ✓ | |
| `exerciseId` | string | ✓ | Denormalised for the compound index |
| `variantKey` | string | ✓ | Denormalised; PR/comparison scope frozen at session time |
| `nameSnapshot` | string | ✓ | |
| `routineExerciseUid` | string \| null | ✓ | Links back to the plan slot, or `null` for ad-hoc additions |
| `startedAt` | ISO instant | ✓ | Denormalised from the workout for the compound index |
| `dayKey` | `YYYY-MM-DD` | ✓ | |
| `orderIndex` | number | ✓ | Sparse; reorder = one write |
| `supersetGroup` / `supersetOrder` | string \| null / number \| null | ✓ | |
| `targetSnapshot` | `Pick<RoutineExercise,'targetSets'\|'targetRepsMin'\|'targetRepsMax'\|'targetWeightKg'\|'targetRpe'\|'restSec'>` \| null | ✓ | What the plan asked for, frozen |
| `loadType` / `laterality` | enums | ✓ | Snapshotted so historical rendering never depends on a later library edit |
| `restSec` | number \| null | ✓ | Effective rest used |
| `notes` | string \| null | | |
| `isSkipped` | boolean | ✓ | Skipped but retained, so the plan's intent stays visible |
| `completedSetCount` / `volumeKg` | number | ✓ | Cached rollups |
| *envelope* | | ✓ | |

---

### 3.8 `setLogs` — the atomic record of training

**Key:** `id`

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_workoutExerciseId` | `workoutExerciseId` | | Rendering a tracker card |
| `by_workoutExerciseId_setIndex` | `['workoutExerciseId','setIndex']` | compound | Ordered sets |
| `by_workoutId` | `workoutId` | | Session rollups, cascade on discard |
| `by_exerciseId_completedAt` | `['exerciseId','completedAt']` | compound | Progression charts, PR scans, previous-best lookup |
| `by_variantKey_completedAt` | `['variantKey','completedAt']` | compound | Variant-scoped PR detection |
| `by_dayKey` | `dayKey` | | Volume-per-day aggregation |

| Field | Type | Req | Notes |
|---|---|---|---|
| `workoutId` / `workoutExerciseId` / `exerciseId` / `variantKey` | string | ✓ | Denormalised chain; the cost of IndexedDB having no joins |
| `dayKey` | `YYYY-MM-DD` | ✓ | |
| `setIndex` | number | ✓ | 0-based, within the exercise, including warm-ups |
| `setType` | `'warmup' \| 'working' \| 'dropset' \| 'failure' \| 'backoff'` | ✓ | **Only `working` and `backoff` count toward volume and PRs** |
| `side` | `'both' \| 'left' \| 'right'` | ✓ | `both` unless the exercise is `unilateral-separate` |
| `weightKg` | number \| null | ✓ | `null` for bodyweight/time/distance loads |
| `extraWeightKg` | number \| null | | For `bodyweight-plus` / `assisted` (negative = assistance) |
| `reps` | number \| null | ✓ | `null` for time/distance |
| `durationSec` | number \| null | | For time-based work |
| `distanceM` | number \| null | | For distance-based work |
| `rpe` | number \| null | | 1–10, 0.5 steps; advanced mode |
| `rir` | number \| null | | 0–10; advanced mode |
| `isCompleted` | boolean | ✓ | `false` = draft/planned row |
| `isPr` | boolean | ✓ | Cached badge; authoritative source is `personalRecords` |
| `completedAt` | ISO instant \| null | ✓ | Set when confirmed; the sort key for progression |
| `restTakenSec` | number \| null | | Measured, not planned |
| `e1rmKg` | number \| null | ✓ | Precomputed Epley; `null` when reps > 12 or load is not external (never fabricated) |
| `volumeKg` | number \| null | ✓ | `effectiveWeight × reps`; `null` when not computable |
| `notes` | string \| null | | Per-set note (advanced) |
| *envelope* | | ✓ | |

**Effective weight** for volume/e1RM: `external → weightKg`; `bodyweight → workout.bodyWeightKg`; `bodyweight-plus → bodyWeightKg + extraWeightKg`; `assisted → bodyWeightKg + extraWeightKg` (negative); `time`/`distance` → no volume, and the UI states that these are excluded from volume totals.

---

### 3.9 `measurements`

**Key:** `id` · **Indexes:** `by_measuredAt` (`measuredAt`), `by_measuredAt_desc` not needed (cursor `prev`), `by_hasWeight` (`hasWeight`)

| Field | Type | Req | Notes |
|---|---|---|---|
| `measuredAt` | `YYYY-MM-DD` local | ✓ | Multiple entries per day allowed; the UI warns and offers to merge |
| `recordedAt` | ISO instant | ✓ | Actual entry time, for same-day ordering |
| `weightKg` | number \| null | ✓ | |
| `hasWeight` | `0 \| 1` | ✓ | Indexable boolean (IndexedDB cannot index `true`/`false` reliably across engines) |
| `bodyFatPct` | number \| null | | 0–100 |
| `heightCm` | number \| null | | |
| `neckCm`, `shouldersCm`, `chestCm`, `waistCm`, `hipsCm` | number \| null | | |
| `bicepsLeftCm`, `bicepsRightCm` | number \| null | | |
| `forearmLeftCm`, `forearmRightCm` | number \| null | | |
| `thighLeftCm`, `thighRightCm` | number \| null | | |
| `calfLeftCm`, `calfRightCm` | number \| null | | |
| `custom` | `Record<string, number>` | ✓ | Keyed by `customMeasurementDefs.id`; `{}` default |
| `notes` | string \| null | | |
| `source` | `'manual' \| 'import'` | ✓ | |
| *envelope* | | ✓ | |

Every field is nullable: partial entries are normal ("today I only weighed myself"). Charts plot only non-null points and leave gaps (spec §4.9).

`hipsCm` is included although the spec's §4.7 list omits it — it is the one standard circumference users expect alongside waist, and omitting it would force everyone into a custom measurement. It is optional like every other field.

---

### 3.10 `customMeasurementDefs`

**Key:** `id` · **Indexes:** `by_isArchived_orderIndex` (`['isArchived','orderIndex']`)

| Field | Type | Req | Notes |
|---|---|---|---|
| `label` | string | ✓ | User-entered, single language |
| `unitType` | `'length' \| 'mass' \| 'percent' \| 'count'` | ✓ | Decides canonical unit and display conversion |
| `orderIndex` | number | ✓ | |
| `isArchived` | `Flag` | ✓ | Archive keeps historical values readable. Indexed with `orderIndex` |
| *envelope* | | ✓ | |

---

### 3.11 `photos` — metadata only

**Key:** `id` · **Indexes:** `by_takenAt` (`takenAt`), `by_pose_takenAt` (`['pose','takenAt']`)

| Field | Type | Req | Notes |
|---|---|---|---|
| `takenAt` | `YYYY-MM-DD` local | ✓ | Defaults to the EXIF date if present, else today |
| `recordedAt` | ISO instant | ✓ | |
| `pose` | `'front' \| 'side-left' \| 'side-right' \| 'back' \| 'other'` | ✓ | Spec §4.8 |
| `fullBlobId` | string | ✓ | → `photoBlobs` |
| `thumbBlobId` | string | ✓ | → `photoBlobs` |
| `width` / `height` | number | ✓ | Full-size pixels, for layout without decoding |
| `byteSize` | number | ✓ | Full blob size; drives the storage meter |
| `mimeType` | string | ✓ | `image/webp` after processing |
| `weightKg` | number \| null | | Nearest measurement, snapshotted for the compare view caption |
| `measurementId` | string \| null | | Optional link |
| `notes` | string \| null | | |
| `isFavorite` | boolean | ✓ | |
| *envelope* | | ✓ | |

Metadata is deliberately separate from pixels so the gallery can list 500 photos without materialising a single blob.

### 3.12 `photoBlobs` — pixels

**Key:** `id` · **Indexes:** `by_byteSize` (`byteSize`)
**Value:** `{ id: string, data: ArrayBuffer, mimeType: string, byteSize: number, createdAt: string }`

**Stored as an `ArrayBuffer`, not a `Blob`.** iOS Safari — the primary target —
has a long history of failing to persist Blobs in IndexedDB, and a lost progress
photo cannot be recovered. An ArrayBuffer is a plain structured-cloneable value
that every engine round-trips reliably. The `PhotoBlobStore` contract still
speaks `Blob`, so callers hand one in and get one back; only the stored
representation differs. The same choice makes the store testable, since
`fake-indexeddb` also fails to clone a jsdom `Blob`.

`byteSize` is denormalised and indexed so the storage meter can sum image sizes
with a key-only cursor, without deserialising a single photo.

**Processing pipeline on import** (all client-side, no uploads — spec §4.8):

1. Read the `File`; reject non-images and anything over 25 MB with a clear message.
2. Decode with `createImageBitmap` (fall back to an `<img>` + canvas path if unsupported).
3. **Strip metadata by re-encoding** through a canvas — this removes EXIF GPS, which must never be retained for progress photos. The capture date is read *before* stripping and stored in `takenAt`.
4. Correct orientation from the EXIF orientation tag before stripping.
5. Resize the long edge to **1600 px** max → encode WebP quality 0.82 → `fullBlobId`.
6. Resize the long edge to **320 px** → WebP quality 0.7 → `thumbBlobId`.
7. **Read the output back and refuse it if metadata survived.** A re-encode that quietly preserved EXIF would store a photo that looks identical and carries the user's location. Checked before anything is written, so a failure means nothing was stored rather than something being unstored.
8. Write both blobs and the metadata record in **one** transaction, through `TxScope.blobs()`.

Expected sizes: full ~180–350 kB, thumb ~12–25 kB — for a photograph. Measured against synthetic inputs the spread is wider than that range suggests: an image with photographic statistics lands near 30 kB, and pathological full-range noise reaches ~640 kB. The budget describes cameras, not the codec's worst case. Deleting a photo soft-deletes the metadata and **hard-deletes both blobs immediately** — a tombstoned 300 kB image is not worth the undo, so the confirm dialog says the image cannot be recovered.

---

### 3.13 `personalRecords`

**Key:** `id` (UUIDv7) · one record per achievement event, so PR *history* is preserved (spec §4.10)

| Index | Key path | Flags | Serves |
|---|---|---|---|
| `by_variantKey_type_achievedAt` | `['variantKey','prType','achievedAt']` | compound | Current PR = last entry; full history = full range |
| `by_isCurrent` | `isCurrent` (`0\|1`) | | Dashboard "current records" list |
| `by_achievedAt` | `achievedAt` | | "Recent personal records" (dashboard §4.1) |
| `by_exerciseId` | `exerciseId` | | Exercise detail |

| Field | Type | Req | Notes |
|---|---|---|---|
| `exerciseId` / `variantKey` | string | ✓ | Comparison is **always** variant-scoped |
| `nameSnapshot` | string | ✓ | |
| `prType` | `'maxWeight' \| 'maxRepsAtWeight' \| 'estimated1RM' \| 'maxSessionVolume' \| 'maxSetVolume'` | ✓ | Spec §4.10 |
| `value` | number | ✓ | kg, reps, or kg·reps depending on type |
| `weightKg` / `reps` | number \| null | ✓ | The actual set that produced it |
| `repBucket` | number \| null | ✓ | For `maxRepsAtWeight`: the weight bucket this record belongs to |
| `isEstimate` | boolean | ✓ | `true` only for `estimated1RM` |
| `formula` | `'epley' \| 'brzycki' \| null` | ✓ | Non-null iff `isEstimate` |
| `achievedAt` | ISO instant | ✓ | |
| `workoutId` / `setLogId` | string | ✓ | Provenance; tapping a PR opens the exact set |
| `previousValue` | number \| null | ✓ | Enables "+5 kg over your last best" without a second query |
| `previousAchievedAt` | ISO instant \| null | ✓ | |
| `isCurrent` | `0 \| 1` | ✓ | Exactly one per `(variantKey, prType[, repBucket])`; the previous holder is flipped to 0 in the same transaction |
| *envelope* | | ✓ | |

**Detection rules** (pure functions in `domain/strength/prs.ts`, run inside the finish-workout transaction):

* Only `setType ∈ {working, backoff}`, `isCompleted: true`, `loadType ∈ {external, bodyweight-plus}` sets are candidates. A set whose `workoutExercise` is missing holds no record: the load type lives on the slot, and guessing it from the presence of a weight would turn a data error into an achievement.
* `maxWeight`: strictly greater load with `reps ≥ 1`. The load is `weightKg` for external work and **`extraWeightKg` for bodyweight-plus** — a weighted pull-up is "+25 kg", it is the number the lifter chooses, and scoring the total would award a record whenever recorded body weight rose.
* `maxRepsAtWeight`: bucketed by exact `weightKg`; a record exists per weight actually used, preventing "12 reps at 20 kg" from beating "5 reps at 100 kg".
* `estimated1RM`: the user's chosen formula, only for `reps ≤ 12` and only for `external` load — an estimated one-rep max derived from added weight has no referent. Flagged `isEstimate`, stored with its `formula`, and rendered in a visually distinct style that names the formula (UI_UX_SPEC §9.5).
* `maxSetVolume` / `maxSessionVolume`: `Σ(effectiveWeight × reps)` for the set / the exercise within the session.
* A first-ever qualifying set creates a record with `previousValue: null` and is labelled "First record", not "New PR" — the distinction matters for honesty.
* Ties never create a record.
* Recomputation: detection and rebuilding are **the same operation** — a variant's whole table is recomputed from its set logs and the stored table reconciled against the result. Finishing a workout recomputes the variants it touched; a correction or deletion recomputes the variants it affected; Settings → Data recomputes everything. Determinism is therefore structural rather than maintained.
* Reconciliation keeps a record's id where the achievement is unchanged, so a rebuild does not churn identities. An achievement the sets no longer support is **hard**-deleted: a record is a derived value, and a tombstone would preserve a claim the data has stopped making.

---

### 3.14 `outbox` — declared, unused in V1

**Key:** `id` · **Indexes:** `by_createdAt`, `by_state`

Declared at schema version 1 so V2 sync requires no `onupgradeneeded` on a database full of user data. Shape: `{ id, store, recordId, op: 'put'|'remove', payloadRev, state: 'pending'|'sent'|'failed', attempts, lastError, createdAt }`. V1 writes nothing to it; a unit test asserts it stays empty.

---

## 4. Enumerations

### 4.1 `MuscleGroup`

`chest · back · lats · upper-back · lower-back · shoulders · front-delts · side-delts · rear-delts · biceps · triceps · forearms · quadriceps · hamstrings · glutes · adductors · abductors · calves · abs · obliques · neck · full-body · cardio`

The spec's §4.3 list is the **filter taxonomy** shown in the UI (Chest, Back, Shoulders, Biceps, Triceps, Forearms, Quadriceps, Hamstrings, Glutes, Calves, Abs, Full body). The finer values above are the **data taxonomy** used for accurate muscle-distribution analytics; a static map in `domain/models/muscles.ts` rolls them up to the twelve filter categories. Both are typed, both are translated.

### 4.2 `Equipment`

`barbell · dumbbell · ez-bar · trap-bar · kettlebell · machine · cable · smith-machine · bodyweight · pull-up-bar · dip-bar · bands · suspension · medicine-ball · sled · plate · bench · other`

Equipment is part of the variant key, so adding a value is additive and never recategorises history.

### 4.3 Preference enums (LocalStorage)

`language: 'en'|'ar'` · `theme: 'system'|'light'|'dark'` · `weightUnit: 'kg'|'lb'` · `lengthUnit: 'cm'|'in'` · `trackingMode: 'simple'|'advanced'` · `weekStartsOn: 0|1|6` · `e1rmFormula: 'epley'|'brzycki'` · `numerals: 'latn'|'arab'`

---

## 5. Preferences (LocalStorage)

Single key `replog.prefs.v1`, one JSON object, versioned independently of the IndexedDB schema:

```ts
interface Prefs {
  prefsVersion: 1;
  language: 'en' | 'ar';
  theme: 'system' | 'light' | 'dark';
  weightUnit: 'kg' | 'lb';
  lengthUnit: 'cm' | 'in';
  numerals: 'latn' | 'arab';
  weekStartsOn: 0 | 1 | 6;
  defaultRestSec: number;            // 90
  trackingMode: 'simple' | 'advanced';
  autoStartRestTimer: boolean;       // true
  restTimerSound: boolean;           // true
  keepScreenAwake: boolean;          // true — honoured only where Wake Lock exists
  showPreviousPerformance: boolean;  // true
  showSuggestions: boolean;          // true
  e1rmFormula: 'epley' | 'brzycki';
  confirmBeforeFinish: boolean;      // true
  hapticsEnabled: boolean;           // feature-detected; no-op on iOS
  lastRoute: string | null;
  reduceMotion: 'system' | 'always' | 'never';
}
```

Rules: read synchronously in `main.ts` before bootstrap so `lang`/`dir`/theme are correct on the first paint; every write goes through `SettingsStore` (never `localStorage` directly from a component); a malformed or absent blob falls back to defaults without throwing; unknown keys are preserved on write so a downgrade does not destroy newer settings.

---

## 6. Built-in Exercise Catalog

### 6.1 Shape and delivery

A static, versioned JSON asset at `src/app/features/exercises/data/exercises.v1.json`, imported dynamically so the bundler emits it as its own lazy chunk. Deliberately **not** `public/`: as a bundled chunk it is hashed, precached by the service worker, available offline without a runtime fetch of our own, and importable by the validation spec — the same reasoning as the locale dictionaries. **Shipped in Version 1: 168 exercises**, covering all twelve filter categories with at least 12 each (chest 15, back 19, shoulders 14, biceps 13, triceps 12, forearms 13, quadriceps 17, hamstrings 14, glutes 13, calves 12, abs 16, full-body 18). Every entry has EN + AR names, aliases, muscles, equipment, full classification and a weight increment. **17 carry written instructions**; the rest render a "no instructions yet" state.

That is short of the 180–260 originally targeted, and deliberately so: breadth is what makes the library usable — you must be able to find your lift — while written instructions are additive content that the reconciliation path in section 6.2 exists to deliver incrementally. Padding the count to clear a number would not have made the library more useful. The payload budget leaves ample room: the catalog is **12.6 kB gzipped** against a 60 kB ceiling.

The file is generated from terse per-group sources under `scripts/catalog/source/` by `scripts/build-catalog.mjs`, which applies defaults and enforces unique ids, enum membership, category coverage and the payload budget. It is the single source for seeding; it is never the runtime query surface (that is always IndexedDB).

**Normalised search keys are absent from the file.** They are computed during seeding with the same `normalizeSearchText` the query path uses — baking them in would mean a second implementation in the build script that could drift, producing searches that fail only for certain inputs.

Size control: instructions are the bulk of the payload. Budget ≤ 60 kB gzipped (ARCHITECTURE §10.5); if exceeded, split into `exercises.core.json` (names/classification, needed for pickers) and `exercises.details.json` (instructions/cues, loaded on exercise detail).

### 6.2 Seeding and re-seeding

```
boot → read appMeta.builtInCatalogVersion
  missing            → seed all, set version
  < asset version    → reconcile:
      new slug                     → insert
      existing & userEdited=false  → overwrite definition fields, keep isFavorite/notes/isArchived
      existing & userEdited=true   → leave alone, mark catalogUpdateAvailable for a diff view
      removed from asset           → set isArchived=true (never delete: history references it)
  equal              → no-op
```

User-created exercises (`isCustom: true`) are never touched. Reconciliation runs in one transaction with progress reporting, because a first seed of 250 records should not block the first paint — it runs after the shell renders, behind a "Preparing your exercise library" state.

---

## 7. Migrations

### 7.1 Mechanism

`DB_VERSION` is a single integer in `infrastructure/idb/schema.ts`. `onupgradeneeded` runs ordered steps:

```ts
const MIGRATIONS: Migration[] = [
  { to: 1, run: migrateTo1 },   // initial schema
  // { to: 2, run: migrateTo2 },
];

async function upgrade(db, oldVersion, newVersion, tx) {
  for (const m of MIGRATIONS) {
    if (oldVersion < m.to && m.to <= newVersion) await m.run(db, tx);
  }
}
```

### 7.2 Rules

1. **Forward-only.** No downgrades. A database whose `schemaVersion` exceeds `DB_VERSION` (user opened an older build) puts the app into **safe mode**: read-only UI, export enabled, clear explanation, no writes. Silently truncating newer data is unacceptable.
2. Every migration is **idempotent** and **resumable**: a browser killed mid-upgrade must be able to re-run the step. Mark progress in `appMeta` for long data migrations.
3. Store/index creation uses the `db` handle; data rewriting uses the provided `tx` — never open a new transaction inside an upgrade.
4. New fields get **defaults applied lazily on read** where possible (a `normalize()` function per store) and backfilled in a migration only when an index needs them. This keeps upgrades fast on large datasets.
5. A migration that cannot complete throws `MigrationError`; the handler offers **Export raw data** before anything else. Data preservation beats feature availability.
6. Each migration ships with a test that loads a fixture database at version *n-1* (via `fake-indexeddb`) and asserts the post-state. No migration merges without one.
7. `blocked` / `versionchange` events are handled: other tabs are asked to close ("REPLOG is open in another tab — close it to finish updating"), with a reload offer.

### 7.3 Version 1 definition

Schema version 1 creates all stores and indexes in §3, including `outbox`, and seeds `appMeta` (`schemaVersion: 1`, `deviceId`, `builtInCatalogVersion: 0`).

### 7.4 Anticipated future migrations

Documented now so the shapes stay compatible:

| Version | Change | Strategy |
|---|---|---|
| 2 | `userId` on every record for multi-user/cloud | Add index, backfill with the local owner id |
| 3 | Program periodisation (`mesocycles`, per-week routine variants) | New stores; `routines` untouched |
| 4 | Cardio/time-based first-class metrics (pace, HR zones) | Additive nullable fields on `setLogs` |
| 5 | Exercise media pack (video blobs) | New store, no changes to `exercises` |

---

## 8. Query Catalog

The queries the index design exists to serve. Each must be O(result), never a full scan.

| # | Need | Access path |
|---|---|---|
| Q1 | Dashboard: current weight + change | `measurements.by_measuredAt` cursor `prev`, take 2 non-null-weight |
| Q2 | Dashboard: workouts this week | `workouts.by_status_startedAt` range `['completed', weekStartISO] … ['completed', nowISO]`, count |
| Q3 | Dashboard: consistency | Q2 over N weeks ÷ planned sessions per week from the active plan |
| Q4 | Dashboard: next scheduled workout | `routines.by_weekday` equals today…+7 within the active plan |
| Q5 | Dashboard: recent PRs | `personalRecords.by_achievedAt` cursor `prev`, limit 5 |
| Q6 | Dashboard: recent activity | `workouts.by_status_startedAt` cursor `prev`, limit 5 |
| Q7 | **Previous performance for exercise X** | `workoutExercises.by_exerciseId_startedAt` cursor `prev` → 1 hit → its `setLogs.by_workoutExerciseId_setIndex` |
| Q8 | Progression chart for X | `setLogs.by_exerciseId_completedAt` range over the window; bucket in `domain/analytics` |
| Q9 | Current PRs for X | `personalRecords.by_variantKey_type_achievedAt`, last per `prType` |
| Q10 | PR history for X | same index, full range ascending |
| Q11 | History list (paged) | `workouts.by_status_startedAt` cursor `prev` with `limit`/`advance` |
| Q12 | Workout detail | `workoutExercises.by_workoutId_orderIndex` + `setLogs.by_workoutId`, one transaction |
| Q13 | Volume per week/month | `setLogs.by_dayKey` range → sum (working sets only) |
| Q14 | Muscle-group distribution | Q13's rows joined to an in-memory exercise map (library is fully cached) → roll up via the muscle map. Counted in **sets**, one set against the exercise's first primary muscle, so the per-group counts sum to the sets performed; a set whose exercise names no muscle is reported rather than bucketed |
| Q15 | Weight/measurement trend | `measurements.by_measuredAt` range |
| Q16 | Photo gallery | `photos.by_takenAt` cursor `prev`; thumbs fetched per visible item |
| Q17 | Photo compare | two `photos.get` + two blob reads |
| Q18 | Library default list | `exercises.by_isArchived_nameNorm` range `[0, '']…[0, '￿']` |
| Q19 | Library filtered | narrowest index first (`by_primaryMuscle` / `by_equipment`), then in-memory predicate on the cached array |
| Q20 | Exercise search | In-memory prefix/substring over `nameNormEn`, `nameNormAr`, `aliases` on the cached library |
| Q21 | Resume active session | `appMeta.activeWorkoutId` → `workouts.get` → Q12 |
| Q22 | Export everything | One readonly transaction over all stores, cursored and streamed |

**Library caching:** the exercise library (~250 records, ~400 kB in memory) is loaded once into `ExerciseLibraryStore` and kept resident. Search and multi-criteria filtering therefore run in memory, which is both faster and simpler than compound-index gymnastics. This is an explicit trade of memory for simplicity and is only valid because the catalog is bounded.

---

## 9. Data Protection

### 9.1 Export format

`replog-backup-YYYY-MM-DD-HHmm.json`, UTF-8, pretty-printed (compressibility over byte count; users inspect these files).

```jsonc
{
  "format": "replog-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-11-01T09:12:44.000Z",
  "deviceId": "018f...",
  "options": { "includePhotos": true, "includeDiscarded": false },
  "counts": { "exercises": 263, "plans": 2, "routines": 7, "workouts": 184,
              "workoutExercises": 1120, "setLogs": 4987, "measurements": 96,
              "photos": 41, "personalRecords": 212, "customMeasurementDefs": 3 },
  "integrity": { "algorithm": "sha-256", "value": "<hex of the canonicalised data block>" },
  "prefs": { /* §5 */ },
  "data": {
    "profile": [ /* … */ ],
    "exercises": [ /* … */ ],
    "plans": [], "routines": [], "workouts": [], "workoutExercises": [],
    "setLogs": [], "measurements": [], "customMeasurementDefs": [],
    "photos": [], "personalRecords": []
  },
  "photoBlobs": [ { "id": "018f…", "mimeType": "image/webp", "bytes": 214_883, "dataBase64": "UklGR…" } ]
}
```

Notes:

* **Photos are optional and off by default** in the quick export, because base64 inflates the file ~33 % and a photo-heavy backup can reach 50–100 MB. The UI shows the projected size for both choices before exporting.
* `integrity` is computed over a canonical (key-sorted, whitespace-free) serialisation of `data` + `photoBlobs`. On import, a mismatch is a **warning** with a preview, not a hard block — a hand-edited backup is still better than no backup.
* Large exports stream through a `Blob` built in chunks to avoid one giant string; the writer yields to the event loop so the UI keeps a progress bar.
* Export is also offered **per store** ("export measurements as CSV") for users who want their numbers in a spreadsheet. CSV is export-only, never an import path — it has nowhere to put a photo, a nested snapshot or the envelope, so a file written that way could not be read back without losing something.

  The CSV writer has three rules that are not obvious and each of which produces a file that opens, looks plausible and is wrong if skipped. It emits a **byte-order mark**, or Excel reads the file as the system codepage and every Arabic note arrives as mojibake. It takes the **union of every row's keys** as the header, because records are sparse — an absent optional measurement is absent, not null — so taking the first row's keys would silently drop whole columns. And it **defuses a leading `=`, `+`, `-` or `@`** with a tab, because a spreadsheet runs those: a note somebody typed as "-10kg from last week" otherwise renders as `#NAME?`, and `=HYPERLINK(…)` in a shared file is an attack on whoever opens it.

### 9.2 Import

Three-stage, with the user in control at every step:

1. **Parse & validate** — JSON parse, envelope check, then a hand-written structural validator per store (no schema library): required fields, enum membership, numeric ranges, date formats, referential consistency (`setLogs.workoutExerciseId` exists, `routines.planId` exists). Output is a **report**, not a boolean: counts per store, a list of problems split into *blocking* (unparseable file, unknown `formatVersion` greater than supported, missing `data`) and *repairable* (unknown enum value → coerced to `other` with a note; orphan set log → dropped with a count; duplicate id → newest `updatedAt` wins).
2. **Choose a mode** — presented as a dry-run diff:
   * **Merge** (default) — per-record last-write-wins on `updatedAt`, with ties resolved in favour of the existing local record. Never deletes local records absent from the file.
   * **Replace** — wipes every store and restores the file exactly. Requires typing `REPLACE` and offers a **pre-flight automatic export** of the current data first (spec §8 "protection against accidental overwrites").
3. **Apply** — one transaction per store group, chunked at ~500 records per transaction with progress; a failure rolls back the current chunk and stops with an accurate "imported N of M" report rather than leaving a silent partial state. Afterwards, `personalRecords` are **rebuilt from `setLogs`** rather than trusted from the file, so an edited backup cannot inject fake records.

Forward compatibility: a file with a *lower* `formatVersion` is upgraded by the same migration chain as the database. A *higher* version is refused with "this backup was made by a newer version of REPLOG".

**The import writes the envelope the file carries.** It goes through `Repository.restoreMany`, not `putMany`, because the ordinary write path stamps `createdAt`, `updatedAt`, `rev` and `origin` — correct for every other caller and wrong for exactly this one. `updatedAt` is the field step 2's merge compares, so stamping it to the moment of the import makes every record in the file newer than every local record; restoring a six-month-old backup would then win the *next* merge against everything logged since. `origin` says which device wrote a record and `createdAt` when it was first made, so stamped, a history restored from an old phone claims to have been written here today, and a measurement taken in October is dated to the day it was restored. None of this shows on the app's own screens, which read the domain fields — it is loss that reports success.

Round-trip tests must therefore move the clock between export and import. With a frozen clock every envelope field coincides by accident and the test passes while the import is destroying all four.

**Cascade ordering.** A workout deletion tombstones the workout first and its children after, so every child carries a `deletedAt` at or after its parent's. Restoring reverses exactly that set: a child tombstoned *earlier* was deleted on its own and stays deleted. This is why the order is load-bearing rather than cosmetic.

### 9.3 Destructive-action policy

| Action | Guard |
|---|---|
| Delete a set | Inline undo toast (5 s), soft delete |
| Delete a workout | Confirm sheet naming the date and set count; soft delete; recoverable from Settings → Data for 30 days |
| Discard an active workout | Confirm sheet stating elapsed time and completed sets |
| Delete a photo | Confirm sheet; **blobs are hard-deleted** and this is stated |
| Delete a plan/routine | Confirm; soft delete; history unaffected (explicitly stated in the dialog) |
| Delete a measurement | Inline undo toast |
| Import in replace mode | Type `REPLACE` + an automatic pre-flight export |
| Permanently delete past the recovery window | Offered on Settings → Data → Recently deleted, never run automatically; confirm names the count |
| Reset application data | Type `DELETE` + mandatory export offer + a second confirmation listing exactly what is destroyed |

No destructive action is ever a single unconfirmed tap, and no confirmation copy is vague ("Are you sure?"). Each dialog states the object, the scope, and the reversibility.

The typed phrase is **translated**, not a fixed Latin word. A gate that asks for `DELETE` on an Arabic keyboard is not deliberate effort, it is a locked door; the Arabic build asks for `احذف`. What the user types is trimmed before comparison — an on-screen keyboard's trailing space is not a different answer — and otherwise matched exactly.

Nothing purges tombstones on a schedule. The recovery screen lists what is still inside the window and offers to permanently delete what is past it; running that on page load would make it the one destructive action in the app that nobody chose. A background purge is not built.

### 9.4 Durability reality check

Browser storage can be evicted. The app must say so (spec §8) rather than imply permanence:

* First run shows a one-time, dismissible notice: local-only storage, eviction is possible, export regularly. Acknowledgement is recorded in `appMeta`. Built in Phase 12 as a card at the top of the dashboard rather than a dialog, and hidden optimistically before the acknowledgement is written — a write that fails in safe mode must not leave a notice that will not go away.
* `navigator.storage.persist()` is requested once. The result is displayed honestly in Settings → Data: *Protected* / *Best-effort (this browser does not grant persistent storage)*. On iOS it is best-effort.
* `navigator.storage.estimate()` drives a usage meter with a photo/record breakdown.
* A backup reminder appears when `now - lastExportAt > 14 days` **and** there are new completed workouts since then — a non-blocking card on the dashboard, snoozable, never a modal.
* At > 80 % of the estimated quota: a warning plus a one-tap path to the photo-pruning view. At > 95 %: photo writes are blocked while workout logging continues, because losing a set is worse than losing a picture.
* Settings → Data → About backups documents where data lives (Safari → this site's website data), that clearing website data or "Offload App" removes it, and how to restore from a backup file.

---

## 10. Validation Rules

Enforced in `domain/` and reused by both forms and the import validator — one implementation, two call sites.

| Field | Rule |
|---|---|
| `weightKg` | 0 ≤ w ≤ 1000; > 500 asks for confirmation |
| `extraWeightKg` | −200 … 200 |
| `reps` | integer 0 … 1000; > 100 asks for confirmation |
| `rpe` | 1 … 10, 0.5 steps |
| `rir` | integer 0 … 10 |
| `durationSec` | 0 … 86 400 |
| `targetSets` | integer 1 … 50 |
| `targetRepsMin/Max` | 1 … 1000, `min ≤ max` |
| `restSec` | 0 … 3600 |
| `bodyFatPct` | questioned outside 1 … 70; rejected outside 0 … 100 |
| Body measurements (cm) | questioned outside 1 … 300; rejected outside 0 … 1000 |
| `weightKg` (body) | questioned outside 20 … 500; rejected outside 0 … 2000 |
| `measuredAt` / `takenAt` | valid date, not more than 1 day in the future (timezone slack) |
| Text names | 1 … 80 chars after trim, non-empty |
| Notes | ≤ 2000 chars |
| `custom` keys | must resolve to a `customMeasurementDefs` id, **live or archived** — archiving stops a definition appearing in new entries, and the values already recorded against it have to stay readable |
| Enums | must be a declared member; import coerces unknowns to the designated fallback and reports it |

Out-of-range values are *questioned, not silently clamped*: the input shows "That's unusually heavy — is 650 kg right?" with Confirm/Edit. Clamping user data is a form of fabrication.

Every measurement range therefore has **two** bands, and the table above names both. The outer band is what the field physically means — a mass cannot be negative, a percentage cannot exceed 100 — and a value outside it is rejected, because it is not a measurement at all. The inner band is what is *plausible*, and a value outside it is questioned once and then saved exactly as typed. Only the outer band is an error; the inner one is a question, and the user's answer wins.

---

## 11. Capacity Expectations

| Data | Per unit | 1 year of serious training | 5 years |
|---|---|---|---|
| `workouts` | ~700 B | 200 × 700 B ≈ 140 kB | 700 kB |
| `workoutExercises` | ~600 B | 1 200 × 600 B ≈ 720 kB | 3.6 MB |
| `setLogs` | ~400 B | 5 000 × 400 B ≈ 2 MB | 10 MB |
| `measurements` | ~500 B | 100 × 500 B ≈ 50 kB | 250 kB |
| `exercises` | ~1.5 kB | 260 × 1.5 kB ≈ 390 kB | 400 kB |
| `personalRecords` | ~400 B | 250 × 400 B ≈ 100 kB | 500 kB |
| **Records subtotal** | | **≈ 3.5 MB** | **≈ 16 MB** |
| `photos` (full + thumb) | ~250 kB | 50 × 250 kB ≈ 12 MB | 60 MB |

Conclusion: structured data is negligible; **photos dominate**, which is why they are compressed aggressively, counted in a visible meter, and the first thing the quota warning offers to prune. iOS Safari grants roughly 1 GB per origin (subject to change and to eviction), so a realistic ceiling is hundreds of photos — the storage meter makes this visible rather than letting the user discover it by failure.

---

## 12. Integrity Checks

A `Settings → Data → Check data integrity` routine (also run automatically once after any import) reports, without modifying anything unless the user opts in:

* Workouts with `status: 'active'` older than 24 h → offer to finish or discard.
* More than one `active`/`paused` workout → offer to keep the newest.
* `setLogs` whose `workoutExerciseId` is missing → offer to drop (count shown).
* `workoutExercises` whose `workoutId` is missing → offer to drop.
* Cached rollups (`totalVolumeKg`, `totalSets`, `completedSetCount`, `prCount`) disagreeing with recomputation → offer to recompute.
* `personalRecords` disagreeing with a rebuild from `setLogs` → offer to rebuild.
* Orphan `photoBlobs` with no metadata, or metadata with a missing blob → offer to clean up, with reclaimable bytes shown.
* `exercises` referenced by history but hard-deleted → report (should be impossible; indicates a bug).
* `appMeta.schemaVersion` ≠ `DB_VERSION` → safe mode.

Every repair is opt-in, itemised, and reversible via the pre-repair export the dialog offers.
