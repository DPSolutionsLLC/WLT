---
id: roster-picker-and-organizations
status: confirmed
commit: bdcf4f9
date: 2026-08-22
area: roster-picker
related_retros: [roster-b-picker-and-orgs, seed-household-id-collision]
supersedes: null
---

## What was tested

Scenario 008 ("The member picker across every consumer shape") walked end to end on 2026-08-22 —
the first time it has ever been walked, and the first time it has ever seeded successfully. All
17 steps and the main Verification Checklist, including the picker section: modal grouping by
household, Jonah Whitfield under "No household", `Escape` returning focus, both `moved_out`
members hidden under every filter setting, the `do_not_contact` override and its confirmation,
single-mode selection replacing rather than adding, removable chips, and search flattening and
restoring the household grouping.

Reported as passing throughout.

**Not covered:** the five **Failure Behavior** console checks at the bottom of the scenario — the
two 403 assertions on `PUT /api/members/[id]/organizations` and `POST /api/roster/bulk-assign`,
the cross-ward organization id, the unknown member id, and the empty-picker message. These were
skipped and are recorded here rather than left to inference. See the caveat below.

## Result

**What's working.** `MemberPicker`'s interface is exercised and sound across every shape Phases 4,
7, 8 and 10 will consume. That matters more than the usual walkthrough, because the props freeze
at the end of roster-b and Phase 4's `SpeakerField` is already a live consumer — a gap here would
have surfaced as a talks-planner bug three phases from its cause.

The organizations panel, bulk assign with its already-member reporting, the org-scoped default for
`eqpres` visible in the URL rather than hidden in a query, and the read-only panel for a role
without `roster.manage` all behaved as designed.

**One real defect found, fixed, and committed.** The scenario had never seeded:
`createHousehold` derived its stable id from the family name alone, so scenario 008's two
deliberately-same-named "Smith" households collided on `households_pkey` and the seed aborted
after 3 households and zero members. Fixed in `2af66b8` by keying the id on family name and
address — see [[seed-household-id-collision]]. The seed now produces the full 8 households, 24
members and 13 organization memberships the scenario describes.

**The caveat on this being `confirmed`.** The Failure Behavior section was not run. It is recorded
as skipped rather than silently absent, because the identical gap on the talks-planner record went
unrecorded and one of the checks in it turned out to be **wrong** — scenario 012 asserted a 403
where the route actually returns 404. So:

- Both 403 claims in *this* scenario were verified by reading the routes on 2026-08-22 and are
  **correct**: `assertCan(user, "roster.manage")` is the first statement inside the try in both
  handlers, before any row is read, so an `eqpres` session genuinely receives 403. This is not the
  talks case.
- The other three checks — cross-ward organization id, unknown member id, empty-picker message —
  are unverified by anything, manual or automated.

If a regression is later traced to this area, treat the main checklist as a trustworthy baseline
and the Failure Behavior paths as never having been exercised.

**Recommended follow-up, not blocking this confirmation.** Those checks are the cheapest possible
consumers of `tests/helpers/routeClient.ts`, which exists precisely to retire console-pasted
`fetch` calls. Automating them would close the gap permanently and is the documented follow-up
from [[route-tests-and-realtime]], which deliberately left the other 23 routes untested.
