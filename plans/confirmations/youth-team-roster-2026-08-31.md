---
id: youth-team-roster
status: confirmed
commit: df25b40
date: 2026-08-31
area: youth-team-roster
related_retros: [youth-j-team-and-roster, youth-i-recording-an-absence, youth-h-season-close-and-safe-remove, youth-f-support-percentage-and-youth-cards]
supersedes: null
---

## What was tested

**Scenario 062 walked by an AGENT (Claude, via Playwright) against the hosted project, on
localhost:3000. The user reviewed the published walk report, answered all six judgement questions
the same day, and approved the fixes that followed.** The user did not drive the app themselves.
That distinction matters here more than usual: three of the six questions are about whether words
*read* right, and the answers are the user's own — but every observed value below was read by the
agent, not seen by a person.

The walk covered the whole youth-j model on one screen: one activity, one imported schedule, a
roster of four, and the app deriving youth × event. `/youth`, `/youth/profiles`,
`/youth/calendar`, `/youth/events/[id]` and `/youth/history/[member_id]`, from four accounts
(`ym-president`, `yw-president`, `ym-secretary`, plus the service client for read-back).

**Every write was read back with a service-role client**, never confirmed from the screen. The
four support percentages were computed independently — in Node, through the real
`buildSupportEvents`/`activitySupport`, against the stored rows — **before** the browser was
opened, so the screen was compared against an expectation rather than explaining itself.

### NOT verified

- **The deployed build was not opened DURING this walk** — everything here is localhost against
  the hosted database. **That gap was closed the same evening**, after the push, by
  `deployed-build-2026-08-31.md`: both 062-D1 fix sites hold server-rendered, and every date on
  production matches a value computed independently in Node, including the `01:30Z` boundary game.
- **No real device.** 375px was a resized desktop viewport.
- **Dark mode from screenshots only** — one shot of `/youth/profiles`.
- **Scenarios 060, 061 and 063 not walked.** 063 is this slice's own second scenario (a schedule
  with nobody on it yet — the LOUD empty-roster branch), and it is the one that would exercise
  `eventYouthAttendance()`'s branch 5 on a screen rather than in a unit test.
- **Migration 063 was not applied at the time of this walk** — deliberately held back until after
  the deploy. It was applied later the same evening, once `df25b40` was live and the deployed
  build had been walked, which is the order the migration's own header prescribes. Its
  `HELD_BACK_UNTIL_DEPLOYED` entry was removed in the same change, prompted by the suite's own
  stale-entry assertion going red.
- **The bishopric path was not walked**, and neither was the PIN account.
- **Two failure-behaviour checks were left to the tests** by the scenario's own instruction: the
  duplicate-roster 409 (unreachable by hand — the picker offers nobody) and "removing a roster row
  leaves the events intact".

## Confirmed by the user 2026-08-31

Marked **confirmed** on the user's instruction, closing Phase 8's youth work out. The
"NOT verified" list above is kept deliberately and is part of the baseline: this record is what a
future regression gets diffed against, so what was never checked has to stay visible.

## Result

### The three things the slice exists to prove — all verified

**Thirteen cards, not fifty-two.** One profile, one calendar, thirteen event rows serving four
young people. `/youth/profiles` read `Schedule (13 events)` with past shown; `/youth/calendar`
read 4, which is that page's upcoming-only horizon rather than a smaller number.

**The boundary game counts for both of them.** G05 is Maya's last day on the team and Tyler's
first, at 7:30pm in `America/Denver` — stored `2026-08-08T01:30:00+00:00`, i.e. the *following*
day in UTC, which is the case a `slice(0, 10)` comparison gets wrong in both directions at once.
Its card named all four: `Ethan Brooks, Josh Kim, Maya Alvarez, Tyler Nash`. G01–G04 named three
without Tyler; G06 onward named three without Maya.

**Marking one player absent moves only that player's number.** Josh 71 % → **57 %**, with his
tooltip's second clause flipping from "somebody is going to the next one" to "nobody is down for
the next one" as his next expected game moved from G09 to G12. Ethan, Maya and Tyler unchanged to
the point. Clearing it returned him to **71 %** with the tooltip restored word for word, and
`activity_event_participation` went 2 rows → 1 — **the row is deleted, not set to something**.

### Observed values

The four pills, after the seed was reshaped (see below):

| Young person | Pill | Tooltip | Fraction |
|---|---|---|---|
| Ethan Brooks | 71 % | "Somebody went to 4 of 6 home games played, and somebody is going to the next one." | 5/7 |
| Josh Kim | 63 % | "Somebody went to 4 of 7 home games played, and somebody is going to the next one." | 5/8 |
| Maya Alvarez | 75 % | "Somebody went to 3 of 4 home games played." | 3/4 |
| Tyler Nash | 60 % | "Somebody went to 2 of 4 home games played, and somebody is going to the next one." | 3/5 |

Maya's tooltip has **no second clause**, and that is the correct rendering rather than a truncation:
she left the team, so she has no next event, and the fraction is shorter on both sides.

Other values worth diffing against later:

- G08 carried exactly one chip, `Ethan Brooks is not taking part`, with its expected list reading
  `Josh Kim, Tyler Nash`. No chip for anybody else.
- `/youth/events/<G08>` read `3 young people at this` and listed `Josh Kim, Tyler Nash, Ethan
  Brooks` — expected first, then absent, which is `rosterInWindow()`'s documented order.
- Audit row: `youth_activity_participation_recorded`, module `youth_activities`, detail
  `{eventId, memberId, profileId, eventTitle: "Basketball G09", memberName: "Josh Kim",
  takingPart: false}`.
- 400 path: a leaving date of `2026-07-01` on Tyler (joined `2026-08-07`) surfaced *"They cannot
  leave the team before they joined it."* and `started_on` was **unchanged** in the database.
- The Remove confirm reads: *"Take Tyler Nash off this activity? It will be as though they were
  never on it, and their games stop counting towards how well they are supported. If they left
  part-way through a season, use "Left the team" instead so the games they did play still count."*
  Cancelled; the roster was identical afterwards.
- `org_secretary` (`ym-secretary`): the roster and all four names **readable**; `Add a young
  person`, `Left the team`, `Change the date`, `Still on the team`, `Remove from this activity`,
  `Somebody wasn't there?`, `Edit` and `Close the season` **all absent** — the activity card had
  zero buttons. **`I'll go` present**, which is correct rather than a leak: that is
  `youth_activities.log`, which the role holds.
- `yw-president` (cross-org): roster controls **present** (both new tables are ward-wide on all
  four verbs), `Edit` and `Close the season` **absent** from the activity card. The `Edit` visible
  elsewhere on that page belongs to event cards, whose writes are ward-wide by migration 019.
- 375px: no horizontal overflow on either page (`scrollWidth` 360 = `clientWidth` 360); no raw
  uuid rendered; every `button` ≥ 44px. No console errors beyond the deliberate 400, **no React
  #418, and every time rendered 7:30 PM in the ward's zone**.
- Full suite after every change: **216 files, 3460 tests, 0 failures**. `typecheck`,
  `harness:typecheck` clean; `lint` 0 errors.

### All six judgement questions came back clean — a first for Phase 8

No copy defect and no wording change anywhere in this slice. Every previous Phase 8 walk produced
at least one. The answers, in the user's words: *"one team with four players"*, *"looks good"*,
*"an exception you may record"*, *"obvious enough"*, *yes*, *"correct"*.

Two of those close things that were open. **"An exception you may record" closes ITER-033's
presentation half**, answered by the person who raised it. And **"correct" — that a youth who left
mid-season keeps their card and their frozen percentage — is load-bearing for the defect below**:
it makes 062-D1 a bug about the *list*, and rules out "hide the person" as a fix.

### One defect, found and fixed in BOTH places it lived

**062-D1.** An expanded card on `/youth` listed the **team's** schedule under one young person's
name. Maya's pill row read `0 events coming up` while the heading inside the same card read
`Maya Alvarez (4 upcoming events)` — 12 with past shown, seven of them played after she left. The
percentage was right; the list beside it ignored the window. This is the ITER-022 count-and-list
shape, and `YouthOverview.tsx`'s own comment at the `profileIds` build site states the rule it
broke: *"A card showing '1 of 8' must expand to a list where eight home games are findable."*

**And it had a second site, found by asking where else the shape lived rather than by walking
again.** `/youth/history/[member_id]` filtered on `profileId` alone while the percentage beside it
went through `buildSupportEvents()`. The comment directly above it claimed the opposite —
*"AND IT IS NOW A SNAPSHOT OF **THEIR** SEASON RATHER THAN THE TEAM'S"* — true of the number,
false of the list. **Scenario 062 could not have caught it**, because it seeds no closed season.

Both fixed by **calling** `memberIsExpectedAt()` rather than restating the window, so the count
and the list cannot drift apart again. `/youth/profiles` deliberately does not narrow — there the
unit is the team.

Verified after the fix: Maya's card `(0 upcoming events)` / `(5 events)` with past shown — G01–G05,
her window exactly. `/youth/profiles` unchanged at 13. On the history page, after closing the
season through the UI: **Maya 5 events (G01–G05, 75 %), Tyler 5 events (G05–G08, 50 %)** — two
different five-event lists out of one thirteen-game season, which is what says the filter is per
person and per closing instant rather than accidentally right.

`tests/components/youth/EventListMemberWindow.test.tsx` pins it with six assertions, and was
**proved able to fail before being believed**: with the filter disabled, five go red and the
un-narrowed branch stays green.

### Three corrections to the scenario, and one to the harness README

Two checklist lines described states the app cannot reach, both written from the model rather than
from the running app: step 7 sent the tester to `/youth/calendar` for a **past** game on a page
that is upcoming-only by design, and the "twelve cards" check asserted twelve there for the same
reason. Rewritten to the pages where each fact is visible.

**A third line failed against correct arithmetic and the seed was what changed.** *"The four
percentages differ"* — Maya and Tyler both landed on 75 % (3/4 each, by different routes), because
the seed's comment reasoned about the history half only and did not account for the next-event
half, which Maya has none of. The seed gained **G06B**, one past home game with no attendee: the
only shape that separates them without pushing anybody to 0 % or 100 %.

An **`org_secretary` account** was added to the seed, because the checklist asked for that sign-in
and no such account existed — the only check on the read-but-not-write half had never been
walkable.

`testing/README.md` said an audit row must carry *"never a member's name"*, which **no route has
obeyed since `youth-h`** and which contradicts the reasoning written into the participation route.
The README was what changed: ids required, a short human-readable description welcome, and what
must never appear is a **secret** (rule 8) or the text of a private note (rule 5).

### Fixed in passing, and pre-existing

`npm run lint` had been failing with **seven errors from `.walk061/`** since the previous walk — a
red suite for a reason nobody had shipped. Walk working directories are now in ESLint's ignore
list (`.walk*/**`), as they already were in git's. A walk should not be able to break lint.

### What would move this to confirmed

Opening the deployed build on this slice is the single biggest gap, and the `deployed-build`
records are the reason to take it seriously rather than treat it as a formality: the first look at
production found a wrong-day, seven-hours-out rendering bug that localhost could not show, because
in dev the server and the browser share a zone. Every date on `/youth`, `/youth/profiles` and
`/youth/history` is a `timestamptz` formatted server-side. After that: walking scenario 063 (the
loud empty-roster branch), applying migration 063, and a real device.
