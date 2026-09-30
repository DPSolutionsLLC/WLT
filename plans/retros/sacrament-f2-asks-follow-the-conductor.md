---
id: sacrament-f2-asks-follow-the-conductor
type: feature
iter: null
commits: ["2094f69"]
date: 2026-09-26
files:
  - lib/sacrament/conductorHandover.ts
  - lib/todos/askLinks.ts
  - lib/sacrament/sundayAsks.ts
  - lib/calendar/queries.ts
  - lib/appointments/queries.ts
  - app/api/sundays/[id]/route.ts
  - app/api/sundays/[id]/asks/route.ts
related: [sacrament-f1-send-asks-and-answers, calendar-c-rotation-cadence, p5-c-schedule-and-my-appointments]
---

*Written 2026-09-30, after the fact, from the commit, the plan's f2 section and scenario 079's
walk record.*

## What was done
P4 Sacrament slice `f2`. When a Sunday's conductor changes, its open asks move to the new
conductor (U3). The change can come by hand or through the re-shift that a type change applies to
later Sundays. The new owner gets a clean copy rebuilt from the talk, carrying the scheduled time
and the "With" person. The old copy is closed as `handed_over` with a line naming the new owner,
and it keeps whatever its owner wrote on it (U6). A Sunday with no conductor keeps its asks with
the previous owner, so work is never orphaned. Walked as scenario 079.

## Key decisions
- **A reconcile, not a reaction to a change.** The plan said "hand over when before ≠ after", but
  that question cannot be asked twice: after the new conductor is saved, a retry sees no change.
  So `reconcileSundayAsks()` runs after **every** Sunday save and moves any open ask not held by
  the current conductor, which lets a retry finish a half-done move.
- **One call site.** A rotation edit never rewrites an existing Sunday (migration 023 applies
  forward only), so every write that *replaces* a conductor is inside `updateSunday()`.
  `generateSundayRange()` and `populateConducting()` only fill nulls and are named exemptions.
- **`tests/lib/conductorHandoverSites.test.ts` reads the source** and fails if a new write of
  `conducting_user_id` skips the handover. This is the same discipline as
  `navigationRoutesExist.test.ts`: no behavioural test can see a write path somebody forgot.
- **The copy is rebuilt from the talk** (`buildAsksForTalks()`, shared with Send asks), never from
  the old to-do's title and notes, so the old owner's words stay theirs. It is dated the ward's
  today, because for its receiver it is new work.
- **Walk defect, fixed:** the old owner's My Appointments still showed the handed-over meeting as
  "Done" beside the new owner's copy. `readScheduledTodos` now leaves out a to-do closed without an
  answer (`closed_reason` set). The regression test was proved to fail without the fix.
- **Pre-existing defect found, not fixed here:** saving a Sunday could move the month's Fast Sunday
  onto it with no warning. It is recorded as its own fix (`fast-sunday-by-the-calendar`). The seed
  now builds a whole calendar, as generation would.
- Timing on the dev server: a Sunday save costs 4.6s with nothing to move and 8.2s when it moves
  two asks. This was noted, not acted on.
