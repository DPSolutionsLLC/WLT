# ITER-018: Visit Goals Should Be a Cadence, Not a Dated Period

**Type:** Feature / redesign
**Status:** Backlogged
**Created:** 2026-08-26

## Summary

A visit goal today is *"between these two dates, visit everybody"*. What a quorum actually
operates is *"visit everybody once a year"* — a rolling cadence per household, with dates as an
optional deadline rather than the required frame. Every awkward thing about the progress dashboard
follows from having built the special case as though it were the general one.

Raised by the user 2026-08-26 while reviewing the scenario-040 walkthrough, from the D3 finding.

## What triggered it

The walkthrough surfaced a contradiction: a household can read **✓ Visited** while the banner
counts it as **not** visited, and this happens at the start of *every* new goal period. Chasing
which half to change turned out to be chasing the wrong question — the user's reaction was that
**"Visited" is not worth a badge at all**:

> visited doesn't really provide any real value. what is most valuable is knowing how close to
> being due it is.

That is the whole redesign in one sentence. Five discrete states are the wrong shape; the useful
quantity is a household's position on a **priority scale**, and the goal is what defines that
scale.

## The change, in seven parts

### 1. A goal may have no dates at all

Add a rolling mode: *"every household, once every X"*, with no `goal_period_start` /
`goal_period_end`. Progress is then measured from **each household's own last visit**, not from a
shared period boundary. This should probably become the DEFAULT shape, with the dated period kept
as the "we want this done by Christmas" case.

Doing this dissolves D3 rather than patching it: with no period, there is no second notion of
"visited" to disagree with the badge.

### 2. Cadence in days, weeks, months or years

Today: `annual` | `biannual` | `custom` months (`CADENCE_MONTHS` in `lib/validation/visit.ts`).
Wanted: an amount plus a unit, so *every 3 weeks* and *every 2 years* are both expressible.

### 3. A goal must be editable

**There is no edit path for a visit goal anywhere in the app.** `VisitGoalPanel` only offers
"Set a goal" — found while walking 040, where the checklist assumed an edit control that has never
existed. A quorum changing its mind currently means stacking a second goal on top of the first and
relying on `selectActiveGoal()` to pick the right one. `PATCH /api/visit-goals/[id]` already
exists and `updateVisitGoal()` is written; only the UI is missing.

### 4. Per-household cadence override

> when a quorum has their baseline cadence set to once a year, and they decide that a particular
> family needs a little more attention than that. they could set them to once every 3 months

A household-level cadence that overrides the org's baseline. Nullable — null means "use the
quorum's". This is the feature with the most product value in the list and the least precedent in
the schema; it is also the one that makes the priority scale genuinely useful, because a ward's
attention is never actually uniform.

Note it is a property of *this org's relationship to this household*, not of the household
globally: two organizations could reasonably want different cadences for the same family. Whether
that matters in v1 is a real decision — a column on `households` is far simpler than a
`household_visit_cadences` join table, and simpler is probably right until somebody asks.

### 5. Status becomes a priority scale

Drop the `visited` badge. The column becomes a position on a scale driven by *fraction of the
cadence elapsed*, so a household at 95% and one at 10% no longer read as the same "Visited".
`householdVisitStatus()` already computes that fraction internally — it currently throws it away
by bucketing.

**`attempted_never_reached` does not belong on that scale.** It is a *reason*, not a position:
a household somebody has knocked on four times is a different problem from one nobody has been
to, at any level of urgency. Keep it as a separate mark or flag alongside the scale rather than
folding it in.

### 6. The banner becomes several statistics

> a percentage of households that are on track? maybe a collection of different stats? like # of
> households within 2 months of being due for example along with number of households that are
> overdue

"X of Y visited" only means anything inside a dated period, so it goes away with the period. What
replaces it is a small set of counts against the scale — on track, approaching due, overdue —
plus a percentage. Design it against the priority scale from part 5 so the banner and the column
are the same information at two resolutions.

Also wanted: **a reminder of what the goal is at the top of the section**, so the numbers are read
against their own definition rather than against an assumption.

### 7. Household-level do-not-contact, excluded from goal statistics

> we need to make sure we have a way to mark a household as do not contact. and have those ones
> left out of statistics

**This is a genuine gap, not just a statistics question.** `do_not_contact` is a MEMBER status
(`types/domain.ts` §`MEMBER_STATUSES`); there is no household-level equivalent. Marking a family
today means editing every member individually, and nothing says the household as a whole is not to
be contacted.

The exclusion half already half-works by accident: `isVisitableHousehold()` in
`lib/visits/progress.ts` drops a household once *all* its members are non-active, so a fully
marked household is already out of the denominator. A household-level flag would make that
intentional rather than emergent, and would let a family be marked in one action.

## When to run this

**After `visits-c`, and BEFORE Phase 8.** That order is not a preference; the second half is a
constraint.

- **After `visits-c`** because that slice is decoupled from the goal model — its feed is over
  visit *logs*, and it deliberately does not add a cross-org progress summary or the
  `visit_goals_select` policy branch. Nothing in it gets rewritten by this work, and it closes
  Phase 7, so the migrations here land on a settled module rather than a half-finished one.
- **Before Phase 8** because `plans/visits-b-progress-dashboard.md` §Integration Notes records
  that **youth-activity coverage has the same "due/overdue against a cadence" shape and will
  reuse `householdVisitStatus`**. If the five buckets are replaced with a priority scale *after*
  Phase 8 ships, either Phase 8 is built on a model already known to be wrong, or the two
  diverge permanently and the app carries two meanings of "overdue".

**Answer the four open questions below before planning.** They are product decisions, not
implementation ones, and `/planning` cannot start without them.

## Why not now

`visits-b` shipped with **no schema change**, which its plan named as an integration property.
Parts 1, 2, 4 and 7 all need migrations — `visit_goals` gains a cadence unit and nullable
dates, `households` gains a cadence override and a contact flag. Parts 5 and 6 are a rewrite of
the status function's output shape and of the banner, both of which are cheap *after* the goal
model settles and wasted work before it.

## What survives from `visits-b`

Most of it, which is why deferring costs little:

- `lib/visits/progress.ts` — the denominator rule, the tally, the completed-vs-attempted split
  and `attemptsSinceLastVisit` are all independent of the goal's shape.
- `readVisitProgress()` / `GET /api/visits/progress` — the read path and its org scoping.
- `VisitProgressTable` — sorting, the responsive collapse, the org switcher.
- `householdVisitStatus()`'s **arithmetic**; its five-bucket return type is what changes.
- The `asOf`-as-a-parameter discipline, which is what will make a priority scale testable at its
  boundaries the same way the buckets were.

## Open questions

1. **Do dated periods survive at all?** The user wants to keep them ("to be able to give yourself
   a deadline"), but a deadline may be better modelled as an attribute of a rolling goal than as a
   different kind of goal. Two goal shapes is two code paths through every statistic.
2. **Per-household cadence: column on `households`, or a per-org join table?** See part 4.
3. **What does the priority scale look like when a household has never been visited at all?**
   With no period start to anchor on (part 1 removes it), there is no elapsed fraction to compute.
   Probably its own top-priority state — but it needs deciding, and it is exactly the hole
   `talks-d` found in `goalStatus()` and `visits-b` closed with `goalPeriodStart`.
4. **Does a do-not-contact household disappear from the list, or appear marked and uncounted?**
   Disappearing loses the record that a decision was made; appearing greyed keeps it visible to
   the next presidency.

## Related

- `plans/visits-b-progress-dashboard.md` and `plans/retros/visits-b-progress-dashboard.md`
- `testing/scenarios/visits/scenario-040-the-dashboard-and-its-denominator/` — walkthrough record,
  Defect 3
- `plans/07-visits.md` §Step 4
