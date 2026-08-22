# Plan: Sunday Types — the Meeting/Fast-Sunday Split and Ward Conference

**Created:** 2026-08-22
**Type:** feature
**Scope refs:** ITER-002 ITER-003
**Structure:** Unified

## Overview

`FAST_SUNDAY_DISPLACING_TYPES` answers two different questions with one list: "this Sunday cannot
BE Fast Sunday" and "this Sunday holds no sacrament meeting". The two coincide today, which is why
one list has worked. Both items in GROUP-01 force them apart, from opposite sides:

- **ITER-002** — `holiday` must leave the list's second meaning: a ward that marks Christmas Sunday
  as a holiday still meets. And a Sunday that genuinely holds no meeting must get **no conductor**
  (sacrament or organization), read **"No meeting"** rather than blank, and **not spend a turn** in
  the rotation.
- **ITER-003** — `ward_conference` is the first type that **cannot be Fast Sunday while still
  holding a meeting**. Adding it to the single list would wrongly cancel the meeting, blank the
  conductor, and fire the `meeting_cancelled` warning.

Plan them together, land ITER-002's split first inside the same change.

### Key requirements

1. **Two named lists in `types/domain.ts`**, neither serving both meanings:
   - `FAST_SUNDAY_DISPLACING_TYPES` — cannot BE Fast Sunday. Gains `ward_conference`, keeps
     `holiday`. Four entries.
   - `NO_MEETING_SUNDAY_TYPES` — holds no sacrament meeting. `stake_conference` and
     `general_conference` only. Two entries. Plus a `holdsSacramentMeeting(type)` predicate, which
     is what call sites read.
2. **`ward_conference` is a real Sunday type** — CHECK constraint, label, badge, and it displaces
   Fast Sunday while conducting, speaking slots and organization meetings all behave normally.
3. **No conductor without a meeting.** `sundays.conducting_user_id` is null and there is no
   `sunday_org_conducting` row at all on a cancelled Sunday. Enforced by a **CHECK constraint**,
   with a one-off backfill in the same migration.
4. **The rotation skips cancelled Sundays**, independently for the bishopric rotation and each
   organization's. Weekly: a cancelled Sunday does not advance the cycle. Monthly: a month spends a
   turn unless **every** Sunday in it holds no meeting.
5. **Re-shifting is applied forward, behind the existing confirm dialog.** Marking a Sunday
   cancelled (or un-cancelling one) re-resolves who conducts on later Sundays, after warning how
   many will change.
6. **"No meeting" reads on screen** in the month grid, the mobile cards, and the Sunday detail page
   — including each organization's row.

### Success criteria

- A general conference Sunday shows "No meeting" for the sacrament meeting and for every
  organization, holds no conductor, and the person the old cycle would have spent on it conducts
  the next real meeting instead.
- Marking a Sunday as `holiday` no longer warns that its speakers are being orphaned, and it keeps
  its conductor and its speaking slots.
- Marking a Sunday as `ward_conference` on the first Sunday of a month moves Fast Sunday to the
  second, assigns a conductor normally, and leaves organization conducting alone.
- Marking a Sunday as `stake_conference` returns a 409 naming both the speakers at risk **and** how
  many later Sundays change conductor; confirming applies both.
- A month generated after a gap of un-generated months resolves the same conductors it would have
  had if every month in between had been generated.
- `npm run typecheck` fails if a future Sunday type is added without deciding both questions.

---

## Decisions taken before planning

Four questions were open in the two scope files (one of them surfaced during research). All were
resolved with the user on 2026-08-22.

### Decision 1 — Monthly cadence skips only a wholly dead month

A month spends a turn unless **every** Sunday in it holds no meeting. One cancelled Sunday inside a
month changes nothing, because under a monthly cadence one person already holds the whole month.

This is expressed as the same walk that answers the weekly case — count meeting-holding *Sundays*
for weekly, count months *containing at least one* meeting-holding Sunday for monthly — so there is
one rule with two projections rather than two rules to keep in step. The wholly-dead month is
near-impossible in practice; it is defined anyway because ITER-002 asks for an answer before the
monthly branch is written, and "undefined by omission" is how this list came to serve two meanings
in the first place.

### Decision 2 — Re-shift forward, behind the existing confirm dialog

Marking a Sunday cancelled after its month was generated **does** re-resolve who conducts on later
Sundays. Without this, the skip would only ever work for general conference — which
`generateSundays()` predicts — and never for stake conference, which is always hand-set after the
fact and is the case that started ITER-002.

**The cost, stated plainly: this can overwrite a per-Sunday conducting override.** Migration 024
records that "storage IS the override — there is no `is_override` flag", so nothing in the data
model distinguishes a conductor a human typed from one the rotation assigned. The mitigations:

- The user is warned first, with an exact count, through the `needs_confirmation` path that already
  exists in `updateSunday()`. Nothing is written until they confirm.
- Only rows whose recomputed conductor **differs** from the stored one are written, and only those
  are counted — the count that warns and the rows that change come from one computation.
- **The past is never rewritten.** The re-shift covers Sundays after the edited date *and* on or
  after today. Who conducted last March stays what it says, which is the doctrine
  `conducting_user_id` is a stored column for at all (03-calendar.md Step 3).

Record as a known gap: a `conducting_source` / `is_override` column would let the re-shift protect
hand-set conductors. It is **not** in this plan's scope. Do not add it opportunistically.

### Decision 3 — A CHECK constraint, with a one-off backfill in the migration

`sundays` gets `check (conducting_user_id is null or type not in ('stake_conference',
'general_conference'))`, and migration 027 clears the existing bad rows before adding it. Structural
rather than procedural, matching how this schema already enforces ward scope with composite foreign
keys instead of application checks.

**The consequence to build for:** `updateSunday()` must clear `conducting_user_id` in the *same*
UPDATE statement that changes the type, or the write raises. That is the intended behaviour — a
loud failure, not a silent wrong answer (CLAUDE.md rule 7).

`sunday_org_conducting` gets **no** equivalent constraint. It would need a trigger to see the
Sunday's type, and this repo has no triggers at all — every invariant in SQL is either a constraint
or an explicitly-called plpgsql function. Adding trigger machinery for one rule is the wrong trade;
the rule is enforced in `lib/calendar/queries.ts` and in the org-conducting route. **Record the
asymmetry in the migration comment** so the next reader does not think it was forgotten.

### Decision 4 — "No meeting" reads everywhere a conductor does

Month grid, mobile cards, Sunday detail page, and each organization's row. ITER-002 is explicit that
a blank is indistinguishable from an unfilled rotation position and that the ambiguity cost a
debugging session. This does not touch `SundayCell`/`SundayCard`'s three reserved regions, which are
contract-tested and belong to Phase 4.

---

## Relevant Files

**Schema**
- `supabase/migrations/027_sunday_meeting_types.sql` — create — the `type` CHECK recreated with
  `ward_conference`, the backfill, and the conductor CHECK
- `types/database.ts` — regenerate (`npm run db:types`). `sundays.type` is `text` with a CHECK, not
  a Postgres enum, so expect **no diff**; run it anyway per plans/INDEX.md Definition of Done

**Domain**
- `types/domain.ts` — modify — `ward_conference` in `SUNDAY_TYPES` and `SUNDAY_TYPE_LABELS`; the
  list split; `holdsSacramentMeeting()`

**Calendar logic**
- `lib/calendar/generateSundays.ts` — modify — export `isGeneralConference`; derive speaking slots
  from `holdsSacramentMeeting()` rather than naming `general_conference`
- `lib/calendar/meetingSeries.ts` — create — the pure "which Sundays hold a meeting between these
  two dates" builder, stored types overlaid on predicted ones
- `lib/calendar/resolveConductingUser.ts` — modify — a required meeting-series parameter; skip
  counting for both cadences; null for a cancelled target
- `lib/calendar/queries.ts` — modify — the largest file in this change; see Tasks 6–10
- `lib/calendar/resolveFastSunday.ts` — **no change**. It reads
  `FAST_SUNDAY_DISPLACING_TYPES`, whose meaning is unchanged; it simply gains `ward_conference`

**Routes**
- `app/api/sundays/[id]/org-conducting/route.ts` — modify — refuse a write on a cancelled Sunday
- `app/api/sundays/[id]/route.ts` — modify — carry the re-shift counts into the audit detail

**UI**
- `components/calendar/ConductingLabel.tsx` — modify — required `holdsMeeting` prop
- `components/calendar/SundayCell.tsx` — modify — pass it
- `components/calendar/SundayCard.tsx` — modify — pass it
- `components/calendar/SundayTypeBadge.tsx` — modify — a class entry for `ward_conference`
- `app/(app)/calendar/sunday/[id]/page.tsx` — modify — pass it; render the organization card
  read-only on a cancelled Sunday
- `app/(app)/calendar/sunday/[id]/OrgConductingEditor.tsx` — modify — a `holdsMeeting` prop
- `app/(app)/calendar/sunday/[id]/SundayEditor.tsx` — **verify only.** It already renders
  `warning.message` and a confirm button; the new sentence arrives inside that string

**Tests** — see Testing Strategy for the full list.

**Harness**
- `testing/scenarios/calendar/scenario-015-no-meeting-sundays/` — create

**Docs**
- `plans/03-calendar.md` — modify — record the split, the skip rule, and the re-shift decision
- `.iterate/scopes/ITER-002.md`, `.iterate/scopes/ITER-003.md`, `.iterate/BACKLOG.md` — modify —
  plan links (Step 5 of /planning)

## Dependencies

- **No new libraries.** Everything is existing modules.
- Uses: `lib/calendar/dates.ts` (every date is a `YYYY-MM-DD` string), `readDefaultSpeakingSlots()`
  from `lib/calendar/wardCalendarSettings.ts`, `apply_fast_sunday()` from migration 023,
  `writeAuditLog()`, `notifyOtherBishopric()`.
- **Migration 027 must be pushed before the tests pass.** `npm run db:push` targets the linked
  hosted project (CLAUDE.md §9); there is no local stack.
- **The migration changes data**, not only schema: it clears conductors, deletes organization
  conducting rows, zeroes speaking slots, and reverts assignments to `plan` on Sundays that hold no
  meeting. Read the counts it reports before moving on.

## Known Pitfalls (from retro context)

- **[calendar-a-rules-and-api]** — a select-column constant written across two lines with `+`
  widens its type from a string literal to `string` and every mapped row comes back as
  `GenericStringError`. The new narrow reader in Task 6 must keep `"date, type"` as **one literal**.
- **[calendar-a-rules-and-api]** — Supabase's type generator marks every plpgsql argument
  non-nullable. Already worked around for `p_fast_sunday_id`; no new RPC here, but do not "fix" that
  cast.
- **[calendar-c-rotation-cadence]** — *a page that writes must survive being abandoned*, and *"rows
  exist" is not "work finished"*. `ensureMonthGenerated()` repairs a half-built month on a GET.
  **Task 9 is where this bites:** its `needsConducting` test is `some(sunday => conductingUserId ===
  null)`, and after this change a cancelled Sunday is *legitimately* null forever. Left alone, every
  page view of a month containing general conference would re-run two write passes. Narrow it to
  meeting-holding Sundays.
- **[calendar-b-month-view]** — a checklist item asserting behaviour nobody traced through the data
  layer is a guess. Trace the re-shift's effect on `populateConducting()`'s fill-nulls-only
  guarantee before writing scenario 015's checklist.
- **[calendar-b-month-view]** — `next/link` renders in jsdom without an App Router mock; assert real
  `href`s rather than reaching for a mock.
- **[roster-b-picker-and-orgs]** — `typecheck` and `lint` both pass a server-only import pulled into
  a client component; only `npm run build` catches it. `OrgConductingEditor` is a client component,
  so anything it imports must not reach `lib/calendar/queries.ts`. Import
  `holdsSacramentMeeting` from `types/domain.ts`, never from `lib/calendar/`.
- **[role-access-overrides]** — a defaulted parameter is how 25 call sites came to silently ignore
  the ward's configuration. `ConductingLabel`'s `holdsMeeting` is **required**, not defaulted, for
  the same reason: the compiler should enumerate every place that has to decide.

---

## Tasks

### Shared foundation

#### Task 1: Split the one list into two
**File:** `types/domain.ts` (modify)
**Action:** Add `ward_conference`, then give each meaning its own name.
**Details:**
- Add `"ward_conference"` to `SUNDAY_TYPES` and `"Ward Conference"` to `SUNDAY_TYPE_LABELS`. The
  `Record` type means the build fails until the label exists — that is the guard, leave it.
- `FAST_SUNDAY_DISPLACING_TYPES` becomes `["stake_conference", "general_conference", "holiday",
  "ward_conference"]`. Update its comment to say **only** "cannot BE Fast Sunday", and to name
  `ward_conference` as the type that proved the split was needed.
- Add:
  ```ts
  export const NO_MEETING_SUNDAY_TYPES: readonly SundayType[] = [
    "stake_conference",
    "general_conference",
  ];

  export function holdsSacramentMeeting(type: SundayType): boolean {
    return !NO_MEETING_SUNDAY_TYPES.includes(type);
  }
  ```
- Comment `NO_MEETING_SUNDAY_TYPES` with why `holiday` is absent (a ward marking Christmas Sunday as
  a holiday still meets, often with a shortened or music-focused service) and why `ward_conference`
  is absent (it holds a normal meeting; it is only barred from being Fast Sunday).
- Call sites should read `holdsSacramentMeeting(...)`, not the list, everywhere except a filter that
  genuinely needs the array.

#### Task 2: Migration 027
**File:** `supabase/migrations/027_sunday_meeting_types.sql` (create)
**Action:** Add the type, correct the existing rows, then make the bad state unrepresentable.
**Details:** Order matters — the backfill must run **before** the CHECK is added.
- **Part 1 — the type CHECK.** `alter table sundays drop constraint sundays_type_check`, then add it
  back with `ward_conference` included. Confirm the generated constraint name first with
  `select conname from pg_constraint where conrelid = 'sundays'::regclass` rather than assuming it;
  migration 004 declared it inline. Comment that this list must stay in step with `SUNDAY_TYPES` in
  `types/domain.ts` or the database accepts a value TypeScript rejects (CLAUDE.md rule 9 territory).
- **Part 2 — backfill.** For every `sundays` row whose type is in
  `('stake_conference','general_conference')`:
  - `delete from sunday_org_conducting` where `sunday_id` is one of them — *deleted*, not nulled. A
    null `user_id` already means "this organization's rotation reaches this Sunday but the position
    is unfilled" (migration 024, Part 4), which is a different fact from "there is no meeting".
  - `update assignments set pipeline_stage = 'plan'` where `sunday_id` is one of them and the stage
    is not already `plan`. **Reverted, never deleted** — 03-calendar.md §Pitfall 5.
  - `update sundays set conducting_user_id = null, speaking_slots = 0`.
  - `raise notice` the row count of each step. This is a data correction on the shared hosted
    project; the operator must be able to see what it touched.
- **Part 3 — the conductor CHECK.**
  ```sql
  alter table sundays
    add constraint sundays_no_conductor_without_meeting
      check (conducting_user_id is null
             or type not in ('stake_conference', 'general_conference'));
  ```
  Comment it with: why it exists, that `lib/calendar/queries.ts` must therefore clear the conductor
  in the same statement that changes the type, and **that `sunday_org_conducting` has no equivalent
  constraint on purpose** — it would need a trigger to see the Sunday's type, this repo has no
  triggers, and the rule is enforced in `lib/calendar/queries.ts` and the org-conducting route
  instead. Say it was decided, not forgotten.
- Run `npm run db:push`, then `npm run db:types` (expect no diff — `type` is `text`).

### ITER-002 Tasks — the resolver

#### Task 3: Make the general-conference prediction reusable
**File:** `lib/calendar/generateSundays.ts` (modify)
**Action:** Export `isGeneralConference`; express slots through the new predicate.
**Details:**
- `export function isGeneralConference(date: DateOnly): boolean` — unchanged body. Task 4 needs the
  same prediction for months that have no rows yet, and two copies of it would drift.
- In the map, replace the `type === "general_conference" ? 0 : defaultSpeakingSlots` shape with one
  keyed on `holdsSacramentMeeting(type)`, so a future no-meeting type gets zero slots without anyone
  remembering to come back here.

#### Task 4: The meeting series
**File:** `lib/calendar/meetingSeries.ts` (create)
**Action:** A pure builder that answers "which Sundays between these two dates hold a meeting",
gap-proof by construction.
**Details:**
- ```ts
  export type MeetingSundayEntry = { date: DateOnly; holdsMeeting: boolean };

  export function buildMeetingSeries(
    from: DateOnly,
    to: DateOnly,
    storedTypes: ReadonlyMap<DateOnly, SundayType>,
  ): MeetingSundayEntry[]
  ```
- Walk `sundaysInRange(from, to)`. For each date, the type is `storedTypes.get(date)` when a row
  exists, otherwise the **predicted** type: `isGeneralConference(date) ? "general_conference" :
  "standard"`.
- **This fallback is the whole point of the module and must be commented as such.** Months are
  generated on demand, so skipping from August to December leaves gaps — and the retro for
  `calendar-c` records that skipping quickly through months is routine, not exceptional. A walk over
  only the stored rows would count a gap as zero cancellations, shift everyone's turn, and then
  *store* the wrong answer. The fallback is exactly right because a month with no rows cannot hold a
  hand-set stake conference: the only cancellation that can exist there is general conference, and
  that is predictable. A stored row always wins, so a bishopric that cleared a predicted general
  conference is respected.

#### Task 5: Skip cancelled Sundays in the resolver
**File:** `lib/calendar/resolveConductingUser.ts` (modify)
**Action:** Add a required series parameter and count only meeting-holding turns.
**Details:**
- New signature:
  ```ts
  export function resolveConductingUser(
    sundayDate: DateOnly,
    rotation: RotationEntry[],
    anchorDate: DateOnly,
    series: MeetingSundayEntry[],
  ): string | null
  ```
  Required, not optional — a caller that forgets the history must be a type error, exactly as
  `roleAccess` is on `can()` (plans/retros/role-access-overrides.md).
- **Guard the precondition and throw.** The series must cover `monthStart(anchorDate)` through
  `lastDayOfMonth(sundayDate)`; throw a named error naming both bounds if it does not. Monthly
  cadence needs whole months to decide whether a month is wholly dead, and a short series would
  produce a plausible wrong number rather than a failure. Same reasoning as `countSundaysBetween`
  refusing two non-Sundays.
- If the target date's own entry has `holdsMeeting === false`, return `null` before anything else.
- Offset, replacing the two `countXBetween` calls:
  - **weekly** — the number of entries with `holdsMeeting` whose date is
    `>= firstSundayOnOrAfter(anchorDate)` and `< sundayDate`.
  - **monthly** — the number of distinct months `>= monthStart(anchorDate)` and
    `< monthStart(sundayDate)` that contain at least one entry with `holdsMeeting`. A month whose
    every Sunday is cancelled is skipped (Decision 1); a month with even one meeting spends its turn.
- The `offset < 0` guard becomes unreachable by construction (a count is never negative), so replace
  it with an explicit "before the anchor" test: if `sundayDate < firstSundayOnOrAfter(anchorDate)`
  (weekly) or `monthStart(sundayDate) < monthStart(anchorDate)` (monthly), return `null`. Keep the
  existing comment explaining why wrapping backwards is a wrong answer wearing the shape of a right
  one.
- Everything else — `activeRotation`, the unfilled-position-returns-null rule — is unchanged.

### ITER-002 Tasks — the data layer

#### Task 6: A narrow type reader and the series plumbing
**File:** `lib/calendar/queries.ts` (modify)
**Action:** Give every conducting path the history it now needs.
**Details:**
- Add `const SUNDAY_TYPE_COLUMNS = "date, type";` — **one string literal on one line**
  (plans/retros/calendar-a-rules-and-api.md).
- ```ts
  async function readSundayTypes(
    supabase: SupabaseClient<Database>,
    wardId: string,
    range: SundayRange,
  ): Promise<Map<DateOnly, SundayType>>
  ```
  Selecting two columns rather than reusing `listSundays()` because the range can span years back to
  a rotation's anchor, and every column of every Sunday since 2024 is not needed to count turns.
  Map the `type` through the existing `toEnumValue()` helper.
- ```ts
  async function seriesFor(
    supabase, wardId, earliestAnchor: DateOnly, latestTarget: DateOnly,
    overrides?: ReadonlyMap<DateOnly, SundayType>,
  ): Promise<MeetingSundayEntry[]>
  ```
  Widens to `monthStart(earliestAnchor)` → `lastDayOfMonth(latestTarget)`, reads the stored types,
  applies `overrides` on top (that is how in-flight generation candidates and a projected type edit
  both reach the walk), and calls `buildMeetingSeries()`.
- Change `conductingUserFor(entries, sundayDate)` to `conductingUserFor(entries, sundayDate, series)`
  and pass it through.

#### Task 7: Generation
**File:** `lib/calendar/queries.ts` (modify)
**Action:** `generateSundayRange()` keeps resolving conductors inside the insert, now with history.
**Details:**
- **Do not undo calendar-c's fix.** The conductor is still resolved before the INSERT and written as
  part of it, so a new month arrives complete in one statement even if the request is abandoned. All
  that changes is where the offset comes from.
- Before building `rows`: find the earliest `effectiveFrom` among the active bishopric rotation sets
  that govern any candidate, then build the series once with `seriesFor(...)`, passing the candidate
  types as `overrides` so Sundays being inserted right now count correctly alongside stored ones.
- `populateConducting()` — build the series the same way for its range; **skip any Sunday where
  `holdsSacramentMeeting(sunday.type)` is false** so a cancelled Sunday is never given a conductor
  (which the CHECK from Task 2 would refuse anyway, loudly). Keep the fill-nulls-only rule.
- `populateOrgConducting()` — same: build a series per organization anchor, skip cancelled Sundays so
  no row is created for them, and additionally **delete** any `sunday_org_conducting` row that exists
  on a cancelled Sunday in the range. Keep `ignoreDuplicates: true` — the comment on it is accurate
  and load-bearing.
- `createSunday()` — set `speaking_slots` to 0 when the requested type does not hold a meeting, the
  same way it already does for `fast_sunday`. Route the existing `fast_sunday` special case and the
  new one through one expression.

#### Task 8: The edit path
**File:** `lib/calendar/queries.ts` (modify)
**Action:** Correct `assessEditedSunday()`, clear the conductor in the same statement, and handle
speaking slots in both directions.
**Details:**
- `assessEditedSunday()` — `wasDisplaced`/`willBeDisplaced` must read
  `holdsSacramentMeeting()`, **not** `FAST_SUNDAY_DISPLACING_TYPES`. Rename the locals to
  `heldMeeting`/`willHoldMeeting` so the next reader cannot mistake which question is being asked.
  This is the line that makes `holiday` stop firing `meeting_cancelled` and stops
  `ward_conference` firing it at all.
- In `updateSunday()`'s UPDATE object, when the patch takes the Sunday from holding a meeting to not:
  - add `conducting_user_id: null` — **in the same statement**, or the CHECK from Task 2 raises;
  - add `speaking_slots: 0` unless `input.speakingSlots` was given explicitly.

  And in the other direction (no meeting → meeting, which is how `general_conference` →
  `ward_conference` behaves): restore `speaking_slots` to `readDefaultSpeakingSlots(wardId)` unless
  the input set it. This mirrors what `apply_fast_sunday()` already does when a Sunday stops being
  fast, including its known limitation — a hand-set slot count does not survive the round trip
  (plans/retros/calendar-a-rules-and-api.md).
- After the UPDATE and after `resolveMonth()`, when the meeting status changed:
  - **to cancelled** — delete this Sunday's `sunday_org_conducting` rows;
  - **to holding** — run `populateConducting()` and `populateOrgConducting()` over this Sunday's
    month so it picks up a conductor and its organization rows.

#### Task 9: Repair-on-read must not fight the new rule
**File:** `lib/calendar/queries.ts` (modify)
**Action:** Narrow `ensureMonthGenerated()`'s repair test.
**Details:**
- `needsConducting` becomes
  `existing.some(sunday => holdsSacramentMeeting(sunday.type) && sunday.conductingUserId === null)`.
- **Say why in a comment.** A cancelled Sunday is now legitimately null forever; the un-narrowed test
  would re-run `populateConducting()` and `populateOrgConducting()` on every single page view of
  every month containing general conference — two write passes during a GET render, twice a year,
  permanently. Exactly the class of bug `calendar-c`'s retro is about.
- `needsFastSunday` is unchanged: it reads `FAST_SUNDAY_DISPLACING_TYPES`, whose meaning did not
  change, and the deliberately-narrow condition still holds.

#### Task 10: The forward re-shift
**File:** `lib/calendar/queries.ts` (modify)
**Action:** Compute the re-shift once, warn from it, apply exactly it.
**Details:**
- ```ts
  type ConductingReshift = { sundayId: string; date: DateOnly; userId: string | null };
  type OrgConductingReshift = ConductingReshift & { orgId: string };

  async function planConductingReshift(
    supabase, wardId,
    editedDate: DateOnly,
    projectedTypes: ReadonlyMap<DateOnly, SundayType>,
    today: DateOnly,
  ): Promise<{ sacrament: ConductingReshift[]; organizations: OrgConductingReshift[] }>
  ```
- **Horizon:** stored Sundays whose date is `> editedDate` **and** `>= today`. The second half is
  Decision 2's "the past is never rewritten" — who conducted last March stays what it says.
- Build the series with the projected type applied, recompute each Sunday's conductor from its own
  active rotation set, and return **only** the rows whose recomputed value differs from the stored
  one. Same for each organization's rows against `sunday_org_conducting`.
- `today` is a **parameter**, defaulted at the call boundary in `updateSunday()`'s `opts`, never
  `new Date()` inside the function — the convention `lib/calendar/dates.ts` sets for every
  month helper, and what makes this testable without freezing a clock.
- In `updateSunday()`:
  - Compute the plan **before** any write, alongside the existing `atRisk` assessment, using the
    projected type. The count that warns and the rows that change then come from one computation —
    the same discipline the existing code cites as Pitfall 4.
  - Extend `CalendarChangeReason` with `"conducting_reshuffled"` and add
    `conductingReshiftCount` / `orgConductingReshiftCount` to `CalendarChangeWarning`.
  - The confirmation gate becomes `counted.length > 0 || reshiftTotal > 0`.
  - `buildWarningMessage()` — when there is a re-shift, **append a sentence to whichever warning is
    shown** rather than queueing a second warning: "Who conducts will also change on N later
    Sundays." plus an organization clause when those rows change too. The existing code shows one
    warning at a time because confirming applies the whole patch; a re-shift the user was not told
    about would break that promise. When the re-shift is the *only* consequence, it stands alone
    under the new reason.
  - Apply the stored plan after the UPDATE and after `resolveMonth()`. Batch the sacrament writes by
    user id, the way `populateConducting()` already does.
  - Return the two counts in `UpdateSundayResult`'s `applied` branch.

#### Task 11: Routes
**Files:** `app/api/sundays/[id]/route.ts`, `app/api/sundays/[id]/org-conducting/route.ts` (modify)
**Details:**
- `PATCH /api/sundays/[id]` — add `conductingReshiftCount` and `orgConductingReshiftCount` to the
  `writeAuditLog` detail and to the JSON response. No change to the 409 shape; the new fields ride
  inside `warning`.
- `PATCH /api/sundays/[id]/org-conducting` — after `getSunday()`, refuse when
  `!holdsSacramentMeeting(sunday.type)`: **409** with a sentence naming the reason, e.g.
  `"That Sunday holds no meeting, so no organization conducts."` A 403 would be wrong — the caller's
  permissions are fine, the Sunday's state is what refuses. This is the enforcement Decision 3 chose
  over a trigger; it is not optional.

### ITER-002 Tasks — the UI

#### Task 12: "No meeting" wherever a conductor is shown
**Files:** `components/calendar/ConductingLabel.tsx`, `SundayCell.tsx`, `SundayCard.tsx`,
`app/(app)/calendar/sunday/[id]/page.tsx`, `OrgConductingEditor.tsx` (modify)
**Details:**
- `ConductingLabel` gains `holdsMeeting: boolean` — **required**. When false it renders
  `<span className="text-muted">No meeting</span>` and ignores the id entirely. Comment: "Not set"
  and "No meeting" are different facts, and rendering the first for the second is the ambiguity
  ITER-002 exists to remove.
- `SundayCell` and `SundayCard` pass `holdsMeeting={holdsSacramentMeeting(sunday.type)}`. Do not
  touch `ReservedRegions` or its props — Phase 4's contract.
- The detail page passes the same for the Conducting row.
- `OrgConductingEditor` gains `holdsMeeting: boolean`. When false, **every** row renders read-only
  through `ConductingLabel` with no select and no Save button — there is no block that day at all,
  and a disabled control that reads as an outstanding task is the pattern talks-b already rejected
  (ITER-004's waived contact stages). Import `holdsSacramentMeeting` from `types/domain.ts` only;
  this is a client component and `lib/calendar/queries.ts` is server-only
  (plans/retros/roster-b-picker-and-orgs.md).

### ITER-003 Tasks

#### Task 13: The ward conference badge
**File:** `components/calendar/SundayTypeBadge.tsx` (modify)
**Action:** Add the `ward_conference` entry to the `CLASSES` record.
**Details:**
- Use `border-primary bg-surface text-primary` — visually distinct from the two `warning` types,
  which now form the no-meeting group, and distinct from `fast_sunday`, which adds `font-semibold`.
  Theme tokens only; a hardcoded hex breaks dark mode (conventions.md §Styling).
- Verify contrast by eye in both themes during scenario 015, as scenario 010 did.

#### Task 14: Confirm the rest of ITER-003 needs no code
**Action:** Verification task, not an edit. After Tasks 1–13, confirm by reading — and by the tests
in the next section — that `ward_conference`:
- displaces Fast Sunday, because it is in `FAST_SUNDAY_DISPLACING_TYPES` and
  `resolveFastSunday()` was not changed;
- gets a conductor and spends its turn, because `holdsSacramentMeeting("ward_conference")` is true;
- keeps normal speaking slots, via Task 8's restore path;
- leaves organization conducting untouched, because nothing about that path reads the type except
  the no-meeting skip.

`generateSundays()` deliberately does **not** predict ward conference: unlike general conference it
has no fixed date, and the stake schedules it (ITER-003 §Scope Notes).

**Explicitly out of scope, hand to Phase 6** (`plans/06-program-music.md`): how ward conference
renders on the program, and whether `presiding_override` should default for it given the stake
president usually presides. Do **not** prefill `presiding_override` in this change — the bishopric
can type it, and guessing a default here would put a Phase 6 product decision in a Phase 3 file.
Add both to `plans/06-program-music.md` as open questions.

---

## Testing Strategy

Per CLAUDE.md §8, in priority order. New and changed files:

**Pure logic (cheapest, highest density — write these first)**
- `tests/lib/meetingSeries.test.ts` — **create.** A stored type wins over the prediction; a gap month
  contributes its predicted general conference and nothing else; a bishopric that cleared a predicted
  general conference is respected; the range is inclusive at both ends.
- `tests/lib/conductingSkip.test.ts` — **create.** The heart of ITER-002:
  - weekly — a cancelled Sunday does not advance the cycle, and the person it would have spent
    conducts the next real meeting;
  - weekly — two cancelled Sundays in a row;
  - monthly — one cancelled Sunday inside a month changes nothing;
  - monthly — a wholly dead month is skipped (Decision 1);
  - the target Sunday itself holds no meeting → `null`;
  - **the gap test**: resolving December with August–November un-generated gives the same answer as
    resolving it with every month present. This is the one that fails if anyone replaces
    `buildMeetingSeries()`'s prediction fallback with a plain walk over stored rows;
  - a series that does not cover the anchor throws.
- `tests/lib/fastSunday.test.ts` — **modify.** `ward_conference` displaces; `holiday` still
  displaces; a month of nothing but displacing types still returns `null`.
- `tests/lib/generateSundays.test.ts` — **modify.** A generated general conference gets 0 slots via
  the predicate; a `ward_conference` is never predicted.
- `tests/lib/rotationCadence.test.ts`, `tests/lib/conductingRotation.test.ts` — **modify.** Every
  existing call gains a series argument. Where a test's intent is "no cancellations", pass an
  all-meeting series so the existing assertions keep their meaning rather than being retuned.
- `tests/lib/sundayTypeLists.test.ts` — **create.** Table-driven over `SUNDAY_TYPES`: every type
  declares both answers, `holiday` holds a meeting and cannot be fast, `ward_conference` holds a
  meeting and cannot be fast, `special` holds a meeting and *can* be fast, and the two
  no-meeting types are exactly `stake_conference` and `general_conference`. **This is the test that
  makes adding a future type a decision rather than a default.**

**Database / RLS**
- `tests/db/fast-sunday-collision.test.ts` — **modify.** A `holiday` edit no longer produces a
  `meeting_cancelled` warning; a `ward_conference` edit on the first Sunday moves Fast Sunday to the
  second and does not warn about the meeting.
- `tests/db/no-meeting-sundays.test.ts` — **create.** The CHECK refuses a conductor on a
  `stake_conference` row (assert the raised error — an INSERT/UPDATE violating a CHECK *does* raise,
  unlike an RLS refusal); `updateSunday()` clearing the conductor in the same statement succeeds;
  `sunday_org_conducting` rows are gone afterwards.
- `tests/db/calendar-generation.test.ts` — **modify.** Generating a range covering April or October
  leaves the general conference Sunday with no conductor, no organization rows, and 0 slots, and the
  next Sunday holds the turn the conference would have spent.
- `tests/db/conducting-reshift.test.ts` — **create.** Marking a Sunday `stake_conference` re-resolves
  later Sundays; **past Sundays are untouched**; the count in the 409 warning equals the number of
  rows the confirmed write actually changes; a re-shift with `confirm` absent writes nothing at all.

**Route handlers** — use `tests/helpers/routeClient.ts`; read its header comment first for the
`vi.mock` hoisting trap. `params` is a Promise. Assert a refused write by **re-reading the row** with
the service client.
- `tests/routes/sunday-update.test.ts` — **create.** 409 shape and message for the combined
  assignments-plus-re-shift case; the audit row carries both counts.
- `tests/routes/org-conducting.test.ts` — **create.** 409 on a cancelled Sunday, and the row still
  absent afterwards.

**Components**
- `tests/components/calendar/SundayCell.test.tsx` — **modify.** Add `ward_conference` → "Ward
  Conference" to the badge table; a cancelled Sunday renders "No meeting" and **not** "Not set".
- `tests/components/calendar/ConductingLabel.test.tsx` — **create.** The three states — a name, "Not
  set", "No meeting" — and that an unknown uuid still never reaches the screen.

Not tested: badge colour values. A hex is not a behaviour; contrast is checked by eye in both themes
during the walkthrough, as `calendar-b` established.

## Test Scenarios (Harness)

One scenario, not two. The whole point of GROUP-01 is that the two items are one body of work, and a
walkthrough that sets a ward conference *and* a stake conference in the same month is the only thing
that shows the two lists really did come apart.

### Scenario 015: Sundays with no meeting, and ward conference
**Tags:** `calendar`, `full`, `rotation`, `sunday-types`
**Purpose:** Prove on screen that a cancelled Sunday reads "No meeting" and costs nobody a turn,
while a ward conference on the same page keeps its conductor and its speakers and pushes Fast Sunday
a week. Seeding matters because the interesting month needs a *past* rotation anchor, a hand-set
stake conference, and assignments already in the pipeline — none of which a tester can set up in
under ten minutes by hand, and the assignments are what make the 409 warning appear at all.

**Seed data summary:**
- Ward — Harness Test Ward (`ensureTestWard`)
- Users — `bishop` (Mark Andersen); `counselor1` (position 1, Peter Nakamura); `counselor2`
  (position 2, Daniel Okafor); `eqpres` (org_president, Elders Quorum, Tomas Ruiz); `secretary`
  (ward_secretary, holds `calendar.manage` but no org rotation rights)
- Conducting rotation — bishopric, **weekly** cadence, `effective_from` two months before the target
  month, so the skip is visible as a shift rather than as a no-op. A second scenario part flips the
  ward to monthly to show one cancelled Sunday changing nothing.
- Elders Quorum rotation — weekly, same anchor, so the organization skip can be seen independently
- Sundays — **November 2027**: five Sundays, opening on a Monday. Seeded types: the 1st Sunday
  `ward_conference`, the 3rd `stake_conference`, the rest `standard`. October 2027 generated
  normally so its general conference is present and the anchor month is real.
- Assignments — two speakers on the `stake_conference` Sunday, at stage `request`, so the 409
  warning has something to count and the revert-to-`plan` can be verified

**Tester action:** Sign in as the bishop, open `/calendar?month=2027-11` (name the month in the URL
explicitly — scenario 014's walkthrough showed that "open the calendar" lands on the current month
and reads as a failure). Read the grid. Open the ward conference Sunday, then the stake conference
Sunday. Change a standard Sunday to `holiday`, then to `stake_conference`, confirming the warning.
Then sign in as `eqpres` and check the Elders Quorum rows.

**Verification checklist:**
- [ ] The 3rd Sunday's cell reads **"No meeting"**, not "Not set" and not a blank
- [ ] The 1st Sunday shows the **Ward Conference** badge and a conductor's name
- [ ] Fast Sunday is on the **2nd** Sunday, not the 1st
- [ ] The ward conference Sunday shows its normal speaking slots and its speakers
- [ ] Counting the conductors across the five Sundays, **nobody's turn is spent** on the 3rd — the
      4th Sunday holds the name the 3rd would have had
- [ ] October's general conference Sunday also reads "No meeting" with no conductor
- [ ] The stake conference Sunday's **Organization meetings** card shows "No meeting" for every
      organization, with no select and no Save button
- [ ] Changing a standard Sunday to **holiday** produces **no** "would no longer hold a sacrament
      meeting" warning, and the Sunday keeps its conductor and its slots
- [ ] Changing a standard Sunday to **stake conference** produces a 409 dialog naming both the
      speakers at risk **and** the number of later Sundays whose conductor changes
- [ ] Confirming reverts those assignments to **plan** (not deleted) and the later Sundays' names
      shift by exactly the number the dialog promised
- [ ] Sundays **before today** kept their conductors after the confirm
- [ ] As `eqpres`, the Elders Quorum rotation skips the cancelled Sunday the same way
- [ ] Both themes: the Ward Conference badge is legible and distinguishable from the conference
      badges at 375px
- [ ] Re-run part 2 with the rotation set to **monthly**: one cancelled Sunday inside the month
      changes nobody

Then run `npm run manifest` to regenerate `testing/scenarios/manifest.json`.

## Validation Commands

```bash
# Schema first — the tests need migration 027 applied to the linked hosted project
npm run db:push
npm run db:types      # expect no diff; sundays.type is text with a CHECK, not an enum

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests
npm run test

# Production build — catches the server-only import that lint and typecheck both pass
npm run build

# Harness
npm run seed -- scenario-015-no-meeting-sundays
npm run manifest
```

## Integration Notes

- **Migration 027 changes data on the shared hosted project.** It clears conductors, deletes
  organization conducting rows, zeroes speaking slots, and reverts assignments to `plan` on every
  existing stake- and general-conference Sunday. Read the `raise notice` counts. There is no local
  stack to rehearse against (CLAUDE.md §9), and `npm run db:reset` wipes the hosted database — do not
  reach for it.
- **`resolveConductingUser()`'s signature change is intentionally breaking.** Every caller must
  supply the meeting history; a defaulted parameter is precisely how ITER-005 happened. The compiler
  produces the worklist.
- **A per-Sunday conducting override can be overwritten by the re-shift** (Decision 2). Accepted,
  warned about on screen, and recorded as a known gap in the retro. The fix is a
  `conducting_source` column, which is not this change.
- **`sunday_org_conducting` is guarded in TypeScript, not in SQL** (Decision 3). The asymmetry with
  `sundays`' CHECK is deliberate and documented in the migration. If a later phase adds trigger
  machinery for another reason, this is a candidate to fold in.
- **Phase 4 contract is untouched.** `SundayCell`/`SundayCard`'s three reserved regions, their props,
  and the nine stage tokens are not modified.
- **Hand two questions to Phase 6** in `plans/06-program-music.md`: how ward conference renders on the
  program, and whether `presiding_override` should default for it.
- **Update `plans/03-calendar.md`** with the split, the skip rule for both cadences, the re-shift
  decision and its override caveat, and the fact that the whole-month generation transaction is still
  the open structural fix `calendar-c` recorded.
