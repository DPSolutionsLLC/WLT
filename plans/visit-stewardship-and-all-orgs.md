# Plan: Visit Stewardship and the All-Organizations View

**Created:** 2026-08-27
**Type:** feature
**Scope refs:** ITER-019
**Structure:** Unified — one table, one scope module, and one new page. The stewardship model and
the all-orgs view are the two halves of a single question ("which households are ours?") and the
second is what makes the first safe, by surfacing the households the first can hide.

## Overview

Every organization is currently measured against **every visitable household in the ward**. The
Primary will only ever visit families with a child in Primary, so its dashboard reads "3 of 200"
for ever. This adds a **per-organization stewardship** — which households are ours to visit — and
an **all-organizations view** that shows every household once with each organization's standing
beside it.

### The three reasons a household is not counted, which must stay distinct

| Reason | Question | Scope | Mechanism |
|---|---|---|---|
| No active members | "Does anybody live here?" | Ward-wide fact | `isVisitableHousehold()` — absent from the page |
| Do not contact | "May we call on them?" | Ward-wide pastoral fact | `households.do_not_contact` — **shown, marked, counted in nothing** |
| **Not our stewardship** | "Are they ours to visit?" | **Per organization** | **NEW** — `household_stewardships`, absent from the org's dashboard entirely |

Collapsing any two of these loses information a presidency needs. In particular: a do-not-contact
household is *shown and marked* (ITER-018 Decision 4), and a non-stewardship household is *gone*.
They look different on purpose, because they are different.

### Decisions taken (answering the scope's six open questions)

**D1 + D2 — Stored list, with a visible drift banner.** One table, `household_stewardships
(household_id, org_id)` unique. **Zero rows for an organization means the whole ward** — so the
Elders Quorum's dashboard is byte-identical on the day this ships, which an opt-in default could
not deliver. This is the same absent-means-default idiom as `household_visit_cadences`. The
Primary narrows in one press: a "Match my organization's members" control derives the list from
`member_organizations` and writes the rows. Staleness is made **visible rather than silent** — a
live drift banner compares the stored set against the current derivation on every load and offers
a one-press reconcile. Derivation is deliberately **not** the storage model: an Elders Quorum's
stewardship is a hand-drawn ministering district, not "households containing an elder", so a
derived-basis model would be built around the minority case.

**D3 — A non-stewardship household disappears from that organization's dashboard.** There is
nothing for an organization to hand the next presidency about a family that was never theirs. The
pastoral failure mode this creates — a household in *no* organization's stewardship, invisible to
everyone — is caught by the all-organizations view, which renders such a row visibly unclaimed and
sorts it to the top. No separate screen, no third badge state on every org row.

**D4 — Written under `visits.manage_goals`, on its own route.** Identical to the cadence route
(ITER-018 Decision 5): an org president owns this decision and does not own the roster. The
bishopric may set it for any organization and must say which. `resolveOrgId()` from
`app/api/households/[id]/visit-cadence/route.ts` is reused **verbatim**.

**D5 — The all-orgs row shows ward-wide facts plus per-organization bands.** Per household: the
most recent **completed** visit across every organization, who went, and which organization went —
the question no org-scoped query can answer today — then one chip per organization that has
claimed the household, showing its band. Sorted unclaimed-first, then by the most urgent band.

**D6 — Cross-org visibility shares FACTS, never JUDGEMENTS.** This is the sharp one, and it
**extends** ITER-018's decision rather than reversing it. Confirmed during research:
`ward_allows_cross_org_visibility()` today appears on `visit_logs_select` **and nowhere else** —
`visit_goals_select` and `household_visit_cadences_select` are both plain
`is_bishopric() or org_id = current_org_id()`.

- **Widened by the setting:** `household_stewardships_select`. Whose stewardship a family is in is
  a fact about *coverage*, and coverage is the thing the all-orgs view exists to expose.
- **Untouched, still narrow:** `household_visit_cadences_select`, `visit_goals_select`. What
  interval we hold a family to, and whether we think we are behind, is a presidency's private
  judgement. `tests/rls/visit-cross-org.test.ts` keeps passing unchanged on both.

The consequence falls out of the policies rather than out of application branching: with the
setting on, an org leader sees every household once with ward-wide visit facts and **their own**
organization's band; the bishopric additionally sees every organization's band, because they can
already read every goal and every cadence. **No `if (isBishopric)` decides what is readable** —
the query returns the right rows (CLAUDE.md rule 2).

### Success criteria

1. The Primary narrows to households with a Primary child in **one press**, and its dashboard
   denominator becomes that number.
2. The Elders Quorum's dashboard is **unchanged** on ship day, having narrowed nothing.
3. A household outside an organization's stewardship is in **no numerator and no denominator** for
   that organization, and is visibly a different thing from do-not-contact.
4. The banner **says out loud** that the denominator is narrowed and by how much — a number that
   silently shrank is exactly what ITER-018 Decision 4 refused.
5. With cross-org visibility on, one view shows every household once with each organization's
   standing beside it.
6. A household in **no** organization's stewardship sorts to the top of that view, marked.
7. `npm test` green, including the unchanged cross-org RLS assertions on cadences and goals.

---

## Relevant Files

**Create**
- `supabase/migrations/052_household_stewardships.sql` — the table, its RLS (select widened, writes
  not), and its index.
- `lib/visits/stewardshipScope.ts` — the **pure, subject-agnostic** resolution. Names neither
  households nor visits, so Phase 8 youth coverage imports it unchanged.
- `lib/visits/stewardship.ts` — server-only queries against the table.
- `lib/visits/allOrgProgress.ts` — the all-organizations assembly, pure half plus a thin read.
- `app/api/households/[id]/stewardship/route.ts` — PUT adds one household, DELETE removes it.
- `app/api/visits/stewardship/route.ts` — GET returns the set plus the drift; PUT replaces the set
  wholesale; DELETE stops narrowing.
- `app/(app)/visits/StewardshipPanel.tsx` — the narrowing control and the drift banner.
- `app/(app)/visits/all-organizations/page.tsx` — the new page.
- `app/(app)/visits/AllOrganizationsTable.tsx` — client component, client-side sorting.
- `tests/lib/stewardshipScope.test.ts`, `tests/lib/allOrgProgress.test.ts`,
  `tests/rls/household-stewardships.test.ts`, `tests/routes/householdStewardship.test.ts`,
  `tests/routes/visitStewardship.test.ts`
- `testing/scenarios/visits/scenario-047-narrowing-a-stewardship/{scenario.md,seed.ts}`
- `testing/scenarios/visits/scenario-048-every-organization-at-once/{scenario.md,seed.ts}`

**Modify**
- `lib/visits/progress.ts` — a fifth parallel fetch; the denominator gains the stewardship filter;
  `VisitProgress` gains a `stewardship` block; a new shared `describeHouseholdForVisits()` helper.
- `lib/visits/householdCadences.ts` — add `listWardVisitCadences(wardId, client)` for the all-orgs
  read (the existing function takes an `orgId`).
- `lib/validation/visit.ts` — four new schemas.
- `app/(app)/visits/page.tsx` — render `StewardshipPanel`; link to the new page when it is
  reachable; **the household picker consumes the new shared helper** instead of re-deriving.
- `app/(app)/visits/VisitProgressBanner.tsx` — say the denominator is narrowed, and by how much.
- `app/(app)/visits/VisitProgressTable.tsx` — lift `BAND_CLASSES` / `BAND_FILL` / `BAND_MARKS` into
  a shared module so the new table cannot drift from this one.
- `types/database.ts` — regenerate (`npm run db:types`), never hand-edit.
- `tests/lib/visitProgress.test.ts` — every `buildVisitProgress` call gains the new input.
- `tests/rls/visit-cross-org.test.ts` — **add** an assertion that stewardship DOES widen; leave the
  cadence and goal assertions untouched, and say in a comment that the contrast is the decision.
- `tests/routes/visitsProgress.test.ts` — one end-to-end denominator case.
- `tests/helpers/seed.ts` / `testing/infrastructure/seedUtils.ts` — a stewardship seed helper.

---

## Dependencies

No new libraries. Everything reuses what is already here:

- `listHouseholds(wardId, { organizationId })` in `lib/roster/queries.ts` **already implements the
  derivation** — it narrows the members it attaches, not the households it returns, so a household
  whose `members` array is non-empty under that filter is precisely a household containing an
  active member of that organization. No new query is needed for "Match my organization's members".
- `resolveOrgId()` in `app/api/households/[id]/visit-cadence/route.ts` — the bishopric-must-name-an-org
  rule, reused verbatim rather than re-derived.
- `ward_allows_cross_org_visibility()` (migration 019) — the SQL function already exists.
- `householdVisitPriority()` / `compareByPriority` in `lib/visits/householdStatus.ts` — the bands.
- `writeAuditLog()`, `assertCan()`, `respondToRouteError()`, `readJsonBody()`.

**Configuration:** migration 052 is applied with `npm run db:push`, then `npm run db:types`.
`HELD_BACK_UNTIL_DEPLOYED` in `tests/db/migrations.test.ts` is currently `{}` and **stays empty** —
052 is purely additive (no drops, no column removals), so it is safe to apply before the deploy and
this is **not** an expand-and-contract slice. Do not add an entry.

---

## Known Pitfalls (from retro context)

- **`visits-e-cadence-and-priority`** — *"Cross-org visibility was deliberately NOT widened to the
  new table."* This plan widens the **new** table and leaves cadences and goals alone. The
  migration must explain the contrast in its own header, or the next reader will read it as the
  decision being forgotten rather than drawn.
- **`visits-e-cadence-and-priority`** — the cadence control shipped as a **176×16 tap target**,
  failing the 44×44 rule every other control on the page keeps. The stewardship controls are the
  primary controls this slice adds. Use `min-h-11` (the `SELECT_CLASSES` idiom already in
  `VisitProgressTable.tsx`) on every new button, checkbox row, and select.
- **`visits-e-cadence-and-priority`** — a layout measurement lied because the viewport had silently
  reset to 412px, measuring the `md:`-hidden desktop table. **Check `window.innerWidth` before
  trusting any layout measurement during the walk.** Also: kill any stale dev server on port 3000
  before observing anything — that trap has now bitten twice.
- **`visits-b-progress-dashboard`** — *"Counting households an organization cannot visit makes
  every org look behind and erodes trust in the number."* This slice is that lesson applied a
  second time. The mirror risk is new: a denominator that shrinks **without saying so** is the same
  erosion in the other direction, which is why `stewardship.outOfScope` is reported and rendered.
- **`roster-b-picker-and-orgs`** — *a query parameter a handler does not read is silently IGNORED,
  not refused.* Every new Zod schema field must be checked against the exact name the fetch sends.
  This bit the cadence route's `?orgId=` and is called out in its header.
- **`roster-b-picker-and-orgs`** — the household count must not move underneath somebody applying a
  filter. Stewardship is a fourth axis over the same list; keep it out of `listHouseholds()`.
- **`foundation-c-services`** — *an RLS-denied UPDATE or DELETE is a zero-row success, not an
  error.* Only INSERT raises. Every write helper must report **whether a row moved**, and every
  route test asserting a refusal must **re-read with the service client**.
- **`talks-d-reliability-goals`** — a null `org_id` row is invisible to its own author under
  `org_id = current_org_id()`, because null is never equal to null. `org_id` is `NOT NULL` on the
  new table for exactly this reason, and the route refuses an org leader with no organization.
- **`ai-d-corpus-scoping`** — a CHECK constraint that was silently inert. This migration adds no
  expression-based CHECK, but **verify the unique constraint genuinely rejects a duplicate**
  against the hosted project before moving on.
- **`calendar-a-rules-and-api`** — a select-list built with `+` concatenation widens the type to
  `string` and defeats supabase-js's literal parsing. One string literal on one line, and never
  `select("*")`.
- **`route-tests-and-realtime`** — an order asserted in one place and assumed in another is a bug;
  and these tables are shared by every suite running against the hosted project, so **order
  explicitly** and **clean up after yourself**.
- **`seed-household-id-collision`** — harness seeds must not collide on household ids across
  scenarios; follow the existing `runId` suffix convention in `testing/infrastructure/seedUtils.ts`.
- **`role-access-overrides`** — never compare `user.role` to a string to decide a permission. Use
  `assertCan(user, "visits.manage_goals", roleAccess)`. `BISHOPRIC_ROLES` membership is a different
  question (which organization may I name?) and is the only legitimate role comparison here.
- **`auth-b-invites-admin`** — a `ForbiddenError` escaping a Server Component becomes a 500 whose
  message Next strips in production. Pages use `can()`, routes use `assertCan()`.
- **ITER-007 (open in the backlog)** — a permission whose only UI sits behind a nav link the holder
  cannot see is a dead permission. Do not render the all-organizations link when the page would
  refuse.

---

## Tasks

### Task 1: The migration

**File:** `supabase/migrations/052_household_stewardships.sql` (create)

**Action:** Create `household_stewardships`, enable RLS, add three policies and one index.

**Details:**

```sql
create table household_stewardships (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  household_id uuid not null,
  org_id       uuid not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),

  unique (household_id, org_id),

  foreign key (household_id, ward_id) references households (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  foreign key (created_by, ward_id) references users (id, ward_id)
);

alter table household_stewardships enable row level security;
```

- Mirror `household_visit_cadences` (migration 050 §3d) **structurally and in its comment
  discipline**. `on delete cascade` on both parents; `created_by` nullable with no delete clause,
  so releasing a leader does not take their organization's stewardship with it.
- `org_id` is `NOT NULL` — same reason as the cadence table; cite `talks-d-reliability-goals`.
- **There is no UPDATE policy, and that is deliberate.** Membership is presence or absence; the row
  carries no payload to update. Write a comment saying so, so its absence reads as a decision. The
  bulk replace uses `ON CONFLICT DO NOTHING` (supabase-js `ignoreDuplicates: true`), which is an
  INSERT and needs no UPDATE policy.
- **The SELECT policy is widened; the write policies are not.** This is the D6 contrast and the
  header must carry the reasoning in full — that `ward_allows_cross_org_visibility()` sits on
  `visit_logs_select` and now here, and pointedly **not** on `visit_goals_select` or
  `household_visit_cadences_select`, because this table records a fact about coverage and those
  record a presidency's judgement.

```sql
create policy household_stewardships_select on household_stewardships
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id() or ward_allows_cross_org_visibility())
  );

create policy household_stewardships_insert on household_stewardships
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy household_stewardships_delete on household_stewardships
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create index household_stewardships_org_idx on household_stewardships (ward_id, org_id);
```

- The index serves both reads: the org dashboard filters `(ward_id, org_id)` exactly, and the
  all-orgs view filters on the `ward_id` prefix. Naming follows `018_indexes.sql`.
- **No backfill, and say so in a comment.** Zero rows is the "whole ward" default, so an empty
  table is the correct post-migration state and every existing dashboard is unchanged.

---

### Task 2: The pure scope module

**File:** `lib/visits/stewardshipScope.ts` (create)

**Action:** The subject-agnostic resolution and drift comparison. **No import of
`createServerSupabaseClient`, and no import of anything that imports it.**

**Details:**

- This file follows the split `lib/roster/organizationScope.ts` established: it exists **because**
  `lib/visits/stewardship.ts` imports the server client and therefore `next/headers`, which would
  make any client component importing it unbuildable. This file imports types and nothing else.
- **It names neither households nor visits in its parameters** — `subjectId`, not `householdId` —
  because Phase 8 youth-activity coverage asks the identical question about youth. This is the
  same discipline `lib/visits/cadence.ts` and `householdVisitPriority()` already keep, and the
  header must say so, so nobody "tidies" the names to be visit-specific.

```ts
export type StewardshipScope = {
  // FALSE means this organization has narrowed NOTHING and everything is in scope.
  // It is NOT the same as an empty `subjectIds`, which would mean it has narrowed to nothing.
  // Absence of rows is the default, exactly as it is for a household cadence override.
  hasNarrowed: boolean;
  subjectIds: ReadonlySet<string>;
};

export function toStewardshipScope(subjectIds: readonly string[]): StewardshipScope;
export function isInScope(scope: StewardshipScope, subjectId: string): boolean;

export type StewardshipDrift = { toAdd: string[]; toRemove: string[] };

// Compares the STORED set against a freshly DERIVED one. Returns empty arrays when the
// organization has narrowed nothing — an un-narrowed organization has no drift, because it has
// made no claim to have drifted from.
export function compareStewardshipDrift(
  scope: StewardshipScope,
  derivedSubjectIds: readonly string[],
): StewardshipDrift;
```

- `toStewardshipScope([])` returns `{ hasNarrowed: false, subjectIds: new Set() }`. Document that
  this is the ONLY way an empty set arises, and that it is why the empty bulk-replace is refused
  (Task 5).
- `isInScope` returns `true` whenever `hasNarrowed` is false. One line, and the whole ship-day
  no-change guarantee rests on it — give it a test of its own.
- `compareStewardshipDrift` returns sorted arrays, so two callers rendering the same drift cannot
  disagree on order.

---

### Task 3: The server queries

**File:** `lib/visits/stewardship.ts` (create)

**Action:** Read and write `household_stewardships`. Server-only.

**Details:**

Follow `lib/visits/householdCadences.ts` line for line — the same header discipline, the same
`resolveClient`, the same explicit column list on **one** string literal, and never `select("*")`.

```ts
const HOUSEHOLD_STEWARDSHIP_COLUMNS = "id, household_id, org_id, created_by, created_at";

export type HouseholdStewardship = {
  id: string; householdId: string; orgId: string;
  createdBy: string | null; createdAt: string;
};

// One organization's set. Returns a scope rather than rows — the caller wants the question
// answered, not the table.
export async function readStewardshipScope(
  wardId: string, orgId: string, client?: SupabaseClient<Database>,
): Promise<StewardshipScope>;

// EVERY organization's rows, ward-wide, for the all-orgs view. RLS decides which come back:
// bishopric gets all; an org leader gets their own, plus all when cross-org visibility is on.
export async function listWardStewardships(
  wardId: string, client?: SupabaseClient<Database>,
): Promise<HouseholdStewardship[]>;

// Adds one household. `ignoreDuplicates` so adding one already present is not an error.
// Returns the row, or null when nothing came back — indistinguishable from an RLS refusal
// (foundation-c-services), which the route turns into a 404.
export async function addHouseholdStewardship(
  wardId: string, householdId: string, orgId: string, userId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdStewardship | null>;

// Returns WHETHER A ROW WENT, so "removed" and "there was nothing to remove" stay
// distinguishable. A second DELETE reports nothing to remove rather than failing.
export async function removeHouseholdStewardship(
  wardId: string, householdId: string, orgId: string, client?: SupabaseClient<Database>,
): Promise<boolean>;

// Replaces the whole set: delete what is no longer named, insert what is new.
export async function replaceStewardship(
  wardId: string, orgId: string, householdIds: readonly string[], userId: string,
  client?: SupabaseClient<Database>,
): Promise<{ added: number; removed: number }>;

// Stops narrowing: removes every row for the organization, putting it back on the whole ward.
export async function clearStewardship(
  wardId: string, orgId: string, client?: SupabaseClient<Database>,
): Promise<number>;
```

- `replaceStewardship` is **two statements and is not atomic**, and its header must say so: a
  failure between the delete and the insert leaves a partial set. Accepted because one presidency
  edits one screen, and because the drift banner makes a partial result visible on the next load
  rather than silent. A Postgres function would make it atomic and is explicitly **not** being
  added here — flag it rather than build it.
- Order the delete first (`.not("household_id", "in", ...)`) then the insert with
  `ignoreDuplicates: true`, so a household present in both passes is never briefly absent.
  **Guard the empty-list case**: PostgREST's `not.in.()` with an empty list is a syntax hazard —
  when `householdIds` is empty the route has already refused (Task 5), but assert it here too
  rather than emitting a malformed filter.
- Every error path: `console.error` with context, then `throw new Error("Could not …: " + message)`.
  Never `catch {}` (CLAUDE.md rule 7).

**Also in this task:** add `listWardVisitCadences(wardId, client)` to
`lib/visits/householdCadences.ts` — the same select list, ward-scoped with no `org_id` filter, for
the all-orgs read. RLS tiers it identically to the per-org function; say so in its header so nobody
adds a redundant application-side filter that would mask a policy regression.

---

### Task 4: Fold stewardship into the denominator

**File:** `lib/visits/progress.ts` (modify)

**Action:** Add the third axis to the denominator, report it, and give the picker and the
denominator **one shared function** instead of two comments that must agree.

**Details:**

1. **New shared helper**, placed directly beside `isVisitableHousehold()` in the pure half:

```ts
export type HouseholdVisitDisposition = {
  // TRUE when this household is in the dashboard's denominator.
  inDenominator: boolean;
  // What the household picker shows. Never omits a household the denominator counts.
  pickerLabel: string;
};

export function describeHouseholdForVisits(
  household: { id: string; familyName: string; members: readonly unknown[]; doNotContact: boolean },
  scope: StewardshipScope,
): HouseholdVisitDisposition | null;   // null = not offered at all (nobody lives here)
```

   Its header replaces the current pair of "these two must not drift" comments with the reason they
   can no longer drift: **there is one function**. State the rule it encodes explicitly —

   - No members → **absent** from both the picker and the denominator.
   - Do not contact → **in the picker, marked** `"(do not contact)"`; **not** in the denominator.
   - Outside the stewardship → **in the picker, marked** `"(not in your stewardship)"`; **not** in
     the denominator, and **not** in `rows`.
   - Otherwise → in both, plain label.

   The asymmetry is deliberate and must be written down: a leader who visited a family anyway must
   be able to record it, so **the picker is a superset of the denominator and marks the
   difference**. It may never show *less* than the denominator counts.

2. **`buildVisitProgress`** — `BuildVisitProgressInput` gains `stewardship: StewardshipScope`
   (required, not optional; a missing one must be a type error, the way `resolveRoleAccess` is a
   required third argument). Change the first line of the body:

```ts
const visitable = households
  .filter(isVisitableHousehold)
  .filter((household) => isInScope(stewardship, household.id));
```

   A household outside the stewardship never reaches `rows`, so it is in no band, no count, and no
   table — D3, in one filter.

3. **`VisitProgress` gains a `stewardship` block**, and the existing `VisitProgressStatistics`
   comment for `counted` is updated to "Visitable, **in this organization's stewardship**, and not
   do-not-contact":

```ts
stewardship: {
  // FALSE = the whole ward. The Elders Quorum's ship-day state.
  narrowed: boolean;
  // Visitable households IN scope — the population `counted` is drawn from.
  inScope: number;
  // Visitable households this organization has narrowed AWAY. Reported so the banner can say so
  // out loud: a denominator that silently shrank is the same erosion of trust that visits-b
  // recorded in the other direction.
  outOfScope: number;
};
```

   `outOfScope` needs the **unfiltered** visitable list, so compute both counts in one pass over
   `households` before the stewardship filter is applied.

4. **`readVisitProgress`** gains the fifth parallel fetch:

```ts
const [households, logs, goals, householdCadences, stewardship] = await Promise.all([
  listHouseholds(wardId, undefined, client),
  listVisitLogs(wardId, { orgId }, client),
  listVisitGoals(wardId, client),
  listHouseholdVisitCadences(wardId, orgId, client),
  readStewardshipScope(wardId, orgId, client),
]);
```

   Keep the existing note that no belt-and-braces org filter is added beyond the caller's own
   question — a redundant filter masks a policy regression.

---

### Task 5: Validation schemas

**File:** `lib/validation/visit.ts` (modify)

**Action:** Four schemas, following `setHouseholdVisitCadenceSchema` /
`clearHouseholdVisitCadenceQuerySchema` exactly.

**Details:**

```ts
export const MAX_STEWARDSHIP_HOUSEHOLDS = 1000;

// PUT /api/households/[id]/stewardship
export const setHouseholdStewardshipSchema = z.object({ orgId: z.uuid().optional() });

// DELETE /api/households/[id]/stewardship?orgId=
export const clearHouseholdStewardshipQuerySchema = z.object({ orgId: z.uuid().optional() });

// PUT /api/visits/stewardship — replaces the whole set.
export const replaceStewardshipSchema = z.object({
  orgId: z.uuid().optional(),
  householdIds: z.array(z.uuid()).min(1, EMPTY_STEWARDSHIP_MESSAGE).max(MAX_STEWARDSHIP_HOUSEHOLDS),
});

// GET and DELETE /api/visits/stewardship?orgId=
export const stewardshipQuerySchema = z.object({ orgId: z.uuid().optional() });
```

- **The `.min(1)` is the one seam in the single-table model and must be documented where a reader
  will hit it.** Absence of rows means "the whole ward", so an empty replace is genuinely
  ambiguous — "narrowed to nothing" and "not narrowed" would be the same rows. It is **refused**
  with a sentence naming the alternative, rather than silently flipping an organization back to
  measuring itself against 200 households:

```ts
export const EMPTY_STEWARDSHIP_MESSAGE =
  "That would leave your stewardship with no households at all. Keep at least one, or choose " +
  "\"Measure against the whole ward\" to stop narrowing.";
```

  Note in the header that the fix, if a ward ever genuinely needs "narrowed to nothing", is an
  org-level flag column — not something to add speculatively now.
- Every field name here must be **checked against the exact string the fetch sends** in
  `StewardshipPanel.tsx`, not assumed (`roster-b-picker-and-orgs`).

---

### Task 6: The single-household route

**File:** `app/api/households/[id]/stewardship/route.ts` (create)

**Action:** PUT adds one household to the caller's organization's stewardship; DELETE removes it.

**Details:**

- **Copy `app/api/households/[id]/visit-cadence/route.ts` as the template**, including its
  `resolveOrgId()` helper verbatim (bishopric must name an org and it is checked against
  `listWardOrganizations`; a non-bishopric caller naming another org gets 403; an org leader with
  no `orgId` gets 409 with `NO_ORGANIZATION`).
- `assertCan(user, "visits.manage_goals", roleAccess)` — **not** `roster.manage`. Repeat the
  header's reasoning: an org president owns this decision and does not own the roster.
- `requireSessionUser()` resolved **outside** the try block — catching its thrown redirect would
  turn a redirect into a 500.
- **A PUT on an un-narrowed organization narrows it to exactly that one household**, which is a
  surprising jump from 200 to 1. Refuse it: when `readStewardshipScope` reports
  `hasNarrowed === false`, return 409 with a message pointing at the bulk control —
  `"Your organization is measured against the whole ward. Choose which households are yours first,
  then add or remove them one at a time."` The single-household route is an **adjustment** to an
  existing narrowing, never the thing that creates one.
- Audit rows via `writeAuditLog()`: `household_stewardship_added` and
  `household_stewardship_removed`, `module: "visits"`, detail `{ householdId, orgId }`. The DELETE
  writes its audit row **only when a row genuinely went** — a zero-row delete is not a mutation.
- `respondToRouteError` with `route`, `fallbackMessage`, `detail: { wardId, userId }`.

---

### Task 7: The set route

**File:** `app/api/visits/stewardship/route.ts` (create)

**Action:** GET the current set plus its drift; PUT to replace it; DELETE to stop narrowing.

**Details:**

- **GET** — `assertCan(user, "visits.view", roleAccess)`. Resolve the org exactly as
  `app/api/visits/progress/route.ts` does: a non-bishopric caller's `?orgId=` is **ignored**, not
  refused (their own organization is the only one they have a stewardship for); the bishopric must
  name one. Returns:

```ts
{
  stewardship: {
    narrowed: boolean;
    householdIds: string[];          // sorted
    matchingHouseholdIds: string[];  // the live derivation, sorted
    drift: { toAdd: string[]; toRemove: string[] };
  }
}
```

  The derivation is `listHouseholds(wardId, { organizationId: orgId }, supabase)` filtered to
  `members.length > 0`. **Cite in a comment why that is the derivation** — `listHouseholds` narrows
  the members it *attaches*, not the households it *returns*, so a non-empty `members` array under
  an organization filter means exactly "an active member of that organization lives here". No new
  query.

- **PUT** — `assertCan(user, "visits.manage_goals", roleAccess)`, `resolveOrgId()` (the strict
  version: bishopric must name, others may not name another). Validate every id belongs to a
  household in this ward **before** writing, so a bad id fails with a sentence rather than a
  composite foreign-key violation — the same reasoning the cadence route uses for `org_id`. Then
  `replaceStewardship()`. Audit `stewardship_replaced` with detail
  `{ orgId, count, added, removed }`.

- **DELETE** — same permission and org resolution, `clearStewardship()`. Audit
  `stewardship_cleared` with `{ orgId, removed }`, written only when rows went.

- No audit row on GET (CLAUDE.md rule 6 asks for one on every **mutation**).

---

### Task 8: The all-organizations assembly

**File:** `lib/visits/allOrgProgress.ts` (create)

**Action:** One row per household, every organization's standing beside it. Pure builder plus a
thin server read, following the `buildVisitProgress` / `readVisitProgress` split so the builder is
testable with no database.

**Details:**

```ts
export type AllOrgSteward = {
  orgId: string;
  orgName: string;
  // NULL when this reader may not see that organization's goal or cadence — which is the RLS
  // policy doing its job, not an error and not an absence of data. See the header.
  priority: VisitPriority | null;
};

export type AllOrgHouseholdRow = {
  householdId: string;
  familyName: string;
  doNotContact: boolean;
  // WARD-WIDE and ALL-TIME, across every organization whose logs this reader may see.
  // The question no org-scoped query can answer, and the reason this view exists.
  lastVisitedOn: DateOnly | null;
  lastVisitedByOrgId: string | null;
  lastVisitedByOrgName: string | null;
  conductedBy: string | null;
  stewards: AllOrgSteward[];
  // TRUE when NO organization has claimed this household. Not simply `stewards.length === 0` —
  // see the claiming rule below.
  unclaimed: boolean;
};

export type AllOrgProgress = {
  asOf: string;
  rows: AllOrgHouseholdRow[];
  unclaimedCount: number;
  // Organizations this reader can see bands for, so the page can say plainly that it is showing
  // one organization's bands rather than all of them.
  bandedOrgIds: string[];
};
```

**The header must carry three things:**

1. **THE READER'S TIER IS THE RLS POLICY, NOT A BRANCH IN THIS FILE.** There is no
   `if (isBishopric)` deciding what to show. `listVisitLogs(wardId, {})` returns every
   organization's logs to the bishopric, and to an org leader when cross-org visibility is on, and
   only their own otherwise — that is `visit_logs_select`. `listVisitGoals` and the cadence read
   return only the caller's own organization unless they are bishopric — that is
   `visit_goals_select` and `household_visit_cadences_select`, deliberately **not** widened
   (ITER-018, extended by ITER-019 D6). A band is therefore computed for exactly the organizations
   whose goal this reader may read, and is `null` for the rest. **Facts are shared; judgements are
   not**, and the policies are what enforce it.
2. **THIS MODULE NEVER SELECTS FROM `visit_private_notes` AND NEVER IMPORTS THE MODULE THAT DOES**
   (CLAUDE.md rule 5) — the same sentence `progress.ts` and the visits page carry, so a reviewer
   can confirm it from the import list alone.
3. Every visit number filters `outcome = 'completed'`. `lastVisitedOn` excludes attempts;
   an attempt must never win "last seen".

**Claiming, precisely.** An organization that has narrowed **nothing** claims **every** household:

```ts
const claimants = organizations.filter((org) => {
  const scope = scopeByOrg.get(org.id);
  return scope === undefined || !scope.hasNarrowed || scope.subjectIds.has(household.id);
});
```

`unclaimed = claimants.length === 0`. On ship day nothing is narrowed, so nothing is unclaimed and
the view reads as a plain ward roster with bands — correct, and worth a test of its own.

**Exclude the Bishopric organization from `organizations` here.** It is at the front of
`listWardOrganizations` and will essentially never carry household visit goals, so counting it as a
claimant of every household would make `unclaimed` permanently false and hide the exact failure
mode this view exists to surface. `app/(app)/visits/page.tsx` already reasons about the Bishopric
being first in that list — follow it.

**Sorting** — one exported comparator, so the server and any client-side re-sort cannot disagree:

1. `unclaimed` rows first (the pastoral failure, and the reason D3 was safe).
2. Then by the **most urgent visible band** across `stewards`, using `compareByPriority` from
   `lib/visits/householdStatus.ts` — never a second meaning of "urgent".
3. Then households with no ward-wide visit at all.
4. Then `familyName`.

**`readAllOrgProgress(wardId, asOf, client)`** fetches in one `Promise.all`: `listHouseholds`,
`listVisitLogs(wardId, {})`, `listVisitGoals`, `listWardStewardships`, `listWardOrganizations`, and
`listWardVisitCadences`. The clock enters **once** and is handed down as `asOf`, so every row in one
render is judged against the same instant — the rule `readVisitProgress` and the visits page
already keep.

---

### Task 9: The stewardship panel

**File:** `app/(app)/visits/StewardshipPanel.tsx` (create) — `"use client"`

**Action:** Show what the organization is measured against, offer the one-press match, and surface
drift.

**Details:**

- Props resolved **once on the server** and passed down — `canManageGoals`, `orgId`, `orgName`,
  and the initial stewardship payload. A client component never re-derives a permission.
- TanStack Query against `GET /api/visits/stewardship?orgId=`, keyed `["visit-stewardship", orgId]`,
  seeded with the server payload only when the org matches — the same `initialData` guard
  `VisitProgressTable` uses, for the same reason.
- **Three states, each with a different sentence:**
  - **Not narrowed** → *"Measured against every household in the ward (200)."* Primary action:
    **"Choose which households are ours"**, which opens the list pre-ticked with the live
    derivation and saves via `PUT`.
  - **Narrowed, no drift** → *"Measured against 38 households you have chosen. 162 households in
    the ward are not in your stewardship."* Actions: adjust the list; **"Measure against the whole
    ward"** (`DELETE`, behind a confirm, since it is a jump from 38 to 200).
  - **Narrowed, with drift** → the banner: *"3 households now have a member of your organization
    but are not in your stewardship · 1 no longer does."* Action: **"Update to match"** (`PUT` with
    the derived list). **Name the households, not only the count** — a count nobody can check is a
    count nobody will act on.
- **Every tap target `min-h-11` / at least 44×44.** The cadence control shipped at 176×16 and this
  is the same kind of control on the same page (`visits-e`).
- On success, invalidate **both** `["visit-stewardship", orgId]` and
  `[VISIT_PROGRESS_QUERY_KEY, orgId]` — the denominator has moved, and a stale dashboard beside a
  fresh panel is precisely the two-numbers-disagreeing shape ITER-018 removed.
- Errors surface through `FormError`, never swallowed.
- Read-only when `canManageGoals` is false: an `org_secretary` holds `visits.view` and
  `visits.create` but **not** `visits.manage_goals` (verified in `lib/auth/permissions.ts`), so
  they see the sentence and no controls.

---

### Task 10: The visits page

**File:** `app/(app)/visits/page.tsx` (modify)

**Action:** Wire the panel in, replace the hand-rolled picker filter with the shared helper, and
link to the new view.

**Details:**

- Read `readStewardshipScope(user.wardId, initialOrgId, supabase)` alongside the existing reads —
  it is needed for the picker whether or not the dashboard rendered.
- **Replace the `householdOptions` block** with `describeHouseholdForVisits()` from
  `lib/visits/progress.ts`. Delete the two long "these must not drift" comments and leave a short
  one pointing at the single function that now enforces it. This is the whole point of Task 4.1 —
  do not leave the old filter in place beside the new helper.
- Render `<StewardshipPanel />` inside a `CollapsibleSection`, **directly above** the visit-goal
  section: what you are measured against comes before how often. Follow the existing section
  ordering comment ("the cadence driving the numbers sits directly under them").
- Add the all-organizations link beside the existing "Return and report" link, shown when
  `isBishopric || crossOrgVisibility` — read via `readCrossOrgVisibility(user.wardId, supabase)`.
  A link nobody may follow is the `calendar.manage_org_conducting` failure ITER-007 records; do not
  render it when the page would refuse.

---

### Task 11: The banner

**File:** `app/(app)/visits/VisitProgressBanner.tsx` (modify)

**Action:** Say the denominator is narrowed.

**Details:**

- When `progress.stewardship.narrowed`, add one line under the counts: *"Measured against 38
  households in your stewardship · 162 in the ward are not."* When it is not narrowed, render
  **nothing** — the `talks-c` render-nothing-rather-than-"Never" rule.
- Do **not** add a fifth number to the four band counts. The invariant
  `onTrack + approaching + overdue + neverVisited === counted` must stay visibly true; `outOfScope`
  sits outside it, beside the existing `excluded` (do-not-contact) line, and the two must read as
  different sentences — they are different reasons.

---

### Task 12: The all-organizations page

**Files:** `app/(app)/visits/all-organizations/page.tsx` (create),
`app/(app)/visits/AllOrganizationsTable.tsx` (create)

**Action:** The new view, server-rendered, sorted client-side.

**Details:**

- **Page (Server Component).** `requireSessionUser()`, `resolveRoleAccess()`,
  `can(user, "visits.view", roleAccess)` — `can` not `assertCan`, because a `ForbiddenError`
  escaping a Server Component becomes a 500 whose message Next strips in production
  (`auth-b-invites-admin`). Then a second gate: if not bishopric **and** cross-org visibility is
  off, render `<NotPermitted detail="Seeing every organization at once is turned off for this
  ward. A member of the bishopric can turn on cross-organization visibility." />`. The clock enters
  once; `readAllOrgProgress` gets it. Pass the result to the table as props — **no API route**, so
  there is no second read path to keep in step.
- **Table (`"use client"`).** Import `AllOrgHouseholdRow` **type-only**, so nothing from the
  server-only module survives the build (`roster-b`). Client-side sorting over already-fetched rows
  — this is one ward's households, not a paginated set, and a sort parameter a handler does not
  read is silently ignored (`roster-b`).
- **Row rendering**, per D5:
  - Family name, and the do-not-contact mark where it applies.
  - *"Last seen 12 Jun 2026 · Elders Quorum · Miguel Cortez"*, or *"Never visited"*. Reuse
    `formatVisitDate` and the `VISIT_NOBODY_RECORDED` / `VISIT_CONDUCTED_PREFIX` constants from
    `types/domain.ts` — **who went, never who typed it in**.
  - One chip per steward. A steward with a visible `priority` renders the band pill exactly as
    `VisitProgressTable` does — **lift `BAND_CLASSES` / `BAND_FILL` / `BAND_MARKS` into a shared
    module rather than copying them**, or the two tables will drift on the next colour change.
    Keep the existing note that the fill is a **tint, not a solid**: every colour token was measured
    for text contrast against the surface, and a solid fill with inverted text would owe a second
    measurement per state in both themes.
  - A steward with `priority === null` renders the organization name alone with a `title` reading
    *"Only this organization can see how it is doing."* — an honest sentence, not a blank.
  - An `unclaimed` row renders *"No organization has claimed this household"* in the danger tone,
    and sorts to the top.
- Mobile-first: cards at the default breakpoint, table from `md:`, matching `VisitProgressTable`.
  **When walking this, check `window.innerWidth` before trusting any measurement** — a viewport
  silently reset to 412px measured the `md:`-hidden table last time and reported every button at
  height 0.

---

### Task 13: Types

**File:** `types/database.ts` (regenerate), `types/domain.ts` (modify only if needed)

**Action:** `npm run db:push` then `npm run db:types`. Never hand-edit `database.ts`.

**Details:** CLAUDE.md rule 9 — a new column the frontend model does not know about is silently
dropped. Regenerate **before** writing `lib/visits/stewardship.ts`, so the table is typed while the
queries are written rather than cast afterwards. `types/domain.ts` needs nothing new unless the
chip states want labels; if so, add them as a `Record<...>` with **no fallback**, the way
`VISIT_PRIORITY_BAND_LABELS` is one, so a state added later cannot render as its snake_case key.

---

## Testing Strategy

**1. `tests/lib/stewardshipScope.test.ts` (create)** — pure, no database.
- `toStewardshipScope([])` → `hasNarrowed: false`; `isInScope` returns **true** for any id. This is
  the ship-day no-change guarantee; label the test as such.
- `toStewardshipScope(["a"])` → `hasNarrowed: true`; `isInScope("b")` is false.
- `compareStewardshipDrift` on an un-narrowed scope returns two empty arrays regardless of the
  derived list.
- Drift with additions only, removals only, both, and neither; results sorted.
- **Subject-agnostic**: one test that passes youth ids and asserts identical behaviour, so a future
  edit reintroducing household vocabulary fails here.

**2. `tests/lib/visitProgress.test.ts` (modify)** — every existing `buildVisitProgress` call gains
`stewardship`. Add:
- An un-narrowed scope reproduces the **existing** expectations byte for byte (success criterion 2).
- A narrowed scope excluding one household: that household is in no `rows` entry, `counted` drops
  by one, `outOfScope` is 1, and the invariant
  `onTrack + approaching + overdue + neverVisited === counted` still holds.
- A do-not-contact household **inside** the stewardship still appears in `rows`, marked, with
  `priority: null` — proving the two axes did not get collapsed.
- A do-not-contact household **outside** the stewardship is absent entirely, and is not counted in
  both `excluded` and `outOfScope`.

**3. `tests/lib/allOrgProgress.test.ts` (create)** — pure builder.
- Nothing narrowed → `unclaimedCount === 0` and every organization is a steward of every household.
- One organization narrowed away from a household no other organization claims → `unclaimed` true,
  sorted first.
- The Bishopric organization is not a claimant.
- `lastVisitedOn` picks the most recent **completed** visit across organizations and names the
  right one; an **attempt** never wins.
- A steward whose goal is absent from the input (the non-bishopric reader's tier) gets
  `priority: null` while the reader's own organization gets a real band — the D6 behaviour, tested
  as pure data rather than through RLS.
- The comparator: unclaimed, then most-urgent band, then never-visited, then name.

**4. `tests/rls/household-stewardships.test.ts` (create)** — the highest-value tests here
(CLAUDE.md §8.1). Seed with the service client, assert with authenticated clients, `fixtures.cleanup()`
in `afterAll`; order every read explicitly (shared hosted project).
- Ward A's leader cannot read or write ward B's rows.
- With cross-org **off**: the Relief Society president cannot read the Elders Quorum's rows.
- The bishopric reads and writes every organization's rows.
- An org leader cannot INSERT a row for another organization (INSERT **does** raise).
- An org leader's DELETE of another organization's row is a **zero-row success** — assert by
  **re-reading with the service client**, not by expecting an error (`foundation-c-services`).
- The unique constraint genuinely rejects a duplicate `(household_id, org_id)`, verified against the
  hosted project — `ai-d-corpus-scoping` shipped a constraint that was silently inert.

**5. `tests/rls/visit-cross-org.test.ts` (modify)** — the D6 contrast, in the suite that owns the
widening. Add a `readStewardshipIds` helper shaped exactly like the existing `readCadenceIds`
(ward-wide, **no org filter** — a filtered read would pass even if the setting had stopped
widening). Assert:
- With cross-org **off**, an org leader sees only their own organization's stewardship rows.
- With cross-org **on**, they see **both** organizations' rows — the new behaviour.
- **The existing cadence and goal assertions are unchanged and must still pass in both modes.** Add
  a comment saying the contrast in this one file *is* the decision: facts widen, judgements do not.

**6. `tests/routes/householdStewardship.test.ts` (create)** — read the header comment in
`tests/helpers/routeClient.ts` first; it documents the `vi.mock` hoisting trap. Model on
`tests/routes/householdVisitCadence.test.ts`.
- `org_president` (holds `visits.manage_goals`) adds and removes; `org_secretary` (does **not** hold
  it — check the matrix, it is not the intuitive answer) gets 403.
- Bishopric with no `orgId` → 400; with a foreign `orgId` → 404; org leader naming another org →
  403; org leader with no `orgId` → 409.
- PUT against an **un-narrowed** organization → 409 pointing at the bulk control.
- `params` is a Promise: `PUT(request, { params: Promise.resolve({ id }) })`.
- An audit row is written for each successful mutation, and **not** for a no-op DELETE.

**7. `tests/routes/visitStewardship.test.ts` (create)**
- GET returns the derivation and the drift for the caller's own organization; a non-bishopric
  caller's `?orgId=` naming another organization is **ignored**, matching
  `app/api/visits/progress/route.ts`.
- PUT with `householdIds: []` → 400 carrying `EMPTY_STEWARDSHIP_MESSAGE`.
- PUT with a household id from another ward → refused with a sentence, not a foreign-key violation.
- PUT replaces: rows named are present, rows previously present and now unnamed are gone (re-read
  with the service client).
- DELETE clears, and the organization reads `narrowed: false` afterwards.

**8. `tests/routes/visitsProgress.test.ts` (modify)** — one case proving the route's denominator
moves when a stewardship narrows, so the wiring between Task 4 and Task 7 is covered end to end and
not only in the pure builder.

---

## Test Scenarios (Harness)

### Scenario 047: Narrowing a stewardship

**Tags:** `visits`, `smoke`, `stewardship`, `primary`

**Purpose:** The whole point of the slice is a number that is currently absurd — "3 of 200" for the
Primary — becoming right in one press. That needs a ward with enough households to be absurd and a
Primary whose membership actually implies a subset, neither of which is arrangeable by hand. It also
has to demonstrate the **contrast** with do-not-contact on the same screen, which needs both kinds
of household present at once.

**Seed data summary:**
- Ward — Harness Test Ward, cross-org visibility **off**
- Households — 24 total: 8 with a child in Primary, 14 without, 2 do-not-contact (**one of the two
  inside the Primary's implied set and one outside**, which is what makes the contrast visible)
- Members — a Primary-aged child in each of the 8, all in `member_organizations` for the Primary
- Organizations — Primary, Elders Quorum, Relief Society
- Users — bishop (Mark Andersen), Primary president, EQ president, **Primary secretary** (holds
  `visits.view`/`visits.create` but **not** `visits.manage_goals` — the read-only state)
- Goals — Primary: every 6 months; Elders Quorum: every 1 year (**narrows nothing**, to prove
  criterion 2 on screen)
- Visit logs — 3 completed Primary visits, spread across bands

**Tester action:** Sign in as the Primary president. Read the dashboard denominator before touching
anything. Open the stewardship panel, press **"Choose which households are ours"**, confirm the
pre-ticked list matches the 8, save. Re-read the denominator and the banner. Sign in as the EQ
president and confirm nothing about their board moved. Sign in as the Primary secretary and confirm
the panel is read-only. Finally, as the Primary president, remove one household and confirm it
leaves both the table and the count.

**Verification checklist:**
- [ ] Before narrowing, the Primary reads a denominator of **22** (24 less the 2 do-not-contact)
- [ ] The pre-ticked list is exactly the **8** households with a Primary child — no manual ticking
- [ ] After saving, the denominator is **7** (8 less the one do-not-contact inside the set)
- [ ] The banner says the denominator is narrowed and names how many are outside it
- [ ] The do-not-contact household **inside** the stewardship is still **shown and marked**, with no
      band — visibly a different treatment from the excluded ones
- [ ] The 16 households outside the stewardship appear **nowhere** on the Primary's dashboard
- [ ] The Elders Quorum's denominator and bands are **identical** before and after
- [ ] The household picker still offers an out-of-stewardship household, marked *"(not in your
      stewardship)"*, and a visit logged to it saves
- [ ] The Primary secretary sees the sentence and **no** controls
- [ ] Every new control is at least 44×44 (`visits-e` shipped one at 176×16)
- [ ] `window.innerWidth` was checked before any layout measurement was trusted

### Scenario 048: Every organization at once

**Tags:** `visits`, `full`, `stewardship`, `cross-org`

**Purpose:** The view's whole content is the *relationship between* three organizations' data and
one ward's households at one instant — three stewardships that overlap and disagree, a household
nobody has claimed, and a most-recent visit belonging to a different organization from the one
reading. None of that can be arranged by hand, and the reader-tier behaviour (D6) needs the same
data read by two different people to be visible at all.

**Seed data summary:**
- Ward — Harness Test Ward, cross-org visibility **on**
- Households — 12: one claimed by all three organizations, one by two, one by one, **one by none**,
  the rest by the un-narrowed Elders Quorum only
- Stewardships — Primary narrowed to 4, Relief Society narrowed to 6, Elders Quorum **not narrowed**
- Goals + cadences — each organization on a different cadence; one household carries an EQ cadence
  override, so the same family reads different bands for different organizations
- Visit logs — the most recent completed visit on the shared household belongs to the **Relief
  Society**, so the Elders Quorum's own board and this view disagree about "last seen", correctly;
  plus one **attempt** more recent than that completed visit, which must not win
- Users — bishop, EQ president, RS president

**Tester action:** Sign in as the bishop, open **Visits → All organizations**. Read the unclaimed
row at the top. Sort by each column. Then sign in as the RS president and read the same page. Then
have the bishop turn cross-org visibility **off** in admin, and reload as the RS president.

**Verification checklist:**
- [ ] The unclaimed household sorts **first** and says no organization has claimed it
- [ ] The household claimed by all three shows **three** chips
- [ ] The un-narrowed Elders Quorum appears as a steward of **every** household
- [ ] The Bishopric organization appears as a steward of **nothing**
- [ ] "Last seen" names the **Relief Society** on the shared household, with who went — not who
      recorded it
- [ ] The more recent **attempt** does not appear as "last seen"
- [ ] As the bishop, **every** chip carries a band
- [ ] As the RS president, only the **Relief Society** chip carries a band; the others name the
      organization with an honest sentence rather than a blank
- [ ] With cross-org visibility **off**, the RS president gets `NotPermitted` **and the nav link is
      absent** rather than present-and-refusing (ITER-007's failure mode)
- [ ] Cards below `md:`, table at and above it; no horizontal page scroll at 375px

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project, then regenerate types.
# NOTE: npm run db:reset WIPES the hosted database. Do not run it.
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests (RLS suites run over the network against the shared hosted project)
npm test

# Production build — lint, typecheck and tests can all pass while this fails.
npm run build
```

---

## Integration Notes

**How this connects.** `household_stewardships` is the third join table in the visits module and the
second keyed `(household_id, org_id)`. It sits beside `household_visit_cadences` structurally and
answers a different question: the cadence says *how often*, the stewardship says *whether at all*.
`lib/visits/stewardshipScope.ts` is deliberately subject-agnostic so Phase 8 youth-activity coverage
imports it for "which youth are ours" without a second meaning of the word.

**Breaking changes.** `BuildVisitProgressInput` gains a **required** field, which is a compile error
at every call site — on purpose, and the technique `role-access-overrides` used to find 25 checks
that ignored the ward's override. `VisitProgress` gains a field, which is additive for consumers.

**Migration.** 052 is **additive only** — no drops, no column removals — so it is safe to apply
before deploying, and this is **not** an expand-and-contract slice. `HELD_BACK_UNTIL_DEPLOYED` stays
`{}`; do not add an entry. Zero rows is the correct post-migration state, so no ward's numbers move
until somebody chooses to narrow.

**Documentation to update in the same change.**
- `CLAUDE.md` §9 — a decision entry for stewardship: the single table with absent-means-whole-ward,
  the refusal of the empty set and why, and the **facts vs judgements** line on cross-org visibility
  (naming which policies are widened and which are pointedly not).
- `plans/07-visits.md` — the denominator's definition changed.
- `SPEC.md` — the new table, the two new routes, the new page.
- `.iterate/scopes/ITER-019.md` and `.iterate/BACKLOG.md` — the plan link.

**The one seam, stated plainly.** With a single table, "narrowed to nothing" and "not narrowed" are
the same zero rows. The empty bulk-replace is therefore **refused** with a sentence naming the
alternative, rather than silently flipping an organization back to the whole ward. If a ward ever
genuinely needs an empty stewardship, the fix is an org-level flag column — a real migration, not a
workaround, and not to be added speculatively now.

**Deliberately not in scope.** A ward-level "adopt this household" workflow from the unclaimed row
(the view surfaces the problem; assigning is a separate decision); stewardship for youth activities
(Phase 8, which imports the scope module); making `replaceStewardship` atomic via a Postgres
function; and any change to `visit_goals_select` or `household_visit_cadences_select`.
