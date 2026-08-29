---
id: youth-e-overview-and-cross-navigation
type: feature
iter: ITER-020
commits: [3a33109]
date: 2026-08-29
files:
  - app/(app)/youth/YouthOverview.tsx
  - app/(app)/youth/page.tsx
  - app/(app)/youth/profiles/page.tsx
  - app/(app)/youth/EventList.tsx
  - app/(app)/youth/calendar/ActivityCalendar.tsx
  - app/(app)/youth/calendar/page.tsx
  - lib/youth/profileNeed.ts
related:
  - youth-a-profiles-and-events
  - youth-c-coverage-and-calendar
  - youth-d-followup-and-report-feed
  - visits-f-stewardship-and-all-orgs
  - youth-follow-up-controls
---

## What was done

`/youth` was four jobs on one screen and none of them was *how is Ethan doing*. Managing the
activities themselves moved to `/youth/profiles`, and the front door became a ranked list of the
ward's young people, each card expanding in place to that person's events. `/youth/calendar` gained
a per-card link into it, and signing up from the calendar was made possible without leaving the
month.

The event-detail half of ITER-020 is **not** here: an `activity_events` row belongs to exactly one
profile, so "every youth tied to this event" has no answer until ITER-024's occasion link exists.

## Key decisions

- **A ranking needs a number nobody has to explain.** `lib/youth/profileNeed.ts` answers two
  questions the coverage model could not: the upcoming half ("has a game coming up with nobody
  going") is `lib/youth/coverage.ts` composed, never redefined; the pastoral half ("nobody has been
  to one of Ethan's games all season") is new, because every past event reads `not_expected` — which
  is correct for the first question and silent about the second.
- **Absence of a signal sorts last, and that is the `visits-f` lesson arriving here.** A profile
  with no upcoming events, and one with nothing played, are *no signal* rather than a good score.
  The seed exists to prove it: Josh (all away), Sofia (tbd + cancelled) and Liam (no events) must
  land in the last group, never first.
- **The seed stays whole; only the render filters.** `EventList`'s `profileId` decides what is
  *drawn*; `initialEvents` is a cache entry shared with `FollowUpPanel` and the overview, and
  seeding it pre-filtered would leave those two rendering one young person's events and calling it
  the ward's (`visits-c`).

## What the walk found

**One defect, and it is the ITER-022 shape a second time.** Every covered card rendered
`Covered · 0` above an event card reading `Covered · 1`, because `ProfileNeed` carried
`worstUpcoming` and `soonestNeedOn` but **not the attendee count of that event**, so the component
had no real number to pass and filled a literal zero. The state half was correct, which is what made
it survive: the existing check pinned the *state*, so the wrong *number* passed it — a check that
could not fail for the thing that broke.

Fixed by carrying the **whole event row** rather than two fields of it, so the badge's state, the
badge's count and the tie-break date cannot describe different events. That shape is what
`youth-f`'s `youthNeed()` then had to preserve across activities.
