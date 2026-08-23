---
name: Prayer rotation across a month
scope: talks-c-prayers-topics
part: 3
tags: [talks, full, prayers]
prerequisites: none
---

## Purpose

"Last prayed" is a nudge, and whether a nudge works is a judgement about wording and placement
that no unit test reaches. `tests/lib/lastPrayed.test.ts` proves the function returns `null` for
somebody with no history; it cannot prove that a bishopric scanning a list of twelve names
actually reads the six blanks as "consider these" rather than as a rendering fault.

Seeding matters because a useful last-prayed spread needs eighteen months of prayer history
behind several members — tedious and error-prone to build by hand, and impossible to build at all
through the UI without walking forty prayers to `done`.

June 2026 opens on a Monday, so 06-07 is the first Sunday and therefore the fast Sunday. It
carries `speaking_slots = 0`, which is the case this scenario exists to catch: **a fast Sunday
still has an invocation and a benediction**, and gating prayers on the speaker slot count would
make the one Sunday a month with the most prayers the only one that could not have any.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `talks.view`, **not** `talks.plan` |
| Members | 12 active adults across 12 households |
| | **4 with history:** prayers at `done` on Sundays spread across the last 18 months |
| | **2 stuck at `ask`:** asked, never confirmed, never given |
| | **6 with no prayer history at all** |
| Sundays | June 2026 generated: 06-07, 06-14, 06-21, 06-28 |
| | 06-07 `fast_sunday` with **`speaking_slots = 0`**; the rest `standard` with 3 |
| History Sundays | 2025-02 through 2026-04, carrying the `done` prayers. Outside June, so they do not appear in the month view |

**Sign in with:** `bishop@`, `secretary@` — both `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-016-prayer-rotation`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/prayers?month=2026-06` and read the whole month before touching
   anything.
4. Read the **06-07** card specifically. It is the fast Sunday with zero speaking slots.
5. On 06-14, open the **Invocation** picker and read the whole list of twelve names without
   choosing anybody.
6. Choose a member with history. Then reopen the picker and choose a **different** member.
7. Walk that prayer through all four stages, one press at a time. Read the button label before
   each press.
8. On 06-07, assign both the invocation and the benediction.
9. On 06-21, assign the invocation to anybody, then **remove them again** with the × on the
   chip. That leaves a prayer at Assigned with nobody in it — the state a planner reaches by
   changing their mind, and the one the gate exists for.
10. Resize the browser to 375px and repeat step 5. Then switch to dark mode.
11. Sign out. Sign in as `secretary` and open `/prayers?month=2026-06`.
12. In the Supabase dashboard, read `audit_log` for this ward, filtered to `module = 'talks'`.

## Verification Checklist

The nudge

- [ ] In the picker, the four members with history read **"Last prayed <Month Year>"** beside
      their name — the month and the year, never a raw date
- [ ] The six with no history show **nothing at all** beside their name — not "Never", not a
      dash, not an empty gap that looks like a missing value
- [ ] The two stuck at `ask` **also show nothing**. Being asked is not the same as having prayed,
      and a bishopric reading "Last prayed" beside somebody who never did would stop asking them
- [ ] Scanning the list, it is obvious within a second or two who to consider. If the blanks read
      as a fault rather than as an invitation, that is a failure — say so
- [ ] The label sits beside the name without pushing it off the row at 375px

The fast Sunday

- [ ] **06-07 shows an Invocation and a Benediction**, both assignable, despite `speaking_slots = 0`
- [ ] Nothing on the 06-07 card says "no slots" or refuses the assignment
- [ ] Both prayers save and survive a reload

The four stages

- [ ] Each prayer starts at **Assigned** with nobody chosen
- [ ] The control names the stage it moves TO — "Move to Asked", then "Move to Confirmed", then
      "Move to Done" — never a bare "Next"
- [ ] Each press moves exactly **one** stage. Nothing skips
- [ ] A slot nobody has touched offers **only "Choose someone"** — no stage control at all.
      There is nothing to move, and a disabled "Move to Asked" there would read as a broken button
- [ ] Step 9: once a prayer exists but its member has been removed, "Move to Asked" **is** shown
      and **is disabled**, with **"Choose who is praying before asking them."** beside it — the
      reason is visible without pressing
- [ ] Assigning somebody does **not** move the stage on its own

Replacing rather than duplicating

- [ ] Step 6 leaves 06-14 with **one** invocation, showing the second member
- [ ] The stage does **not** reset when the member changes — changing who is praying is not a
      stage move
- [ ] Reloading confirms it: one row, not two

Permissions

- [ ] `secretary` sees the whole month and **no** picker, no "Move to …" control, and no way to
      change anything
- [ ] `secretary` can still read who is praying and what stage each prayer is at

Audit

- [ ] A `prayer_assigned` row exists for each assignment, naming the Sunday and the prayer type
- [ ] A `prayer_stage_changed` row exists for each stage change, carrying `from` and `to`
- [ ] No audit row contains a member's name — ids and short descriptions only

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] Every tap target clears 44×44
- [ ] No raw uuid appears anywhere

## Failure Behavior

**Automated where it can be.** The four-stage machine is exhaustively covered by
`tests/lib/prayerPipeline.test.ts` — all sixteen (from, to) pairs, every gate, and the backward
rule. The shaping and the never-say-"Never" rule are covered by `tests/lib/lastPrayed.test.ts`.

What is left for a human is the part above the API: whether the nudge reads as a nudge, whether
the blanks read as an invitation, and whether the fast Sunday behaves on a real screen.

**One thing worth checking by hand in the dashboard:** after step 6, query
`prayer_assignments` for the 06-14 Sunday. There must be exactly two rows — one invocation, one
benediction. Migration 028's unique index on `(ward_id, sunday_id, prayer_type)` is what makes
that structural, so a third row means the index did not apply.

## Walkthrough record

**Walked 2026-08-22, driven through a real browser (Playwright MCP) against the hosted project.
Every check above passed.** What was observed:

- The picker rendered "Last prayed February 2025 / September 2025 / January 2026 / April 2026"
  against Tomas Ruiz, Andre Bell, Claire Bennett and Sarah Whitfield. **The other eight names
  carried nothing at all** — including Miriam Okonkwo and David Lindqvist, whose prayers are
  stuck at `ask`. That is the check this scenario exists for and it held.
- 06-07, the fast Sunday with `speaking_slots = 0`, offered both prayers and accepted an
  assignment. Nothing on the card mentioned slots.
- Assigning did not move the stage. The four stages walked one press at a time, each control
  named its target ("Move to Asked" → "Move to Confirmed" → "Move to Done"), and at Done the
  control disappeared.
- Replacing the member left **one** row with the same `prayerId` and the stage untouched.
- 8 `prayer_assigned` and 3 `prayer_stage_changed` audit rows, each stage change carrying `from`
  and `to`, and **no audit row contained a member's name**.
- `secretary` saw the whole month with no picker, no "Move to" control and no Change button.
- At 375px: no horizontal overflow, every tap target ≥ 44×44, no raw uuid on screen.

**One correction made during the walkthrough.** Step 9 originally said to press "Move to Asked"
on a prayer with nobody assigned. An untouched slot has no prayer row and therefore no stage
control at all — only "Choose someone". The disabled-with-reason state is reached by assigning
somebody and then removing them, which is what the step now says.

## Notes

**Why the two stuck at `ask` are seeded at all.** They are the case a naive implementation gets
wrong: reading `prayer_assignments` for a member and taking the most recent row, rather than the
most recent row **at `done`**. That bug produces a plausible-looking label for somebody who has
never prayed, and it suppresses them from consideration for months with no symptom at all. It is
the same failure mode `COMPLETED_STAGE` exists to prevent on the talk side.

**Why eighteen months of history.** Six months would put every date in the same handful of
labels, and the point of the label is that a bishopric can tell "March 2025" from "January 2026"
at a glance and act on the difference.

**Steps 6 onwards change data.** `createPrayerAssignment` uses stable ids keyed on the Sunday and
the prayer type, so re-seeding restores the month. Run `npm run seed:clean` and re-seed for a
clean run.
