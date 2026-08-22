---
name: Sundays with no meeting, and ward conference
scope: ITER-002 ITER-003
part: 1
tags: [calendar, full, rotation, sunday-types, destructive]
prerequisites: none
---

## Purpose

Prove on screen that a Sunday holding **no sacrament meeting** reads "No meeting" and costs
nobody a turn in the rotation, while a **ward conference** on the same page keeps its conductor
and its speakers and pushes Fast Sunday a week.

One scenario rather than two. `FAST_SUNDAY_DISPLACING_TYPES` used to answer two different
questions — "this Sunday cannot BE Fast Sunday" and "this Sunday holds no meeting" — and the two
sets happened to coincide, so nothing forced them apart. `ward_conference` forces them apart from
one side (it cannot be Fast Sunday, yet it meets normally) and `holiday` from the other (a ward
marking Christmas Sunday as a holiday still meets). A month holding **both** a cancelled Sunday
and a ward conference is the only thing that shows the two lists really did come apart.

The seeding matters. The interesting month needs a rotation anchor two months back, a hand-set
stake conference, organization rows on some Sundays and deliberately none on others, and speakers
already partway down the pipeline — none of which a tester can build by hand in under ten minutes,
and the speakers are what make the 409 dialog appear at all.

**Not checked here:** that Sundays *before today* keep their conductors. A static seed cannot
express "before today" — the clock moves and the fixture does not. That guarantee is pinned
precisely, with an injected `today`, by `tests/db/conducting-reshift.test.ts`.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) |
| | `counselor2` (counselor, position 2, Daniel Okafor) |
| | `eqpres` (org_president, Elders Quorum, Tomas Ruiz) |
| | `eqcounselor` (org_counselor, Elders Quorum, Andre Whitfield) |
| | `secretary` (ward_secretary, Ruth Kaufman) — `calendar.manage`, no org rotation rights |
| Rotations | Bishopric, **weekly**, effective 2027-09-01: bishop → counselor1 → counselor2 |
| | Elders Quorum, **weekly**, effective 2027-09-01: eqpres → eqcounselor → **nobody** |
| Sundays | 2027-09 through 2027-12, seventeen Sundays, each carrying the conductor the weekly cycle produces |
| | `2027-10-03` **general conference** — no conductor, no organization row, 0 slots |
| | `2027-11-07` **ward conference** — conductor, 3 slots, organization row |
| | `2027-11-14` `fast_sunday` — 0 slots |
| | `2027-11-21` **stake conference** — no conductor, no organization row, 0 slots |
| | `2027-11-28` `standard` — the Sunday you will cancel in step 6 |
| Assignments | `2027-11-28`: two speakers at stage **request** — Elliot Vance, Marta Ilundain |
| | `2027-11-07`: one speaker at stage **confirm** — President Alma Reyes |

November 2027 has **four** Sundays and opens on a Monday.

The Elders Quorum's third position is **empty on purpose**, so "Not set" appears on screen beside
"No meeting". Telling those two apart is the whole point of ITER-002.

**Sign in with:** `bishop@`, then `eqpres@`, `secretary@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

### The cycle, for reference

Read `11-21` and `11-28` together — that pair is the whole of ITER-002:

| Sunday | Type | Conducting |
|---|---|---|
| 2027-11-07 | Ward Conference | Daniel Okafor |
| 2027-11-14 | Fast Sunday | Mark Andersen |
| 2027-11-21 | Stake Conference | **No meeting** |
| 2027-11-28 | Standard | Peter Nakamura |

Without the skip, `11-28` would read Daniel Okafor. It reads **Peter Nakamura** — the name the
cancelled Sunday would have had.

## Steps

1. `npm run seed -- calendar/scenario-015-no-meeting-sundays`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open **http://localhost:3000/calendar?month=2027-11** — name the month in
   the URL. ("Open the calendar" lands on the current month and reads as a failure; scenario 014's
   walkthrough found this.)
4. Read the whole November grid before clicking anything.
5. Open `2027-11-07` (the ward conference), then `2027-11-21` (the stake conference). Read the
   **Organization meetings** card on each.
6. Go back to November. Open `2027-11-28` and change its type to **Holiday**. Save.
7. Change `2027-11-28` again, this time to **Stake Conference**. Read the whole dialog before
   confirming, then confirm.
8. Open **http://localhost:3000/calendar?month=2027-12** and check the December names against what
   the dialog promised.
9. Open **Conducting rotation**, set the cadence to monthly with Effective from
   **2028-01-01**, and save.
   *January 2028, not November.* A rotation change applies **forward only** and never rewrites a
   conductor that is already stored, so a month that has already been generated will not change —
   see **Known limitations** below. January 2028 has no rows yet, so it is generated fresh under
   the new cadence, which is the only place the monthly rule is visible.
10. Open **http://localhost:3000/calendar?month=2028-01**. Read the five Sundays.
11. Open `2028-01-16`, change its type to **Stake Conference**, and save.
12. Return to `/calendar?month=2028-01` and read the other four Sundays.
13. Back on `/calendar?month=2027-11` **as the bishop**, open `2027-11-07` and then
    `2027-11-21`, and compare the **Elders Quorum** row on each.
    *Not as `eqpres`.* An organization president cannot open the calendar at all — see
    **Known limitations**. The organization rows are read here from the account that can see them.
14. Sign out, sign in as `secretary`, and open `2027-11-21`.
15. Re-check November at **375px** in both light and dark themes.

## Verification Checklist

### The month grid — step 4

- [ ] `2027-11-21` reads **"No meeting"** — not "Not set", and not a blank
- [ ] `2027-11-07` shows a **Ward Conference** badge and the name **Daniel Okafor**
- [ ] `2027-11-14` shows the **Fast Sunday** badge — Fast Sunday is on the **2nd** Sunday, not the 1st
- [ ] `2027-11-28` reads **Peter Nakamura** — nobody's turn was spent on the 21st
- [ ] `/calendar?month=2027-10`: `2027-10-03` also reads **"No meeting"** with no conductor

### The two detail pages — step 5

- [ ] `2027-11-07` shows **3 speaking slots** and its speaker, President Alma Reyes
- [ ] `2027-11-07`'s Organization meetings card shows a normal editable row for Elders Quorum
- [ ] `2027-11-21`'s **Conducting** row reads **"No meeting"**
- [ ] `2027-11-21`'s Organization meetings card shows **"No meeting"** for every organization,
      with **no select and no Save button** — there is no block that day at all

### Holiday still meets — step 6

- [ ] Saving produces **no** "would no longer hold a sacrament meeting" warning, and no dialog at all
- [ ] `2027-11-28` keeps its conductor (**Peter Nakamura**) and its **3 speaking slots**
- [ ] Both of its speakers are still at stage **request** — nothing was returned to planning

### Cancelling a meeting — step 7

- [ ] A **409 dialog** appears naming the **2 speaking assignments** at risk
- [ ] The same dialog also says who conducts will change on **4 later Sundays**
- [ ] After confirming, both speakers are at stage **plan** — reverted, **not deleted**
- [ ] `2027-11-28` now reads **"No meeting"** with no conductor and 0 slots

### The shift crosses into December — step 8

- [ ] Exactly **4** December Sundays changed conductor, the number the dialog promised
- [ ] `2027-12-05` now reads **Peter Nakamura** (it read Daniel Okafor before)

### The monthly cadence — steps 9–12

- [ ] November 2027 is **unchanged** by the switch. This is the forward-only rule, **not a fault**:
      those conductors are already stored, and a rotation change never rewrites one
- [ ] January 2028 generates with **one name across all five Sundays** — Mark Andersen on
      01-02, 01-09, 01-16, 01-23 and 01-30
- [ ] After cancelling `2028-01-16`, it reads **"No meeting"**
- [ ] **The other four January Sundays still read Mark Andersen.** Under a monthly cadence one
      person already holds the whole month, so a single cancelled Sunday inside it costs nobody a
      turn — this is Decision 1, and it is the opposite of what the weekly cycle did in step 7

### The organization rotation skips independently — step 13

Read as the **bishop**. The organization-president view is blocked by ITER-007.

- [ ] `2027-11-21`'s Elders Quorum row reads **"No meeting"**, with no select and no Save
- [ ] `2027-11-07`'s Elders Quorum row reads **"Not set"** — the third position is deliberately
      empty, which is a *different fact* from "No meeting", and the two must not read alike.
      **This pair is the whole point of ITER-002**; if they render the same, the change failed
- [ ] `2027-11-14` reads **Tomas Ruiz** and `2027-11-28` reads **Andre Whitfield** — the Elders
      Quorum rotation skipped the cancelled Sunday exactly as the bishopric's did

### Permissions — step 14

- [ ] As `secretary`, `2027-11-21` still reads "No meeting" and offers no organization select

### Theme and width — step 15

- [ ] At 375px the **Ward Conference** badge is legible and clearly distinguishable from the
      Stake Conference and General Conference badges
- [ ] Both light and dark: "No meeting" is readable and does not look like a disabled control

## Known limitations

**An organization president cannot open the calendar at all.** `org_president` and `org_counselor`
hold `calendar.manage_org_conducting` but not `calendar.view`, and both `/calendar` and the Sunday
detail page gate on `calendar.view` — so the permission is unreachable by every role that holds it.
Signing in as `eqpres` shows no Calendar link at all and, by direct URL, "Not permitted — The ward
calendar is limited to ward leadership." Pre-existing since `calendar-c`, found while walking this
scenario on 2026-08-22, scoped as **ITER-007**. Step 13 reads the organization rows as the bishop
instead; the organization-leader half cannot be walked until that is fixed. Scenario 011 carries
the same broken assumption in its own checklist and was never walked.

**A rotation change never rewrites a conductor that is already stored.** `conducting_user_id` is
a stored column precisely so that last March's program does not silently start naming whoever
conducts today (03-calendar.md Step 3), `replaceConductingRotation()` only inserts a new rotation
set, and `populateConducting()` fills nulls only. So switching the cadence and then looking at an
already-generated month shows **no change at all** — including a month that begins *after* the new
effective date. Judge a cadence on a month generated after the switch, which is why step 9 uses
January 2028. Scenario 011 records the same limitation.

Worth noting, because this change made the two paths differ: a **type** change now re-resolves
later Sundays (the forward re-shift, step 7), while a **rotation** change still does not. Both are
deliberate — the re-shift exists because a cancelled Sunday changes the meaning of every later
turn, and it is gated behind a confirm dialog that says how many Sundays move. A rotation change
has no equivalent path. If a bishopric ever asks why switching to monthly "did nothing", this is
the answer, and closing the gap is a separate piece of work.

## Cleanup

`npm run seed:clean`
