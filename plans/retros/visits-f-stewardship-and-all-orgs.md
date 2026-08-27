---
id: visits-f-stewardship-and-all-orgs
type: feature
iter: ITER-019
commits: ["10197b3"]
date: 2026-08-27
files:
  - supabase/migrations/052_household_stewardships.sql
  - supabase/migrations/053_cross_org_progress_reads.sql
  - lib/visits/stewardshipScope.ts
  - lib/visits/stewardship.ts
  - lib/visits/allOrgProgress.ts
  - lib/visits/allOrgRows.ts
  - lib/visits/progress.ts
  - lib/visits/householdCadences.ts
  - lib/visits/cadence.ts
  - lib/validation/visit.ts
  - app/api/households/[id]/stewardship/route.ts
  - app/api/visits/stewardship/route.ts
  - app/(app)/visits/all-organizations/page.tsx
  - app/(app)/visits/AllOrganizationsTable.tsx
  - app/(app)/visits/StewardshipPanel.tsx
  - app/(app)/visits/GaugePill.tsx
  - app/(app)/visits/bandStyles.ts
  - app/(app)/visits/VisitProgressTable.tsx
  - app/(app)/visits/VisitProgressBanner.tsx
  - app/(app)/visits/page.tsx
related:
  - visits-e-cadence-and-priority
  - visits-b-progress-dashboard
  - visits-c-report-feed-and-cross-org
  - roster-b-picker-and-orgs
  - foundation-c-services
  - talks-d-reliability-goals
  - ai-d-corpus-scoping
  - role-access-overrides
  - auth-b-invites-admin
  - seed-household-id-collision
---

## What was done

Every organization was measured against every visitable household in the ward, so the Primary's
dashboard read "3 of 20" for ever. `household_stewardships (household_id, org_id)` records which
families are an organization's to visit, and a new `/visits/all-organizations` page shows every
household once with each organization's standing beside it. **Zero rows means the whole ward**, so
no ward's numbers moved on the day it shipped — the Elders Quorum's board was byte-identical, and
a test asserts exactly that.

The slice added a third reason a household is not counted, beside "nobody lives here" and
"do-not-contact", and the three must stay visibly distinct: a do-not-contact household is **shown
and marked**, a non-stewardship household is **gone**. `describeHouseholdForVisits()` is now the
single place that rule lives, so the dashboard denominator and the visit picker cannot drift —
they used to be two implementations kept in step by a pair of comments saying they must not drift.

## Key decisions

- **One table, absent means the whole ward.** The same idiom as `household_visit_cadences`. Its
  one seam is that "narrowed to nothing" and "not narrowed" are the same zero rows, so the empty
  bulk replace is **refused with a sentence naming the alternative** rather than silently widening
  an organization back to 200 households. If a ward ever needs an empty stewardship the fix is an
  org-level flag column, not a workaround.
- **`lib/visits/stewardshipScope.ts` names no subject.** `subjectId`, never `householdId`, so
  Phase 8's youth coverage imports it rather than writing a second meaning of the word — the
  discipline `cadence.ts` and `householdVisitPriority()` already keep. A test passes youth ids and
  asserts identical behaviour, so a future "tidy" to visit vocabulary fails there.
- **Cross-org visibility was widened, then widened again — and the second time reversed
  ITER-018.** Migration 052 widened `household_stewardships_select` only, on the reasoning that
  facts about coverage are shared while a presidency's judgements are not. Walking scenario 048
  killed that line: an org leader saw the other organizations' chips with no bands, and the page
  had to explain per chip that a number was being withheld. Migration 053 widened
  `visit_goals_select` and `household_visit_cadences_select` too. **The cadence had to follow the
  goal** — a band prefers the per-household override, so widening the goal alone would have
  rendered a pill computed from the wrong interval, and a number that is visible and wrong is
  worse than one withheld. Writes and `visit_private_notes` did not move.
- **An organization claims households only if it has a visit goal.** This replaced a hardcoded
  "not the Bishopric" exclusion, which was a special case standing in for the general rule. A ward
  has seven organizations; Young Men, Young Women and Sunday School each claimed *every* household
  and made "unclaimed" unreachable in any real ward. The rule was rejected once because goals were
  not readable across organizations — migration 053 removed that objection, and the two changes
  fix each other. **If 053 is ever reversed this rule becomes reader-dependent** and must go with
  it.

## What the walk changed that the plan and the tests could not

- **The plan's own arithmetic was wrong and the scenario inherited it.** It said 24 households
  while its own breakdown summed to 22 — the two do-not-contact families sit *inside* the eight
  and the fourteen, not beside them. Caught by computing the expected numbers from the seeded
  database **before** opening the page, which is the only reason it was caught before a human
  ticked a wrong checklist.
- **A comparator bug the type system could not see.** `compareAllOrgRows` passed real family names
  into `compareByPriority`, whose own name tie-break then pre-empted the never-visited step — so a
  family nobody had ever visited sorted *below* one visited last month. Fixed by passing identical
  names so only the band ordering comes through.
- **A tooltip that asserted a cause the code did not know.** Every un-banded chip said "Only this
  organization can see how it is doing." A missing band had four causes and that named one; it was
  true in one of the three states the walk reached. Fixed by removing both causes rather than
  rewording: goal-less organizations stopped being claimants, and 053 made every goal readable.
- **A pre-existing ITER-018 defect surfaced by a new fixture.** The banner read "Warning month
  ahead." — `goalSentence()` stripped "Every " off `describeCadence()`, which drops the number at
  an amount of 1. Scenario 045 used a two-month window so it had never shown. `describeDuration()`
  now answers "how long" and takes the article at one.

## Pattern

**A rule that is right for one caller becomes a bug when a second caller inherits it.**
`compareByPriority`'s name tie-break, `describeCadence`'s dropped number, and the chip tooltip's
single named cause were all correct where they were written and wrong the moment a second surface
reused them. Each was caught by a fixture that differed from the first caller's in one detail — a
one-unit notice window, a row with steps after the band, a reader who could see everything.

**A stale server-rendered surface is invisible to TanStack invalidation.** Saving a stewardship
updated the panel and the dashboard and left the picker — a Server Component — showing the old
labels until any navigation. Decided as *leave it*; the fix, if revisited, is `router.refresh()`
beside the query invalidation.
