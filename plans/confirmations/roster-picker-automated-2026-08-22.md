---
id: roster-picker-failure-behavior-automated
status: confirmed
commit: dc27c20
date: 2026-08-22
area: roster-picker
related_retros: [roster-b-picker-and-orgs, seed-household-id-collision, route-tests-and-realtime]
supersedes: roster-picker-and-organizations
---

## What was tested

**No new manual testing.** The walkthrough this record rests on is the one in the superseded
record — scenario 008 walked end to end on 2026-08-22, all 17 steps and the full Verification
Checklist including the picker section.

What changed since is coverage, not testing. `a85b055` added
`tests/routes/roster-organizations.test.ts` — 15 tests over
`PUT /api/members/[id]/organizations` and `POST /api/roster/bulk-assign` — and retired scenario
008's Failure Behavior section to them.

This record exists because the superseded one stated that three of those checks were "unverified
by anything, manual or automated". That is no longer true, and a confirmed checkpoint that
understates its own coverage is as misleading as one that overstates it.

## Result

**All five Failure Behavior checks are now covered**, where the previous record had one covered
and four not:

| Check | Status |
|---|---|
| `PUT .../organizations` as `eqpres` → 403 | automated |
| `POST /api/roster/bulk-assign` as `eqpres` → 403 | automated |
| Cross-ward organization id → "That organization is not in your ward." | automated, on **both** routes |
| Unknown member id → a message, not a constraint | automated, plus a ward-scoped variant |
| Empty picker → a stated message | already covered by `MemberPicker.test.tsx` |

**Both 403 tests re-read the table afterwards.** This is the part that makes them worth more than
the console checks they replace. Migration 019's ward-scoped policy loop grants INSERT, UPDATE and
DELETE on `member_organizations` to every authenticated member of the ward, so RLS is not a
boundary on these two routes — `assertCan(user, "roster.manage")` is the only one. A test that
checked the status code alone would pass while the write landed.

Three assertions were added that no console check ever made: `bulk-assign` does not partially
apply when one member in a batch belongs to another ward, the audit row records the **delta**
rather than the submitted set, and every refusal leaves `audit_log` untouched.

**What is still not covered.** The route tests prove the server refuses and what it says; they do
not prove the *screen* renders that message readably. Those are Verification Checklist items and
were covered by the walkthrough, but they are a different kind of evidence and would not catch a
regression in the error UI. The picker's own behaviour has not been re-tested since 2026-08-22 and
does not need to be — nothing in `a85b055` touches it.

**Related finding, recorded elsewhere.** Counting the permission call sites while verifying the
two 403 claims surfaced ITER-005: 25 of 62 checks ignore `wards.settings.role_access`, including
both of these routes. Latent — nothing writes that setting yet — and scoped in
`.iterate/scopes/ITER-005.md`. It does not affect this confirmation, because with no override
present the hardcoded defaults are the correct answer.

Full suite at this commit: 974 tests across 67 files, all passing.
