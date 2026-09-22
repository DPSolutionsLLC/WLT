---
id: p2-admin-and-access
type: feature
iter: null
commits: ["568b7c8"]
date: 2026-09-21
files:
  - supabase/migrations/072_session_org_type.sql
  - supabase/migrations/073_access_requests.sql
  - supabase/migrations/074_access_request_notifications.sql
  - lib/auth/permissions.ts
  - lib/auth/session.ts
  - lib/access/roleAccessDeltas.ts
  - lib/access/appWideGrant.ts
  - lib/access/requests.ts
  - lib/units/writeUnit.ts
  - lib/units/queries.ts
  - lib/roster/wardRoster.ts
  - lib/validation/unit.ts
  - lib/validation/calling.ts
  - lib/validation/accessRequest.ts
  - app/api/units/route.ts
  - app/api/units/[id]/route.ts
  - app/api/callings/route.ts
  - app/api/access-requests/route.ts
  - app/api/access-requests/[id]/route.ts
  - app/(app)/admin/stakes/page.tsx
  - app/(app)/admin/access-requests/page.tsx
  - types/domain.ts
related:
  - ward-callings-model
  - unit-hierarchy-and-ward-switch
  - role-access-overrides
  - notification-trigger-drift
  - youth-h-season-close-and-safe-remove
---

## What was done

P2 `proto-d`, closing the phase: the admin surface above a ward, and the way a ward asks for
access it does not have. Three migrations (072–074), the **Stakes & Wards** screen, `POST
/api/callings` — which makes scenario 066's two-calling state reachable by hand for the first
time — `access_requests` with its request → decide flow, the app-wide grant fan-out, and
`lib/roster/wardRoster.ts` as a seam for a future LCR integration.

The largest and least expected part was **re-deriving the permission matrix from the prototype**,
which the user chose over confirming WLT's existing defaults. That made the matrix
**organization-aware** — the first time in this codebase that an `org_president` in one
organization resolves differently from one in another.

## Key decisions

- **The org-aware matrix cost no change to `can()`, the delta schema, or any of the 62 call
  sites.** `can()` indexes the matrix exactly once (`roleAccess[user.role]`) and nothing else
  reads it for another role, so the specialization happens once inside `resolveRoleAccess` and
  `RoleAccess`'s shape never moves. The seam is deliberately narrow: **youth is the only module
  that varies**, and a test asserts that nothing else does, so a second org-dependent module has
  to be a deliberate edit rather than a side effect.

- **`orgType` is a REQUIRED parameter with no default** — ITER-005's lesson applied a second time.
  A default is exactly how 25 of 62 permission checks came to ignore the ward's configuration with
  nothing failing. Making it required let the compiler enumerate all 171 call sites.

- **`session_context()` carries the org TYPE** (migration 072) rather than the app resolving it
  from `orgId`. That is 070e's rule unchanged: one round trip, one answer, so the app and RLS
  cannot disagree about which organization a session is in.

- **The prototype's missing Young Men row is CORRECT, and module-map.md §4 was wrong.** The user's
  `calling-hierarchy.json` (General Handbook) says the bishopric *is* the presidency of the
  Aaronic Priesthood and there is no ward Young Men president calling. Five org presidencies is
  the right number. A corroboration worth recording: only the five presidents carry
  `wardCouncilAgenda` in the matrix, and the handbook lists exactly those five as ward council
  standing members — nothing made those two agree.

- **Stake officers still reach nothing, against the matrix.** The prototype grants them
  `wardAdmin=F` across every ward; that was refused, because the 2026-09-21 decision was made
  against the real security boundary where the prototype's "enforcement" is client state.

- **The one rule the request flow exists for is enforced by the ABSENCE of a write policy.**
  `access_requests` has a SELECT policy and nothing else, so a ward admin cannot approve their own
  request even if a route forgets to check. A route check can be forgotten by whoever adds the
  next endpoint; a missing policy cannot.

- **An app-wide grant never turns on silently.** Approving app-wide writes an explicit *off*
  override into every existing ward, so nobody's effective access moves on the day the default
  ships. The fan-out is idempotent, does not stop at a per-ward failure, and does not swallow
  one — a ward that silently missed its override is a ward that silently *gained* a permission.

- **Four things the matrix said and WLT kept anyway**, each against a documented decision the
  prototype could not see: the bishopric keeps music, `music_coordinator` keeps `talks.view`,
  `sacrament_manager` is not mapped to `sacrament-ordinance-coordinator` at all — the prototype's
  is an adult calling and WLT's is a youth PIN account capped at one module — and
  **`program.approve` is withheld from both secretaries**.

  The fourth was found by the SUITE rather than by review, and it exposed an inconsistency in the
  first pass: `sacramentProgram=F` appears on three rows, and it had been read two different ways
  in one change — withheld for `resource_center_specialist` on the grounds that approving is a
  bishopric act, granted in full to the secretaries. `program-approval.test.ts` names the rule in
  a test title ("this is the one step they cannot take"). Both rows now say the same thing.

## What to watch

- **The ward clerk can now build and distribute the programme while unable to open Music or see
  who is speaking.** That is what the matrix says, taken literally on the user's instruction with
  the alternative put beside it. It is the most likely thing a walk will call wrong, and the
  comment in `permissions.ts` says to change it there and say so rather than quietly re-adding.
  (Approving is NOT among those grants — see above.)

- **Stakes & Wards is absent from `NAVIGATION_ITEMS` on purpose.** That file gates on a
  permission, and `super_admin` holds all of them — so no permission would show it to a super
  admin without also showing it to every bishop. Adding a `units.*` permission would be the wrong
  fix: `role_access` could then widen it, and a ward could grant itself the right to create the
  stake above itself.

- **A latent defect in plan 1 was fixed here.** `createCalling()` wrapped the PostgREST error in
  a plain `Error`, dropping the SQLSTATE — so the one-active-calling-per-ward refusal its own
  header promises the caller would map surfaced as a **500 reading "Please try again"**. The
  original now travels on `cause`. No caller inspected it before, so the change is additive; what
  it fixes is a comment that was aspirational rather than true.

- **Migrations were applied to the hosted project during the build, and the suite must not run
  while a harness seed does.** Seeding mid-run clears harness data out from under a suite that is
  already using the shared project; one full run had to be discarded and repeated for that reason.
