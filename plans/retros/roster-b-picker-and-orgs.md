---
id: roster-b-picker-and-orgs
type: feature
iter: null
commits: []
date: 2026-08-17
files:
  - components/roster/MemberPicker.tsx
  - components/roster/MemberPickerModal.tsx
  - components/roster/ReliabilityFlag.tsx
  - components/roster/MemberList.tsx
  - components/ui/Modal.tsx
  - components/providers/QueryProvider.tsx
  - lib/roster/organizations.ts
  - lib/roster/organizationScope.ts
  - lib/roster/queries.ts
  - lib/validation/roster.ts
  - app/api/members/[id]/organizations/route.ts
  - app/api/roster/bulk-assign/route.ts
  - app/(app)/layout.tsx
  - app/(app)/roster/page.tsx
  - app/(app)/roster/RosterFilters.tsx
  - app/(app)/roster/BulkAssignBar.tsx
  - app/(app)/roster/member/[id]/page.tsx
  - app/(app)/roster/member/[id]/MemberOrganizations.tsx
  - plans/02-roster.md
related: [roster-a-data-and-pages, foundation-c-services, auth-b-invites-admin, auth-c-youth-pin]
---

## What was done

Part 2 of Phase 2: `MemberPicker` — the component Phases 4, 7, 8 and 10 all consume — plus
organization membership, editable per member and in bulk from the roster list. The picker
browses by household, is controlled, filters on category, gender, status, organization and
household, and hides do-not-contact members behind a confirmation. Two new write routes
(`PUT /api/members/[id]/organizations`, `POST /api/roster/bulk-assign`) both gate on
`roster.manage`. `QueryClientProvider` is wired into the authenticated shell — this is the app's
first client-side fetch. A `Modal` primitive on the native `<dialog>` lands in `components/ui`
for Phases 4, 6, 7 and 10 to reuse. 371 tests pass. CSV import is `roster-c`.

**The props are frozen from here.** The interface, and the reason each prop exists, is recorded
in the header comment of `components/roster/MemberPicker.tsx` and summarised in
`plans/02-roster.md` §Step 3, so a later phase can read it without opening the component.

## Key decisions

- **`MemberPicker` is controlled — `value`/`onChange`, not the `onSelect` 02-roster.md
  sketched.** `onSelect` fits a single-select modal and fights everything else: Phase 4 picks
  three speakers for one Sunday, Phase 10 picks pairs, and both need to render the selection
  *outside* the picker and remove from it. `multiple: false` still passes an array of length 0
  or 1, so no consumer branches on the shape. The phase plan was corrected in the same change.
- **`user: SessionUser` was added to the frozen props table.** Decision 4 has the picker apply
  the organization default itself, which a client component cannot do without the session. The
  alternative — every future caller remembering to pass `filter.organizationId` — is exactly the
  invisible default that decision set out to prevent. `TopNav` already takes a `SessionUser`, so
  the pattern was established.
- **Only `statuses` and `organizationId` reach the server; categories, genders, household,
  search and `excludeIds` narrow in memory.** That makes the query key coarse on purpose: two
  pickers with different category filters share one fetch of the same ward-and-status slice.
  `resolvePickerFilter` builds the server filter, `narrowPickerMembers` does the rest, and both
  are pure and tested without a network round trip.
- **`resolvePickerFilter` builds statuses as an allow-list, never by subtraction.** `moved_out`
  is absent because it is never added, so no combination of props can put it back — the test
  table covers every status, both values of `allowDoNotContact`, and the no-filter case. A
  request for `moved_out` alone falls back to `["active"]` rather than resolving to an empty
  list, because an empty `.in("status", [])` hits `resolveMemberStatuses`'s fallback and would
  *widen* rather than narrow.
- **`allowDoNotContact` offers a control, it does not include anyone.** Until the user activates
  it and confirms a message naming the consequence, do-not-contact members are not fetched at
  all — so they cannot reach the browser through a component that forgot to hide them.
- **`QueryClient` is created inside `useState(() => …)`, never at module scope.** A module-level
  client is created once per server process and shared across requests, handing one user's
  cached roster to the next user's render.
- **`Modal` is built on the native `<dialog>` with `showModal()`.** Focus trapping, the backdrop,
  Escape-to-close, page inertness and focus returning to the trigger all come from the platform.
  The one thing it does not give is a background scroll lock, which the component adds.
- **`ReliabilityFlag` ships with no logic at all.** Phase 4 owns the reliability patterns and
  nothing in the roster can compute one today. A guessed rule that looks right is worse than an
  empty component, because Phase 4 would build on it and a bishop would have trusted it first.
- **The organization default redirects rather than applying invisibly.** An org leader opening
  `/roster` is sent to `?organizationId=<their org>`, so the filter control and the address bar
  agree and the default is something a user can see and clear. An **absent** parameter means
  "apply the role default"; the sentinel `organizationId=all` means "somebody cleared it on
  purpose" — without that distinction, clearing the filter would be undone by the next
  navigation.
- **`bulkAssignToOrganization` upserts with `ignoreDuplicates`, and counts the rows RETURNED.**
  The unique `(member_id, org_id)` constraint from migration 003 makes re-running an assign a
  no-op reporting `0 assigned / N already members` instead of an error.
- **Both data-layer writes return a `{ ok: false; message }` union rather than throwing**,
  copying `updateWardUser`. A cross-ward organization id has to come back as a sentence a user
  can act on, not as a foreign-key constraint name.

## Pitfalls for next time

- **`lib/roster/*` is server-only, and a client component importing it fails the build.** Every
  module there imports `createServerSupabaseClient`, which imports `next/headers`. The plan put
  `defaultOrganizationFilter` in `lib/roster/organizations.ts`, but `MemberPicker` is a client
  component and needs it — so the pure rule lives in **`lib/roster/organizationScope.ts`**, which
  imports types and nothing else, and `organizations.ts` re-exports it for server callers. **Any
  future pure helper a client component needs has the same problem.** `npm run build` is what
  catches this; `typecheck` and `lint` both pass a boundary violation.
- **The members route reads `getAll("status")`, singular.** A client sending `statuses` gets no
  error — the parameter is ignored and the data layer's default silently applies instead. Worth
  checking the parameter name against the handler whenever a new client fetch is written.
- **A Server Component cannot hand a client list an `onSelectionChange`.** `BulkAssignBar` ends
  up owning the selection *and* rendering `MemberList`, which is why its name understates what it
  does. `MemberList` became `"use client"` as a result; its output is unchanged when `selectable`
  is absent, so roster-a's callers did not have to change.
- **`react-hooks/globals` rejects assigning to a module-level variable during render**, which is
  the obvious way to capture a controlled component's value in a test. Assign it from the change
  handler instead — an event handler, not render.
- **`@testing-library/user-event` is not installed** and adding it needs permission. `fireEvent`
  from `@testing-library/react` covers clicks fine.
- **Do not drive the native `<dialog>` through jsdom.** `showModal()` behaviour belongs to the
  browser; a test of it tests the environment's implementation, not the component. The render
  tests use `mode: "inline"` and the harness scenario covers the dialog on a real device, which
  is where "usable one-handed at 375px" can actually be judged.
- **`roster.manage` in the route is the write boundary for `member_organizations`, not RLS** —
  the same asymmetry `roster-a` recorded for `members` and `households`. Migration 019's
  ward-scoped policy loop grants INSERT, UPDATE and DELETE to every authenticated member of the
  ward. `tests/rls/org-isolation.test.ts` now asserts the uncomfortable half of this explicitly:
  an org president **can** read another organization's memberships, and that is the policy
  working as written.
- **`useMemo` on a value that feeds a TanStack Query key buys nothing.** Query keys are hashed
  structurally, not by identity, so a fresh object each render is the same key — and the
  dependency array is one more thing to keep correct.

## Known gaps handed to later phases

- **The harness scenario has not been run.** `scenario-008-member-picker-and-organizations` is
  written, seeded and in the manifest, but the walkthrough was deferred deliberately —
  `roster-c` touches none of this code. What it alone covers is still unverified: the `<dialog>`
  behaviour, the `eqpres` redirect, the 375px bulk bar and dark mode, the do-not-contact
  confirmation, and the `members_bulk_assigned` / `member_organizations_updated` audit rows. The
  library layer beneath all of it is tested. **Run it before Phase 4 starts** — the scenario
  exists to shake out the frozen interface while changing it is still cheap, and Phase 4 is the
  first consumer.
- **Org leaders cannot edit their own organization's membership.** 02-roster.md §Step 5 allows
  it; no permission in `PERMISSIONS` expresses "may edit membership of my own organization", and
  inventing one belonged in neither this phase nor that file. Both routes are bishopric-only and
  the panel renders read-only for everyone else. **Phase 11 owns the role access matrix and
  should decide.**
- **`ReliabilityFlag` renders nothing and its union is a starting point, not a contract.**
  **Phase 4 extends it** and owns the logic.
- **Route handlers remain unit-untested**, for the fourth phase running: there is no local
  server. The library layer is tested and the harness scenario drives the routes by hand.
- **The picker's chips read from the fetched slice**, so selecting a member and then changing
  the organization filter to one they are not in drops their chip while keeping their id in
  `value`. No consumer does this yet. Phase 10's blesser pairs are the first place it could
  matter.
- **`HouseholdList` still has no selection.** Bulk assign is flat-list only, on purpose:
  selecting across expanded and collapsed households is a state problem nobody has asked to
  have.
