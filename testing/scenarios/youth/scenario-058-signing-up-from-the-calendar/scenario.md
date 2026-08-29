---
name: Signing up from the calendar
scope: youth
part: 8
tags: [youth, smoke, calendar, attendance]
prerequisites: none
---

## Purpose

`/youth/calendar` moved from **static server props onto the shared query cache** in this change,
and that is precisely where `youth-a-D2` lives: a Server Component prop **never refetches**, so an
attendance control on the old shape would have succeeded, invalidated two cache keys the page did
not read, and **changed nothing at all on screen**. The request goes out, the row is written, and
the badge, the edge stripe and the banner all stay exactly as they were.

A green suite cannot see that. Neither can a unit test — `tests/lib/youthCoverage.test.ts` already
pins the arithmetic and `tests/rls/activity-attendees.test.ts` the policy. The only way to find it
is to press the button and watch.

Seeding gives a calendar with three months on it and **exactly one** uncovered event, so the
banner must **disappear entirely** rather than drop from 2 to 1 — the clearest evidence available
that the page is reading the cache the mutation invalidated.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…` (bishop), `ym-president@…` (Young Men president — **the account to sign in as**), `yw-president@…` (Young Women president) |
| Households | Brooks, Chen |
| Members | 3 youth — Ethan Brooks, Maya Chen, Sofia Chen |
| Activity profiles | 3, across **two organizations** |
| Events | 14, **all upcoming**, spanning three months |
| Attendees | 2 rows, on events other than the uncovered one |

The four events that carry the whole scenario:

| Event | When | Type | Status | Must read |
|---|---|---|---|---|
| **Game against Roosevelt** | +4 days | home | upcoming | **`Nobody going`**, red edge, **named in the banner** |
| Game against Jefferson | +6 days | home | upcoming | `Covered · 1` — the comparison case |
| Away fixture at Riverton | +5 days | **away** | upcoming | `Away — awareness only`, **never in the banner** |
| Tournament, venue to be confirmed | +9 days | **tbd** | upcoming | `Home or away?`, and **All day** rather than "12:00am" |
| Game against Washington | +3 days | home | **cancelled** | **no badge**, a `Cancelled` chip, still visible |

**Every event is in the future on purpose.** The calendar reads `includePast: false`, so a past
event seeded here would simply be invisible.

**Sign in with:** `ym-president@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-058-signing-up-from-the-calendar`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president@…` and open **/youth/calendar**. Read the banner at the top before
   anything else, and note which event it names.
4. Find **Game against Roosevelt**. Press **I'll go**. Watch the badge, the card's left edge and
   the banner — **without reloading**.
5. Press **I can't after all**. Watch all three again.
6. Use the **Organization** filter, then **Kind of activity**, then clear both.
7. Follow the **young person's link** on any card.
8. Sign in as `bishop@…` and open the same page.
9. Read `/youth/calendar` at 375px, in both themes.

## Verification Checklist

### Machine-checkable

- [ ] The banner names **exactly one** event: *Game against Roosevelt*, with its date and time. It
      is a **sentence**, not a count beside a coloured dot.
- [ ] Pressing **I'll go** changes that card's badge from **Nobody going** to **Covered · 1**
      **immediately**, with no reload.
- [ ] The **uncovered edge stripe** on that card clears with the badge, in the same interaction.
- [ ] The **banner disappears entirely** — not "0 uncovered", nothing at all — because it was the
      only one.
- [ ] The network panel shows **both** `/api/youth/events` and `/api/youth/attendees` refetching
      after the write (`ATTENDEE_MUTATION_INVALIDATES`). One without the other is the bug this
      scenario exists for.
- [ ] **I can't after all** reverses all three — badge, stripe and banner — in one interaction.
- [ ] The `Going:` line under the card names the reader after signing up and is empty before.
      `AttendeeControls` renders that line itself; there is **no second copy** of it on the card.
- [ ] **Ask someone to go** is **absent** for the Young Men president — not present and refusing.
      Signed in as the **bishop**, it is present.
- [ ] The event count line above the cards matches the number of cards shown, under every filter.
- [ ] **There is no sort control on this page**, and the card list is always in date order.
      REMOVED 2026-08-29 after the walk: a sort briefly shipped here offering "Needs attention
      first", and it read as a fifth filter rather than as a different kind of control. A calendar
      has one order. The uncovered events are not lost with it — the banner **names** them.
- [ ] The page carries **exactly four** `<select>` controls: young person, organization, kind of
      activity, home or away.
- [ ] The **Organization** filter narrows to one organization's activities and the count follows.
      Clearing it restores all 14.
- [ ] The **away** game shows `Away — awareness only` and appears in the banner **never**, however
      close it is.
- [ ] The **cancelled** game is still on the calendar, carries a `Cancelled` chip and **no
      coverage badge**, and is not counted as uncovered even though it is 3 days out.
- [ ] The **tbd** tournament shows `Home or away?` and renders **"All day"**, not "12:00am".
- [ ] Every card's **young person is a link** to `/youth?youth=<profileId>`, and following it opens
      `/youth` with that card **already expanded**.
- [ ] **Back to the young people** at the top of the page goes to `/youth`.
- [ ] Both the calendar and `/youth` show the badge change — sign up on the calendar, then open
      `/youth`: the same event reads `Covered` there.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] **Does the card feel like it responded?** The badge, the stripe and the banner all change at
      once. Watch it on a phone — is the change visible, or does the eye miss it because the
      button is at the bottom of the card and the banner at the top of the page?
- [ ] Does the **young person's link** invite a tap, or does it read as decoration? A leader who
      does not know `/youth` exists is the reader this link is for.
- [ ] With **two controls now on every card** — "I'll go" and the assign picker for the bishopric —
      is the calendar still scannable, or has it become a form?
      ANSWERED 2026-08-29: fine as it stands.
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Pressing **I'll go** with the dev server stopped mid-tap shows a sentence rather than failing
      silently.
- [ ] Pressing **I'll go** twice quickly on a slow connection produces the route's *"you were
      already down for this one"* notice as a plain sentence, **not** an error. Migration 056b
      makes `(event_id, user_id)` unique, so the second write is refused rather than doubling the
      count.
- [ ] With `/api/youth/attendees` failing, the page shows an error message rather than a calendar
      where every event silently reads "Nobody is down for this yet".

## Walkthrough record

**2026-08-29 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every write was read back with the **service client**. Signed in as `ym-president` first, then
`bishop`.

**The seed, read back from the database.** 14 events, **all upcoming**, spanning September–November
2026. Exactly one `uncovered` candidate: *Game against Roosevelt*, +4.8d, home, `att=0`. Also
*Game against Washington* +3.8d **cancelled**, *Away fixture at Riverton* +5.7d **away**,
*Game against Jefferson* +6.8d `att=1 [bishop]`, *Tournament* +9.3d **tbd, all-day**.

**THE HEADLINE RESULT — `youth-a-D2` IS CLEARED.** Pressing **I'll go** on *Game against Roosevelt*
moved **all four** signals in one interaction, with no reload:

| | before | after |
|---|---|---|
| badge | `Nobody going` | **`Covered · 1`** |
| going line | "Nobody is down for this yet." | **"Going: Miguel Cortez"** |
| edge stripe class | `border-l-4 border-l-danger` | **`border-l-4 border-l-transparent`** |
| banner | "1 home event in the next week with nobody going: Game against Roosevelt, Wed, Sep 2, 7:00 PM." | **gone entirely** |

The banner **disappeared** rather than reading "0", which is what the single-uncovered seed was
built to prove. Network showed `POST …/attend → 201`, then `GET /api/youth/attendees` **and**
`GET /api/youth/events` — both keys of `ATTENDEE_MUTATION_INVALIDATES`. Database confirmed
`att=1 [ym-president]`. **I can't after all** reversed all four.

**The banner and the needs-type line** were singular and correct: *"1 home event in the next week
with nobody going: …"* and *"1 event still needs somebody to say whether it is home or away."*

**The sort worked and was then REMOVED.** *Needs attention first* produced exactly `coverageRank`
ascending then date — `Roosevelt` (uncovered) → `Tournament` (needs_type) → seven `unassigned` in
date order → `Jefferson, Spring concert` (covered) → `Riverton, swim meet` (awareness) →
`Washington` (cancelled) — and the month grids correctly did not reorder.

**It was cut on 2026-08-29 on the review of this walk.** It read as a fifth filter rather than as a
different kind of control, and a calendar has one order. Re-verified after removal: the page
carries **four** selects, `Sort by` and `Needs attention` appear nowhere, and the card list is in
date order. The uncovered events are not lost with it — the banner still **names** them, which is
what a leader acts on.

**Filters**, with the count line following each time: Young Women → 4 events / 4 cards; Away only →
2 events / 2 cards; cleared → 14 / 14.

**The three special cards** read correctly: cancelled = `Home` + **`Cancelled` chip and no coverage
badge**; away = **`Away — awareness only`**; tbd = **`Home or away?`** and its date line read
**"Mon, Sep 7, 2026 · All day"** — never "12:00am".

**Cross-navigation.** Every card carried a young-person link (14 of 14). Following Maya's opened
`/youth?youth=1fca6275…` with **her card already expanded**. Signing up on the calendar and then
opening `/youth` showed the same event as **`Covered · 1`** there too.

**Permissions, both sides.** As `ym-president` (org president) **"Ask someone to go" appeared 0
times**. As `bishop` it appeared on **all 14** cards with the picker listing Renata Alvarez, Miguel
Cortez, Marcus Reyes. Absent, never present-and-refusing.

**The duplicate path**, exercised against the API directly: first `POST → 201` with the attendee
body, second `POST → 200 {"notice":"You are already down for this one."}` — a notice, not an error,
and no second row.

**375px**: `scrollWidth 360 = clientWidth 360`, no horizontal overflow; nothing under 44px tall.

**No defects found in this scenario.** The one defect from this slice lives on `/youth` and is
recorded in scenario 057.

Not walked: every "needs a human eye" line, and the "with the dev server stopped" / "with
`/api/youth/attendees` failing" failure cases — those need the server taken down mid-interaction
and were not simulated. Screenshots in `testing/walk-screenshots/`.

## Notes

- **Why the controls are here now.** This card used to carry a read-only `Going:` line and a
  comment saying a control here would mean a second copy of two permission gates — which is how
  `youth-a-D1` happened. The concern was right; what resolved it is that `AttendeeControls` is
  **one component** rendered by both screens, so there is no second copy to disagree. `canAssign`
  is resolved once on the server, and the attend route writes the **caller's own** id and can
  write no other.
- **The zone.** Cards are bucketed into days in the **reader's** zone, and the time printed on a
  card is the reader's too — so the day a card sits under always matches the time on it. The ward's
  zone decides what a **floating imported time means** and nothing else.
- The notification bell in the header is an inert placeholder until Phase 11.
