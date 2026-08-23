---
name: Reliability flags on real history
scope: talks-d-reliability-goals
part: 1
tags: [talks, full, reliability, privacy, permissions]
prerequisites: none
---

## Purpose

Two things no unit test reaches.

First, that the flags **read as pastoral rather than as a verdict**. The wording is the feature —
"Declined twice recently" and "Unreliable" are computed identically and are not the same product —
and only a person can judge whether a bishop would be comfortable reading one aloud with the
member's name beside it.

Second, and higher risk, that the data does not leak. `tests/rls/speaker-history.test.ts` proves
the policy refuses five non-bishopric roles; what it cannot prove is that the **route** refuses a
secretary who asks it directly with the browser console open, rather than answering with an empty
history that reads as "this member has never spoken".

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) — proves shared bishopric authority |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `talks.view` and is **not** bishopric |
| | `eqpres` (org_president, Elders Quorum, Samuel Reyes) — holds no talks permission at all |
| | `youth` (sacrament_manager, username `jbenson`) — one module, and this is not it |
| Members | **6 adults, each with a hand-built history that earns exactly one flag or none** |
| | Thomas Whitfield — **declined twice** (Jan and Mar 2026) → `Declined twice recently` |
| | Rachel Sandoval — **cancelled with 3 days' notice** (Feb 2026) → `Cancelled close to the date` |
| | David Ferreira — last assignment **20 months ago** (Dec 2024, completed) → `Not asked in over a year` |
| | Miriam Hollis — last **completed** talk 26 months ago (Jun 2024), asked again 2 months ago and accepted → `Has not spoken in two years` |
| | Anna Lindqvist — completed 2 months ago, clean → **no flags** |
| | Caleb Moreno — **no history at all** → "No speaking history yet", no flags |
| Sundays | The Sundays each history row hangs off, back to June 2024, plus August 2026 for the planner |
| Assignments | One **completed external speaker** ("President Alan Whitcombe") on 2026-07-05 — it writes **no** history row, and must appear in nobody's table |
| | One `plan`-stage slot on a future Sunday, so the assignment modal's picker can be opened |

**Sign in with:** `bishop@`, `counselor1@`, `secretary@`, `eqpres@` — all
`@harness.wardleadershiptools.test`
**Youth:** username `jbenson` at `/youth-login`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-018-reliability-flags`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/roster` and note the six seeded members.
4. Open each of the six member detail pages in turn and scroll to **Speaking history**. Read the
   flags out loud as if in a bishopric meeting.
5. On Thomas Whitfield's page, check the table rows against the flag above them — the evidence
   should match the claim.
6. Open Caleb Moreno's page (no history) and read what the section says.
7. Open `/assignments?month=2026-08`, press the open slot, and switch the speaker side to
   **Ward member**. Scroll the picker list and look for flags beside the names.
8. Sign out. Sign in as `counselor1` and repeat steps 4 and 7 — compare item for item.
9. Sign out. Sign in as `secretary` and open Thomas Whitfield's member page.
10. **With the console open**, run:
    `await (await fetch('/api/members/<thomas-id>/speaker-history')).json()`
    then read the status and the body. The member id is in the page URL.
11. Repeat step 10 from `/assignments` too, in case the roster page is doing the refusing.
12. Sign out. Sign in as `eqpres` and repeat step 10.
13. Sign out. Sign in as the youth account `jbenson` and repeat step 10.
14. Sign back in as `bishop` and open the 2026-07-05 Sunday. Confirm the external speaker is
    there and completed. Then look for "Whitcombe" anywhere in any speaking-history table.
15. Re-check every screen at 375px in both themes.

## Verification Checklist

The flags themselves

- [ ] Thomas Whitfield shows **`Declined twice recently`** and nothing else
- [ ] Rachel Sandoval shows **`Cancelled close to the date`** and nothing else
- [ ] David Ferreira shows **`Not asked in over a year`** and nothing else
- [ ] Miriam Hollis shows **`Has not spoken in two years`** and nothing else — and specifically
      **not** "Not asked in over a year", because she was asked two months ago
- [ ] Anna Lindqvist shows **no flags**, and her history table is still there
- [ ] Caleb Moreno shows **"No speaking history yet"**, no flags, and **no empty table with
      column headers** — a header row above nothing reads as a rendering fault
- [ ] Every flag's wording is neutral. Nothing a bishop would hesitate to read aloud with the
      member's name attached. If any of the four makes you wince, say so — that is a failure
- [ ] The section says out loud that the flags are for context and do not block an assignment
- [ ] The history table shows the Sunday, the assignment type, the outcome, the notice given and
      the notes, and no raw uuid
- [ ] **Each history row names the YEAR.** Miriam Hollis is the case that proves it: her two rows
      are 2024 and 2026 and both fall in June, so without a year they read as the same month.
      A profile whose whole point is "how long ago" cannot render dates the reader has to guess at.
      **Failed on 2026-08-22 and was fixed the same day** — `formatSundayLabelWithYear()` in
      lib/calendar/dates.ts. Re-check it rather than assuming.

Bishopric parity

- [ ] `counselor1` sees **exactly** what the bishop sees on all six pages, item for item.
      CLAUDE.md §7: bishopric authority is shared, and any difference here is a bug

The leak — the point of this scenario

- [ ] `secretary` sees **no Speaking history section at all** on any member page. Not a disabled
      one, not an empty one, not a "you do not have access" panel — the section is absent
- [ ] Step 10: the direct call returns **403**
- [ ] The 403 body contains **no history data of any kind** — no outcomes, no dates, no member
      ids, no empty `history` array that implies the question was answered
- [ ] Step 11 gives the same answer from a different page — the refusal is the route's, not the
      roster page's
- [ ] Step 12: `eqpres` is refused the same way. They lack `talks.view` entirely, so the message
      may differ; the status must not
- [ ] Step 13: the youth account is refused the same way
- [ ] Nothing about a flag or a history row appears in any OTHER response either. If you can find
      speaker history riding along on `/api/members` or the roster page's payload, that is the
      failure this whole scenario exists to catch

The picker

- [ ] Step 7: the bishop's picker shows flags beside Thomas, Rachel, David and Miriam, and none
      beside Anna or Caleb
- [ ] The flags do not push the name off the row or cause horizontal scrolling at 375px
- [ ] Step 8: the counselor's picker is identical

External speakers

- [ ] The 2026-07-05 external speaker is visible on that Sunday and is marked complete
- [ ] **"Whitcombe" appears in no speaking-history table anywhere.** An external speaker writes
      no history row at all (ITER-004 / talks-a Decision 3)

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] The history table scrolls **inside its own container** — the page itself never scrolls
      sideways
- [ ] Every flag keeps a visible border in dark mode
- [ ] Every tap target clears 44×44

## Failure Behavior

**Automated where it can be.** The four boundaries are covered exhaustively by
`tests/lib/reliabilityFlags.test.ts` — each flag fires on its boundary day and not the day
before, a member with no history gets nothing, and a member who has been asked but never spoke
does not get "has not spoken in two years". `tests/rls/speaker-history.test.ts` proves five
non-bishopric roles read zero rows while the bishop and a counselor read the seeded row in the
same fixture, proves cross-ward isolation, and proves the external assignment wrote no history.
`tests/components/roster/ReliabilityFlag.test.tsx` pins the four labels as words.

What is left for a human is exactly two things: whether the **wording** is pastoral, and whether
the **route** refuses a direct call rather than answering emptily. Neither is a thing a test
asserts well — the first is a judgement, and the second is only convincing when you watch it
happen in a browser you are signed into as the wrong person.

**If step 10 returns 200 with an empty array**, stop and report it. That is the leak the phase
plan names, arriving in its most deceptive form: nothing is exposed today, and the first ward
whose secretary is briefly made a counselor gets a permanent copy.

## Notes

**Why the `late_canceller` flag needs a hand-seeded row.** No code path in the app writes an
`assignment_history` row with `outcome = 'cancelled'` or a `cancellation_days_notice` — only
`declined` and `completed` are written today (`writeAssignmentHistory` in
`lib/assignments/queries.ts`). The flag is implemented and tested against its boundary because
the phase plan specifies it, but it is **dormant on real data** until a cancellation path exists.
Rachel Sandoval's row is inserted directly, which is the only way to see the flag at all. That
gap is recorded in the retro rather than papered over.

**Why 20 months and 26 months.** The boundaries are 18 and 24. Seeding at 18 and 24 exactly would
make the scenario fail on the wrong day if it is walked a week later; seeding two months past each
boundary keeps it stable for a couple of months, and the exact-day behaviour is where the unit
test lives.

**Steps 7 onwards do not change data.** Nothing here writes, so the scenario can be re-walked
without re-seeding.

## Walkthrough record

**Walked 2026-08-22 by Claude (agent-driven), through a real browser (Playwright MCP) against the
hosted project.** Not a person using the app. Every permission refusal below was performed from a
browser genuinely signed in as that role, and every history claim was read back from the database
with the service-role client.

**One defect found — see below. Everything else passed.**

**Observed values — the flags**

| Member | Flags rendered | History rows |
|---|---|---|
| Thomas Whitfield | `Declined twice recently` | 2 declined (2026-01-04, 2026-03-01) |
| Rachel Sandoval | `Cancelled close to the date` | 1 cancelled, 3 days' notice (2026-02-01) |
| David Ferreira | `Not asked in over a year` | 1 completed (2024-12-01) |
| Miriam Hollis | `Has not spoken in two years` | 1 completed (2024-06-02), 1 accepted (2026-06-07) |
| Anna Lindqvist | none | 1 completed (2026-06-07) |
| Caleb Moreno | none | 0 — "No speaking history yet.", **no table and no header row** |

Miriam is the case worth naming: she was asked two months ago, so "Not asked in over a year" did
**not** fire while "Has not spoken in two years" did. The two flags measure different things and
the implementation knows it.

**Observed values — the leak, which is what this scenario exists for**

- `secretary` (ward_secretary, holds `talks.view`): **no Speaking history section at all** on any
  member page — absent, not disabled. `GET /api/members/[id]/speaker-history` → **403**, body
  `{"error":"You do not have permission to do that."}` with no history data of any kind. Same
  answer from `/roster/...` and from `/assignments`, so the refusal is the route's.
- `eqpres` (org_president, holds no talks permission): **403**, same body.
- `jbenson` (sacrament_manager, youth PIN account): **403**, same body.
- `GET /api/members` as the secretary returned 1525 bytes matching none of
  /history|reliabilit|flag|declined|cancellation/. **Speaker history rides along on no other
  response.** That is the separate-call design holding.
- `counselor1` saw **exactly** what the bishop saw on all six pages, flag for flag, and the direct
  call returned 200 with 2 rows. CLAUDE.md §7 satisfied.

**Observed values — the picker and external speakers**

- The assignment modal's picker rendered, per row: `David Ferreira` + Not asked in over a year,
  `Miriam Hollis` + Has not spoken in two years, `Anna Lindqvist` (none), `Caleb Moreno` (none),
  `Rachel Sandoval` + Cancelled close to the date, `Thomas Whitfield` + Declined twice recently.
  roster-b's open promise is closed: `showFlags` renders real flags.
- The external speaker "Alan Whitcombe" (completed, 2026-07-05) wrote **0** history rows, appeared
  on the July planner, and appeared on **none** of the six member pages.

**Observed values — layout**

- 375px: the history table scrolls **inside its own container** (`overflow-x: auto`, table 544px
  inside a 360px viewport) and the page itself does **not** scroll sideways (360/360).
- The picker at 375px in dark: all four flags legible beside their names, no horizontal overflow.
- Two tap targets under 44px on the member page — "Back to the roster" and the household link,
  both inline text links from roster-a. Pre-existing, not introduced by this slice.

**DEFECT FOUND — history rows do not name the year**

`SpeakerHistoryTab` formats each row's date with `formatSundayLabel()`, which renders
"Sunday, June 7" — weekday, month, day, **no year**. That formatter was built for the calendar,
where the year is implied by the month you are looking at. A speaking-history table has no such
context and spans years by design.

Reproduction: seed this scenario, open Miriam Hollis as the bishop, read the two rows. They are
2024-06-02 and 2026-06-07 and render as "Sunday, June 2" and "Sunday, June 7" — two years apart,
indistinguishable. The flag above them says "Has not spoken in two years" and the evidence table
cannot corroborate it.

**Fixed after the walk.** `lib/calendar/dates.ts` gained `formatSundayLabelWithYear()` — a sibling
to `formatSundayLabel()` that adds the year — and `SpeakerHistoryTab` uses it. The calendar keeps
the year-less label, because there the month you are looking at supplies it; that reasoning is now
written above both formatters so the next person does not "simplify" them back together.
`walk-shots/02-miriam-no-year-light.png` is the evidence of the original failure.

**Left unwalked**

- The `late_canceller` flag renders from a hand-seeded row only. No code path writes a `cancelled`
  outcome, so this scenario cannot prove the flag fires on data the app produced — only that it
  renders and reads correctly. Already recorded as a deviation in `plans/04-talks-pipeline.md`.
- Both themes were exercised across the member pages and the picker, but not every screen in both.

