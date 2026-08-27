# ITER-019: Stewardship — Which Households Are Even Ours

**Type:** Feature
**Status:** Scoped, not planned
**Plan:** _none yet_
**Created:** 2026-08-27
**Depends on:** ITER-018 (shipped) — the cadence model, `household_visit_cadences`, and the
priority scale are all assumed here.

## Summary

Every organization is currently measured against **every visitable household in the ward**. That
is wrong for most organizations and obviously wrong for one of them: the Primary is never going to
visit all two hundred households, only the families with a child in Primary. Their dashboard today
would read "3 of 200" for ever.

Two things follow, and they are the whole scope:

1. **An organization needs to say which households are in its stewardship**, and be measured
   against only those.
2. **When cross-org visibility is on, somebody needs a way to see all organizations at once** —
   one row per household, summarising where each organization with a stewardship in that family
   stands.

Raised by the user 2026-08-27 while reviewing the scenario-045 walkthrough, answering the question
about the same household reading a different band for two organizations.

## What triggered it

The walk showed the Whitfields reading **overdue** for the Elders Quorum and **On track** for the
Relief Society at the same moment. The user's verdict was that this reads as correct and
intentional — and that seeing it working immediately raised what was missing:

> i think we need to add an additional option. that is to view all organizations when that option
> is set to be on by admin. when viewing all, it would be nice to have the cards for each household
> show a summary of visit information from all quorums involved.

> we need to add a way for them to mark what households to include in their visit goals period. for
> example, the primary is not going to want to visit every household in the ward. they will only
> want to visit the households that have a child in their primary organization.

> do not contact identifiers would be used for households where the quorum would like to make the
> visit but they have been instructed not to for whatever reason. this should be kept separate from
> households that should be omitted simply because they are not part of that quorums stewardship.

## The distinction this rests on

**These are three different reasons a household is not counted, and collapsing any two of them
loses information a presidency needs.**

| Reason | Question it answers | Scope | Today |
|---|---|---|---|
| No active members | "Does anybody live here?" | Ward-wide fact | `isVisitableHousehold()` — absent from the page entirely |
| Do not contact | "May we call on them?" | **Ward-wide** pastoral fact | `households.do_not_contact` — shown, marked, counted in nothing |
| **Not our stewardship** | "Are they ours to visit?" | **Per organization** | **Does not exist** |

The user was explicit that do-not-contact means *"the quorum would like to make the visit but they
have been instructed not to"*. It is a fact about the household and it stays where it is. Whether
a household is in an organization's stewardship is a fact about the **relationship**, and belongs
in a join table beside `household_visit_cadences`.

**A household outside an organization's stewardship should probably not appear on that
organization's dashboard at all** — unlike do-not-contact, which is deliberately shown. There is
nothing for that organization to hand to the next presidency about a family that was never theirs.
That is a product question, not a settled decision — see Q3.

## Open questions

Answer before `/planning`.

**Q1 — Is stewardship opt-in or opt-out?**
Opt-in (an organization starts with nothing and adds households) is right for the Primary and
wrong for the Elders Quorum, which really does want nearly everybody. Opt-out is the reverse.
A likely answer: **default to the whole ward, and let an organization narrow it** — so nothing
changes for the quorums until somebody chooses to narrow, and the Primary narrows once. This keeps
every existing dashboard correct on the day it ships, which an opt-in default would not.

**Q2 — Is the Primary's list derived, or hand-marked?**
`member_organizations` already knows which members are in Primary, so "households containing a
Primary member" is derivable **today** with no new data. Hand-marking two hundred households is
not a thing anybody will do.
The strong shape is **derive a suggestion, then confirm and adjust**: show the organization the
list its own membership implies, let them tick off the exceptions, and store the result. The
question is whether the stored result then goes **stale** as children age out of Primary, or
whether the derivation re-runs and the stored rows are only the *exceptions* to it. The second is
more correct and more work.

**Q3 — Does a non-stewardship household disappear, or show as "not ours"?**
Disappearing is cleaner and matches the reason. Showing it greyed makes it possible to notice a
family nobody has claimed, which is a real pastoral failure mode — a household in no
organization's stewardship is invisible to the whole ward. That argues for a **ward-level** view
that surfaces unclaimed households, rather than for cluttering each organization's list.

**Q4 — Who may set stewardship?**
`visits.manage_goals` is the obvious answer, matching the cadence override — it is the same kind
of decision about the same kind of object, and ITER-018 Decision 5 already established that an org
president owns it without holding `roster.manage`. Worth confirming the bishopric can set it for
any organization, as they can with goals and cadences.

**Q5 — What exactly does the all-organizations row summarise?**
"A summary of visit information from all quorums involved" needs pinning down. Candidates: each
organization's band and due date; the most urgent band across all of them; who went most recently
across all of them. The last is the one a bishop probably wants and the one the current
org-scoped queries cannot answer.

**Q6 — Does the all-orgs view respect cross-org visibility, or is it bishopric-only?**
The user said *"when that option is set to be on by admin"*, which implies the ward setting gates
it. Note what that setting does **today**: migration 019 widens `visit_logs_select` and **nothing
else**. ITER-018 deliberately did **not** widen `household_visit_cadences_select`, on the grounds
that a cadence is a configuration rather than a report, and
`tests/rls/visit-cross-org.test.ts` now asserts that. An all-orgs view showing another
organization's bands would need that decision revisited — or the view assembled bishopric-side
only. **This is the sharpest technical question in the scope.**

## Consequences worth naming before planning

- **The denominator changes.** `VisitProgressStatistics.counted` currently means "visitable and
  not do-not-contact". It would become "visitable, in this organization's stewardship, and not
  do-not-contact". Every number on the dashboard moves.
- **`readVisitProgress` gains a fifth parallel fetch**, or stewardship rides along with the
  household query.
- **The household picker in `app/(app)/visits/page.tsx` must not drift from it.** That file and
  `lib/visits/progress.ts` both carry comments insisting the picker and the denominator apply one
  rule. A third axis makes that easier to get wrong, not harder.
- **The RLS shape is already established** — `household_visit_cadences` is the template: ward +
  `(is_bishopric() or org_id = current_org_id())`, `org_id NOT NULL`, unique on
  `(household_id, org_id)`. A stewardship table is the same shape with a different payload, and
  might even be the *same* table with a nullable cadence, which is worth considering rather than
  assuming two.
- **Phase 8 reuses this module.** Youth activity coverage has the same shape, and "which youth are
  ours" is the same question as "which households are ours". Whatever is built here should not name
  households in its parameters, the way `lib/visits/cadence.ts` and `householdVisitPriority()`
  already avoid naming visits.

## Success criteria (draft)

- The Primary can narrow its stewardship to the households with a child in Primary in one pass,
  without ticking two hundred boxes, and its dashboard denominator becomes that number.
- The Elders Quorum's dashboard is unchanged on the day this ships, having narrowed nothing.
- A household outside an organization's stewardship is in no numerator and no denominator for that
  organization, and this is visibly a different thing from do-not-contact.
- With cross-org visibility on, one view shows every household once with each organization's
  standing beside it.
- A household in **no** organization's stewardship is discoverable by somebody, rather than
  silently unvisited by everyone.
