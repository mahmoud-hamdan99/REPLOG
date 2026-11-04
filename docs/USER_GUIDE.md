# REPLOG — the complete guide

Everything REPLOG does, how to do it, and the handful of things it deliberately
will not do. Written for the person using the app, not the person building it.

If you read nothing else, read [The one thing to understand](#the-one-thing-to-understand)
and [Backing up](#backing-up-exports-imports-and-the-reset-button). The rest you
can look up when you need it.

---

## Contents

1. [What REPLOG is](#what-replog-is)
2. [The one thing to understand](#the-one-thing-to-understand)
3. [Getting started](#getting-started)
4. [A map of the app](#a-map-of-the-app)
5. [Your first workout](#your-first-workout)
6. [Building a plan](#building-a-plan)
7. [Training: the tracker in full](#training-the-tracker-in-full)
8. [The exercise library](#the-exercise-library)
9. [History](#history)
10. [Records](#records)
11. [Progress and analytics](#progress-and-analytics)
12. [Body measurements](#body-measurements)
13. [Progress photos](#progress-photos)
14. [Settings](#settings)
15. [Backing up: exports, imports and the reset button](#backing-up-exports-imports-and-the-reset-button)
16. [Recently deleted](#recently-deleted)
17. [Storage and the integrity check](#storage-and-the-integrity-check)
18. [Offline use and updates](#offline-use-and-updates)
19. [Arabic, right-to-left and numerals](#arabic-right-to-left-and-numerals)
20. [Accessibility](#accessibility)
21. [What REPLOG does not do](#what-replog-does-not-do)
22. [Troubleshooting](#troubleshooting)
23. [Quick reference](#quick-reference)

---

## What REPLOG is

REPLOG is a workout and strength tracker. You build plans, log the sets you
actually do, and watch the numbers over time.

It is a web app that behaves like a native one: add it to your home screen and
it opens full-screen, works with no signal, and keeps everything on your phone.
It is built for one person — you. There is no account, no login, no sharing, no
feed, and nobody else's data to compare yourself against.

Everything in it is in English and Arabic, with a full right-to-left layout, and
in a light and a dark theme.

---

## The one thing to understand

**Your training is stored in this browser, on this device. Nowhere else.**

Nothing is uploaded. There is no server holding a copy, no account to log back
into, and no support desk that can recover anything. That is the deal that makes
the app private and free and able to work with no signal.

The price is that a few ordinary things will delete everything:

- Clearing your browser's website data or history (depending on what you clear).
- "Offload app" on iOS, or uninstalling the browser.
- iOS reclaiming space on a device that is nearly full, if it decides REPLOG's
  data is stale. This is rare, and more likely if you have not opened the app in
  a long time.
- Using a different browser, or a different phone. They do not share anything.

**So: export a backup regularly.** A backup is a single file you keep wherever
you keep files. It is the only copy that survives any of the above. The app will
remind you if you have trained since your last export and it has been a while,
and you can export at any time from **Settings → Data & backup → Export**.

See [Backing up](#backing-up-exports-imports-and-the-reset-button) for the
whole story.

---

## Getting started

### Opening it

Open the REPLOG address in Safari on iPhone, or in any modern browser on a
computer. There is nothing to sign up for — the first screen is the app.

The very first time, you will see a short note titled **"Where your training is
kept"** saying what the section above says. It offers to export a backup right
then. There is nothing to back up yet, so "Got it" is a perfectly good answer —
just remember the offer exists.

### Adding it to your home screen (iPhone)

Worth doing. It gives you a full-screen app with no browser chrome, its own icon,
and a more durable place in the system.

1. Open REPLOG in **Safari** (this does not work from Chrome on iOS).
2. Tap the **Share** button — the square with the arrow.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

REPLOG now has an icon like any other app. Open it from there from now on.

On Android or desktop Chrome you will usually get an **Install** prompt in the
address bar or a menu instead.

### Setting it up the way you like it

Go to **More → Settings** and spend two minutes on:

- **Language** — English or العربية. The whole interface changes instantly, and
  the layout mirrors for Arabic.
- **Theme** — System, Light or Dark.
- **Units** — kilograms or pounds, centimetres or inches. You can change these
  whenever you like; see the note under [Units](#units) about why it is safe.
- **Profile** — entirely optional. Nothing here is needed to log a workout.

---

## A map of the app

Five tabs along the bottom:

| Tab | What lives there |
|---|---|
| **Home** | The dashboard — this week, consistency, recent records — and your workout history. |
| **Plans** | Your training plans and their workout days. The exercise library lives under this tab too. |
| **Train** | The big round button in the middle. Start today's session, or a quick one. |
| **Progress** | Charts, records, body measurements and photos. |
| **More** | Settings, backups, recently deleted, about. |

While a workout is running, the tab bar disappears — the tracker takes the whole
screen, and leaving it is a deliberate choice rather than a stray tap. If you
pause and leave, the **Train** screen shows **Workout in progress** with a
**Resume** button waiting for you.

---

## Your first workout

You do not need a plan to train. The fastest path from nothing to a logged set:

1. Tap **Train**.
2. Tap **Quick workout**. An empty session starts and the clock begins.
3. Tap **Add exercise**. Search for what you are doing — "bench", "squat",
   "curl" — and tap it, then **Add**. You can add several at once.
4. Tap the **weight** box on the first row. A number pad slides up.
5. Type the weight, tap **Next field**, type the reps, tap **Done**.
6. The set is now filled in but not yet counted. Tap the **circle** at the end of
   the row to confirm it. It turns into a tick, the row fills in, and the rest
   timer starts.
7. Repeat for every set. **Add set** gives you another row.
8. When you are finished, tap **Finish**, then **Finish workout**.

You land on the summary: duration, volume, sets, reps, any records you just set,
and a place to say how it felt. Tap **Done** and it is in your history.

**The important rule:** a set counts when you confirm it, not when you type it.
A row with numbers in it and no tick is a plan, not a fact, and the summary will
tell you plainly how many of those it did not save.

---

## Building a plan

A **plan** is a program — "Push/Pull/Legs", "Upper/Lower", "Winter block". It
contains **workout days**, each of which is a list of exercises with targets.
Only one plan is **active** at a time; that is the one the Train screen offers
you and the one your consistency is measured against.

### Making a plan

1. **Plans → New plan**.
2. Give it a name. Changes save as you type — there is no Save button and nothing
   to lose by leaving the screen.
3. **New workout day** creates a day inside it.

### Inside a workout day

- **Name** it — "Push A", "Legs", whatever you call it.
- **Schedule** — either **Fixed days** (pick the weekdays it happens on) or
  **Flexible** (no fixed day; it appears under "Other workout days" on the Train
  screen whenever you want it).
- **Add exercise** opens the picker. Select as many as you like and add them in
  one go.
- Each exercise row has a **Configure** option where you set:
  - **Sets** — how many you intend to do.
  - **Reps** — a fixed number, or a range like 8–12.
  - **Target weight** — optional.
  - **Rest** — how long between sets. This beats the app-wide default.
  - **Warm-up sets** — how many extra warm-up rows to put at the top.
  - **Notes** — anything you want to read mid-set.
  - **Optional** — mark an exercise you do only when time allows.
- **Move up / Move down** reorders exercises.
- **Group with next** makes a **superset**: the tracker then alternates between
  the grouped exercises instead of finishing one before starting the next.

The estimated duration under the day is exactly that — an estimate, built from
your sets, your rest and a guess at transitions. It is labelled as one.

### Plans you no longer use

- **Archive** keeps a plan and its history but takes it out of the way.
- **Duplicate** makes a completely independent copy you can edit freely.
- **Delete** is only offered for a plan that has never been trained. If it has
  recorded workouts, the app says so and offers to archive instead — deleting
  would make your own history harder to read.

**Editing a plan never changes a workout you have already done.** Every session
keeps a frozen copy of what the plan said on the day. Rename a routine, swap an
exercise, change the targets — last month's session still reads exactly as it
happened.

---

## Training: the tracker in full

### Starting

On the **Train** tab you will see:

- **Today** — the workout day your active plan has scheduled for today.
- **Other workout days** — everything else in the plan, including flexible days.
- **Quick workout** — an empty session with no plan behind it.
- **Repeat last workout** — the same structure as your last session, empty.

Tapping a workout day shows a short **Start** sheet listing its exercises. Tap
any exercise there to **skip it today** before you begin; it stays in the plan
and is marked as skipped in this session's record. Then **Start workout**.

### The set row

Each row is one set:

| Column | What it is |
|---|---|
| **Set** | The set number, or **W** for a warm-up. Tap it to change the set type. |
| **Previous** | What you did on this exercise last time. |
| **Weight** | Tap to open the number pad. |
| **Reps** | Tap to open the number pad. |
| **○ / ✓** | Confirm the set. This is what makes it count. |

Swipe a row sideways to delete it; a toast offers **Undo** for a few seconds.

The **Previous** column is variant-aware: a dumbbell press will not show you a
barbell press as "last time", because they are not the same lift.

### The number pad

Tapping a weight or reps box opens a pad sized for thumbs:

- Digits, a decimal point and a **double zero** key.
- **Backspace** and **Clear**.
- **Quick adjust** — plus and minus buttons that step by the exercise's own
  weight increment (2.5 kg for a barbell, 1 kg for some machines, and so on).
- **Last time** is printed at the top so you are not guessing.
- **Next field** moves weight → reps. **Done** closes the pad.

### Suggestions

If you have history on an exercise, the tracker can suggest the next set:
"Every set reached 12 last time" → a little more weight. "Three sets fell short"
→ a back-off.

Suggestions are **never filled in for you**. They appear as an offer with the
reasoning written out, and **Use this** fills the fields — which still leaves the
set unconfirmed until you have actually done it. You can turn suggestions off
entirely in **Settings → Workout**.

### Rest timer

Confirming a set starts a rest countdown, shown as a sheet and then as a pill you
can tap. It tells you what is coming next, and offers **−15s**, **+15s** and
**Skip rest**.

The countdown is derived from the clock, not from a ticking timer, so it stays
correct if you lock the screen, switch apps or take a call for ten minutes.

**The limitation, stated plainly:** no sound or alert can reach you while the app
is in the background or the screen is locked. iOS does not permit it for a web
app, and REPLOG does not pretend otherwise. The timer will be correct when you
come back; it just cannot tap you on the shoulder.

**Keep the screen awake while training** (in Settings) stops the screen dimming
between sets, where the browser supports it.

### Simple and advanced logging

**Simple** logs weight and reps. **Advanced** adds **RPE**, **RIR**, **set
types** (warm-up, working, drop set, to failure, back-off) and a per-set note.
You can switch mid-session; it changes what the rows show, not what is stored.

### Mid-session changes

The workout options menu and each exercise's own menu let you:

- **Add exercise** — anything not in the plan.
- **Add set** / **Add warm-up**.
- **Skip for today** / **Put back in**.
- **Replace** — swap one exercise for another, keeping the slot.
- **Move up / Move down**, **Group with next** / **Remove from superset**.

### Pausing, leaving, and not losing anything

**Pause** stops the clock. Paused time does not count toward your session
duration, so an eight-hour pause does not turn a 40-minute session into an
eight-hour one.

If you try to navigate away — including with the browser's back button — the app
stops you and asks:

- **Keep training** — stay here.
- **Pause and exit** — the session waits for you. The Train screen then shows
  **Workout in progress**, with **Resume** and **Finish now**.
- **Discard workout** — throw it away. The confirmation tells you exactly how long
  you trained and how many sets go with it, and discarded sessions are
  recoverable from **Recently deleted** for 30 days.

Closing the browser, running out of battery or reloading mid-set does not lose
confirmed sets. Next time you open the app it asks **"Resume your workout?"** and
names the session, its duration and its set count. It never resumes on its own —
that is your decision, not the app's.

If you open REPLOG in a second tab while a session is live, the second tab goes
**read-only** and says so, so two tabs cannot fight over the same workout.

### Finishing

**Finish** → **Finish workout** (that confirmation can be switched off in
Settings). The summary shows:

- **Duration, volume, sets, reps** — measured, not estimated.
- Any **unconfirmed sets that were not saved**, counted out loud rather than
  quietly dropped.
- Any sets with **no volume figure** (a bodyweight set with no added weight, for
  example) and why they are not in the total.
- **Records** you just set, each marked as a first record or an improvement over
  a named previous best.
- **How did it feel?** — Great / Good / OK / Rough, and a session note.
- **Copy as text** puts a plain-text summary on your clipboard.

---

## The exercise library

**More → Settings → Exercise library → Browse and edit exercises**, or the
picker that opens whenever you add an exercise to a workout or a routine. (The
library screen belongs to the **Plans** tab, so that tab lights up while you are
in it.)

168 exercises, each with English and Arabic names, the muscles it works, its
equipment, its type, and its default rest and weight step. Some include written
instructions and cues; many do not yet, and the app says so rather than showing
an empty heading.

- **Search** matches names and aliases. Arabic search ignores diacritics,
  tatweel and alef variants, so you do not have to type it perfectly.
- **Filter** by muscle group, equipment, type, **Favourites** or **Mine**.
- **Favourite** anything you use constantly; favourites sort to the top.

### Your own exercises

**New exercise** creates one. Give it an English and an Arabic name, pick its
muscle, equipment, type and load, and it behaves like any built-in from then on —
including in records and charts.

### Editing a built-in

You can edit any built-in exercise. Your version is yours: future updates to the
app's own catalog will leave it alone, and the detail screen says so. **Reset to
original** undoes that.

**Archive** hides an exercise you never use without touching the history that
mentions it.

**Delete** is only for exercises you created, and it is the one action in REPLOG
with no undo — deleted exercises are not listed under Recently deleted. The
confirmation says so. Your history stays readable either way, because every
workout records the exercise's name as it was on the day.

---

## History

**Home → Workout history**, from the dashboard.

Sessions newest first, grouped by month, paged with a **Load more** button rather
than an endless scroll, so you can actually reach the end of your own history.

**Filters** narrow by workout day, exercise or date range.

### A session's detail

Tap any session to see exactly what was recorded: every exercise, every set,
weights and reps as logged, your body weight on the day if you had one, and your
session notes. A banner reminds you that this is what happened on the day, not
what the plan says now, and tells you if the workout day has since changed or
been deleted.

From here you can:

- **See every session of this exercise** — the whole arc of one lift, listed as
  performed, with equipment variants kept separate rather than merged.
- **Repeat this workout** — start a new session with the same structure.
- **Correct a mistake** — edit a past session in place. Changes save as you make
  them, and the session is marked **Edited** in the list afterwards, so a
  corrected record never passes itself off as an untouched one.
- **Delete workout** — the confirmation says how many sets go with it, and it is
  recoverable for 30 days.

---

## Records

**Progress → Records.**

A personal record is set automatically when you confirm a working set that beats
your previous best. There are five kinds:

| Record | What it means |
|---|---|
| **Heaviest weight** | The most weight you have moved on this lift, at any rep count. |
| **Most reps at a weight** | Your best rep count at a specific load. |
| **Estimated one-rep max** | A calculation, not a measurement. See below. |
| **Biggest single set** | The most volume (weight × reps) in one set. |
| **Biggest session** | The most volume on this exercise in one workout. |

Three rules worth knowing:

1. **Records are per exercise *and* equipment.** A dumbbell press never replaces
   a barbell press, because they are not the same lift. The screen says so.
2. **An estimated one-rep max is an estimate.** It is calculated from a set you
   actually did, using either the Epley or Brzycki formula — your choice in
   Settings — and every estimate on screen names the formula behind it. Changing
   the formula changes the estimates and nothing else; every weight and rep you
   logged stays exactly as logged.
3. **Weighted bodyweight work is scored on the weight you added.** A record
   cannot arrive just because your body weight went up.

Each record links back to the exact set that produced it. **Open the workout**
takes you there.

---

## Progress and analytics

### The dashboard (Home)

- **This week** — completed sessions, counted.
- **Consistency** — how many of the last weeks hit your plan's schedule, plus
  your current streak. This needs an active plan; without one the tile says so
  rather than inventing a target.
- **Recent records**, and shortcuts into the full lists.

### The Progress tabs

- **Strength** — pick an exercise and see its estimated one-rep max, heaviest
  set and best sets over time.
- **Volume** — volume, sets and sessions per week, plus a **Muscle groups**
  breakdown.
- **Body** — body weight, waist, chest, hips and body fat over time, with the
  net change across the range.
- **Records** and **Photos** are the other two tabs.

Measurements themselves are entered from the **Body** tab, via **Log a
measurement**.

Every chart has a **time range** — 7 days, 30 days, 3 months, 6 months, 1 year,
all time.

### How to read the charts

Three things REPLOG does differently, all of them deliberate:

- **A gap is a gap.** If you did not weigh yourself for three weeks, the line
  breaks. It is not joined up across the hole, because a straight line there
  would be a drawing of data you do not have. The chart says so underneath.
- **Not enough data says so.** Rather than drawing a confident-looking line
  through two points, it tells you there are too few readings for a trend.
- **Anything calculated is labelled.** Moving averages name their window.
  Estimates name their formula.

The muscle-group breakdown counts working sets only, once each, against the
exercise's first primary muscle — and it tells you how many sets it could not
place because their exercise names no muscle, rather than silently dropping them.

### Everything is counted, nothing is guessed

Every figure on these screens is computed from the sets you confirmed. An empty
bucket is zero for a total and unknown for a measurement — the app will not fill
in a week you did not train with a plausible number.

---

## Body measurements

**Progress → Body → Log a measurement.** The Body tab is the chart; the button
under it opens the measurements screen, which is where entries are added, edited
and compared.

### Adding an entry

**Add measurements** opens a form where **every field is optional**. Most days
you will only weigh yourself, and a weight-only entry is a complete entry — save
as soon as anything has a value.

Available fields: body weight, height, body fat, neck, shoulders, chest, waist,
hips, biceps (left and right), forearms, thighs, calves — plus anything you add
yourself.

Each field shows your **last value** so you can see what has changed.

Two things the form does for you:

- **An unusual value is questioned, not blocked.** Type 920 kg and it asks "That
  is unusual for body weight. Is 920 right?" — and if you say yes, it saves
  exactly what you typed. It will not silently round or clamp your number.
- **A second entry on the same day** offers to merge into the existing one or
  keep both. Several entries per day are allowed.

### The date

An entry keeps the day it was **measured**, not the day you typed it in, so
catching up on a week of weigh-ins records them correctly. Future dates are
refused.

### Custom measurements

**Custom measurements** lets you track anything else — resting heart rate, sleep
hours, a lift you score by count. Give it a name and say whether it is a weight,
a length, a percentage or a count, and it appears in the entry form from then on.

**Archive** a custom measurement to stop it appearing in new entries. It stays in
every entry that already recorded it.

### Compare

**Compare two dates** puts two entries side by side with the difference for every
field they share. Fields measured on only one of the two days are named as such
rather than shown as a change from zero.

---

## Progress photos

**Progress → Photos.**

### Adding one

**Add a photo**, pick an image, choose a **pose** — Front, Left side, Right side,
Back or Other — set the date and add a note.

**The date is read from the photo's own metadata** where it has any, so a picture
you took last Sunday is filed on Sunday.

### Privacy

- **Photos never leave your device.** Nothing is uploaded, and no request leaves
  the phone while a photo is imported.
- **Location data is removed** when a photo is added. The copy REPLOG stores does
  not know where it was taken.
- **Hide thumbnails until tapped** (Settings → Photos) blurs every thumbnail in
  the gallery. Be clear about what that is: it is a privacy screen against a
  glance over your shoulder, not an app lock. Anyone holding your unlocked phone
  can open the app.

### Using them

- **Filter by pose** so you compare like with like.
- **Compare** puts two photos side by side and tells you how far apart they were
  taken — "11 weeks apart" — and the body weight recorded with each.
- **Select** lets you delete several at once. Photo deletion is **permanent**:
  the image itself cannot be recovered, and the confirmation says so.

Photos are by far the largest thing REPLOG stores. If storage gets tight, they
are the first thing to thin out.

---

## Settings

**More → Settings.**

### Appearance

- **Theme** — System, Light, Dark.
- **Reduce motion** — System, Always, Never. "System" follows your device's own
  accessibility setting; the other two override it in either direction.

### Language

English or العربية, applied instantly with no reload. The whole layout mirrors
for Arabic.

### Photos

**Hide thumbnails until tapped** blurs every thumbnail in the gallery. It is a
privacy screen, not an app lock — the setting says so itself.

### Profile

Name, date of birth, sex, height, main goal, experience level. **Every field is
optional and nothing here is needed to log a workout.** Sex is used only where a
formula asks for it, and nothing is inferred from any of it. None of it is sent
anywhere, because nothing is sent anywhere.

### Units

- **Weight unit** — kg or lb.
- **Length unit** — cm or in.
- **Numerals** — 1234 or ١٢٣٤.
- **Week starts on** — Sunday, Monday or Saturday.

**Changing a unit never alters a recorded value.** Everything is stored in metric
and converted only for display, so switching to pounds re-labels your history
rather than rewriting it, and switching back gives you exactly what you had.

### Workout

- **Default rest** — used when an exercise has no rest of its own. Per-exercise
  rest always wins.
- **Start the rest timer automatically** when you confirm a set.
- **Play a sound when rest ends** — while the app is open and the screen is on.
- **Keep the screen awake while training.**
- **Vibrate when a set is completed**, where the device supports it.
- **Tracking mode** — Simple or Advanced (see
  [Simple and advanced logging](#simple-and-advanced-logging)).
- **Estimated 1RM formula** — Epley or Brzycki. Changes estimates only.
- **Ask before finishing a session.**
- **Show last time's performance** in the tracker.
- **Suggest the next set.**

### Data & backup

Exports, imports, recently deleted, storage, the integrity check and the reset
button. The whole of the next three sections.

### Exercise library

A shortcut into [the library](#the-exercise-library).

### About

Version, build, database version, locale and this device's short identifier —
read from the app, not guessed. A list of what REPLOG genuinely cannot do on
iOS, written as facts rather than apologies. A **Diagnostics** log of anything
that went wrong this session, kept in memory only, with a **Copy** button so you
can paste it somewhere useful. And a direct link to **Data & backup**.

---

## Backing up: exports, imports and the reset button

**Settings → Data & backup.** The most important screen in the app.

### Export a backup

One JSON file containing everything: workouts, sets, plans, routines,
measurements, custom measurements, photos' details, personal records, your
profile and your preferences.

- **Include photos** adds the images themselves. This makes the file roughly a
  third larger than the photos are, because images have to be written as text.
  Without it you get everything else, and the photo entries without their
  pixels.
- The screen estimates the size before you commit to it, and says it is an
  estimate.
- The file is named by date and time, so a folder of them sorts itself.

It is plain, readable, indented JSON. You can open it in a text editor and read
your own training. That is on purpose: if this app disappeared tomorrow, your
history would still be a file you can read and move somewhere else.

**How often?** After anything you would hate to redo. The app nudges you when
you have trained since your last export and it has been about two weeks; you can
snooze that for a week.

### Export a spreadsheet (CSV)

One table at a time — workouts, sets, measurements and so on — for a spreadsheet
or another app.

**This is not a backup.** It cannot be imported back, it leaves out photos, and
it flattens away anything nested. The screen says so. Use it for a pivot table,
not for safekeeping.

### Restore from a backup

**Choose a file** reads the file and shows you a report **before writing
anything**:

- What it contains, counted per section.
- Anything wrong with it, in plain language: records missing an id, records
  pointing at something that is not in the file, duplicates, sections this
  version does not recognise.
- Whether it matches its own checksum. If it does not — the file was edited or
  truncated — you get a warning, not a refusal. A damaged backup is still better
  than no backup, and the choice is yours.
- If the file cannot be understood at all, or was written by a newer version of
  REPLOG, the report says so and there is no way forward but a different file.

Then you choose:

- **Merge** — keeps everything you have now and adds what the file has. Nothing
  is deleted. Where both have the same record, the newer one wins. This is the
  safe choice, and the right one if you are restoring onto a device you have
  been using.
- **Replace everything** — deletes everything on this device first, then restores
  the file exactly. **A backup of your current data is exported automatically
  first**, before anything is removed. This needs you to type `REPLACE` to
  confirm.

Importing does not trust the file about your records: personal records are
rebuilt from the set logs, so a file claiming a 300 kg bench cannot produce one.

### Reset all data

Deletes every workout, plan, routine, measurement, photo and personal record on
this device. It cannot be undone and there is no copy anywhere else. It needs you
to type `DELETE`.

The typed words are `DELETE` and `REPLACE` in English, and `احذف` and `استبدل`
in Arabic — each one typeable on the keyboard you are already using, which is
the point of having a translated phrase at all.

---

## Recently deleted

**Settings → Data & backup → Recently deleted.**

Deleted workouts, measurements, plans and routines wait here for **30 days**
before they are gone for good, each showing how many days it has left. Restoring
a session brings back the sets that went with it; restoring a plan brings back
its routines.

Two things it does not cover, both stated on screen where they matter:

- **Photos** are deleted permanently and immediately.
- **Exercises you created** are not listed here.

Items past the 30-day window can only be removed for good, and the screen offers
to do that in one go.

---

## Storage and the integrity check

### Storage

The Data screen shows how much space your data is using out of what the browser
will give it, and which of two modes you are in:

- **Protected** — the browser has agreed not to clear your data on its own. Tap
  **Ask for protected storage** to request this; the browser decides.
- **Best effort** — the browser may clear your data if the device runs low. Export
  regularly.

Some browsers will not say how much is used, and REPLOG says that rather than
inventing a figure.

If space runs short you will see a warning at around 80 % ("removing a few photos
is the quickest fix") and, if it actually fills, a clear statement that new
photos cannot be saved **but workouts still log normally** — which is the part
that matters mid-session.

### Check data integrity

**Run check** looks at your actual database and reports what it finds: sets whose
exercise is gone, workouts whose totals no longer match their sets, images
belonging to no photo, a workout that has been "in progress" for over a day, and
so on.

Each finding comes with **Fix this**. The screen asks you to export first, and
means it.

Most of the time this reports **"Nothing to fix."** It is there for the rare day
when something has gone wrong, so you can see what rather than guess.

---

## Offline use and updates

### Offline

After the first load, REPLOG works with no connection at all. Every screen, the
exercise library, your whole history — all of it is on the device. Aeroplane
mode, a basement gym, no signal: it does not matter.

### Updates

When a new version is available, REPLOG downloads it in the background and then
**waits**. It never reloads itself underneath you, and it specifically will not
interrupt a workout in progress — the notice says "Held until your session is
finished."

You get a small **Update available** notice explaining that the new version will
be used next time you reload, and that your training history is unaffected
either way. **Reload** when it suits you.

If the browser's copy of the app itself is ever damaged, you get a banner whose
first sentence is the one that matters: **your training history is untouched** —
it is stored separately from the app. Only REPLOG's own files need downloading
again, and the banner has a button to do it.

---

## Arabic, right-to-left and numerals

Switching to العربية changes everything at once, with no reload: the interface
language, the text direction, the layout mirroring, the date formats and the
plural rules — Arabic's full six-category set, not an English two-form
approximation.

**Numerals are a separate choice.** You can read Arabic with Western digits
(1234) or Arabic-Indic ones (١٢٣٤), in either language. Set it in
**Settings → Units**.

One thing deliberately does not mirror: **time still runs left to right in the
charts.** Everything around a chart mirrors, but a timeline that ran backwards
would read worse, not better.

---

## Accessibility

- Every screen works with a screen reader, in both languages.
- Everything is reachable by keyboard, and a **Skip to main content** control is
  the first thing in the tab order.
- Dialogs keep the keyboard inside them until you answer.
- Text colours meet WCAG AA contrast against every surface they are drawn on, in
  both themes.
- The layout survives 200 % text scaling without anything being cut off.
- **Colour is never the only signal.** Completed sets add a tick and a filled
  row; records add a badge with words; estimates are marked in writing.
- **Reduce motion** honours your device's setting, and can be forced on or off in
  Settings.

---

## What REPLOG does not do

Stated here so you can decide with your eyes open. The About screen says the same
thing inside the app.

- **No sync, no cloud, no account.** One device, one copy, plus whatever backups
  you keep.
- **No notifications, ever.** No permission is requested, and none can be. A rest
  timer cannot alert you with the app in the background or the screen locked.
- **No HealthKit, Apple Watch or health-data integration.**
- **No sharing, no social, no leaderboards.**
- **No analytics or trackers.** Nothing about your use of the app is recorded
  anywhere but the app.
- **No app lock.** The photo blur is a privacy screen, not a password.
- **No cardio, nutrition or sleep tracking.** This is a strength log.
- **It cannot recover your data for you.** Nobody can. That is what backups are
  for.

---

## Troubleshooting

**I cleared my browser data and everything is gone.**
Import your most recent backup: **Settings → Data & backup → Choose a file**.
Without a backup there is no copy anywhere — not with us either.

**My workout disappeared mid-session.**
It almost certainly did not. Open the app again and look for **"Resume your
workout?"** — confirmed sets are written to disk as you make them. If you chose
"Discard" by accident, check **Recently deleted**.

**The rest timer did not go off.**
Expected, if the app was in the background or the screen was locked. No web app
on iOS can sound an alert from there. The countdown itself stays accurate — it is
derived from the clock, not from a timer that has to keep running.

**The numbers all changed when I switched to pounds.**
The labels changed; the records did not. Everything is stored in metric and
converted for display. Switch back and you will see the original figures exactly.

**My chart has a gap in it.**
That is a period with no readings. REPLOG does not join a line across data you
do not have. Log a measurement and the gap fills in.

**An exercise is missing from the library.**
Add it: **Settings → Exercise library → New exercise**. It then behaves exactly
like a built-in, records and charts included.

**It says storage is nearly full.**
Photos are the bulk of it. Delete the ones you do not need from
**Progress → Photos**, or export a backup with photos included and then delete
them from the app.

**I want my data somewhere else.**
Export a backup. It is readable JSON — nothing is locked up in a format only this
app understands. **Export a spreadsheet** gives you CSV for one table at a time.

**I am on a new phone.**
Export a backup on the old one, open REPLOG on the new one, and import it with
**Replace everything** (or **Merge**, if the new one already has sessions on it).

---

## Quick reference

| I want to… | Go to |
|---|---|
| Start training right now | **Train → Quick workout** |
| Train today's planned session | **Train → Today** |
| Build a program | **Plans → New plan** |
| Add an exercise the app lacks | **Settings → Exercise library → New exercise** |
| Fix a mistake in a past session | **Home → Workout history →** the session **→ Correct a mistake** |
| See every session of one lift | **Home → Workout history →** a session **→ See every session of this exercise** |
| Check my records | **Progress → Records** |
| Weigh in | **Progress → Body → Log a measurement** |
| Add a progress photo | **Progress → Photos → Add a photo** |
| **Back up my training** | **Settings → Data & backup → Export** |
| Restore from a backup | **Settings → Data & backup → Choose a file** |
| Get something deleted back | **Settings → Data & backup → Recently deleted** |
| Switch language or units | **Settings** |
| Install it like an app | Safari **Share → Add to Home Screen** |

---

*One device, one copy, no cloud. Export a backup.*
