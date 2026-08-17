# Plan: Roster A — Data Layer, Pages, and CRUD

**Created:** 2026-08-17
**Type:** feature
**Phase:** 2 of 13 — see [02-roster.md](02-roster.md), part 1 of 3
**Siblings:** [roster-b-picker-and-orgs.md](roster-b-picker-and-orgs.md), [roster-c-csv-import.md](roster-c-csv-import.md)

---

## Overview

The roster is the single source of truth every later module reads from. This first part
builds the data access layer, the browse and detail pages, and household/member create and
edit. It carries the phase's only migration, so it also closes a schema gap that three
consecutive retros have handed forward.

`MemberPicker` and organization membership are **roster-b**. CSV import is **roster-c**.
Do not build either here — but do design `listMembers()` so both can call it unchanged.

### Key requirements

1. Household and member CRUD, browsable as a household view (default) or a flat list
2. The default query excludes `moved_out`, everywhere, without the caller asking
3. Member notes never appear in a non-bishopric response
4. Works at 375px and at desktop, in light and dark mode

### Success criteria

- `/roster` lists households with search and filters; `/roster/household/[id]` and
  `/roster/member/[id]` show detail and allow edit
- A non-bishopric session receives zero member-note rows, proven by a test
- `listMembers()` with no options returns only `active` members, proven by a test
- A user can no longer rewrite their own `role` through the API, proven by a test
- `npm run lint`, `npm run typecheck`, and `npm test` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `supabase/migrations/022_roster_import.sql` | create | Lookup indexes for roster-c's match strategy, the `apply_roster_import` function roster-c calls, and the column-level `users` grant that closes the three-phase-old gap |
| `types/domain.ts` | modify | Add `ROSTER_VIEW_MODES` and `RosterViewMode` |
| `lib/validation/roster.ts` | create | Zod schemas shared by the routes and the forms |
| `lib/roster/queries.ts` | create | The data access layer — every roster read and write goes through here |
| `lib/roster/memberNotes.ts` | create | Bishopric-only notes, in a separate module so the general path cannot import it by accident |
| `lib/auth/navigation.ts` | modify | Add the Roster nav item |
| `app/api/households/route.ts` | create | `GET` list, `POST` create |
| `app/api/households/[id]/route.ts` | create | `PATCH` update |
| `app/api/members/route.ts` | create | `GET` list, `POST` create |
| `app/api/members/[id]/route.ts` | create | `PATCH` update |
| `app/api/members/[id]/notes/route.ts` | create | `GET` list, `POST` create — bishopric only |
| `app/(app)/roster/page.tsx` | create | Browse page, Server Component |
| `app/(app)/roster/RosterViewToggle.tsx` | create | Client — household ⇄ list, persisted |
| `app/(app)/roster/RosterFilters.tsx` | create | Client — category, status, search |
| `app/(app)/roster/household/[id]/page.tsx` | create | Household detail |
| `app/(app)/roster/household/[id]/HouseholdEditor.tsx` | create | Client wrapper around `HouseholdForm` |
| `app/(app)/roster/member/[id]/page.tsx` | create | Member detail |
| `app/(app)/roster/member/[id]/MemberEditor.tsx` | create | Client wrapper around `MemberForm` |
| `app/(app)/roster/member/[id]/MemberNotes.tsx` | create | Client — bishopric-only notes panel |
| `components/roster/HouseholdList.tsx` | create | Household cards with expand-to-members |
| `components/roster/MemberList.tsx` | create | The flat list view |
| `components/roster/MemberStatusBadge.tsx` | create | Active / Moved Out / Do Not Contact |
| `components/roster/HouseholdForm.tsx` | create | Zod-validated, shared schema |
| `components/roster/MemberForm.tsx` | create | Zod-validated, shared schema |
| `tests/lib/memberStatusFilter.test.ts` | create | The default-status rule |
| `tests/lib/rosterMapping.test.ts` | create | snake_case → camelCase mapping |
| `tests/rls/member-notes.test.ts` | create | Notes are bishopric-only |
| `tests/rls/users-column-grant.test.ts` | create | Self-role-rewrite is now refused |
| `plans/02-roster.md` | modify | Correct the `members.notes` reference — see Decision 1 |
| `testing/scenarios/roster/scenario-007-*` | create | Harness scenario, see below |

---

## Dependencies

No new libraries. Everything used here already exists:

- `scopedQuery` / `scopedWardId` — [lib/supabase/scoped.ts](../lib/supabase/scoped.ts)
- `requireSessionUser` — [lib/auth/session.ts](../lib/auth/session.ts)
- `assertCan`, `can` — [lib/auth/permissions.ts](../lib/auth/permissions.ts)
- `readJsonBody`, `respondToRouteError` — [lib/auth/routeErrors.ts](../lib/auth/routeErrors.ts)
- `writeAuditLog` — [lib/audit/writeAuditLog.ts](../lib/audit/writeAuditLog.ts)
- `emitNotification` — [lib/notifications/emitNotification.ts](../lib/notifications/emitNotification.ts)
- `Button`, `Card`, `Input`, `FormError` — [components/ui/](../components/ui/)

**A migration is being pushed.** `tests/db/migrations.test.ts` compares the files on disk
against the versions applied to the hosted project, so the suite fails until
`npm run db:push` has run. Regenerate types afterwards with `npm run db:types`.

---

## Decisions Made Before Writing This Plan

These resolve conflicts between the phase plan and the schema that actually shipped.
Do not silently re-decide them; if one is wrong, flag it.

### 1. `members.notes` does not exist, and 02-roster.md is wrong about it

[02-roster.md](02-roster.md) §Step 1 says "`members.notes` is bishopric-visible only. Do
not include the column in the general member select." There is no such column. Migration
003 put notes in their own `member_notes` table precisely because **RLS grants or denies a
row, never a column**, so a bishopric-only column on `members` could not have been
protected by the security boundary CLAUDE.md rule 2 requires
([foundation-b-schema retro](retros/foundation-b-schema.md)).

The intent survives and is stronger than the plan's version: `select('*')` on `members`
cannot leak notes because there is nothing to leak.

**Action:** correct that paragraph in `plans/02-roster.md` in this same change, per
CLAUDE.md §1 ("if the spec is wrong, flag it and update the spec in the same change").

### 2. The library default is `active` only; the roster page opts in to `do_not_contact`

02-roster.md contains two rules that pull apart: "Default filter is `status = 'active'`"
and "`Do Not Contact` members must be visually distinct **everywhere**".

Resolution: `listMembers()` defaults to `["active"]` — the narrow, safe answer, so a
caller who forgets can never inflate a count or a rotation pool. The `/roster` browse page
passes `statuses: ["active", "do_not_contact"]` explicitly, because it is a browse
surface rather than a calculation, and a do-not-contact member is still in the ward.
`moved_out` requires explicit opt-in from both.

### 3. `roster.manage` in the route is the effective write boundary, not RLS

The ward-scoped policy loop in migration 019 grants **INSERT, UPDATE and DELETE on
`members` and `households` to every authenticated member of the ward** — including an
`org_secretary` and a `sacrament_manager`. `tests/rls/youth-isolation.test.ts` asserts
this explicitly rather than leaving it as a comment.

So `assertCan(user, 'roster.manage')` in the route handler is what actually stops an
unauthorized write here. It is the same asymmetry `auth-b` found on `updateWardUser`.
**The permission check on every mutating roster route can never be skipped**, and every
route below must carry one.

Reads are the same story: `roster.view` is what keeps a youth account out of the roster,
plus the separate `(youth)` shell. Do not assume the database is doing that work.

### 4. There is no delete

02-roster.md §Pitfalls is explicit. Departing members are marked `moved_out` so their
assignment and visit history survives. Build no delete button and no `DELETE` route, for
members or for households.

### 5. The view toggle persists in `localStorage`, not the database

`users` has no settings column, and adding one would widen the column grant this migration
is narrowing. The `?view=` search param is the source of truth so the page stays a Server
Component; `RosterViewToggle` writes the choice to `localStorage` and, when the URL
carries no `view` param, replaces the URL with the stored value on mount. Per user per
device, which is the right granularity for a layout preference.

---

## Known Pitfalls (from retro context)

- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — `requireSessionUser()` must
  sit **outside** the `try` block in a route handler. It redirects by throwing an internal
  Next.js error, and a catch-all around it turns the redirect into a 500. Copy the shape in
  [app/api/admin/users/route.ts](../app/api/admin/users/route.ts) exactly.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — never call
  `await request.json()` directly; use `readJsonBody()`. A malformed body reported as a 500
  looks like the server's fault.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — Next.js's dev logger renders
  an object argument to `console.error` as `{}`. Anything that must survive to the log goes
  in the **message string**, not the payload object.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — a permission refusal in a
  **Server Component** must be rendered, not thrown: a `ForbiddenError` escaping one is a
  500 whose message Next.js strips in production. `/roster` gates with `can()` and renders
  `NotPermitted`; API routes use `assertCan()` and return 403.
- **[foundation-c-services](retros/foundation-c-services.md)** — an `UPDATE` denied by
  policy comes back as **success with zero rows**, not an error. Every update path must
  check for an empty result and return a readable message, the way
  `updateWardUser` does.
- **[foundation-a-scaffold](retros/foundation-a-scaffold.md)** — do not type page or layout
  props with the generated `PageProps<…>` / `LayoutProps<…>` helpers. They only exist after
  a build, so they break `npm run typecheck` on a clean tree. Type props explicitly.
- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — the Supabase CLI login expires
  independently of the project link. `db push` and `gen types` fail with a 401 while
  `supabase/.temp/project-ref` is still correct, and the fix is interactive. Do this
  **before** starting, since this plan carries a migration.
- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — `db push` warns "failed to cache
  migrations catalog: failed to run docker". Harmless and expected; there is no local
  Docker by design.
- **[foundation-b-schema](retros/foundation-b-schema.md)** — RLS tests run over the network
  against the shared hosted project. They must clean up after themselves and must never
  assume an empty table.

---

## Tasks

### Task 1: Migration 022

**File:** `supabase/migrations/022_roster_import.sql` (create)
**Action:** Add roster lookup indexes, the import apply function, and the `users` column grant.

**Details:**

Three unrelated-looking things share one migration because this phase opens exactly one,
and the third has been waiting three phases for it. Say so in the file header.

**Part 1 — lookup indexes for roster-c's match strategy.**

```sql
create index households_ward_family_name_idx
  on households (ward_id, lower(family_name));

create index members_ward_household_name_idx
  on members (ward_id, household_id, lower(first_name), lower(last_name));
```

These are **not** unique. A unique constraint would be the obvious way to make import
idempotent, and it is wrong: two unrelated Smith families with no address on file are
legitimate, and a constraint would reject the second one forever. Matching is decided in
the import preview, where a human confirms it. Put that reasoning in a comment — it is
exactly the kind of thing a later reader will "fix".

**Part 2 — `apply_roster_import`.**

`@supabase/supabase-js` has no transaction API, and 02-roster.md §Step C requires the
apply to be one transaction. A `plpgsql` function is called as a single statement, so it
gets one implicitly.

```sql
create function apply_roster_import(
  p_ward_id    uuid,
  p_households jsonb,
  p_members    jsonb
) returns jsonb
  language plpgsql
as $$ … $$;
```

- **`SECURITY INVOKER`** — the default, and required. RLS must still apply to the writes
  inside it (CLAUDE.md rule 2). Do **not** add `SECURITY DEFINER`.
- `p_households` is an array of `{ family_name, address }`; `p_members` is an array of
  `{ family_name, address, first_name, last_name, category, gender, phone }`.
- For each household: match on `ward_id` + `lower(family_name)` +
  `coalesce(lower(address), '')`; insert when there is no match, update `address` when
  the incoming value is non-null.
- For each member: resolve the household by the same key, then match on `ward_id` +
  `household_id` + `lower(first_name)` + `lower(last_name)`; insert when there is no
  match, otherwise update only the incoming non-null fields.
- **Never touch `member_notes`.** The LCR export does not contain them and they are
  irreplaceable. The function must not reference that table at all.
- Members in the database but absent from the payload are **not** touched.
- Returns `jsonb`: `{ households_created, households_updated, members_created,
  members_updated, new_household_ids }`. Roster-c uses `new_household_ids` to emit
  `new_household_added` and the counts for the audit row.
- `revoke all on function apply_roster_import(uuid, jsonb, jsonb) from public;`
  then `grant execute … to authenticated;`

**Part 3 — close the `users_update_self` column gap.**

Handed forward by [auth-a](retros/auth-a-session-shell.md) → [auth-b](retros/auth-b-invites-admin.md)
→ [auth-c](retros/auth-c-youth-pin.md). `users_update_self` lets a user update their own
row, and nothing restricted *which columns*, so a user could rewrite their own `role`
with a direct API call. The admin UI disables self-edits, which is a UI guard, not a
boundary.

```sql
revoke update on users from authenticated;
grant update (theme_preference) on users to authenticated;
```

`theme_preference` alone is the complete set of what an authenticated session updates
today — verified: `components/layout/ThemeToggle.tsx` is the only such write in the repo.
Everything else (`adminUsers`, `youthAccounts`, registration) goes through the
service-role client, which is unaffected. Add `first_name` / `last_name` to the grant
list when a profile-edit page arrives, not before.

The `alter default privileges` block in migration 019 applies only to **future** tables,
so it will not re-widen `users`.

**After writing:** `npm run db:push`, then `npm run db:types`. Both are required before
the test suite will pass.

---

### Task 2: Domain types

**File:** `types/domain.ts` (modify)
**Action:** Add the view-mode union. Append near the other `as const` blocks.

```ts
export const ROSTER_VIEW_MODES = ["household", "list"] as const;
export type RosterViewMode = (typeof ROSTER_VIEW_MODES)[number];
```

`MEMBER_CATEGORIES`, `MEMBER_GENDERS`, and `MEMBER_STATUSES` already exist — reuse them,
do not redeclare.

---

### Task 3: Validation schemas

**File:** `lib/validation/roster.ts` (create)
**Action:** One schema per boundary, shared by the route and the form.

**Details:** Follow [lib/validation/adminUser.ts](../lib/validation/adminUser.ts) for shape
and message style. Zod 4 is in use.

```ts
export const createHouseholdSchema = z.object({
  familyName: z.string().trim().min(1, "Enter a family name.").max(120),
  address: z.string().trim().max(300).optional().nullable(),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const updateHouseholdSchema = createHouseholdSchema.partial();

export const createMemberSchema = z.object({
  householdId: z.uuid().optional().nullable(),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: z.string().trim().min(1, "Enter a last name.").max(80),
  category: z.enum(MEMBER_CATEGORIES).optional().nullable(),
  gender: z.enum(MEMBER_GENDERS).optional().nullable(),
  status: z.enum(MEMBER_STATUSES).default("active"),
  phone: z.string().trim().max(40).optional().nullable(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = createMemberSchema.partial();

export const memberFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.enum(MEMBER_CATEGORIES).optional(),
  statuses: z.array(z.enum(MEMBER_STATUSES)).optional(),
  organizationId: z.uuid().optional(),
});
export type MemberFilters = z.infer<typeof memberFiltersSchema>;

export const createMemberNoteSchema = z.object({
  body: z.string().trim().min(1, "Enter a note.").max(5000),
});
```

**No `wardId` field on any of them.** conventions.md §Validation: ward, role, org, and
user id all come from the session. A schema that accepts `wardId` is a schema someone will
eventually trust.

---

### Task 4: The data access layer

**File:** `lib/roster/queries.ts` (create)
**Action:** Every roster read and write. Route handlers never touch Supabase directly
(conventions.md §Data Access).

**Details:**

Exported types — camelCase, mapped once here:

```ts
export type Household = {
  id: string; familyName: string; address: string | null;
  latitude: number | null; longitude: number | null; createdAt: string;
};

export type Member = {
  id: string; householdId: string | null;
  firstName: string; lastName: string;
  category: MemberCategory | null; gender: MemberGender | null;
  status: MemberStatus; phone: string | null; createdAt: string;
};

export type HouseholdWithMembers = Household & { members: Member[] };
export type MemberDetail = Member & { household: Household | null };
```

Exported functions — each takes `wardId` first and an optional `SupabaseClient` last, the
signature already used across `lib/auth/`:

```ts
export const DEFAULT_MEMBER_STATUSES: readonly MemberStatus[] = ["active"];
export const ROSTER_BROWSE_STATUSES: readonly MemberStatus[] = ["active", "do_not_contact"];

export async function listHouseholds(wardId, opts?: { search?: string; statuses?: readonly MemberStatus[] }, client?): Promise<HouseholdWithMembers[]>
export async function listMembers(wardId, opts?: MemberFilters & { statuses?: readonly MemberStatus[] }, client?): Promise<Member[]>
export async function getMember(wardId, memberId, client?): Promise<MemberDetail | null>
export async function getHousehold(wardId, householdId, client?): Promise<HouseholdWithMembers | null>
export async function createHousehold(wardId, input: CreateHouseholdInput, client?): Promise<Household>
export async function updateHousehold(wardId, id, input, client?): Promise<Household | null>
export async function createMember(wardId, input: CreateMemberInput, client?): Promise<Member>
export async function updateMember(wardId, id, input, client?): Promise<Member | null>
```

Rules this layer enforces so no caller has to:

- **`opts.statuses` defaults to `DEFAULT_MEMBER_STATUSES`.** Applied with
  `.in("status", statuses)`. This is Decision 2 and the single most important line in the
  file — a moved-out member reaching a speaker rotation or a visit-goal denominator is the
  quiet bug 02-roster.md §Pitfalls opens with. Comment it.
- **`search`** matches `first_name`, `last_name`, or the household's `family_name`,
  case-insensitively. Use `.or("first_name.ilike.%x%,last_name.ilike.%x%")` on `members`
  and a separate `family_name.ilike` on `households`; escape `%`, `_` and `,` in the term
  before interpolating — PostgREST's `or` filter is comma-delimited and an unescaped comma
  changes the query's meaning.
- **`organizationId`** filters through `member_organizations`. Leave the parameter accepted
  but unimplemented here **only if** roster-b lands immediately after; otherwise implement
  it now as a two-step read (`member_organizations` → member ids → `.in("id", ids)`).
  Roster-b owns the caller-side default described in 02-roster.md §Step 1
  ("non-bishopric callers get a filtered list").
- **Never select from `member_notes` in this module.** It lives in `memberNotes.ts`.
- Ordering: households by `family_name`; members by `last_name`, then `first_name`, both
  with `nullsFirst: false`, matching `listWardUsers`.
- Errors: `console.error` with the message in the **string**, then throw an `Error` with a
  readable sentence. Copy `listWardUsers`.
- Updates: an empty result means the row is not in this ward (or RLS refused). Return
  `null`; the route turns that into a 404 with "That member is not in your ward." Do not
  let a zero-row update read as success.

`listHouseholds` should fetch households and their members in two queries, then group in
memory — the same reasoning `listWardUsers` gives for not using a PostgREST embed across
the composite foreign key.

---

### Task 5: Member notes, in their own module

**File:** `lib/roster/memberNotes.ts` (create)
**Action:** Read and write `member_notes`. Bishopric only.

**Details:**

```ts
export type MemberNote = {
  id: string; memberId: string; body: string;
  createdBy: string | null; createdAt: string; updatedAt: string;
};

export async function listMemberNotes(wardId, memberId, client?): Promise<MemberNote[]>
export async function createMemberNote(wardId, memberId, userId, body, client?): Promise<MemberNote>
```

A separate file, not a section of `queries.ts`, so that "did this response include notes?"
is answerable by looking at the import list. The header comment should say that, and say
that RLS (migration 019, bishopric-only loop) is the real boundary — this module is the
reminder, not the guard.

Reads go through the **caller's session client**, never the service client. Going through
RLS is the point.

---

### Task 6: Navigation

**File:** `lib/auth/navigation.ts` (modify)
**Action:** Add one entry, first in the list.

```ts
{ label: "Roster", href: "/roster", permission: "roster.view" },
```

SPEC.md §Component Structure puts `/roster` first, and it is the module every other one
browses through. `tests/lib/navigation.test.ts` may assert list length or contents —
update it in the same change.

---

### Task 7: Household routes

**Files:** `app/api/households/route.ts`, `app/api/households/[id]/route.ts` (create)

**`GET /api/households`** — `roster.view`. Reads `search` from the query string. Returns
`{ households }`. No audit row; a read is not a mutation.

**`POST /api/households`** — `roster.manage`. Six steps, per conventions.md §Route Handler
Shape:

1. `requireSessionUser()` — **outside** the try
2. `assertCan(user, "roster.manage")`
3. `createHouseholdSchema.parse(await readJsonBody(request))`
4. `createHousehold(user.wardId, input)`
5. `writeAuditLog({ action: "household_created", module: "roster", detail: { householdId } })`
6. `emitNotification({ triggerKey: "new_household_added", … })` — the key already exists in
   `supabase/seed/notification_triggers.sql`, addressed to bishop, counselor, org_president,
   ward_secretary. Title and body name the family, e.g. "New household: the Andersens".

**`PATCH /api/households/[id]`** — `roster.manage`, `updateHouseholdSchema`, audit action
`household_updated`. A `null` return is a 404, not a 500.

Route params in Next 16 are a Promise: `{ params }: { params: Promise<{ id: string }> }`,
typed explicitly rather than with the generated helper. Check
`app/api/admin/users/[id]/route.ts` for the exact current shape and copy it.

All four end in `respondToRouteError(error, { route, fallbackMessage, detail })`.

---

### Task 8: Member routes

**Files:** `app/api/members/route.ts`, `app/api/members/[id]/route.ts`,
`app/api/members/[id]/notes/route.ts` (create)

**`GET /api/members`** — `roster.view`. Parses the query string with
`memberFiltersSchema`. When the caller sends no `statuses`, the data layer's default
applies — do not substitute one here.

**`POST /api/members`** — `roster.manage`, audit `member_created`. No notification trigger
exists for a new member; do not invent one.

**`PATCH /api/members/[id]`** — `roster.manage`, audit `member_updated`. Include the
status transition in `detail` when it changes (`{ from, to }`) — marking someone
`moved_out` is the closest thing to a delete this app has and the trail should say so.

**`GET` / `POST /api/members/[id]/notes`** — gate on `assertCan(user, "roster.manage")`,
which only the bishopric holds. RLS refuses anyone else regardless, so this is
belt-and-braces in the right direction. Audit `member_note_created`; put **only the
member id** in `detail` — `writeAuditLog` redacts any key matching `note`, and an audit
row is bishopric-readable, but do not rely on the backstop.

---

### Task 9: The roster browse page

**File:** `app/(app)/roster/page.tsx` (create), plus `RosterViewToggle.tsx` and
`RosterFilters.tsx`

**Details:**

Server Component. `searchParams` is a Promise in Next 16 — await it, and type it
explicitly.

```
{ view?: "household" | "list", search?: string, category?: string, status?: string }
```

- Gate with `can(user, "roster.view")`; render `NotPermitted` if refused (Decision 3 /
  auth-b pitfall). Reuse `app/(app)/admin/NotPermitted.tsx` — it is now used by two
  modules, so **move it to `components/ui/NotPermitted.tsx`** and update the admin import
  (conventions.md §Components: a component used by two modules moves, it is not copied).
- Default view is `household`. Pass `ROSTER_BROWSE_STATUSES` explicitly (Decision 2) —
  never rely on the library default here.
- `HouseholdList` for the household view, `MemberList` for the flat view.
- Show a "Add household" / "Add member" control only when `can(user, "roster.manage")`.
- Empty state: distinguish "no members yet — import your roster" (links to `/roster/import`,
  which roster-c builds; a 404 is the right answer until then) from "no results for that
  search".

`RosterFilters` is a client component that pushes to the search params. `RosterViewToggle`
does the same and additionally mirrors the choice into `localStorage` under `roster-view`,
restoring it on mount when the URL carries no `view` param (Decision 5).

**Layout:** at 375px the household view is a stack of cards, full-width controls, no
sideways scroll. At `md:` and up it becomes two columns with detail beside the list. Use
theme tokens only — no hardcoded hex, or dark mode breaks.

---

### Task 10: Detail pages

**Files:** `app/(app)/roster/household/[id]/page.tsx`,
`app/(app)/roster/member/[id]/page.tsx`, and their client editor wrappers

**Household detail:** family name, address, member list with `MemberStatusBadge`, and an
edit affordance behind `roster.manage`. A missing id calls `notFound()`.

**Member detail:** name, category, gender, status, phone, and the household it belongs to
as a link. Then:

- **Notes panel** — rendered only when `can(user, "roster.manage")`, and the data fetched
  only inside that branch. Do not fetch and then hide.
- **Assignment history tab** — Phase 4 fills it. Render the tab with an explicit
  "Available once the talk pipeline is built" message rather than an empty box, and gate
  it on `can(user, "talks.view")` so it is bishopric-only from the start.

---

### Task 11: Components

**Files:** `components/roster/HouseholdList.tsx`, `MemberList.tsx`,
`MemberStatusBadge.tsx`, `HouseholdForm.tsx`, `MemberForm.tsx` (create)

- **`MemberStatusBadge`** — props `{ status: MemberStatus }`. Three visually distinct
  treatments. `do_not_contact` must read clearly at a glance and must not rely on colour
  alone (accessibility, and Phase 12 will audit it). Include the text.
- **`HouseholdList`** — props `{ households: HouseholdWithMembers[]; canManage: boolean }`.
  Expand-to-members. **Do not virtualize yet.** 02-roster.md says "virtualized if over
  ~200 households"; a real ward is 100–150, no virtualization library is installed, and
  adding one needs permission. Note the threshold in a comment and revisit if a ward
  exceeds it.
- **`HouseholdForm` / `MemberForm`** — client components, validating with the same schema
  the route parses. Copy the submit/error/pending shape from
  [app/(app)/admin/users/InviteForm.tsx](../app/(app)/admin/users/InviteForm.tsx). Use
  `Input` and `FormError` so error text is wired to the field with `aria-describedby`.
  Labels on every field; `type="tel"` and `inputMode="tel"` on phone.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. Route handlers stay untested for the reason auth-a, -b and
-c all recorded: there is no local server. The library layer beneath them is tested, and
the harness scenario drives the routes by hand.

### `tests/lib/memberStatusFilter.test.ts`

The phase plan calls this `member-status-filter.test.ts`; existing `tests/lib/` files are
camelCase (`pinLockout.test.ts`, `inviteEscalation.test.ts`) and RLS files are kebab-case.
Follow the directory, not the phase plan.

Extract the status resolution into a pure exported helper —
`resolveMemberStatuses(opts?: { statuses?: readonly MemberStatus[] }): readonly MemberStatus[]`
— so it can be tested without a network round trip.

- No options → `["active"]`
- `{ statuses: ["active", "moved_out"] }` → both, in that order
- `{ statuses: [] }` → falls back to the default rather than returning every member; an
  empty array is almost certainly a caller bug and `in ()` matches nothing, which would
  silently empty a page
- `ROSTER_BROWSE_STATUSES` contains `do_not_contact` and **not** `moved_out`

### `tests/lib/rosterMapping.test.ts`

Table-driven over the row→domain mappers. Assert a database row with `first_name`,
`household_id`, `created_at` produces `firstName`, `householdId`, `createdAt` — and that
**no mapped `Member` object has a `notes` key**. That last assertion is cheap and pins
Decision 1 against a future column being added and blindly spread.

### `tests/rls/member-notes.test.ts`

The highest-value test in this plan; `member_notes` has no coverage today. Use
`seedFixtures` and `asRole` from `tests/helpers/`, seed with the service client, assert
with role clients, and clean up in `afterAll`.

- A `bishop` reads a seeded note
- A `counselor` reads the same note — bishopric authority is shared (CLAUDE.md §7)
- An `org_president` reads **zero** notes for the same member
- A `ward_secretary` reads zero notes
- An `org_president` **cannot insert** a note (the write half — a read-only assertion
  would miss a policy that denies SELECT but permits INSERT)
- A bishop in ward B reads zero of ward A's notes

### `tests/rls/users-column-grant.test.ts`

Proves Task 1 Part 3 closed the gap.

- An authenticated user updates their own `theme_preference` → succeeds
- The **same** user updates their own `role` to `bishop` → refused. Assert the error is
  non-null, then re-read the row and assert `role` is unchanged — a column-privilege
  refusal surfaces as an error rather than a zero-row success, but assert the state too so
  the test cannot pass for the wrong reason
- A user updates their own `is_active` to `true` after being deactivated → refused
- The service-role client updates the same columns → still succeeds, proving admin flows
  are unaffected

---

## Test Scenarios (Harness)

### Scenario 007: Roster browse, edit, and the notes boundary

**Tags:** `[roster, full, rls]`
**Purpose:** The notes boundary is a refusal, and a unit test proves the query returns
nothing — only a walkthrough proves the panel is absent from the page rather than
rendered empty, and that a bishop and an org president see genuinely different screens.
Seeding a ward with households across all three statuses plus notes on specific members is
slow and error-prone by hand, and exact when seeded.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `bishop`, `counselor1`, `eqpres` (org_president, elders quorum), `secretary`
- Households — 6, one with no address, two sharing the family name "Smith"
- Members — 14 across the households: 9 `active`, 3 `youth` category, 2 `moved_out`,
  1 `do_not_contact`, one member with no household
- Member notes — 2 notes on one active member, created by `bishop`
- Notification triggers — all, including `new_household_added`

`createHousehold`, `createMember`, `addMemberToOrganization` and `createMemberNote`
already exist in `testing/infrastructure/seedUtils.ts`. No new factories are needed.

**Tester action:** Sign in as `bishop`, browse `/roster` in both views, search, filter by
category and status, open a household and a member, read the notes panel, edit a member's
phone, mark someone `moved_out`, add a household. Then sign in as `eqpres` and repeat the
browse. Then narrow to 375px. Then check `audit_log` and `notifications` in the Supabase
dashboard.

**Verification checklist:**
- [ ] The default `/roster` view is the household view, and it groups all 6 households
- [ ] The 2 `moved_out` members are absent until "Moved Out" is selected in the filter
- [ ] The `do_not_contact` member **is** shown, with a visually distinct badge whose
      meaning does not depend on colour alone
- [ ] The member with no household appears in the flat list view and is not silently lost
- [ ] Both "Smith" households are listed separately and are distinguishable
- [ ] Searching a partial last name matches; searching a family name matches the household
- [ ] As `bishop`, the member detail page shows the notes panel with both notes
- [ ] As `eqpres`, the notes panel is **absent from the page**, not present and empty
- [ ] As `eqpres`, no edit or "Add household" control appears anywhere on `/roster`
- [ ] Editing a phone number saves and the value survives a reload
- [ ] Marking a member `moved_out` removes them from the default view but the record
      remains reachable via the Moved Out filter
- [ ] Adding a household writes a `new_household_added` row to `notifications`
- [ ] `audit_log` has `household_created`, `member_updated`, and `member_note_created`
      rows with `module = 'roster'` and the acting user as `user_id`
- [ ] No `audit_log` `detail` field anywhere contains note text
- [ ] The view toggle choice survives a page reload
- [ ] At 375px the household view is stacked cards with full-width controls, no sideways
      scrolling, correct in both light and dark mode

**Failure behavior:**
- [ ] `eqpres` navigating directly to `/roster/member/<id>` sees the page without notes,
      not a 500 and not a blank screen
- [ ] A POST to `/api/members` from an `eqpres` session returns 403 with a readable
      message, not 500
- [ ] Submitting the member form with an empty last name shows the field error inline
- [ ] Opening `/roster/member/<a-uuid-that-does-not-exist>` renders the not-found page

---

## Validation Commands

Run in this order. The first two are not optional — the suite fails against a database
that does not have migration 022.

```bash
npx supabase db push
npm run db:types

npm run lint
npm run typecheck
npm test
npm run harness:typecheck
```

---

## Integration Notes

- **`NotPermitted` moves** from `app/(app)/admin/` to `components/ui/`. Update the import
  in `app/(app)/admin/page.tsx`. This is the only file outside the roster this plan
  touches beyond `navigation.ts` and `types/domain.ts`.
- **`types/database.ts` is regenerated**, so the diff will include the new function
  signature and unrelated formatting. That file is never hand-edited.
- **Roster-b consumes `listMembers` unchanged.** Do not add picker-specific parameters
  here; `MemberPicker` composes the existing filters.
- **Roster-c consumes `apply_roster_import`.** If its signature changes during roster-c,
  that is a new migration, not an edit to 022 — 022 will already be applied to the hosted
  project.
- **Documentation:** correct the `members.notes` paragraph in `plans/02-roster.md`
  (Decision 1). No change is needed to `SPEC.md` §API Routes — the routes built here match
  what it lists, with `/api/members/[id]/notes` added.
- **Breaking change, deliberate:** after migration 022 an authenticated session can no
  longer update any `users` column except `theme_preference`. Nothing in the app does, and
  a test proves it, but a future profile page will need the grant widened rather than
  guessing why its update silently fails.
