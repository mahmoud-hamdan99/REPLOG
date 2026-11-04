# REPLOG — UI / UX Specification

**Version:** 1.0
**Primary target:** iPhone 13 → 17 Pro Max, Safari standalone PWA, portrait
**Breakpoints:** 320 · 390 · 430 · 744 · 1024 px
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE_SPEC.md](DATABASE_SPEC.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

---

## 1. Design Principles

1. **The gym is the hard case.** Sweaty thumbs, one hand, a phone held at hip height, 60 seconds of rest. Every decision in the Active Tracker optimises for *taps to log a set*, not for visual density.
2. **Numbers are the interface.** Weights, reps and deltas get the largest type on screen. Labels shrink; data does not.
3. **Premium through restraint.** One accent colour, one type family per script, generous negative space, no gradients-as-decoration, no glassmorphism, no card inside a card inside a card.
4. **State is always legible.** Planned vs. logged, actual vs. estimated, complete vs. pending — each has a distinct visual treatment, never just a colour.
5. **No destructive surprise.** Every irreversible tap is confirmed; every reversible one offers undo.
6. **Honest empties.** A screen with no data says what to do next. It never shows a fake chart or a zero dressed up as progress.
7. **Motion explains, never performs.** Transitions show where things came from. Anything decorative is dropped under `prefers-reduced-motion`.

---

## 2. Information Architecture

```
Bottom tab bar (5 destinations, always visible except in the Active Tracker)

  Home            Plans           ●Train●          Progress          More
    │               │                │                │               │
 Dashboard      Plan list      Start screen      Strength        Settings
 Recent PRs     Plan detail    ─ today's routine  Volume          Profile
 Activity       Routine editor ─ pick routine     Body            Appearance
 → History      Weekday grid   ─ quick start      Photos          Units
                               → ACTIVE TRACKER   Records         Workout prefs
                               → Summary          → Exercise      Data & backup
                                                    detail        Exercise library
                                                                  About / Diagnostics
```

* **Train** is the centre tab, visually elevated (filled lime circle, 1.15× size). It is the only tab that changes label and icon by state: *Train* → *Resume* (with a live timer pill) when a session is active.
* The **Active Tracker** replaces the tab bar with its own action bar. It is deliberately modal: navigating away requires an explicit choice (ARCHITECTURE §7.4).
* **History** lives under Home ("Recent activity → See all") and is also linked from More. It is not a tab: users reach for it after a session, not continuously.
* **Body measurements** and **Photos** are tabs inside Progress rather than top-level, because they are weekly actions, not daily ones.
* Back behaviour: in-page back button in the header for depth-1+ routes; the browser/system back gesture maps to router back; the tab bar never nests history.

---

## 3. Design Tokens

All tokens are CSS custom properties on `:root`, redefined per theme. Components reference tokens only — no literal colours, sizes, or durations in component CSS.

### 3.1 Colour

**Dark theme (default)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B0C0E` | App background |
| `--surface-1` | `#14161A` | Cards, sheets |
| `--surface-2` | `#1C1F24` | Nested rows, input fields |
| `--surface-3` | `#262A31` | Pressed states, chips |
| `--border` | `#2E333B` | Hairlines, card edges |
| `--border-strong` | `#3C424C` | Focus outlines, dividers under headers |
| `--text-1` | `#F4F6F8` | Primary text, numbers |
| `--text-2` | `#A3ABB6` | Labels, secondary |
| `--text-3` | `#6F7883` | Captions, disabled |
| `--accent` | `#C8FA4B` | Primary accent (lime) |
| `--accent-dim` | `#9BC92F` | Accent hover/pressed |
| `--accent-soft` | `#C8FA4B1F` | 12 % accent wash |
| `--on-accent` | `#0B0C0E` | Text/icons on accent fills |
| `--positive` | `#4ADE80` | Gains, PR, completed |
| `--warning` | `#FBBF24` | Quota, stale data |
| `--danger` | `#F87171` | Destructive, losses |
| `--info` | `#7DB8FF` | Neutral info, estimates |

**Light theme**

| Token | Value |
|---|---|
| `--bg` | `#F6F7F8` |
| `--surface-1` | `#FFFFFF` |
| `--surface-2` | `#F0F2F4` |
| `--surface-3` | `#E6E9EC` |
| `--border` | `#E1E5E9` |
| `--border-strong` | `#C9CFD6` |
| `--text-1` | `#111417` |
| `--text-2` | `#555E69` |
| `--text-3` | `#808A96` |
| `--accent` | `#C8FA4B` *(fills only)* |
| `--accent-ink` | `#4A6B07` | **accent-coloured text/icons in light theme** |
| `--accent-dim` | `#B2E532` |
| `--accent-soft` | `#C8FA4B33` |
| `--on-accent` | `#121417` |
| `--positive` | `#15803D` |
| `--warning` | `#B45309` |
| `--danger` | `#DC2626` |
| `--info` | `#1D6FD0` |

### 3.2 Contrast rules (non-negotiable)

| Pair | Ratio | Verdict |
|---|---|---|
| `--text-1` on `--bg` (dark) | 18.06 : 1 | ✅ |
| `--text-2` on `--surface-1` (dark) | 7.81 : 1 | ✅ |
| `--text-3` on `--surface-1` (dark) | 4.05 : 1 | ⚠️ captions only, ≥ 14 px, never essential |
| `--accent` on `--bg` (dark) | 16.06 : 1 | ✅ |
| `--on-accent` on `--accent` | 16.06 : 1 dark / 15.14 : 1 light | ✅ |
| **`--accent` as text on light `--surface-1`** | 1.22 : 1 | ❌ **forbidden** — use `--accent-ink` |
| `--text-1` on `--surface-1` (light) | 18.48 : 1 | ✅ |
| `--positive`/`--danger` on their theme surface | ≥ 4.5 : 1 | ✅ (values above are tuned per theme) |

Hard rule: **lime is a fill colour in light theme and a text colour only in dark theme.** The ratios above are not hand-computed: `scripts/check-contrast.mjs` parses `_tokens.css` and `_themes.css`, resolves `var()` aliases and fails the build on any pair below its minimum. It also asserts that the forbidden pair *stays* illegible, so it cannot be "fixed" by darkening lime.

Second hard rule: **colour is never the only signal.** Completed sets add a check glyph and a filled row; PRs add a badge with text; losses add a downward arrow; estimates add a dotted underline. Verified by a greyscale review pass.

### 3.3 Typography

| Token | Latin | Arabic | Notes |
|---|---|---|---|
| `--font-ui` | `Inter var` | `IBM Plex Sans Arabic` | Self-hosted WOFF2 subsets (Latin + Latin-ext; Arabic + Arabic-ext) |
| `--font-num` | `Inter var`, `tabular-nums`, `-1.5%` tracking | same | All weights, reps, timers, stats |

Arabic rendering: `IBM Plex Sans Arabic` is set at **+6 % size and +0.12 em line-height** relative to Latin at the same token, because its x-height and ascenders read smaller; applied via `:root[lang='ar']` overrides on the scale tokens rather than per-component.

| Token | Size / line-height / weight / tracking | Use |
|---|---|---|
| `--t-stat-xl` | 48 / 1.0 / 650 / −2.5 % | The one hero number per screen (dashboard weight, active timer) |
| `--t-stat` | 32 / 1.05 / 650 / −2 % | Stat cards, set weight |
| `--t-stat-sm` | 22 / 1.1 / 600 / −1 % | Inline numbers in rows |
| `--t-h1` | 26 / 1.2 / 650 / −1.5 % | Page titles |
| `--t-h2` | 20 / 1.25 / 600 / −1 % | Section headers |
| `--t-h3` | 17 / 1.3 / 600 / −0.5 % | Card titles, exercise names |
| `--t-body` | 15 / 1.45 / 450 / 0 | Body copy, inputs |
| `--t-body-strong` | 15 / 1.45 / 600 / 0 | Emphasis in body |
| `--t-label` | 13 / 1.35 / 550 / +1 % | Field labels, chips |
| `--t-caption` | 12 / 1.35 / 450 / +1.5 % | Metadata, timestamps |
| `--t-micro` | 11 / 1.3 / 600 / +4 %, uppercase | Eyebrow labels, axis ticks (Latin only — never uppercase Arabic) |

Rules: max two type sizes per card; never uppercase Arabic text (`text-transform: none` under `[lang='ar']`); never centre body copy longer than two lines; numbers always `font-variant-numeric: tabular-nums` so values do not jitter during a live timer.

### 3.4 Space, radius, elevation

```
--sp-1:4  --sp-2:8  --sp-3:12  --sp-4:16  --sp-5:20
--sp-6:24 --sp-8:32 --sp-10:40 --sp-12:48 --sp-16:64

--r-sm:8  --r-md:12  --r-lg:16  --r-xl:20  --r-2xl:28  --r-full:999px

--elev-0: none
--elev-1: 0 1px 2px rgb(0 0 0 / .18)                      /* light: real shadow     */
--elev-2: 0 4px 16px rgb(0 0 0 / .14)                      /* light: sheets, menus  */
--elev-3: 0 12px 32px rgb(0 0 0 / .20)                     /* light: modals         */
```

In **dark theme** elevation is expressed by **surface step + hairline**, not shadow (`--surface-1` → `--surface-2` → `--surface-3` with `--border`); a shadow on a near-black background reads as mud. Only the bottom nav and active sheets get a dark-theme shadow, used purely to separate them from scrolling content.

Layout: screen gutter `--sp-4` (16 px) at 320–430 px, `--sp-6` at ≥ 744 px with a max content width of 720 px centred. Card padding `--sp-4`; card gap `--sp-3`; section gap `--sp-6`.

### 3.5 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--dur-micro` | 120 ms | `cubic-bezier(.2,0,0,1)` | Press, checkbox, chip |
| `--dur-fast` | 180 ms | `cubic-bezier(.2,0,0,1)` | Row expand, fade, toast |
| `--dur-sheet` | 260 ms | `cubic-bezier(.05,.7,.1,1)` | Bottom sheets, page push |
| `--dur-slow` | 420 ms | `cubic-bezier(.3,0,.2,1)` | PR celebration, chart draw-in |

Rules: transform/opacity only (no layout-animating properties); page transitions slide along the inline axis so they mirror automatically in RTL; the chart draw-in runs once per mount, never on data refresh; `@media (prefers-reduced-motion: reduce)` collapses every duration to 0.01 ms and replaces slides with cross-fades, keeping the rest-timer ring as a static arc with numeric text.

### 3.6 iOS safe areas

```css
:root {
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  --nav-h: 56px;
  --header-h: 52px;
}
```

* `index.html` requires `viewport-fit=cover`; without it the insets are all `0px`.
* `interactive-widget=resizes-content` is **Chromium-only**. Safari does not recognise the key and logs a console error for it, so the pre-paint script appends it only when `'virtualKeyboard' in navigator`. Safari resizes the visual viewport instead, which the numeric pad handles with a `visualViewport` listener.
* Sticky header: `padding-top: calc(var(--safe-t) + var(--sp-2))`, `height: calc(var(--header-h) + var(--safe-t))`.
* Bottom nav: `height: calc(var(--nav-h) + var(--safe-b))` with `padding-bottom: var(--safe-b)` — the home indicator must never overlap a tap target.
* Scroll containers: `padding-bottom: calc(var(--nav-h) + var(--safe-b) + var(--sp-4))` so the last card clears the nav.
* The Active Tracker's action bar uses the same inset maths and sits above the keyboard via `interactive-widget=resizes-content` plus a `visualViewport` resize listener for the numeric pad.
* `100vh` is banned (it is wrong in Safari); use `100dvh` with a `100vh` fallback.
* Overscroll: `overscroll-behavior-y: contain` on scroll containers to stop the standalone-mode body bounce; `-webkit-overflow-scrolling: touch` for momentum; `touch-action: manipulation` globally to kill the 300 ms double-tap-zoom delay.

### 3.7 Touch targets

Minimum **44 × 44 pt** for any target (Apple HIG and spec §5). Gym-critical controls are larger: set-complete button **56 × 56**, numeric pad keys **64 × 56**, weight/rep steppers **48 × 48**. Minimum 8 px between adjacent targets. Primary actions sit in the bottom 40 % of the screen for one-handed reach; destructive actions never sit adjacent to a frequent action.

---

## 4. Shell

```
┌──────────────────────────────┐  ← safe-area top
│  Monday, 2 March        [⚙]  │  header: contextual title + 1 action, 52pt
├──────────────────────────────┤
│                              │
│         scroll area          │  single scroll container per page
│                              │
│                              │
├──────────────────────────────┤
│  ⌂      ▤     ( ▶ )    ◴   ⋯ │  bottom nav, 56pt + safe-area-bottom
└──────────────────────────────┘  ← home indicator space
```

Header: left = title or back + title, right = at most one icon action (overflow goes to a sheet). Title truncates to one line with an ellipsis; it never wraps. The header gets a hairline bottom border and a `--surface-1` background only once the content has scrolled past 8 px (observed via `IntersectionObserver`, not a scroll listener).

Bottom nav: icon (24 px) + label (`--t-micro`), active state = `--accent` icon + label in dark theme / `--accent-ink` in light, plus a 3 px top indicator bar. The Train tab is a 52 px lime circle lifted 10 px above the bar. When a workout is live, it becomes a lime pill showing `●  12:48`.

---

## 5. Screens

### 5.1 Dashboard (`/`)

```
┌────────────────────────────────────┐
│ Good evening, Omar            [⚙] │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ BODY WEIGHT                    │ │   hero card
│ │ 82.4 kg        ↓ 0.6 kg ▾      │ │   --t-stat-xl, delta vs 7d
│ │ ▁▂▃▃▄▄▅▆▅▅▆  last 30 days      │ │   sparkline, gaps preserved
│ │ Updated 2 days ago             │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌──────────────┐ ┌──────────────┐ │
│ │ THIS WEEK    │ │ CONSISTENCY  │ │   2-up stat tiles
│ │ 3 / 4        │ │ 86 %         │ │
│ │ workouts     │ │ last 8 weeks │ │
│ └──────────────┘ └──────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ UP NEXT · TODAY                │ │   next scheduled workout
│ │ Push A                         │ │
│ │ 6 exercises · ~52 min          │ │
│ │ ┌────────────────────────────┐ │ │
│ │ │      Start workout         │ │ │   full-width lime button
│ │ └────────────────────────────┘ │ │
│ └────────────────────────────────┘ │
│                                    │
│ RECENT RECORDS              See all│
│ ┌────────────────────────────────┐ │
│ │ 🏆 Bench Press   100 kg × 5    │ │
│ │    Max weight · +2.5 kg · 3d   │ │
│ ├────────────────────────────────┤ │
│ │ 🏆 Barbell Row   e1RM 118 kg ⌁ │ │   ⌁ = estimate marker
│ └────────────────────────────────┘ │
│                                    │
│ MEASUREMENTS                 Update│
│ ┌────────────────────────────────┐ │
│ │ Chest 104.0  Waist 83.5  ↓0.5  │ │
│ │ Arm L 36.8   Arm R 37.1        │ │
│ │ Recorded 5 days ago            │ │
│ └────────────────────────────────┘ │
│                                    │
│ RECENT ACTIVITY             See all│
│ ┌────────────────────────────────┐ │
│ │ Push A      Sat · 54 min       │ │
│ │ 18 sets · 6 420 kg · 🏆1       │ │
│ ├────────────────────────────────┤ │
│ │ Pull A      Thu · 61 min       │ │
│ └────────────────────────────────┘ │
│                                    │
│ ⚠ Last backup 21 days ago  Export │   conditional, dismissible
└────────────────────────────────────┘
```

Rules:
* Every figure traces to stored records (spec §4.1). A tile with no data shows a dash and a one-line prompt, never `0`.
* `3 / 4` reads as *completed this week / planned by the active plan*. With no active plan it shows `3 workouts`.
* Consistency = completed ÷ planned over the last 8 full weeks, with the window named in the tile. Fewer than 2 full weeks of history → "Not enough history yet".
* The delta chip's sign is explained by an arrow *and* a label, never colour alone; direction is not moralised (losing weight is not inherently "good").
* "Up next" shows today's scheduled routine, else the next within 7 days, else the most recent flexible routine, else "Quick workout".
* Greeting uses the device clock and is purely cosmetic; it is omitted when no profile name exists.

### 5.2 Train — start screen (`/train`)

```
┌────────────────────────────────────┐
│ Train                              │
│ ┌────────────────────────────────┐ │
│ │ ● Workout in progress  18:24   │ │  ← only when a session exists
│ │ Push A · 7 sets logged         │ │
│ │ [ Resume ]      [ Finish ]     │ │
│ └────────────────────────────────┘ │
│                                    │
│ TODAY · MONDAY                     │
│ ┌────────────────────────────────┐ │
│ │ Push A                     →   │ │
│ │ Bench · Incline DB · Dips …    │ │
│ │ 6 exercises · last done 7d ago │ │
│ └────────────────────────────────┘ │
│                                    │
│ OTHER ROUTINES                     │
│ ┌────────────────────────────────┐ │
│ │ Pull A        Tue, Fri     →   │ │
│ │ Legs A        Wed, Sat     →   │ │
│ │ Arms (flexible)            →   │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │  + Quick workout               │ │  unscheduled, empty session
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │  ↻ Repeat last workout         │ │  clones structure, not loads
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Tapping a routine opens a **pre-flight sheet**: exercise list with planned sets × reps, the suggested starting loads (marked as suggestions), an option to skip exercises for today, and a single `Start` button. One extra tap that prevents the most common error — starting the wrong routine.

### 5.3 Active Tracker (`/train/active`) — the core screen

```
┌────────────────────────────────────┐
│ ⏸  Push A            18:24    ⋯   │  sticky header: pause, name, live timer, menu
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  Ex 2/6       │  progress bar (sets completed / planned)
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ 1 · Bench Press            ✓   │ │  collapsed, done: name + summary
│ │ 3 sets · 100×5, 100×5, 95×6    │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌════════════════════════════════┐ │  ACTIVE CARD (expanded, --surface-2,
│ ║ 2 · Incline DB Press           ║ │  accent left edge 3px)
│ ║ Target 4 × 8–10 · rest 90s  ⋯  ║ │
│ ║ ┌────────────────────────────┐ ║ │
│ ║ │ Last time · 12 Feb         │ ║ │  previous performance block
│ ║ │ 30×10  30×9  30×8  27.5×8  │ ║ │  (spec §4.4, §4.5)
│ ║ └────────────────────────────┘ ║ │
│ ║                                ║ │
│ ║  SET   PREV      KG     REPS   ║ │  column header, --t-micro
│ ║ ┌────────────────────────────┐ ║ │
│ ║ │  W   ·      │ 20  │  12 │ ✓ │ ║ │  warm-up row (muted, W badge)
│ ║ ├────────────────────────────┤ ║ │
│ ║ │  1   30×10  │ 30  │  10 │ ✓ │ ║ │  completed: filled, check solid
│ ║ ├────────────────────────────┤ ║ │
│ ║ │  2   30×9   │ 30  │  9  │ ✓ │ ║ │
│ ║ ├────────────────────────────┤ ║ │
│ ║ │  3   30×8   │ 32.5│  8  │ ○ │ ║ │  ← current row, accent outline
│ ║ ├────────────────────────────┤ ║ │
│ ║ │  4   27.5×8 │ ·   │  ·  │ ○ │ ║ │  pending: ghost prev as hint
│ ║ └────────────────────────────┘ ║ │
│ ║  + Set      + Warm-up          ║ │
│ ║  ✎ Note                        ║ │
│ └════════════════════════════════┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ 3 · Cable Fly              ○   │ │  upcoming, collapsed
│ │ 3 × 12–15                      │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ⇄ 4 · Lateral Raise        ○   │ │  superset marker
│ │ ⇄ 5 · Rear Delt Row        ○   │ │  grouped, shared bracket
│ └────────────────────────────────┘ │
│                                    │
│  + Add exercise                    │
├────────────────────────────────────┤
│ ┌──────────────┐ ┌───────────────┐ │  action bar, above safe area
│ │  Rest 1:30   │ │    Finish     │ │
│ └──────────────┘ └───────────────┘ │
└────────────────────────────────────┘
```

**Interaction contract**

| Action | Gesture | Result |
|---|---|---|
| Edit weight / reps | Tap the field | Opens the numeric pad sheet (§6.4) focused on that field |
| Confirm a set | Tap `✓` | Row commits (persisted before the visual state changes), rest timer auto-starts if enabled, next row becomes current, PR check runs |
| Un-confirm | Tap a solid `✓` | Reverts to pending; keeps values; logged in the same transaction |
| Add a set | `+ Set` | Appends a row prefilled with the previous set's load, uncommitted |
| Add a warm-up | `+ Warm-up` | Inserts a `W` row above set 1 at ~50 % of the first working load (clearly a suggestion) |
| Delete a set | Swipe the row toward the inline start | Soft-deletes directly, with a 7 s undo toast; the set-index badge opens a sheet with the same Delete, which is the accessible path. One gesture rather than swipe-to-reveal-then-tap, because the undo already makes it safe |
| Reorder exercises | Long-press the card header + drag, or `⋯ → Move` | Persists immediately; accessible alternative always provided via the menu |
| Skip an exercise | `⋯ → Skip for today` | Marks `isSkipped`, collapses, stays visible |
| Swap an exercise | `⋯ → Replace` | Opens the library filtered to the same muscle group; history is attributed to the exercise actually performed |
| Supersets | `⋯ → Group with next` | Shares a bracket and alternates the current-row focus between grouped exercises |
| RPE / RIR | Visible only in advanced mode, as a chip row inside the expanded set | Optional; blank is a valid value |
| Collapse / expand | Tap a collapsed card header | One card expanded at a time; expanding scrolls it to just under the header |
| Pause | `⏸` in the header | Freezes the timer, dims the screen chrome, shows a full-width Resume button |
| Finish | `Finish` | Summary sheet: duration, volume, sets, PRs, any empty sets to be dropped (counted, not hidden) → Confirm |

**Simple vs advanced mode** (spec §4.4): *Simple* shows Set / Previous / KG / Reps / ✓ only. *Advanced* adds RPE, RIR, set-type selection, per-set notes, and measured rest. The toggle lives in Settings and in the tracker's `⋯` menu; it changes only the visible controls, never the data model, and can be switched mid-session.

**Current-row discipline:** exactly one row is "current", marked by an accent outline *and* the only auto-focus target. After a commit, focus advances to the next pending row of the current exercise, or to the first row of the next exercise, or — in a superset — to the partner exercise's next row.

### 5.4 Rest timer

Presented as a **bottom sheet** (half-height, dismissible by drag) so the set grid stays visible behind it.

```
┌────────────────────────────────────┐
│                ╭─╮                 │
│            ╭───┘ └───╮             │   progress ring, accent stroke,
│           │   1:12    │            │   depletes clockwise (LTR) /
│           │  remaining │           │   counter-clockwise (RTL)
│            ╰───┬───╯               │   --t-stat-xl, tabular
│                ╰─╯                 │
│      Next: Incline DB · Set 4      │
│   ┌──────┐ ┌──────┐ ┌──────┐      │
│   │ −15s │ │ +15s │ │ Skip │      │
│   └──────┘ └──────┘ └──────┘      │
│         Keep screen awake  [ on ]  │
└────────────────────────────────────┘
```

* Derived from `startedAt + targetSec` (ARCHITECTURE §7.3), so backgrounding and screen lock never desynchronise it.
* At 0: the ring flashes to `--positive`, an optional short tone plays, the sheet auto-dismisses after 2 s, and an `aria-live="assertive"` region announces "Rest complete".
* The sheet opens with the rest, including one a confirmed set starts automatically, and dismisses itself two seconds after the rest completes. It can be dismissed early while the timer keeps running; a compact pill then appears in the action bar (`Rest 0:48`) and reopens it.
* The completion tone is synthesised with Web Audio rather than shipped as an asset, and is best-effort: iOS only allows audio after a user gesture, which the confirmed set provides, and failure is silent.
* **Stated limitation** (spec §9): no alert fires while the app is backgrounded or the screen is locked. The sheet says so once, next to the Keep-screen-awake toggle, and the toggle is hidden entirely where Wake Lock is unavailable rather than offered as a lie.

### 5.5 Workout summary (`/train/summary/:id`)

Celebration without fiction: duration, total volume with its unit, sets, reps, per-exercise rollup, and a PR list where each entry states type, value, and the previous best. Estimated 1RM PRs carry the `⌁` marker and the formula name. If sets were dropped for being empty, the count is shown. Actions: `Add a note`, `Done`, `Share as text` (clipboard copy — no network).

A first-ever record reads **"First record"**, not "New PR" (DATABASE_SPEC §3.13).

### 5.6 Planner (`/plans`, `/plans/:id`, routine editor)

Plan list: cards with name, routine count, weekday coverage dots, last-used date, and a `⋯` menu (Edit, Duplicate, Set as active, Archive). Archived plans sit behind a filter chip.

Plan detail shows the **weekday strip** — the fastest way to see a week:

```
 S   M   T   W   T   F   S
 ·  [P] [L]  ·  [P] [L]  ·      P = Push A, L = Legs A (chips, tappable)
```

Routine editor:

```
┌────────────────────────────────────┐
│ ← Push A                    Save   │
│ Name  [ Push A              ]      │
│ Schedule  ( Scheduled | Flexible ) │
│ Days   S [M] T W [T] F S           │
├────────────────────────────────────┤
│ EXERCISES (6)                      │
│ ┌────────────────────────────────┐ │
│ │ ⠿ Bench Press              ⋯   │ │  ⠿ = drag handle
│ │   4 × 6–8 · 120s               │ │
│ ├────────────────────────────────┤ │
│ │ ⇄ Incline DB Press         ⋯   │ │  superset bracket spans rows
│ │ ⇄ Cable Fly                ⋯   │ │
│ └────────────────────────────────┘ │
│  + Add exercise                    │
├────────────────────────────────────┤
│ Estimated 52 min · 18 sets         │
└────────────────────────────────────┘
```

Tapping an exercise opens a configuration sheet: target sets (stepper), rep range (dual stepper min/max with a "fixed" toggle), optional target weight, rest (chips 60/90/120/180 + custom), planned warm-ups, tracking mode override, notes. Unsaved changes prompt on back. Editing a routine bumps its `revision`; a note in the editor states plainly that past workouts are unaffected (spec §4.6).

### 5.7 Exercise library (`/exercises`)

```
┌────────────────────────────────────┐
│ Exercises                     + │  │
│ ┌────────────────────────────────┐ │
│ │ 🔍 Search exercises            │ │
│ └────────────────────────────────┘ │
│ (All)(Chest)(Back)(Shoulders)(Bi…  │  horizontally scrolling chips
│ [ Equipment ▾ ][ Type ▾ ][ Mine ]  │  filter sheets
├────────────────────────────────────┤
│ ★ FAVOURITES                       │
│ ┌────────────────────────────────┐ │
│ │ ⬤ Bench Press              ★   │ │  ⬤ = illustration or muscle glyph
│ │   Chest · Barbell · Compound   │ │
│ └────────────────────────────────┘ │
│ C                                  │  alphabetical section index
│ ┌────────────────────────────────┐ │
│ │ ⬤ Cable Fly                ☆   │ │
│ │   Chest · Cable · Isolation    │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

* Search matches the normalised English name, Arabic name, and aliases, in that priority (DATABASE_SPEC §3.3). Arabic search is diacritic- and alef-form-insensitive.
* Active filters render as removable chips above the list with a "Clear all"; the result count is always visible.
* Long lists use a virtualised scroller; the alphabetical index rail appears at ≥ 40 results.
* Exercise detail: hero illustration (or a muscle-map glyph when none), EN/AR names, primary/secondary muscles as tappable chips, equipment, classification, numbered instructions, cues, your PRs for this variant, your progression chart, and "last performed".
* Custom exercise form: name (EN required, AR optional with a "not translated" hint), muscles (multi-select), equipment, type, movement pattern, mechanics, laterality, load type, weight increment, default rest, optional photo, instructions. Built-in exercises are editable; a banner explains that edits are kept when the catalog updates (DATABASE_SPEC §6.2) and offers "Reset to original".

### 5.8 History (`/history`, `/history/:id`)

Grouped by month with a sticky month header. Each row: routine name as recorded, weekday + date, duration, set count, volume, and badges for records and for an after-the-fact correction. Filters: date range, routine, exercise — the exercise filter is driven from `workoutExercises.by_exerciseId_startedAt` rather than by reading workouts and asking what was in them. Paging is a **Load more** button, not an infinite scroll: a list you can reach the end of is one you can trust, and an infinite one fights scroll restoration on the way back from a detail. Row tap → detail.

Detail is strictly read-only and renders **from the snapshot**: plan/routine name as recorded (with "this routine has since changed" or "no longer exists" notes where applicable), the exercise list with every logged set including warm-ups and RPE/RIR, session notes, body weight at the time, and rollups. Actions: `Repeat this workout` (creates a new session with the same structure, no loads prefilled as committed), `Edit` (corrections, with an edit marker on the record), `Delete` (confirm + soft delete).

### 5.9 Progress (`/progress`)

Tabs: **Strength · Volume · Body · Photos · Records**. A shared time-range selector (7d · 30d · 3m · 6m · 1y · All) sits under the tabs and persists per tab.

Phase 7 ships **Records** on this route on its own, without the tabs; Phase 10 builds the hub around it. The screen leads with the most recently earned records that still stand — derived from the current set rather than queried by date, so a superseded achievement never appears beside the one that beat it.

* **Strength** — exercise picker (recently trained first) → line chart of best set e1RM and top-set weight over time, with a second series toggle. Below: best-set table per session, and a "data points: 14" footnote so a sparse chart is never mistaken for a dense one.
* **Volume** — bar chart per week/month (bucket follows the range), stacked by muscle group, with a total line. A footnote states that warm-up sets and time/distance work are excluded.
* **Body** — weight line chart with a 7-day moving average (labelled as a calculated average), plus per-measurement charts behind a selector; measurement list with edit/delete.
* **Photos** — see §5.11.
* **Records** — grouped by exercise, each record showing type, value, date, and previous best; estimates marked. Tapping opens the exact set in history. A banner explains that records are compared within the same equipment variant (spec §4.10).

Every chart renders a gap for missing data and an explicit "Not enough data to show a trend" state at fewer than 3 points. No trend lines are drawn for fewer than 5 points.

### 5.10 Body measurements (`/body`)

List grouped by date, newest first, each entry showing only the fields actually recorded. The entry form is a single scrolling sheet with the weight field first and focused, then a collapsible "More measurements" section in body order (neck → shoulders → chest → waist → hips → arms → forearms → thighs → calves → body fat → custom). Each field shows its last value as ghost text and the delta once a value is entered. Left/right pairs sit on one row. All fields optional; `Save` is enabled as soon as any field has a value.

Each entry is listed under the day it **measures**, not the moment it was typed: backfilling last Tuesday's weigh-in dates it to last Tuesday. The ghost value is a placeholder, never a prefill — a prefilled field makes last week's measurement look like today's until somebody notices — and the delta appears only once a value is entered *and* there is something to compare against.

Saving runs two questions and no edits. A value outside its plausible band is questioned by name ("That is unusual for Body weight. Is 650 kg right?") and then saved as typed. A second entry on a day that already has one offers to merge rather than stacking silently; the entry the user kept wins every field it has, and the other only fills gaps. Deleting is a soft delete behind an undo toast.

**Compare** picks two entries and lists every field either one mentions, with a delta only where both have a value and a line naming the missing side where they do not — a gap stays a gap. The arrow between the two values is a translated string, because U+2192 is not bidi-mirrored and would otherwise point from the later value back at the earlier one in Arabic.

Custom measurements are defined in their own sheet with a name and a unit type, and are **archived, never deleted**: archiving removes a definition from new entries while leaving the values recorded against it readable and named.

### 5.11 Progress photos

Gallery: date-grouped grid of 3 columns (thumbnails only), pose filter chips, a selection mode for compare/delete. Compare view: two photos side by side (stacked on narrow screens) with a draggable divider option, each captioned with date, pose, weight at the time, and the computed interval ("14 weeks apart").

Capture/import: `<input type="file" accept="image/*">` — note that iOS offers Camera / Photo Library / Files natively, so no custom picker is needed. Then pose selection, date (EXIF-prefilled), optional note. The processing pipeline and metadata stripping are in DATABASE_SPEC §3.12; the UI states that photos stay on the device and that **location data is removed**.

Privacy affordances: photos are never shown on the dashboard; the gallery is behind the Progress tab; a Settings option hides thumbnails behind a tap-to-reveal blur. There is no lock screen, and the app does not pretend to offer one — Settings states that anyone with the unlocked phone can open the app.

The blur is on the image, not the tile, so the line explaining why the photo is hidden stays legible. A blurred tile's accessible name is "Tap to reveal" rather than its pose and date — naming the photo to a screen reader would undo the blur for the one user who cannot see it anyway. The first tap reveals and does nothing else: a tap that both revealed and opened would throw a photo full-screen for someone who only wanted to check which one it was.

Deleting is the one irreversible action in the app, because the pixels go with the record. The dialog says "cannot be recovered" and there is no undo toast — the pattern every other delete uses would be a promise this one cannot keep.

### 5.12 Settings (`/settings`)

Grouped list rows with values on the trailing side:

* **Profile** — name, birth date, sex, height, goal, experience, avatar. All optional, stated as such.
* **Appearance** — theme (System / Light / Dark) as a 3-segment control with live preview; reduce motion.
* **Language** — English / العربية, applied instantly with the direction flip; no reload.
* **Units** — weight (kg/lb), length (cm/in), numerals (1234 / ١٢٣٤). A note explains that data is stored in metric and converted for display, so switching never alters history.
* **Workout** — default rest, auto-start rest timer, timer sound, keep screen awake (hidden if unsupported), tracking mode, e1RM formula, confirm before finishing, show previous performance, show suggestions.
* **Data & backup** — Export (with/without photos, projected size), per-table CSV export (export only, stated as such), Import (dry-run report → mode choice), Check data integrity, Storage usage meter, Recently deleted (30-day recovery), Reset application data.
* **Exercise library** — manage custom exercises, archived exercises, catalog version, re-seed.
* **About** — version, build, licence/credits, honest platform notes (§7), diagnostics log with copy-to-clipboard.

---

## 6. Component Inventory

### 6.1 Core

| Component | Variants | Notes |
|---|---|---|
| `rl-button` | primary (lime) · secondary (surface + border) · ghost · danger · icon | Sizes sm 36 / md 44 / lg 52; full-width option; built-in pressed scale 0.98; `aria-busy` spinner state |
| `rl-card` | plain · interactive · accent-edge | `--surface-1`, `--r-lg`, hairline border |
| `rl-stat-tile` | single · 2-up · with-sparkline | Eyebrow label + hero number + delta chip + footnote |
| `rl-delta-chip` | up · down · flat · none | Arrow + value + optional label; never colour-only |
| `rl-chip` | filter · choice · removable | 32 px tall, `--r-full` |
| `rl-sheet` | half · full | Built on the native `<dialog>` with `showModal()`, so the focus trap, Escape handling, background inerting and `::backdrop` come from the platform instead of hand-rolled ARIA. Entry uses a `@starting-style` transition. **That alone is not enough**: a transition advances on the document timeline, and a document that is not painting does not advance it, so an unrun transition holds its `@starting-style` value exactly as an unrun keyframe animation holds its first frame — for a slide-up, a full viewport below the fold. The component therefore checks rather than assumes: one sheet-duration after opening, any entry transition still at exactly zero has its timeline frozen and is finished outright. `dismissible="false"` blocks Escape for a sheet that exists to collect an answer, so a prompt something is waiting on cannot be closed without choosing. Drag-to-dismiss is still outstanding. |
| `rl-dialog` | confirm · destructive-confirm · typed-confirm | Native `<dialog>`, as above. Destructive variants require a distinct action label (never "OK"), state the consequence, and put the destructive action on the trailing side |
| `rl-toast` | info · success · undo · error | Bottom-anchored above the nav, max 2 stacked, 5 s (undo 7 s), swipe to dismiss |
| `rl-segmented` | 2–4 segments | Theme/mode pickers. Built on native radios in a `radiogroup`, so roles, arrow-key navigation and a single tab stop come from the platform. `showLabel` renders the group's name above it and switches the group from `aria-label` to `aria-labelledby`; it has to be set wherever two of these share a card, which is how the units screen first shipped with a "Weight unit" heading above a weight control **and** an unlabelled length control — named correctly for a screen reader and not at all for a sighted user |
| `rl-list-row` | value · nav · toggle · destructive | 52 px min height |
| `rl-empty-state` | icon + title + body + action | §11 |
| `rl-skeleton` | line · card · chart | Shimmer disabled under reduced motion |
| `rl-progress-ring` | sm · lg | Rest timer, consistency |
| `rl-tab-bar` | 5 slots + elevated centre | Shell nav |
| `rl-section-header` | title · title + action | `--t-micro` eyebrow style |
| `rl-badge` | pr · estimate · warmup · count | `⌁` estimate marker is a component, not an ad-hoc glyph |

### 6.2 Domain

| Component | Responsibility |
|---|---|
| `rl-set-row` | The single most-used control: set index/type badge, previous-performance text, weight field, reps field, optional RPE/RIR, complete button, swipe-to-delete. Columns are opt-out — history drops previous-performance and the complete button, because neither means anything once a session is in the past — and the grid is built from the columns that are actually rendered |
| `rl-exercise-card` | Collapsed/expanded states, superset bracket, menu, skip state |
| `rl-prev-performance` | "Last time · date" block with per-set values; renders a "no history yet" line rather than nothing |
| `rl-suggestion-hint` | Ghost-text suggestion with reason and `⌁`; tap to accept, never auto-applied. Dashed `--info` border, the same language every estimate uses, so it cannot be mistaken for a logged value. Accepting fills the current row as an **unconfirmed draft** — the set still has to be confirmed |
| `rl-rest-timer-sheet` / `rl-rest-pill` | Timestamp-driven countdown |
| `rl-exercise-picker` | Search + filters + multi-select, reused by planner, tracker, and replace flows |
| `rl-weekday-picker` | 7 toggles, locale-aware week start, RTL order |
| `rl-measurement-field` | Label + canonical-to-display conversion + delta + last value as ghost text. **The only place a measurement converts units** — values arrive and leave canonical, so a unit switch changes every number on screen and none on disk. Reads and writes the user's numeral system in both directions: an Arabic keyboard's `٨٢٫٥` parses, and the field renders `٨٢٫٥` back, with grouping off so a thousands separator cannot be read as a decimal mark |
| `rl-photo-thumb` | Object-URL lifecycle owned by the store, never the component: it is handed a URL and never makes one, so there is nothing for it to forget to revoke. A null URL is the ordinary loading state; a decode failure says so rather than leaving a gap that reads as a deleted photo, and the tile stays tappable so the detail sheet's Delete is one tap away. A dedicated Remove button on the broken tile is outstanding |
| `rl-progress-tabs` | Links between the three Progress screens — Records, Measurements, Photos. A stand-in until Phase 10's analytics hub; before it, those routes were reachable only by typing a URL |
| `rl-pr-row` | Type, value, previous best, date, estimate marker |
| `rl-workout-row` | History/activity list row |

### 6.3 Forms

| Component | Notes |
|---|---|
| `rl-numeric-pad` | **The key gym input** — see §6.4 |
| `rl-stepper` | `−` / value / `+`, 48 px targets, exercise-specific increments, long-press to repeat |
| `rl-unit-input` | Owns canonical↔display conversion and step grids; the only component allowed to convert units |
| `rl-rep-range` | Dual stepper with a fixed/range toggle |
| `rl-date-field` | Native `<input type="date">` (iOS wheel is good and free); max = tomorrow |
| `rl-rpe-scale` | 1–10 chips in 0.5 steps with descriptive labels on long-press |
| `rl-text-field` / `rl-textarea` | 16 px minimum font size — **anything smaller triggers iOS input zoom**; character counters where limits exist |

### 6.4 Numeric pad — rationale and spec

The native iOS keyboard is the wrong tool for logging a set: it covers half the screen, animates slowly, its decimal layout varies by locale, and `type="number"` brings spinners and validation quirks. REPLOG uses a custom pad instead.

```
┌────────────────────────────────────┐
│  Incline DB Press · Set 3          │
│  ┌──────────────┬──────────────┐   │
│  │  32.5 kg  ◂  │   8 reps     │   │  two fields, tap to switch,
│  └──────────────┴──────────────┘   │  active one underlined in accent
│  Last time: 30 kg × 8              │
│  ┌──────┐┌──────┐┌──────┐          │
│  │ −2.5 ││ +2.5 ││ +5   │          │  quick-adjust by the exercise's
│  └──────┘└──────┘└──────┘          │  weightIncrementKg
│  ┌─────┐┌─────┐┌─────┐┌─────────┐  │
│  │  1  ││  2  ││  3  ││    ⌫    │  │
│  ├─────┤├─────┤├─────┤├─────────┤  │
│  │  4  ││  5  ││  6  ││         │  │
│  ├─────┤├─────┤├─────┤│  Next   │  │
│  │  7  ││  8  ││  9  ││    ↳    │  │
│  ├─────┤├─────┤├─────┤├─────────┤  │
│  │  .  ││  0  ││  C  ││  ✓ Done │  │
│  └─────┘└─────┘└─────┘└─────────┘  │
└────────────────────────────────────┘
```

* Keys are 64 × 56 with 8 px gaps; `Done` commits the set and starts rest in one tap.
* `.` is disabled on the reps field and replaced by `00` (no fractional reps).
* Decimal separator follows the locale, but `.` and `,` are both accepted as input.
* Quick-adjust buttons derive from `exercises.weightIncrementKg` and respect the display unit (in lb mode they become −5 / +5 / +10).
* On desktop/tablet with a hardware keyboard, the pad is still used for layout but accepts real keystrokes: digits, `.`, `,`, `Backspace` and `Enter` = Done. `Tab` is left to the browser rather than remapped to field switching — the fields and every key are focusable, so native tabbing already reaches them, and intercepting `Tab` would fight the focus trap the native `<dialog>` provides.
* Accessibility: a real `role="dialog"` with a labelled group of `role="button"` keys, plus a hidden `<input inputmode="decimal">` that screen-reader and keyboard users can use directly. The pad is a convenience layer, never the only path.

---

## 7. Honest Platform Messaging

Spec §9 forbids claiming unsupported iOS capabilities. The exact copy, surfaced in About and contextually:

| Topic | What the app says |
|---|---|
| Install | "Open REPLOG in Safari, tap Share, then Add to Home Screen." No fake install button on iOS; the `beforeinstallprompt` path is used only where the browser supports it. |
| Storage | "Your data is stored by Safari on this device. iOS may remove it if storage runs low, or if you clear website data. Export a backup regularly." |
| Rest timer | "Timers keep perfect time while REPLOG is open. iOS cannot alert you once the app is in the background or the screen is locked." |
| Notifications | Not offered. No permission prompt, no "coming soon" teaser. |
| Haptics | Not claimed. `navigator.vibrate` is unavailable in iOS Safari; where it exists, haptics are an opt-in setting; where it does not, the setting is hidden and feedback is visual. |
| Health data | Not offered. No HealthKit, no Apple Watch. |
| Sync | "Version 1 keeps everything on this device. Nothing is uploaded." |
| Photos | "Photos never leave your device. Location data is removed when a photo is added." |
| Offline | "REPLOG works fully offline after its first load." (True — there is no runtime network dependency.) |

---

## 8. Theming

```html
<html data-theme="dark">   <!-- 'light' | 'dark', resolved from the 'system' pref -->
```

* `:root` holds dark values; `:root[data-theme='light']` overrides. `system` resolves via `matchMedia('(prefers-color-scheme: dark)')` with a live listener.
* The resolved theme is applied by an inline script in `index.html` **before** first paint, reading `replog.prefs.v1` synchronously, so there is no flash.
* `<meta name="theme-color">` is updated to match (`#0B0C0E` / `#F6F7F8`) so the iOS status bar and standalone chrome follow the theme.
* Light theme is a full design, not an inverted dark theme: shadows replace surface steps, borders lighten, and `--accent-ink` replaces lime for text.
* Both themes are reviewed in direct sunlight simulation (reduced contrast) and verified in greyscale.

---

## 9. Charts

Hand-built SVG components (ARCHITECTURE D4). Shared rules:

1. **No chart junk** — no gridline grids, no 3D, no drop shadows, no legends when one series exists. Axis labels are `--t-micro`/`--text-3`; at most 4 y-ticks and 5 x-ticks on mobile.
2. **Gaps are gaps.** `null` points break the line. No interpolation, no zero-filling, no smoothing that invents values (spec §4.9). A dashed connector may bridge a gap *only* when labelled "no data". **The rule has two halves**: an empty bucket is a *gap* for a measurement series (body weight, a circumference, an e1RM) and a real *zero* for a total series (volume, sets, sessions). Drawing a missed fortnight as a gap hides it; drawing an unrecorded weigh-in as zero invents a cliff. `domain/analytics/series.ts` has one builder for each and they are not interchangeable.
3. **Sparse data is labelled.** Fewer than 3 points → an empty state, not a chart. Fewer than 5 → no trend line. The point count is always printed.
4. **Axis honesty.** Y axes for body weight and measurements may be zoomed (a 2 kg change on a 0-based axis is invisible), but a zoomed axis must show its real min/max values. Volume and count axes always start at zero.
5. **Touch reading.** Tap or drag to scrub shows a value callout with the exact figure, unit, and date; no hover-only affordance. The callout snaps to a reading, never to a position between two, and is positioned by a separate anchor element: an inline inset resolves against the element's *own* direction, so a callout carrying `dir="auto"` for its Arabic text would otherwise measure its offset from the opposite edge and land at the mirror of its point.
6. **Estimates differ visually.** Estimated-1RM series are dashed with `--info` and carry the `⌁` marker in the legend.

| Chart | Use | Spec |
|---|---|---|
| `rl-line-chart` | Weight, measurements, e1RM, top-set | 2 px accent stroke, 3 px point dots at data points only, optional dashed moving average, area fill at 8 % opacity only for single-series |
| `rl-bar-chart` | Volume per week/month, frequency | Bars capped at 16 px with `--r-sm` top corners, stackable by muscle group with a 6-colour categorical ramp (`--cat-lime` … `--cat-slate`). The ramp is defined per theme and **alternates lightness as well as hue**, so it survives greyscale and colour blindness; `check-contrast.mjs` gates each colour against the surface *and* against its neighbour. An empty bucket draws a hairline rather than nothing, because a zero-height bar is indistinguishable from a missing one. A count axis is labelled in whole units |
| `rl-sparkline` | Inside stat tiles | 40 px tall, no axes, last point emphasised |
| `rl-distribution` | Muscle-group share | Horizontal stacked bar + a labelled list with percentages — **not** a pie chart (unreadable at 12 categories and bad for RTL) |

Chart colours come from tokens, so theme switching needs no redraw logic beyond a re-render.

---

## 10. Internationalisation & RTL

### 10.1 Direction mechanics

`<html lang dir>` is driven by the locale signal. Layout uses **logical properties exclusively**: `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `border-start-start-radius`, `text-align: start`. Physical `left`/`right`/`margin-left` are banned by a stylelint rule.

Numerals are a preference of their own, separate from the language: an Arabic reader may want Latin digits, and the app honours whichever they chose. Every number on screen goes through `I18n.formatNumber`, and every number typed **in** comes back through `normaliseDigits`, which reads Latin, Arabic-Indic and Persian digits and all three decimal marks. A field that rendered `٧٩٫٨` but only parsed `[0-9.]` would display a number its own keyboard cannot retype.

An arrow that carries meaning is a translated string, not a literal glyph. U+2192 is not bidi-mirrored, so "82.5 → 79.8" in an Arabic paragraph renders right-to-left with the arrowhead still pointing right — from the later value back at the earlier one. Arabic uses U+2190, as it already does for the "Settings ← Data" breadcrumb.

### 10.2 Mirroring matrix

| Element | RTL behaviour |
|---|---|
| Layout, lists, nav order, tab order | Mirror |
| Back chevron, disclosure chevrons, "see all" arrows | **Mirror** |
| Page-transition slide direction | Mirror (automatic — animations use the inline axis) |
| Progress bars, rest-timer ring depletion | Mirror (fill grows from the inline start; ring runs counter-clockwise) |
| Swipe-to-delete | Mirror (swipe toward the inline end) |
| Numeric pad layout | **Do not mirror** — digit keypads are universally left-to-right |
| Numbers, weights, reps, timers, dates | **Do not mirror** (LTR runs inside RTL text, isolated with `dir="auto"` / `<bdi>` to stop bidi reordering of things like "100 kg × 5") |
| Trend arrows (↑ gain / ↓ loss) | **Do not mirror** — vertical semantics |
| Play / pause / timer / check / dumbbell / muscle icons | **Do not mirror** |
| Chart **time axis** | **Do not mirror.** Time runs left → right in both directions; axis labels, legend, callouts and the surrounding layout do mirror. Rationale: the data is read with Western numerals and time-series convention in Arabic technical UIs is predominantly LTR; mirroring the axis while numerals stay LTR produced worse comprehension in review. Documented as a deliberate exception, with the decision recorded here rather than left implicit. |
| Chart category axes (muscle groups, weekdays) | Mirror |

### 10.3 Translation discipline

* All strings live in `locales/en.json` + `locales/ar.json`, dot-namespaced by feature. A CI check fails on key drift (ARCHITECTURE §12.3).
* No string concatenation. Interpolation only: `"workout.summary.sets": "{count} sets"`, with ICU-style plural selection (`zero/one/two/few/many/other` — Arabic needs all six).
* Arabic terminology is gym-native, not literal: تمرين (exercise/workout by context), مجموعة (set), تكرارات (reps), راحة (rest), أفضل رقم شخصي (personal record), الحجم التدريبي (volume). Reviewed by an Arabic-speaking lifter, not a generic translator.
* Numbers/dates/relative times go through `Intl` with the active locale; numerals default to `latn` with an `arab` preference (DATABASE_SPEC §4.3).
* Text expansion: Arabic averages 10–25 % longer than English for UI labels. Every layout is checked with the longest string in both locales; buttons grow, they do not truncate. No fixed-width text containers.
* RTL review checklist per screen: nav order, icon direction, swipe direction, chart labels, mixed-numeral strings, input alignment, toast position, sheet drag direction.

---

## 11. State Coverage

Every data surface specifies four states. "It just shows nothing" is not acceptable.

| Screen | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| Dashboard | Skeleton tiles (no spinner) | "Let's set up your first plan" + Create plan; weight tile → "Add your weight" | Inline retry card per section; one failed section never blanks the page | Tiles with data render; tiles without show their own prompt |
| Train start | Skeleton rows | "No routines yet" + Create routine + Quick workout | Retry | Today empty but other routines listed |
| Active tracker | Never empty (a session always has structure) | A quick workout opens with "+ Add exercise" as the primary action | Write failure → persistent banner "Changes aren't saving" + Retry; **inputs stay editable and values are kept in memory** | Previous-performance block absent → "No history yet" |
| Library | Skeleton rows; seeding shows "Preparing your exercise library" with progress | Filtered-to-nothing → "No exercises match" + Clear filters | Retry | — |
| History | Skeleton rows | "No workouts yet" + Start a workout | Retry | Paging failure → "Load more" retry at the list end |
| Progress | Skeleton chart | "Not enough data yet — complete 3 workouts to see progress" | Retry | Chart with gaps + point count |
| Body | Skeleton | "Track your first measurement" | Retry | Charts per field that has ≥ 3 points |
| Photos | Thumbnail placeholders | "Add your first progress photo" + privacy note | Decode failure → broken-thumb placeholder with Remove | — |
| Settings → Data | — | — | Quota exceeded → explicit guidance + prune path | Import report with repairable issues itemised |

Loading policy: show skeletons after 120 ms (nothing flashes for fast local reads), spinners only for user-initiated operations longer than 400 ms, and progress bars with counts for export/import/seed.

---

## 12. Accessibility

* **Targets** 44 × 44 pt minimum; gym controls larger (§3.7).
* **Contrast** per §3.2, enforced in CI; greyscale review required.
* **Skip control** — a `<button>` that moves focus into `<main>` (which carries `tabindex="-1"`), **not** an anchor to `#main-content`. Safari leaves links out of the Tab order unless the user turns on full keyboard access, which would make a skip *link* unreachable by keyboard on the primary platform. Covered by an end-to-end test in WebKit.
* **Semantics** — one `<h1>` per page, landmark `<nav>`/`<main>`, `<ul>/<li>` for lists, real `<button>`s. The set grid is a `role="table"` with row/column headers so a screen reader reads "Set 3, weight 32.5 kilograms, reps 8, not completed".
* **Live regions** — `aria-live="polite"` for set completion and saves, `assertive` for rest-timer completion and errors. PR announcements include the record type and value.
* **Focus** — visible 2 px `--accent` ring with a 2 px offset, never removed; focus trapped in sheets/dialogs and restored to the invoking element on close; `inert` on background content.
* **Dynamic Type** — all sizes in `rem` against a 16 px root; layouts tested at 200 % text scaling. No `maximum-scale` or `user-scalable=no` in the viewport meta — pinch zoom stays available.
* **Reduced motion** — §3.5.
* **Keyboard** — full operability on desktop: `Tab` through sets, `Enter` to complete, `Space` on toggles, arrow keys on segmented controls and chips, `Esc` to close sheets.
* **Labels** — every icon-only button has an `aria-label`; translated, never English-only in Arabic.
* **Names are the name and nothing else.** A `<label>` that wraps a whole control names the input with everything inside it — unit suffix, hint, delta — and `aria-describedby` then reads the hint a second time. A field with a hint names itself from the label text alone (`aria-labelledby` on the span), and puts the unit and the hint in the description. For a left/right pair that difference is the whole point: "Biceps Left" and "Biceps Right" are two controls, and without the side in the name they are two controls called the same thing.
* **No motion-only or colour-only information** anywhere.

---

## 13. Iconography & Illustration

* 24 px stroke icons, 1.75 px stroke, round caps, drawn on a 24 grid; a single consistent open-source set (Lucide/Feather-style, MIT) or hand-drawn SVGs. Inlined as components so they inherit `currentColor`.
* Tab icons are 24 px outline with a filled active state; the Train icon is a filled play triangle on the lime circle.
* Exercise illustrations: optional, monochrome line SVGs on a muscle-highlight silhouette. Delivered as bundled assets under a size cap (ARCHITECTURE §10.5); missing art falls back to a muscle-group glyph, never a broken image or a blank square.
* App icon: lime mark on charcoal, legible at 60 px. Separate 180 × 180 opaque `apple-touch-icon` (iOS does not honour maskable icons) and a 512 maskable icon for other platforms.
* Emoji are not used as UI icons (inconsistent rendering, poor RTL behaviour, no theming). The 🏆 in wireframes above represents a drawn trophy glyph.

---

## 14. Micro-interaction Catalogue

| Interaction | Feedback |
|---|---|
| Set completed | Row fills to `--accent-soft`, check scales 0.8 → 1 over `--dur-micro`, value text weight increases, `aria-live` announcement, rest timer auto-opens |
| New PR | Badge enters with a 420 ms scale+fade; a single lime accent sweep across the card (reduced-motion: static badge only); announced; **never a confetti burst** — this is a tool, not a game |
| Button press | `scale(.98)` + `--surface-3` background over `--dur-micro` |
| Swipe to delete | Row tracks the finger; the Delete affordance widens past a 56 px threshold; release past threshold deletes with undo; snap-back below it |
| Sheet open | Translate from the block end + backdrop fade, `--dur-sheet` |
| Page push | 12 % inline-axis slide + fade, `--dur-sheet`, mirrored in RTL |
| Chart mount | Line draws over `--dur-slow` once per mount; bars grow from the baseline staggered 20 ms |
| Pull to refresh | **Not implemented** — local data is always current; a pull gesture would imply a network fetch that does not exist |
| Toast | Slides up above the nav, auto-dismiss, swipe to clear |
| Tab change | Instant content swap with a 120 ms cross-fade; the indicator bar slides |
| Timer tick | Number updates only (no per-second animation) to keep the frame budget free during the ring animation |

---

## 15. Responsive Behaviour

| Width | Layout |
|---|---|
| 320–389 | Single column, `--sp-3` gutters, stat tiles stack, numeric pad keys shrink to 56 × 52 |
| 390–429 (reference) | Single column, `--sp-4` gutters, 2-up stat tiles |
| 430+ (Pro Max) | Same as reference with `--sp-5` gutters; larger hero numbers; no new columns — the one-handed reach model is preserved rather than filling space |
| 744+ (iPad portrait, landscape phone) | Max content width 720 px centred; 2-column dashboard; planner shows the routine list and editor side by side; the tracker keeps a single column (the set grid must stay thumb-width) |
| 1024+ (desktop) | Persistent inline-start sidebar replaces the bottom nav; 3-column dashboard; 960 px content max; hardware keyboard shortcuts enabled |

Landscape on phones is supported but not optimised: the tracker keeps its single column and the action bar stays bottom-anchored. The manifest requests portrait; iOS ignores orientation locks in standalone mode, so the layout must simply not break.

---

## 16. Design QA Checklist

Run per screen, in both themes, both languages, before any release:

- [ ] Renders correctly at 320, 390, 430, 744, 1024 px
- [ ] Safe areas respected at the top and bottom; nothing under the home indicator
- [ ] All targets ≥ 44 pt; gym-critical targets ≥ 56 pt
- [ ] Contrast pairs pass; screen is still legible in greyscale
- [ ] Loading, empty, error and partial states all implemented
- [ ] Arabic: direction, icon mirroring, mixed-numeral strings, longest-string layout
- [ ] English: no truncation at 200 % text scaling
- [ ] No hardcoded strings (lint clean)
- [ ] No physical CSS direction properties (stylelint clean)
- [ ] Reduced-motion variant verified
- [ ] VoiceOver pass: reading order, labels, live-region announcements
- [ ] Keyboard pass on desktop
- [ ] No `100vh`, no `user-scalable=no`, no `<input>` font-size below 16 px
- [ ] Destructive actions confirmed; reversible actions offer undo
- [ ] Estimated values marked `⌁`; calculated averages labelled
- [ ] Verified in Safari standalone mode on a real device, not only in a simulator
