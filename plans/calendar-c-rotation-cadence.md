# Plan: Calendar C — Rotation Cadence & Organization Rotations

**Created:** 2026-08-19
**Type:** feature
**Phase:** 3 of 13 — part 3 of 3 ([plans/03-calendar.md](03-calendar.md))
**Structure:** Sequential — **depends on `calendar-a` (6d5048f) and `calendar-b` (b4b721d)**, both
committed and pushed

---

## Overview

Scenario 010's walkthrough found that the conducting rotation is built on a cadence this ward does
not use. `calendar-a` implements 03-calendar.md Step 3 exactly as written — the rotation advances
one step per **Sunday** — and the spec was wrong: the bishopric rotates **month by month**, one
member taking every Sunday in a month.

That is not a bug in the code, and no test could have caught it. It is a requirement that was never
written down, and this slice writes it down.

The same request extends the rotation to organization presidencies conducting their own Sunday
meetings, which the calendar has no representation for at all today.

**Key requirements**

1. A rotation carries a **cadence** — `weekly` or `monthly`. Weekly is what ships today and stays
   the default; monthly hands over at the month boundary
2. The same rotation machinery, with the same cadence choice, for all **six** organizations with a
   presidency, each independent of the sacrament meeting and of each other
3. Any single Sunday's conductor is overridable — for the sacrament meeting (already true) and for
   every organization (new)
4. An organization presidency manages **their own** rotation and nobody else's
5. Nothing in the month grid changes. `SundayCell` and `SundayCard`'s three reserved regions are
   Phase 4's and must not be touched

**Success criteria**

- A ward can set its bishopric rotation to monthly and see one name across every Sunday in a month
- Switching cadence applies forward only, exactly as reordering does — last month is not rewritten
- Each of the six organizations can hold its own rotation at its own cadence
- An Elders Quorum president can edit the Elders Quorum rotation and **cannot** edit the sacrament
  meeting rotation, the Relief Society rotation, or any Sunday's sacrament conductor — proven by
  RLS, not only by the route
- Overriding one Sunday's org conductor leaves the rotation and the surrounding Sundays alone
- Harness scenario 011 walked end to end with its results recorded
- `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `supabase/migrations/024_rotation_cadence.sql` | create | Cadence and org columns, `sunday_org_conducting`, tightened RLS |
| `types/database.ts` | regenerate | `npm run db:types` after the migration — never hand-edited |
| `types/domain.ts` | modify | `ROTATION_CADENCES`, `ROTATION_CADENCE_LABELS`, `ROTATION_ELIGIBLE_ORG_TYPES` |
| `lib/calendar/dates.ts` | modify | `countMonthsBetween()` |
| `lib/calendar/resolveConductingUser.ts` | modify | `cadence` on `RotationEntry`; the monthly branch |
| `lib/validation/calendar.ts` | modify | `cadence` and `orgId` on the rotation schema; org-conducting schema |
| `lib/calendar/queries.ts` | modify | Rotation reads/writes carry cadence and org; org-conducting CRUD; generation populates both |
| `lib/calendar/orgRotationScope.ts` | create | Pure "may this user manage this org's rotation" rule — client-safe |
| `lib/auth/permissions.ts` | modify | `calendar.manage_org_conducting` and its grants |
| `lib/notifications/notifyOrgLeadership.ts` | create | The org counterpart of `notifyOtherBishopric()` |
| `supabase/seed/notification_triggers.sql` | modify | `org_conducting_rotation_changed` trigger key |
| `app/api/conducting-rotation/route.ts` | modify | `orgId` on GET and PATCH; two different permission gates |
| `app/api/sundays/[id]/org-conducting/route.ts` | create | PATCH one organization's conductor for one Sunday |
| `app/(app)/calendar/ConductingRotationPanel.tsx` | modify | Cadence select and the forward-only sentence it needs |
| `app/(app)/calendar/OrgRotationPanel.tsx` | create | One panel per organization the viewer may manage |
| `app/(app)/calendar/page.tsx` | modify | Read org rotations, render the panels |
| `app/(app)/calendar/sunday/[id]/page.tsx` | modify | The organization conducting section |
| `app/(app)/calendar/sunday/[id]/OrgConductingEditor.tsx` | create | Per-Sunday override, one row per organization |
| `testing/infrastructure/seedUtils.ts` | modify | Cadence and org on `createConductingRotation`; `createSundayOrgConducting` |
| `tests/lib/conductingRotation.test.ts` | modify | Every `RotationEntry` literal gains `cadence` |
| `tests/lib/rotationCadence.test.ts` | create | The monthly rule, and `countMonthsBetween` |
| `tests/lib/orgRotationScope.test.ts` | create | Table-driven over the role matrix |
| `tests/rls/org-conducting.test.ts` | create | The highest-value tests in this slice |
| `tests/rls/calendar-access.test.ts` | modify | The documented asymmetry is now partly closed |
| `testing/scenarios/calendar/scenario-011-rotation-cadence/` | create | Seed + walkthrough |
| `plans/03-calendar.md` | modify | Record the cadence correction against Step 3 |

---

## Dependencies

- **`calendar-a` and `calendar-b` must both be committed.** This slice changes the signature of
  `RotationEntry`, the shape of `conducting_rotation`, and the Sunday detail page.
- **No new packages.** `Modal`, `Card`, `Button`, `Input`, `FormError`, `NotPermitted` and
  `ConductingLabel` all exist.
- **A migration means `npm run db:push` against the hosted project**, then `npm run db:types`.
  There is no local Docker stack (CLAUDE.md §9). `db:push` is additive here — it adds columns with
  defaults, adds a table, and replaces policies. It does not drop data.

---

## Known Pitfalls (from retro context)

1. **`lib/calendar/*` and `lib/roster/*` are server-only, and a client component importing one
   fails the build** (`plans/retros/roster-b-picker-and-orgs.md`). Every module there imports
   `createServerSupabaseClient`, which imports `next/headers`. `typecheck` and `lint` both pass a
   boundary violation; only `npm run build` catches it. **This is why `orgRotationScope.ts` is its
   own file importing types and nothing else** — `OrgRotationPanel` is a client component and needs
   the rule. `lib/roster/organizationScope.ts` is the precedent; copy its shape, including the
   header comment explaining why it is not in the obvious module.

2. **A `+` concatenation in a select-column constant silently breaks the row type**
   (`plans/retros/calendar-a-rules-and-api.md`). `ROTATION_COLUMNS` gains two columns and must stay
   **one string literal on one line**, however long it gets.

3. **A `ForbiddenError` escaping a Server Component becomes a 500** whose message Next.js strips in
   production (`plans/retros/auth-b-invites-admin.md`). Pages use `can()` + `<NotPermitted />`;
   only route handlers use `assertCan()`.

4. **`params` and `searchParams` are Promises in Next 16 and must be typed explicitly** — never the
   generated `PageProps` helper, which only exists after a build
   (`plans/retros/foundation-a-scaffold.md`).

5. **Every date is a `YYYY-MM-DD` string and every formatter passes `timeZone: "UTC"`**
   (`plans/retros/calendar-b-month-view.md`). `countMonthsBetween` must be **pure string
   arithmetic** — it never needs to construct a `Date` at all, which is the strongest possible
   version of this defence.

6. **A rotation change does not rewrite Sundays that already have a conductor**, and must not.
   `conducting_user_id` is stored rather than computed (03-calendar.md Step 3), and
   `populateConducting()` only fills rows that are still null. `calendar-b`'s plan expected
   otherwise and was wrong. **The same rule applies to the new org conducting**, and the cadence
   change inherits it: switching to monthly does not retroactively re-assign a generated month.
   Say so in the UI, and put it in the scenario checklist.

7. **A `catch` that maps every throw to one message will eventually be wrong about the common
   case** (`plans/retros/roster-c-csv-import.md`). The rotation 409 is a meaningful response, not a
   network failure.

8. **`emitNotification()` warns and sends nothing for a trigger key the ward has no
   `notification_settings` row for.** A new key must be added to
   `supabase/seed/notification_triggers.sql` **and** to `NOTIFICATION_TRIGGERS` in
   `testing/infrastructure/seedUtils.ts`, or the scenario will assert a notification that never
   arrives.

9. **Restart a dev server that has been up for hours before believing a 500.** Next 16's dev log is
   at `.next/dev/logs/next-development.log` (`plans/retros/roster-c-csv-import.md`).

---

## Decisions Already Made

Settled before implementation. Each is here so it is not relitigated mid-task.

1. **Cadence is a column on every rotation row, not a header table.** A rotation is already a *set*
   of three rows sharing an `effective_from`, written in one insert by `replaceConductingRotation`.
   Putting cadence on each row means **changing the cadence is inserting a new set** — so "cadence
   changes apply forward only" is true by construction, exactly like reordering, with no second
   mechanism to keep in step. The three rows of one set must agree; the schema cannot express that,
   so the data layer writes all three together and never exposes a per-row cadence write.

2. **`org_id IS NULL` means the bishopric's sacrament-meeting rotation.** One table, one resolver,
   one set of rules. The unique constraint becomes
   `unique nulls not distinct (ward_id, org_id, position, effective_from)` — `NULLS NOT DISTINCT`
   is required, because a plain unique constraint treats every NULL as distinct and would let two
   bishopric rotations land on the same date. Postgres 15+; verify with `select version()` before
   relying on it, and fall back to a pair of partial unique indexes if the project is older.

3. **Org conducting is STORED per (Sunday, organization), never computed at read time.** The same
   rule 03-calendar.md Step 3 imposes on sacrament conducting, for the same reason: a computed
   value silently rewrites history the moment the rotation changes. Rows are created when a month
   is generated, for organizations that have a rotation.

4. **Storage IS the override.** There is no `is_override` flag on `sunday_org_conducting`. Editing
   the row is the override, precisely as editing `sundays.conducting_user_id` is for the sacrament
   meeting. A flag would be a second source of truth about the same fact.

5. **A new permission, `calendar.manage_org_conducting`, rather than widening `calendar.manage`.**
   Organization leadership holds *no* calendar permission today. Widening `calendar.manage` would
   let an Elders Quorum president edit the sacrament meeting calendar, the conducting rotation and
   every Sunday's type. The new permission is granted to `bishop`, `counselor`, `org_president` and
   `org_counselor`, and is narrowed to the holder's **own** organization by RLS and by
   `orgRotationScope.ts`.

   **This overturns a deferral, deliberately.** `plans/retros/roster-b-picker-and-orgs.md` records
   that no permission expresses "may edit my own organization's data" and hands the decision to
   Phase 11. That was right for roster membership, which is arguably a clerk function. Who conducts
   an Elders Quorum meeting is not — requiring the bishopric to set it makes the feature pointless.
   Record in `plans/11-notifications-admin.md` that this is now the established shape, and that the
   roster gap should follow it rather than invent a second one.

6. **RLS is tightened, not inherited.** Migration 019's ward-scoped policy loop grants every
   authenticated ward member full write access to `conducting_rotation`, which is why
   `tests/rls/calendar-access.test.ts` documents an asymmetry instead of asserting a denial. This
   migration **drops those four policies and writes real ones**, and `sunday_org_conducting` gets
   real policies from birth (CLAUDE.md rule 2: write the policy first, then the route). Nobody
   loses access they could actually use — `admin.manage_ward` already gated the route.

7. **Monthly anchors on the month containing `effective_from`.** A rotation effective 2026-03-15
   makes March position 1's month, governing 03-15, 03-22 and 03-29; April is position 2. The
   alternative — starting at the next whole month — leaves a fortnight with no rule.

8. **Org conducting appears on the Sunday detail page only.** The month grid keeps showing
   sacrament conducting. `SundayCell` and `SundayCard` are not touched: their three reserved
   regions belong to Phase 4, and `tests/components/calendar/SundayCell.test.tsx` asserts that
   contract.

9. **All three org leadership roles are selectable in an org rotation** — president, counselor and
   secretary. A secretary rarely conducts, but a ward that wants it should not be told no by a
   schema, and the ward simply does not pick them otherwise.

---

## Tasks

### Task 1: Migration 024

**File:** `supabase/migrations/024_rotation_cadence.sql` (create)

Follow migration 023's structure exactly — numbered parts, a comment above each explaining *why*
rather than what, and `comment on column` / `comment on table` for anything a later reader would
have to guess at.

**Part 1 — cadence**

```sql
alter table conducting_rotation
  add column cadence text not null default 'weekly'
    check (cadence in ('weekly', 'monthly'));
```

Default `'weekly'` so existing rows keep behaving exactly as they do today. Comment that the three
rows of one set must agree and that the data layer is what guarantees it.

**Part 2 — organization**

```sql
alter table conducting_rotation
  add column org_id uuid,
  add constraint conducting_rotation_org_fkey
    foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade;
```

Comment that NULL means the bishopric's sacrament-meeting rotation (Decision 2).

**Part 3 — the unique constraint**

Drop `conducting_rotation_ward_position_effective_key` from migration 023 and replace it with one
that includes `org_id` and treats NULLs as equal:

```sql
alter table conducting_rotation
  drop constraint conducting_rotation_ward_position_effective_key,
  add constraint conducting_rotation_ward_org_position_effective_key
    unique nulls not distinct (ward_id, org_id, position, effective_from);
```

`replaceConductingRotation` already maps `23505` to a 409, so the conflict path keeps working
unchanged — but the message must now name the organization, not just the date.

**Part 4 — `sunday_org_conducting`**

```sql
create table sunday_org_conducting (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  sunday_id  uuid not null,
  org_id     uuid not null,
  user_id    uuid,
  created_at timestamptz not null default now(),
  unique (ward_id, sunday_id, org_id),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id)
);

create index sunday_org_conducting_ward_sunday_idx
  on sunday_org_conducting (ward_id, sunday_id);
```

`user_id` is nullable — "nobody assigned yet" is a real state, and it is what an unfilled rotation
position resolves to.

The composite foreign keys are how the ward scope is enforced structurally: a row cannot point at a
Sunday in one ward and an organization in another. `sundays` already carries `unique (id, ward_id)`
(migration 004) and `organizations` carries the matching pair.

**Part 5 — RLS**

Enable RLS, then write four policies. Read is ward-wide; write is bishopric **or** the caller's own
organization:

```sql
alter table sunday_org_conducting enable row level security;

create policy sunday_org_conducting_ward_select on sunday_org_conducting
  for select to authenticated
  using (ward_id = current_ward_id());

-- insert / update / delete, each with the same predicate:
--   ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())
```

Write all four out longhand rather than in a loop. The loop in 019 exists because twenty-four
identical blocks drift; four different ones do not.

**Part 6 — tighten `conducting_rotation`**

Drop the four policies migration 019's loop created (`conducting_rotation_ward_select`,
`_ward_insert`, `_ward_update`, `_ward_delete`) and replace them with the same shape as Part 5,
where the org branch requires a non-null `org_id`:

```
ward_id = current_ward_id()
and (is_bishopric() or (org_id is not null and org_id = current_org_id()))
```

The `org_id is not null` half is load-bearing: without it, a user whose `org_id` happens to be NULL
would match the bishopric rotation's NULL `org_id` and gain write access to it.

Comment that this deliberately narrows what 019 granted, and why that costs nobody anything.

**Then:** `npm run db:push`, then `npm run db:types`. `types/database.ts` is generated — do not
hand-edit it (CLAUDE.md §5).

---

### Task 2: Domain types

**File:** `types/domain.ts` (modify)

```ts
export const ROTATION_CADENCES = ["weekly", "monthly"] as const;
export type RotationCadence = (typeof ROTATION_CADENCES)[number];

export const ROTATION_CADENCE_LABELS: Record<RotationCadence, string> = {
  weekly: "A different person each Sunday",
  monthly: "One person for the whole month",
};
```

The labels are sentences, not the words "Weekly" and "Monthly". This is the control most likely to
be set wrong by somebody who has not read a plan, and "Monthly" alone does not distinguish "one
person per month" from "the rotation restarts monthly".

Also add `ROTATION_ELIGIBLE_ORG_TYPES` — the six organization types with a presidency, taken from
`ORGANIZATION_TYPES` and excluding `bishopric` (whose rotation is the sacrament one, keyed by NULL)
and `other`.

---

### Task 3: `countMonthsBetween`

**File:** `lib/calendar/dates.ts` (modify)

```ts
export function countMonthsBetween(from: DateOnly, to: DateOnly): number;
```

Pure string arithmetic — `(toYear - fromYear) * 12 + (toMonth - fromMonth)`. It must not construct
a `Date` at all, which makes it the one date helper in this codebase that is timezone-proof by
having nothing to get wrong. Validate both arguments through `parseDateOnly` first so a malformed
input throws here rather than producing a plausible number.

A negative result is returned as-is, matching `countSundaysBetween`. The caller decides what a date
before the anchor means.

---

### Task 4: The monthly resolution rule

**File:** `lib/calendar/resolveConductingUser.ts` (modify)

Add `cadence` to `RotationEntry`:

```ts
export type RotationEntry = {
  position: RotationPosition;
  userId: string | null;
  effectiveFrom: DateOnly;
  cadence: RotationCadence;
};
```

This is a **breaking change on purpose** — every construction site fails to compile until it says
which cadence it means. Do not give it a default.

`resolveConductingUser` keeps its three-parameter signature and reads the cadence off the active
set, so a caller cannot pass a cadence that disagrees with the rows:

```ts
const active = activeRotation(rotation, sundayDate);
if (active.length === 0) return null;

const offset =
  active[0].cadence === "monthly"
    ? countMonthsBetween(monthStart(anchorDate), monthStart(sundayDate))
    : countSundaysBetween(firstSundayOnOrAfter(anchorDate), sundayDate);

if (offset < 0) return null;
const position = ROTATION_POSITIONS[offset % ROTATION_POSITIONS.length];
return active.find((entry) => entry.position === position)?.userId ?? null;
```

Every existing guarantee is preserved and must stay tested: a negative offset returns null rather
than wrapping, and an unfilled position returns null rather than skipping to the next one.

Update the module header comment. It currently explains only the weekly cycle.

---

### Task 5: Validation

**File:** `lib/validation/calendar.ts` (modify)

- `conductingRotationSchema` gains `cadence: z.enum(ROTATION_CADENCES)` and
  `orgId: z.uuid().nullable()` (null = the bishopric rotation).
- New `sundayOrgConductingSchema`: `{ orgId: z.uuid(), userId: z.uuid().nullable() }`.

No `wardId` on either, ever — it comes from the session (conventions.md §Validation).

---

### Task 6: Data layer

**File:** `lib/calendar/queries.ts` (modify)

- `ROTATION_COLUMNS` gains `cadence` and `org_id`. **One string literal on one line** (Pitfall 2).
- `mapRotationRow` maps both, validating `cadence` through the existing `toEnumValue` helper.
- `listConductingRotation(wardId, opts?: { orgId?: string | null }, client?)` — an explicit
  `orgId: null` reads the bishopric rotation, a uuid reads that organization's, and omitting the
  option reads **all** of them for the calendar page. Use `.is("org_id", null)` for the null case;
  `.eq()` does not match NULL.
- `replaceConductingRotation` writes `cadence` and `org_id` on all three rows.
  `ConductingRotationConflictError` gains the organization so the route's message can name it.
- New: `listSundayOrgConducting(wardId, sundayId, client?)` and
  `setSundayOrgConducting(wardId, sundayId, orgId, userId, client?)` — the setter upserts on
  `(ward_id, sunday_id, org_id)` and returns null when RLS refused, matching how `updateSunday`
  reads a zero-row update as "not yours".
- New: `listOrgLeadershipUsers(wardId, orgId, client?)` — active users in that organization holding
  `org_president`, `org_counselor` or `org_secretary`. Mirrors `listBishopricUsers`.
- `populateConducting` gains an organization pass: for each organization with an active rotation,
  insert a `sunday_org_conducting` row for every Sunday in the range that has none, resolved
  through `resolveConductingUser`. **Only where no row exists** — an override a human typed is
  never overwritten by a later generation, which is the same guarantee the sacrament pass gives and
  the same reason `ignoreDuplicates` is load-bearing in `generateSundayRange`.

---

### Task 7: Permissions and the org scope rule

**Files:** `lib/auth/permissions.ts` (modify), `lib/calendar/orgRotationScope.ts` (create)

Add `"calendar.manage_org_conducting"` to `PERMISSIONS`, beside the two existing calendar entries.
Grant it to `BISHOPRIC_PERMISSIONS` (which is `PERMISSIONS`, so it arrives automatically),
`ORG_LEADERSHIP_PERMISSIONS` — and **not** to `ORG_SECRETARY_PERMISSIONS`. A secretary may be
*picked* to conduct (Decision 9); setting who conducts is a presidency decision.

`lib/calendar/orgRotationScope.ts` holds the pure rule and imports **types only** (Pitfall 1):

```ts
export function manageableOrgIds(
  user: SessionUser,
  organizations: { id: string; type: OrganizationType }[],
  roleAccess?: RoleAccess,
): string[];
```

Bishopric gets every organization whose type is in `ROTATION_ELIGIBLE_ORG_TYPES`; an org leader
gets `[user.orgId]` if it is eligible, otherwise `[]`. Anyone without
`calendar.manage_org_conducting` gets `[]`.

Unlike `defaultOrganizationFilter`, this **is** a boundary — but it is the second of two, not the
only one. RLS is the first. Say so in the header comment, and do not let a future reader mistake it
for a convenience filter the way `organizationScope.ts` warns against.

---

### Task 8: Notifications

**Files:** `lib/notifications/notifyOrgLeadership.ts` (create),
`supabase/seed/notification_triggers.sql` (modify), `testing/infrastructure/seedUtils.ts` (modify)

Add the trigger key `org_conducting_rotation_changed`, default roles `org_president`,
`org_counselor`, `org_secretary`. Add it to **both** the seed SQL and `NOTIFICATION_TRIGGERS` in
`seedUtils.ts` (Pitfall 8).

`notifyOrgLeadership()` mirrors `notifyOtherBishopric()` exactly — resolve the recipients
explicitly, pass them to `emitNotification`, never throw. Recipients are the active
president/counselor/secretary of that organization, minus the acting user.

The reason the bishopric version exists — shared authority feels shared only when the others are
told — applies identically to a presidency of three.

---

### Task 9: API routes

**Files:** `app/api/conducting-rotation/route.ts` (modify),
`app/api/sundays/[id]/org-conducting/route.ts` (create)

**`GET /api/conducting-rotation`** — accepts `?orgId=`. Still `calendar.view`: who conducts is not
sensitive, and the music coordinator plans against it.

**`PATCH /api/conducting-rotation`** — **two gates, chosen by the body's `orgId`:**

- `orgId === null` → `assertCan(user, "admin.manage_ward")`, unchanged
- `orgId` is a uuid → `assertCan(user, "calendar.manage_org_conducting")` **and** that id must be in
  `manageableOrgIds(user, organizations, roleAccess)`. Both checks, not either — the permission says
  "may manage an org rotation" and the scope says "this one"

Audit action stays `conducting_rotation_updated`, with `orgId` and `cadence` in the detail. Notify
`notifyOtherBishopric` for the ward rotation and `notifyOrgLeadership` for an org one.

**`PATCH /api/sundays/[id]/org-conducting`** — new, one organization per request. Same paired
check. Audit action `sunday_org_conducting_updated`. `notifyOrgLeadership` on a real change only,
matching how the Sunday route only notifies when `conductingUserId` actually changed.

A 404 when the Sunday is not this ward's — `getSunday` returning null and RLS refusing are
indistinguishable and both mean "not yours" (`plans/retros/foundation-c-services.md`).

---

### Task 10: The rotation UI

**Files:** `app/(app)/calendar/ConductingRotationPanel.tsx` (modify),
`app/(app)/calendar/OrgRotationPanel.tsx` (create), `app/(app)/calendar/page.tsx` (modify)

`ConductingRotationPanel` gains a cadence select above the three position selects, labelled from
`ROTATION_CADENCE_LABELS`. The existing forward-only sentence needs one more clause, because
cadence now changes with it:

> *"Changing the rotation or its cadence applies from the effective date forward. Sundays already
> assigned keep their current conductor."*

The second sentence is the one scenario 010 proved people need — it is what stops a bishopric
expecting March to re-shuffle.

`OrgRotationPanel` is the same form with an organization heading, posting `orgId`. `page.tsx`
renders one per entry in `manageableOrgIds`, each collapsed in its own `<details>` beside the
bishopric panel. A viewer who manages no organization sees none — **absent, not disabled**, which
is what scenario 010 established for the rotation panel and what the checklist asserts.

Reuse the existing panel by extracting the shared form rather than copying it, but do not
restructure `ConductingRotationPanel`'s existing behaviour while doing so.

---

### Task 11: Per-Sunday org override

**Files:** `app/(app)/calendar/sunday/[id]/page.tsx` (modify),
`app/(app)/calendar/sunday/[id]/OrgConductingEditor.tsx` (create)

A new section on the detail page, below the existing card and above the Phase 4 Speakers stub:
one row per organization that has a rotation, showing the organization name and its conductor
through the existing `ConductingLabel` — so an unset or unrecognised id renders "Not set" and never
a uuid.

For an organization the viewer may manage, the row becomes a select. Saving `PATCH`es the new route
and calls `router.refresh()`. One row saves independently of the others; there is no "save all"
button, because a bulk save over six organizations makes a partial failure impossible to report
honestly.

Gate the whole section on `calendar.view`. Do **not** gate it on `talks.view` — that gate belongs
to the Speakers stub, and who conducts Relief Society is not talk-pipeline data.

---

### Task 12: Close out

**Files:** `plans/03-calendar.md` (modify), `plans/11-notifications-admin.md` (modify)

Record against Step 3 that the cadence is now a ward choice and that Step 3's weekly cycle
describes the default rather than the only rule. Record scenario 011's results, including anything
that failed.

In `plans/11-notifications-admin.md`, record that `calendar.manage_org_conducting` is the
established shape for "may manage my own organization's data", and that the roster gap
`roster-b` deferred should follow it rather than invent a second one (Decision 5).

---

## Testing Strategy

RLS first — it is the highest-value suite in this codebase (CLAUDE.md §8) and this slice adds the
first genuinely org-scoped write boundary in the app.

### `tests/rls/org-conducting.test.ts` (create)

The suite that matters. Seed two wards and two organizations through the service client, then
assert through the anon client that:

- An Elders Quorum president **can** insert and update their own organization's rotation
- The same president **cannot** write the Relief Society rotation — a different org in the same ward
- The same president **cannot** write the bishopric rotation (`org_id IS NULL`). This is the check
  Part 6's `org_id is not null` clause exists for, and it fails loudly if that clause is dropped
- A president in ward A cannot write ward B's rotation at any org
- The same four assertions again for `sunday_org_conducting`
- Every role that can read the calendar can **read** every organization's conducting

These must clean up after themselves and cannot assume an empty table — they run over the network
against the shared hosted project (CLAUDE.md §9).

### `tests/lib/rotationCadence.test.ts` (create)

- `countMonthsBetween` across a year boundary, in both directions, and returning 0 for two dates in
  the same month
- Monthly: four consecutive Sundays in one month all resolve to the same user
- Monthly: the first Sunday of the next month resolves to position 2
- Monthly: a rotation effective mid-month governs the rest of that month at position 1 (Decision 7)
- Monthly across a year boundary — December is position N, January is position N+1
- Weekly behaviour is **unchanged** for every existing case
- A negative offset returns null under both cadences rather than wrapping
- An unfilled position returns null under both cadences rather than skipping

### `tests/lib/orgRotationScope.test.ts` (create)

Table-driven over all ten roles × an eligible org, an ineligible org, and a null `orgId`.

### `tests/lib/conductingRotation.test.ts` (modify)

Every `RotationEntry` literal gains `cadence: "weekly"`. The assertions do not change — that is the
point, and it is the proof the default is genuinely unchanged.

### Not tested here, and why

- **Route handlers** — no local server, seventh phase running (`roster-c` retro). Scenario 011
  drives them by hand, including the two 403 paths.
- **The panels' rendering** — the shared form is the same component `calendar-b` already ships.

---

## Test Scenarios (Harness)

### Scenario 011: Monthly cadence and an organization rotation

**Path:** `testing/scenarios/calendar/scenario-011-rotation-cadence/`
**Tags:** `[calendar, full, rotation, permissions]`
**Prerequisites:** none

**Purpose**

Two things no unit test can reach. First, that switching the bishopric to monthly and then
generating a month produces **one name across every Sunday** — the visible shape of the
requirement, and the thing scenario 010 revealed was wrong. Second, that an Elders Quorum president
can manage their own rotation and is genuinely stopped — by RLS, from the browser console, not just
by a hidden button — from touching the sacrament rotation or another organization's.

The permission boundary is the higher-risk half. This is the first org-scoped write in the app, and
a route that forgot its scope check would look completely normal on screen.

**Seed data summary**

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop`, `counselor1`, `counselor2` — the bishopric rotation |
| | `eqpres` (org_president, Elders Quorum) and `eqcounselor` (org_counselor, Elders Quorum) |
| | `rspres` (org_president, Relief Society) — the other-org seat |
| | `secretary` (ward_secretary) — holds `calendar.manage` but **no** org rotation rights |
| Rotations | Bishopric, **weekly**, effective 2026-01-04 |
| | Elders Quorum, **monthly**, effective 2026-01-04 |
| Sundays | May 2026 generated: 05-03, 05-10, 05-17, 05-24, 05-31 |
| Notification triggers | all, including `org_conducting_rotation_changed` |

May 2026 has five Sundays and opens on a Friday, so the grid has leading blanks and the monthly
cadence has to hold across five Sundays rather than four — both cases the March scenario cannot show.

**Tester action**

Sign in as `bishop`, switch the bishopric rotation to monthly effective 2026-06-01, generate June
and July, and read who conducts. Then sign in as `eqpres` and work the Elders Quorum rotation and a
per-Sunday override. Then attempt the two refused writes from the console.

**Verification checklist**

Monthly cadence
- [ ] The cadence control reads as a sentence, not the bare word "Monthly"
- [ ] Switching to monthly effective 2026-06-01 leaves **May unchanged** — still a different
      conductor each Sunday
- [ ] June's four Sundays all show the **same** conductor
- [ ] July's Sundays all show the next person in the order
- [ ] A rotation effective mid-month governs the rest of that month at position 1
- [ ] The forward-only sentence mentions the cadence, not just the order

Organization rotation
- [ ] `eqpres` sees an Elders Quorum rotation panel and **no** bishopric panel
- [ ] `eqpres` sees no Relief Society panel
- [ ] Saving the Elders Quorum rotation succeeds and says the rest of the presidency were notified
- [ ] `eqcounselor` receives an `org_conducting_rotation_changed` notification; `eqpres` does not;
      **the bishop does not**
- [ ] A Sunday detail page lists every organization with a rotation and its conductor
- [ ] `eqpres` can override one Sunday's Elders Quorum conductor
- [ ] That override survives re-opening the month, and the Sundays either side are unchanged
- [ ] `rspres` sees the Elders Quorum conductor read-only, with no select

Permissions — the half that matters
- [ ] `secretary` sees no organization rotation panel at all
- [ ] `eqpres` PATCHing `/api/conducting-rotation` with `orgId: null` gets **403**
- [ ] `eqpres` PATCHing it with the **Relief Society** org id gets **403**
- [ ] Both of those refused writes leave `audit_log` untouched
- [ ] With the route bypassed entirely, a direct PostgREST insert into `conducting_rotation` for
      another org from `eqpres`'s session is refused by **RLS** — this is the check that proves the
      boundary is the policy and not the route
- [ ] `eqpres` cannot change any Sunday's sacrament conductor or type

**Seed file:** `seed.ts` following `testing/scenarios/_templates/seed-template.ts`. Register with
`npm run manifest`.

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project, then regenerate the types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm run test

# Harness typecheck + seed for scenario 011
npm run harness:typecheck
npm run manifest
npm run seed -- calendar/scenario-011-rotation-cadence

# Production build — the only thing that catches a client component importing a
# server-only module (Pitfall 1)
npm run build
```

Then walk scenario 011 in a browser, at 375px and at desktop width, in both themes. The app is live
at `https://wlt-iota.vercel.app` once pushed.

**`db:push` runs against the shared hosted project and there is no local stack.** Read the
migration once more before running it — Part 3 and Part 6 both drop objects, and the RLS tests
begin failing loudly if Part 6 lands wrong.

---

## Integration Notes

- **Breaking change, contained and compiler-enforced.** `RotationEntry` gains a required `cadence`,
  so every construction site fails to compile until it says what it means. That is deliberate; do
  not add a default to soften it.
- **`types/database.ts` must be regenerated** after `db:push` or every new column reads as unknown
  and the mappers silently drop it (CLAUDE.md rule 9).
- **`tests/rls/calendar-access.test.ts` needs updating, not deleting.** Its header documents the
  ward-scoped write asymmetry on `conducting_rotation`; Part 6 closes half of it. `sundays` keeps
  the asymmetry and the comment must say so, narrowed rather than removed.
- **Nothing in the month grid changes.** `SundayCell`, `SundayCard`, `MonthGrid` and their tests are
  untouched, and Phase 4's three reserved regions are unaffected.
- **Hands forward to Phase 4:** nothing new. This slice adds no pipeline surface.
- **Hands forward to Phase 11:** the org-scoped permission shape (Decision 5), and the roster gap
  that should now follow it.
- **Known gap to carry into the retro:** switching cadence does not re-populate months that are
  already generated, by design — but a ward that switches to monthly and then looks at an
  already-generated next month will see the old weekly assignment and may read it as a bug. The
  honest fix is a "re-apply the rotation to this month" action that clears and re-populates, which
  is its own decision about destroying overrides. Record it; do not build it here.
- **Also carry forward:** `scenario-008` (roster-b) is still unwalked, handed forward four times
  now, and `roster-c`'s CSV alias table is still unverified against a real LCR export.
