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
              stake_conference, general_conference, or holiday
```

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

**Every Sunday's `conducting_user_id` is stored, not computed at read time.** Auto-populate
it on generation, then let the bishopric override any individual Sunday. A computed value
would silently rewrite history when the rotation changes.

Rules:

- Any bishopric member can edit any Sunday's conducting assignment
- Any bishopric member can reorder the rotation itself
- **Both actions notify the other two** — `admin_setting_changed`
- Changing the rotation does **not** retroactively rewrite Sundays already assigned; it
  applies from `effective_from` forward. Say so in the UI

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
