---
id: calendar-a-rules-and-api
type: feature
iter: null
commits: ["6482ece"]
date: 2026-08-18
files:
  - supabase/migrations/023_calendar.sql
  - lib/calendar/dates.ts
  - lib/calendar/generateSundays.ts
  - lib/calendar/resolveFastSunday.ts
  - lib/calendar/resolveConductingUser.ts
  - lib/calendar/queries.ts
  - lib/calendar/wardCalendarSettings.ts
  - lib/validation/calendar.ts
  - app/api/sundays/route.ts
  - app/api/sundays/[id]/route.ts
  - app/api/conducting-rotation/route.ts
  - app/api/ward-settings/calendar/route.ts
  - types/domain.ts
related:
  - roster-c-csv-import
  - roster-a-data-and-pages
  - foundation-c-services
  - foundation-a-scaffold
---

## What was done

Everything Phase 3 needs beneath the UI: UTC date-only helpers, three pure resolution rules
(Sunday generation, Fast Sunday, conducting rotation), migration 023, the calendar data-access
module, and four API routes. Fast Sunday is implemented as a *resolution rule* that re-runs in
both directions whenever a Sunday's type changes, with a 409-and-confirm path when re-resolution
would land on a Sunday that already has speakers. No pages — `calendar-b` builds those.

Two things were added beyond the plan at the user's request: the per-Sunday speaking-slot cap was
raised from 10 to 15, and the *default* speaker count became a ward setting
(`wards.settings.default_speaking_slots`) editable through `PATCH /api/ward-settings/calendar`
rather than a constant in code.

## Key decisions

- **The rule is TypeScript, the write is SQL.** `resolveFastSunday()` decides which Sunday;
  `apply_fast_sunday()` (SECURITY INVOKER) clears and sets in one transaction. Putting the rule in
  plpgsql too would have put it in two languages — the drift `buildImportPreview.ts` was written
  to avoid.
- **`ignoreDuplicates: true` is the whole of idempotency.** `generateSundayRange` upserts with
  `ON CONFLICT DO NOTHING`; dropping that one option turns generation into an overwrite that
  discards every bishopric edit in the range.
- **The collision check runs before the patch, not after.** There is no transaction API to roll
  back, so `needs_confirmation` has to mean nothing was written. The blocking count and the
  quoted count come from one query — the shape of bug `roster-c` shipped twice.
- **The warning covers four ways work gets voided, not one.** The first implementation only
  checked the Sunday Fast Sunday was moving *onto*. Cancelling a meeting outright, setting a
  Sunday to Fast Sunday, and cutting speaking slots below the speakers already in them all
  orphaned assignments with no warning whatsoever. `CalendarChangeWarning.reason` distinguishes
  them so calendar-b can title the dialog by consequence.
- **The count and the revert use the SERVICE client, deliberately.** `assignments` is
  bishopric-only under migration 019 but `calendar.manage` includes `ward_secretary`, so
  counting through the caller's client returned zero for a secretary — no warning, no revert,
  silently orphaned speakers. A warning only some roles can see is worse than none. The
  escalation reads a count and writes a `pipeline_stage`; it never touches talk content, and
  `assertCan()` already authorized the caller. Same precedent as `notifyOtherBishopric`.
- **The ward default has two readers that must agree** — `wardCalendarSettings.ts` and
  `apply_fast_sunday()`, which restores it in SQL when a Sunday stops being fast. Both fall back
  to 3 on a malformed value. `tests/db/calendar-generation.test.ts` asserts both halves.

## Pitfalls hit

- **A `+` concatenation in a select-column constant silently breaks the row type.** `SUNDAY_COLUMNS`
  was written across two lines with `+`, which widens the type from a string literal to `string`
  and defeats supabase-js's parsing of the select list — every mapped row came back as
  `GenericStringError`. Column lists must be one literal, as `lib/roster/queries.ts` keeps them.
- **`dateOnlySchema` validated shape but not existence.** The regex accepts `2026-02-31`, which
  reached Postgres as `date/time field value out of range` and would have surfaced as a **500 on a
  request that was simply wrong**. Caught by a test helper that built `${month}-31`. Fixed by
  refining the schema with `isValidDateOnly()` and adding a real `lastDayOfMonth()`. The lesson
  generalises: a format check is not a validity check, and this module exists precisely to get
  dates right.
- **Supabase's type generator marks every plpgsql argument non-nullable.** The catalog does not
  record argument nullability, so `p_fast_sunday_id` needs a cast even though null is a documented
  and intended value.

## Known gaps

- **No scheduled generation.** Deliberate (Decision 1). The on-demand path plus an explicit
  bishopric action maintains the horizon.
- **A hand-set slot count does not survive a Fast Sunday round trip** — it returns to the ward
  default, not the hand-set value. Fixing it means remembering a pre-fast value on the row, which
  is a migration.
- **Assignment reverts have no notification.** 03-calendar.md asks for one; there is no trigger key
  for it and inventing one fires into nothing. Handed to Phase 4.
- **Half the "does not count toward rotation" guarantee is Phase 4's.** The revert to `plan` lands
  here and is tested; the matching rule — that speaker history counts only `complete` assignments
  and that `counts_toward_rotation` is never repurposed to mean "cancelled" — is recorded as
  non-negotiable in `plans/04-talks-pipeline.md` §Step 2 and cannot be tested until Step 8 exists.
- **`apply_fast_sunday()`'s own assignment revert is now dead code for most callers.** The
  TypeScript revert runs first and leaves it nothing to do, which keeps the reported count coming
  from one place. It stays as a backstop because the migration is applied and frozen.
