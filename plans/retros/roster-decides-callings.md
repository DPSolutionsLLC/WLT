---
id: roster-decides-callings
type: feature
iter: ITER-058
commits: ["642cc97"]
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
  - lib/callings/callingReview.ts
  - lib/callings/applyCallingReview.ts
  - lib/callings/loadCallingReview.ts
  - lib/callings/writeCalling.ts
  - lib/validation/callingReview.ts
  - lib/validation/adminUser.ts
  - lib/auth/session.ts
  - app/api/callings/review/route.ts
  - app/api/callings/override/route.ts
  - app/(app)/admin/users/CallingReview.tsx
  - app/(app)/admin/users/OverrideControls.tsx
  - app/(auth)/no-calling/page.tsx
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

## cr2 — the Calling review (2026-11-17)

### What was done

**cr2 (ITER-058, slice 2 of 4).** Admin → Users now compares the ward list with the app for every
linked account and lists each difference as an unticked row. Nothing changes until a person ticks a
row and presses Apply. Admin → Users no longer sets roles: the one hand edit left is the super
admin's marked override, which goes back on every review. An account with no calling left lands on
`/no-calling` instead of a 500.

### Key decisions

- **The review is computed on read, and `buildCallingReview()` is the one comparison.** cr3's paste
  review must call it rather than write a second copy.
- **Apply takes only ticked ids and recomputes first.** A row id carries its target, so a tick the
  recompute no longer produces counts as stale and is never applied to something nobody saw.
- **`createCalling` and `updateCalling` and `endCalling` take a required `source`,** so every caller
  has to say where a calling came from.
- **Each guard refuses only its own row:** the last bishop, your own calling unless you are the super
  admin, and an organization that cannot be resolved.
- **A row with a waiting change says so** ("Change waiting in the Calling review"), decided by the
  user on walking scenario 103b. An override row keeps its own line, because an override always has
  a review row.

### Defects found walking scenario 103b, all fixed and re-walked

- **D1: a super admin saw every account as "Not linked".** Their `super_admin` calling is not admitted
  to the ward's links by policy, and the page read them through the caller's client. The links and the
  review now read through the service role, after `canManageMemberLinks()`.
- **D2: applying the last row removed its own result.** The refresh emptied the review and the page
  unmounted it. The review now stays mounted and hides itself when it has nothing to show.
- **D3: applied rows stayed on screen under "Applied …" until the refresh landed.** They are now
  hidden when the server answers, and the button reads "Updating…" until the refresh arrives.

**Pattern:** a page that gates on a permission and then reads through a policy can disagree with
itself for a role the policy does not name. Nothing errors; the rows are simply absent.

### Verification

Full suite 398 files and 5,783 tests passed, production build passed, and scenario 103b was walked and
re-walked by Claude in a browser. **The user has not walked it themselves** and chose to test later.

### Gaps and follow-ups

- **`endCalling()` stamps `ended_on` in UTC** (`lib/callings/writeCalling.ts:187`), so a release after
  5pm Mountain is dated the next day. Seen on the walk, not fixed.
- **React "missing key" warning pointing at `UserRow`.** Cause not confirmed.
- **Sending `role` in the user PATCH body is refused with "Say whether the account is active."** The
  refusal is right and the sentence does not explain it.
- **A released account logs a `console.error` on each request.**
- **The longer pending-review line was not re-checked at 375px.**
