# Plan: Roster B — MemberPicker and Organization Membership

**Created:** 2026-08-17
**Type:** feature
**Phase:** 2 of 13 — see [02-roster.md](02-roster.md), part 2 of 3
**Depends on:** [roster-a-data-and-pages.md](roster-a-data-and-pages.md) — must be complete
**Sibling:** [roster-c-csv-import.md](roster-c-csv-import.md)

---

## Overview

Two things that look unrelated and are not: `MemberPicker` is the component every later
module uses to choose people, and organization membership is what decides which people it
offers by default.

`MemberPicker` is the highest-stakes piece of design in Phase 2. Phases 4, 7, 8 and 10 all
consume it, and 02-roster.md §Pitfalls is blunt about the cost of getting the props wrong:
"changing its signature later means touching every module." Decide the interface here,
write it down, and treat it as frozen.

### Key requirements

1. `MemberPicker` — modal or inline, single or multiple, filterable, household-browsable
2. `do_not_contact` members excluded by default, includable behind an explicit confirmation
3. `member_organizations` editable per member and in bulk from the roster list
4. Non-bishopric callers get an organization-filtered list without asking for one

### Success criteria

- `MemberPicker` renders standalone, is driven end to end in the harness, and its props
  cover single-select, multi-select, category filtering, exclusion, and flag display
- An `org_president`'s roster and picker default to their own organization's members
- Bulk assign moves a selection of members into an organization in one action
- `npm run lint`, `npm run typecheck`, and `npm test` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `components/providers/QueryProvider.tsx` | create | `QueryClientProvider` — see Decision 3 |
| `app/(app)/layout.tsx` | modify | Wrap the shell in `QueryProvider` |
| `components/roster/MemberPicker.tsx` | create | The frozen interface |
| `components/roster/MemberPickerModal.tsx` | create | Modal shell, extracted so the inline mode stays simple |
| `components/roster/ReliabilityFlag.tsx` | create | Interface only — Phase 4 implements the logic |
| `components/ui/Modal.tsx` | create | Primitive; SPEC.md §Component Structure already names it |
| `lib/roster/organizations.ts` | create | Organization membership reads and writes |
| `lib/roster/queries.ts` | modify | Implement the `organizationId` filter and the caller default |
| `lib/validation/roster.ts` | modify | `setMemberOrganizationsSchema`, `bulkAssignSchema` |
| `app/api/members/[id]/organizations/route.ts` | create | `PUT` — replace a member's organizations |
| `app/api/roster/bulk-assign/route.ts` | create | `POST` — assign many members to one organization |
| `app/(app)/roster/member/[id]/MemberOrganizations.tsx` | create | Client — edit one member's organizations |
| `app/(app)/roster/BulkAssignBar.tsx` | create | Client — selection bar over the flat list |
| `components/roster/MemberList.tsx` | modify | Optional selection checkboxes |
| `tests/lib/memberPickerFilters.test.ts` | create | Pure filter composition |
| `tests/lib/rosterOrgDefault.test.ts` | create | The per-role default organization filter |
| `tests/rls/org-isolation.test.ts` | modify | Extend with `member_organizations` |
| `testing/scenarios/roster/scenario-008-*` | create | Harness scenario |
| `plans/02-roster.md` | modify | Record the `onSelect` → `value`/`onChange` change (Decision 1) |

---

## Dependencies

No new libraries. `@tanstack/react-query` is already in `package.json` and named in
CLAUDE.md §3; it simply has no provider yet (Decision 3).

Everything from roster-a is a hard prerequisite: `listMembers`, `listHouseholds`,
`DEFAULT_MEMBER_STATUSES`, `MemberStatusBadge`, `GET /api/members`.

**No migration.** `member_organizations` already exists (migration 003) with
`unique (member_id, org_id)` and composite foreign keys to both parents.

---

## Decisions Made Before Writing This Plan

### 1. `MemberPicker` is controlled — `value` / `onChange`, not `onSelect`

02-roster.md §Step 3 sketches `onSelect`. That fits a single-select modal and fights
everything else: Phase 4 picks three speakers for one Sunday, Phase 10 picks pairs for
sacrament assignments, and both need to render the current selection *outside* the picker
and remove from it. A controlled array handles single and multiple with one interface;
`onSelect` would need a second one bolted on.

`multiple: false` still passes an array of length 0 or 1 — one shape, no branching in
consumers. Record this change in `plans/02-roster.md` so the phase plan and the code do
not contradict each other.

### 2. The `do_not_contact` override is a confirmation, not a prop the caller sets silently

02-roster.md: excluded from assignment and visit pickers by default, "allow an explicit
override with a confirmation, because occasionally a bishop legitimately needs to."

So `allowDoNotContact` does **not** mean "include them in the list". It means "offer a
control that, when the user activates it and confirms, reveals them". Default `false`.
When `false` they are not fetched at all. The confirmation text names the consequence:
*"This member is marked Do Not Contact. Include them anyway?"*

### 3. Wire `QueryClientProvider` now

`MemberPicker` is the first component in this app that fetches from the client, and four
later phases will open it repeatedly within a session. Refetching the whole roster on
every open is the wrong default when the caching layer is already a declared dependency.

This is wiring, not a new dependency — `@tanstack/react-query` is in `package.json` and
CLAUDE.md §3 names it as the data-fetching layer for client components. The provider goes
in `app/(app)/layout.tsx` only, so the `(auth)` and `(youth)` shells are untouched.

`staleTime` of 60 seconds on the roster query: long enough that opening a picker three
times in a planning session is one request, short enough that an edit made in another tab
is not stale for long. Invalidate the `["members"]` key after any roster mutation.

### 4. The organization default is applied in the page, not buried in the query

02-roster.md §Step 1: "Non-bishopric callers get a filtered list. RLS handles the hard
boundary; the data layer applies the org filter so an EQ president's picker shows EQ
members by default without them having to filter manually."

A default that lives inside `listMembers` is a default nobody can see. Instead export a
pure function:

```ts
export function defaultOrganizationFilter(user: SessionUser): string | undefined
```

Returns `user.orgId` for org roles, `undefined` for bishopric, secretaries, music
coordinator, and ward council member. The page and the picker call it and pass the result
through as an ordinary filter — visible in the URL, overridable by the user, and testable
without a database.

**This is a convenience, never a boundary.** `members` is ward-scoped in RLS, so an org
president who clears the filter genuinely can see the whole ward roster. That is intended:
FEATURES.md gives every ward leader roster visibility. Do not describe this filter as
security anywhere.

### 5. `ReliabilityFlag` ships as an interface with no logic

Phase 4 owns the reliability patterns (declined twice, no-showed, etc.). Shipping a
guessed implementation now means Phase 4 rewrites it. Ship the props, render nothing when
`flags` is empty, and render a badge per flag when it is not.

```ts
export type ReliabilityFlagKind = "declined_recently" | "no_show" | "spoke_recently";
export type ReliabilityFlagProps = { flags: readonly ReliabilityFlagKind[] };
```

The union is a starting point Phase 4 will extend, not a contract. Say so in the file.
Bishopric-only: `MemberPicker` renders it only when `showFlags` is true, and only the
bishopric ever passes `showFlags`.

---

## Known Pitfalls (from retro context)

- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — a static route segment beside a
  dynamic one is matched first, but the collision is easy to re-introduce.
  `/api/roster/bulk-assign` sits beside `/api/roster/import` (roster-c); neither is
  dynamic, so there is no conflict today. Keep it that way.
- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — a field the server accepts and then
  discards is the silent drop CLAUDE.md rule 9 exists to prevent. `setMemberOrganizations`
  takes organization ids and nothing else; do not add a field the function ignores.
- **[foundation-c-services](retros/foundation-c-services.md)** — a write denied by policy
  comes back as success with zero rows. The bulk-assign path must count what it actually
  wrote and report that count, not the count it was asked for.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — validate the organization
  belongs to this ward before writing, and return "That organization is not in your ward."
  `updateWardUser` does exactly this; copy it. The composite foreign key would reject a
  cross-ward write anyway, but a foreign-key violation is not a message a user can act on.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — `requireSessionUser()`
  outside the try; `readJsonBody()` not `request.json()`; error text in the message string,
  not the payload object.
- **roster-a Decision 3** — the ward-scoped policy loop lets **any** authenticated ward
  member insert into `member_organizations`. `assertCan(user, "roster.manage")` in the
  route is the real boundary for these writes.

---

## Tasks

### Task 1: Query provider

**Files:** `components/providers/QueryProvider.tsx` (create), `app/(app)/layout.tsx` (modify)

**Details:**

```tsx
"use client";
export function QueryProvider({ children }: { children: ReactNode }) { … }
```

Create the `QueryClient` inside `useState(() => new QueryClient({ … }))` — a module-level
client is shared across requests on the server and leaks one user's cache into another's
render. This is the single most common mistake with this library; comment it.

Defaults: `staleTime: 60_000`, `refetchOnWindowFocus: false` (a roster is not a live
feed, and a refetch on every tab switch is noise on mobile).

Wrap only the children of `app/(app)/layout.tsx`, inside the existing shell markup. Leave
`(auth)` and `(youth)` alone — neither has a client fetch and neither should acquire one.

---

### Task 2: Modal primitive

**File:** `components/ui/Modal.tsx` (create)

**Details:** SPEC.md §Component Structure already lists `Modal` under `/components/ui`.
Build the minimum that is correct rather than a configurable dialog system.

Use the native `<dialog>` element with `showModal()`. It gives focus trapping, the
backdrop, and `Escape`-to-close from the platform instead of from hand-written key
handlers.

Props: `{ isOpen, onClose, title, children }`. Requirements:

- `aria-labelledby` pointing at the title
- Focus returns to the trigger on close
- On mobile the dialog is full-height with its own internal scroll; the page behind must
  not scroll
- Theme tokens for backdrop and surface, `dark:` variants on both

This is a shared primitive, not roster-scoped — Phases 4, 6, 7 and 10 will all use it.

---

### Task 3: The MemberPicker interface

**File:** `components/roster/MemberPicker.tsx` (create)

**Action:** Write the props type first, in full, with a header comment stating that four
later phases consume it and that changes are breaking. Then implement against it.

```ts
export type MemberPickerFilter = {
  categories?: readonly MemberCategory[];
  genders?: readonly MemberGender[];
  statuses?: readonly MemberStatus[];
  organizationId?: string;
  householdId?: string;
};

export type MemberPickerProps = {
  value: readonly string[];
  onChange: (memberIds: string[]) => void;
  multiple?: boolean;
  max?: number;
  filter?: MemberPickerFilter;
  excludeIds?: readonly string[];
  allowDoNotContact?: boolean;
  showFlags?: boolean;
  mode?: "modal" | "inline";
  label?: string;
  triggerLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
};
```

Why each one exists — this is the record that stops the next phase adding a redundant prop:

| Prop | Default | Who needs it |
|---|---|---|
| `value` / `onChange` | required | Everyone. Controlled, always an array (Decision 1) |
| `multiple` | `false` | Phase 4 (three speakers), Phase 10 (blesser pairs) |
| `max` | none | Phase 10 caps a pair at 2; Phase 4 caps at the Sunday's slot count |
| `filter.categories` | none | Phase 10 needs youth only; Phase 4 separates youth and adult speakers |
| `filter.genders` | none | Phase 10 — sacrament ordinances draw from young men |
| `filter.statuses` | `["active"]` | The safe default from roster-a. Never widen it here |
| `filter.organizationId` | from `defaultOrganizationFilter` | Phase 7 — an EQ president's visit picker |
| `filter.householdId` | none | Phase 7 — picking a member within a household already chosen |
| `excludeIds` | `[]` | Phase 10 — the water blesser must differ from the bread blesser |
| `allowDoNotContact` | `false` | The confirmation path (Decision 2) |
| `showFlags` | `false` | Phase 4 planning view, bishopric only |
| `mode` | `"modal"` | Inline for a form field; modal for everything else |

**Behaviour:**

- Browses **by household** — FEATURES.md §Module 1 says every assignment and activity
  module browses members through the household view, and 02-roster.md repeats it. Group
  by household, with a search box that flattens to matching members while a term is active.
- Fetches through `GET /api/members` with TanStack Query, keyed on the resolved filter, so
  two pickers with the same filter share one request.
- `excludeIds` filters client-side after the fetch — it changes per open and would
  fragment the cache key.
- Selected members appear as removable chips above the list, so the current selection is
  visible without scrolling.
- `max` reached: remaining rows become disabled with a visible reason, rather than
  silently ignoring a tap.
- Empty result: distinguish "nobody matches this filter" from "the roster is empty".
- Keyboard: rows are `<button>`s in a list, not `<div>`s with click handlers.
- Minimum 44px touch targets — the picker is used one-handed on a phone during a meeting.

Extract the modal shell into `MemberPickerModal.tsx` so `mode: "inline"` does not carry
dialog logic it never uses.

---

### Task 4: ReliabilityFlag

**File:** `components/roster/ReliabilityFlag.tsx` (create)

Interface only, per Decision 5. Renders `null` for an empty array. A header comment stating
that Phase 4 ([04-talks-pipeline.md](04-talks-pipeline.md)) owns the logic and will extend
the union, and that the component is bishopric-only by virtue of who passes `showFlags`.

Do not compute a flag from any data available today. A guessed rule that looks right is
worse than an empty component, because Phase 4 will trust it.

---

### Task 5: Organization membership data layer

**File:** `lib/roster/organizations.ts` (create)

```ts
export type MemberOrganization = { organizationId: string; organizationName: string };

export async function listMemberOrganizations(wardId, memberId, client?): Promise<MemberOrganization[]>
export async function listOrganizationMemberIds(wardId, organizationId, client?): Promise<string[]>
export async function setMemberOrganizations(wardId, memberId, organizationIds, client?): Promise<{ added: string[]; removed: string[] }>
export async function bulkAssignToOrganization(wardId, memberIds, organizationId, client?): Promise<{ assigned: number; alreadyMember: number }>
```

- `setMemberOrganizations` **replaces** the set: read current, compute the difference,
  delete what left, insert what arrived. Return both lists so the audit `detail` records
  what actually changed rather than what was submitted.
- Validate every incoming organization id against `listWardOrganizations` first
  (auth-b pitfall) and return a readable refusal, not a foreign-key error.
- `bulkAssignToOrganization` inserts with
  `.upsert(rows, { onConflict: "member_id,org_id", ignoreDuplicates: true })` — the unique
  constraint from migration 003 makes re-assigning an existing member a no-op instead of an
  error. Report `assigned` from the **returned rows**, not from `memberIds.length`
  (foundation-c pitfall: a refused write is a zero-row success).
- Cap the bulk input at 500 member ids in the schema. A bulk assign is a UI selection, not
  an import.

**Also modify `lib/roster/queries.ts`:** implement the `organizationId` filter left open in
roster-a — read member ids from `member_organizations`, then `.in("id", ids)`. An empty
result must produce an empty member list, not an unfiltered one; `.in("id", [])` is
correct, but assert it in a test because "filter with no matches returns everything" is a
classic PostgREST footgun.

Add `defaultOrganizationFilter(user: SessionUser): string | undefined` (Decision 4) —
`lib/roster/organizations.ts` is the right home. Pure, no client argument.

---

### Task 6: Organization routes

**Files:** `app/api/members/[id]/organizations/route.ts`,
`app/api/roster/bulk-assign/route.ts` (create)

**`PUT /api/members/[id]/organizations`** — replaces the set.

- `assertCan(user, "roster.manage")`. 02-roster.md §Step 5 also allows "the relevant org
  leader" to edit. **Deferred, deliberately:** no permission in `PERMISSIONS` expresses
  "may edit membership of my own organization", and inventing one here would place a role
  decision in the wrong phase. `roster.manage` (bishopric) only, for now. Record it as a
  known gap for Phase 11, which owns the role access matrix.
- Body: `{ organizationIds: string[] }` via `setMemberOrganizationsSchema`.
- Audit `member_organizations_updated`, `detail: { memberId, added, removed }`.

**`POST /api/roster/bulk-assign`** — `{ memberIds: string[], organizationId: string }`.

- `assertCan(user, "roster.manage")`.
- Audit `members_bulk_assigned`, `detail: { organizationId, requested, assigned, alreadyMember }`.
  Recording all three numbers is what makes a partial result debuggable a month later.
- Response includes the counts so the UI can say "9 assigned, 2 were already members"
  rather than a bare success.

Both end in `respondToRouteError`.

---

### Task 7: Member detail — organizations panel

**File:** `app/(app)/roster/member/[id]/MemberOrganizations.tsx` (create), wired into the
member detail page from roster-a.

Checkbox list of the ward's active organizations, current memberships checked, a save
button that `PUT`s the whole set. Rendered only when `can(user, "roster.manage")`; when
not, render the memberships as read-only text — an org leader seeing which organizations
someone belongs to is useful and carries no risk.

Note in a comment that the ward has **no Young Men organization**: the bishopric fulfils
that presidency, and 02-roster.md §Step 5 says not to create one. Phase 10 draws youth by
category and gender, not from a YM organization. The checkbox list renders whatever
`organizations` holds, so nothing enforces this — the comment is the guard.

---

### Task 8: Bulk assign from the roster list

**Files:** `app/(app)/roster/BulkAssignBar.tsx` (create),
`components/roster/MemberList.tsx` (modify)

- `MemberList` gains an optional `selectable` prop plus `selectedIds` / `onSelectionChange`.
  When `selectable` is absent it renders exactly as it does today — roster-a's callers must
  not change.
- `BulkAssignBar` appears only when the selection is non-empty: count, an organization
  select, an assign button, and a clear button. Fixed to the bottom of the viewport on
  mobile so it is reachable one-handed; inline above the list at `md:` and up.
- Selection is available only in the **flat list** view, not the household view. Selecting
  across expanded and collapsed households is a state problem with no user asking for it.
- After a successful assign: clear the selection, show the counts, and invalidate the
  `["members"]` query key so any open picker reflects the change.

---

## Testing Strategy

### `tests/lib/memberPickerFilters.test.ts`

Extract filter composition into a pure exported function —
`resolvePickerFilter(props: MemberPickerProps, user: SessionUser): MemberFilters` — so the
interesting logic is testable without rendering.

- No filter → `statuses: ["active"]`, no organization for a bishop
- No filter, `org_president` session → `organizationId` is the user's `orgId`
- An explicit `filter.organizationId` overrides the default
- `allowDoNotContact: false` → `do_not_contact` is absent from `statuses`
- `allowDoNotContact: true` → present
- `moved_out` is **never** present, with any combination of props. This is the assertion
  that protects the rest of the app: no picker in any phase may offer a moved-out member
- `excludeIds` is not part of the query key — it filters after the fetch

Add a small render test with `@testing-library/react` (already a devDependency, jsdom is
configured) covering: `multiple: false` replaces the selection rather than appending;
`max` disables further rows; selected chips remove on click.

### `tests/lib/rosterOrgDefault.test.ts`

Table-driven over all ten roles for `defaultOrganizationFilter`:

- `bishop`, `counselor`, `ward_secretary`, `executive_secretary`, `music_coordinator`,
  `ward_council_member` → `undefined`
- `org_president`, `org_counselor`, `org_secretary` with an `orgId` → that id
- The same three with a null `orgId` → `undefined`, not a crash
- `sacrament_manager` → `undefined` (it holds no `roster.view` and never reaches this,
  but a function that throws on a role is a function that will throw in production)

### `tests/rls/org-isolation.test.ts` (modify)

The file already covers cross-org isolation with the visibility flag on and off. Extend it
rather than starting a new file:

- A ward-A user reads zero of ward B's `member_organizations` rows
- An `org_president` **can** read another organization's `member_organizations` rows,
  because the table is ward-scoped by the migration-019 loop, not org-scoped. Assert this
  explicitly, the way `tests/rls/youth-isolation.test.ts` asserts its uncomfortable half —
  it is the fact that makes Decision 4 a convenience rather than a boundary, and a later
  reader must not mistake it
- The unique constraint rejects a duplicate `(member_id, org_id)`, which is what makes
  bulk assign idempotent

---

## Test Scenarios (Harness)

### Scenario 008: The member picker across every consumer shape

**Tags:** `[roster, full, picker]`
**Purpose:** `MemberPicker`'s props are frozen after this phase, so the walkthrough has to
exercise every shape a later phase will use — single, multiple with a cap, category
filtered, exclusion, and the do-not-contact confirmation — while there is still time to
change the interface. A unit test proves the filter resolves; only a walkthrough proves the
modal is usable one-handed on a 375px screen during a meeting, which is its actual job.
Seeding a roster with the right spread of categories, genders and statuses is fiddly by
hand and exact when seeded.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `bishop`, `eqpres` (org_president, elders quorum), `rspres` (org_president,
  relief society)
- Organizations — elders quorum, relief society, primary (`TEST_ORG_IDS`)
- Households — 8
- Members — 24: 12 adult, 8 youth, 4 child; mixed gender; 20 `active`, 2 `moved_out`,
  2 `do_not_contact`
- Member organizations — 6 members in elders quorum, 5 in relief society, 2 in both,
  the rest in none
- A scratch page at `/roster/picker-demo` is **not** built. Drive the picker through the
  bulk-assign flow and the organizations panel, which are its real first consumers

**Tester action:** Sign in as `bishop`, open `/roster` in list view, select members and
bulk-assign to an organization; open a member and edit their organizations; then sign in
as `eqpres` and browse. Narrow to 375px for the picker and the bulk bar.

**Verification checklist:**
- [ ] The picker opens as a modal, groups members under their household name, and closes
      on `Escape` with focus returning to the trigger
- [ ] Neither `moved_out` member appears in the picker under any filter setting
- [ ] Both `do_not_contact` members are hidden until the override control is used, and
      revealing them requires confirming a message that names the consequence
- [ ] Selecting in single mode replaces the previous choice rather than adding to it
- [ ] Selected members appear as removable chips and removing one updates the list
- [ ] Typing in the picker's search flattens the household grouping to matching members,
      and clearing it restores the grouping
- [ ] Bulk assign of 9 members reports the number actually assigned, and re-running the
      same assign reports 0 assigned / 9 already members rather than an error
- [ ] Assigning a member who is already in the organization does not create a duplicate row
      in `member_organizations`
- [ ] Editing one member's organizations to remove all of them saves, and the panel shows
      none afterwards
- [ ] As `eqpres`, `/roster` defaults to elders quorum members and the filter shows that
      selection in the URL
- [ ] As `eqpres`, clearing the organization filter shows the whole ward roster — this is
      intended, not a leak
- [ ] As `eqpres`, the organizations panel on a member is read-only and the bulk-assign bar
      does not appear
- [ ] `audit_log` has `members_bulk_assigned` with `requested`, `assigned`, and
      `alreadyMember` counts, and `member_organizations_updated` with `added` and `removed`
- [ ] At 375px the picker is full-height with its own scroll, the page behind does not
      scroll, and every row is at least 44px tall
- [ ] At 375px the bulk-assign bar is fixed to the bottom and reachable with one thumb
- [ ] Correct in both light and dark mode

**Failure behavior:**
- [ ] A `PUT` to `/api/members/[id]/organizations` from an `eqpres` session returns 403
      with a readable message
- [ ] Bulk-assigning with no organization selected is refused in the form, not by the server
- [ ] Assigning to an organization id from another ward returns "That organization is not
      in your ward.", not a foreign-key error string
- [ ] Opening the picker when the roster is empty shows a stated empty message, not a blank
      modal

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm test
npm run harness:typecheck
```

No migration, so no `db:push` and no `db:types` in this part.

---

## Integration Notes

- **`app/(app)/layout.tsx` is modified** to add `QueryProvider`. It is the only file outside
  the roster module this plan touches, and the `(auth)` and `(youth)` shells are unchanged.
- **`components/ui/Modal.tsx` is a shared primitive**, not roster-scoped. Phases 4, 6, 7 and
  10 will use it; build it to that standard.
- **`MemberPicker`'s props are frozen after this part.** A later phase needing something the
  table above does not cover should raise it rather than adding a prop quietly. Record the
  interface in the retro so Phase 4 can read it without opening the component.
- **Record in the retro as a known gap:** organization leaders cannot edit their own
  organization's membership (Task 6). It needs a permission that does not exist yet;
  Phase 11 owns the role access matrix and should decide.
- **Roster-c is independent of this part.** CSV import does not use `MemberPicker` and does
  not write `member_organizations`. The two can be built in either order after roster-a,
  though the numbering assumes this one first.
