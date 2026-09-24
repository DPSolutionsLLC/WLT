---
name: Everything I've said I'll be at
scope: P5
part: 3
tags: [appointments, visits, youth, todos, full, P5]
prerequisites: none
---

## Purpose

My Appointments merges three modules into one list, with times on the ward's clock, grouped by
day. Every other day is shaded, each day collapses, and the page reopens as it was left. The
evening-event zone defect only shows up when a real evening time is seeded: 7:30 PM Friday in
Denver is Saturday in UTC. The same slice adds **Schedule this** to a to-do, which reads a typed
day and time as the ward's clock and offers any member of the ward.

The pure rules are already covered in Vitest:
- `tests/lib/myAppointments.test.ts`: order, the past most recent first, nothing dropped, and the
  all-day zone trap
- `tests/lib/todoScheduleInstant.test.ts`: ward wall clock ↔ instant
- `tests/routes/myAppointments.test.ts`: the three reads, per person, cancelled items excluded
- `tests/routes/todos.test.ts`: scheduling and unscheduling write their timeline lines
- `tests/lib/appointmentsView.test.ts` and `tests/routes/page-view.test.ts`: the remembered view,
  and that saving it keeps every other setting
- `tests/lib/todoViewState.test.ts`: a scheduled to-do's state follows its ward day

This walk checks what those tests cannot: the rendered times, the toggle, the inline actions and
the links.

## Seed Data

Dates are relative to **today in America/Denver**; the seed prints which day and which Friday it
used.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop@harness.wardleadershiptools.test` (bishop, Mark Andersen); `eq-president@harness.wardleadershiptools.test` (Elders Quorum president, Miguel Cortez) |
| Household / member | Okafor family; Samuel Okafor, in the Elders Quorum; Grace Nguyen, in **no organization** |
| Visit appointments (president's) | Tomorrow 7:00 PM **scheduled**; 7 days ago 7:00 PM **kept**; in 3 days **cancelled** |
| Visit appointment (bishop's) | Tomorrow 6:00 PM, made by the bishop |
| To-dos (president's) | "Call the stake clerk", **today 12:05 AM** (already passed); "Drop off the moving boxes", next Friday 7:30 PM, with Samuel Okafor; "Meet about the quorum budget", 6 days ago 10:00 AM, not done; "Order new hymnbooks", never scheduled |
| Youth events the president signed up for | "Varsity basketball vs Roosevelt", next Friday 7:30 PM; "Regional volleyball tournament", 8 days ago, **all day**; "Rained-out soccer game", in 2 days, **cancelled** |

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- todos/scenario-077-everything-ive-said-ill-be-at`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the president. On the dashboard, open **My Appointments** (Tasks & Communication).
4. Read the upcoming list. Press **Show past (3)**.
4a. Press today's day heading to collapse it. Press **Collapse all**, then open one Friday day.
    Reload the page. Sign out and back in, and open My Appointments again. Press **Expand all**.
5. Press each row's link once and come back: a visit, a to-do and the youth game.
6. On the Okafor visit tomorrow, press **Cancel** and confirm.
7. On "Drop off the moving boxes", press **Unschedule**.
8. Open **To Do**. On "Order new hymnbooks", press the **Schedule** icon, choose next Friday at
   6:15 PM with **Grace Nguyen**, add the note "Bring the receipt", and press **Schedule**.
9. Open the card and read its timeline. Return to **My Appointments**.

## Verification Checklist

### Machine-checkable

- [ ] Step 3: the dashboard's Tasks & Communication section shows a **My Appointments** tile
- [ ] Step 4: upcoming is grouped under day headings, today's reading "Today · …", and every other day sits on a shaded band. Rows show only the time
- [ ] Step 4: today holds "Call the stake clerk" at 12:05 AM, **greyed** but still in upcoming, not in past
- [ ] Step 4: after it, in time order, the Okafor visit (tomorrow 7:00 PM), then "Drop off the moving boxes" and "Varsity basketball vs Roosevelt" (both next Friday **7:30 PM**, not Saturday 1:30/2:30 AM)
- [ ] Step 4: the to-do row reads "With Samuel Okafor"
- [ ] Step 4: neither cancelled item appears, and neither does the bishop's 6:00 PM visit, nor "Order new hymnbooks"
- [ ] Step 4: past is hidden as **Show past (3)**. Opened, it is grouped by day, most recent first: "Meet about the quorum budget", then the kept Okafor visit (marked **Kept**), then the tournament reading "All day" under the right day's heading, not "12:00 AM"
- [ ] Step 4a: a collapsed day shows its heading and a count, and hides its rows. After Collapse all plus one day opened, a reload and a fresh sign-in both reopen it exactly that way (and with the past showing, if it was). `users.settings.page_views.appointments` holds the view, `quick_links` is untouched, and one `page_view_saved` audit row appears per burst of clicks, not per click
- [ ] Step 4a: Expand all opens every day again
- [ ] Step 5: the visit row opens `/visits`, the to-do row opens `/todos` scrolled to that card, and the game row opens `/youth/events/<id>`
- [ ] Step 6: the visit leaves the list. In the database it has `status = 'cancelled'` and still exists
- [ ] Step 7: the to-do leaves the list. On `/todos` it is still open, with no "Scheduled" line, and its timeline has an `unscheduled` line; `scheduled_with_member_id` is null
- [ ] Step 8: the picker offers Grace Nguyen, who is in no organization. The chosen member's chip carries a ×, and there is no separate "Nobody in particular" link
- [ ] Step 8: the card shows "Scheduled <next Friday>, 6:15 PM · with Grace Nguyen" under an **Upcoming** pill, not "Someday". In the database `scheduled_for` is 6:15 PM **Denver** time
- [ ] "Meet about the quorum budget" (scheduled 6 days ago, not done) reads **Overdue** on `/todos`
- [ ] Step 9: the timeline shows "Scheduled" followed by the note "Bring the receipt"; My Appointments now lists "Order new hymnbooks" at 6:15 PM
- [ ] The **Google Calendar** card's button is disabled, and the note says why
- [ ] At 375px: no horizontal overflow on `/appointments`. The To Do card's Schedule and Edit are **icons** (with ✕), each a 44px target, on one row, and no title is squeezed to a word per line or overlaps a button
- [ ] Dark mode: row text, pills and the disabled button stay legible
- [ ] No raw uuid on screen
- [ ] **Against production, once:** the deployed build shows the same times as local (the zone defect was invisible in dev)

### Needs a human eye

- [ ] Does the list read as "everything I've said I'll be at"? Is it clear which rows are visits, to-dos and youth events without reading the kind pill?
- [ ] Is "Show past (3)" the right weight: findable but not competing with the upcoming list?
- [ ] Are the shaded day bands enough to see where one day ends and the next begins, without being loud? And does a greyed row read as "this has happened today" rather than as disabled?
- [ ] Are the Schedule and Edit icons recognisable without their words?

## Failure Behavior

- [ ] If remembering the view fails, a sentence appears under Expand all / Collapse all and the page keeps working.

- [ ] A failed Cancel or Unschedule shows the route's sentence beside that row and leaves the row in place.
- [ ] If the schedule saves but the note does not, the window says "It is scheduled, but the note was not saved." and the card shows the schedule. Hard to force by hand; the two writes are separate by design.

## Walkthrough record

**2026-09-24: driven by an agent** (Claude, Playwright against `npm run dev` on :3000, as the
president), with the judgement checks handed to the user as screenshots on one review page. This
is not yet a person using the app. Evidence is in `.walk077/` (git-excluded).

**Observed:**
- Upcoming: "Fri, Sep 25, 2026, 7:00 PM · Visit — Okafor family", then "Drop off the moving
  boxes" and "Varsity basketball vs Roosevelt", both **Fri, Sep 25, 2026, 7:30 PM**. "With Samuel
  Okafor" on the to-do.
- Absent, as intended: both cancelled items, the bishop's visit, and "Order new hymnbooks".
- Past (3), most recent first: the budget meeting (Sep 18, 10:00 AM), the kept visit (Sep 17,
  7:00 PM, **Kept**), and "Wed, Sep 16, 2026 · All day".
- Links go to `/visits`, `/todos#todo-…` (that card visible) and `/youth/events/…`; the event
  page reads the same 7:30 PM.
- Cancel: the row is kept with `status = cancelled`, plus an `appointment_cancelled` audit row.
- Unschedule: `scheduled_for` and `scheduled_with_member_id` are null, the to-do is still open,
  and there is one `unscheduled` line.
- Schedule on Sep 25 at 18:15 with Samuel: stored as `2026-09-26T00:15Z` (6:15 PM Denver). The
  timeline shows `scheduled`, then the note. Audit details carry ids and field names only.
- No overflow at 375px, no uuid on screen, no tap target under 44px, and dark mode is legible.

**Defects:**
- **077-D1:** at 375px the three-button group (199px of a 328px card) squeezes to-do titles to
  ~36px. They wrap a word per line, and one overlaps the Schedule button.
- **077-D2:** a scheduled to-do with no do or due date reads **Someday** beside its scheduled time,
  because `todoViewState()` ignores `scheduledFor`.

**Checklist and seed corrections:**
- The seed put Samuel in no organization, so the picker (own-organization default for org leaders)
  showed "There are no members in the roster yet." Samuel is now in the Elders Quorum. Whether the
  picker should offer the whole ward here is an open question for the user.
- The line "the To Do card's button group stays on one row" could pass while the title was crushed
  (D1). It now also requires the title to keep a readable width.

**Not walked:** the production check. The slice is not deployed.

**2026-09-24, round 2: driven by an agent again**, after the user's decisions on round 1:
- D1: icon-only Schedule and Edit buttons.
- D2: the scheduled day counts like a do date.
- The picker offers the whole ward.
- The redundant "Nobody in particular" link is removed.
- The list is grouped by day, with alternating bands and collapsible days.
- Past only once the ward day has ended, greyed once its time has passed.
- The page reopens as it was left, stored on the account.

The seed gained "Call the stake clerk" (today 12:05 AM) and Grace Nguyen (no organization).

**Observed:**
- Upcoming: "Today · Thursday, Sep 24, 2026" (plain), holding "Call the stake clerk" 12:05 AM at
  opacity 0.6. Then "Friday, Sep 25, 2026" on the gold band (`rgb(246, 238, 221)`) with 7:00 PM,
  7:30 PM and 7:30 PM. Rows show the time only.
- Collapse today, Collapse all, open Friday, Show past: `page_views.appointments` =
  `{collapsed: true, toggledDays: ["2026-09-25"], showPast: true}`.
  - A reload and a sign-out/sign-in both reopened it identically, and the server HTML carried the
    same `aria-expanded` values.
  - Three clicks 50ms apart gave one `page_view_saved` row; four ~4s-apart clicks gave four.
- Expand all: all five days open.
- /todos at 375px:
  - Title column 102px (was 36px).
  - Schedule, Edit and ✕ are each 44×44 on one row.
  - States: Overdue (budget, scheduled 6 days ago), Do today (stake clerk), Upcoming (moving
    boxes), Someday (hymnbooks, unscheduled).
- The picker offered Grace Nguyen. Scheduled for Sep 25 at 18:15, stored `2026-09-26T00:15Z`
  (6:15 PM Denver) with her id, and the timeline shows `scheduled`, then the note. The card reads
  "Upcoming … · with Grace Nguyen".
- Dark mode: bands and greyed row legible.

**Fixed during this round:** greying applied to past timed rows but not to the past all-day row,
because an all-day item is never "started". Greying now applies to the upcoming list only.

**Walk artifact, not a defect:** one hydration warning, a `caret-color: transparent` style on the
header's Report-an-issue textarea. That is Playwright's screenshot caret-hiding, landing
mid-hydration; nothing in the appointments markup differed.

**Still not walked:** the production check. The judgement checks on the bands, the greyed row and
the icons are with the user.
