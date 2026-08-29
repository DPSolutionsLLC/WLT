# ITER-020: The Youth Module Needs Two Views It Does Not Have

**Type:** Feature
**Status:** Completed — the UNBLOCKED half. See **What shipped, and what did not** below.
**Completed:** 2026-08-29
**Commit:** 5cb14a2
**Plan:** plans/youth-e-overview-and-cross-navigation.md — the UNBLOCKED half only
(the youth overview, the sort buttons, committing from the calendar, the youth detail). The
event-detail view stays out, blocked by ITER-024.

## What shipped, and what did not

**Shipped:** the youth overview at `/youth` (one card per young person since `youth-f`), activity
management moved to `/youth/profiles`, sign-up from `/youth/calendar` without leaving the month, a
link per calendar card into the young person, and the `?youth=` deep link.

**Not shipped, and it is not an oversight:** the **event-detail view listing every youth at that
event**. An `activity_events` row belongs to exactly one profile, so the view's whole premise has no
answer until **ITER-024**'s occasion link exists. It is tracked there and in **ITER-027**, whose own
Sequencing section asks to be planned together with the view that reads the column. This scope is
closed rather than left open indefinitely, following ITER-022's precedent of naming the part that
moved elsewhere.

**Superseded by `youth-f`:** the three need-rankings this scope asked for became two sorts plus a
direction toggle, and a card became a young person rather than a young person and one activity.
**Created:** 2026-08-28
**Depends on:** Phase 8 slices A–D (all shipped 2026-08-28). No schema change is expected — see
**Why this is cheap** below.

## Summary

Phase 8 shipped four slices and the module's **front door is wrong**. Raised by the user
2026-08-28 reviewing the `youth-d` walkthrough, answering the question about whether the
follow-up feed's `"Nobody recorded as taking part"` reads as a bug:

> it doesn't necessarily look like a bug to me. but i don't clearly understand what it is telling
> me. i don't know where this report/view would necessarily be helpful. i think the most usefull
> views would be either by events, or individual youth. those would be two good options for
> overviews. then a separate one to review the needs.

> so a calendar view showing all of the events that have youth participating. then you could click
> on the event and see all of the youth who should be there. mark yourself to be one who will be
> there and is commiting yourself to make contact with that youth while you are there. then an
> overview of the youth who have events coming up. the ones who have an event coming with no leader
> signed up to attend should be sorted to the top. and of course the ability to commit yourself to
> attend an event from there as well.

> well i guess now that i have thought it through, that is all we need. the individual youth view
> would take care of the ability to review the needs. maybe to make the ui super easy. buttons that
> sort things according to what you are looking for.

And on how it came about:

> this is probably something i should have established before building this phase, just didn't
> really think about it until now.

## What already exists, and was not shown during the walk

**`/youth/calendar` is most of the first view already.** It was built in `youth-c` and the `youth-d`
walk never visited it, which is why the gap looked bigger than it is. It renders:

- every organization's youth events in one place, with the standing sentence *"so a clash is
  visible before it happens and a home event nobody is going to is not"*;
- filters for **young person**, organization, kind of activity, and home/away;
- a month grid whose day cells take the worst coverage state present, via `coverageRank()`;
- a strip that **names** (up to three) the home events in the next week with nobody going.

So *"the ones who have an event coming with no leader signed up sorted to the top"* already exists
as a rule — `COVERAGE_STATES` ordering — it is simply organised **by event** rather than by youth.

## What is actually missing

1. **You cannot commit yourself from the calendar.** The event card reads `Going: Miguel Cortez`
   and stops; `AttendeeControls` is rendered on `/youth` only. Verified in the browser
   2026-08-28. Small: the component, the route (`POST /api/youth/events/[id]/attend`) and
   migration 056c's policy all already exist and are exercised.

2. **There is no youth-centred overview.** The calendar filters *to* one young person; nothing
   lists *all* of them ranked by need. This is the genuinely new screen and probably the better
   front door of the two.

3. **Sort buttons rather than only filters.** The user's *"buttons that sort things according to
   what you are looking for"*. The calendar has four filter selects and no sort control.

4. **The follow-up needs a home in the new arrangement.** Neither of the user's two views has one,
   and `youth-d` built the whole thing. Recommendation recorded during the conversation: put it on
   the **youth** view rather than the calendar, because the pastoral question is about the young
   person, not the fixture.

## Two things settled in the conversation, so they are not re-litigated

- **"Commit to make contact with that youth" needs no new state.** An event belongs to exactly one
  activity profile, and a profile belongs to exactly one youth (migration 009 + 054a). So being
  down for Ethan's basketball game already *is* being down for Ethan. What is missing is only that
  the button says **"I'll go"** where the point is *"I'll be there for Ethan"* — a copy change on
  `AttendeeControls`, not a column.
  **The limit worth knowing:** this schema cannot express one event with several youth present (a
  combined activity, a stake dance). One event, one profile, one youth, always. If that is ever
  wanted it is a schema question and a separate scope.
  **It was wanted, on 2026-08-29, and it is now ITER-024** — which BLOCKS the event-detail half
  of this scope. See the additions section below.

- **The follow-up feed is a RECORD, not a workspace, and should be demoted rather than deleted.**
  It carries a readable account, per-person read state, and the ward-council flag — all real jobs,
  none of them "where a leader starts". `/youth/feed` stays; it stops being the thing linked
  first.

## Why this is cheap

**No migration is expected _for what was scoped on 2026-08-28_.** The 2026-08-29 additions below
change that: the event-detail view needs ITER-024 settled first, and its recommended option is a
small migration. The rest of this scope stands unchanged and is still presentation-only.

`youth_activity_profiles.member_id` → `members`,
`activity_events.profile_id` → profile, `activity_attendees.event_id` → event,
`activity_logs.event_id` → event. Both views are presentation over data that already exists, and
`lib/youth/coverage.ts` already computes the ranking either view would sort on. Nothing built in
slices A–D is wasted by this.

## Added 2026-08-29 — navigation, and what each view opens into

Raised by the user reviewing the ITER-021/022 walk, thinking aloud about how the module is moved
through rather than what each screen holds. **The two base views above are unchanged**; this is
about what happens when you click something in them.

> so yes, cross navigations from different views to easily get where you are wanting to go … the
> calendar view highlighting events with youth that need attention, and the youth list highlighting
> youth that need attention.

**The shape, as described:**

| From | Click | Arrive at |
|---|---|---|
| any card | the event | event detail: the details, **and every youth tied to it** |
| event detail | a youth | that youth's events, filterable, with what they need |
| youth list | a name | the card expands in place — upcoming and past, commit and follow up inline |

1. **An event-detail view listing every youth at that event**, with the ability to **add a youth you
   notice is missing**. **BLOCKED by ITER-024** — an event belongs to exactly one youth today, so
   "every youth tied to it" has no answer. This is the single largest thing standing between this
   scope and the user's picture of it.

2. **A youth-detail view** — a filterable list of that young person's events and a snapshot of where
   commitments are missing. Not blocked; the profile is already the right unit.

3. **The youth list is searchable, and each name expands in place** rather than navigating away.
   Inside the expanded card: upcoming and past events, with committing and writing a follow-up both
   done there. Not blocked.

4. **Coverage on the calendar, stated as the user states it:** an event is fully covered when
   **every** youth in it has at least one leader committed **for that youth**, and shows an alert
   when even one does not. Under one-youth-per-event this is what `eventCoverage()` already
   computes. Under ITER-024's Option A′ it becomes worst-of over the occasion's rows — which is
   exactly the rule `coverageRank()` already applies to day cells, reused rather than invented.

**What this does not change:** the two base views, the demotion of `/youth/feed`, and the decision
that committing to an event already is committing to that youth.

## Open, and worth deciding while planning

- **Is the youth view or the calendar the landing page?** `/youth` today is activities + the
  follow-up panel + the schedule + the add-event form, which is four jobs on one screen and is
  part of why the panel was hard to find (see ITER-022's findability note).
- **A second, more pastoral signal the user's sort does not capture.** Ranking by *"has a game
  coming up with nobody going"* does not answer *"which young person has quietly had nobody turn
  up all season"*. Different question, arguably the one that matters more. Raised in conversation
  and deliberately left out of the first pass; the youth view is where it would live.
- Whether the sort buttons replace the calendar's four filter selects or sit beside them.
- **Does this scope wait for ITER-024, or ship in two passes?** The youth view, the sort
  buttons, committing from the calendar and the youth-detail view are all unblocked and are
  most of the value. The event-detail view is the only piece that needs the schema decision, so
  splitting is possible — and would get the better front door in front of a ward sooner.
