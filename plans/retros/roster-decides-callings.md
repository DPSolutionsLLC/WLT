---
id: roster-decides-callings
type: feature
iter: ITER-058
commits: []
date: 2026-11-16
files:
  - supabase/migrations/105_user_member_links.sql
  - lib/callings/lcrCallingMap.ts
  - lib/callings/memberLinks.ts
  - lib/callings/linkAccess.ts
  - lib/callings/queries.ts
  - lib/validation/memberLink.ts
  - app/api/member-link/route.ts
  - app/api/admin/member-links/route.ts
  - app/api/admin/member-links/[id]/route.ts
  - components/callings/IsThisYouCard.tsx
  - app/(app)/dashboard/page.tsx
  - app/(app)/admin/users/page.tsx
  - app/(app)/admin/users/UserRow.tsx
  - app/(app)/admin/users/MemberLinkControls.tsx
  - types/domain.ts
  - testing/infrastructure/seedUtils.ts
related: [ward-callings-model, zoom-remote-links, roster-paste-import, bishopric-visits, p2-admin-and-access]
---

## What was done

**cr1 (ITER-058, slice 1 of 4).** Each login can now be linked, once per ward, to its person on the
ward list (`user_member_links`, migration 105). There are three ways in: **Is this you?** on the
dashboard when exactly one person on the ward list carries the login email; **Ask the bishopric** for
everyone else; and a bishopric member linking someone on Admin → Users, where waiting requests sit at
the top. The one map from LCR title to app calling (`lib/callings/lcrCallingMap.ts`) was agreed with
the user against Buffalo's 89 real titles. `ward_role_assignments.source` now records where a calling
came from. **Linking changes nobody's calling yet**; cr2 adds the review that does.

## Key decisions

- **A link decides privileges, so it has no write policy and nobody links themselves.** The route and
  the library both refuse it, the super admin included. The only self-service path is confirming
  your own email match, which is re-checked on the server against Supabase Auth's login email. Two
  people sharing an address is no match: guessing between them could link someone to their spouse's
  calling.
- **Title map, agreed 2026-11-16 (Task 0):** no LCR title maps to `ward_council_member`, because
  every calling the user named as the ward council already maps to its own, higher-ranked role.
  `Resource Center Specialist` **is** mapped, which reverses P7's list. Assistant clerk, EQ ministering
  secretary, Young Men, youth classes and every stake title grant nothing.
- **The own-link route asks for no permission.** Gating it on `personal_tools.use` would tie linking
  to whether a ward has released To Do. It is account-level, like the dashboard, and the table carries
  no released-module policy for the same reason.
- **Departures from the plan:** link status is joined on the Admin → Users page rather than added to
  `listWardUsers()`, which keeps `updateWardUser()`'s re-read untouched. The controls live in a new
  `MemberLinkControls.tsx`, and the gate in a new `lib/callings/linkAccess.ts`
  (`canManageMemberLinks`, `needsRosterLink`).

## Gaps and follow-ups

- **Vitest must be run from PowerShell (or any shell whose cwd reads `C:\`), not Git Bash.** From
  Bash the cwd is `c:/…`, vitest loads two copies of itself, and EVERY file fails with `Cannot read
  properties of undefined (reading 'config')` at its first `describe` — including untouched files.
- **A bash heredoc turns `\\n` inside a Python string into a real line break.** It split a
  `seedUtils.ts` comment and broke the harness typecheck. Avoid backslash escapes in heredoc edits.
- **Buffalo runbook (before cr2 matters):** Admin is unreleased there, so only the super admin can
  open Admin → Users until it is released (ITER-041). "Is this you?" works regardless.
