# ITER-020: The Youth Module Needs Two Views It Does Not Have

**Type:** Feature
**Status:** Backlog
**Plan:** _none yet_
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

- **The follow-up feed is a RECORD, not a workspace, and should be demoted rather than deleted.**
  It carries a readable account, per-person read state, and the ward-council flag — all real jobs,
  none of them "where a leader starts". `/youth/feed` stays; it stops being the thing linked
  first.

## Why this is cheap

**No migration is expected.** `youth_activity_profiles.member_id` → `members`,
`activity_events.profile_id` → profile, `activity_attendees.event_id` → event,
`activity_logs.event_id` → event. Both views are presentation over data that already exists, and
`lib/youth/coverage.ts` already computes the ranking either view would sort on. Nothing built in
slices A–D is wasted by this.

## Open, and worth deciding while planning

- **Is the youth view or the calendar the landing page?** `/youth` today is activities + the
  follow-up panel + the schedule + the add-event form, which is four jobs on one screen and is
  part of why the panel was hard to find (see ITER-022's findability note).
- **A second, more pastoral signal the user's sort does not capture.** Ranking by *"has a game
  coming up with nobody going"* does not answer *"which young person has quietly had nobody turn
  up all season"*. Different question, arguably the one that matters more. Raised in conversation
  and deliberately left out of the first pass; the youth view is where it would live.
- Whether the sort buttons replace the calendar's four filter selects or sit beside them.
