# Version 2 — Database and sync

The plan for giving REPLOG a database, written the way the V1 plan was: phases
that are each independently useful, acceptance criteria that only get ticked
against evidence, and the deliberate omissions stated rather than implied.

Nothing here is built. This is the design and the order to build it in.

---

## 1. The decision that shapes everything else

**IndexedDB stays the source of truth. The cloud is a replica.**

Every write still goes to the local database first and returns immediately.
Sync is a background reconciliation that runs when there is a network and is
invisible when there is not.

The alternative — making Postgres the source of truth and reading through a
cache — is how most apps do it, and it would be wrong here. It would undo the
single property the whole of V1 was built around: that the app works in a
basement gym with no signal, and that confirming a set is a local write that
cannot fail for a reason outside the room. ARCHITECTURE §7 spends a page on the
tracker's write reliability. A cloud round-trip in that path throws it away.

So the shape is: **local-first with background sync.** The envelope every record
already carries — `updatedAt`, `rev`, `origin`, `deletedAt` — exists for exactly
this, and the `outbox` store has been declared and unused since Phase 2 waiting
for it.

Everything below follows from that one choice.

---

## 2. Why Supabase

| Candidate | Why not |
|---|---|
| **Firebase / Firestore** | Free tier caps writes at 20,000 a day. REPLOG's own soak dataset is ~13,000 records; a first sync of two years of training would spend two-thirds of a day's quota before the user had done anything. Its offline layer would also duplicate and fight the IndexedDB layer this app already owns, and a document store is a worse fit than Postgres for the set-log queries in DATABASE_SPEC §7. |
| **Neon / Turso / Cloudflare D1** | Database only. No auth, and no safe way for a browser to talk to them directly — each would mean writing and hosting a server, which is a second free tier to depend on and a backend this app does not otherwise need. |
| **PocketBase, self-hosted anything** | Needs a server that stays up. Free hosts that keep a process alive sleep it aggressively, which is a worse version of the pausing problem below with none of the compensations. |

**Supabase**, because for this app specifically:

1. **The browser talks to Postgres directly.** PostgREST plus the anon key plus
   Row Level Security means no server code at all. REPLOG stays a static site
   that can still be dropped on any CDN.
2. **Auth is included**, and sync needs an identity to scope rows by. 50,000
   monthly active users on the free plan, against this app's one.
3. **Storage is included**, with a `put`/`get`/`remove`-by-id shape that the
   existing `PhotoBlobStore` interface already matches.
4. **Realtime is included**, and `DbEvents` was built as the seam a remote
   change feed plugs into.
5. **Postgres makes the sync query trivial.** `where user_id = auth.uid() and
   updated_at > $since` — against an index that is just the envelope.
6. **"Unlimited API requests"** on the free plan. No per-day write cap to plan
   around, which is the thing that disqualifies Firestore.

### What the free plan actually gives, and whether it is enough

| Limit | Free plan | REPLOG's demand |
|---|---|---|
| Database | 500 MB | The soak dataset — 400 workouts, 10,000 set logs, 150 measurements, 60 photos, two years — is about 7 MB as JSON and narrower as Postgres rows. **500 MB is on the order of a century of training.** Not a constraint. |
| File storage | 1 GB, 50 MB per file | A processed REPLOG photo is a few hundred kB. **Thousands of photos.** Not a constraint. |
| Egress | 5 GB/month | First sync a few MB, then deltas. Not a constraint. |
| Auth | 50,000 monthly active users | One. Not a constraint. |
| Active projects | 2 | One. Not a constraint. |
| **Pausing** | **Free projects pause after 1 week of inactivity** | **This is the real one.** |

**The pausing, honestly.** A free Supabase project with no API traffic for a week
is paused and has to be woken from the dashboard. Training four times a week
keeps it awake by itself, because each session syncs. A two-week holiday does
not.

Local-first is what makes this survivable rather than an outage: a paused project
means **sync is unavailable**, not that the app is. Everything still logs, the
outbox still queues, and the next successful sync drains it. The cost is that the
user has to notice and click a button — so the sync status in Settings has to say
*why* it is not syncing, not just that it is not. That is a requirement below,
not an afterthought.

If the pausing ever stops being acceptable, the escape is Supabase's paid tier at
the usual small monthly figure, and nothing in this plan changes.

---

## 3. What already exists, and what the docs claim that does not

The V1 seams are real and this plan leans on all of them:

| Seam | Where | What it buys |
|---|---|---|
| `Repository<T>` + one DI token per aggregate | `data/repository.ts`, `data/tokens.ts` | A cloud repository can bind to the same tokens with no caller changed. |
| The record envelope | `domain/models/entity.ts` | `updatedAt` decides merges, `rev` counts local writes, `origin` says which device wrote it, `deletedAt` lets deletions replicate. |
| `restoreMany` | `data/repository.ts` | **The one write path that does not re-stamp the envelope.** Phase 11 added it because importing through `putMany` silently destroyed exactly the fields a merge depends on. The pull path needs the same thing, and it is already built and tested. |
| `outbox` store | `domain/models/system.ts`, `infrastructure/idb/schema.ts` | Fully modelled — `store`, `recordId`, `op`, `payloadRev`, `state`, `attempts`, `lastError` — declared since Phase 2, written by nothing. |
| `UnitOfWork` / `TxScope` | `data/unit-of-work.ts` | Multi-store atomic writes, which is what makes the outbox trustworthy. |
| `DbEvents` | `data/db-events.ts` | `{ local: false }` already exists for changes that arrived from elsewhere, and the UI already invalidates correctly on them. |
| `PhotoBlobStore` | `data/photo-blobs.ts` | Interface explicitly written as the cloud-storage seam. |
| `appMeta` | `domain/models/system.ts` | Device-local pointers and counters, explicitly **not** synced. The right home for sync cursors. |

**Three things ARCHITECTURE §11 claims that are not in the code.** Found while
writing this plan; fixing the document is part of Phase 15:

- `data/sync/sync-engine.ts` with `push`/`pull`/`resolve` — the **directory is
  empty**. There is no interface.
- `AuthProvider` with a `LocalOnlyAuthProvider` — **does not exist anywhere**.
- "per-field `updatedAt` on high-contention records (profile, prefs)" — `Profile`
  has one envelope like every other record. There are no per-field timestamps.

None of them is hard to add. All three being described as present is worse than
their absence, because the first phase of V2 would have been planned around
seams that are not there.

---

## 4. The phases

Effort figures are the same units the V1 plan used. Each phase is independently
shippable and independently useful.

### Phase 15 — Make the seams real · 1 session

No network, no behaviour change, no new dependency.

1. `data/sync/sync-engine.ts` — the interface the rest of the plan codes
   against: `push()`, `pull()`, `status()`, and a `SyncStatus` shape covering
   *offline*, *syncing*, *up to date*, *failed (reason)* and *signed out*.
2. `core/auth/auth-provider.ts` — `currentUser()`, `signIn()`, `signOut()`, and a
   `LocalOnlyAuthProvider` returning a fixed local owner so V1 behaviour is
   unchanged and every call site is written once.
3. Correct ARCHITECTURE §11 to describe what exists.

**Done when:** the interfaces exist, `LocalOnlyAuthProvider` is bound in
`app.providers.ts`, the lint boundaries still hold, and §11 is true.

---

### Phase 16 — The outbox · 2 sessions

**The foundation, and worth building even if sync never ships**, because it is
the thing that makes a later sync possible without re-auditing every write.

1. Every `put`, `patch`, `putMany` and `remove` through `IdbRepository` also
   writes an `OutboxEntry` — **in the same IndexedDB transaction as the data
   write**. This is the single hard requirement of the phase. An outbox written
   in a second transaction can be lost while the data write succeeds, and the
   result is a record that exists locally, never syncs, and never reports a
   problem. `TxScope` already makes this possible; nothing else does.
2. `restoreMany` does **not** enqueue: an import is a restore, and the pull path
   uses it too. Enqueuing there would push a whole restored history back at the
   server as if it were new local work.
3. Coalescing: ten edits to one record between syncs produce one pending entry,
   carrying the latest `rev`.
4. A `pendingCount` signal, for the UI in Phase 21.

**Done when:** a test kills the app mid-write and finds the record and its outbox
entry either both present or both absent, never one without the other; 200 rapid
set confirmations produce 200 records and at most 200 entries; and the tracker's
write-latency budget is unchanged.

---

### Phase 17 — The schema and the identity · 2 sessions

1. A Supabase project. Auth by **magic link** — for a single user, a password is
   a thing to lose with no compensating benefit.
2. `supabase/migrations/*.sql` **in this repository**, so the schema is
   version-controlled like everything else and a second device is not configured
   by hand.
3. One table per synced store, columns mirroring the stores exactly, plus
   `user_id uuid not null default auth.uid()`.
4. **Row Level Security enabled on every table, with no exceptions**, each with
   `using (user_id = auth.uid())` for select, insert, update and delete. A table
   without RLS is readable by anyone holding the anon key, and the anon key ships
   in the client bundle. This is the one place in the plan where a mistake is a
   data breach rather than a bug.
5. `create index on <table> (user_id, updated_at)` on every table. That index
   *is* the pull query.
6. **`exercises` is special.** The 168 built-ins are seeded identically on every
   device from a file in the bundle. Syncing them would copy the same rows per
   device for nothing. Sync only custom exercises and user-edited built-ins; the
   catalog itself is not user data.
7. `appMeta` is never synced. It holds this device's id and its pointers, and a
   device id that replicated would stop meaning what `origin` means.

**Done when:** the migration runs from empty, RLS is proven by a test that signs
in as one user and fails to read another's rows, and the schema matches
`STORES` field for field.

---

### Phase 18 — Push · 2 sessions

1. Drain the outbox oldest-first, in batches, on: app start, after a workout
   finishes, on reconnect, and on a timer while the app is open.
2. `upsert` on the primary key with a guard — `where excluded.updated_at >
   <table>.updated_at` — so an out-of-order or retried push can never move a
   record backwards.
3. `op: 'remove'` writes the **tombstone**, never a hard `DELETE`. A deletion
   that does not replicate reappears from the other device on the next pull,
   which is the classic sync bug and the reason soft deletes were built in V1.
4. Backoff and retry; `attempts` and `lastError` are already on the model. A
   permanently failing entry surfaces in the UI rather than retrying forever in
   silence.
5. **Never during an active workout.** Pushing is not free, and the one screen
   with a latency budget is the one the user is standing in.

**Done when:** an offline session queues and drains on reconnect; a push
interrupted halfway leaves the undrained entries pending; replaying the same
batch twice changes nothing; and a deleted record is a tombstone on the server.

---

### Phase 19 — Pull and merge · 3 sessions

The hardest phase. Everything else is plumbing; this is where correctness lives.

1. A per-store `lastPulledAt` cursor in `appMeta`.
2. `select * from <table> where updated_at > $cursor order by updated_at`, paged.
3. **Merge rule: last write wins on `updatedAt`, tie-broken on `origin`
   lexicographically.** The tie-break is not decoration — without it, two devices
   that wrote in the same millisecond disagree about which won and push each
   other's answer back and forth forever. With it, both compute the same winner
   from the same two records and converge.
4. Write through **`restoreMany`**, which does not re-stamp the envelope. Using
   `putMany` here would stamp every pulled record as locally written *now*, which
   makes it outrank everything and makes the next merge in the other direction
   wrong. This is the same bug Phase 11 found in import, and the same fix.
5. Emit `DbEvents` with `local: false`. The UI already invalidates correctly on
   that; it is how the multi-tab relay works and it is already tested.
6. **Never merge into the live workout's aggregate.** A pull that lands
   mid-session must not rewrite the sets being logged. Hold those records and
   apply them when the session finishes. A set the user is looking at must not
   change underneath them because another device said so.
7. Pull **before** push on start, so a local record that lost a merge is not
   pushed again as if it had won.

**Done when:** two browser contexts converge on the same database from both
orderings; the same edit made on both sides resolves identically on both; a
deletion on one device removes the record on the other and does not come back on
the next sync; and a pull during an active workout leaves every logged set
untouched.

---

### Phase 20 — Photos · 2 sessions

1. `SupabasePhotoBlobStore` implementing the existing `PhotoBlobStore`
   contract, with IndexedDB kept as the local cache. No caller changes.
2. Upload **lazily, last, and never during a workout**. Photos are most of the
   bytes and none of the training record.
3. A per-photo upload state so a half-uploaded gallery is honest about which
   images exist only on this device.
4. Download on demand rather than eagerly: a new device should become usable
   immediately with its training history, and fill in photos in the background.

**Done when:** a photo taken on one device appears on the other; the local cache
means an offline gallery still renders; and deleting a photo removes both the
row and the object.

---

### Phase 21 — The screens · 2 sessions

Sync that cannot be seen cannot be trusted.

1. A **Sync** section in Settings: signed in as, last synced, pending count,
   **Sync now**, **Sign out**.
2. States written as plainly as the rest of the app's copy, each saying what to
   do: *offline*, *syncing*, *up to date*, *failed — with the reason*, and
   **project paused**, which is the free plan's own failure mode and deserves
   its own sentence rather than a generic error.
3. **Never a blocking spinner.** Sync is background by definition; a screen that
   waits for the network is the thing this plan exists to avoid.
4. **First sign-in on a device that already has data** asks the question the
   import screen already asks, in the same words: **merge** (default — keep both,
   newer wins) or **replace** (take the cloud's copy). Reusing that vocabulary is
   free and means the user has already learned it.
5. The About screen's honesty list changes: "Version 1 keeps everything on this
   device. Nothing is uploaded" stops being true the moment this ships, and must
   be rewritten the same day rather than the week after.
6. The user guide gets a Sync section, and its "one device, one copy" framing is
   revised — **a backup is still the only copy you control**, even with sync.

**Done when:** every state above can be reached and read on screen, in both
languages, and axe passes on the new screen like every other.

---

### Phase 22 — Proving it · 2 sessions

1. Two-context Playwright tests: write in A, sync, assert in B.
2. Offline → queue → reconnect → drain → converge.
3. Conflict: the same record edited in both contexts, from both orderings,
   asserting the same winner.
4. The soak dataset through a real initial sync, measured — that is the slowest
   sync this app will ever do, and the number is worth knowing.
5. A test that signs in as a second user and can read nothing of the first's.
   RLS is the one failure here with a consequence outside the app.

**Done when:** all of the above pass by exit code, on Chromium and WebKit.

---

## 5. Order, and what to do first

The phases are in dependency order, but the useful observation is that
**15 and 16 are worth doing on their own**. They add no dependency, no account
and no network. They leave the app exactly as it behaves today, with a queue of
every change it has made — which is the hard part of sync, done in a place where
nothing can go wrong yet.

If V2 is ever abandoned, Phase 16 is still a better-instrumented app. If it is
not, everything after it is plumbing against an interface.

**Estimated total: 16 sessions**, against the 14 phases and ~140 sessions of V1.

---

## 6. What this deliberately does not do

- **It is still a single-user app.** Sharing, trainer access and family accounts
  are out of scope. The row-level scoping makes them possible later; nothing
  here builds toward them.
- **It does not make the cloud authoritative.** No screen waits on the network.
- **It does not replace backups.** A sync replicates your mistakes as faithfully
  as your training. Delete a year of history on one device and it deletes on the
  other. The export file is the only copy that is a copy, and the backup reminder
  stays.
- **It does not add push notifications.** The platform limits in PRODUCT_SPEC are
  unchanged by having a server; a web app on iOS still cannot alert you mid-rest.
- **It does not sync `appMeta` or prefs-as-device-state.** Theme and language are
  arguably per-user; the device id and active-workout pointer are definitively
  not. If preferences are ever synced it is a separate, explicit decision about
  each field, not a store copied wholesale.

---

## 7. The risk worth naming twice

**RLS is the one mistake with a consequence outside this app.** The anon key is
in the client bundle, which is public by design. A table created without RLS, or
with a policy that forgets one of the four operations, is readable and writable
by anyone who views source.

So: RLS is enabled in the same migration that creates the table, never a later
one; every table's policy covers select, insert, update and delete; and Phase 22
has a test that signs in as a second user and proves it cannot read the first
user's rows. That test is not optional and it is not a formality.
