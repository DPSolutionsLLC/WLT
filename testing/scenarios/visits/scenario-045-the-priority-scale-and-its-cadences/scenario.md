---
name: The priority scale and its cadences
scope: visits
part: 1
tags: [visits, smoke, dashboard, cadence]
prerequisites: none
---

## Purpose

Two things about this page are only real on a screen, and neither is arrangeable by hand.

**Every band boundary needs a household at a precise distance from a precise cadence.** "Approaching"
is a window, not a threshold, and **the badge is a gauge**: it fills left to right with how much of
that household's interval has elapsed, so a household at 8% and one at 88% are visibly different
situations rather than two rows both reading "Visited". An overdue badge fills completely and says
**how long** overdue in words. That difference is the entire reason this redesign happened.

**Two organizations must judge the *same* family independently, at the same time.** The Elders
Quorum has put a 3-month override on Whitfield — their own goal is a year — and last went 100 days
ago, so it reads **Overdue ~109%**. The Relief Society is on its own 3-month goal and last went 20
days ago, so the same family reads **On track ~22%** on their board, simultaneously. Each is
correct: an organization is measured against the visits *it* made, on the cadence *it* holds.

A `households.visit_cadence` column could not have expressed the Elders Quorum's override at all —
it is one organization's private judgement about one family, and a single column would have been
silently overwritten by whichever organization wrote last. That is why ITER-018 Decision 2 was
reversed to a join table, and clearing the override (step 6) is what proves it was carrying the
Overdue: the row falls back to the yearly goal and flips to **On track ~27%**.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility OFF |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), EQ secretary (Peter Nakamura), RS president (Ruth Delacroix) |
| Goal — Elders Quorum | **No dates at all.** Every **1 year**, warning **2 months** ahead |
| Goal — Relief Society | Every **3 months**, warning **2 weeks** ahead — a short cadence, to prove one renders sensibly |
| Whitfield (RS) | visited by Relief Society **20 days ago** → **On track ~22%** on their board |
| Brooks | visited 30 days ago → **On track ~8%** |
| Okonkwo | visited 320 days ago, inside the two-month window → **Approaching ~88%** |
| Halvorsen | visited 400 days ago → **Overdue ~110%** |
| Ferreira | **3 attempts**, never a completed visit → **Never visited**, marked *Attempted ×3* |
| Nakamura | nothing at all → **Never visited**, **no** attempts mark |
| **Whitfield** (EQ) | visited by Elders Quorum **100 days ago**. **EQ override: every 3 months** → **overdue by about a week**, where their one-year goal alone would read On track. *The single most important row.* |
| Delgado | all members `moved_out` → **absent entirely** |
| Sorensen | **household `do_not_contact`**, one active member, visited 500 days ago → **present, marked, in no statistic** |

Note the two different exclusions. Delgado disappears because nobody lives there. Sorensen stays on
the page, marked, and is counted in nothing — a household that vanished is what ITER-018 Decision 4
refused, because the record of what happened before the decision is what the next presidency needs.

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-045-the-priority-scale-and-its-cadences`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the EQ president and go to **Visits**. Read the **banner sentence before the
   numbers** — the goal in words, then the four counts.
4. Read down the six visible rows. Note which two share a band.
5. Find Whitfield. Its cadence control should read *"Every 3 months (this household)"*. Open it and
   read the sentence above the inputs.
6. Open it and press **Use the organization's cadence**. Watch the row **and** the banner move
   without a reload. Allow the full **~3.7 s** round trip before judging it stale.
7. Set it back to *every 3 months*.
8. Narrow to 375px and read the same six rows.
9. Switch the theme to dark, then set the display to greyscale, and look at the badges.
10. Sign out, sign in as the **bishop**, and switch the organization to **Relief Society**.
11. Find Whitfield there and compare it with what you saw in step 5.

## Verification Checklist

### Machine-checkable

- [ ] The banner's **first line states the goal in words**, before any number
- [ ] **Overdue + Never visited + Approaching + On track equals the counted total**, and Sorensen
      is in none of them
- [ ] Sorensen is **visible**, marked **do not contact**, and named in the "not counted" line
- [ ] Sorensen shows **no band and no due date**, despite being 500 days past a one-year cadence
- [ ] Delgado does **not** appear, and is not in the total
- [ ] **Whitfield reads overdue for Elders Quorum and On track for Relief Society, at the same
      moment** — and its EQ row says the cadence came from *this household* while its RS row says
      *organization default*
- [ ] **No cell anywhere on the page reads "Visited"**
- [ ] Ferreira reads **Never visited** *and* carries **Attempted ×3**; Nakamura reads
      **Never visited** with none
- [ ] **The badge fills as a gauge**: Brooks (~8% elapsed) shows barely any fill and Okonkwo
      (~88%) is nearly full, and the two are visibly different at a glance
- [ ] **No badge shows a percentage.** An overdue badge is filled completely and reads a duration
      in words — *"5 weeks overdue"*, *"8 days overdue"* — never *"109%"*
- [ ] A **never visited** badge has **no fill at all**, because there is no completed visit to
      measure from
- [ ] Clearing Whitfield's override flips it from **overdue** to **On track** and moves its Due
      date a year out — proving the override, not the goal, was producing the overdue — and
      updates the banner **without a reload**
- [ ] After clearing, Whitfield's control reads *"(organization default)"* and offers no
      "Use the organization's cadence" button — there is nothing left to clear
- [ ] Every band's mark is distinguishable with the display set to **greyscale** (`○ ! ◑ ✓`), and
      the gauge fill is never the only thing carrying the state
- [ ] At 375px every row still shows its band and its due date
- [ ] The Relief Society's 3-month cadence renders sensibly: due dates close together, no
      overflow, percentages that move
- [ ] Signed in as the bishop the organization switcher is **present**; as the EQ president it is
      **absent**
- [ ] No horizontal scrolling at 375px; **every button ≥ 44×44, the cadence control included**

### Needs a human eye

- [ ] Read the banner sentence first. Does it make the four numbers underneath **mean** something
      they would not have meant alone?
- [ ] Whitfield reading **Overdue** for one organization and **On track** for another at the same
      time — does that read as **correct and intentional**, or does it read as a bug? Is it clear
      that each organization is tracking its *own* visits on its *own* cadence?
- [ ] Does the cadence control read as *a setting you may change* rather than as a label? Is it
      findable without being told it is there?
- [ ] Is **Sorensen** obviously "set aside on purpose" rather than "broken" or "still loading"?
      Does the muted row plus the badge plus the banner line add up to one clear statement?
- [ ] Do Ferreira and Nakamura read as different problems while sharing a band?
- [ ] Is **Never visited** above **Overdue** the right order? Does a family nobody has ever been
      to feel more urgent than one visited thirteen months ago?
- [ ] Does the **fill gauge** read as a gauge, or just as a coloured pill? Can you tell Brooks
      from Okonkwo without reading the words?
- [ ] Pill widths vary with their label, so two rows' fills are measured against different total
      widths. Does that stop you comparing households at a glance, or is each pill fine read on
      its own?
- [ ] Does *"5 weeks overdue"* land better than a percentage would have?
- [ ] The ~3.7 s round trip on the cadence control: does the page feel broken during it, or does
      it feel like it is working?

## Failure Behavior

- [ ] An organization with no goal shows a sentence and no number — never "0 of 0"
- [ ] Covered by `tests/rls/household-visit-cadences.test.ts`: an RS leader cannot read the EQ
      override for the same household, cross-ward reads and writes are refused, and the unique
      pair and both CHECK constraints actually reject
- [ ] Covered by `tests/routes/householdVisitCadence.test.ts`: an org leader naming another
      organization gets 403 and nothing is written; an org secretary gets 403; every success
      writes an audit row
- [ ] Covered by `tests/lib/householdStatus.test.ts`: every band boundary, built from the
      arithmetic rather than transcribed, and the never-visited-outranks-overdue order
- [ ] Covered by `tests/lib/visitProgress.test.ts`: the do-not-contact row present-and-uncounted,
      the statistics invariant, and an override for one org not affecting another

## Walkthrough record

**2026-08-27 — driven by Claude in a real browser (Playwright), signed in as the EQ president and
the bishop in turn.** Screenshots reviewed by the user separately. This is agent-driven evidence,
not a person using the app.

Setup note: a dev server from an earlier session (started 06:41, hours before this slice's code)
was holding port 3000. It was killed and restarted before anything below was observed — the trap
scenario 040's record warns about, hit again and avoided again.

Every write below was **read back from the database with the service client**, never confirmed from
the screen alone.

### Observed — Elders Quorum, as the EQ president

- **The banner leads with the goal in words**: *"Every household, every year. Warning 2 months
  ahead."* above the counts.
- **Counts: Overdue 2 · Never visited 2 · Approaching 1 · On track 1**, summing to the counted
  total of 6, with *"17% of 6 counted households on track."* and *"1 household marked do not
  contact is not counted."*
- **Every band and every percentage matched the arithmetic computed from the seed before the page
  was opened**, not read off the screen and rationalised:

  | Household | Last visited | Due | Band |
  |---|---|---|---|
  | Ferreira | — | — | `○ Never visited` + **Attempted ×3**, last attempted `Aug 15, 2026 (3)` |
  | Nakamura | — | — | `○ Never visited`, **no** attempts mark |
  | Halvorsen | Jul 23, 2025 | Jul 23, 2026 | `! Overdue · 110%` |
  | Whitfield | May 19, 2026 | Aug 19, 2026 | `! Overdue · 109%`, *Every 3 months (this household)* |
  | Okonkwo | Oct 11, 2025 | Oct 11, 2026 | `◑ Approaching · 88%` |
  | Brooks | Jul 28, 2026 | Jul 28, 2027 | `✓ On track · 8%` |
  | Sorensen | Apr 14, 2025 | — | `Do not contact`, muted row |

- **Sort order was `never_visited` → `overdue` → `approaching` → `on_track`, do-not-contact last**,
  and inside the overdue band the **more** overdue household led (Halvorsen 110% above Whitfield
  109%) rather than the alphabetically-first one.
- **Delgado is absent** from the list and the total; the ward holds 8 households and 6 are counted.
- **Sorensen is present, marked, and in no statistic**, with its 500-day-old visit still shown —
  uncounted and unhidden, as Decision 4 requires.
- **No badge cell reads "Visited."** The word survives only as the `Last visited` column header,
  the `Never visited` band, and the goal section's subtitle — all correct.
- **The EQ president gets no organization switcher**; the bishop does, and it defaults to Elders
  Quorum rather than Bishopric (the D2 fix from scenario 040 still holding).

### Observed — clearing and restoring the override

Run twice, once before and once after the seed correction below. Final run, on the shipped fixture:

- Before: `! Overdue · 109%`, due **Aug 19 2026**, *Every 3 months (this household)*; banner
  **17% of 6**.
- After **Use the organization's cadence**: `✓ On track · 27%`, due **May 19 2027**,
  *Every year (organization default)*; banner **33% of 6**. **No page reload at any point.**
- **2.45 s** for the round trip (an earlier run took 5.9 s). Both are well past the 3-second mark
  where visits-b's retro warns a probe reads exactly like a stale cache.
- The **"Use the organization's cadence" button is correctly gone** afterwards — there is nothing
  left to clear.
- Service-client read-back: `household_visit_cadences` went to **0 rows**, then back to **1 row**
  (`every 3 month`, EQ, Whitfield) on restore. Audit trail carried
  `household_visit_cadence_cleared` then `household_visit_cadence_set`, both with the right
  `orgId` and `householdId`.
- **This is the override proving it was doing the work**: the Elders Quorum's own goal is a year,
  and 100 days against a year is On track. Only the override made it Overdue.

### Observed — Relief Society, as the bishop

- Sentence: *"Every household, every 3 months. Warning 2 weeks ahead."* — a short cadence renders
  with no overflow and due dates a quarter apart.
- **Whitfield reads `✓ On track · 22%`, due Nov 7 2026, *Every 3 months (organization default)*** —
  the **same family reading a different band from the Elders Quorum's `! Overdue · 109%`, at the
  same moment**, each measured against the visits its own organization made.

### Observed — layout, theme, accessibility

- **375px: 0px horizontal overflow.** The table collapses to 7 cards, the sort control survives the
  collapse, and **every card still shows its band and its Due row**. No raw uuid on screen.
- **Dark mode and greyscale:** the four bands stayed separable with colour removed entirely —
  `○ Never visited` · `! Overdue` · `◑ Approaching` · `✓ On track`, mark plus word in every case.

### Defects found

1. **The cadence control is a 176×16 tap target — well under 44×44.** `HouseholdCadenceControl`'s
   collapsed state is a bare `<button>` with `text-xs` and no padding or min-height
   (`app/(app)/visits/HouseholdCadenceControl.tsx`, the `!open` branch). Six of them fail the
   scenario's own *"every button ≥ 44×44"* check at 375px, and it is the primary control this
   slice added. **Not fixed during the walk** — reported for a decision.

   Pre-existing and **not** introduced here: the `Return and report` link is 115×20. It is
   untouched by this slice (confirmed with `git diff`), so scenario 040's *"zero tap targets under
   44×44"* was measuring buttons only, not links.

### Checklist corrections

2. **The cross-org check described a state the seed could not reach.** The checklist said
   *"Whitfield reads Overdue for Elders Quorum and a different band for Relief Society"*, but the
   seed gave **both** organizations the same 100-day-old visit while the Relief Society's goal is
   every 3 months — so both read `! Overdue · 109%` and the scenario's headline claim demonstrated
   nothing. Verified in the browser before correcting.

   This came from the plan itself, which specified a 3-month Relief Society goal *and* expected
   "On track for Relief Society" — internally inconsistent.

   **Fixed in the seed**: the Relief Society now has its own visit 20 days ago, which is the
   realistic situation anyway — each organization logs its own visits. The Purpose, the seed table
   and the checklist were all rewritten to the observed values, and the claim is now demonstrated
   rather than asserted.

3. **The Purpose overstated "different cadences."** Both organizations judge Whitfield every 3
   months; what differs is the *source* (an Elders Quorum override versus the Relief Society's own
   goal) and the *visit history*. Reworded to say that precisely.

### Changed after the user reviewed the screenshots, same day

The user answered the eight judgement questions. Six passed as built (the do-not-contact row, the
Ferreira/Nakamura pairing, the never-visited-above-overdue rank, the phone layout, the goal
sentence, and the cross-org reading — which they called correct and intentional). Three changes
came out of the other two answers, plus the tap-target defect:

- **The percentage is gone from the badge; the pill is now the gauge.** The user's judgement was
  that the percentage did not earn its place beside the Due column, but that a *visual*
  representation would — "having them fill up according to how close they are to being due, and
  once they are overdue the pill fills all the way red". Built as asked. **Re-walked:** Brooks
  fills `8.2%`, Okonkwo `87.7%`, Halvorsen and Whitfield `100%`, Ferreira and Nakamura `0%` —
  never-visited having no anchor to measure from.
- **An overdue badge now reads a duration in words** — `5 weeks overdue`, `8 days overdue` —
  rather than `110%` / `109%`. A percentage is the right thing to sort on and the wrong thing to
  read: those two numbers are a month apart on a yearly cadence and a day apart on a monthly one.
  `elapsedFraction` is untouched and still drives the sort and the fill.
  New pure function `formatOverdueFor()` in `lib/visits/visitDates.ts`, with
  `tests/lib/visitDates.test.ts` — 14 tests pinning every unit boundary as a pair.
  One correction found by those tests: the first version used `countMonthsBetween()` directly,
  which counts month *boundaries* crossed, so 15 June to 14 August reported "2 months overdue" a
  day short of two months. It now counts *elapsed* months.
- **The cadence editor says what it sets.** It opened with two bare field labels, "Every" and
  "Unit"; it now leads with **"Visit this household once every"** reading into the inputs. It
  deliberately avoids the word *goal*, which belongs to the organization-level object one section
  down — using one word for both is how somebody comes to believe they have just changed the
  quorum's cadence for every household.
- **Defect 1 fixed.** The cadence control was 176×16; it is now **44px tall** on all six rows,
  measured at 375px. The only remaining sub-44 target on the page is the pre-existing
  `Return and report` link.

A measurement note for whoever walks this next: the first re-measurement reported all six buttons
at height 0. That was the walk's own error — the browser viewport had reset to 412px on navigate,
so the query was measuring the `md:`-hidden desktop table rather than the visible card layout.
`offsetParent === null` and `innerText` concatenating without spaces are the tells. Check
`window.innerWidth` before trusting a layout measurement.

### Left unwalked

- **Sorting by each column in both directions** (step 5) was not exercised per-column. The default
  Priority order was verified in detail, including the within-band fraction ordering. All six
  columns share one `sortRows()` path whose null-handling is covered by
  `tests/lib/householdStatus.test.ts`.
- **Step 7's "set it back to every 3 months"** was performed via the editor and verified in the
  database, but the *unit select* was only exercised at `month` — `day`, `week` and `year` were not
  chosen through the UI. Their arithmetic is covered by `tests/lib/visitCadence.test.ts`.
- **A real phone** was not used; 375px is an emulated viewport.
