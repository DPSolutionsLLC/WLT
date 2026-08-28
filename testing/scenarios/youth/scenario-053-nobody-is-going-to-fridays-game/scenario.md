---
name: Nobody is going to Friday's game
scope: youth
part: 4
tags: [youth, full, coverage, permissions]
prerequisites: none
---

## Purpose

Coverage is the whole claim of slice C, and it is **a function of the clock**. Which means the
seed has to place events at *specific distances* from now — three days, twenty days, three days
in the past — and a tester cannot do that by hand without arithmetic they will get wrong. Getting
it wrong produces a run that passes for the wrong reason.

It also walks the **two permission gates**, which is the highest-risk surface in the slice.
Putting yourself down needs only `youth_activities.view`; asking somebody else is bishopric-only.
That is three controls behind two gates, and `youth-a-D1` and `visits-d` both shipped a control
the API then refused — twice, the same defect, in two different modules. RLS refused it safely
both times and a leader was still invited through a locked door.

The unit tests pin the arithmetic (`tests/lib/youthCoverage.test.ts`) and the gates
(`tests/routes/youthAttendance.test.ts`, `tests/rls/activity-attendees.test.ts`). What none of
them can answer is whether the uncovered event is **actually the loudest thing on the page**, and
whether a leader reading it in a hurry can tell what to do about it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…` (bishop), `ym-president@…` (Young Men president), `rs-president@…` (Relief Society president), `ward-council@…` (ward council member, **no organization**) |
| Households | Brooks (2201 Canyon Road), Chen (418 Meadowlark Lane) |
| Members | 2 youth — Ethan Brooks (Young Men), Ava Chen (Young Women) |
| Activity profiles | 2 — *Varsity basketball* (Young Men), *Concert choir* (Young Women) |
| Events | 6, placed relative to the seed time — see below |
| Attendees | 1 (`ym-president` on the +3-day concert) |

The six events, and what each must read:

| Event | When | Type | Attendee | Must read |
|---|---|---|---|---|
| Game against Roosevelt | +3 days | home | none | **Nobody going** |
| Winter concert | +3 days | home | `ym-president` | **Covered · 1** |
| Game against Jefferson | +20 days | home | none | **Nobody yet** — *not* uncovered |
| Game at Madison | +3 days | away | none | **Away — awareness only** |
| Regional choir festival | +3 days | tbd | none | **Home or away?** |
| Game against Washington | +3 days | home, **cancelled** | none | **no badge at all** |

**Sign in with:** `ward-council@harness.wardleadershiptools.test` first, then
`bishop@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-053-nobody-is-going-to-fridays-game`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ward-council@…` and open **/youth/calendar**. Read the count strip at the top
   before reading anything else.
4. Read each of the six cards and check its badge against the table above.
5. Look for an **"Ask someone to go"** control anywhere on the page or on `/youth`. There must not
   be one.
6. Open **/youth**. Tap **I'll go** on *Game against Jefferson* (the +20-day one) and watch its
   badge change **without reloading**. It should go *Nobody yet* → *Covered · 1*.
   **The uncovered strip does not change, and must not** — that event is beyond the notice window,
   so it was never part of the uncovered count. CORRECTED 2026-08-28: this step used to claim the
   strip changed here, which is unreachable.
7. Tap **I can't after all** on the same event.
8. Now the strip. Tap **I'll go** on *Game against Roosevelt* (the +3-day uncovered one), then
   open `/youth/calendar`. The strip must be **gone entirely** — zero renders nothing. Tap
   **I can't after all** again to restore the seeded state.
9. Sign out. Sign in as `bishop@…`, open **/youth**, and use **Ask someone to go** on *Game
   against Roosevelt* to assign `rs-president`.
10. Confirm the notification landed. **The bell in the header is an inert placeholder until Phase
    11** (`components/layout/NotificationBell.tsx` says so in its first line), so there is nothing
    to open — read the `notifications` table instead, filtered to
    `trigger_key = 'youth_support_assigned'`. CORRECTED 2026-08-28: this step used to say "open
    the notification bell", which the app cannot do yet.
11. **Now let the clock argue.** In Supabase, change *Game against Washington*'s `event_date` to
    three days in the **past**. Reload `/youth`. It leaves the default upcoming-only view, so
    press **Show past events** to find it.
12. Do the same to *Regional choir festival* (which reads *Home or away?*) — that proves the
    "past" branch independently of the "cancelled" one.
13. Narrow the calendar filters: one youth, then one organization, then home-only, then away-only.
    Watch the count strip beside the list each time.
14. Read the whole page at 375px, in both themes.

## Verification Checklist

### Machine-checkable

- [ ] The banner reads a **sentence that names the events**, not just a count — "1 home event in
      the next week with nobody going: Game against Roosevelt, Mon 31 Aug, 7:00 PM." CHANGED
      2026-08-28: a bare count made the reader hunt through six cards for the one it meant.
- [ ] The uncovered card carries a **red left edge**, so it is findable without reading. Every
      other card has a transparent edge of the same width, so nothing shifts.
- [ ] Each of the six events carries exactly the badge in the table above.
- [ ] The **+20-day** home event reads *Nobody yet*, **not** *Nobody going*.
- [ ] The away event carries **no warning tone**, at any distance.
- [ ] The cancelled event shows **no coverage badge at all**, and **is** still counted in
      "Schedule (N upcoming events)" on `/youth`.
- [ ] After moving the cancelled event into the **past**, it still shows no warning — *the user's
      rule, and the reason `cancelled` is tested before the clock in `coverage.ts`*.
- [ ] Tapping **I'll go** on the +20-day event changes its badge from *Nobody yet* to
      *Covered · 1* **with no reload**, and leaves the uncovered strip alone.
- [ ] Tapping **I'll go** on the +3-day **uncovered** event removes the strip from
      `/youth/calendar` entirely on the next visit — zero renders nothing at all.
- [ ] Tapping **I can't after all** puts both back.
- [ ] `ward-council@…` is **not shown** an assign control anywhere — absent, not
      present-and-refusing.
- [ ] `rs-president` receives **exactly one** `youth_support_assigned` notification, and its body
      names the event, the youth (Ethan Brooks) and the activity (Varsity basketball). Read it
      from the `notifications` table — the bell is a Phase 11 placeholder.
- [ ] `ym-president` and the other leaders receive **none** — the seeded `default_roles` for that
      trigger would have reached all of them.
- [ ] `ward-council@…` is refused by the **API** as well as the UI: `POST` and `DELETE` on
      `/api/youth/events/[id]/assign`, and `PUT` on `/api/ward-settings/home-venues`, all answer
      403 with a sentence, and change nothing. ADDED 2026-08-28 — `ward_council_member` holds
      `youth_activities.manage`, so the permission alone would let it through; only the bishopric
      check stops it, and no automated test covered this role.
- [ ] After the assignment, the card reads "Going: Nora Whitfield · asked by Marcus Reyes" — a
      volunteer and an assignee are visibly different.
- [ ] `audit_log` holds `youth_activity_attend`, `youth_activity_unattend` and
      `youth_activity_assigned` rows.
- [ ] Filtering to one organization changes the list **and** the count beside it together.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] Is the **+3-day uncovered event visually the loudest thing on the page**? Not merely
      differently coloured — actually the thing your eye lands on first. *(Walked 2026-08-28: it
      was NOT. The banner was noticed first and the card took close reading to find. The named
      banner and the red card edge are the fix; this line is what re-checks it.)*
- [ ] Does the count strip read as *something to do* rather than as a status line?
- [ ] With zero uncovered events the strip renders **nothing at all**. Does its absence read as
      "all good", or as something that failed to load?
- [ ] Does *Away — awareness only* read as a deliberate design rather than as a missing feature?
- [ ] Does *Home or away?* clearly read as something a person is expected to come back and settle?
- [ ] On a cancelled game, is the absence of a coverage badge readable — or does the row look
      unfinished?
- [ ] At `md:` and up the month grid appears. Does it add anything the card list did not, or is it
      decoration?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Tapping **I'll go** twice quickly writes **one** row and the second tap says "You are already
      down for this one." — a plain sentence, not an error.
  Automated: `tests/routes/youthAttendance.test.ts` → *"answers a second self-add with a sentence
  and no second row"*.
- [ ] With the dev server stopped mid-tap, the control shows a sentence rather than failing
      silently.
- [ ] Assigning somebody already down for the event says so rather than erroring.
- [ ] A filter combination that matches nothing shows *"Nothing matches those filters"* rather than
      an empty page.

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every value below was read back with the SERVICE CLIENT, never from the screen alone. Machine
zone America/Denver; the seed placed events at +3.54d, +3.66d, +3.71d (×3) and +20.71d from
`now = 2026-08-28T08:04:28Z`.

**Every coverage badge is correct**, checked against the stored row rather than against the seed
script:

| Event | stored | days out | attendees | badge on screen |
|---|---|---|---|---|
| Regional choir festival | `tbd`/upcoming | +3.54 | 0 | Home or away? |
| Winter concert | `home`/upcoming | +3.66 | 1 | Covered · 1 |
| Game against Roosevelt | `home`/upcoming | +3.71 | 0 | Nobody going |
| Game at Madison | `away`/upcoming | +3.71 | 0 | Away — awareness only |
| Game against Washington | `home`/**cancelled** | +3.71 | 0 | **none**, plus a Cancelled chip |
| Game against Jefferson | `home`/upcoming | +20.71 | 0 | Nobody yet |

- **The strip.** "1 home event in the next week with nobody going." — a sentence, in the danger
  tone, above an amber "1 event still needs somebody to say whether it is home or away."
- **Attending, without a reload.** *Game against Jefferson*: badge went *Nobody yet* → *Covered ·
  1*, "Going: Diane Okafor", button flipped to "I can't after all". Row stored with
  `assigned_by = NULL` (a self-add), audit row `youth_activity_attend`, **no notification** —
  correct, a season has twenty games. "I can't after all" removed the row and wrote
  `youth_activity_unattend`.
- **Zero renders nothing.** Attending *Game against Roosevelt* (the uncovered one) removed the
  strip from `/youth/calendar` **entirely**; it did not become "0 uncovered".
- **The cancelled event is counted in "upcoming".** `Schedule (6 upcoming events)` with one of the
  six cancelled. Switching to past events changes the heading to `Schedule (6 events)`.
- **The user's rule, both directions.** Moved *Game against Washington* to three days in the PAST:
  it still shows only *Home* and *Cancelled*, no coverage badge. Then moved *Regional choir
  festival* (a loud *Home or away?*) into the past too: its coverage badge disappeared as well,
  proving the "past" branch independently of the "cancelled" one.
- **The two gates, from both sides.** `ward-council@…` (`ward_council_member`, no organization):
  no Home venues panel, **no "Ask someone to go" anywhere**, 6 × "I'll go". `bishop@…`: panel
  present reading "1 place: lincoln high school.", and 6 × "Ask someone to go".
- **The API agrees with the UI.** As `ward_council_member`: `POST` and `DELETE`
  `/api/youth/events/[id]/assign` → 403 *"Asking somebody else to attend is a bishopric decision.
  You can add yourself to any event."*; `PUT /api/ward-settings/home-venues` → 403 *"Only the
  bishop and his counselors can change which places count as home."* `home_venues` was unchanged
  afterwards and the existing assignment survived. As `org_president`: the same 403.
- **The assignment.** Bishop assigned `rs-president`. Card read **"Going: Nora Whitfield · asked by
  Marcus Reyes"** and a "Withdraw the request to Nora Whitfield" control appeared. Audit row
  `youth_activity_assigned`. **Exactly one notification existed in the whole ward**, to Nora
  Whitfield: *"Game against Roosevelt — Ethan Brooks, Varsity basketball, Mon, 31 Aug 2026, 19:00
  at Lincoln High School gym."* Miguel Cortez and the other org leaders received none, which is
  what the seeded `default_roles` would have done.
- **Filters narrow list, count and strip together.** Unfiltered 6/6 with the strip; Ava Chen 2/2
  no strip; Young Men 4/4 with strip; home-only 4/4 with strip; away-only 1/1 **no strip**;
  performance 2/2 no strip; academic 0/0 with *"Nothing matches those filters."*
- **375px.** No horizontal overflow (scrollWidth 360 = clientWidth). Every `<button>` ≥44px high.
  The month grid is correctly hidden below `md:`. Dark mode legible throughout.

Corrections made to this file during the walk:

1. **Step 6 claimed the count strip changes when you attend the +20-day event.** It cannot: that
   event is `unassigned`, beyond the notice window, and was never part of the uncovered count. The
   step now says so, and a new step 8 exercises the strip with the event that *is* uncovered.
2. **Step 9 said "open the notification bell".** The bell is an inert placeholder until Phase 11 —
   `components/layout/NotificationBell.tsx` says so in its first line. The step now reads the
   `notifications` table, which is where the fact actually lives.
3. **Added an API-refusal line for `ward_council_member`.** That role holds
   `youth_activities.manage`, so the permission check alone would admit it; only the bishopric
   check refuses. No automated test covered that role, and this walk did.

**One defect found, not fixed** — see `walk-youth-c/REVIEW.md`: `listActivityEvents` orders only
by `event_date`, with no tiebreaker, so events sharing an instant reorder whenever any of them is
edited. Reproduced: order was `Madison > Roosevelt > Washington`; after a no-op `UPDATE` on
Madison it became `Roosevelt > Washington > Madison`. Pre-existing from slice A, made more
visible by slice C. `lib/youth/attendees.ts` and `lib/visits/participants.ts` both guard against
exactly this with a secondary `.order("id")`.

Not walked: every "needs a human eye" line — those are the review questions, and they are in
`walk-youth-c/REVIEW.html` with screenshots.

### 2026-08-28, later — the review answers, and what changed

The reviewer answered the judgement questions. **The uncovered event was NOT the loudest thing on
the page**: the banner was noticed first, and finding which of the six cards it meant took close
reading. Two changes, both re-verified in the browser afterwards:

- **The banner names the events**, up to three. Observed: *"1 home event in the next week with
  nobody going: Game against Roosevelt, Mon, Aug 31, 7:00 PM."*
- **The uncovered card carries a red left edge** (`COVERAGE_EDGE_CLASSES`, the pattern
  `components/visits/ReportTile.tsx` uses for an unread report). Verified only *Game against
  Roosevelt* carries it; the other five have a transparent edge of the same width, so nothing
  shifts.

Also from the same review, affecting this scenario:

- **`EVENT_TYPE_LABELS.tbd` is now "Home or away not set"**, because "Not yet known" did not say
  *what* was not known. And a `tbd` card no longer shows two chips for one fact — verified the
  *Regional choir festival* card now renders only *Home or away?*.
- **Home venues keep the ward's own capitals.** The seed writes `["Lincoln High School"]` and the
  panel reads back *"1 place: Lincoln High School."* A location typed
  `lincoln high school GYM` still classified `home` against it, so the fold at comparison time
  works end to end.

The event-ordering defect was reviewed and **deliberately left alone**.

## Notes

- **Why the cancelled event is counted in "upcoming".** A cancelled game can be reinstated, so it
  stays in the schedule a leader is looking at. What must be true is only that it never registers
  as *unattended* — which is a rule in `lib/youth/coverage.ts`, tested in both directions. This was
  decided rather than overlooked; the `youth-a` retro left it open by name.
- **The reader's own zone decides which day a card sits under** on the month grid, matching the
  time printed on the card. The ward's zone decides what a *floating imported time means* and
  nothing else — see `ActivityCalendar.tsx`'s header. If a card ever appears under a different day
  from the one its own text names, that is the bug.
- Nothing in this scenario imports anything. Classification is scenario 054.
