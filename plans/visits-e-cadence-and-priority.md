# Plan: Visit Cadence and the Priority Scale

**Created:** 2026-08-26
**Type:** feature
**Scope refs:** ITER-018
**Structure:** Unified

---

## Overview

A visit goal stops being *"between these two dates, visit everybody"* and becomes *"visit every
household once every X"*. Progress is measured from **each household's own last completed visit**
rather than from a shared period boundary, which dissolves the `visits-b` contradiction (a row
reading **✓ Visited** above a banner counting it as unvisited) instead of patching it.

Seven parts, all from `.iterate/scopes/ITER-018.md`:

1. A goal has no period. It has a **cadence** and an optional **deadline**.
2. Cadence is an **amount plus a unit** — day, week, month or year.
3. A goal is **editable**. There is no edit path anywhere in the app today.
4. **Per-organization, per-household cadence override** in a new join table.
5. The five status buckets become a **priority scale** driven by fraction-of-cadence-elapsed.
6. The banner becomes **several statistics** plus a plain-language reminder of the goal.
7. **Household-level do-not-contact**, shown marked and excluded from every statistic.

### Success criteria

- An organization can save a goal with no dates at all and see every household ranked against it.
- The same family can be on a 3-month cadence for Elders Quorum and a 12-month one for Relief
  Society, at the same time, with both dashboards correct.
- A goal can be edited in place; no one has to stack a second goal to change their mind.
- No household reads "Visited" anywhere. Every household reads a position, a due date, or
  "Never visited".
- A do-not-contact household is visible, marked, and in no numerator and no denominator.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run harness:typecheck` and
  `npm run build` all pass.

### Decisions this plan implements

All six are recorded in `.iterate/scopes/ITER-018.md` §Decisions. The two answered during
planning, and the one that was **reversed**, matter most:

| # | Decision |
|---|---|
| 1 | One goal shape. Rolling cadence; `deadline` is a nullable attribute, presentation only. |
| 2 | **REVERSED mid-planning** — per-org join table `household_visit_cadences`, not a `households` column. |
| 3 | Never-visited is its own top-priority state. No fraction computed for it. |
| 4 | Do-not-contact households are shown marked and counted in nothing. |
| 5 | `visits.manage_goals` writes the cadence override; `roster.manage` writes do-not-contact. |
| 6 | The "approaching due" window is per-goal and adjustable. It replaces `DUE_SOON_FRACTION`. |

---

## Relevant Files

### Create

- `supabase/migrations/050_visit_cadence_scale.sql` — adds cadence/notice/deadline to
  `visit_goals`, creates `household_visit_cadences` with RLS, adds `households.do_not_contact`,
  backfills every existing goal. **Adds only — drops nothing.**
- `supabase/migrations/051_drop_visit_goal_period.sql` — drops `visit_goals.cadence`,
  `cadence_months`, `goal_period_start`, `goal_period_end`. Applied **after** the deploy.
- `lib/visits/cadence.ts` — the amount+unit type and its arithmetic. Pure, client-importable.
- `lib/visits/householdCadences.ts` — CRUD for the join table. Server-only.
- `app/api/households/[id]/visit-cadence/route.ts` — `PUT` and `DELETE`, `visits.manage_goals`.
- `app/(app)/visits/HouseholdCadenceControl.tsx` — the per-row override control.
- `tests/lib/visitCadence.test.ts`
- `tests/rls/household-visit-cadences.test.ts`
- `tests/routes/householdVisitCadence.test.ts`

### Modify

- `types/domain.ts` — remove `VISIT_CADENCES` / `VisitCadence` / `VISIT_CADENCE_LABELS` and the
  whole `HOUSEHOLD_VISIT_STATUSES` family; add `CADENCE_UNITS`, `VISIT_PRIORITY_BANDS` and labels.
- `types/database.ts` — regenerate with `npm run db:types`. Never hand-edited.
- `lib/visits/householdStatus.ts` — rewritten around `householdVisitPriority()`.
- `lib/visits/progress.ts` — statistics instead of a banner tally; per-household cadence
  resolution; do-not-contact exclusion.
- `lib/visits/queries.ts` — `VisitGoal` reshaped; goal ordering changed to `created_at`.
- `lib/validation/visit.ts` — cadence, notice and deadline schemas; `CADENCE_MONTHS` deleted.
- `lib/validation/roster.ts` — `doNotContact` on the household schemas.
- `lib/roster/queries.ts` — `Household.doNotContact` through the columns, row type and mapper.
- `app/api/visit-goals/route.ts` and `app/api/visit-goals/[id]/route.ts` — new field names,
  merged-cadence coherence check replaced.
- `app/api/households/[id]/route.ts` — audit detail only; the schema change flows through.
- `app/(app)/visits/VisitGoalPanel.tsx` — an **edit** path plus the new fields.
- `app/(app)/visits/VisitProgressBanner.tsx` — the statistics row and the goal reminder.
- `app/(app)/visits/VisitProgressTable.tsx` — priority column, due column, DNC mark, new sorts.
- `app/(app)/visits/page.tsx` — mark do-not-contact households in the log picker.
- `components/roster/HouseholdForm.tsx` — the do-not-contact checkbox.
- `testing/infrastructure/seedUtils.ts` — `createVisitGoal` reshaped, `createHousehold` gains
  `doNotContact`, new `createHouseholdVisitCadence`.
- `testing/infrastructure/types.ts` — the enums it re-exports.
- Six scenario seeds under `testing/scenarios/visits/` — every one sets `goalPeriodStart`.
- `tests/lib/householdStatus.test.ts`, `tests/lib/visitProgress.test.ts`,
  `tests/lib/visitValidation.test.ts`, `tests/routes/visits.test.ts`,
  `tests/routes/visitsProgress.test.ts`, `tests/rls/visit-cross-org.test.ts`.

---

## Dependencies

**No new libraries.** Everything here is Zod, Supabase, TanStack Query and Tailwind, all present.

Existing utilities to reuse rather than re-derive:

- `lib/calendar/dates.ts` — `addDaysUtc`, `addMonths`, `parseDateOnly`, `formatDateOnly`,
  `isValidDateOnly`, `MS_PER_DAY`. `addCadence` is built **on** these, not beside them.
- `lib/auth/permissions.ts` — `assertCan`, `resolveRoleAccess`, `BISHOPRIC_ROLES`.
- `lib/audit/writeAuditLog.ts` — every mutation, no inline inserts (CLAUDE.md rule 6).
- `lib/auth/routeErrors.ts` — `readJsonBody`, `respondToRouteError`.
- `lib/auth/adminUsers.ts` — `listWardOrganizations`, for validating a bishopric-supplied `orgId`.
- `tests/helpers/routeClient.ts` — read its header before the first route test.

**Configuration:** none. No new environment variable, no new permission string.

---

## Known Pitfalls (from retro context)

- **`visits-b-progress-dashboard`** — *the deviation this plan exists to remove.* Its banner counts
  visits in the period while the badge reads the status; they disagree at the start of every
  period. Both notions die here. Also: **`initialData` is read once, on first mount** — every
  mutation on this page must invalidate `VISIT_PROGRESS_QUERY_KEY`, and `router.refresh()` alone
  is not enough. The new cadence control and the goal editor both need that pairing.
  Its re-walk note is worth heeding too: **the round trip takes ~3.7 s**, so a 3-second probe
  reads exactly like a stale cache.
- **`roster-b-picker-and-orgs`** — a query parameter a handler does not read is **silently
  ignored**, not refused. `?orgId=` on the new DELETE must be checked against the handler, not
  assumed. Also: import types from server-only modules **type-only**, or `next/headers` reaches
  the client bundle. `lib/visits/cadence.ts` must import nothing server-only at all.
- **`role-access-overrides`** — never compare `user.role` to a string to decide a capability.
  `can()` / `assertCan()` with the resolved `roleAccess` is the only reading that honours the
  ward's override. Resolve once per request into a local; `cache()` does not dedupe in a route.
- **`talks-d-reliability-goals`** — a goal written into a hole nobody can read.
  `household_visit_cadences.org_id` is `NOT NULL` for exactly this reason: `org_id =
  current_org_id()` is never true when both sides are null, so a null-org row would be invisible
  to its own author.
- **`foundation-c-services`** — an RLS-denied `UPDATE` or `DELETE` is a **zero-row success**, not
  an error. Only `INSERT` raises. Tests must assert a refused write by re-reading the row with the
  service client; routes turn a null result into a 404.
- **`visits-d-attempts-appointments-and-participants`** — a composite `on delete set null` made
  visits undeletable. Check the new foreign keys' delete behaviour deliberately.
  Also: **a constant imported from a `"use client"` module reaches a Server Component as a
  function, not a string.** `page.tsx` must not import a value from `HouseholdCadenceControl.tsx`.
- **`visits-c-report-feed-and-cross-org`** — **SQL's `null = null` is NULL where JavaScript's is
  `true`.** Every org comparison added here needs an explicit null guard. And: each TanStack filter
  is its own cache key, so a write under one is invisible under another until reload.
- **`ai-d-corpus-scoping`** — a CHECK constraint that is silently inert. `array_length` returns
  NULL on `'{}'`. Write the new CHECKs so they can actually fail, and prove at least one does.
- **`seed-household-id-collision`** — `createHousehold` keys its id on the family name, so two
  households with the same name collide on the primary key. New seeds must pass explicit ids.

---

## Tasks

### Task 1: The cadence type and its arithmetic

**File:** `lib/visits/cadence.ts` (create)

**Action:** One pure module owning what "every 3 weeks" means. Client-importable — it may import
`lib/calendar/dates.ts` and `types/domain.ts` and **nothing else**, for the same reason
`lib/visits/householdStatus.ts` is constrained: `VisitProgressTable` renders from it.

**Details:**

```ts
export type Cadence = { amount: number; unit: CadenceUnit };

export const CADENCE_COMPARISON_ANCHOR: DateOnly = "2000-01-01";

export function addCadence(from: DateOnly, cadence: Cadence): DateOnly;
export function subtractCadence(from: DateOnly, cadence: Cadence): DateOnly;
export function compareCadences(left: Cadence, right: Cadence): number;
export function describeCadence(cadence: Cadence): string;
```

- `addCadence` dispatches on unit: `day` → `addDaysUtc(from, amount)`; `week` → `addDaysUtc(from,
  amount * 7)`; `month` → `addMonths(from, amount)`; `year` → `addMonths(from, amount * 12)`.
  A `year` is twelve months, not 365 days, so *every year* on 29 February behaves the way
  `addMonths` already decided it should.
- `subtractCadence` is `addCadence` with the amount negated. Both underlying helpers accept
  negatives; do not write a second implementation.
- `compareCadences` projects **both** cadences forward from `CADENCE_COMPARISON_ANCHOR` and
  compares the resulting `YYYY-MM-DD` strings. This is exact and takes no clock reading — a
  `new Date()` here would make validation non-deterministic. Comment why the anchor exists.
- `describeCadence` is uniform with no special cases: `"Every year"`, `"Every 3 weeks"`,
  `"Every 2 years"`, `"Every day"`. An `amount` of 1 drops the number and nothing else changes.

**`CADENCE_UNITS` lives in `types/domain.ts`** (Task 2), not here, because the SQL CHECK and the
Zod enum both read it.

---

### Task 2: Domain enums

**File:** `types/domain.ts` (modify)

**Action:** Delete the old vocabulary, add the new. The compiler is the migration tool — deleting
first makes every call site an error rather than a silent survival.

**Details:**

Remove entirely: `VISIT_CADENCES`, `VisitCadence`, `VISIT_CADENCE_LABELS`,
`HOUSEHOLD_VISIT_STATUSES`, `HouseholdVisitStatus`, `HOUSEHOLD_VISIT_STATUS_LABELS`.

Add:

```ts
export const CADENCE_UNITS = ["day", "week", "month", "year"] as const;
export type CadenceUnit = (typeof CADENCE_UNITS)[number];

export const CADENCE_UNIT_LABELS: Record<CadenceUnit, { one: string; many: string }> = {
  day:   { one: "day",   many: "days" },
  week:  { one: "week",  many: "weeks" },
  month: { one: "month", many: "months" },
  year:  { one: "year",  many: "years" },
};

// Highest priority first. The ORDER IS THE RANK — priorityRank() reads the index rather than
// carrying a second map that could disagree with this one.
export const VISIT_PRIORITY_BANDS = [
  "never_visited",
  "overdue",
  "approaching",
  "on_track",
] as const;
export type VisitPriorityBand = (typeof VISIT_PRIORITY_BANDS)[number];

export const VISIT_PRIORITY_BAND_LABELS: Record<VisitPriorityBand, string> = {
  never_visited: "Never visited",
  overdue: "Overdue",
  approaching: "Approaching",
  on_track: "On track",
};
```

A `Record` rather than a lookup with a fallback, for the same reason `VISIT_TYPE_LABELS` is one:
a band added later must not render as its own snake_case key.

---

### Task 3: Migration 050 — add and backfill

**File:** `supabase/migrations/050_visit_cadence_scale.sql` (create)

**Action:** Expand only. This migration drops nothing, so a currently-deployed build keeps
working while it is applied — the pattern migrations 046→049 established.

**Details:**

**3a. `visit_goals` gains five columns:**

```sql
alter table visit_goals
  add column cadence_amount integer,
  add column cadence_unit   text check (cadence_unit in ('day','week','month','year')),
  add column notice_amount  integer,
  add column notice_unit    text check (notice_unit in ('day','week','month','year')),
  add column deadline       date;
```

All nullable. `cadence_amount`/`cadence_unit` stay nullable so the existing `goalHasNoCadence`
state — a goal row carrying no usable interval — remains representable and keeps its honest
message. Add `check (cadence_amount is null or cadence_amount >= 1)` and the same for
`notice_amount`; a zero interval is overdue the moment it is saved.

Add a CHECK making amount and unit inseparable, so half a cadence is unrepresentable:

```sql
alter table visit_goals add constraint visit_goals_cadence_complete
  check ((cadence_amount is null) = (cadence_unit is null));
alter table visit_goals add constraint visit_goals_notice_complete
  check ((notice_amount is null) = (notice_unit is null));
```

**Prove this CHECK can fail** before moving on — `ai-d` shipped one that was silently inert.

**3b. Backfill every existing goal.** `deadline` takes `goal_period_end`; the cadence is
translated from the old pair; the notice window reproduces the outgoing `DUE_SOON_FRACTION = 0.8`
so no ward's numbers move on the day of the migration:

```sql
update visit_goals
set deadline = goal_period_end,
    cadence_amount = case cadence
                       when 'annual'   then 1
                       when 'biannual' then 6
                       when 'custom'   then cadence_months
                     end,
    cadence_unit   = case cadence
                       when 'annual'   then 'year'
                       else 'month'
                     end
where cadence is not null;

-- 20% of the interval, in DAYS, which has no edge case at any cadence length. A 12-month goal
-- gets 72 days; a 1-month goal gets 6. Both are strictly shorter than their cadence, which is
-- what lib/validation/visit.ts will require of anything saved from here on.
update visit_goals
set notice_amount = greatest(1, floor(
      (case cadence when 'annual' then 12 when 'biannual' then 6 else cadence_months end)
      * 30 * 0.2)::integer),
    notice_unit = 'day'
where cadence is not null;
```

`goal_period_start` is **not** carried anywhere. It was the anchor for a never-visited household,
and Decision 3 replaces that with a band that needs no anchor.

**3c. `households` gains the flag:**

```sql
alter table households
  add column do_not_contact boolean not null default false;
```

No policy change: `households` is in migration 019's ward-wide loop, so a new column inherits the
existing row policies. Say so in a comment — a reader should not have to check.

**3d. The join table:**

```sql
-- This organization's cadence for this household. Absent means "use the organization's goal".
--
-- org_id is NOT NULL, unlike visit_goals.org_id. A cadence is always some organization's
-- relationship to a household, and a null org_id would land in the hole `org_id =
-- current_org_id()` creates: null is never equal to null in SQL, so the row would be invisible
-- to its own author (plans/retros/talks-d-reliability-goals.md).
create table household_visit_cadences (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  household_id   uuid not null,
  org_id         uuid not null,
  cadence_amount integer not null check (cadence_amount >= 1),
  cadence_unit   text not null check (cadence_unit in ('day','week','month','year')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, org_id),
  foreign key (household_id, ward_id) references households (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  foreign key (created_by, ward_id) references users (id, ward_id)
);

alter table household_visit_cadences enable row level security;
```

`unique (household_id, org_id)` is the whole model in one line: one cadence per organization per
household, and the route upserts against it.

**`on delete cascade` on both parents is deliberate** — an override is meaningless without its
household or its organization, and `visits-d`'s retro records a composite `on delete set null`
that made visits undeletable. `created_by` has no delete clause and must stay nullable.

**3e. RLS, mirroring `visit_goals` exactly** — four policies, same predicate on all of them:

```sql
create policy household_visit_cadences_select on household_visit_cadences
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));
```

…and `_insert` (`with check`), `_update` (both), `_delete` (`using`) with the identical
expression. Do not widen the select for cross-org visibility: that setting widens reads of visit
*logs* only (migration 019), and a cadence is a configuration, not a report.

**3f. Index:** `create index household_visit_cadences_org_idx on household_visit_cadences
(ward_id, org_id);` — `readVisitProgress` fetches every override for one organization on every
dashboard load. Follow the naming in `018_indexes.sql`.

---

### Task 4: Migration 051 — contract

**File:** `supabase/migrations/051_drop_visit_goal_period.sql` (create)

**Action:** Drop what 050 replaced.

```sql
alter table visit_goals
  drop column cadence,
  drop column cadence_months,
  drop column goal_period_start,
  drop column goal_period_end;
```

**Do not apply this until the new code is deployed.** Write that in the migration's header
comment, not only here.

No index is dropped with them: `018_indexes.sql:29` indexes `visit_goals (ward_id)` only, and
nothing in the repo indexes `goal_period_start`. Checked rather than assumed.

---

### Task 5: Regenerate database types

**Action:** `npm run db:push` then `npm run db:types`.

`types/database.ts` is generated and never hand-edited (CLAUDE.md §5). Run this **between** the
migrations and the TypeScript tasks — everything below reads the generated `Update` and `Insert`
types, and `updateVisitGoal` builds its patch object against
`Database["public"]["Tables"]["visit_goals"]["Update"]`.

`npm run db:push` writes to the **hosted** project. There is no local stack (CLAUDE.md §9).

---

### Task 6: Validation

**File:** `lib/validation/visit.ts` (modify)

**Action:** Replace the cadence and period schemas.

**Details:**

- **Delete** `CADENCE_MONTHS`, `MAX_CADENCE_MONTHS`, `cadenceMonthsSchema`,
  `requireCoherentCadence` and `requireForwardPeriod`. The `annual`/`biannual`/`custom` triple and
  the whole "months only when custom" coherence problem go with them — an amount and a unit are
  always both present, so there is no second source of truth left to disagree.
- Add per-unit ceilings, so a typo cannot produce an interval nobody will live to see:

```ts
export const MAX_CADENCE_BY_UNIT: Record<CadenceUnit, number> = {
  day: 3650, week: 520, month: 120, year: 10,
};
```

- A shared `cadenceSchema` builder producing `{ amount, unit }`, refining `amount` against
  `MAX_CADENCE_BY_UNIT[unit]` with a message naming the unit.
- `createVisitGoalSchema`:

```ts
{
  title, orgId?, targetType: z.literal("all_households"),
  cadenceAmount, cadenceUnit,
  noticeAmount,  noticeUnit,
  deadline: dateOnlySchema.nullable().optional(),
}
```

  `goalPeriodStart` and `goalPeriodEnd` are **gone**. `orgId` keeps its existing header comment
  about being the one place a request may name an organization.
- `updateVisitGoalSchema` is the same fields, all optional, keeping the "Nothing was changed."
  refinement.
- **The one new refinement — the notice window must be strictly shorter than the cadence:**

```ts
// A notice window as long as the cadence makes EVERY household permanently "approaching", which
// is a dashboard that has stopped saying anything. Compared with compareCadences() rather than
// by converting to days, because 2 months and 60 days are not the same length and the comparison
// has to be the same one householdVisitPriority() will make.
```

  Apply it in both schemas' `superRefine`, guarding on all four fields being present — a partial
  patch cannot be checked here and is re-checked in the route against the merged row (Task 10).
- `deadline` gets no relation to the cadence. It is presentation only (Decision 1) and a deadline
  in the past is a legitimate record of one that passed.

---

### Task 7: Roster validation and queries

**Files:** `lib/validation/roster.ts`, `lib/roster/queries.ts` (modify)

**Details:**

- `createHouseholdSchema` gains `doNotContact: z.boolean().optional()`. It goes on the **create**
  schema even though nothing creates a do-not-contact household, because `updateHouseholdSchema`
  is `createHouseholdSchema.partial()` and `HouseholdForm` validates both paths with the create
  schema — adding it only to the update schema leaves the form unable to send it.
- `lib/roster/queries.ts`: add `doNotContact: boolean` to `Household`, `do_not_contact: boolean`
  to `HouseholdRow`, `do_not_contact` to `HOUSEHOLD_COLUMNS`, the mapping to `mapHouseholdRow`,
  and the conditional patch line to `updateHousehold` — matching the existing
  `...(input.address !== undefined ? ... : {})` shape exactly.

**Do not touch `DEFAULT_MEMBER_STATUSES` or `isVisitableHousehold`.** The household flag is a new,
separate axis: `isVisitableHousehold` still answers "does anybody live here", and do-not-contact
answers "may we call". Conflating them would make a do-not-contact household **vanish**, which
Decision 4 explicitly refused.

---

### Task 8: The priority scale

**File:** `lib/visits/householdStatus.ts` (modify — rewritten)

**Action:** Replace `householdVisitStatus()` with `householdVisitPriority()`. Keep the file name
and its client-importable constraint; keep the `asOf`-as-a-parameter discipline verbatim.

**Details:**

```ts
export type VisitPriority = {
  band: VisitPriorityBand;
  // Null for `never_visited` — there is no anchor to measure from, which is the whole reason
  // that band exists (Decision 3). Not clamped above 1: 1.4 means 40% past due, and the sort
  // uses it.
  elapsedFraction: number | null;
  dueOn: DateOnly | null;
  cadence: Cadence;
  cadenceSource: "household" | "goal";
};

export function householdVisitPriority(input: {
  lastCompletedOn: DateOnly | null;
  cadence: Cadence;
  cadenceSource: "household" | "goal";
  notice: Cadence;
  asOf: Date;
}): VisitPriority;
```

Order of evaluation:

1. `lastCompletedOn === null` → `never_visited`, `elapsedFraction: null`, `dueOn: null`. **First,
   and unconditionally.** It outranks `overdue` (Decision 3): a family nobody has ever visited is
   a different problem from one visited 13 months ago, and the scale should say so.
2. `dueOn = addCadence(lastCompletedOn, cadence)`.
3. `today >= dueOn` → `overdue`.
4. `noticeStartsOn = subtractCadence(dueOn, notice)`; `today >= noticeStartsOn` → `approaching`.
5. Otherwise `on_track`.

**The clamp.** If `compareCadences(notice, cadence) >= 0` the notice window swallows the whole
interval and every household would read `approaching`. Ignore the window entirely in that case —
no household reads `approaching`, and each is `on_track` or `overdue`. That is the safe direction:
a dashboard that under-warns is recoverable, one that flags everything has stopped saying
anything. `lib/validation/visit.ts` refuses to save such a goal, so this is reachable only from a
row written outside the app — the same class as the existing `interval <= 0` guard, which stays.
Surface it rather than swallowing it (Task 9's `noticeIgnored`).

`elapsedFraction = (today - lastCompletedOn) / (dueOn - lastCompletedOn)`, in milliseconds via
`parseDateOnly`, floored at 0 so clock skew between database and browser cannot go negative.

**Sorting:**

```ts
export function priorityRank(priority: VisitPriority | null): number;
export function compareByPriority(left, right): number;
```

`priorityRank` reads `VISIT_PRIORITY_BANDS.indexOf(band)` — the array order **is** the rank, so
there is no second map to drift. `null` sorts last (rank `VISIT_PRIORITY_BANDS.length`), covering
both an organization with no goal and a do-not-contact household.

`compareByPriority`: rank ascending, then **`elapsedFraction` descending** within a band so the
most-overdue household leads the overdue group, then `familyName.localeCompare` as the stable
tie-break — the discipline the current `compareByStatus` already has.

**`attempted_never_reached` does not come back.** It was a *reason*, not a position (scope part 5).
It is now expressible from data the row already carries: `attemptsSinceLastVisit >= 1` alongside
any band. No new field, and the table renders it as a mark beside the badge (Task 16).

---

### Task 9: The progress assembler

**File:** `lib/visits/progress.ts` (modify)

**Action:** Statistics instead of a banner tally; per-household cadence resolution; do-not-contact
exclusion. `buildVisitProgress` stays **pure** — that is what lets `tests/lib/visitProgress.test.ts`
run with no database, and the denominator is the one number on this page a ward has to trust.

**Details:**

Keep unchanged: `isVisitableHousehold` and its entire header comment, `tallyLogs`'s
completed-vs-attempted split, `countAttemptsSince`, and `readVisitProgress`'s org scoping and
pass-through of the caller's client.

**Delete:** `resolveCadenceMonths`, `withinPeriod`, and every `*ThisPeriod` field and counter.
`tallyLogs` loses its `periodStart`/`periodEnd` parameters and with them
`lastAttemptedInPeriodOn`, `visitCountThisPeriod` and `attemptCountThisPeriod`.

**`selectActiveGoal` simplifies to the most recently created goal for the organization:**

```ts
export function selectActiveGoal(goals: readonly VisitGoal[], orgId: string): VisitGoal | null;
```

The `today` parameter and the period-containment search both go. With no period there is nothing
to contain, and part 3 makes goals editable — so stacking a second goal to change one's mind, the
practice `selectActiveGoal` existed to disambiguate, is no longer how anybody does it. `goals`
arrives ordered `created_at desc` from `listVisitGoals` (Task 11) and this function still does not
re-sort: an order asserted in one place and assumed in another is the bug
`route-tests-and-realtime` records. Keep that comment, updated to name the new order.

**New shapes:**

```ts
export type VisitProgressRow = {
  householdId: string;
  familyName: string;
  lastVisitedOn: DateOnly | null;
  lastAttemptedOn: DateOnly | null;
  attemptsSinceLastVisit: number;
  doNotContact: boolean;
  // Null for THREE reasons: no goal, no usable cadence on the goal, or do-not-contact. The
  // table tells them apart from `doNotContact` and the progress-level `goal`, never by guessing.
  priority: VisitPriority | null;
  conductedBy: string | null;
};

export type VisitProgressStatistics = {
  counted: number;      // visitable AND not do-not-contact. The denominator.
  onTrack: number;
  approaching: number;
  overdue: number;
  neverVisited: number;
  excluded: number;     // do-not-contact. Shown on the page, counted in nothing.
  onTrackPercent: number;
};

export type VisitProgressGoalSummary = {
  id: string;
  title: string | null;
  cadence: Cadence;
  notice: Cadence;
  noticeIgnored: boolean;
  deadline: DateOnly | null;
};
```

`onTrack + approaching + overdue + neverVisited === counted` is an invariant worth a test.
`onTrackPercent` is `counted === 0 ? 0 : Math.round(onTrack / counted * 100)` — guarded, because
an organization whose households have all moved out has a total of zero and a percentage of
nothing is a division nobody wants to render.

`VisitProgress.banner` is **renamed** to `statistics`. Rename rather than keep both: two names for
one number is how the last contradiction started.

**Cadence resolution** — one exported function, because the table and the assembler must agree:

```ts
export function resolveHouseholdCadence(
  goalCadence: Cadence,
  override: HouseholdVisitCadence | undefined,
): { cadence: Cadence; source: "household" | "goal" };
```

`BuildVisitProgressInput` gains `householdCadences: readonly HouseholdVisitCadence[]`, indexed by
`householdId` into a `Map` once rather than searched per row.

**Do-not-contact rows get `priority: null` and are excluded from every count** but stay in `rows`
(Decision 4). Their `lastVisitedOn`, `lastAttemptedOn` and `conductedBy` are still computed and
shown — the record of what happened before the decision is exactly what the next presidency needs.

`readVisitProgress` adds a fourth parallel fetch, `listHouseholdVisitCadences(wardId, orgId,
client)` (Task 12), inside the existing `Promise.all`. Do not add a redundant org filter beyond
the one the caller asked for — the existing header explains why that would mask a policy
regression.

---

### Task 10: Goal routes

**Files:** `app/api/visit-goals/route.ts`, `app/api/visit-goals/[id]/route.ts` (modify)

**Details:**

- **POST** — the org-ownership block is unchanged and must stay: bishopric names an org and it is
  checked against `listWardOrganizations`; anyone else naming a different org is **refused, not
  silently overwritten**; an org leader with `orgId === null` gets a 409 with a sentence. Only the
  audit `detail` changes — swap `cadence`/`goalPeriodStart`/`goalPeriodEnd` for `cadenceAmount`,
  `cadenceUnit`, `noticeAmount`, `noticeUnit`, `deadline`.
- **PATCH** — delete both merged-coherence blocks (`mergedStart`/`mergedEnd`, and the
  `custom`-cadence pair). Replace with **one** merged check: build the merged cadence and merged
  notice from `input ?? existing`, and if both resolve, re-run the notice-shorter-than-cadence
  comparison. A partial patch can make a goal incoherent even when every field in the body is
  valid alone — that is why the check lives here as well as in the schema.
- Keep the header comment on PATCH explaining that `org_id` is not patchable, and the one on GET
  explaining that read is wider than write. Both are still true.
- Keep `assertCan(user, "visits.manage_goals", roleAccess)` on both writes. Do not add a role
  string comparison.

---

### Task 11: Goal queries

**File:** `lib/visits/queries.ts` (modify)

**Details:**

- `VisitGoal` becomes:

```ts
{
  id, orgId, title, targetType,
  cadence: Cadence | null,     // null is the goalHasNoCadence state
  notice: Cadence | null,
  deadline: DateOnly | null,
  createdBy, createdAt,
}
```

  Two nested objects rather than four flat columns, so a cadence cannot be half-passed to
  `addCadence`. `mapVisitGoalRow` assembles them, returning `null` when the amount is null — the
  CHECK in Task 3a guarantees amount and unit are null together, so one test suffices.
- `VISIT_GOAL_COLUMNS` — swap `cadence, cadence_months, goal_period_start, goal_period_end` for
  `cadence_amount, cadence_unit, notice_amount, notice_unit, deadline`. It stays an explicit list;
  the header explains that a column added later must not ride into a response nobody reviewed.
- `listVisitGoals` — order by `created_at desc` **only**. `goal_period_start` will not exist after
  051, and `selectActiveGoal` now depends on this order.
- `createVisitGoal` and `updateVisitGoal` — new column names. `updateVisitGoal` keeps its
  conditional-patch shape and its comment about a zero-row update being indistinguishable from an
  RLS refusal.
- `mapVisitGoalRow` keeps `toOptionalEnum` for `target_type` and gains it for the two unit
  columns: a value the CHECK should have made impossible means the constraint and `types/domain.ts`
  have drifted, and that is worth a crash rather than a silent cast.

---

### Task 12: Household cadence data layer

**File:** `lib/visits/householdCadences.ts` (create)

**Action:** Server-only CRUD for the join table, following `lib/visits/queries.ts` exactly —
explicit column list, explicit mapper, `resolveClient(client)`, `console.error` plus a thrown
sentence on every Supabase error. No `catch {}` anywhere (CLAUDE.md rule 7).

**Details:**

```ts
export type HouseholdVisitCadence = {
  id: string;
  householdId: string;
  orgId: string;
  cadence: Cadence;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listHouseholdVisitCadences(
  wardId: string, orgId: string, client?: SupabaseClient<Database>,
): Promise<HouseholdVisitCadence[]>;

export async function upsertHouseholdVisitCadence(
  wardId: string, householdId: string, orgId: string, cadence: Cadence,
  userId: string, client?: SupabaseClient<Database>,
): Promise<HouseholdVisitCadence | null>;

export async function deleteHouseholdVisitCadence(
  wardId: string, householdId: string, orgId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean>;
```

- `upsert` targets the `unique (household_id, org_id)` pair via
  `.upsert(row, { onConflict: "household_id,org_id" })` and sets `updated_at` explicitly.
- **A zero-row result is an RLS refusal, not an error** (`foundation-c-services`). `upsert` and
  `delete` both return null/false rather than throwing, and the route turns that into a 404.
- `delete` returns whether a row was removed, so "cleared" and "there was nothing to clear" are
  distinguishable to the caller.

This module is imported by `lib/visits/progress.ts`, which is already server-only below its
`readVisitProgress` line. It must **not** be imported by anything client-side.

---

### Task 13: The cadence-override route

**File:** `app/api/households/[id]/visit-cadence/route.ts` (create)

**Action:** `PUT` sets or replaces an override; `DELETE` clears it back to the organization's
baseline. `assertCan(user, "visits.manage_goals", roleAccess)` on both.

**Details:**

- A **separate route from the roster's household PATCH**, and this is the point of Decision 5: an
  org president holds `roster.view` but **not** `roster.manage`, so routing this through
  `PATCH /api/households/[id]` would either lock out the people who own the decision or hand them
  the entire roster. Each route keeps exactly one permission.
- `orgId` follows `POST /api/visit-goals` **verbatim** — bishopric must name one and it is checked
  against `listWardOrganizations`; anybody else naming a different org gets a 403, never a silent
  overwrite; an org leader with `user.orgId === null` gets a 409 with a sentence to act on.
- `DELETE` reads `orgId` from the query string. **Parse it with a Zod schema whose field names are
  checked against the fetch in `HouseholdCadenceControl.tsx`** — a parameter a handler does not
  read is silently ignored rather than refused (`roster-b`).
- Audit: `household_visit_cadence_set` and `household_visit_cadence_cleared`, module `"visits"`,
  detail carrying `householdId`, `orgId` and the cadence. Via `writeAuditLog()`, never inline.
- Resolve the session **outside** the `try` — `requireSessionUser()` redirects by throwing, and
  catching that turns a redirect into a 500.
- Return `{ cadence }` on `PUT` and `{ cleared: true }` on `DELETE`.

---

### Task 14: The goal panel gains an edit path

**File:** `app/(app)/visits/VisitGoalPanel.tsx` (modify)

**Action:** Part 3 — *"there is no edit path for a visit goal anywhere in the app"*. The route and
`updateVisitGoal()` have both existed since `visits-a`; only the UI is missing.

**Details:**

- Each listed goal gains an **Edit** button when `canManage`, opening the same form prefilled from
  that goal and `PATCH`ing to `/api/visit-goals/${goal.id}`. One form component, two modes,
  distinguished by an `editingGoalId: string | null` in state — following `HouseholdForm`'s
  `isEditing` shape rather than inventing a second one.
- The organization select is **disabled in edit mode** for everyone, bishopric included, because
  `org_id` is not patchable and offering a control the route refuses is worse than not offering it.
- `Draft` becomes `{ title, orgId, cadenceAmount, cadenceUnit, noticeAmount, noticeUnit, deadline }`.
  Cadence and notice each render as a number input beside a unit select.
- Default a **new** goal to `1 year` cadence with a `2 month` notice — the rolling shape is the
  default now (scope part 1), and these reproduce the outgoing behaviour.
- **Client-side, before the fetch:** run the same notice-shorter-than-cadence comparison the schema
  runs, using `compareCadences`. Validating with the same rule the route parses is
  `conventions.md §Validation`; if they diverge the form accepts what the server rejects and the
  user gets a failure with no field to fix.
- The goal list line changes from `"{org} · {cadence} · {start} to {end}"` to
  `"{org} · {describeCadence(cadence)} · warns {describeCadence(notice)} ahead"`, plus
  `" · by {deadline}"` only when a deadline is set.
- **Keep both refreshes after every save** — `router.refresh()` *and*
  `queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] })`. The existing comment
  explaining why `initialData` cannot do it alone stays, and now covers the edit path too.

---

### Task 15: The banner becomes statistics

**File:** `app/(app)/visits/VisitProgressBanner.tsx` (modify)

**Action:** Part 6. `"X of Y visited"` only meant something inside a period, so it goes with the
period.

**Details:**

- Props become `{ statistics, goal, goalHasNoCadence }`.
- **The goal reminder comes first**, above the numbers — scope part 6 asks for it explicitly, "so
  the numbers are read against their own definition rather than against an assumption". One
  sentence built from `describeCadence`: *"Every household, every year. Warning 2 months ahead."*
  Plus *"Aiming to finish by 24 December 2026."* when a deadline is set.
- Then four counts — **Overdue, Never visited, Approaching, On track** — in priority order, each a
  number over a label, wrapping at 375px. Overdue and never-visited carry `text-danger`;
  approaching `text-warning`; on-track `text-success`. Reuse the tokens already measured against
  `--surface-raised` in both themes by `visits-b`; do not introduce a filled pill, which would
  need its own second measurement per state.
- The percentage keeps the existing progress bar, now reading `onTrackPercent`, and stays
  `aria-hidden` — the sentence above already says the number, and a screen reader should not hear
  it twice.
- `excluded > 0` adds one quiet line: *"2 households marked do not contact are not counted."*
  Uncounted **and unhidden** is the decision; a number that silently shrank is what Decision 4
  refused.
- Keep both null-state messages and their distinction: "no goal has been set" and "the goal that
  is set cannot be counted" need different actions from the person reading. Add a third when
  `goal.noticeIgnored` — the notice window is not shorter than the cadence, so nothing reads
  "Approaching". Say it plainly rather than letting a band silently never appear.
- No `"use client"` — it renders no state and handles no events, and it must compile into
  `VisitProgressTable`'s bundle so the numbers refresh with the rows beside them.

---

### Task 16: The table shows a position, not a badge

**File:** `app/(app)/visits/VisitProgressTable.tsx` (modify)

**Details:**

- **Columns become:** Household · Last visited · Last attempted · **Due** · **Priority** ·
  Conducted by. `visitCountThisPeriod` is deleted along with its column; `Due` renders
  `priority.dueOn` and is far more actionable in its place.
- `STATUS_CLASSES` / `STATUS_MARKS` / `StatusBadge` become `BAND_CLASSES` / `BAND_MARKS` /
  `PriorityBadge` over the four bands. Keep the rule that made them work: **the mark is a shape,
  not a colour, and the word is always present** — five colours separate five states only for
  somebody who can see all five. Text glyphs, never emoji, which render in their own colour and
  fight the state colour.
  Suggested marks: `never_visited` `○`, `overdue` `!`, `approaching` `◑`, `on_track` `✓`.
- **The badge carries the fraction** when there is one: *"Overdue · 140%"*, *"On track · 35%"*.
  This is the redesign's whole point — *"a household at 95% and one at 10% no longer read as the
  same"*. `never_visited` shows no percentage, because there is none.
- **The attempts mark is separate from the band** (scope part 5). When
  `attemptsSinceLastVisit >= 1`, render a second small mark beside the badge — *"Attempted ×3"* —
  in `text-warning`. A household somebody has knocked on four times is a different problem from
  one nobody has been to, **at any level of urgency**, so it must not be a band.
- **Do-not-contact** renders its own neutral badge in the priority cell instead of a band, and the
  row gets a muted treatment. It stays in the list and stays sorted last.
- `statusRank` → `priorityRank`; the `status` sort column → `priority`, using `compareByPriority`
  so the sort agrees with the server's default order rather than approximating it.
- **Keep** the client-side sorting and its comment, `compareNullable`'s "a missing value always
  sorts last in both directions" rule, the md-breakpoint collapse to cards, and the org switcher.
  The card layout gains Due and drops Visits-this-period.

---

### Task 17: The per-row cadence control

**File:** `app/(app)/visits/HouseholdCadenceControl.tsx` (create)

**Action:** The control that makes part 4 reachable — *"they decide that a particular family needs
a little more attention than that"*.

**Details:**

- `"use client"`. Props: `{ householdId, orgId, cadence, source, canManage }`.
- When `source === "goal"` it reads as a quiet link — *"Every year (quorum default)"* — that opens
  a small amount + unit editor. When `source === "household"` it shows the override and offers
  **Use the quorum's cadence** alongside, which `DELETE`s.
- Absent entirely when `!canManage`. `canManage` is resolved **once on the server** from
  `can(user, "visits.manage_goals", roleAccess)` and passed down. A client component never
  re-derives a permission — it has no role access to resolve against, and a second answer that
  disagreed with the route's would offer a control the API refuses.
- After every write: `queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] })`.
  This is the mutation `visits-b` got wrong twice. Note that **the round trip takes ~3.7 s** — do
  not add an optimistic update to hide it without also handling the failure path.
- `VisitProgressTable` renders it in the priority cell (and the card's cadence line), which means
  `VisitProgressTable` needs `canManageGoals` threaded from `page.tsx`.
- **`page.tsx` must not import any value from this file** — a constant imported from a
  `"use client"` module reaches a Server Component as a function rather than a string, which is
  the bug that made `visits-d`'s "Log this visit" flow silently dead.

---

### Task 18: Do-not-contact in the roster and the picker

**Files:** `components/roster/HouseholdForm.tsx`, `app/(app)/visits/page.tsx` (modify)

**Details:**

- `HouseholdForm` gains a checkbox, *"Do not contact this household"*, with helper text naming
  the consequence: *"The family stays on the roster and stays visible on the visit dashboard. It
  is left out of every visit statistic."* Wire it into the existing `createHouseholdSchema`
  `safeParse` call and the request body. It is written under `roster.manage`, which is what the
  existing route already asserts — no permission change.
- `page.tsx`: the household picker keeps offering do-not-contact households but **labels them** —
  `"Sorensen (do not contact)"`. Removing them would make the picker and the dashboard's row list
  disagree, and both this file and `lib/visits/progress.ts` carry a comment insisting the two must
  not drift. Marking keeps one predicate and one list, and a leader who must record an unavoidable
  contact can still do it.
- Thread `canManageGoals` into `<VisitProgressTable>` for Task 17.

---

## Testing Strategy

Priority order follows CLAUDE.md §8: RLS first, then pure functions, then routes.

### `tests/rls/household-visit-cadences.test.ts` (create)

The highest-value file here — a brand-new table with a brand-new policy.

- An EQ leader reads and writes only their own org's overrides.
- **An RS leader cannot read EQ's override for the same household** — the case the join table
  exists for, and the one a `households` column could not have expressed.
- A leader of ward B cannot read or write ward A's rows at all.
- The bishopric reads and writes every org's.
- An `INSERT` naming another org **raises**; an `UPDATE` or `DELETE` across orgs is a **zero-row
  success**, so assert it by **re-reading the row with the service client** (`foundation-c-services`).
- `unique (household_id, org_id)` refuses a second row for the same pair.
- The `cadence_amount >= 1` and `cadence_unit` CHECKs both actually reject — `ai-d` shipped an
  inert CHECK and nobody noticed.

Seed with the service-role client, assert with an authenticated one, and **clean up in `afterAll`**:
these run over the network against a shared hosted project and cannot assume an empty table
(CLAUDE.md §9).

### `tests/lib/visitCadence.test.ts` (create)

- `addCadence` for all four units, including `every 1 month` from 31 January (`addMonths` clamps)
  and `every 1 year` from 29 February.
- `subtractCadence` round-trips `addCadence` where the calendar allows, and the cases where it
  does not are asserted explicitly rather than assumed.
- `compareCadences`: `2 months` vs `60 days`, `1 year` vs `12 months` (equal), `52 weeks` vs
  `1 year` (not equal).
- `describeCadence` for `amount === 1` and `amount > 1` in every unit.

### `tests/lib/householdStatus.test.ts` (modify — largely rewritten)

**Build every boundary from the arithmetic, never from a transcribed date.** `visits-b`'s retro
records that the plan's own 80% dates were a day or two out, and a transcribed boundary is a test
quietly checking 80.3%.

- Each of the four bands, at and either side of its boundary.
- `never_visited` outranks `overdue` (Decision 3) — assert the rank order directly.
- The notice clamp: `notice >= cadence` produces **no** `approaching` row.
- `elapsedFraction` is floored at 0 for a future `lastCompletedOn`, and exceeds 1 when overdue.
- `compareByPriority` puts the most-overdue household first inside the overdue band.
- A household override changes the band without the goal changing, and `cadenceSource` says which
  cadence was used.

### `tests/lib/visitProgress.test.ts` (modify)

Keep every existing denominator case — they are independent of the goal's shape and they are the
reason this file exists. Add:

- A do-not-contact household **appears in `rows`** and is in **no** statistic; `excluded` counts it.
- `onTrack + approaching + overdue + neverVisited === counted`, as an invariant across a mixed
  fixture.
- `onTrackPercent` is 0, not `NaN`, when `counted === 0`.
- An override for org A does not affect org B's rows for the same household.
- `selectActiveGoal` returns the most recently created goal and does not re-sort its input.

### `tests/lib/visitValidation.test.ts` (modify)

- A goal with no deadline parses. A goal with a past deadline parses (it is a record, not a bound).
- `noticeAmount`/`noticeUnit` equal to or longer than the cadence is **refused**, in both the
  create and the update schema.
- `2 months` notice against a `60 day` cadence is refused — proving the check uses
  `compareCadences` and not a day approximation.
- Each unit's ceiling from `MAX_CADENCE_BY_UNIT`, and `amount: 0`.
- No schema anywhere accepts a `wardId`.

### `tests/routes/householdVisitCadence.test.ts` (create)

Use `tests/helpers/routeClient.ts`; **read its header comment first** — it documents the `vi.mock`
hoisting trap. Only the client factory is mocked, so every query still runs as a genuinely
authenticated user and a passing test proves the policy allowed it.

- EQ president sets an override for their own org: 200, and the row is really there.
- EQ president naming Relief Society: **403**, and re-read to prove nothing was written.
- Bishop sets one for any org: 200.
- Bishop with no `orgId` in the body: 400 with a sentence.
- Org leader whose `user.orgId` is null: 409.
- **`org_secretary` gets 403** — it holds `visits.view` and `visits.create` but not
  `visits.manage_goals`. Check the matrix in `lib/auth/permissions.ts` rather than intuition; it is
  not always the intuitive answer.
- `DELETE` clears the override; a second `DELETE` reports nothing to clear rather than 500ing.
- Every success writes an audit row.
- `params` is a Promise in Next 16: `PUT(request, { params: Promise.resolve({ id }) })`.

### `tests/routes/visits.test.ts`, `tests/routes/visitsProgress.test.ts`, `tests/rls/visit-cross-org.test.ts` (modify)

Update the goal fixtures to the new shape. **`visit-cross-org.test.ts` must keep proving that
cross-org visibility widens visit-log reads only** — it must not have started widening cadence
reads. Add that assertion; it is the kind of thing a new table quietly rides along on.

---

## Test Scenarios (Harness)

Two new scenarios, and six existing seeds that must be updated to keep running.

### Scenario 045: The priority scale and its cadences

**Tags:** `visits`, `smoke`, `dashboard`, `cadence`

**Purpose:** Every band boundary needs a household at a precise distance from a precise cadence,
and two organizations need different cadences for the *same* family at the same time. Neither is
arrangeable by hand, and both are exactly what the numbers on this page depend on.

**Seed data summary:**
- Ward — Harness Test Ward, cross-org visibility OFF.
- Users — bishop, EQ president, EQ secretary, RS president.
- Goal (EQ) — **no dates**, every 1 year, warning 2 months ahead.
- Goal (RS) — every 3 months, warning 2 weeks ahead. Proves a short cadence renders sensibly.
- Households, all seeded with **explicit ids** (`seed-household-id-collision`):
  - Brooks — visited 30 days ago → **On track ~8%**
  - Okonkwo — visited 320 days ago → **Approaching** (past 10 months of 12)
  - Halvorsen — visited 400 days ago → **Overdue ~110%**
  - Ferreira — 3 attempts, never a completed visit → **Never visited**, marked *Attempted ×3*
  - Nakamura — nothing at all → **Never visited**, no attempts mark
  - **Whitfield** — visited 100 days ago, **EQ override of every 3 months** → **Overdue** for EQ
    while the goal alone would read On track. The single most important row in the scenario.
  - Delgado — all members `moved_out` → **absent entirely**
  - Sorensen — `do_not_contact: true`, one active member, visited 500 days ago → **present,
    marked, in no statistic**

**Tester action:** Sign in as EQ president, read the banner sentence before the numbers, then the
six visible rows. Change Whitfield's cadence back to the quorum default and watch both the row and
the banner move without a reload. Switch to 375px. Switch to dark. Sign in as the bishop, switch
to Relief Society, confirm Whitfield reads differently there than it did for EQ.

**Verification checklist:**
- [ ] The banner's first line states the goal in words, before any number.
- [ ] Overdue + Never visited + Approaching + On track equals the counted total, and Sorensen is
      in none of them.
- [ ] Sorensen is visible, marked do-not-contact, and named in the "not counted" line.
- [ ] Delgado does not appear, and is not in the total.
- [ ] Whitfield reads **Overdue** for Elders Quorum and **On track** for Relief Society, at the
      same moment.
- [ ] No cell anywhere on the page reads "Visited".
- [ ] Ferreira reads Never visited **and** carries an attempts mark; Nakamura reads Never visited
      with none.
- [ ] Clearing Whitfield's override updates the row and the banner **without a reload** (allow the
      full ~3.7 s round trip before judging it stale).
- [ ] Every band's mark is distinguishable with the display set to greyscale.
- [ ] At 375px every row still shows its band and its due date.

### Scenario 046: Editing a goal, and who may

**Tags:** `visits`, `full`, `goals`, `permissions`

**Purpose:** Part 3 — there has never been an edit path, and scenario 040's step 8 assumed one.
This also pins the permission split Decision 5 introduced, which no unit test can show as a
*screen*: an org secretary must see the goal and no controls, and an EQ president must be able to
set a household's cadence without holding `roster.manage`.

**Seed data summary:**
- One EQ goal — every 1 year, warning 2 months ahead, title "Visit every family".
- Users — EQ president (`visits.manage_goals`), **EQ secretary** (`visits.view` only), bishop.
- Four households at known distances, chosen so a cadence change moves at least two between bands.

**Tester action:** As EQ president, edit the goal from *every 1 year* to *every 6 months* and watch
the statuses above move. Change the notice window to 1 month and watch the Approaching count
shrink. Try to set a notice window of 1 year. Then sign in as the EQ secretary and look for every
control. Then as the bishop, edit Relief Society's goal.

**Verification checklist:**
- [ ] The goal edits **in place** — no second goal appears in the list.
- [ ] The dashboard recomputes after the save without a reload.
- [ ] A notice window equal to or longer than the cadence is refused, with a message naming the
      field.
- [ ] The organization select is disabled while editing, for the bishop too.
- [ ] The EQ secretary sees the goal, sees "View only — your role does not set goals", and has no
      Edit button and no cadence control on any row.
- [ ] The EQ president can set a household cadence, and still gets "not permitted" on `/roster`
      edit controls — the two permissions stayed separate.
- [ ] The bishop can edit Relief Society's goal and Relief Society's household cadences.

### Existing seeds to update

`scenario-038`, `039`, `040`, `042`, `043` and `044` all pass `goalPeriodStart`/`goalPeriodEnd` to
`createVisitGoal`. Update each to the new shape. **Scenario 040 needs more than a rename** — its
whole premise is the five buckets, and its step 8 works around the missing edit path. Rewrite its
seed and its `scenario.md` against the four bands, and cut step 8's workaround now that Edit
exists. Regenerate the manifest afterwards.

### Harness infrastructure

- `createVisitGoal` — replace `cadence`/`cadenceMonths`/`goalPeriodStart`/`goalPeriodEnd` with
  `cadenceAmount`/`cadenceUnit`/`noticeAmount`/`noticeUnit`/`deadline`. Keep the header comment's
  discipline: a fixture must not be able to express a state the app cannot create.
- `createHousehold` — add `doNotContact?: boolean`.
- **`createHouseholdVisitCadence`** — new, taking `{ householdId, org, cadenceAmount, cadenceUnit }`.
- `testing/infrastructure/types.ts` — replace the `VisitCadence` re-export with `CadenceUnit`.
- Regenerate: `npm run manifest`.

---

## Validation Commands

Run in this order. Do not skip a step; do not continue past a failure.

```bash
# 1. Apply the additive migration to the hosted project (there is no local stack)
npm run db:push

# 2. Regenerate the database types the whole TypeScript layer reads
npm run db:types

# 3. Lint
npm run lint

# 4. Type check the app
npm run typecheck

# 5. Type check the harness — a separate tsconfig, and it WILL break on the seed changes
npm run harness:typecheck

# 6. Tests
npm run test

# 7. Regenerate the scenario manifest
npm run manifest

# 8. Production build. Lint, typecheck and tests can all pass while this fails:
#    static generation runs code the dev server never does.
npm run build
```

**Migration 051 is applied separately, after the new code is deployed.** Re-run `npm run db:types`,
`npm run typecheck` and `npm run test` after it.

---

## Integration Notes

### Phase 8 is the reason for the sequencing

`plans/visits-b-progress-dashboard.md` §Integration Notes records that **youth-activity coverage
has the same due/overdue-against-a-cadence shape and will reuse `householdVisitStatus`**. That is
why ITER-018 runs before Phase 8 and not after.

Hand forward deliberately: `lib/visits/cadence.ts` and `householdVisitPriority()` name nothing
visit-specific in their parameters — `lastCompletedOn`, not `lastVisitedOn`. Phase 8 should import
them rather than write a second meaning of "overdue". If a third module wants them, that is the
moment to lift `cadence.ts` out of `lib/visits/` — not before, and not as part of this work.

### Breaking changes

- **`VisitProgress.banner` is renamed to `statistics`** and its shape is entirely different. Any
  reader outside this module breaks at compile time, which is the intent.
- **`HouseholdVisitStatus` and `VisitCadence` are deleted from `types/domain.ts`.** Deleting before
  adding makes the compiler enumerate every call site instead of letting one survive silently —
  the technique `role-access-overrides` used to find 25 permission checks that ignored the ward's
  override.
- **`GET /api/visits/progress` changes its response shape.** It is consumed only by
  `VisitProgressTable`, which ships in the same deploy.

### Deploy order

1. `npm run db:push` — migration 050, additive, safe against the running build.
2. Deploy the application.
3. Apply migration 051 — the drops.

Between 1 and 2 the live build reads the old columns, which still exist. Between 2 and 3 the new
build reads the new columns, which exist. **051 before the deploy would take `/visits` down.**

### Documentation to update in the same change

- **`CLAUDE.md` §9** — the ITER-018 line and, if the visit-goal model is mentioned anywhere in the
  non-negotiables, there. A spec that disagrees with the code is the failure mode §1 names.
- **`plans/07-visits.md` §Step 4** — describes the dated-period model this replaces.
- **`FEATURES.md` §Module 9** — the user-facing description of a visit goal.
- **`SPEC.md`** — the `visit_goals` schema and the new `household_visit_cadences` table.
- **`plans/INDEX.md`** — add this plan.

If any of those turn out to be right and this plan wrong, flag it and change the plan — the specs
win unless the spec is the thing that is wrong (CLAUDE.md §1).

### What this deliberately does not do

- **No geocoding and no map.** Still an open decision in CLAUDE.md §9, and untouched here.
- **No per-household cadence on the roster page.** It is an organization's setting, and the roster
  has no organization context to set it in.
- **No notification when a household goes overdue.** Phase 11 owns notification UI; a cadence that
  pushes would be a new trigger and a new opt-out, which is its own slice.
- **No back-fill of `attempted_never_reached` as a band.** It is a reason, not a position (scope
  part 5), and it is now expressible from `attemptsSinceLastVisit` alongside any band.
