---
id: visits-e-cadence-and-priority
type: feature
iter: ITER-018
commits: ["8f71f90"]
date: 2026-08-27
files:
  - supabase/migrations/050_visit_cadence_scale.sql
  - supabase/migrations/051_drop_visit_goal_period.sql
  - lib/visits/cadence.ts
  - lib/visits/householdCadences.ts
  - lib/visits/householdStatus.ts
  - lib/visits/progress.ts
  - lib/visits/queries.ts
  - lib/visits/visitDates.ts
  - lib/validation/visit.ts
  - lib/validation/roster.ts
  - lib/roster/queries.ts
  - app/api/households/[id]/visit-cadence/route.ts
  - app/api/visit-goals/route.ts
  - app/api/visit-goals/[id]/route.ts
  - app/(app)/visits/HouseholdCadenceControl.tsx
  - app/(app)/visits/VisitProgressTable.tsx
  - app/(app)/visits/VisitProgressBanner.tsx
  - app/(app)/visits/VisitGoalPanel.tsx
  - app/(app)/visits/page.tsx
  - components/roster/HouseholdForm.tsx
  - types/domain.ts
related:
  - visits-b-progress-dashboard
  - visits-d-attempts-appointments-and-participants
  - talks-d-reliability-goals
  - foundation-c-services
  - roster-b-picker-and-orgs
  - ai-d-corpus-scoping
  - seed-household-id-collision
  - role-access-overrides
---

## What was done

A visit goal stopped being *"between these two dates, visit everybody"* and became *"visit every
household once every X"*. Progress is measured from **each household's own last completed visit**
rather than from a shared period boundary, which dissolves `visits-b`'s Defect 3 — a row reading
**✓ Visited** above a banner counting it as unvisited — instead of patching it. There is no period,
so there is no boundary for two correct numbers to disagree across.

The five status buckets became a four-band **priority scale** (`never_visited` > `overdue` >
`approaching` > `on_track`) plus a fraction of the interval elapsed. Goals became **editable in
place** — there had never been an edit path anywhere in the app. A new `household_visit_cadences`
join table lets one organization put one family on its own cadence. `households.do_not_contact`
marks a family as shown, marked and counted in nothing.

Shipped as **expand-and-contract**: migration 050 adds and backfills, 051 drops, and 051 is
deliberately **not applied** until the new build is live.

## Key decisions

- **The five buckets died rather than being renamed.** `attempted_never_reached` was a *reason*
  occupying a *position* — a household somebody had knocked on three times could not also read
  overdue, because the reason displaced the urgency. It is now `attemptsSinceLastVisit >= 1`
  rendered as a mark **beside** any band.
- **`never_visited` outranks `overdue`, and computes no fraction.** A family nobody has ever been
  to has no anchor to measure from. Inventing one is exactly what `goal_period_start` did, and
  what this replaces.
- **The override is a join table, not a column** — reversed mid-planning. The same family can be
  on a 3-month cadence for the Elders Quorum and a 12-month one for the Relief Society at once; a
  `households` column would have let the second organization silently overwrite the first.
  `org_id` is `NOT NULL` there, unlike `visit_goals.org_id`, because a null-org row is invisible
  to its own author under `org_id = current_org_id()` (`talks-d-reliability-goals`).
- **The cadence route is separate from the roster's household PATCH.** An org president holds
  `roster.view` and not `roster.manage`, so routing it through the roster would either lock out
  the people who own the decision or hand them the whole roster. Each route keeps exactly one
  permission.
- **Cross-org visibility was deliberately NOT widened to the new table.** That setting widens
  reads of visit *logs* — reports — and a cadence is a configuration. `visit-cross-org.test.ts`
  now asserts the new table did not ride along on the widened read.
- **Deleting the old vocabulary first made the compiler enumerate every call site**, the technique
  `role-access-overrides` used to find 25 checks that ignored the ward's override.

## What went wrong, and what it cost

**A fixed comparison anchor is a load-bearing constant, not a tidy detail.** `compareCadences()`
projects both cadences from `CADENCE_COMPARISON_ANCHOR` so validation takes no clock reading. The
plan specified `2000-01-01` — where January plus a **leap** February is exactly 60 days, so
"every 2 months" and "every 60 days" compared **equal**, and a ward could save a warning window
that marks every household approaching for ever. Caught by the plan's own test case failing.
Moved to `2000-07-01`, the year's longest run of 31-day months, so a months-expressed interval
measures at its most generous and a borderline pair is refused rather than accepted. A test now
pins the anchor so it cannot be "tidied" back.

**A repo-wide invariant test and a deliberately-held-back migration are in direct conflict.**
`tests/db/migrations.test.ts` fails if any local migration is unapplied — which is exactly the
state expand-and-contract requires between the two halves. Rather than weakening it, 051 went into
an explicit `HELD_BACK_UNTIL_DEPLOYED` allowlist, plus **two new tests**: one fails if an entry has
already been applied (so the allowlist cannot go blind), one fails if it names a file that does not
exist. Applying 051 will turn the suite red until its entry is removed, which is the reminder
working.

**`supabase db push` applies every pending migration.** There is no "up to N". Holding 051 back
meant renaming it out of the `<version>_name.sql` pattern for the duration of the push, then
renaming it back. Worth knowing before the next expand-and-contract.

**`countMonthsBetween()` counts month boundaries, not elapsed months.** Used directly for "how long
overdue", 15 June to 14 August reported *2 months overdue* one day short of two months. It now
backs off by one when the day of the month has not come round — how a person counts an age. Found
by a boundary test written as a pair, which is why the pairs are worth writing.

**A CHECK constraint was proved to reject before moving on**, because `ai-d-corpus-scoping` shipped
one that was silently inert. `(amount is null) = (unit is null)` is a plain boolean on both sides
and never NULL, so it genuinely fails — verified against the hosted project, including that a
valid pair is still accepted.

## What the walk found

Walking scenario 045 (agent-driven, screenshots reviewed by the user):

- **The scenario's headline claim could not pass, and the flaw came from the plan.** The checklist
  asked that one household read a *different band* for each organization, but the fixture gave both
  the same 100-day-old visit while the Relief Society goal is every 3 months — so both read
  `Overdue · 109%` and the central claim demonstrated nothing. The plan specified that RS goal *and*
  expected "On track for Relief Society"; those cannot both hold. Fixed by giving the Relief Society
  its own recent visit, which is the realistic situation anyway.
- **A stale dev server was holding port 3000 again**, started hours before this slice's code — the
  same trap `visits-b`'s re-walk recorded. Killed and restarted before anything was observed.
- **The cadence control shipped as a 176×16 tap target**, failing the 44×44 rule every other
  control on the page keeps. It was the primary control this slice added.
- **A layout measurement lied because the viewport had silently reset** to 412px on navigate, so
  the query measured the `md:`-hidden desktop table rather than the visible cards and reported
  every button at height 0. `offsetParent === null` and `innerText` concatenating without spaces
  are the tells. **Check `window.innerWidth` before trusting a layout measurement.**

Reviewing the screenshots, the user kept six of eight judgements as built and changed two:

- **The percentage came off the badge and the pill became a gauge**, filling with the elapsed
  fraction; an overdue badge fills completely and reads a **duration in words**. A percentage is
  the right thing to sort on and the wrong thing to read — 110% and 109% are a month apart on a
  yearly cadence and a day apart on a monthly one. `elapsedFraction` is untouched and still drives
  the sort and the fill.
- **The fill is a tint, not a solid**, because every colour token was measured for text contrast
  against the surface; a solid fill with inverted text would owe a second measurement per state in
  both themes. This is the constraint `visits-b` documented, honoured rather than waived.
- **The cadence editor now says what it sets** — "Visit this household once every" reading into the
  inputs — and deliberately avoids the word *goal*, which belongs to the organization-level object
  one section down.

## Handed forward

- **Migration 051 is written, reviewed and NOT applied.** Apply only after the new build is live at
  `wlt-iota.vercel.app`; the deployed build names the dropped columns explicitly in its select
  list and would 500 on `/visits`. Then remove `051` from `HELD_BACK_UNTIL_DEPLOYED`. There are
  **zero real visit goals** in the database, so the drop loses no data — the risk is entirely about
  the running code, not the rows.
- **Phase 8 should import `lib/visits/cadence.ts` and `householdVisitPriority()`** rather than write
  a second meaning of "overdue". Neither names anything visit-specific in its parameters —
  `lastCompletedOn`, not `lastVisitedOn` — for exactly that reason. If a third module wants them,
  that is the moment to lift `cadence.ts` out of `lib/visits/`; not before.
- **ITER-019 was raised out of this walk** — per-organization *stewardship* (the Primary should not
  be measured against every household in the ward) and an all-organizations view. Its sharpest
  question is that an all-orgs view either revisits the cross-org RLS decision above, or is
  assembled bishopric-side only.
- **Scenarios 045 and 046 are built; 046 has not been walked**, and 045's walk predates the gauge
  change on two of its checks. Pill widths vary with their label, so two rows' fills sit on
  different total widths — flagged to the user, not yet decided.
