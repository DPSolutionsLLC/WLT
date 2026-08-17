---
id: roster-a-data-and-pages
type: feature
iter: null
commits: []
date: 2026-08-17
files:
  - supabase/migrations/022_roster_import.sql
  - lib/roster/queries.ts
  - lib/roster/memberNotes.ts
  - lib/validation/roster.ts
  - lib/auth/navigation.ts
  - app/api/households/route.ts
  - app/api/households/[id]/route.ts
  - app/api/members/route.ts
  - app/api/members/[id]/route.ts
  - app/api/members/[id]/notes/route.ts
  - app/(app)/roster/page.tsx
  - app/(app)/roster/RosterViewToggle.tsx
  - app/(app)/roster/RosterFilters.tsx
  - app/(app)/roster/household/[id]/page.tsx
  - app/(app)/roster/household/[id]/HouseholdEditor.tsx
  - app/(app)/roster/member/[id]/page.tsx
  - app/(app)/roster/member/[id]/MemberEditor.tsx
  - app/(app)/roster/member/[id]/MemberNotes.tsx
  - components/roster/HouseholdList.tsx
  - components/roster/MemberList.tsx
  - components/roster/MemberStatusBadge.tsx
  - components/roster/HouseholdForm.tsx
  - components/roster/MemberForm.tsx
  - components/ui/NotPermitted.tsx
  - types/domain.ts
  - types/database.ts
  - plans/02-roster.md
related: [foundation-b-schema, foundation-c-services, auth-a-session-shell, auth-b-invites-admin, auth-c-youth-pin]
---

## What was done

Part 1 of Phase 2: the roster data access layer, the browse and detail pages, and household and
member CRUD. `/roster` lists households (default) or a flat member list, with search, category
and status filters, a view toggle persisted per device, and detail pages for both entities.
Member notes get their own module and a bishopric-only panel. Migration 022 carries the phase's
only schema change and closes the `users` column-grant gap that `auth-a`, `auth-b` and `auth-c`
each handed forward. 312 tests pass. `MemberPicker` and organization membership are `roster-b`;
CSV import is `roster-c`.

## Key decisions

- **`members.notes` does not exist, and 02-roster.md was wrong about it.** The phase plan said
  to leave a bishopric-only `notes` column out of the general select. Migration 003 never
  created one, deliberately: RLS grants or denies a row and never a column, so such a column
  could not have been protected by the boundary CLAUDE.md rule 2 requires. The intent survives
  and is stronger — `select('*')` on `members` cannot leak notes because there is nothing to
  leak. The paragraph in `plans/02-roster.md` was corrected in the same change.
- **`listMembers()` defaults to `["active"]`; the browse page opts in to `do_not_contact`
  explicitly.** 02-roster.md contains two rules that pull apart ("default is active" and
  "do-not-contact must be visible everywhere"). The library takes the narrow answer so a caller
  who forgets can never inflate a rotation pool or a goal denominator; `/roster` passes
  `ROSTER_BROWSE_STATUSES` because it is a browse surface rather than a calculation. `moved_out`
  needs an explicit opt-in from both.
- **An empty `statuses` array falls back to the default rather than being honoured.**
  `.in("status", [])` matches nothing, so honouring it would silently empty a page. An empty
  array is almost always a caller bug.
- **The `organizationId` filter was implemented here, not deferred to `roster-b`.** The plan
  allowed deferral *only if* roster-b landed immediately after, which stopped being certain.
  Roster-b's remaining work on `queries.ts` is the caller-side org default alone.
- **`ListHouseholdsOptions` gained a `category` beyond the plan's stated signature.** Without it
  the category filter is a silent no-op in the household view, and filtering in the page would
  put query logic outside the data layer. Households stay visible when all their members filter
  out, so the household count does not move when a category is selected.
- **`getHousehold` returns every status; `listHouseholds` applies the default.** A detail page
  that hid the member who moved out would make them unreachable from the only page listing their
  family. The badge is what communicates the status there.
- **The view toggle persists in `localStorage`, not the database.** `users` has no settings
  column and adding one would widen exactly the grant migration 022 just narrowed. `?view=` stays
  the source of truth so the page remains a Server Component.
- **No delete, anywhere.** No delete button, no `DELETE` route, for members or households.
  Departing members are marked `moved_out` so assignment and visit history survives.

## Pitfalls for next time

- **`roster.manage` in the route is the write boundary here — RLS is not.** The ward-scoped
  policy loop in migration 019 grants INSERT, UPDATE and DELETE on `members` and `households` to
  *every authenticated member of the ward*, including an `org_secretary` and a
  `sacrament_manager`. `assertCan(user, 'roster.manage')` in the handler is the only thing
  stopping an unauthorized write. The same asymmetry `auth-b` found on `updateWardUser`. **Every
  mutating roster route must carry the check**, and roster-b's two new mutating routes inherit
  the rule. `member_notes` is the opposite case — there the database genuinely refuses.
- **A neutralised search term must mean "no results", never "no filter".** `toSearchPattern`
  strips the characters that would rewrite PostgREST's comma-delimited `or` grammar (`,` `.`
  `(` `)` `"`) and ILIKE's wildcards (`%` `_`). A term made entirely of those neutralises to
  nothing, and the first implementation skipped the filter — so searching `%` returned the whole
  ward. **This was caught only by the integration suite, not by the unit tests**, because the
  unit test proved `toSearchPattern("%")` returns null and the bug was in what the caller did
  with the null. Failing toward *more* rows than the caller asked for is the wrong direction.
- **Unit-testing a helper does not test the query built from it.** The `.or()` filter string is
  this module's own concatenation, not the client library's, and neither the mapping tests nor
  the status tests could reach it. `tests/lib/rosterQueries.test.ts` exercises the real queries
  against the hosted project and is what found the bug above. **Any future module that hand-builds
  a PostgREST filter needs the same treatment.**
- **Migration 022's column grant broke an existing test in a non-obvious way.** A column-privilege
  refusal is a hard **error**, unlike an RLS refusal, which is a zero-row **success**.
  `tests/rls/users-ward-read.test.ts` asserted the zero-row shape while updating `first_name`;
  after the grant that became an error. It now updates `theme_preference`, the one column still
  granted, so it still tests the ROW boundary rather than the grant. **Narrowing a grant means
  auditing every test that writes that table**, not just the ones about permissions.
- **`MemberFilters & { statuses?: readonly … }` produces a type nothing satisfies.**
  `memberFiltersSchema` infers a mutable array, and intersecting mutable with readonly yields
  `T[] & readonly T[]`. Use `Omit<MemberFilters, "statuses"> &` instead. Any options type built
  by intersecting a Zod-inferred type with a readonly override hits this.
- **`apply_roster_import`'s address update is narrower than it reads.** The match key includes
  `coalesce(lower(address), '')`, so "update the address when the incoming value is non-null"
  can only ever normalise casing or whitespace on an address that already matches. Filling in a
  *missing* address is a merge decision and belongs to roster-c's preview, not the function.
  Documented in the SQL so the next reader does not mistake it for a bug.
- **The lookup indexes in migration 022 are deliberately not unique.** A unique constraint is the
  obvious way to make an import idempotent and is wrong: two unrelated Smith families with no
  address on file are legitimate, and a constraint would reject the second forever.
- **`db push` still warns "failed to cache migrations catalog: failed to run docker".** Harmless
  and expected, exactly as `auth-c` recorded. The migration applies.
- **The first run of a new network test file failed with an unrelated
  `Cannot read properties of undefined (reading 'config')` and passed on the next run.** A
  transient collection-time fault, not a code fault. Worth a second run before investigating.

## Known gaps handed to later phases

- **The harness scenario has not been run.** `scenario-007-roster-browse-and-notes` is written,
  seeded and in the manifest, but the manual walkthrough was deferred. What it alone covers is
  still unverified: that the notes panel is *absent* rather than empty for a non-bishopric user,
  the 375px and dark-mode layout, the `new_household_added` notification row, and the audit rows
  for `household_created` / `member_updated` / `member_note_created`. The library layer beneath
  all of it is tested. **Run it before Phase 4 builds on these pages.**
- **Route handlers remain unit-untested**, for the third phase running: there is no local server.
  The library layer is tested and the harness scenario drives the routes by hand.
- **`/roster/import` 404s** until `roster-c` builds it. The empty state links to it deliberately.
- **The assignment-history tab is a placeholder** gated on `talks.view`, so it is bishopric-only
  from the start rather than being narrowed later. **Phase 4 fills it.**
- **`HouseholdList` is not virtualized.** 02-roster.md sets the threshold at ~200 households; a
  real ward is 100–150 and no virtualization library is installed. Revisit only above that.
- **A future profile-edit page must widen the `users` column grant** to include `first_name` and
  `last_name`. Without it the update fails with "permission denied for column", which is a
  confusing error a long way from its cause. The reasoning is pinned in
  `tests/rls/users-column-grant.test.ts` and in migration 022's header.
- **`apply_roster_import` is written but has no caller and no test.** `roster-c` is its only
  consumer. If its signature needs to change there, that is a **new migration** — 022 is already
  applied to the hosted project.
