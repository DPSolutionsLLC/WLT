# Phase 3 — Sunday Calendar & Conducting Rotation

The month view every planning module hangs off. Small phase, but it is the spine of
Phases 4, 6, and 10.

**Depends on:** Phase 2. **Unlocks:** Phases 4, 6, 10.
**Reference:** [FEATURES.md](../FEATURES.md) §Module 2; [SPEC.md](../SPEC.md) §API Routes → Sunday Calendar.

---

## Goals

1. Sunday records auto-generated ahead of time, editable by the bishopric
2. Conducting rotation that auto-populates and stays editable
3. A monthly calendar view that later phases decorate with pipeline status

---

## Step 1 — Sunday Generation

Sundays should exist before anyone plans against them. Two mechanisms:

- **On demand:** when the calendar loads a month with no Sunday rows, generate them
- **Scheduled:** a Supabase Edge Function keeps 12 months of Sundays ahead

Generation rules:

- Every Sunday date in range gets a row with `type = 'standard'`, `speaking_slots = 3`
- Apply the Fast Sunday resolution rule (Step 2) to each generated month
- General Conference (first weekend of April and October) — pre-mark as
  `general_conference`, since it is predictable and it *shifts Fast Sunday*
- Never overwrite an existing row. Generation is `INSERT ... ON CONFLICT DO NOTHING`

`lib/calendar/generateSundays.ts` is a pure function taking a date range and returning
rows, so it is trivially testable. The route and the cron both call it.

---

## Step 2 — Fast Sunday Resolution

Fast Sunday is **the first Sunday of the month that is not displaced by a conference.**

```
Fast Sunday = the earliest Sunday in the month whose type is NOT
              stake_conference, general_conference, holiday, or ward_conference
```

> **Updated by ITER-002 / ITER-003 (migration 027).** This rule used to be stated with one
> list, and that list was also read as "which Sundays hold no sacrament meeting". Those are
> two different questions and they are now two named lists in `types/domain.ts`. See
> **§Sunday types — the two questions** below before touching either.

Normally that is the first Sunday. When a stake conference or general conference falls on
the first Sunday, Fast Sunday moves to the **following** Sunday. General Conference in
April and October triggers this predictably, twice a year.

`lib/calendar/resolveFastSunday.ts` — pure function:

```ts
export function resolveFastSunday(monthSundays: Sunday[]): string | null
```

Returns the `sunday_id` that should be `fast_sunday`, or `null` if every Sunday in the
month is displaced.

**This is a resolution rule, not a generation-time constant.** The bishopric can mark a
Sunday as stake conference weeks after the calendar was generated, and Fast Sunday must
move in response. So the rule re-runs whenever a Sunday's `type` changes:

| Trigger | Action |
|---|---|
| Month generated | Resolve and set `fast_sunday` |
| A Sunday's type set to a displacing type | Re-resolve that month |
| A Sunday's type cleared back to `standard` | Re-resolve that month — Fast Sunday may move back earlier |
| A Sunday manually set to `fast_sunday` | Clear any other `fast_sunday` in that month; treat as a pinned override |

**Setting `fast_sunday` sets `speaking_slots = 0`; clearing it restores the default of 3.**

**Guard against silently discarding work.** If re-resolution would move Fast Sunday onto a
Sunday that already has assignments or prayers, do **not** apply it silently — zeroing the
speaking slots would orphan planned speakers. Return a warning and require confirmation:

> Marking March 2 as Stake Conference moves Fast Sunday to March 9, which currently has
> 3 speakers assigned. Continue?

On confirmation, move the assignments back to `plan` stage rather than deleting them, and
notify the planner. The bishopric can also pin Fast Sunday manually to override the rule
entirely — the pin wins until it is cleared.

---

## Step 3 — Conducting Rotation

`conducting_rotation` holds position 1/2/3 → user, with `effective_from`.

```ts
export function resolveConductingUser(
  sundayDate: Date, rotation: RotationEntry[], anchorDate: Date
): string
```

Default cycle: Bishop → 1st Counselor → 2nd Counselor, advancing one step per Sunday.
Compute from an anchor date and the count of Sundays elapsed, so it is deterministic and
does not depend on prior rows being correct.

> **Corrected by `calendar-c` (2026-08-19).** The weekly cycle above is the DEFAULT, not the only
> rule. A rotation carries a **cadence** — `weekly` or `monthly` — on every row
> (migration 024, Part 1). Monthly advances one step per calendar month, so one bishopric member
> takes every Sunday in a month, anchored on the month containing `effective_from`. Scenario 010's
> walkthrough found that monthly is how this ward actually runs; the requirement had never been
> written down, and no test could have caught it because the code matched this spec exactly.
>
> The same machinery, at either cadence, now serves the six organizations with a presidency:
> `conducting_rotation.org_id` is NULL for the bishopric's sacrament-meeting rotation and a
> uuid for an organization's own (migration 024, Part 2). Who conducts an organization's meeting
> on one Sunday is stored in `sunday_org_conducting`, by the same stored-not-computed rule the
> next paragraph gives for sacrament conducting.

**Every Sunday's `conducting_user_id` is stored, not computed at read time.** Auto-populate
it on generation, then let the bishopric override any individual Sunday. A computed value
would silently rewrite history when the rotation changes.

Rules:

- Any bishopric member can edit any Sunday's conducting assignment
- Any bishopric member can reorder the rotation itself
- **Both actions notify the other two** — `admin_setting_changed`
- Changing the rotation does **not** retroactively rewrite Sundays already assigned; it
  applies from `effective_from` forward. Say so in the UI
- **The same is true of the cadence.** Changing it INSERTS a new set of rows rather than
  updating the old one, so forward-only is true by construction and not by a second mechanism
  (`calendar-c` Decision 1). The UI sentence names the cadence as well as the order
- An **organization presidency** manages their own rotation and nobody else's, under the new
  `calendar.manage_org_conducting` permission — narrowed to their own organization by RLS
  (migration 024, Parts 5 and 6) and by `lib/calendar/orgRotationScope.ts`. Changes notify the
  rest of that presidency — `org_conducting_rotation_changed`

---

## Step 4 — API Routes

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/sundays` | GET | Any authenticated | List Sundays in a range. Returns type, notes, conducting, slot config |
| `/api/sundays` | POST | Bishopric | Create a Sunday (or generate a range) |
| `/api/sundays/[id]` | PATCH | Bishopric | Update type, notes, conducting, slots, presiding override |
| `/api/conducting-rotation` | GET | Any authenticated | Current rotation order |
| `/api/conducting-rotation` | PATCH | Bishopric | Reorder. Notifies other bishopric |

The GET routes are readable by all authenticated users — the music coordinator, secretary,
and executive secretary all need the upcoming Sunday list. Only mutations are bishopric-only.

**`PATCH /api/sundays/[id]` re-resolves Fast Sunday for the month whenever `type` changes.**
If the re-resolution would land on a Sunday with existing assignments, the route returns
`409` with the warning payload instead of applying; the client confirms and retries with
`?confirm=true`. This is the one route in the phase with non-obvious side effects — keep
the resolution call in the data layer so it cannot be bypassed by a future caller.

`slot_config` is `jsonb`: an array of `{ slot_number, length_minutes, type }`. Validate
its shape with Zod on write; a malformed blob breaks the program builder in Phase 6.

---

## Step 5 — Calendar View

`/calendar` — monthly grid.

Each Sunday cell shows:

- Date and type badge (Standard / Fast / Stake Conference / Conference / Holiday / Special)
- Conducting counselor
- Notes, if any (e.g. "High Council Visit")
- Placeholder regions for pipeline status, speaker names, and goal alerts — Phase 4 fills
  these. Design the cell now to accommodate them so the layout does not get rebuilt

Colour-coding by pipeline stage comes in Phase 4. Define the colour tokens here in the
Tailwind config so both phases use the same scale, and make sure the palette is legible
in both light and dark mode.

**Mobile:** a month grid at 375px is unusable. Render a vertical list of Sunday cards on
small screens and the grid at `md:` and up. Same data, two layouts.

Clicking a Sunday opens its detail — a stub in this phase, the assignment detail page in
Phase 4.

---

## Tests

| Test | Asserts |
|---|---|
| `generate-sundays.test.ts` | Correct Sundays for a range across month and year boundaries; DST weeks handled |
| `generate-idempotent.test.ts` | Re-running generation over an existing range changes nothing |
| `fast-sunday-default.test.ts` | With no conferences, the first Sunday is fast and has 0 speaking slots |
| `fast-sunday-shift.test.ts` | Stake conference on the first Sunday moves fast to the second; general conference in April and October does the same. **Highest priority in this phase** |
| `fast-sunday-reresolve.test.ts` | Marking the first Sunday as conference *after* generation moves fast forward; clearing it back moves fast earlier again |
| `fast-sunday-collision.test.ts` | Re-resolution onto a Sunday with assignments returns 409 rather than zeroing slots; on confirm, assignments revert to `plan` and the planner is notified |
| `fast-sunday-pinned.test.ts` | A manual `fast_sunday` override survives re-resolution until cleared, and clears any other fast Sunday that month |
| `conducting-rotation.test.ts` | Rotation cycles 1→2→3→1 across weeks; a mid-range rotation change applies forward only |
| `slot-config.test.ts` | Malformed `slot_config` is rejected by the PATCH route |
| `calendar-read-access.test.ts` | Music coordinator and secretary can GET Sundays; only bishopric can PATCH |

---

## Definition of Done

- [x] Sundays auto-generate for 12 months ahead and on demand — on demand via
      `ensureMonthGenerated()`, twelve months via the explicit bishopric range action. The
      scheduled Edge Function is deferred (Deviation 1)
- [x] Generation is idempotent and never overwrites edits
- [x] Fast Sunday resolves to the first non-displaced Sunday, and **re-resolves** when a
      Sunday's type changes after generation
- [x] April and October pre-marked as general conference, with Fast Sunday shifted
- [x] Re-resolution onto a Sunday with assignments warns and confirms rather than
      silently zeroing speaking slots
- [x] Conducting auto-populates from the rotation and is editable per Sunday
- [x] Editing conducting or the rotation notifies the other two bishopric members
- [x] Calendar renders as a grid on desktop and a card list on mobile, light and dark
      — built in `calendar-b`, confirmed by scenario 010
- [x] All authenticated roles can read the calendar; only bishopric can write —
      `calendar.view` gates reading, `calendar.manage` and `admin.manage_ward` gate the two kinds
      of write (Deviation 5)
- [x] Pipeline-status and colour tokens are defined and ready for Phase 4
- [x] All ten tests in the Tests table pass

### Correction — the colour tokens are CSS, not a Tailwind config

Step 5 asks for the pipeline-stage colours to be "defined in the Tailwind config". There is no
`tailwind.config.ts` in this project and there will not be one: this is Tailwind v4, whose theme is
CSS-first. The nine tokens live in `app/globals.css` as `--stage-<name>` in both `:root` and
`.dark`, mapped into utilities through `@theme inline` as `--color-stage-<name>`.

The **names** match `PIPELINE_STAGES` in `types/domain.ts` exactly and are the contract between
Phase 3 and Phase 4. The hex values are not — Phase 4 owns the semantics and may retune them.
`PIPELINE_STAGE_LABELS` sits beside `PIPELINE_STAGES` for the same reason.

Nothing in Phase 3 renders a stage colour. Defining them now is what stops Phase 4 rebuilding the
Sunday cell to fit a palette that did not exist when the cell was designed.

### Scenario 010 — results

`testing/scenarios/calendar/scenario-010-fast-sunday-shift`, 46 checks.

**Walked 2026-08-19. No code defects found.** The Fast Sunday collision path behaved as specified in
both directions, the three assignments survived at `pipeline_stage = 'plan'` rather than being
deleted, and the permission seats each saw what they should.

Two things the walkthrough surfaced that were not code defects:

1. **A rotation change does not rewrite Sundays that already have a conductor**, contrary to what
   `calendar-b`'s plan expected. `conducting_user_id` is stored, not computed (Step 3), and
   `populateConducting()` only fills rows that are still null — so a new rotation reaches months
   generated after its effective date. That is exactly what the forward-only sentence promises.
   The scenario's checklist was corrected to observe April rather than the second half of March,
   which is the better check because it exercises generation and the new anchor together.

2. **The rotation cadence is wrong for this ward, and the requirement was never written down.**
   Step 3 specifies a rotation advancing one step per *Sunday*, and that is what shipped. The ward
   actually rotates conducting **month by month** — one bishopric member takes every Sunday in a
   month. This is a product requirement that no test could have caught, because the code does
   correctly what the spec asked for. It is the kind of finding a walkthrough exists for.

   Organization presidencies want the same thing for their own Sunday meetings, independently of
   sacrament meeting. Both land in `plans/calendar-c-rotation-cadence.md` — they need a migration
   (a cadence column, an organization column, and per-Sunday org conducting), so neither is a patch
   to `calendar-b`.

### Scenario 011 — results

`testing/scenarios/calendar/scenario-011-rotation-cadence`, 37 checks.

**Not yet walked.** The implementation is complete and every automated check passes:
migration 024 is applied to the linked project, `types/database.ts` is regenerated, and
`npm run lint`, `npm run typecheck`, `npm run test` (650 tests, 49 files) and `npm run build`
all pass. `tests/rls/org-conducting.test.ts` runs green against the hosted project, so the
policy boundary is proven from the database side before anyone opens a browser. Record the
walkthrough results here when it is walked.

**Defect found during the walkthrough, and fixed.** Every month except the seeded one showed
"Not set" for every Sunday. The cause was not the cadence work: `generateSundayRange()` inserts
the Sunday rows and assigns conductors in two separate statements, and supabase-js has no
transaction API, so the error the tester hit while migration 024 was still unapplied left the rows
behind with no conductor. `ensureMonthGenerated()` then returned early on "this month has rows",
which made the damage permanent — nothing in the UI could repair it, and no test covered the
state because no test had ever produced it.

The abort is routine, not exotic: Next.js prefetches the prev/next month links in
`MonthNavigation`, so opening one month executes the neighbouring months' server render, and a
cancelled prefetch abandons the write partway. Months the tester never visited were left
half-built.

`ensureMonthGenerated()` now repairs both halves of the wreckage:

- **Conductors** — filled whenever any Sunday in the month has none. Safe on a read because both
  passes only fill gaps: `populateConducting()` touches nulls, `populateOrgConducting()` inserts
  with `ignoreDuplicates`, so neither can overwrite a conductor a human set.
- **Fast Sunday** — re-resolved only when the month has none AND at least one Sunday could be
  one. That combination is unreachable by any legitimate edit, because `generateSundays()` always
  picks one unless every Sunday is displaced and `updateSunday()` re-resolves on every type
  change. A month that genuinely has none — a stake conference weekend — fails the second half of
  the condition and is left alone, which is what stops this re-running an RPC on every page view.

Four regression tests in `tests/db/calendar-generation.test.ts` pin it, in their own `describe`
on dedicated months: the rest of that file shares one calendar and inherits state in order, so a
repair test that mutated those months would break its neighbours.

**The real fix is a transaction, and this is not one.** `generateSundayRange()` still performs
three separate writes with no atomicity, because @supabase/supabase-js has no transaction API.
Repair-on-read makes the damage self-healing rather than permanent; it does not make generation
atomic. A plpgsql function in the shape of `apply_fast_sunday()` would — record it as the honest
fix if this recurs.

**Known gap carried forward from this slice.** Switching the cadence does not re-populate a month
that is already generated, by design — `conducting_user_id` is stored and `populateConducting()`
only fills rows that are still null. A ward that switches to monthly and then looks at an
already-generated next month sees the old weekly assignment and may read it as a bug. The honest
fix is a "re-apply the rotation to this month" action that clears and re-populates, which is its
own decision about destroying overrides. Scenario 011's Notes say so; it is not built here.

---

## Deviations recorded during implementation

Five places where `plans/calendar-a-rules-and-api.md` deliberately departs from this file or
from SPEC.md. Each was decided before implementation, not discovered after. See that plan's
"Decisions Already Made" for the full reasoning.

1. **The scheduled Edge Function is deferred, not built.** Step 1 asks for a Supabase Edge
   Function keeping 12 months of Sundays ahead. There is no `supabase/functions/` directory and
   no cron infrastructure in this repo, and the on-demand path makes the job redundancy rather
   than a requirement: nobody can view a month whose Sundays do not exist, because loading the
   month generates them (`ensureMonthGenerated`). Shipped as on-demand generation plus an
   explicit bishopric "generate a range" action; the cron is a known gap.

2. **`sundays.fast_sunday_pinned` is a new column (migration 023).** A manual override has to
   survive re-resolution, and `type` alone cannot record one: generation itself writes
   `type = 'fast_sunday'` on the Sunday the rule chose, so every month would read as pinned.

3. **The Fast Sunday rule stays in TypeScript; only the write is SQL.**
   `resolveFastSunday()` decides which Sunday, and `apply_fast_sunday()` (migration 023)
   applies it in one transaction. Putting the rule in plpgsql too would put it in two
   languages — the drift `buildImportPreview.ts` was written to avoid.

4. **The collision check blocks on assignments, not on prayers.** Step 2 says warn when the
   incoming Sunday "already has assignments or prayers". A fast Sunday still has an invocation
   and a benediction, so prayers are not orphaned by `speaking_slots = 0` — speakers are.
   `prayerCount` is reported in the warning for context and only `assignmentCount > 0` blocks.

5. **Mutation auth is `calendar.manage`; rotation reorder is `admin.manage_ward`.** The route
   table in this file says "Bishopric" for every mutation, but `lib/auth/permissions.ts`
   already grants `calendar.manage` to `ward_secretary`, and maintaining the Sunday calendar is
   exactly a secretary's job. The permission matrix is the source of truth (CLAUDE.md §7).
   Reordering the rotation is different — it is a bishopric composition decision that notifies
   the other two — so it uses `admin.manage_ward`, which only `bishop` and `counselor` hold.

**Signature deviation.** Step 3 types `resolveConductingUser()`'s parameters as `Date` and its
return as `string`. Both are `DateOnly` (`YYYY-MM-DD`) strings instead, per the timezone pitfall
below, and the return is nullable because a ward with no configured rotation must render a
calendar rather than throw.

**Speaking slots are per-Sunday and capped at 15.** `MAX_SPEAKING_SLOTS` in
`lib/validation/calendar.ts` is the only ceiling — the database requires nothing beyond
`speaking_slots >= 0`. A testimony-style meeting or a farewell with the whole family speaking is
a real Sunday, and the bishopric sets the count themselves. `calendar-b`'s Sunday editor must
expose this as a free number input, not a three-option select.

**The default speaker count is a WARD SETTING, not a constant.** Stored at
`wards.settings.default_speaking_slots` (jsonb — no migration), read by
`lib/calendar/wardCalendarSettings.ts` and written through
`PATCH /api/ward-settings/calendar` under `admin.manage_ward`. `apply_fast_sunday()` reads the
same key in SQL when it restores a Sunday that stops being fast, so the TypeScript and the
plpgsql halves must stay in step — `tests/db/calendar-generation.test.ts` asserts both.

Both readers fall back to 3 on a missing, malformed or out-of-range value rather than throwing,
following `mergeRoleAccess()` in `lib/auth/permissions.ts`. A bad setting must not be able to
break a calendar edit.

**Applies forward only.** Changing the default affects Sundays generated afterwards; it never
rewrites Sundays already on the calendar, which may already carry assignments. This matches the
conducting rotation's own forward-only rule. The API returns the sentence that says so, and
`calendar-b` renders it verbatim.

**UI lands in two places, one route.** `calendar-b` Task 6b puts the control on the calendar
page; Phase 11's admin settings page reads and writes the same route. Do not duplicate the rule.

**Future update — a hand-set slot count does not survive a Fast Sunday round trip.**
`apply_fast_sunday()` restores the ward's default when a Sunday stops being Fast Sunday
(migration 023 documents this, and Step 2 above asks for it). So a Sunday hand-set to 15, which
then becomes Fast Sunday and later stops being one, comes back as the ward default rather than
15 — that one edit is silently discarded. Acceptable today because the sequence is rare and the
restore is what makes re-resolution predictable. The fix, when it is worth doing, is a
remembered pre-fast value on the row; it is a migration, so it belongs in its own slice.

**Known gap handed to Phase 4.** `apply_fast_sunday()` reverts affected assignments to `plan`.
This file asks for a notification to the planner when that happens, and there is no trigger key
for it in `supabase/seed/notification_triggers.sql`. Recorded rather than inventing a key that
fires into nothing.

---

## Pitfalls

- **Timezone drift.** `sundays.date` is a `date`, not a `timestamptz`. Constructing it
  from `new Date()` in a browser west of UTC can land on Saturday. Do date math in UTC
  or with `date-fns` date-only helpers, and never round-trip through a local-time string.
- **`UNIQUE` on `date` alone.** Phase 0 fixes this to `(ward_id, date)`. If it was
  missed, a second ward cannot have the same Sunday. Verify before building on it.
- **Computing conducting at read time.** Store it. A computed value rewrites the past
  whenever the rotation changes.
- **Treating Fast Sunday as a generation-time constant.** It is a *resolution rule* that
  must re-run whenever a Sunday's type changes. A stake conference scheduled in February
  for the first Sunday in March has to move March's Fast Sunday — if the rule only ran at
  generation, it will not.
- **Silently zeroing speaking slots.** Moving Fast Sunday onto a Sunday that already has
  speakers orphans them. Warn, confirm, and revert the assignments to `plan` — never
  delete them.
- **Forgetting the reverse direction.** Clearing a conference designation must move Fast
  Sunday back *earlier*, not leave it where it shifted to.
- **Deleting a Sunday.** Assignments, prayers, hymns, and programs all reference it.
  Prefer `type = 'holiday'` over deletion; if a delete is genuinely needed, block it when
  dependent rows exist.
- **Reading one Sunday-type list for the other question.** `FAST_SUNDAY_DISPLACING_TYPES`
  answers "can this Sunday BE Fast Sunday". `holdsSacramentMeeting()` answers "is there a
  meeting at all". They used to be the same list, and the day they stopped being the same
  list is the day `holiday` started warning bishoprics that their speakers were being
  orphaned on a Sunday the ward still meets on. `tests/lib/sundayTypeLists.test.ts` forces
  every new type to answer both.

---

## Sunday types — the two questions

*Added by ITER-002 and ITER-003, migration 027. Both items are GROUP-01 and landed together.*

`FAST_SUNDAY_DISPLACING_TYPES` originally answered two questions at once, because the two
answers happened to coincide for every type that existed:

1. **Can this Sunday BE Fast Sunday?**
2. **Does this Sunday hold a sacrament meeting at all?**

`ward_conference` forced them apart from one side — it cannot be Fast Sunday, yet it holds a
completely ordinary meeting with a conductor, speakers and organization meetings. `holiday`
forced them apart from the other — a ward marking Christmas Sunday as a holiday still meets,
often with a shortened or music-focused service.

There are now two named lists in `types/domain.ts`, and **neither may be read for the other's
meaning**:

| List | Question | Members |
|---|---|---|
| `FAST_SUNDAY_DISPLACING_TYPES` | cannot BE Fast Sunday | `stake_conference`, `general_conference`, `holiday`, `ward_conference` |
| `NO_MEETING_SUNDAY_TYPES` | holds no sacrament meeting | `stake_conference`, `general_conference` |

Call sites read the predicate `holdsSacramentMeeting(type)`, not the array. The second list is
a strict subset of the first, and `tests/lib/sundayTypeLists.test.ts` is table-driven over
`SUNDAY_TYPES` so that adding a future type is a **decision** rather than a default.

### A Sunday with no meeting has no conductor

Enforced structurally. `sundays` carries a CHECK constraint
(`sundays_no_conductor_without_meeting`), so `updateSunday()` must clear `conducting_user_id`
in the **same UPDATE** that changes the type — a second statement raises, loudly and on
purpose.

`sunday_org_conducting` gets **no** equivalent constraint, and that was decided rather than
forgotten: a constraint there cannot see the Sunday's type, so it would have to be a trigger,
and this repo has no triggers at all. That rule lives in `lib/calendar/queries.ts` and in
`PATCH /api/sundays/[id]/org-conducting`, which refuses with a **409** — not a 403, because
the caller's permissions are fine and it is the Sunday's state that refuses.

An organization's row is **deleted**, never nulled, on a cancelled Sunday. A null `user_id`
already means "this organization's rotation reaches this Sunday but the position is unfilled"
(migration 024, Part 4), which is a different fact.

### The rotation skips a Sunday that holds no meeting

One rule with two projections, so the cadences cannot drift apart:

- **weekly** — count meeting-holding **Sundays** between the anchor and the target. A
  cancelled Sunday does not advance the cycle, so whoever it would have been spent on
  conducts the next real meeting.
- **monthly** — count **months containing at least one** meeting-holding Sunday. A month
  spends a turn unless *every* Sunday in it is cancelled, because under a monthly cadence one
  person already holds the whole month and there is no turn to skip.

`resolveConductingUser()` therefore takes the meeting history as a **required** fourth
argument. It is not defaulted, deliberately: a defaulted parameter is exactly how 25 call
sites came to silently ignore the ward's role access (`plans/retros/role-access-overrides.md`).

`lib/calendar/meetingSeries.ts` builds that history, and its **prediction fallback is the whole
point of the module**. Months are generated on demand, so skipping from August to December
leaves gaps; a walk over only the stored rows would count a gap as zero cancellations and then
store the wrong answer. The fallback is exactly right because an un-generated month cannot hold
a hand-set stake conference — the only cancellation possible there is general conference, which
is predictable from the date. A stored row always wins.

### Re-shifting applies forward, behind the existing confirm dialog

Marking a Sunday cancelled after its month was generated re-resolves who conducts on later
Sundays. Without it the skip would only ever work for general conference, which the app
predicts — never for stake conference, which is always hand-set after the fact and is the case
that started ITER-002.

- The horizon is Sundays **after the edited date AND on or after today**. **The past is never
  rewritten** — who conducted last March stays what it says, which is the doctrine
  `conducting_user_id` is a stored column for at all (Step 3).
- `today` is a parameter defaulted at the call boundary, never a `new Date()` inside the
  planner, so it is testable without freezing a clock.
- Only rows whose recomputed conductor **differs** are counted and written, from one
  computation — the count that warns and the rows that change cannot disagree.
- The warning sentence is **appended to whichever warning is shown** rather than queued as a
  second one, because confirming applies the whole patch.

> **Known gap, accepted.** A re-shift can overwrite a per-Sunday conducting override. Storage
> *is* the override — there is no `is_override` flag (migration 024) — so nothing in the data
> model distinguishes a conductor a human typed from one the rotation assigned. The mitigation
> is that the user is warned first with an exact count and nothing is written until they
> confirm. The fix is a `conducting_source` column; it is **not** in this change's scope and
> should not be added opportunistically.

### Still open

The whole-month generation transaction remains the structural fix `calendar-c` recorded:
`generateSundayRange()` still inserts, resolves and populates in separate statements because
`@supabase/supabase-js` has no transaction API, and `ensureMonthGenerated()` repairs the
result on a read. That repair test is now narrowed to meeting-holding Sundays — a cancelled
Sunday's conductor is legitimately null forever, and the un-narrowed test would re-run two
write passes on every page view of every month containing general conference.
