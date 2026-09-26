# P4 — Module Re-skins

**Depends on:** P3. **Size:** Large — nine modules, one slice each.
**Status:** In progress — module 1 slices `a`, `b` and `c` shipped (2026-09-22 to 2026-09-23). See
the per-module progress column below.

Bring every module that already exists into the prototype's design, and build the new behaviours
the prototype added to them.

**Load with this:** the module's own row in
[prototype/module-map.md](prototype/module-map.md) §2. **Every slice reads its row first.**

---

## The rule this phase exists to enforce

Nine of these modules are **RESKIN+**, not RESKIN. Between them they carry **~39 named new
behaviours** — appointment invites, finalize gates, section sharing, completion gates, a
corrections log. A slice that treats its module as pure styling will discover these one at a
time, mid-build, and every estimate after that is fiction.

**Each slice is at minimum two commits:** the re-skin, then each new behaviour on its own. If a
behaviour needs a migration, it is its own slice entirely.

---

## Order

Design delta × how often it is used:

| # | Module | Verdict | New behaviours |
|---|---|---|---|
| 1 | **Sacrament** (`/sacrament` hub over `/assignments`, `/prayers`, `/music`, `/program`) | RESKIN+ | 8 — **`a`, `b`, `c` shipped; `d`, `e` open, `f`/`g` on P5** |
| 2 | **Visits** (`/visits`) | RESKIN+ | 3 — **and retires `goals`** |
| 3 | **Youth** (`/youth`) | RESKIN | 2 adoptions |
| 4 | **Agendas** (`/agendas`) | RESKIN+ | 10 |
| 5 | **Music** (`/music`) | RESKIN+ | 4 |
| 6 | **Program** (`/program`) | RESKIN+ | 3 |
| 7 | **Tithing** (`/tithing`) | RESKIN | palette exception |
| 8 | **Admin** (`/admin`, `/admin/users`) | RESKIN+ | mostly absorbed by P2 |
| 9 | **Roster** (`/roster`, `/roster/import`) | RESKIN+ | corrections log |

Sacrament first because it is the daily surface and has the largest delta. Agendas is fifth
rather than second despite being large, because Phase 9 Part A is still uncommitted and should
land first.

---

## Slice notes

### 1. Sacrament — 8 new behaviours

> **NINE WAS WRONG, AND THE CORRECTION IS THE MODULE MAP'S.** Behaviour 9 — conducting rotation
> with weekly *and* monthly cadence and separate anchor shapes — **was already built** in
> `supabase/migrations/024_rotation_cadence.sql` (`calendar-c-rotation-cadence`). Verified while
> planning slice `a`; see `prototype/module-map.md` §2.1 correction (a). The count above and the
> ~39 in the header move with it.
>
> **Slice `a` — the hub — SHIPPED 2026-09-22 (`c39e70f`).** `/sacrament` is a month of Sundays,
> each card a pill row deep-linking into the module owning that work for that date; the card
> itself opens the programme. No new behaviour from the list below. Remaining: `b` Topics
> finalize, `c` References over pgvector, `d` day categories, `e` musical numbers by
> `afterTalkIndex`, `f` Talks finalize → to-dos (**P5**), `g` Prayers finalize (**P5**, `f`).
> Plus one the walk of scenario 072 found and the roadmap did not anticipate, now **SHIPPED
> 2026-09-22** (`06910f8`, `plans/p4-sacrament-music-month.md`, closing defect 072-D1): **`/music` is a
> month board**, not a rolling six-Sunday horizon. The Music pill could not reach a Sunday more
> than ~6 weeks out — precisely the horizon a bishopric plans at — so it landed on a page
> claiming nothing was on the calendar. `sundayPillHrefs()` moved out of the hub page into
> `lib/sacrament/sundayStatus.ts` so the href rule is testable. **This completes slice `a`.**
>
> ⚠️ **THE MONTH BOARD WAS REVERSED — SHIPPED 2026-09-23**
> (`plans/music-collapsed-list-and-rolling-year.md`). The prototype's `/music` is a **collapsed
> list of 8 rolling Sundays** you click into, and it closes 072-D1 by inserting a jumped-to date
> rather than by adding month navigation. Recorded in
> [prototype/module-map.md](prototype/module-map.md) §6.2, which is new: the harvest carried no
> navigation at all, which is why this was missed. `sundayPillHrefs()` and the `#sunday-<id>`
> anchor survive; `MonthNavigation` on `/music`, `parseMonthParam` and the month range do not,
> and the Music href now carries `?sunday=<id>&from=sacrament`.
>
> That change shipped with two more things worth finding from here. **A rolling 12-month horizon
> of Sundays** (`ensureHorizonGenerated()`, called from `/calendar` under the existing
> `calendar.manage` gate) — no UI, and it removes the round trip through the calendar for every
> Sunday-keyed module at once, which is why it was its own slice. And
> **`components/layout/ContextualBackLink.tsx`**, the first of the ~17 contextual back links
> module-map.md §6.3 catalogues.
>
> **THIS COMPLETES SLICE `a` FOR THE SECOND TIME.** Module 1 moves to `b` (Topics finalize),
> which owns the two things §6.2 names and this slice deliberately did NOT build: the
> `Topics pending` dimmed card and the `Draft`/`Pending approval`/`Approved` workflow pill.
> Neither concept exists in WLT — there is no `topics_finalized` anywhere — and inferring one
> from "this Sunday has topics assigned" is exactly what decisions.md §1.15 forbids.
>
> **SLICE `b` SHIPPED 2026-09-23** (`plans/sacrament-topics-finalize-and-history.md`), in three
> commits as the RESKIN+ rule requires.
>
> **`b1` — Topics leaves the dashboard** and becomes a shortcut on the hub. The user's decision on
> seeing it deployed: *"I don't think that's really necessary. If anything I'd probably rather just
> have that accessible from within the Sacrament module."* `NavigationItem` gained
> `onDashboard?: boolean` and `components/layout/ModuleShortcutRow.tsx` is the prototype's
> `.sac-nav` as a shared component — module-map.md §6.4, which the original harvest missed
> entirely. **The row is driven from `NAVIGATION_ITEMS`, not hardcoded**, so the Topics entry
> survives with its label, icon, permission and `built` flag intact, and `/talks/topics` keeps its
> home for the AI candidate queue (CLAUDE.md rule 3).
>
> **`b2` — Topics finalize.** Migration 078 adds `sundays.topics_finalized_at` — a TIMESTAMP, never
> a boolean, and **no `topics_finalized_by`**, because migration 069 narrowed 48 composite
> `(user, ward_id)` keys and the audit row is where "who" lives. It closes **§6.2 item 4**: an
> un-finalized Sunday on `/music` is dimmed with its completion pill REPLACED by `Topics pending`,
> and still clickable. **The rule is about WHAT changed, never about WHO moved** —
> `lib/topics/finalize.ts` is the one helper, called from three write paths, and a test reads their
> source because no behavioural assertion can see a fourth that forgot.
>
> **`b3` — what has been used recently.** The user's ask: *"just be able to see a quick overview of
> topics that have been used recently — make sure that you're [not] duplicating something that's
> been used recently."* A read-only list at the top of `/talks/topics`: date, topic, speaker,
> visiting speakers included. It widens the ask deliberately by also showing topics already on the
> calendar ahead, **marked** rather than folded in quietly.
>
> **§6.2's workflow pill is NOT slice `b`'s and was not built.** `Draft`/`Pending approval`/
> `Approved` reports the PROGRAMME's state, so it belongs with the programme — module 6, or
> whichever slice next touches `/program`.
>
> **`c` — References over pgvector (2026-09-23).** Migration 079: `talk_references` attached to
> the ASSIGNMENT, plus `sundays.references_finalized_at` / `references_skipped_at` under a CHECK
> that forbids both. A `Refs` pill (a BUTTON — it opens a modal, so it has no href) with the same
> attached checkmark as Topics, now shared as `components/sacrament/FinalizeToggle.tsx`. Search is
> `retrieveChunks` with no `filters`, so the ward's conference scope applies and no setting was
> added. `unfinalizeTopicsIfNeeded()` now clears **both** finalized stamps through
> `clearTalkShapeStamps()`, and a skip survives it. **For slice `f`:** the gate is
> `referencesDecisionOf(sunday) !== null` and the to-do's references come from
> `listReferencesForAssignments` — do not re-derive either. **Walking scenario 074 reworked it**
> (migration 080, bishopric-only reads; skip refused while references exist; per-talk Search and
> Add-manually windows; suggested scriptures as picks) — module-map §2.1 has the list. **A shared,
> admin-loaded corpus for every ward was raised and is NOT built**; it needs its own plan.
>
> **`f1` — Send asks and the answer on the to-do (2026-09-24), migration 083.** Built from
> plans/sacrament-talk-asks-conductor-and-assistant.md. The conductor's "Ask ___ to speak" to-dos
> (`lib/todos/askLinks.ts`, service role behind `talks.request`), one function that records an
> outcome for both the talk's panel and the to-do (`lib/assignments/requestOutcome.ts`), the pure
> rules (`lib/sacrament/talkAsks.ts`), and a check attached to the Talks pill with **Send asks
> (N)**. **`f2` and `f3` are next**: the asks follow the conductor, then the assistant.
>
> **Module 1 now has `d`, `e` left**, and `f`/`g` wait on **P5**. The INDEX argues P5 should
> come early for exactly that reason.

The chain is the point: **Topics → References → Talks → Prayers**, each with an explicit
finalize, each gating the next. Finalizing Talks **generates real to-dos** — which means this
slice either waits for **P5** or ships the finalize without the to-do half. Prefer waiting;
building a second assignment mechanism and retiring it later is the expensive path.

`references.skipped` is a distinct recorded state, not an empty list — "decided not to give
references this round" is a real choice.

**WLT is ahead on one piece:** the prototype's reference search is keyword matching over
uploaded text because it has no backend. WLT has pgvector and `retrieveChunks`. Build the
prototype's *UI* over WLT's *retrieval*.

### 2. Visits — 3 new, and the goals retirement

New: **appointment invites with accept/decline** (scheduling auto-confirms the scheduler and
creates a pending invite for a companion — never silently adding anyone), the
**schedule/log-contact panel** with tap-to-call and attempt outcomes, and `wardVisitSettings`
as a JSON blob with a **partial-merge setter**.

**Retire `goals` here.** It was superseded by `visit_goals` and nobody removed it:

| | `goals` (migration 010) | `visit_goals` (ITER-018) |
|---|---|---|
| Cadence | `desired_frequency_months integer` | amount + unit |
| Status | **stored column** refreshed by `refresh_goal_status()` | four bands computed on read |
| Measured from | a dated period | each household's own last completed visit |

Migration 029's own comment already says the cached column is dead: *"The UI never reads this
column."* ITER-018's record says the dated-period model produced "✓ Visited" above a banner
counting it as unvisited.

**Retirement migration** drops `goals`, `refresh_goal_status()` and its index — **after** the
deploy that removes every reader, never before, for the reason migration 063 was held back:
PostgREST answers a select naming a missing column with a 400, so applying it early 400s the
page. Add a `HELD_BACK_UNTIL_DEPLOYED` entry in `tests/db/migrations.test.ts`.

Reach: `app/(app)/goals/`, `app/api/goals/`, `lib/goals/`, `lib/validation/goal.ts`,
`components/goals/`, the `goals.view`/`goals.manage` permissions, the nav entry, and three test
files. `GoalAlertBanner` is also used by `app/(app)/assignments/[sunday_id]/page.tsx` — check
what it shows there before deleting it.

> **One thing to preserve or consciously drop:** `goals.target_type` is polymorphic
> (member / household / org / group) where `visit_goals` is per-org only. If a ward is using
> member- or group-targeted goals, that capability disappears. Confirm before dropping.

**Retiring `goals` takes the clock-driven list from seven to six.**

### 3. Youth — RESKIN, plus two adoptions

The closest agreement of any module: a faithful port including the load-bearing branch orders.
Two things to take back, both in decisions.md §2.6 — `authorLabel` from `confirmedAttendance`
rather than `null`, and `youthStewardships` wired through the already-subject-agnostic
`isInScope()`. Plus the **By-Youth** roster view and the feed's **flagged filter with a count on
the tab label**.

> ⚠️ **Do not port the prototype's date handling.** Its tenth pass deleted the ward-zone
> machinery and dropped every explicit `timeZone`. CLAUDE.md rule 12 and decisions.md §2.1.

**ITER-034** (the parked Youth Support redesign) is re-pointed here. Read
`.iterate/scopes/ITER-034.md` before planning this slice — parts of it are now covered and parts
are still open.

### 4. Agendas — 10 new behaviours
The largest delta in the phase. Section sharing as a **link table** (not a copy, so
`shared_write` is a live canvas with no sync code), reserved sections, generic routing plus the
bishopric→ward-council shortcut that **radiates rather than moves**, auto-route rules configured
only by the receiving side, meeting instances + an event log, check-in, delegate-to-absent,
section checklist, Finalize Meeting as a signal not a save, the Prayer Roll section (needs
**P7**), the Conducting & Presiding section, a guest link, and undo/redo.

> Conducting/Presiding is **hardcoded to the bishopric** in the prototype and flagged in its own
> code as needing to become generic per owning org once quorum agendas exist. **Build it generic
> from the start** — deriving from whichever org owns the agenda, defaulting to its President.

### 5–9. Music · Program · Tithing · Admin · Roster
Details in the module map. Three things worth flagging here:

- **Music's completion gate** must use **one** shared `musicCompletionFor()` for both the submit
  button and the list pill, or they drift — which is exactly how "Approved" showed while two
  hymns sat empty.
- **Tithing keeps its navy/gold palette** (P1's deliberate exception) and **its clear window
  changed** — CLAUDE.md rule 11 is now a Sunday-night schedule. The scheduler is P12's; until it
  exists the read-path filter is what clears it.
- **Roster** gains the corrections log with **revert detection**: if an incoming import's value
  exactly matches the `oldValue` of a past manual correction, flag it, quote the original note,
  and **do not pre-check it**.

---

## Definition of done — per slice

- [ ] The module-map row is read, and updated if it was wrong
- [ ] Re-skin and each new behaviour are separate commits
- [ ] Existing RLS suites and route tests still green
- [ ] New behaviours have their own tests per CLAUDE.md §8 priority order
- [ ] 375px, light and dark
- [ ] `explicitTimeZone.test.ts` green
- [ ] A browser walk, with a retro entry

## Definition of done — the phase

- [ ] All nine modules re-skinned
- [ ] `goals` fully retired, migration held until after the deploy
- [ ] The clock-driven list in CLAUDE.md §9 updated to reflect the retirement
- [ ] No module still rendering pre-P1 styling
