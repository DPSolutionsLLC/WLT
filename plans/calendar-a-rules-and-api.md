# Plan: Calendar A — Generation Rules & API

**Created:** 2026-08-18
**Type:** feature
**Phase:** 3 of 13 — part 1 of 2 ([plans/03-calendar.md](03-calendar.md))
**Structure:** Sequential — `calendar-b-month-view.md` follows this plan and depends on it

---

## Overview

Everything Phase 3 needs beneath the UI: the three pure functions, one migration, the
calendar data-access module, five API routes, and the phase's test table. No pages, no
components — `calendar-b` builds those on top of what this plan lands.

**Key requirements**

1. Sundays generate for a date range, idempotently, never overwriting an existing row
2. Fast Sunday is a **resolution rule** that re-runs whenever a Sunday's type changes —
   forwards when a conference is added, backwards when one is cleared
3. Re-resolution onto a Sunday that already has assignments warns and requires confirmation
   rather than silently zeroing its speaking slots
4. Conducting is **stored** per Sunday, auto-populated from a versioned rotation, and
   overridable individually
5. All authenticated roles read the calendar; only `calendar.manage` holders write

**Success criteria**

- `npm run test` green, including every test in the Testing Strategy below
- Generating the same range twice changes nothing — proven against the hosted database
- A stake conference added to the first Sunday of a month moves Fast Sunday to the second;
  clearing it moves Fast Sunday back
- `PATCH /api/sundays/[id]` returns `409` with a warning payload when re-resolution would
  land on a Sunday holding assignments, and applies on `?confirm=true` with those
  assignments reverted to `plan` rather than deleted
- `npm run lint`, `npm run typecheck` and `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `supabase/migrations/023_calendar.sql` | create | `sundays.fast_sunday_pinned`, rotation versioning constraints, `apply_fast_sunday()` |
| `types/database.ts` | modify | Regenerate after the migration (`npm run db:types`) — never hand-edited |
| `types/domain.ts` | modify | `ROTATION_POSITIONS`, `SUNDAY_TYPE_LABELS`, `FAST_SUNDAY_DISPLACING_TYPES` |
| `lib/calendar/dates.ts` | create | UTC date-only helpers — the single defence against the timezone pitfall |
| `lib/calendar/generateSundays.ts` | create | Pure: date range → rows to insert |
| `lib/calendar/resolveFastSunday.ts` | create | Pure: a month's Sundays → the id that should be fast |
| `lib/calendar/resolveConductingUser.ts` | create | Pure: rotation + date → user id |
| `lib/calendar/queries.ts` | create | Every calendar read and write; the only module touching Supabase |
| `lib/validation/calendar.ts` | create | Zod schemas shared by routes and (later) forms |
| `app/api/sundays/route.ts` | create | `GET` list a range, `POST` generate a range or create one Sunday |
| `app/api/sundays/[id]/route.ts` | create | `PATCH` — the one route in this phase with non-obvious side effects |
| `app/api/conducting-rotation/route.ts` | create | `GET` current rotation, `PATCH` reorder + notify |
| `tests/lib/calendarDates.test.ts` | create | UTC helpers, DST weeks, month and year boundaries |
| `tests/lib/generateSundays.test.ts` | create | Correct Sundays for a range; General Conference pre-marking |
| `tests/lib/fastSunday.test.ts` | create | Default, shift, reverse, pinned — highest priority in the phase |
| `tests/lib/conductingRotation.test.ts` | create | 1→2→3→1 cycling; a mid-range change applies forward only |
| `tests/lib/slotConfig.test.ts` | create | Malformed `slot_config` rejected by the schema |
| `tests/db/calendar-generation.test.ts` | create | Idempotency and fast-Sunday re-resolution against the hosted project |
| `tests/db/fast-sunday-collision.test.ts` | create | 409 path, confirm path, assignments reverted not deleted |
| `tests/rls/calendar-access.test.ts` | create | Cross-ward isolation; read-for-all, write-gated-in-route |
| `plans/03-calendar.md` | modify | Record the four deviations listed under Decisions Already Made |

---

## Dependencies

- **No new packages.** `date-fns@4` is already a dependency but is used **only** for
  timestamp math in `lib/auth/invites.ts` and `lib/auth/pinLockout.ts`. Date-*only* math in
  this module uses `Date.UTC` arithmetic instead — see Pitfall 1.
- Existing services, all of which must be used rather than re-implemented:
  `requireSessionUser()`, `assertCan()`, `respondToRouteError()`, `readJsonBody()`,
  `writeAuditLog()`, `notifyOtherBishopric()`, `createServerSupabaseClient()`.
- Migration 023 is applied with `npm run db:push`. **This writes to the hosted project** —
  there is no local database (CLAUDE.md §9).

---

## Decisions Already Made

Four places where this plan deviates from `plans/03-calendar.md` or `SPEC.md`. Each is
deliberate. **Record all four in `plans/03-calendar.md` in the same commit**, per CLAUDE.md
§1 — "if the spec is wrong, flag it and update the spec in the same change."

### 1. The scheduled Edge Function is deferred, not built

03-calendar.md Step 1 asks for a Supabase Edge Function keeping 12 months of Sundays ahead.
There is no `supabase/functions/` directory and no cron infrastructure anywhere in this
repo. The on-demand path makes the scheduled job **redundancy rather than a requirement**:
nobody can view a month whose Sundays do not exist, because loading the month generates
them. Build on-demand generation plus an explicit bishopric "generate 12 months" action,
and hand the cron forward as a known gap.

### 2. `fast_sunday_pinned` is a new column, because the type cannot encode a pin

`fast-sunday-pinned.test.ts` in the phase plan requires a manual override to survive
re-resolution. Generation itself writes `type = 'fast_sunday'` on the resolved Sunday, so
`type` alone cannot distinguish "the rule chose this" from "a human chose this" — every
month would read as pinned. Migration 023 adds the column.

### 3. The Fast Sunday *rule* stays in TypeScript; only the *write* is a SQL function

`apply_roster_import` (migration 022) is the established pattern for "this must be one
transaction", because `@supabase/supabase-js` has no transaction API. Clearing the old fast
Sunday and setting the new one must not be observable half-done. But putting the resolution
*rule* in plpgsql too would put it in two languages — the exact drift `buildImportPreview.ts`
was written to avoid (see `plans/retros/roster-c-csv-import.md`). So `resolveFastSunday()`
decides in TypeScript and hands `apply_fast_sunday()` an id to apply.

### 4. The collision check blocks on assignments, not on prayers

03-calendar.md says warn when the incoming Sunday "already has assignments or prayers". A
fast Sunday still has an invocation and a benediction — prayers are not orphaned by
`speaking_slots = 0`; speakers are. So `prayerCount` is reported in the warning for context
and **only `assignmentCount > 0` blocks**.

### 5. Mutation auth is `calendar.manage`, and rotation reorder is `admin.manage_ward`

03-calendar.md's route table says "Bishopric" for every mutation, but
`lib/auth/permissions.ts` already grants `calendar.manage` to `ward_secretary` — and a
secretary maintaining the Sunday calendar is exactly their job. The permission matrix is
the source of truth (CLAUDE.md §7), so Sunday writes use `calendar.manage`.

Reordering the rotation is different: it is a bishopric composition decision that notifies
the other two as an `admin_setting_changed`. It uses `assertCan(user, 'admin.manage_ward')`,
which only `bishop` and `counselor` hold. No new permission key is added.

---

## Known Pitfalls (from retro context)

1. **Timezone drift — the phase's own headline pitfall.** `sundays.date` is a `date`.
   `new Date("2026-03-01")` parses as UTC midnight but `getDay()`, `getDate()` and
   `toLocaleDateString()` all read it in local time, so a machine west of UTC sees
   Saturday, February 28. Every date value in `lib/calendar/` is a `YYYY-MM-DD` **string**;
   every intermediate `Date` is built with `Date.UTC(...)` and read with `getUTC*`. Never
   round-trip through a local-time string. `tests/lib/calendarDates.test.ts` exists
   specifically to pin this.

2. **`assertCan()` in the route is the write boundary here — RLS is not.**
   `roster-a`, `roster-b` and `roster-c` each recorded this and it applies unchanged:
   migration 019 puts `sundays` and `conducting_rotation` in the ward-scoped policy loop
   that grants INSERT, UPDATE and DELETE to **every authenticated member of the ward** —
   including an `org_secretary` and a `sacrament_manager`. RLS stops a cross-*ward* write
   and nothing else. Every mutating route in this plan must carry the check, and the check
   must run **before** payload validation so an unauthorized caller gets 403 rather than a
   validation message that confirms the route's shape.

3. **Unit-testing a helper does not test the query built from it.** `roster-a` shipped a
   search bug that every unit test passed: `toSearchPattern("%")` correctly returned null
   and the *caller* treated null as "no filter" instead of "no results", returning the whole
   ward. `tests/lib/rosterQueries.test.ts` — running against the hosted project — is what
   caught it. `lib/calendar/queries.ts` hand-builds range filters and a multi-row upsert, so
   `tests/db/calendar-generation.test.ts` is not optional.

4. **Two correct numbers can still disagree.** `roster-c`'s only real bugs were both a
   preview count and a result count that were each right and did not pair. The 409 warning
   payload here has the same shape of risk: the count it quotes ("3 speakers assigned") must
   be produced by the same query that decides whether to block, not by a second one.

5. **A route that reports a new field must have the TypeScript type updated in the same
   change** (CLAUDE.md rule 9). `fast_sunday_pinned` is new; regenerate `types/database.ts`
   and add it to the hand-written `Sunday` type before writing the route that returns it.

6. **`db push` prints `failed to cache migrations catalog: failed to run docker`.** Harmless
   and expected on this machine — recorded by `auth-c` and again by `roster-a`. The
   migration applies.

7. **Restart a long-lived dev server before believing a 500.** `roster-c` lost time to
   `Jest worker encountered 2 child process exceptions`, which was memory exhaustion on a
   19-hour-old dev server, not code. Next 16's dev log is at
   `.next/dev/logs/next-development.log`.

---

## Tasks

### Task 1: Migration 023 — pin column, rotation versioning, atomic apply

**File:** `supabase/migrations/023_calendar.sql` (create)

**Action:** Three parts in one migration, in this order.

**Part 1 — the pin column**

```sql
alter table sundays
  add column fast_sunday_pinned boolean not null default false;
```

Header comment must explain why `type` alone is insufficient (Decision 2 above).

**Part 2 — rotation versioning**

`conducting_rotation` currently allows `effective_from` to be null and has no uniqueness,
so the same position could exist twice for the same date with no way to say which wins. The
table has no rows — nothing is seeded into it and no phase has written to it — so both
changes are safe:

```sql
alter table conducting_rotation
  alter column effective_from set not null,
  add constraint conducting_rotation_ward_position_effective_key
    unique (ward_id, position, effective_from);
```

A rotation change **inserts a new set of three rows** with a new `effective_from`; it never
updates the old set. That is what makes "applies forward only" true by construction rather
than by remembering to.

**Part 3 — `apply_fast_sunday()`**

```sql
create function apply_fast_sunday(
  p_ward_id        uuid,
  p_month_start    date,
  p_fast_sunday_id uuid
) returns jsonb
```

- `SECURITY INVOKER` — the default, and **required**. RLS must still apply to every write
  inside it (CLAUDE.md rule 2). Copy the warning comment from `apply_roster_import`'s
  header verbatim in spirit: do not add `SECURITY DEFINER`.
- `set search_path = public, pg_temp`, matching migration 022.
- Body, all within the function's implicit transaction:
  1. Clear: for every Sunday in `[p_month_start, p_month_start + interval '1 month')` in
     this ward with `type = 'fast_sunday'`, `fast_sunday_pinned = false`, and
     `id is distinct from p_fast_sunday_id` → set `type = 'standard'`, `speaking_slots = 3`.
  2. Apply, when `p_fast_sunday_id is not null` → set `type = 'fast_sunday'`,
     `speaking_slots = 0` on that row.
  3. Revert, in the same statement block: `update assignments set pipeline_stage = 'plan'`
     where `sunday_id = p_fast_sunday_id` and `pipeline_stage <> 'plan'`. **Never delete an
     assignment** — that is Pitfall 5 of the phase plan.
  4. Return `jsonb_build_object('cleared', …, 'applied', p_fast_sunday_id, 'assignmentsReverted', …)`.
- Document in the SQL that step 1 restores `speaking_slots = 3` — the documented default —
  and therefore discards a hand-set value like 4 on a Sunday that became fast and then
  unfast. 03-calendar.md Step 2 states this restore explicitly; the comment stops the next
  reader filing it as a bug.
- Do **not** add a unique index enforcing one `fast_sunday` per month. Clearing and setting
  are separate statements everywhere except inside this function, so such an index would
  reject legitimate intermediate states.

**After writing:** `npm run db:push`, then `npm run db:types`.

---

### Task 2: Domain types

**File:** `types/domain.ts` (modify)

**Action:** Append beside the existing `SUNDAY_TYPES` block. Follow the file's existing
`as const` + derived-type idiom exactly.

```ts
export const SUNDAY_TYPE_LABELS: Record<SundayType, string> = {
  standard: "Standard",
  fast_sunday: "Fast Sunday",
  stake_conference: "Stake Conference",
  general_conference: "General Conference",
  holiday: "Holiday",
  special: "Special",
};

// A Sunday of one of these types cannot BE Fast Sunday, so Fast Sunday moves past it.
// `special` is deliberately absent: a special meeting still holds a fast and testimony
// meeting unless somebody says otherwise. 03-calendar.md §Step 2 defines the set.
export const FAST_SUNDAY_DISPLACING_TYPES: readonly SundayType[] = [
  "stake_conference",
  "general_conference",
  "holiday",
];

export const ROTATION_POSITIONS = [1, 2, 3] as const;
export type RotationPosition = (typeof ROTATION_POSITIONS)[number];
```

`SUNDAY_TYPE_LABELS` is a `Record<SundayType, string>` for the same reason `ROLE_LABELS`
is — a type added to `SUNDAY_TYPES` fails to compile until someone names it on screen.

---

### Task 3: UTC date-only helpers

**File:** `lib/calendar/dates.ts` (create)

**Action:** The whole module's defence against Pitfall 1. Header comment must say so.

```ts
export type DateOnly = string; // YYYY-MM-DD

export function parseDateOnly(value: DateOnly): Date;   // Date.UTC — throws on a bad shape
export function formatDateOnly(date: Date): DateOnly;   // getUTCFullYear/Month/Date
export function addDaysUtc(value: DateOnly, days: number): DateOnly;
export function isSunday(value: DateOnly): boolean;      // getUTCDay() === 0
export function firstSundayOnOrAfter(value: DateOnly): DateOnly;
export function sundaysInRange(from: DateOnly, to: DateOnly): DateOnly[];  // inclusive
export function monthStart(value: DateOnly): DateOnly;   // YYYY-MM-01
export function monthOf(value: DateOnly): string;        // YYYY-MM, for grouping
export function addMonths(value: DateOnly, months: number): DateOnly;
export function countSundaysBetween(from: DateOnly, to: DateOnly): number;
```

**Details**

- `parseDateOnly` throws on anything not matching `/^\d{4}-\d{2}-\d{2}$/`, and throws if the
  round trip back through `formatDateOnly` does not reproduce the input (which rejects
  `2026-02-30`). Same reasoning as `toEnumValue()` in `lib/roster/queries.ts`: a value that
  should be impossible means two things have drifted, and throwing is the only safe answer.
- `addDaysUtc` adds `days * 86_400_000` ms to a UTC-midnight timestamp. This is DST-proof
  precisely because it never constructs a local-time `Date`.
- `countSundaysBetween` requires both arguments to be Sundays and returns
  `(toMs - fromMs) / (7 * 86_400_000)`. Negative results are returned as-is; the caller
  decides what a date before the anchor means.
- Export `MS_PER_DAY` rather than repeating the literal.

---

### Task 4: `generateSundays()`

**File:** `lib/calendar/generateSundays.ts` (create)

```ts
export type GeneratedSunday = {
  date: DateOnly;
  type: SundayType;
  speakingSlots: number;
};

export function generateSundays(from: DateOnly, to: DateOnly): GeneratedSunday[];
```

**Details**

- Every Sunday in `[from, to]` inclusive, via `sundaysInRange`.
- **General Conference:** the first Sunday of April and of October gets
  `type = "general_conference"`. Comment that this is a prediction the bishopric can
  override, not a fact — it is pre-marked because it is predictable and because it *shifts
  Fast Sunday*, which is the whole reason it matters here.
- Then, **per calendar month present in the range**, call `resolveFastSunday()` over that
  month's generated rows and set the winner to `type = "fast_sunday"`, `speakingSlots = 0`.
- Everything else is `"standard"` with `speakingSlots = 3`.
- **A month only partially covered by the range still resolves against only the Sundays it
  generated.** Note this in a comment: `ensureMonthGenerated()` in Task 7 always generates
  whole months, which is what makes the partial case not arise in practice. A caller
  generating a ragged range gets a ragged answer and that is the caller's problem to avoid.
- Pure. No `Date.now()`, no I/O, no ids — ids do not exist until the rows are inserted.

---

### Task 5: `resolveFastSunday()`

**File:** `lib/calendar/resolveFastSunday.ts` (create)

```ts
export type FastSundayCandidate = {
  id: string;
  date: DateOnly;
  type: SundayType;
  fastSundayPinned: boolean;
};

export function resolveFastSunday(monthSundays: FastSundayCandidate[]): string | null;
```

**Details** — the highest-value function in the phase. The header comment must state that
this is a **resolution rule, not a generation-time constant**, and that it re-runs on every
type change in both directions.

1. Sort a copy by `date` ascending. Never mutate the argument.
2. If any candidate has `fastSundayPinned === true`, return that id — the pin wins over the
   rule until it is cleared. If more than one is pinned (which the data layer prevents),
   return the earliest and do not throw; a stale pin must not break a calendar page.
3. Otherwise return the id of the earliest candidate whose `type` is **not** in
   `FAST_SUNDAY_DISPLACING_TYPES`.
4. Return `null` when every Sunday in the month is displaced.

Note in a comment that a candidate already typed `fast_sunday` is not displacing and so
stays chosen — this is what makes re-resolution idempotent.

`generateSundays()` calls this with synthetic candidates whose ids are the date strings,
since real ids do not exist pre-insert. Make the id field's opacity explicit in the doc
comment so that is not read as a bug.

---

### Task 6: `resolveConductingUser()`

**File:** `lib/calendar/resolveConductingUser.ts` (create)

```ts
export type RotationEntry = {
  position: RotationPosition;
  userId: string | null;
  effectiveFrom: DateOnly;
};

export function activeRotation(entries: RotationEntry[], onDate: DateOnly): RotationEntry[];

export function resolveConductingUser(
  sundayDate: DateOnly,
  rotation: RotationEntry[],
  anchorDate: DateOnly,
): string | null;
```

**Details**

- **Signature deviation, deliberate:** 03-calendar.md types the parameters as `Date` and the
  return as `string`. Dates are `DateOnly` strings here for Pitfall 1, and the return is
  nullable because a ward that has not configured a rotation must render a calendar rather
  than throw. Record this in `plans/03-calendar.md`.
- `activeRotation` groups entries by `effectiveFrom`, discards sets with
  `effectiveFrom > onDate`, and returns the set with the greatest remaining `effectiveFrom`
  sorted by position. Empty array when none applies.
- `resolveConductingUser` returns `null` when the active set is empty. Otherwise:
  `index = countSundaysBetween(firstSundayOnOrAfter(anchorDate), sundayDate) mod 3`, then
  returns that position's `userId` (which may itself be null — an unfilled position is not
  an error).
- Negative index — `sundayDate` before the anchor — returns `null` rather than wrapping.
  A negative modulo silently selecting position 3 would be a wrong answer dressed as a right
  one.
- Callers pass the active set's own `effectiveFrom` as `anchorDate`. That is what makes a
  rotation change restart cleanly at position 1 and apply forward only.
- **Comment why this is computed once and stored, never at read time:** a computed value
  rewrites history the moment the rotation changes. 03-calendar.md Step 3 is explicit.

---

### Task 7: Calendar data layer

**File:** `lib/calendar/queries.ts` (create)

**Action:** The only module in the phase that touches Supabase. Route handlers and pages
never do (conventions.md §Data Access). Mirror the structure of `lib/roster/queries.ts`:
row types, a column constant, snake↔camel mapping in one place, and a header comment
stating the module's contract.

**Types**

```ts
export type SlotConfigEntry = { slotNumber: number; lengthMinutes: number; type: AssignmentType };

export type Sunday = {
  id: string;
  date: DateOnly;
  type: SundayType;
  notes: string | null;
  conductingUserId: string | null;
  speakingSlots: number;
  slotConfig: SlotConfigEntry[] | null;
  presidingOverride: string | null;
  fastSundayPinned: boolean;
  createdAt: string;
};

export type FastSundayCollision = {
  monthStart: DateOnly;
  fromDate: DateOnly | null;
  toDate: DateOnly;
  assignmentCount: number;
  prayerCount: number;
  message: string;
};
```

**`slot_config` stays snake_case inside the jsonb blob** — `{ slot_number, length_minutes,
type }`, as SPEC.md and 03-calendar.md both specify, because Phase 6's program builder reads
it. The camel↔snake mapping happens here, once, like every other column. Comment it, or the
next reader will "fix" the inconsistency in one direction or the other.

**Functions**

| Function | Notes |
|---|---|
| `listSundays(wardId, { from, to }, supabase)` | `.gte("date", from).lte("date", to).order("date")`. Ward filter explicit. |
| `getSunday(wardId, id, supabase)` | Returns `null` when absent — the route turns that into a 404. |
| `generateSundayRange(wardId, from, to, supabase)` | See below. |
| `ensureMonthGenerated(wardId, monthStart, supabase)` | If the month has zero rows, generate that whole month. Returns the month's Sundays either way. |
| `updateSunday(wardId, id, input, supabase, opts)` | See below. |
| `listConductingRotation(wardId, supabase)` | All entries, ordered by `effective_from` then `position`. |
| `replaceConductingRotation(wardId, input, supabase)` | Inserts three new rows at a new `effective_from`. Never updates the old set. |

**`generateSundayRange`**

1. `generateSundays(from, to)` for the candidate rows.
2. Insert with `.upsert(rows, { onConflict: "ward_id,date", ignoreDuplicates: true })` —
   this is `INSERT ... ON CONFLICT DO NOTHING`, which is what makes generation idempotent
   and non-destructive. **Comment that `ignoreDuplicates: true` is load-bearing**; dropping
   it turns generation into an overwrite that silently discards every bishopric edit in the
   range. This is the single most dangerous line in the phase.
3. Re-read the affected months, then for each month call `resolveFastSunday()` and
   `apply_fast_sunday()` via `supabase.rpc(...)`. Existing rows are included in the
   resolution, so generating a range that overlaps hand-edited months respects those edits.
4. Populate `conducting_user_id` on rows where it is null, using
   `activeRotation` + `resolveConductingUser`. Only where null — never overwrite an override.
5. Return `{ created, monthsResolved }` counts for the audit detail and the response.

**`updateSunday`** — the phase's one non-obvious write path. Keep the resolution call in
**this function**, not in the route, so a future caller cannot bypass it (03-calendar.md
Step 4 requires exactly this).

1. Apply the patch to the row.
2. If `type` or `fastSundayPinned` was in the patch, re-resolve that Sunday's month:
   - read the month's Sundays fresh (post-patch)
   - `nextFastId = resolveFastSunday(month)`
   - if `nextFastId` differs from the month's current fast Sunday **and** the target holds
     assignments, and `opts.confirm !== true` → return
     `{ status: "needs_confirmation", collision }` **without having applied anything**.
     That means the patch itself must be rolled back or, more simply, the collision check
     must run **before** step 1. Do the check first.
   - otherwise call `apply_fast_sunday()` and return its counts.
3. **The count quoted in the collision message and the count that decides to block must come
   from the same query** — Pitfall 4. Build the message from `assignmentCount`, do not
   re-count for display.
4. Return a discriminated union so the route cannot forget the 409 branch:
   `{ status: "applied"; sunday: Sunday; assignmentsReverted: number } | { status: "needs_confirmation"; collision: FastSundayCollision }`.

**`replaceConductingRotation`** inserts three rows sharing one `effective_from`. If that
`effective_from` already exists, the unique constraint from Task 1 rejects it — surface that
as a 409-style message ("A rotation already takes effect on that date"), never a 500.

---

### Task 8: Zod schemas

**File:** `lib/validation/calendar.ts` (create)

Follow `lib/validation/roster.ts` exactly, including the header rule: **no `wardId` on any
schema, ever** — it comes from the session.

```ts
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const slotConfigEntrySchema = z.object({
  slotNumber: z.number().int().min(1).max(10),
  lengthMinutes: z.number().int().min(1).max(60),
  type: z.enum(ASSIGNMENT_TYPES),
});

export const slotConfigSchema = z
  .array(slotConfigEntrySchema)
  .max(10, "That is more speaking slots than a meeting has.")
  .superRefine(/* slotNumber values must be unique */);

export const updateSundaySchema = z.object({
  type: z.enum(SUNDAY_TYPES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  conductingUserId: z.uuid("Choose a bishopric member from the list.").nullable().optional(),
  speakingSlots: z.number().int().min(0).max(10).optional(),
  slotConfig: slotConfigSchema.nullable().optional(),
  presidingOverride: z.string().trim().max(120).nullable().optional(),
  fastSundayPinned: z.boolean().optional(),
});

export const createSundaySchema = z.object({ mode: z.literal("single"), date: dateOnlySchema, ... });
export const generateSundaysSchema = z.object({ mode: z.literal("generate"), from: dateOnlySchema, to: dateOnlySchema })
  .refine(({ from, to }) => to >= from, { message: "The end date must not be before the start date." })
  .refine(/* range no wider than 24 months */);

export const sundayPostSchema = z.discriminatedUnion("mode", [createSundaySchema, generateSundaysSchema]);

export const sundayRangeSchema = z.object({ from: dateOnlySchema, to: dateOnlySchema });

export const conductingRotationSchema = z.object({
  effectiveFrom: dateOnlySchema,
  positions: z
    .array(z.object({ position: z.union([z.literal(1), z.literal(2), z.literal(3)]), userId: z.uuid().nullable() }))
    .length(3, "A rotation has exactly three positions."),
});
```

The 24-month cap on `generate` is a denial-of-service guard, not a business rule — comment
it as such. `slot_config`'s shape is validated on write because a malformed blob breaks the
Phase 6 program builder with no error at the boundary that accepted it (CLAUDE.md rule 9's
neighbouring failure mode).

---

### Task 9: `/api/sundays`

**File:** `app/api/sundays/route.ts` (create)

Copy the shape of `app/api/members/route.ts` exactly — including resolving the session
**outside** the `try`, because `requireSessionUser()` redirects by throwing and catching that
turns a redirect into a 500 (`lib/auth/routeErrors.ts` says so at the call site).

**`GET`** — `assertCan(user, "calendar.view")`. Parse `from`/`to` from `searchParams` with
`sundayRangeSchema`. Returns `{ sundays }`.

**`POST`** — `assertCan(user, "calendar.manage")` **before** parsing the body.
`sundayPostSchema` discriminates:
- `mode: "generate"` → `generateSundayRange()`, audit `sundays_generated`, module `calendar`,
  detail `{ from, to, created, monthsResolved }`.
- `mode: "single"` → create one Sunday, audit `sunday_created`.

No notification. There is no calendar trigger key in
`supabase/seed/notification_triggers.sql`, and inventing one fires into nothing and only
warns (`lib/notifications/emitNotification.ts`) — the same note
`app/api/members/route.ts` carries.

---

### Task 10: `PATCH /api/sundays/[id]`

**File:** `app/api/sundays/[id]/route.ts` (create)

- `assertCan(user, "calendar.manage")` first, then `updateSundaySchema.parse(await readJsonBody(request))`.
- `confirm` comes from `searchParams.get("confirm") === "true"`.
- On `{ status: "needs_confirmation" }` → `NextResponse.json({ error: collision.message, collision }, { status: 409 })`.
  Both keys: `error` so the generic client error path shows something useful, `collision` so
  `calendar-b`'s dialog can render the specifics.
- On `{ status: "applied" }` → audit `sunday_updated` with
  `{ sundayId, changedFields, assignmentsReverted }`. **Do not put `notes` in the audit
  detail** — `writeAuditLog`'s redactor matches the key `note` and will replace it with
  `[redacted]` anyway; log `notesChanged: true` instead of a value that arrives as noise.
- When `conductingUserId` changes, call `notifyOtherBishopric()` with a description naming
  the date and the new conductor. 03-calendar.md Step 3: both conducting edits and rotation
  edits notify the other two, and it is a product requirement, not a nicety.
- When `assignmentsReverted > 0`, the response must say so; `calendar-b` surfaces it.
- 404 when `getSunday()` returns null — never a 500.
- `params` is a Promise in Next 16: `const { id } = await params`. Type the props explicitly
  rather than with the generated `PageProps`/`RouteContext` helper, which only exists after a
  build (`plans/retros/foundation-a-scaffold.md`).

---

### Task 11: `/api/conducting-rotation`

**File:** `app/api/conducting-rotation/route.ts` (create)

**`GET`** — `assertCan(user, "calendar.view")`. Returns `{ rotation, activeFrom }`. The music
coordinator and both secretaries need this to read the upcoming Sunday list.

**`PATCH`** — `assertCan(user, "admin.manage_ward")` (Decision 5). Parse with
`conductingRotationSchema`, call `replaceConductingRotation()`, then:
- `writeAuditLog({ action: "conducting_rotation_updated", module: "calendar", detail: { effectiveFrom, positions } })`
- `notifyOtherBishopric({ description: "…reordered the conducting rotation, effective <date>." })`

The response must state plainly that the change applies from `effectiveFrom` forward and
does not rewrite Sundays already assigned — `calendar-b` renders that sentence, and
03-calendar.md Step 3 requires the UI to say it.

---

### Task 12: Update the phase plan

**File:** `plans/03-calendar.md` (modify)

Add a short "Deviations recorded during implementation" section listing Decisions 1–5, each
with one sentence of reasoning and a pointer to this plan. Also correct the Definition of
Done, which says "All five tests pass" while the Tests table lists ten.

---

## Testing Strategy

Priority order follows CLAUDE.md §8: RLS first, then pure functions, then the DB-backed
paths. Route handlers stay unit-untested — there is no local server, and this is the sixth
phase running with that gap (`roster-c` retro). They are driven by hand in `calendar-b`'s
harness scenario.

### `tests/lib/calendarDates.test.ts`
- `parseDateOnly` throws on `2026-13-01`, `2026-02-30`, `"2026-3-1"`, and on a full ISO timestamp
- `formatDateOnly(parseDateOnly(x)) === x` across a year of dates
- `addDaysUtc` crosses the US DST boundaries (2026-03-08, 2026-11-01) without shifting the day
- `sundaysInRange` across a month boundary, a year boundary, a leap year, and a range whose
  endpoints are themselves Sundays (inclusive on both ends)
- `countSundaysBetween` on adjacent Sundays is 1; on the same Sunday is 0

### `tests/lib/generateSundays.test.ts`
- A full year of 2026 produces 52 rows, every one a Sunday in UTC
- The first Sunday of April and October is `general_conference`
- Every non-fast, non-conference Sunday has `speakingSlots === 3`; the fast Sunday has `0`
- A range starting mid-month resolves that month against only the Sundays it generated

### `tests/lib/fastSunday.test.ts` — highest priority in the phase
- **Default:** no conferences → the first Sunday is fast, `speakingSlots === 0`
- **Shift:** stake conference on the first Sunday → fast moves to the second
- **Shift, predictable:** April and October general conference produces the same shift
- **Reverse:** clearing the conference back to `standard` moves fast **earlier** again —
  the direction 03-calendar.md warns is easiest to forget
- **Pinned:** a `fastSundayPinned` Sunday survives re-resolution, and wins over an earlier
  non-displaced Sunday
- **All displaced:** every Sunday in the month is a conference → returns `null`
- **Idempotent:** re-running over a month already resolved returns the same id
- Input array is not mutated

### `tests/lib/conductingRotation.test.ts`
- Cycles 1→2→3→1 across four consecutive Sundays from the anchor
- A second rotation set with a later `effective_from` applies **only** from that date;
  Sundays before it still resolve against the earlier set
- A date before every `effective_from` returns `null`
- A position with a null `userId` returns null rather than skipping to the next position
- Anchor that is not itself a Sunday is normalised forward to the first Sunday

### `tests/lib/slotConfig.test.ts`
- Rejects a missing `lengthMinutes`, a `slotNumber` of 0, a non-`ASSIGNMENT_TYPES` type,
  duplicate `slotNumber` values, and 11 entries
- Accepts `null` (no slot config set) and an empty array
- Round-trips camelCase ↔ the snake_case blob shape

### `tests/db/calendar-generation.test.ts` — hosted project
Seeds with the service-role client via `tests/helpers/seed.ts` and **cleans up after
itself** — RLS tests run over the network against a shared project and cannot assume an
empty table (CLAUDE.md §9).
- Generating a 3-month range creates the right count of rows
- **Generating the same range again changes nothing** — row count, `type`, `notes`,
  `speaking_slots` and `conducting_user_id` all byte-identical, verified by comparing full
  rows and not just a count
- A hand-edited Sunday (`notes` set, `type = 'special'`) survives a re-generation of its range
- Marking the first Sunday `stake_conference` through `updateSunday()` moves fast to the
  second; clearing it moves fast back
- `conducting_user_id` is populated on generation and an override is not overwritten by a
  later generation

### `tests/db/fast-sunday-collision.test.ts` — hosted project
- Seed a month, insert an `assignments` row on the second Sunday at stage `approve`
- `updateSunday()` marking the first Sunday `stake_conference` returns
  `{ status: "needs_confirmation" }` and **nothing in the database changed** — assert the
  first Sunday's type too, not only the second's slots
- The collision's `assignmentCount` matches the seeded count
- With `confirm: true`: fast moves, `speaking_slots` becomes 0, and the assignment **still
  exists** with `pipeline_stage = 'plan'`
- A pinned fast Sunday is not cleared by the confirm path

### `tests/rls/calendar-access.test.ts`
Uses `asRole()` per convention.
- A ward A user cannot select ward B's `sundays` or `conducting_rotation` (zero rows, not an
  error — an RLS refusal is a zero-row success)
- `music_coordinator`, `ward_secretary` and `executive_secretary` in the same ward **can**
  select `sundays`
- **Documents the asymmetry rather than asserting a lie:** an `org_secretary` in the same
  ward *can* UPDATE `sundays` directly through the anon client, because migration 019 grants
  it. The test asserts that this is true and carries a comment naming
  `assertCan(user, "calendar.manage")` as the real boundary. Asserting a denial that does
  not exist would be worse than documenting the gap.

---

## Test Scenarios (Harness)

**None in this slice.** Every path here is either a pure function or a data-layer call with
no UI to walk, and the two states worth seeding — a fast-Sunday collision and a mid-range
rotation change — are covered by the two `tests/db/` suites above, which can assert database
state a human cannot see.

`calendar-b` adds **scenario 010**, which drives these same routes by hand through the
browser. That is where the 403 and 409 paths get a human walkthrough, matching how `roster-c`
covered its routes.

---

## Validation Commands

```bash
# Apply the migration to the hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm run test

# Production build
npm run build
```

Run the build. Lint, typecheck and tests can all pass while a build fails — and this repo
has the sharper version of that lesson: **a build with no environment variables set still
exits 0** (`plans/retros/deployment.md`). A green build proves the code compiles and nothing
more.

---

## Integration Notes

- **`/calendar` still 404s after this slice.** `NAVIGATION_ITEMS` in `lib/auth/navigation.ts`
  already links it, deliberately — a link to an unbuilt route 404s and that is the right
  answer for an unbuilt module. `calendar-b` closes it. No change to `navigation.ts` here.
- **No breaking changes.** Every file is new except `types/domain.ts` (additive),
  `types/database.ts` (regenerated) and `plans/03-calendar.md` (documentation).
- **Migration 023 is applied to the hosted project the moment `db:push` runs**, and the
  deployed app runs against that same database with no staging step
  (`plans/retros/deployment.md`). All three changes are additive — a new column with a
  default, a constraint on an empty table, a new function — so the running app is unaffected.
  **If `apply_fast_sunday`'s signature needs to change later, that is a new migration.** 022
  taught this: an applied migration is not editable.
- **Hands forward to `calendar-b`:** the `Sunday` type, `FastSundayCollision`, the 409
  contract, and `SUNDAY_TYPE_LABELS`.
- **Hands forward to Phase 4:** `apply_fast_sunday()` reverts assignments to `plan` and Phase
  4 owns everything downstream of that stage. When Phase 4 builds the pipeline UI, the revert
  needs a notification to the planner — 03-calendar.md asks for one and there is no trigger
  key for it yet. Recorded as a known gap rather than inventing a key that fires into nothing.
- **Known gap, deliberate:** no scheduled generation (Decision 1). The 12-month horizon is
  maintained by the on-demand path plus the explicit bishopric action. Revisit if a ward ever
  needs Sundays to exist before anyone looks at them.
