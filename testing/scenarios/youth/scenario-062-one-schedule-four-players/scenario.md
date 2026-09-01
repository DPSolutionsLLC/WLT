---
name: One schedule, four players
scope: youth
part: 12
tags: [youth, full, roster, coverage]
prerequisites: none
---

## Purpose

Before `youth-j` there was no **team** in this app — only one young person's copy of one.
`activity_events.profile_id` is a single foreign key and the ICS import takes a `profileId`, so
four players on a thirteen-game season meant **four profiles, four imports of the same file and
52 rows for 13 real games**, with `activity_occasions` re-linking the duplicates one game at a time
by hand.

This scenario is the whole new model on one screen: **one activity, one imported schedule, a
roster of four, and the app deriving youth × event.** It proves four things that were not
expressible before, and every one of them is a fraction over a season rather than something a
screenshot of a fresh ward could show:

1. **Thirteen cards, not fifty-two.**
2. A young person who **left mid-season** is not measured on games after they left — and the game
   **on** their leaving day still counts.
3. A young person who **joined mid-season** is the mirror of that.
4. Marking one player absent for one game moves **only that player's number**.

The last of those is the one a unit test cannot finish the job on: `tests/lib/youthRoster.test.ts`
proves the arithmetic, but whether a leader can *see* that only one pill moved is a question about
a screen.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, home venues: Lincoln High School |
| Users | `bishop`, `ym-president` (Miguel Cortez), `yw-president` (Renata Alvarez), `ym-secretary` (Dale Whitmore — `org_secretary`, holds `.view` and `.log` but **not** `.manage`) |
| Youth | Ethan Brooks, Josh Kim, Tyler Nash (Young Men); Maya Alvarez (Young Women) |
| Activity | **1** — "Varsity basketball", Lincoln High School, Young Men, season running |
| Calendar | **1** — `ics_upload`, so every game reads "From a schedule feed" |
| Events | **13** — 9 past, 4 upcoming; 10 home, 3 away; 1 cancelled; all with a `source_uid` |
| Roster | **4** — Ethan (no dates), Josh (no dates), Maya (`ended_on` = day of game G05), Tyler (`started_on` = day of game G05) |
| Attendees | 6, spread so the four percentages all differ and none is 0 % or 100 % — **G06B carries none**, and it is the game that separates Maya from Tyler |
| Participation | **1** — Ethan, `taking_part = false`, on past home game **G08** |

**Sign in with:** `ym-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> **G05 is the boundary game.** It is Maya's last day on the team *and* Tyler's first, and it is a
> 7:30pm game. It must count for **both** of them. That is the case a `slice(0, 10)` date
> comparison gets wrong, because west of UTC a 7:30pm game is already tomorrow in UTC.

## Steps

1. `npm run seed -- youth/scenario-062-one-schedule-four-players`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president`.
4. Open `/youth`. Read the four cards.
5. Expand Ethan's card, then Maya's.
6. Open `/youth/profiles` and read the Varsity basketball card and its roster.
7. Expand Ethan's card on `/youth`, press "Show past events", and find game **G08** — the one he
   missed. (**Not** `/youth/calendar`: that page is upcoming-only by design, and G08 is past.
   `/youth/events/<G08>` shows the same chip if you prefer the detail page.)
8. Back on `/youth`, note **Josh's** percentage. Then open `/youth/profiles`, find game **G09**
   (the next upcoming home game), open "Somebody wasn't there?" and mark **Josh** as not taking
   part.
9. Return to `/youth` and compare all four pills against what you noted.
10. Clear the mark by pressing "Not taking part" again on Josh's row.

## Verification Checklist

### Machine-checkable

- [ ] `/youth` shows **four** young people, each carrying a "Varsity basketball" pill.
- [ ] The four percentages **differ from one another**, and none is `0%` or `100%`.
- [ ] `/youth/profiles` shows **one** Varsity basketball card, not four, with **four names** under
      "Who is on this".
- [ ] Maya's roster line reads "Left <date>"; Tyler's reads "Joined <date>". Both dates render as a
      day (e.g. "3 Mar 2027") and neither shows a time.
- [ ] The team's whole schedule is **13** cards, not 52 — read it on `/youth/profiles` (or an
      expanded card on `/youth`) with past events shown. `/youth/calendar` is **upcoming-only by
      design**, so there it is **4** cards for this team, not 16; that is the same fact at a
      different horizon, not a smaller number.
- [ ] Every event card names the young people expected at it, and the **away** and **cancelled**
      games are still listed.
- [ ] Game **G08** carries **one** absence chip reading "Ethan Brooks is not taking part", and no
      chip for Josh, Maya or Tyler.
- [ ] **No unanswered Yes/No control appears on any event card.** There is at most one quiet
      "Somebody wasn't there?" link per card, and nothing is pre-asked.
- [ ] Hovering Ethan's pill shows counts whose denominator is **smaller** than Josh's — G08 is out
      of Ethan's and still in Josh's.
- [ ] Maya's denominator counts **no** game after her leaving day, and the game **on** it (G05) is
      counted.
- [ ] Tyler's denominator counts **no** game before his joining day, and the game **on** it (G05)
      is counted.
- [ ] After step 8, **only Josh's pill has moved**. Ethan's, Maya's and Tyler's are unchanged.
- [ ] After step 10 the pill returns to exactly its earlier value, and
      `select * from activity_event_participation where event_id = '<G09>'` returns **no row** for
      Josh — cleared means the row is gone, not set to something.
- [ ] Signed in as `yw-president`, the roster controls on Varsity basketball are still **present**
      (both new tables are ward-wide on all four verbs) while `Edit` / `Close the season` are
      **absent** (the profile's writes are org-scoped).

### Needs a human eye

All six were put to the user on 2026-08-31 as a question plus a screenshot, and all six came back
clean — no copy defect and no wording change anywhere in this slice, which is the first time in
Phase 8 a walk has produced none.

- [x] Does the Varsity basketball card read as **one team with four players**, rather than as four
      things that happen to share a name?
      → **"one team with four players."**
- [x] On an event card, does the list of expected young people read as useful information, or as
      clutter repeated on every one of thirteen cards?
      → **"looks good"** — the repetition is accepted. Do not "tidy" it away later; a card that
      names nobody is what a leader cannot act on.
- [x] Does "Somebody wasn't there?" read as an **exception you may record**, rather than as a
      question you are being asked? (This is the defect that raised ITER-033 — a leader seeing the
      old control asked whether every youth-event connection now had to be confirmed.)
      → **"an exception you may record"** — ITER-033's presentation half is confirmed fixed, by
      the person who raised it.
- [x] Ethan's card shows a smaller denominator than Josh's with no explanation on the card itself.
      Is that confusing, or does the chip on G08 make it obvious enough when you go looking?
      → **"obvious enough."** No explanation is owed on the card; the chip carries it. A future
      slice adding a "why is this number lower" line to the pill is solving a settled question.
- [x] Is the whole `/youth/profiles` card legible one-handed at 375px, in both themes, with four
      names and their date lines?
      → **yes.**
- [x] Maya has left the team but still appears on `/youth` with a percentage for a season she was
      part of. Does that read as correct, or as a person who should have disappeared?
      → **"correct."** A youth who left mid-season KEEPS their card and their frozen percentage.
      This is the same answer `youth-h` got for a closed season and for the same reason — the
      record of what happened is what the next presidency needs — and it is what makes defect
      **062-D1** a bug about the LIST rather than an argument for hiding the person.

## Failure Behavior

- [ ] Adding a young person who is already on the roster → **409** with *"They are already on this
      activity."* The picker excludes them, so this is reachable only by hand. Covered by
      `tests/routes/youthRoster.test.ts`.
- [ ] Setting a leaving date **earlier than** the joining date → **400** with *"They cannot leave
      the team before they joined it."* and the stored date unchanged. Try this on Tyler, whose
      `started_on` is set. Covered by `tests/routes/youthRoster.test.ts`.
- [ ] "Remove from this activity" asks first, names the consequence, and **names "Left the team" as
      the alternative** — because a leader reaching for it usually means "she left" rather than
      "she was never here".
- [ ] Removing a roster row leaves the team, its 13 events and any follow-ups **intact**. Proved
      against the database by `tests/routes/youthRoster.test.ts` and
      `tests/rls/activity-roster.test.ts`; do not paste `fetch` calls into a console for it.
- [ ] Signed in as **`ym-secretary`** (`org_secretary` — holds `youth_activities.view` and `.log`,
      **not** `.manage`), the roster controls and the "Somebody wasn't there?" link are **absent**
      — not present-and-failing. The roster itself is still **readable**: the four names and
      "Who is on this" are there, and **"I'll go" is there too**, because that is `.log` and they
      hold it. An account was added to the seed on 2026-08-31 so this can actually be walked; it
      could not be before.

## Walkthrough record

### 2026-08-31 — driven by Claude (agent), screenshots for human review

Seeded and walked against the hosted project on `localhost:3000` as `ym-president`, with every
write read back through a service-role client. Evidence in `walk-062/` (excluded from git).

**Ground truth at walk time** — ward zone `America/Denver`, now `2026-08-31 16:40 MDT`.
`MAYA_LEFT_ON` = `TYLER_JOINED_ON` = `2026-08-07`; G05 stored `2026-08-08T01:30Z`, i.e.
**2026-08-07 19:30 in the ward's zone**, which is the UTC trap this scenario exists for.

**Observed values, not "passed":**

| Young person | Pill | Tooltip |
|---|---|---|
| Ethan Brooks | 83 % | "Somebody went to 4 of 5 home games played, and somebody is going to the next one." |
| Josh Kim | 71 % | "Somebody went to 4 of 6 home games played, and somebody is going to the next one." |
| Maya Alvarez | 75 % | "Somebody went to 3 of 4 home games played." |
| Tyler Nash | 75 % | "Somebody went to 2 of 3 home games played, and somebody is going to the next one." |

- **The boundary game holds.** G05's card names all four — "Ethan Brooks, Josh Kim, Maya Alvarez,
  Tyler Nash". G01–G04 name three without Tyler; G06 onward name three without Maya. The
  inclusive boundary is correct in both directions on a 7:30pm game west of UTC.
- **Twelve cards, not forty-eight**, on `/youth/profiles` and on an expanded `/youth` card.
- **G08** carries exactly one chip, "Ethan Brooks is not taking part", and its expected list is
  "Josh Kim, Tyler Nash". No chip for anybody else.
- **Step 8/9 — only Josh moved.** Josh 71 % → **57 %**, tooltip's second clause flipping to
  "nobody is down for the next one" (his next expected game moved from G09 to G12). Ethan 83 %,
  Maya 75 %, Tyler 75 % all unchanged.
- **Step 10 — cleared means gone.** `activity_event_participation` went 2 rows → 1 row; only
  Ethan/G08 remains. Josh's pill returned to 71 % with the tooltip restored word for word.
- **Audit** row written: `youth_activity_participation_recorded`, module `youth_activities`,
  detail `{eventId, memberId, profileId, eventTitle: "Basketball G09", memberName: "Josh Kim",
  takingPart: false}`.
- **Cross-org (`yw-president`)**: roster controls present on the activity card (Add a young
  person / Left the team / Change the date / Still on the team / Remove); **`Edit` and `Close the
  season` absent** from that card. The `Edit` that remains on screen is on event cards, whose
  writes are ward-wide by migration 019.
- **Failure paths**: leaving date `2026-07-01` on Tyler (joined `2026-08-07`) → alert *"They
  cannot leave the team before they joined it."*, `started_on` unchanged in the database. The
  Remove confirm reads *"Take Tyler Nash off this activity? It will be as though they were never
  on it, and their games stop counting towards how well they are supported. If they left part-way
  through a season, use "Left the team" instead so the games they did play still count."* —
  cancelled, and the roster was unchanged afterwards. The picker offers nobody, so the duplicate
  409 is unreachable by hand as the scenario says.
- **375px**: no horizontal overflow on `/youth` or `/youth/profiles` (scrollWidth 360 =
  clientWidth 360); no raw uuid rendered; every `button` ≥ 44px (the sub-44 hits are inline `<a>`
  text links, as elsewhere in the app). No console errors other than the deliberate 400. **No
  React #418 and no date drift** — every time rendered 7:30 PM in the ward's zone.

**One defect found — see `walk-062/review.html`.** An expanded `/youth` card lists the **team's**
schedule rather than the young person's, because `EventList` filters on `profileIds` and never on
the roster window. Maya's card therefore reads "0 events coming up" on the pill row and
"**Maya Alvarez (4 upcoming events)**" as the heading immediately below it — 12 with past shown,
seven of them after she left. Same card, two numbers, and it is the ITER-022 count-and-list shape
that `YouthOverview.tsx`'s own comment at the `profileIds` build site says it is honouring.

**All six judgement questions answered by the user the same day, all clean** — see the ticked
boxes above for the wording each one settled. No copy defect was found anywhere in this slice,
which has not happened before in Phase 8. The Q6 answer is load-bearing for the defect: a youth
who left mid-season **keeps** their card and their frozen number, so 062-D1 is a bug about the
list under that card and never a reason to hide the person.

**Checklist corrections made during this walk:**

1. **Step 7 rewritten.** It said to find G08 on `/youth/calendar`; that page is upcoming-only by
   design (`ActivityCalendar.tsx` says so in its header) and G08 is past, so the step was
   unwalkable. It now names the expanded card and the event detail page.
2. **The "12 cards" check rewritten.** It asserted twelve cards on `/youth/calendar`, which shows
   **4** for the same reason. The twelve-versus-forty-eight fact is real and was verified — on
   `/youth/profiles` and the expanded card — so the check moved there and the calendar's own
   number is stated as 4-not-16.

**Not walked, and why:**

- **The `org_secretary` failure check.** The seed creates `bishop`, `ym-president` and
  `yw-president` only, so there is no such account to sign in as. The permission matrix does say
  `ORG_SECRETARY_PERMISSIONS` holds `youth_activities.view` and `.log` and **not** `.manage`
  (`lib/auth/permissions.ts`), which is what the check depends on — but that is reading the code,
  not walking the screen. Either add the account to the seed or drop the line to the tests.
- **The duplicate-roster 409 and the "removal leaves events intact" check**, both of which the
  scenario itself assigns to `tests/routes/youthRoster.test.ts` and
  `tests/rls/activity-roster.test.ts` rather than to a browser.

**Failed as written, and NOT corrected — it needs a decision:** *"The four percentages differ
from one another"*. Maya and Tyler both land on **75 %** (3/4 each, by different routes). The
app's arithmetic is right in both cases and was verified independently against
`buildSupportEvents`/`activitySupport`; the seed simply does not produce four distinct values,
because its comment reasons about the history half only and does not account for the next-event
half — which Maya has none of, her window having closed. Reshaping the spread is a change to what
this scenario proves, so it is left for the user. See the review page for the proposed fix.

> **Superseded the same day — see the second record below.** The user approved the fix, the seed
> gained a thirteenth game, and the four now read 71 / 63 / 75 / 60. Every count in the sections
> ABOVE this line is what a twelve-game seed produced and is left as the record of that walk.

### 2026-08-31 (later) — defect fixed, seed reshaped, re-verified by Claude

Everything the first record left open was closed on the same day, on the user's instruction.

**Defect 062-D1 — FIXED.** `EventList` gained an optional `memberId`, and when it is set the list
narrows to the young person's roster window as well as to their activities, through the same
`memberIsExpectedAt()` the percentage is built from — the window rule is called, never restated,
so the count and the list cannot drift apart again. `YouthOverview` passes it; `/youth/profiles`
does **not**, because there the unit is the TEAM and its whole schedule is the right answer.

Verified on screen after a re-seed:

| Where | Before | After |
|---|---|---|
| Maya's card, upcoming | "(4 upcoming events)" beside a pill saying "0 events coming up" | **"(0 upcoming events)"**, empty list, and the existing sentence *"Nothing coming up for this young person. Show past events, or add one from the activities page."* |
| Maya's card, past shown | "(12 events)" — the whole team season | **"(5 events)"** — G01…G05, her window exactly, boundary game included |
| `/youth/profiles` | "Schedule (13 events)" | **unchanged**, all thirteen |

**AND IT HAD A SECOND SITE, found by asking where else the same shape lived rather than by
another walk.** `/youth/history/[member_id]` built its rendered list with
`events.filter((event) => event.profileId === profile.id)` — the TEAM's schedule — while the
percentage beside it went through `buildSupportEvents()`, which applies the window. The comment
directly above it claimed the opposite in as many words: *"AND IT IS NOW A SNAPSHOT OF **THEIR**
SEASON RATHER THAN THE TEAM'S"*, which was true of the number and false of the list. Fixed the
same way, by calling `memberIsExpectedAt()` in the filter. **Scenario 062 could not have caught
it**, because it seeds no closed season — the page only renders those.

Verified by closing the Varsity basketball season through the UI and reading both history pages:

| Young person | Renders | Why |
|---|---|---|
| Maya (left on G05's day) | **5 events** — G01…G05, "75% · somebody went to 3 of 4" | her window ends at the boundary game |
| Tyler (joined on G05's day) | **5 events** — G05, G06, G06B, G07, G08, "50%" | his window *starts* at the boundary game and is truncated by the closing instant, so G09–G12 are out |

Two different five-event lists from one thirteen-game season is what says the filter is per
person and per closing instant rather than accidentally right. **The `060-D2` lesson applied
before it cost anything:** leaving one of two identical paths is how a defect comes back.

`tests/components/youth/EventListMemberWindow.test.tsx` pins it — six assertions covering the
leave, the join, the inclusive boundary on a 7:30pm game west of UTC, a closed season through the
same call, the heading count following the list, and **the un-narrowed branch** that
`/youth/profiles` depends on. **Proved able to fail before being believed:** with the window
filter disabled, five of the six go red and the un-narrowed one stays green, which is exactly the
split that says the suite is testing the filter rather than the fixtures.

*One thing worth keeping:* the closed-season fixture was wrong on the first run and the test
caught it. A `closedAt` of `2027-02-11T00:00:00Z` sits BETWEEN the boundary game's 7:30pm Denver
start and the UTC midnight after it, so the game really was after the close. `closedAt` is an
**instant** compared directly, never a day — the trap is that a date-shaped string reads like a
day to whoever writes the fixture.

**The percentages tie — FIXED.** The seed gained **G06B**, a past home game at day −17 with **no
attendee**, which is the only shape that separates Maya from Tyler without pushing anybody to
0 % or 100 %. It falls after Maya's window and inside Tyler's, so it lengthens his denominator
alone. Read back from the database through the real library functions and then confirmed on
screen: **Ethan 71 %, Josh 63 %, Maya 75 %, Tyler 60 %** — four distinct values, none at either
extreme. The seed comment now spells out that the pill is not the history half alone, which is
the mistake that produced the tie.

**The `org_secretary` check — NOW WALKABLE, and walked.** `ym-secretary` (Dale Whitmore) was added
to the seed. Signed in as them, `/youth/profiles` renders the roster and the four names, and
**"Add a young person", "Left the team", "Change the date", "Still on the team", "Remove from this
activity", "Somebody wasn't there?", "Edit" and "Close the season" are every one of them absent** —
the activity card has zero buttons. **"I'll go" is present**, which is correct rather than a leak:
that is `youth_activities.log` and an `org_secretary` holds it.

**The audit-detail contradiction — SETTLED IN THE README.** `testing/README.md` said an audit row
must carry "never a member's name", which no route has obeyed since `youth-h` and which
contradicts the reasoning written into
`app/api/youth/events/[id]/participation/route.ts`. The README was what changed: ids are required,
a short human-readable description is welcome, and what must never appear is a **secret** (rule 8)
or the text of a private note (rule 5).

**Still assigned to tests rather than to a browser**, unchanged and correct: the duplicate-roster
409 (the picker offers nobody, so it is unreachable by hand) and "removing a roster row leaves the
events intact".

## Notes

- **The four percentages are functions of the clock**, so they change with the seed date. Do not
  write an expected number into this file — what matters is that they **differ**, that the
  denominators respect the windows, and that only one moves in step 9.
- The **away** games (G02, G07, G11) and the **cancelled** one (G10) carry no coverage expectation
  by design. They are in the seed so the exclusions that already existed are visible beside the new
  one, not because anything about them changed.
- `/youth/calendar`'s young-person filter is now an **activity** filter, and its label says so. A
  card there is one team's game and singles nobody out, so narrowing to a single young person is
  deliberately not offered — `/youth` is where one young person is the unit.
