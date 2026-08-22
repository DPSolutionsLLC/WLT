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

_None. GROUP-01 (ITER-002 + ITER-003) shipped together on 2026-08-22 as one unified plan, which
is what the grouping asked for._

---

## Standalone Work
Each of these is large or complex enough to tackle on its own.

- [ ] ITER-006 — A rotation change does not apply to already-generated future months → [scope](.iterate/scopes/ITER-006.md)
  _Found during the scenario 015 walkthrough on 2026-08-22. Saving a rotation "effective from
  2027-11-01" leaves an already-generated November 2027 untouched — the form says saved and nothing
  moves. Not the forward-only rule working: that rule protects the PAST, and this is a failure to
  apply to the FUTURE. Pre-existing since calendar-c, but GROUP-01 sharpened it — a Sunday **type**
  change now re-resolves later Sundays behind a confirm dialog, while a **rotation** change still
  does not, and that inconsistency is not defensible to a user. Most of the machinery already
  exists (`seriesFor`, `applyConductingReshift`, the confirm gate); the real work is the larger
  blast radius, since a rotation change can rewrite many months at once and storage IS the
  override. Consider `conducting_source` as part of this rather than deferring it a third time._

- [ ] ITER-001 — Per-organization calendars and cross-organization sharing → [scope](.iterate/scopes/ITER-001.md)
  _Reason: architectural. Adds a fourth date-bearing model to the schema, a new sharing/audience
  boundary enforced by RLS, and will realistically split into three or four plans of its own._

---

## Deferred
_Items that need testing or further exploration before scoping. Each entry should include enough context to restart the conversation in a future session._

_None._

---

## Completed

- [x] ITER-002 — No conductor on Sundays with no meeting, and skip them in the rotation _(completed 2026-08-22)_
- [x] ITER-003 — Ward conference Sunday type _(completed 2026-08-22)_
- [x] ITER-005 — Ward role-access overrides ignored by 25 of 62 permission checks _(completed 2026-08-22)_

---

## Cancelled

_None._
