# Plan: P4 slice 1a — The Sacrament hub, and the three modules behind it

**Created:** 2026-09-22
**Type:** feature
**Phase:** P4 — Module Re-skins, module 1 of 9 (Sacrament)
**Slice:** `p4-sacrament-a` — the re-skin commit. **No new behaviours, no migrations.**

> **Load with this:** [plans/prototype/module-map.md](prototype/module-map.md) §2.1 and
> [plans/prototype/decisions.md](prototype/decisions.md) §1 + §2.1. Do not load any other phase
> file except [plans/P4-module-reskins.md](P4-module-reskins.md).

---

## Overview

The prototype's **Sacrament** module is a hub: a calendar of Sundays, each Sunday a card carrying
a row of status pills — Topics, Refs, Talks, Prayer, Assign, Music, Program — and each pill opens
the module for *that date*. WLT has the same information spread across three separate top-level
routes that never reference each other: `/assignments`, `/prayers` and `/talks/topics`.

This slice builds the hub and re-points navigation at it. **The three existing pages stay exactly
where they are and keep working** — they become the destinations behind the pills rather than the
entry points. Nothing is deleted, no route handler changes, no RLS policy moves, no migration.

### Why this is the first commit of the Sacrament slice

P4 §"The rule this phase exists to enforce" requires the re-skin and each new behaviour to be
separate commits. Eight of Sacrament's nine named behaviours hang off this hub's pills — the
finalize checkmarks *are* pills, References *is* a pill, the four-state acceptance colouring *is*
a pill state. Building them before the surface they live on means building each one twice.

### Success criteria

- `/sacrament` renders a window of Sundays for the ward, each with a pill row, at 375px and on
  a wide screen, in both themes.
- Every pill navigates to the existing module for that specific Sunday, and arrives showing that
  Sunday — not "the nearest one".
- Each pill's count is computed by **one** shared pure function, so two surfaces cannot disagree.
- The dashboard's Meetings & Programs section offers Sacrament, and the three old modules are no
  longer separate tiles.
- Existing `/assignments`, `/prayers` and `/talks/topics` route tests and RLS suites stay green
  with no edits.

---

## ⚠️ Two decisions to take before executing

Both were found in research and both change the work. **Neither should be guessed.**

### Decision 1 — `/sacrament` is already taken, and the collision is hard

`app/(youth)/sacrament/page.tsx` exists. Route groups do not appear in the URL, so
`app/(app)/sacrament/page.tsx` and `app/(youth)/sacrament/page.tsx` resolve to the **same URL**
and Next.js fails the build. One of them must move.

Worse, the word means two different things on the two sides:

| | Means | Owner |
|---|---|---|
| WLT's `Sacrament` nav item (`sacrament.view_assignments`) | who is **passing, blessing and preparing** the ordinance | **P11** |
| The prototype's `Sacrament` tile | planning the **sacrament meeting** — topics, talks, prayers, music, programme | **P4, this slice** |

`plans/retros/p3-shell-and-tile-dashboard.md` records the nav row as `built: false` with the note
that *"P11 owns the adult sacrament-administration screen and re-points this href when it exists."*
P4 arrives first, so P4 has to claim the name or decline it.

Three inbound references point at `/sacrament` today:
[app/(app)/layout.tsx:27](<../app/(app)/layout.tsx#L27>),
[app/(auth)/pin/PinSignInForm.tsx:62](<../app/(auth)/pin/PinSignInForm.tsx#L62>),
[app/api/auth/pin-login/route.ts:153](../app/api/auth/pin-login/route.ts#L153).

**Recommended — Option A.** The meeting hub takes `/sacrament`, matching the prototype and the
dashboard tile. The youth PIN screen moves to `/ordinances` inside the youth shell; it is a
single-purpose screen for one account type with no inbound link but the sign-in redirect, so the
move is three string edits and a directory rename. P11's adult ordinance screen then lands at
`/sacrament/ordinances` in the app shell, which nests cleanly under the hub and collides with
nothing.

**Option B.** Leave `/sacrament` alone and put the hub at `/sacrament-meeting`. Cheaper today,
and it makes the dashboard tile's label disagree with its URL for the life of the app.

> **Execute Task 1 only after this is settled.** Everything from Task 2 on is unaffected by which
> way it goes — only the path string changes.

### Decision 2 — the finalize chain waits for P5, and that is already the phase's stated preference

Sacrament's behaviours **3** (finalize generates real to-dos), **4** (accept/decline happens on
the to-do itself) and **5** (`declineHistory`) require the To Do module, which is **P5**.
[plans/P4-module-reskins.md](P4-module-reskins.md) §1 says: *"this slice either waits for P5 or
ships the finalize without the to-do half. Prefer waiting; building a second assignment mechanism
and retiring it later is the expensive path."*

This plan **takes that preference** — it builds the pills' *structure* and leaves every finalize
checkmark out. See the slice roadmap at the end. If the user would rather run P5 first and come
back, nothing in this slice is wasted: the hub is the surface P5's speaker-ask to-dos link back to.

---

## Module-map corrections found in research

P4's per-slice Definition of Done requires the module-map row to be *"read, and updated if it was
wrong"*. Three corrections, all verified against the code. **Apply these to
[plans/prototype/module-map.md](prototype/module-map.md) §2.1 in this commit.**

1. **Behaviour 9 — "Conducting rotation with weekly *and* monthly cadence and separate anchor
   shapes" — IS ALREADY BUILT.** `supabase/migrations/024_rotation_cadence.sql` adds
   `conducting_rotation.cadence text not null default 'weekly' check (cadence in ('weekly',
   'monthly'))`, and its header explains the anchor difference in the same terms the prototype
   does. Shipped in `calendar-c-rotation-cadence`. **Nine new behaviours is eight.**

2. **`/talks/topics` is a ward-level TOPIC LIBRARY, not a per-Sunday Sacrament sub-view.** The
   module-map row lists it beside `/assignments` and `/prayers` as though the three were peers.
   They are not: a slot's topic is chosen *on the assignment*, from this library. The prototype
   has **no topic library at all** — its topic field offers prefix-matched hints from past
   entries (`build-notes-raw.md` §`sacrament`). So `/talks/topics` is a WLT-only supporting
   surface that the hub should *link to*, not absorb. Re-skinning it is in scope; folding it into
   a Sunday card is not.

3. **The prototype's "Topics" pill maps to WLT's `/assignments/[sunday_id]`, not to
   `/talks/topics`.** In the prototype, "Topics" is the per-date editor holding the speaker-count
   stepper, the day-category selector and every talk slot. WLT already has that page. The naming
   near-collision with the library is the single most likely thing for an executing agent to get
   backwards.

---

## Relevant Files

**Create**

- `lib/sacrament/sundayStatus.ts` — the one pure function computing a Sunday's pill counts.
- `app/(app)/sacrament/page.tsx` — the hub Server Component. *(Path depends on Decision 1.)*
- `app/(app)/sacrament/SacramentCalendar.tsx` — the month-column grid / 375px card list.
- `components/sacrament/SundayCard.tsx` — one Sunday: date, conducting, pill row.
- `components/sacrament/StatusPill.tsx` — a `Pill` wrapper carrying `empty | partial | complete`.
- `tests/lib/sacramentSundayStatus.test.ts`
- `tests/components/sacrament/SundayCard.test.tsx`
- `testing/scenarios/talks/scenario-072-*/` — seed + scenario file.

**Modify**

- `lib/auth/navigation.tsx` — the Meetings & Programs section: add the Sacrament hub row as
  `built: true`; drop the three now-absorbed rows from the grid (see Task 6 for exactly which).
- `app/(youth)/sacrament/` → `app/(youth)/ordinances/` *(Option A only)*, plus the three inbound
  references listed under Decision 1.
- `app/(app)/prayers/page.tsx` — accept a `sunday` search param so a pill can deep-link.
- `app/(app)/talks/topics/page.tsx` — chrome-bar title only; it is already `SubDashboard`-shaped.
- `plans/prototype/module-map.md` — the three corrections above.

**Read, do not modify**

`lib/assignments/pipeline.ts`, `lib/prayers/prayerPipeline.ts`, `lib/calendar/queries.ts`,
`lib/assignments/queries.ts`, `lib/prayers/queries.ts`, `lib/music/queries.ts`,
`lib/program/queries.ts`.

---

## Dependencies

- **No new libraries.** `lucide-react` arrived in P3 and carries every icon this needs
  (`ChevronLeft`, `ChevronRight`, `Check`). Import **per icon**, never `import * as` (CLAUDE.md §3).
- **P1 primitives:** `Pill`, `Card`, `Button`, `SectionHeader`. P1 adopted the palette at the
  **token** level, so this slice inherits the prototype's colours with no hex values written —
  `plans/retros/design-system-tokens-and-primitives.md`. If you find yourself typing a hex, stop.
- **P3's `NAVIGATION_ITEMS`** is the single list behind the grid, sub-dashboards, quick-links and
  the route-exists test. **Nothing may keep a second copy** — no pathname-to-title table.
- **No migration.** If a task seems to need one, it belongs to a later slice, not this one.

---

## Known Pitfalls (from retro context)

- **`roster-b-picker-and-orgs` / `youth-c` — a client component reaching a server-only module.**
  `lib/sacrament/sundayStatus.ts` will be rendered by a client component. It may import **nothing
  but `@/types/domain`**. A single import of any `queries.ts` pulls in `next/headers`, which lint
  and typecheck both pass and only `npm run build` catches. `lib/assignments/pipeline.ts` carries
  this rule in its header — copy the header.
- **`youth-e` / ITER-022 — carry the row, not two fields of it.** Every covered card read
  `Covered · 0` above an event card reading `Covered · 1`, because the summary type held the state
  and the date but not the **count**. The pill row here is exactly that shape. Compute each count
  from the same rows the destination page reads, and have `sundayStatus.ts` return the counts it
  displayed rather than letting the card re-derive them.
- **`p3-shell-and-tile-dashboard` — the four walk defects were all in the seam between a layout
  and a page, and 3798 passing tests saw none of them.** Route tests call handlers directly and
  never render a layout. Budget for a browser walk; do not treat a green suite as done.
- **`p3-shell-and-tile-dashboard` — a test can pin a bug as the spec.** `ChromeBar.test.tsx`
  asserted `toBeEmptyDOMElement()` and passed while the page had no sign-out. When you write
  `SundayCard.test.tsx`, assert what a leader must be able to *do*, not what the component
  currently renders.
- **`program-c-public-pages` — an omitted empty slot reads as "failed to load".** A Sunday with no
  talks planned must render its pill as `Topics 0/3`, never render nothing. That reversal was made
  once already and the reason holds here: a slot that disappears looks correct, so nobody fixes it.
- **CLAUDE.md rule 12 / `decisions.md` §2.1 — every date formatter names its zone.** A Sunday is a
  `date` column, so it renders in **UTC** via `lib/calendar/dates.ts`. Do not reach for
  `readWardTimezone` here; that is for turn-up-at `timestamptz` values. `explicitTimeZone.test.ts`
  reads the source and will fail on a bare `toLocaleDateString`.
- **`youth-g` — a `<select>` overflows at 375px** because a flex item's `min-width: auto` refuses
  to shrink. The month/year jump control is two selects in a row. `min-w-0` on the flex item.
- **`p3` / `decisions.md` §6 — no jsdom test can catch a scroll-clamp bug.** If the hub grows a
  sticky or collapsing surface, reuse `components/layout/useCollapsingHeader.ts`; do not write a
  second one.

---

## Tasks

### Task 1: Settle the route collision
**Files:** `app/(youth)/sacrament/page.tsx` → `app/(youth)/ordinances/page.tsx`,
`app/(app)/layout.tsx`, `app/(auth)/pin/PinSignInForm.tsx`, `app/api/auth/pin-login/route.ts`
**Action:** Under Option A, move the youth screen and update the three redirect strings.
**Details:**
- The youth shell layout (`app/(youth)/layout.tsx`) is unchanged — it gates on the role, not the
  path.
- Add a one-line comment at each redirect saying why the path is `/ordinances` and not
  `/sacrament`, naming this slice. Without it the next reader "fixes" it back.
- `tests/routes/` has PIN-login coverage; update the expected `redirectTo`.
- **Under Option B, skip this task entirely** and use `/sacrament-meeting` everywhere below.

### Task 2: `lib/sacrament/sundayStatus.ts` — one definition of each count
**File:** `lib/sacrament/sundayStatus.ts` (create)
**Action:** A pure module computing a Sunday's pill row.
**Details:**
- Header comment: the `@/types/domain`-only import rule and why (see Pitfalls).
- Shape:
  ```ts
  export type PillStatus = "empty" | "partial" | "complete";
  export type SundayPill = {
    key: "topics" | "talks" | "prayer" | "music" | "program" | "conducting";
    label: string;
    filled: number;
    total: number;
    status: PillStatus;
  };
  export type SundayStatusInput = {
    speakingSlots: number;
    assignments: readonly {
      topicId: string | null;
      memberId: string | null;
      externalSpeakerName: string | null;
      stage: PipelineStage;
    }[];
    prayers: readonly { memberId: string | null; slot: "invocation" | "benediction" }[];
    hymnSelectionCount: number;
    programStatus: string | null;
    conductingUserId: string | null;
  };
  export function sundayPills(input: SundayStatusInput): readonly SundayPill[];
  ```
- **`topics` counts a slot with a topic. `talks` counts a slot with a topic AND a speaker.** These
  are deliberately different metrics — `build-notes-raw.md` §`topics-pill-and-finalize-checkmark`
  records why: *"a topic can genuinely be decided before any speaker is even picked"*, which is
  the ward's stated workflow of laying out a month of topics first. Do not fold them into one.
- A speaker counts if `memberId` **or** `externalSpeakerName` is set — ITER-004 external speakers
  are real speakers.
- `total` for topics and talks is `speakingSlots`, read from `sundays.speaking_slots`, **never**
  `assignments.length`. A Sunday with 3 slots and 1 assignment reads `1/3`, not `1/1`.
- `status` is `empty` at 0, `complete` at `filled === total && total > 0`, `partial` otherwise.
  **`total === 0` is `complete`, not `empty`** — a Sunday configured for no talks has nothing
  outstanding. Assert this case explicitly; it is the one a reader will get backwards.
- No `Date`, no `now`, no clock. The hub passes nothing time-dependent into this function.

### Task 3: `components/sacrament/StatusPill.tsx`
**File:** create
**Action:** A thin wrapper over `components/ui/Pill.tsx` mapping `PillStatus` to a tone, rendering
`{label} {filled}/{total}` inside an `<a>`.
**Details:**
- `Pill` owns the shape; `toneClassName` is the escape hatch P1 kept so measured tones are not
  flattened into four generic ones (`design-system-tokens-and-primitives`). Use the existing
  stage tokens rather than inventing pill tones.
- **Always an `<a>`, never a disabled button.** P3 removed `Tile.locked` outright and replaced its
  tests with the inverse guarantee asserted on shape: a root `<a>`, keyboard reachable, with no
  `opacity-` dimming. Same rule here — a pill a person cannot act on is a pill that should not be
  rendered.

### Task 4: `components/sacrament/SundayCard.tsx`
**File:** create
**Action:** One Sunday — date, `type` when it is not `standard`, conducting, the pill row.
**Details:**
- Props are plain data: `{ sundayId, date, type, conductingName, pills, hrefs }`. No queries.
- The date renders through `lib/calendar/dates.ts` (UTC — rule 12).
- A no-meeting Sunday type (`NO_MEETING_SUNDAY_TYPES` in `types/domain.ts`) renders a sentence
  instead of pills, the way the prototype renders *"No sacrament meeting — {title}"*. Do not
  render an empty pill row for a Sunday with no meeting.
- **Never fabricate a name for an unfilled role** (`decisions.md` §1.11): an unassigned conductor
  reads `Conducting: open`, never a guess and never a blank.

### Task 5: `app/(app)/sacrament/page.tsx` + `SacramentCalendar.tsx`
**Files:** create
**Action:** The hub. Server Component reads; client component handles month navigation.
**Details:**
- Gate on `can(user, "talks.view", roleAccess)` with `NotPermitted`, following
  `app/(app)/assignments/page.tsx` exactly — `can()` not `assertCan()`, because a `ForbiddenError`
  escaping a Server Component becomes a 500 whose message Next strips in production
  (`auth-b-invites-admin`).
- Resolve `roleAccess` **once** and pass it down (CLAUDE.md rule 10).
- Reuse `parseMonthParam` / `monthStart` / `lastDayOfMonth` / `monthLabel` from
  `lib/calendar/dates.ts` and `listSundays` from `lib/calendar/queries.ts`. Do not write a second
  month-window helper.
- **Reads only.** Generating a month is a calendar write and stays on `/calendar` — the comment in
  `app/(app)/assignments/page.tsx:53` records why (`calendar-c`'s half-generated months, and two
  pages racing each other to create Sundays).
- Fetch assignments, prayers, hymn selections and programmes for the window in one
  `Promise.all`, then map each Sunday through `sundayPills()`.
- Reuse `MonthNavigation` from `app/(app)/calendar/MonthNavigation.tsx`.
- Layout: a single column of `SundayCard`s at 375px; two or three month columns from `md:` up,
  matching the prototype's `cal-grid`. Tailwind only.

### Task 6: Navigation
**File:** `lib/auth/navigation.tsx` (modify)
**Action:** Add the Sacrament hub; remove what it absorbs.
**Details:**
- New row: `label: "Sacrament"`, `href: "/sacrament"`, `permission: "talks.view"`,
  `built: true`, section Meetings & Programs, with a blurb naming the meeting rather than the
  ordinance.
- **Remove the `/assignments` and `/prayers` rows from the grid** — they are now reached through
  the hub, and leaving them makes three tiles for one module.
- **Keep `/talks/topics`** as its own row. It is the ward topic library (correction 2), not a
  Sunday view.
- **The existing `Sacrament` row** (`sacrament.view_assignments`, `built: false`) is P11's
  ordinance screen. Re-label it so the two are distinguishable — `Sacrament Ordinances` — and
  point it at `/sacrament/ordinances`. It stays `built: false`.
- `tests/lib/navigationRoutesExist.test.ts` reads `app/` from disk. It needs a genuinely unbuilt
  href as its failure anchor; `/admin/audit-log` is still unbuilt, so the anchor holds. Confirm
  the test still fails when deliberately broken before believing it (`p3`'s rule).

### Task 7: Deep links into the three modules
**Files:** `app/(app)/prayers/page.tsx` (modify), `app/(app)/talks/topics/page.tsx` (modify)
**Action:** Make every pill land on the right Sunday.
**Details:**
- Topics and Talks pills → `/assignments/{sunday_id}`. That page already exists and already takes
  the id. No change needed.
- Prayer pill → `/prayers?month={YYYY-MM}#sunday-{id}`. Add the anchor id to `PrayerBoard`'s rows;
  do not build a per-Sunday prayer page for this slice.
- Music pill → `/music`, Program pill → `/program/{sunday_id}` (verify the existing param name
  before wiring; `app/(app)/program/[sunday_id]/` exists).
- The prototype fixed a real bug here — `openProgram(key)` ignored its key and always showed the
  nearest Sunday (`build-notes-raw.md` §`sacrament-to-program-navigation`). **Assert the arrival
  date in the walk**, not just that the link exists.

### Task 8: Documentation
**Files:** `plans/prototype/module-map.md` (modify)
**Action:** Apply the three corrections. Mark behaviour 9 as already shipped with its migration
number, restate the `/talks/topics` relationship, and change "9 new behaviours" to 8 in both §1's
table and §2.1's heading.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. **This slice adds no table and no policy, so there is no new RLS
suite** — and that is the signal that it is genuinely a re-skin.

**`tests/lib/sacramentSundayStatus.test.ts`** — table-driven over `sundayPills()`:
- 0 of 3, 1 of 3, 3 of 3 → `empty` / `partial` / `complete`.
- **`total === 0` → `complete`.** The case a reader gets backwards.
- Topics ≠ Talks: a slot with a topic and no speaker is `topics 1/3, talks 0/3`.
- An external speaker with a topic counts toward `talks` (ITER-004).
- More assignments than `speakingSlots` never produces `4/3` — clamp or assert it cannot happen.

**`tests/components/sacrament/SundayCard.test.tsx`**:
- Every pill renders as an `<a>` with an href; none carries an `opacity-` class (P3's inverse
  guarantee, asserted on shape).
- A `0/3` pill **renders** rather than being omitted (`program-c`'s reversal).
- A no-meeting Sunday type renders the sentence and no pill row.
- An unassigned conductor reads `Conducting: open`.

**Regression — no edits expected:** `tests/routes/assignments*`, `tests/rls/*`,
`tests/lib/navigationRoutesExist.test.ts`, `tests/lib/explicitTimeZone.test.ts`. If any of these
needs changing, something in this slice has exceeded a re-skin — stop and re-scope.

---

## Test Scenarios (Harness)

### Scenario 072: One Sunday, six pills, and the page each one opens
**Tags:** `talks`, `sacrament`, `full`, `p4`
**Purpose:** The hub's whole value is that a pill's count matches the page behind it. That needs a
month of Sundays in *deliberately different* states of completeness, which is tedious to build by
hand and is exactly the mismatch (`youth-e` / ITER-022) that a green suite cannot see.
**Seed data summary:**
- `wards` — 1 — standard settings, a known timezone.
- `users` — 3 — a bishop, a counselor, an `org_president` (who holds no `talks.view` — the
  permission matrix is the source of truth here, and it is not the intuitive answer).
- `sundays` — 5 in one month — one **untouched** (`0/3` everywhere), one **partial** (2 topics,
  1 speaker, 1 prayer), one **complete** (3 topics, 3 speakers, both prayers, hymns, approved
  programme), one `speaking_slots = 0`, one with a no-meeting `type`.
- `assignments` — ~6 — spread across the partial and complete Sundays, one an ITER-004 external
  speaker.
- `prayer_assignments` — 3 — invocation only on the partial Sunday.
- `hymn_selections`, `programs` — enough to drive the Music and Program pills on the complete
  Sunday only.
**Tester action:** Sign in as the bishop, open the dashboard, click the Sacrament tile. Read the
pill row on each of the five Sundays. Click each pill on the partial Sunday. Resize to 375px.
Sign out, sign in as the `org_president`, open `/sacrament` directly.
**Verification checklist:**
- [ ] The untouched Sunday renders `Topics 0/3` and `Talks 0/3` — **visible, not omitted**
- [ ] The partial Sunday reads `Topics 2/3` and `Talks 1/3` — the two counts differ, and the page
      behind each shows exactly that many
- [ ] The `speaking_slots = 0` Sunday reads as complete, not empty, and says nothing is outstanding
- [ ] The no-meeting Sunday shows a sentence and no pill row
- [ ] Every pill on the partial Sunday opens **that Sunday**, not the nearest one
- [ ] The conducting line on an unassigned Sunday reads `Conducting: open`
- [ ] At 375px the month/year jump selects do not overflow and there is no horizontal page scroll
- [ ] Both themes: no pill is legible in one and invisible in the other
- [ ] The `org_president` gets `NotPermitted`, not a 500 and not an empty grid
- [ ] The dashboard shows one Sacrament tile, not three

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run build` is **not optional here.** `youth-c` shipped a constant in a server-only module that
pulled `next/headers` into the browser bundle — lint, typecheck and 2982 tests all passed and only
the production build caught it. `lib/sacrament/sundayStatus.ts` is rendered by a client component,
so this slice has that exact shape.

---

## Integration Notes

### Order, and what is safe to stop after

1. Task 1 (route) — **needs Decision 1 first.** Safe to stop after: nothing is broken, the youth
   screen simply lives somewhere else.
2. Tasks 2–4 (the pure function and the two components) — safe to stop after; nothing renders yet.
3. Task 5 (the hub) — safe to stop after; the page exists but nothing links to it.
4. Task 6 (navigation) — **this is the visible change.** Do not land it before Task 5 is walked,
   or the dashboard offers a tile that 404s, which is the exact bug P3 closed.
5. Tasks 7–8 — polish and documentation.

### Breaking changes

- The dashboard loses the Assignments and Prayers tiles. Anyone with those bookmarked keeps
  working — the routes are untouched.
- Under Option A, `/sacrament` changes meaning. Any youth PIN account with it bookmarked lands on
  the app shell and is redirected; acceptable for a PIN screen reached through a sign-in flow.

### Slice roadmap — what comes after this commit

Each is its own commit. Those needing a migration are their own slice entirely (P4's rule).

| Slice | Behaviour | Migration | Blocked by |
|---|---|---|---|
| `p4-sacrament-b` | Topics finalize + `unfinalizeIfNeeded()` + the finalize checkmark on the pill | yes | — |
| `p4-sacrament-c` | References pill + modal, over WLT's **pgvector `retrieveChunks`** rather than the prototype's keyword search; `skipped` a distinct state | yes | — |
| `p4-sacrament-d` | Day categories — a growable ward-wide list driving which roster the picker shows | yes | — |
| `p4-sacrament-e` | Extra musical numbers positioned by `afterTalkIndex` (`musical_numbers` has no position column today) | yes | — |
| `p4-sacrament-f` | Talks finalize → to-dos; accept/decline on the to-do; `declineHistory`; four-state pills | yes | **P5** |
| `p4-sacrament-g` | Prayers finalize, mirroring f; never gated on References | yes | **P5**, f |

**WLT is ahead on References and should stay ahead.** The prototype's reference search is keyword
matching because it has no backend; it says so in its own build note. WLT has pgvector and
`retrieveChunks`. Build the prototype's **UI** over WLT's **retrieval** — and remember
`ai-b`'s rule that no whole document is ever sent to Claude.

### Documentation to update in the same change

- `plans/prototype/module-map.md` §1 and §2.1 — the three corrections (Task 8).
- `plans/retros/` — a retro entry, written after the walk, per P4's per-slice Definition of Done.
- **CLAUDE.md §7's `/sacrament` note** — if Option A is taken, the sentence recording that
  `/sacrament` lives in the youth shell becomes wrong and must move with the route.
