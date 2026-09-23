# Plan: Topics — finalize, the shortcut row, and what was used recently

**Created:** 2026-09-23
**Type:** feature
**Phase:** P4 module 1 (Sacrament), slice `b`
**Structure:** Unified, **three sub-slices, three commits.** `b1` ships on its own and unblocks
nothing; `b2` is the schema slice; `b3` is a read-only view. Commit each before starting the next
— CLAUDE.md §12's RESKIN+ rule is that each named behaviour is its own slice and its own commit.

---

## Overview

Three things the Topics surface needs, with one theme: **a topic is a decision somebody makes
deliberately, and the app should show what has already been decided.**

**b1 — Topics stops being a dashboard tile and becomes a shortcut on the Sacrament hub.**
User decision, 2026-09-23, on seeing it deployed: *"I don't think that's really necessary. If
anything I'd probably rather just have that accessible from within the Sacrament module."* The
prototype agrees and has since the beginning — its Sacrament hub carries a `.sac-nav` row of eight
shortcuts and **`Topics` is one of them** (see the new [module-map §6.4](prototype/module-map.md)).

**b2 — Topics finalize**, the gate P4 §1 already scopes. It unblocks the `Topics pending` dimmed
card and the workflow pill that slice `a` deliberately deferred
([module-map §6.2](prototype/module-map.md) items 2 and 4).

**b3 — What has been used recently, and who gave it.** The user's actual ask:
*"as a user trying to put a sacrament together for the month that you're conducting, just be able
to see a quick overview of topics that have been used recently — make sure that you're [not]
duplicating something that's been used recently."*

### Success criteria

- No **Topics** tile on the dashboard. `/talks/topics` is reached from the Sacrament hub's shortcut
  row, and **only by somebody who holds `topics.view`** — the link is absent for everybody else,
  never offered-then-refused.
- The AI topic candidate queue is **still reachable**, and the plan says exactly how.
- A bishopric member can **finalize a Sunday's topics** from the topic page *and* from the hub's
  Topics pill, and both write the same fact.
- **Changing what a Sunday's topics ARE un-finalizes it. Advancing a speaker through the pipeline
  does NOT.** This is the sharpest rule in the slice.
- `/music` shows a Sunday whose topics are not finalized as **dimmed, reading `Topics pending`,
  with the completion pill replaced rather than accompanied** — still clickable, never disabled.
- The topic page shows **recent topics with the Sunday and the speaker**, visiting speakers
  included.
- `tests/lib/navigationRoutesExist.test.ts` and `tests/lib/explicitTimeZone.test.ts` stay green.

---

## Relevant Files

**b1 — the shortcut row**

- `lib/auth/navigation.tsx` — **modify** — add `onDashboard?: boolean` to `NavigationItem`; set it
  `false` on Topics. **Do not delete the entry** — see the trap below.
- `components/layout/ModuleShortcutRow.tsx` — **create** — the `.sac-nav` convention as one
  component.
- `app/(app)/sacrament/page.tsx` — **modify** — render the row under the heading.
- `lib/auth/navigation.tsx` — the filtering lives in `visibleNavigationItems()` itself (called
  once by `app/(app)/dashboard/page.tsx:58`). **`DashboardGrid` needs no change** — its own comment
  says "Built AND permitted — already filtered by `visibleNavigationItems()`. There is no second
  list", and adding a second filter there would make that comment false.
- `tests/lib/navigation.test.ts` — **modify** — Topics is absent from the dashboard, present to the
  shortcut row, and still permission-gated.
- `tests/components/layout/ModuleShortcutRow.test.tsx` — **create**.

**b2 — finalize**

- `supabase/migrations/078_topics_finalized.sql` — **create**.
- `lib/calendar/queries.ts` — **modify** — `topicsFinalizedAt` on `Sunday`; a
  `setTopicsFinalized()`.
- `lib/topics/finalize.ts` — **create** — `unfinalizeTopicsIfNeeded()`, the ONE helper.
- `app/api/sundays/[id]/topics-finalized/route.ts` — **create** — PATCH.
- `app/api/assignments/route.ts`, `app/api/assignments/[id]/route.ts`,
  `app/api/sundays/[id]/route.ts` — **modify** — call the helper.
- `lib/sacrament/sundayStatus.ts` — **modify** — the Topics pill carries `finalized`.
- `components/sacrament/StatusPill.tsx` + `SundayCard.tsx` — **modify** — the finalize checkmark.
- `app/(app)/music/SundayMusicCard.tsx` — **modify** — the `Topics pending` state.
- `app/(app)/music/page.tsx` — **modify** — pass `topicsFinalizedAt` through.
- `tests/lib/topicsFinalize.test.ts`, `tests/rls/topics-finalized.test.ts`,
  `tests/routes/topics-finalized.test.ts` — **create**.

**b3 — recent usage**

- `lib/topics/queries.ts` — **modify** — `listRecentTopicUsage()`.
- `app/(app)/talks/topics/RecentTopicUsage.tsx` — **create**.
- `app/(app)/talks/topics/page.tsx` — **modify**.
- `tests/lib/recentTopicUsage.test.ts` — **create**.

**No new dependency. One migration, in b2 only.**

## Dependencies

All existing: `topicStaleness` / `RECENT_MONTHS` from
[lib/topics/topicRotation.ts](../lib/topics/topicRotation.ts), `listAssignments` from
[lib/assignments/queries.ts](../lib/assignments/queries.ts), `sundayPills` from
[lib/sacrament/sundayStatus.ts](../lib/sacrament/sundayStatus.ts), `Pill` from
[components/ui/Pill.tsx](../components/ui/Pill.tsx), `writeAuditLog`, `visibleNavigationItems`.

**P8's `speaker_history` is NOT a dependency and must not be built here.** That table is for
bulk-importing history from *before* the app existed. Everything b3 needs is already in
`assignments` (sunday + member/external speaker + topic) and `topics.last_assigned_at`.

---

## Known Pitfalls (from retro context)

### 🔴 The AI candidate queue must stay reachable — CLAUDE.md rule 3

`/talks/topics` is the **only** home for the topic candidate accept/reject queue
(`CandidateQueue.tsx`, rendered inside `TopicList`). Rule 3: no AI output reaches a row without
explicit approval. **The answer is that the page is not deleted — only the tile is** — so the
queue keeps its home and the shortcut row is what keeps it reachable. Say this in the code, because
the next reader will wonder whether the queue was considered.

### 🔴 Do not delete the Topics entry from `NAVIGATION_ITEMS`

Instinct says "remove the tile, hardcode a link in the hub". That is `notification-trigger-drift`
exactly — one fact in two places. `NAVIGATION_ITEMS` holds the label, the icon, the **permission**
and the `built` flag; a hardcoded shortcut would carry its own copy of all four and drift from them.
Add `onDashboard: false` instead, so the row and the grid read the same source.

**And the permission gate is not optional.** `/sacrament` is `talks.view`; `/talks/topics` is
`topics.view`, which is **bishopric-only**. A shortcut rendered for everybody is
`p4-sacrament-a`/`youth-a-D1` again — a link that refuses on arrival. Filter with the same helper
the dashboard uses.

### 🔴 `unfinalizeIfNeeded` — the rule is about WHAT, not WHO

The prototype's build note §`topics-finalized-readiness` is explicit that finalizing *"never
depends on speaker confirmation/acceptance, only on the conductor's own explicit click"*. So:

| Change | Un-finalizes? |
|---|---|
| A slot's **topic** set, changed or cleared | **Yes** |
| `speaking_slots` changed | **Yes** — the day's shape changed |
| A new assignment row created | **Yes** |
| Stage `plan → review → approve → request → …` | **NO** |
| A speaker accepting or declining | **NO** |
| Contact state, notify, thank-you | **NO** |

`PATCH /api/assignments/[id]` carries **both kinds** of change, so the helper must inspect the
patch, not the route. Getting this backwards means a month of finalized topics silently unravels
as speakers are contacted — which is the state the signal exists to report.

### Other pitfalls

- **`youth-h` / `060a` — a timestamp, never a boolean.** "When was this finalized" is the useful
  question and null is reopenable. Follow `closed_at`.
- **⚠️ Migration 069 — do NOT add a `topics_finalized_by` column with a composite FK.**
  `(user, ward_id) → users (id, ward_id)` was narrowed on all 48 keys because a cross-ward leader
  legitimately writes in a ward that is not their home one, and it fails as a 500. The plan
  deliberately stores **no user column at all** — rule 6 already requires an audit row, and that is
  where "who" lives.
- **`roster-b`** — a VALUE import of a `queries.ts` from a client component pulls in `next/headers`
  and fails only `npm run build`. `SundayMusicCard` and `TopicList` are both `"use client"`.
- **CLAUDE.md rule 12** — `sundays.date` is a `date` column, so the recent-usage list renders in
  **UTC**. `topics_finalized_at` is a `timestamptz` "when did this happen" stamp → **also UTC**,
  not the ward's zone.
- **`ai-b`** — the plural bug. Any count sentence keeps a singular branch.
- **`p4-sacrament-a`** — `sundayStatus.ts` may import **nothing but `@/types/domain` and the pure
  date helpers**, and it has **no clock**. `finalized` arrives as an input; do not compute it there.
- **`youth-a-D1`** — never hide a control the API would allow. The finalize checkmark gates on
  `topics.manage`, which is what the route asserts.

---

## Tasks

## SLICE b1 — the shortcut row, and Topics off the dashboard

### Task 1.1: `onDashboard` on the navigation item

**File:** `lib/auth/navigation.tsx` (modify)

- Add `onDashboard?: boolean` to `NavigationItem`, defaulting to **true** when absent, so every
  existing row keeps its behaviour with no edit.
- Set `onDashboard: false` on the **Topics** row only. Leave its `permission`, `built`, `icon` and
  `blurb` exactly as they are.
- Add `shortcutNavigationItems(user, roleAccess)` beside `visibleNavigationItems()`, returning
  items **built AND permitted** in that order — the same rule, and reuse the same internal filter
  rather than copying it.
- Comment why the row exists and why the entry survives: the dashboard grid and the shortcut row are
  two *views* of one list.

### Task 1.2: `ModuleShortcutRow`

**File:** `components/layout/ModuleShortcutRow.tsx` (create)

- Props: `items: NavigationItem[]`. Renders a `<nav>` of links, each an icon plus a label.
- **Quote the prototype's standing convention in the header** (build note
  §`global-stylesheet-nav-consistency`): a page's row of links to other modules uses this one
  component, never a one-off button row.
- Each icon is **the destination's own dashboard tile icon**, taken from the navigation item —
  deliberately, so a shortcut is recognisable rather than arbitrary.
- Tailwind, not a global class: WLT has no global stylesheet, and the tokens already exist. Wraps at
  phone width; each link ≥ 44px.

### Task 1.3: Render it on the hub

**File:** `app/(app)/sacrament/page.tsx` (modify)

- Under the `<h1>` / month row, above the calendar.
- **Only the destinations that exist**, which today means the row is short: Topics, Music, Program,
  Assignments. Ward List, Conducting, Messages and To-Do are the prototype's and are **not built** —
  `built: false` already keeps them out, which is the whole reason to drive this from
  `NAVIGATION_ITEMS`. Do not hardcode the prototype's eight.

### Task 1.4: Exclude it from the grid, and test

**Files:** the dashboard grid + `tests/lib/navigation.test.ts` (modify),
`tests/components/layout/ModuleShortcutRow.test.tsx` (create)

- `visibleNavigationItems()` filters `onDashboard !== false`; `shortcutNavigationItems()` does not.
  **Both keep the built-AND-permitted rule** — the only difference between them is this one flag.
  `DashboardGrid` is untouched.
- Assert: **Topics is absent from the dashboard list**, present in the shortcut list for a bishop,
  and **absent from the shortcut list for a `music_coordinator`** (holds `music.view`, not
  `topics.view`) — the offered-then-refused negative.
- Assert an unbuilt item never reaches the row.

---

## SLICE b2 — Topics finalize

### Task 2.1: Migration 078

**File:** `supabase/migrations/078_topics_finalized.sql` (create)

```sql
alter table sundays add column topics_finalized_at timestamptz;
```

- **Nullable, and a timestamp rather than a boolean** — `youth-h`'s `closed_at` rule: "when did
  this happen" is the question the card asks, and null is how un-finalizing works without a delete.
- **No `topics_finalized_by`.** Write the reason in the migration header: migration 069 narrowed 48
  composite `(user, ward_id)` keys because a cross-ward leader writing in another ward fails them as
  a 500, and rule 6's audit row already records who.
- **No policy change.** `sundays` already carries ward-scoped write policies, and `topics.manage` in
  the route is the real boundary — the same split `calendar.manage` already has, documented in
  `tests/rls/calendar-access.test.ts`.

### Task 2.2: `unfinalizeTopicsIfNeeded()` — ONE helper, three call sites

**File:** `lib/topics/finalize.ts` (create)

```ts
export function topicShapeChanged(patch: UpdateAssignmentInput): boolean
export async function unfinalizeTopicsIfNeeded(
  wardId: string, sundayId: string | null, client?: SupabaseClient<Database>,
): Promise<void>
```

- `topicShapeChanged()` is **pure and exhaustively tested** — it is the rule in the table above, and
  it is the single most likely thing to get wrong. It returns true for `topicId` present in the
  patch; false for every stage/contact/notify field.
- The async half no-ops when `topicsFinalizedAt` is already null, so the ordinary case costs nothing.
- **Never throws.** Same contract as `stampTopicAssigned()` and `writeAuditLog()`: a readiness
  signal failing to clear must not fail the edit that earned it. Log and continue.
- Call sites: `POST /api/assignments` (always), `PATCH /api/assignments/[id]` (only when
  `topicShapeChanged`), `PATCH /api/sundays/[id]` (only when `speakingSlots` is in the patch).
- **A test must enumerate the call sites by reading the source**, the way
  `explicitTimeZone.test.ts` does — a fourth write path added later is exactly how this goes stale,
  and no assertion about behaviour can see a route that forgot to call it.

### Task 2.3: The route and the query

**Files:** `app/api/sundays/[id]/topics-finalized/route.ts` (create), `lib/calendar/queries.ts`

- `PATCH` with `{ finalized: boolean }`, Zod-validated, `assertCan(user, "topics.manage", …)`.
- Sets `now()` or `null`. **Idempotent**; re-finalizing does not move the stamp.
- Writes an audit row (rule 6).
- `Sunday` gains `topicsFinalizedAt: string | null`; add it to `SUNDAY_COLUMNS` and `mapSundayRow`.
  **Rule 9** — the type moves in the same change as the column.

### Task 2.4: The pill, and the checkmark on the hub

**Files:** `lib/sacrament/sundayStatus.ts`, `components/sacrament/StatusPill.tsx`,
`components/sacrament/SundayCard.tsx`

- `SundayStatusInput` gains `topicsFinalized: boolean`; the `topics` pill carries it. **Required,
  not optional** — the compiler then enumerates every caller, which is ITER-005's lesson and
  `p4-sacrament-a`'s reason for requiring `stage`.
- The Topics pill gains an attached **checkmark control** that toggles finalize from the calendar —
  the prototype's `FinalizablePill`, built *"per direct request ('handy to be able to just do it
  from the pill')"*. It writes the **same** fact as the page's button; there is no second system.
- ⚠️ The pill is an `<a>`. The checkmark must be a **sibling** control, not nested inside it —
  `p4-sacrament-a` avoided exactly this with a stretched pseudo-element. ≥ 44×44.
- Gated on `topics.manage`; absent, never disabled, for anybody else.

### Task 2.5: `Topics pending` on `/music`

**Files:** `app/(app)/music/SundayMusicCard.tsx`, `app/(app)/music/page.tsx`

- A Sunday whose topics are not finalized renders **dimmed (`opacity-70`)** with the completion pill
  **REPLACED** by a single `Topics pending` pill — not accompanied. The build note's reason:
  completion is *"premature before the conductor has actually decided the day's shape"*.
- **The card stays clickable.** Dimmed, never disabled — module-map §6.2 item 4, and P3's
  `Tile.locked` deletion is the same rule from the other side.
- This closes the item slice `a` recorded as deferred. Update module-map §6.2 to say so.

---

## SLICE b3 — what was used recently, and who gave it

### Task 3.1: `listRecentTopicUsage()`

**File:** `lib/topics/queries.ts` (modify)

```ts
export type TopicUsage = {
  topicId: string; topicTitle: string;
  sundayId: string; date: DateOnly;
  speakerName: string | null;   // null = a slot with a topic and nobody in it yet
  isUpcoming: boolean;
};
export async function listRecentTopicUsage(
  wardId: string, options: { monthsBack?: number }, client?: SupabaseClient<Database>,
): Promise<TopicUsage[]>
```

- One query over `assignments` embedding `sundays` and `members`, filtered to rows with a
  `topic_id`, ordered by date descending.
- **A visiting speaker is a real speaker** — fall back to `external_speaker_name` when `member_id`
  is null. Counting only members would show a planned stake-visit Sunday as having nobody, which is
  `sundayStatus.ts`'s `hasSpeaker()` rule in a second place.
- Default window: `RECENT_MONTHS` (6) from `lib/topics/topicRotation.ts` — **imported, not
  restated.** The library already calls six months "used recently" and two definitions would
  disagree on the same screen.
- **`isUpcoming` is computed by the caller passing `today`, not by a clock in here.** Same no-clock
  rule as `sundayStatus.ts`.

> **A product decision to confirm on the walk, not to assume silently:** the list includes topics
> **already scheduled for a future Sunday**, marked as upcoming. Somebody planning next month wants
> to avoid repeating what is coming up as much as what has gone — but this is a genuine widening of
> the user's words ("has been used"), so it is marked in the UI and put to them explicitly rather
> than folded in quietly.

### Task 3.2: The view

**Files:** `app/(app)/talks/topics/RecentTopicUsage.tsx` (create), `page.tsx` (modify)

- A compact list at the **top** of the topic page, above the library: date, topic, speaker.
- Dates render in **UTC** (`date` column, rule 12).
- Empty state: *"No topics have been used in the last six months."* — a fact, no action offered,
  because a new ward has none and that is not a problem to fix.
- A slot with a topic and no speaker yet reads as an absence, never "None" (`talks-c`'s rule).
- Correctly pluralised, with a singular branch (`ai-b`).

---

## Testing Strategy

**Pure, and the ones that matter:** `tests/lib/topicsFinalize.test.ts` — `topicShapeChanged()` over
every field of the assignment patch, both directions, with the stage fields asserted as
**non-triggering**. `tests/lib/recentTopicUsage.test.ts` — ordering, the external-speaker fallback,
the window boundary, the upcoming flag.

**Source-reading:** a test that the three write paths call `unfinalizeTopicsIfNeeded` — no
behavioural assertion can see a route that forgot to.

**RLS:** `tests/rls/topics-finalized.test.ts` — ward isolation on the new column, and that a
non-`topics.manage` role is refused by the route (the boundary is the route here, as with
`calendar.manage`; assert it rather than claim a policy that does not exist).

**Route:** `tests/routes/topics-finalized.test.ts` — happy path, 403, idempotence.

**Not written, deliberately:** no page-render test for `/talks/topics` — there is none today, and
the thing needing proof (the shortcut row appears for a bishop and not a coordinator, and the
checkmark writes what the page reads) is a browser behaviour. The walk is the instrument.

## Test Scenarios (Harness)

### Scenario 017 (modify) — `talks/scenario-017-topic-library-and-queue`
Its checklist assumes a **Topics tile on the dashboard**. Rewrite for the shortcut row: reached from
`/sacrament`, absent for a `music_coordinator`, and **the candidate queue still reachable** — the
rule-3 check, which is the one that must not be lost.

### Scenario NNN (create) — `talks/scenario-0NN-topics-finalize-and-unfinalize`
**Purpose:** the auto-unfinalize rule is the slice's sharpest edge and is near-impossible to set up
by hand — it needs a finalized Sunday with assignments at several pipeline stages.
**Seed:** one month; Sunday A finalized with 3 topics and speakers at `approve`; Sunday B finalized
with topics and no speakers; Sunday C not finalized.
**Checklist:**
- [ ] Advancing a speaker on Sunday A through `request` → `confirm` leaves it **finalized**
- [ ] Changing a **topic** on Sunday A un-finalizes it, and `/music` immediately reads
      `Topics pending`
- [ ] Changing `speaking_slots` on Sunday B un-finalizes it
- [ ] The hub checkmark and the page button write the same row — finalize in one, see it in the other
- [ ] A `music_coordinator` sees `Topics pending` and **no checkmark**
- [ ] A dimmed `/music` card is still **clickable**

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run the build: `SundayMusicCard` and `TopicList` are client components, and a stray value import of
a `queries.ts` fails only there (`roster-b`).

## Integration Notes

- **b1 is independently valuable and changes no data.** Commit it alone.
- **b2 carries the only migration.** Apply it before the deploy; it is additive and nullable, so
  nothing is held back.
- **Breaking-ish:** the Topics tile disappears from every dashboard. Say so in the commit.
- **Documentation:** update module-map §6.2 to record that items 2 and 4 are now built; update
  [P4-module-reskins.md](P4-module-reskins.md) §1 to mark slice `b` shipped and note that `f`/`g`
  remain blocked on **P5**.
- **After this, P4 module 1 has `c`, `d`, `e` left**, and `f`/`g` wait on P5. The INDEX argues P5
  should come early for exactly that reason.
