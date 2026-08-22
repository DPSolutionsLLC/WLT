# Backlog

_Last updated: 2026-08-22_

---

## In Progress
Items currently being planned or actively worked.

- [ ] ITER-004 — Speakers who are not members of the ward → [scope](.iterate/scopes/ITER-004.md) | plans: [talks-a](plans/talks-a-pipeline-core.md), [talks-b](plans/talks-b-month-planner.md)
  _**The Phase 4 half is complete.** `talks-a` landed the schema and pipeline shape — a nullable
  member link, inline external name and title with a CHECK that a row holds one or the other, and
  an explicit contact waiver. `talks-b` landed the on-screen half: the waived contact stages read
  "Not applicable - invited outside the ward" with the name and date of whoever decided it, and
  nothing about them reads as an outstanding task. Scenario 013 walked.
  **What remains is the Phase 6 half** — how an external speaker prints on the program, and how
  much of their name `/public/[slug]` shows. A visiting stake president is normally named in full,
  which is a different privacy case from a ward member's first name and last initial. Still
  unplanned; belongs with `06-program-music.md`. **Do not close this scope until it ships.**_

---

## Grouped Work
Items in each group belong together and should be planned and worked in a single session.

### [GROUP-01] Sunday types and the meeting/Fast-Sunday split
Both items pull on the same thread: `FAST_SUNDAY_DISPLACING_TYPES` currently answers two
different questions with one list, and each of these forces it apart from a different side.
ITER-003 cannot land correctly without ITER-002's split, so plan them together and do ITER-002
first.

- [ ] ITER-002 — No conductor on Sundays with no meeting, and skip them in the rotation → [scope](.iterate/scopes/ITER-002.md)
- [ ] ITER-003 — Ward conference Sunday type → [scope](.iterate/scopes/ITER-003.md)

---

## Standalone Work
Each of these is large or complex enough to tackle on its own.

- [ ] ITER-001 — Per-organization calendars and cross-organization sharing → [scope](.iterate/scopes/ITER-001.md)
  _Reason: architectural. Adds a fourth date-bearing model to the schema, a new sharing/audience
  boundary enforced by RLS, and will realistically split into three or four plans of its own._

- [ ] ITER-005 — Ward role-access overrides are ignored by 25 of 62 permission checks → [scope](.iterate/scopes/ITER-005.md)
  _Latent, not live: nothing writes `wards.settings.role_access` yet, so no ward is currently
  affected. It goes live the moment Phase 11 ships the admin UI that owns the role-access matrix,
  and it should land **before** that screen rather than with it — settings that 25 checks ignore
  are worse than no settings. Includes every `admin.manage_users` check in the app, and both
  routes where RLS is deliberately not the boundary (`member_organizations`)._

---

## Deferred
_Items that need testing or further exploration before scoping. Each entry should include enough context to restart the conversation in a future session._

_None._

---

## Completed

_None._

---

## Cancelled

_None._
