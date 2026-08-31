---
id: youth-coverage-calendar
status: best-yet
commit: f52bcaf
date: 2026-08-28
area: youth-coverage-calendar
related_retros: [youth-c-coverage-and-calendar, youth-b-ics-import]
supersedes: null
---

## What was tested

**Scenarios 053 and 054 walked by an AGENT (Claude, via Playwright) against the hosted project,
on localhost:3000. The user reviewed the walk report and answered the judgement questions, two of
which came back as defects.** No human drove the app.

**Record written 2026-08-30**, from the walkthrough records in the two scenario files and the
screenshots and `REVIEW.md` in `walk-youth-c/`. The walk happened on 2026-08-28; only this
confirmation record is late, for the reason given in `youth-ics-import-2026-08-28.md`.

**Every `event_type` and every coverage state below was read back with the SERVICE CLIENT**, never
taken from the screen, and checked against the stored row rather than against the seed script.

### What was NOT verified

- **The deployed build was not opened during this walk.** It has since been walked twice; the
  2026-08-30 look confirmed `/youth/calendar` renders correctly in production after the timezone
  fix, which is the half of this slice most exposed to it.
- **No real device.** 375px was a resized desktop viewport; tap targets were measured
  geometrically.
- **Dark mode was read from computed styles and screenshots.**
- **One defect was found and deliberately NOT fixed** — see below. It remains open by decision.
- **`yw-president`'s own session was not walked** for the venue panel; the bishopric and
  `org_president` paths were.

## Result

**Scenario 053 — coverage computed on read. Every badge correct against the stored row.**

| Event | stored | days out | attendees | badge on screen |
|---|---|---|---|---|
| Regional choir festival | `tbd`/upcoming | +3.54 | 0 | Home or away? |
| Winter concert | `home`/upcoming | +3.66 | 1 | Covered · 1 |
| Game against Roosevelt | `home`/upcoming | +3.71 | 0 | Nobody going |
| Game at Madison | `away`/upcoming | +3.71 | 0 | Away — awareness only |
| Game against Washington | `home`/**cancelled** | +3.71 | 0 | **none**, plus a Cancelled chip |
| Game against Jefferson | `home`/upcoming | +20.71 | 0 | Nobody yet |

- **Attending, without a reload.** *Game against Jefferson* went *Nobody yet* → *Covered · 1*,
  "Going: Diane Okafor", button flipped to "I can't after all". Row stored with `assigned_by =
  NULL` (a self-add), audit `youth_activity_attend`, **no notification** — correct, a season has
  twenty games.
- **Zero renders nothing.** Attending the uncovered event removed the strip from
  `/youth/calendar` **entirely**; it did not become "0 uncovered".
- **The cancelled event is counted in "upcoming"** — `Schedule (6 upcoming events)` with one of
  the six cancelled. Decided, not overlooked: a cancelled game can be reinstated.
- **The user's rule, both directions.** Moved the cancelled event three days into the PAST: still
  no coverage badge. Then moved a loud *Home or away?* event into the past too: its badge
  disappeared as well — proving the "past" branch independently of the "cancelled" one.
- **The two gates, from both sides.** `ward_council_member` (no organization): no Home venues
  panel, **no "Ask someone to go" anywhere**, 6 x "I'll go". `bishop`: panel present, 6 x "Ask
  someone to go". **The API agrees with the UI** — `POST`/`DELETE .../assign` → **403**, `PUT
  /api/ward-settings/home-venues` → **403**, and `home_venues` was unchanged afterwards.
  No automated test covered `ward_council_member` on this route; this walk did.
- **The assignment.** Bishop assigned `rs-president`; card read "Going: Nora Whitfield · asked by
  Marcus Reyes". **Exactly one notification existed in the whole ward**, to Nora Whitfield, naming
  the event, the youth, the activity, the time and the place. The other org leaders received none.
- **Filters narrow list, count and strip together** — 6/6 with strip; Ava Chen 2/2 no strip;
  Young Men 4/4 with strip; away-only 1/1 **no strip**; academic 0/0 with *"Nothing matches those
  filters."*
- **375px:** `scrollWidth 360 = clientWidth 360`. Every `<button>` >=44px. The month grid is
  correctly hidden below `md:`.

**Scenario 054 — home/away classification. The `youth-b` guarantee holds in its strongest form.**

| Check | Observed |
|---|---|
| First import, no venues configured | all 12 occurrences `tbd` — zero home, zero away |
| *Varsity Basketball at Jefferson* at *Jefferson High School* | `tbd`, **not** `away` — the rule that matters |
| Venue panel | absent for `org_president`, present for `bishop` |
| Saving `Lincoln High School` | stored `["lincoln high school"]`; `timezone` and `cross_org_visibility` **both survived** the merge |
| Saving did NOT reclassify | all 12 still `tbd`, including the 8 that now match |
| Two hand corrections | Roosevelt (at the home venue) → `away`; Jefferson → `away` |
| Re-importing the identical file | 0 to create, 0 to update, 12 already correct |
| Importing the March file | 14 rows, `{tbd: 11, away: 2, home: 1}` |
| **Jefferson still `away`** | **and its row WAS written in that import** — the strongest case in the scenario |
| Manual entry, both branches | "Decide from the location" → `home`, audit `eventTypeSource: classified_from_location`; "Not yet known" → `tbd`, audit `eventTypeSource: chosen` |
| Copy | singulars and plurals correct throughout; no `1/2/2027` anywhere |

That last pair is the whole reason `createActivityEventSchema` dropped its `.default("tbd")` — it
is what makes "the leader left it alone" distinguishable from "the leader chose Not yet known".

**Five copy defects, four found by the review and a fifth introduced by fixing the fourth and
caught by re-walking.**

1. **The uncovered event was not the loudest thing on the page.** The banner was noticed first and
   finding which of six cards it meant took close reading. The banner now **names the events** —
   *"1 home event in the next week with nobody going: Game against Roosevelt, Mon, Aug 31, 7:00
   PM."* — and the uncovered card carries a **red left edge**, the pattern `ReportTile` uses for
   an unread report. Verified only that one card carries it; the other five have a transparent
   edge of the same width, so nothing shifts.
2. **"Not yet known" did not say what was not known.** Now **"Home or away not set"**. A `tbd`
   card also no longer shows two chips for one fact.
3. **The lower-cased venue read as a bug.** `home_venues` now stores what the person typed and
   `classifyEventLocation` folds case on both sides; `lincoln high school GYM` still classifies
   `home` against a capitalised stored venue.
4. **"Home or away is left as it is" did not say instead of what**, so it read as filler rather
   than as a promise being kept.
5. **The fix for 4 produced nonsense**: *"Home or away stays Away — this file would have set it to
   **Home or away not set**."* It typechecked and broke no test — a label can be right on a chip
   and nonsense inside a clause, which is the `youth-b` failure mode exactly. The sentence is now
   built in two halves so the `tbd` label never enters one, and
   `tests/components/youth/IcsPreviewNote.test.tsx` asserts that over **every** combination rather
   than the three spelled out.

**Also verified on the re-walk:** with the venue configured **before** importing, 10 of 12 rows
arrived `home` and 2 `tbd` — classification on the way in, from a capitalised stored venue.

## The defect left open by decision

**`listActivityEvents` orders only by `event_date`, with no tiebreaker**, so events sharing an
instant reorder whenever any of them is edited. Reproduced: order was `Madison > Roosevelt >
Washington`; after a no-op `UPDATE` on Madison it became `Roosevelt > Washington > Madison`.
Pre-existing from slice A, made more visible by slice C. `lib/youth/attendees.ts` and
`lib/visits/participants.ts` both guard against exactly this with a secondary `.order("id")`.

**Reviewed and deliberately left alone.** It is recorded here rather than fixed so that a later
reader finds a decision rather than an oversight.

## Checklist corrections made during the walk

- **Scenario 053 step 6 claimed the count strip changes when you attend the +20-day event.** It
  cannot — that event is beyond the notice window and was never part of the uncovered count. A new
  step 8 exercises the strip with the event that *is* uncovered.
- **Scenario 053 step 9 said "open the notification bell".** The bell is an inert placeholder
  until Phase 11. The step now reads the `notifications` table.
- **Scenario 054 step 10 asked an identical re-import to classify new games.** Unreachable — an
  identical file creates nothing. Split into two steps, the second using
  `lincoln-basketball-march.ics`, which was added to the folder so the scenario is self-contained.
- **Three checklist lines described states the app cannot reach** and were rewritten.

## What changed underneath this record

Scenario 053's Notes bullet asserting that **the reader's own zone** decides which day a card sits
under on the month grid was **corrected on 2026-08-30**: `c24d52b` made it the **ward's** zone.
The invariant the note exists to protect is unchanged — a card is bucketed into a day in the same
zone its own time is printed in — and both halves moved together, so only the premise changed.
None of the observed values above are affected.

## What would move this to confirmed

Working the coverage flow by hand on the deployed build: read the banner, find the uncovered card
by its edge alone on a real phone, sign up, and watch the strip disappear. The event-ordering
defect should also be revisited if a ward ever schedules two events at the same instant in
practice rather than in a fixture.
