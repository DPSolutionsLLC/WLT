# Backlog

_Last updated: 2026-08-20_

---

## In Progress
Items currently being planned or actively worked.

- [ ] ITER-004 — Speakers who are not members of the ward → [scope](.iterate/scopes/ITER-004.md) | plans: [talks-a](plans/talks-a-pipeline-core.md), [talks-b](plans/talks-b-month-planner.md)
  _Phase 4 half only. **`talks-a` has landed** — the schema and pipeline shape are done: a nullable
  member link, inline external name and title with a CHECK that a row holds one or the other, and
  an explicit contact waiver. `talks-b` builds the on-screen half, including the waived contact
  stages reading "Not applicable". The Phase 6 half — how an external speaker prints on the program
  and how much of their name a public page shows — is still unplanned and belongs with
  `06-program-music.md`. **Do not close this scope until both remain halves ship.**_

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
