---
name: Narrowing a stewardship
scope: visits
part: 1
tags: [visits, smoke, stewardship, primary]
prerequisites: none
---

## Purpose

The point of this slice is a number that is currently absurd becoming right **in one press**.

The Primary is never going to visit twenty-two households; it will visit the eight families with
a child in Primary. Today its dashboard reads **3 of 20** and will read that for ever. That is only
absurd at scale — two households would not show it — and a ward big enough to be absurd, with a
Primary whose membership genuinely implies a subset, is not arrangeable by hand.

The second thing only a screen can settle is the **contrast between three different reasons a
household is not counted**, which must stay visibly distinct:

| Household | Why it is not counted | What you should SEE |
|---|---|---|
| Halvorsen | do-not-contact, **inside** the Primary's set | **Present and marked**, no band |
| Sorensen | do-not-contact, **outside** it | **Gone entirely**, for a different reason |
| The other 13 | outside the stewardship | **Gone entirely** |

A do-not-contact household is *shown and marked*; a non-stewardship household is *gone*. They look
different on purpose, because they are different questions, and having both on one screen is the
only way to see they did not get collapsed into each other.

The third thing is a **denominator that shrank saying so out loud**. `visits-b` recorded that
counting households an organization cannot visit erodes trust in the number; a number silently
dropping from 20 to 7 is the same erosion in the other direction.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility **OFF** |
| Households | **22**, every one with an adult so every one is visitable |
| — with a Primary child | **8**: Brooks, Okonkwo, Halvorsen, Ferreira, Nakamura, Whitfield, Ashworth, Delacroix |
| — without | **14**: Sorensen, Delgado, Ravensworth, Kowalski, Mbeki, Lindqvist, Castellanos, Thorpe, Aguilar, Novak, Fitzgerald, Yamamoto, Petrov, Osei |
| | *(8 + 14 = 22. The plan's header said 24; its own breakdown says 22, because the two do-not-contact households are **inside** these two groups rather than additional. Corrected during the walk.)* |
| — do not contact | **Halvorsen** (a Primary family) and **Sorensen** (not one) — one on each side, deliberately |
| Users | bishop (Mark Andersen), Primary president (Rosa Villanueva), **Primary secretary (Peter Nakamura)**, EQ president (Miguel Cortez), RS president (Ruth Delacroix) |
| Goal — Primary | Every **6 months**, warning **1 month** ahead |
| Goal — Elders Quorum | Every **1 year**, warning **2 months** ahead. **Narrows nothing** — the control |
| Primary visits | Brooks 20 days ago (**On track ~11%**), Okonkwo 160 days ago (**Approaching ~88%**), Ferreira 260 days ago (**Overdue ~143%**), Halvorsen 400 days ago (**no band** — do not contact) |
| Stewardship rows | **None.** Every organization starts un-narrowed, which is ship-day state |

**Sign in with:** `primary-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-047-narrowing-a-stewardship`
2. Kill anything already on port 3000, then `npm run dev` and open http://localhost:3000.
   *(A stale dev server from an earlier session has now cost two walks — check before you start.)*
3. Sign in as the **Primary president**, go to **Visits**, and **read the denominator before
   touching anything**. Write it down.
4. Open **Which households are ours**. Read the sentence.
5. Press **Choose which households are ours**. Do not tick anything by hand — read what is
   already ticked and count it.
6. Press **Save this stewardship**. Wait for the full round trip (allow ~3 s) before judging it.
7. Re-read the denominator and the banner.
8. Scroll the household table and look for Halvorsen, then for Sorensen.
9. Open **Log a visit** and open the household picker. Look for one of the 14 excluded families.
10. Sign out; sign in as the **EQ president**. Read their denominator and bands.
11. Sign out; sign in as the **Primary secretary**. Open the stewardship panel.
12. Back as the **Primary president**, adjust the list to remove **Whitfield** and save.
13. Narrow the viewport to 375px and read the panel and the table again.

## Verification Checklist

### Machine-checkable

- [ ] Before narrowing, the Primary reads a denominator of **20** — 22 households less the 2
      marked do-not-contact
- [ ] The panel says **"Measured against every household in the ward (22)"** before narrowing
- [ ] The pre-ticked list is **exactly the 8** households with a Primary child, with **no manual
      ticking** — Brooks, Okonkwo, Halvorsen, Ferreira, Nakamura, Whitfield, Ashworth, Delacroix
- [ ] After saving, the denominator is **7** — the 8 chosen less Halvorsen, which is
      do-not-contact
- [ ] **Overdue + Never visited + Approaching + On track still equals the counted total**
- [ ] The banner **names how many households are outside the stewardship** and does not leave the
      drop from 20 to 7 unexplained
- [ ] **Halvorsen is still shown and still marked "Do not contact"**, with **no band**, despite
      being 400 days past a 6-month cadence
- [ ] **Sorensen appears nowhere** on the Primary's dashboard — a different treatment from
      Halvorsen, from a different cause
- [ ] The **14** households outside the stewardship appear **nowhere** on the Primary's board:
      not in the table, not in any band, not in the count
- [ ] The household picker under **Log a visit** still offers an excluded family, labelled
      **"(not in your stewardship)"**, and a visit logged to it saves
- [ ] The picker also still offers Halvorsen, labelled **"(do not contact)"** — two different
      marks for two different reasons
- [ ] The **Elders Quorum's denominator and every band are identical** before and after the
      Primary narrowed (success criterion 2)
- [ ] The **Primary secretary sees the sentence and no controls** — no "Choose which households",
      no "Measure against the whole ward"
- [ ] Removing Whitfield drops the denominator to **6** and Whitfield leaves the table
- [ ] Every new control is at least **44×44** — the panel buttons and every checkbox row
      (`visits-e` shipped a control at 176×16)
- [ ] No horizontal scrolling at 375px
- [ ] **`window.innerWidth` was checked before any layout measurement was trusted** — a viewport
      silently reset to 412px measured the `md:`-hidden desktop table last time and reported every
      button at height 0

### Needs a human eye

- [ ] Read the panel's sentence before narrowing and after. Does the page make it **obvious what
      the organization is being measured against**, without you having to work it out?
- [ ] After saving, does the drop from 20 to 7 read as **something the Primary chose**, or does it
      read as data going missing?
- [ ] Halvorsen (shown, marked, uncounted) and Sorensen (absent) are **two different things for
      two different reasons**. Sitting on the Primary's board, is that difference legible — or do
      they just look like inconsistent behaviour?
- [ ] Is **"Choose which households are ours"** findable without being told it is there? Does it
      read as a decision the presidency makes rather than a filter?
- [ ] The pre-ticked list arrives already correct. Does that feel like the app **understood the
      question**, or does it feel like it guessed?
- [ ] Is **"(not in your stewardship)"** in the visit picker the right call? A leader who visited
      that family anyway can still record it — does the label explain why the household is offered
      but absent from the numbers?
- [ ] For the **Primary secretary**: does the read-only panel read as *"this is not your
      decision"* rather than as a broken or half-loaded page?
- [ ] Is the checkbox list workable at 375px with twenty-two households, or does it need
      searching or grouping?
- [ ] **"Measure against the whole ward"** is behind a confirm. Is the confirm wording clear about
      what it will do — go from 7 back to 20?

## Failure Behavior

- [ ] Unticking every household and pressing save is **refused with a sentence naming the
      alternative**, not silently accepted — zero rows means the whole ward, so "narrowed to
      nothing" is not expressible and the message says so
- [ ] Covered by `tests/rls/household-stewardships.test.ts`: an RS leader cannot read the EQ claim
      for the same household, cross-ward reads and writes are refused, the unique pair genuinely
      rejects a duplicate, and deleting a household cascades its claims away
- [ ] Covered by `tests/routes/householdStewardship.test.ts`: an org leader naming another
      organization gets 403 and nothing is written; an org secretary gets 403; adding a household
      to an **un-narrowed** organization gets 409 pointing at the bulk control; every real
      mutation writes an audit row and no no-op does
- [ ] Covered by `tests/routes/visitStewardship.test.ts`: the empty replace is refused with
      `EMPTY_STEWARDSHIP_MESSAGE`, a household from another ward is refused with a sentence rather
      than a foreign-key violation, and the replace is verified by re-reading with the service
      client
- [ ] Covered by `tests/lib/visitProgress.test.ts`: a do-not-contact household **inside** the
      stewardship stays in `rows`; one **outside** it is absent and is counted once, not twice

## Walkthrough record

**2026-08-27 — driven by Claude in a real browser (Playwright), signed in as the Primary
president, the Primary secretary and the EQ president in turn.** Screenshots reviewed by the user
separately. This is agent-driven evidence, not a person using the app.

Setup note: a dev server from an earlier session (started 18:26 the previous day, hours before this
slice's code) was holding port 3000. Killed and restarted before anything below was observed —
**the third time that trap has appeared** in this module's walks.

Every write below was **read back from the database with the service client**, never confirmed from
the screen alone.

### Observed — before narrowing, as the Primary president

- Panel: *"Measured against every household in the ward (22)."*
- Banner: **Overdue 1 · Never visited 17 · Approaching 1 · On track 1**, summing to the counted
  total of **20**, with *"5% of 20 counted households on track."* and *"2 households marked do not
  contact are not counted."*
- 22 rows in the table; Halvorsen and Sorensen both present, both badged `Do not contact`, neither
  banded.
- **No "All organizations" link** — cross-org visibility is off and the Primary president is not
  bishopric. ITER-007's failure mode avoided.

### Observed — the one press

- The picker opened with **exactly 8 households pre-ticked** — Ashworth, Brooks, Delacroix,
  Ferreira, Halvorsen, Nakamura, Okonkwo, Whitfield — matching the `member_organizations`
  derivation read independently from the database. **No manual ticking.** *"8 of 22 households
  chosen."*
- After **Save this stewardship**, with **no page reload**:
  - Banner: **Overdue 1 · Never visited 4 · Approaching 1 · On track 1** = **7**; *"14% of 7
    counted households on track."*
  - Stewardship line: *"Measured against 8 households in this stewardship · 14 in the ward are
    not."*
  - Table dropped to **8 rows** (7 banded + Halvorsen marked).
  - **`excluded` fell from 2 to 1** — Sorensen is now out of scope entirely and is counted in
    `outOfScope` alone, not in both. The two axes did not collapse into a double-count.
- Service-client read-back: **8 `household_stewardships` rows**, exactly those families,
  `created_by` set on all; audit row `stewardship_replaced {added:8, count:8, removed:0}`.
- **Halvorsen shown and marked with no band; Sorensen absent entirely** — the contrast the fixture
  exists for, visible on one screen.

### Observed — removing one, and the drift banner

- Unticking Whitfield and saving: denominator **6**, Whitfield gone from the table, stewardship
  line *"7 households … 15 in the ward are not."*
- Service-client read-back: **7 rows**, Whitfield absent; audit row
  `stewardship_replaced {added:0, count:7, removed:1}`.
- **The drift banner then appeared unprompted and named the household**: *"1 household now has a
  member of this organization but is not in the stewardship: Whitfield."* Not walked as a scripted
  step — it arrived correctly as a consequence, and naming rather than only counting is what the
  panel was built to do.

### Observed — the empty set, refused

- Unticking all 22: **Save is disabled** *and* the sentence reads *"Keep at least one household, or
  cancel and choose "Measure against the whole ward" to stop narrowing."*
- The whole-ward confirm names the number it will restore: **"Yes, measure against all 22"**.

### Observed — the Elders Quorum control (success criterion 2)

- **Denominator 20, 22 table rows, both do-not-contact households named in the excluded line, and
  no stewardship sentence in the banner at all.** Section summary reads "The whole ward".
- Bands 0 / 20 / 0 / 0 — the EQ has no visits of its own in this fixture — summing to 20.
- **Nothing about the EQ board moved when the Primary narrowed to 8.**

### Observed — the Primary secretary

- Panel renders the sentence and **zero buttons, zero checkboxes**. `visits.manage_goals` is
  correctly not held by `org_secretary`.

### Observed — layout

- **375px: 0px horizontal overflow**, desktop table correctly `md:`-hidden (`offsetParent === null`
  checked, so the card layout was what got measured — the trap scenario 045 recorded).
- **Every new control ≥ 44×44**: all 22 checkbox rows exactly 44px tall; panel buttons 44px
  (`Match my organization's members` 258×44, `Tick every household` 172×44, `Save this stewardship`
  176×44, `Cancel` 79×44, `Adjust…` 252×44, `Measure against the whole ward` 247×44). **No
  sub-44 target found.**
- `window.innerWidth` was checked before every layout measurement (1280 and 375 respectively).

### Defects found

1. **The household picker is stale after saving a stewardship, until a reload.** Immediately after
   saving, the "Log a visit" picker still offered all 22 households with **plain labels** — no
   "(not in your stewardship)" marks. After a reload the labels were exactly right: 13 marked
   *"(not in your stewardship)"*, 2 marked *"(do not contact)"*, 7 plain.

   **Cause:** the picker is built on the **server** in `app/(app)/visits/page.tsx` from
   `readStewardshipScope`. `StewardshipPanel.refresh()` invalidates the two TanStack queries, which
   updates the panel and the dashboard, but nothing re-runs the Server Component — there is no
   `router.refresh()`. The same class as `ai-a-client-and-settings`.

   **Consequence:** a leader who narrows and then immediately logs a visit cannot tell which
   families are theirs. Self-corrects on any navigation. Not data corruption.

   **DECIDED 2026-08-27 BY THE USER: LEAVE IT.** Narrowing a stewardship and logging a visit in
   the same breath is rare, the labels are right on the next load, and nothing is stored wrong.
   The fix, if this is ever revisited, is a `router.refresh()` beside the query invalidation in
   `StewardshipPanel.refresh()` — the picker is a Server Component and TanStack invalidation
   cannot reach it. Do not "discover" this again and treat it as new.

2. **Pre-existing, from ITER-018, not this slice: the goal sentence drops the number when the
   notice window is 1.** The banner read *"Every household, every 6 months. **Warning month
   ahead.**"* — missing "1". `goalSentence()` in `VisitProgressBanner.tsx` strips the leading
   `"Every "` from `describeCadence()`, and `describeCadence` drops the number when `amount === 1`
   ("Every month"), leaving a bare unit. Confirmed untouched by this slice via `git diff`; it
   originates in commit `8f71f90`. Scenario 045 used a 2-month window so it never surfaced. The
   EQ's own line read *"Warning 2 months ahead."* correctly, which pins the cause to `amount === 1`.

   **FIXED 2026-08-27, same day.** `describeDuration()` was added to `lib/visits/cadence.ts` — the
   phrase that answers "how long" rather than "how often", taking the article at one. The banner
   now reads *"Warning a month ahead."* `describeCadence()` is untouched, because the cadence half
   of the sentence ("every year") was always correct. `tests/lib/visitCadence.test.ts` pins the
   regression as a sentence, so a future edit that reintroduces a bare unit fails with a message
   naming what was on screen.

### Checklist corrections made during the walk

3. **The household count was wrong in the plan and in the first version of this file.** The plan's
   header said "24 households: 8 with a Primary child, 14 without, 2 do-not-contact", but its own
   breakdown sums to **22** — the two do-not-contact families are *inside* those two groups
   (Halvorsen among the 8, Sorensen among the 14), not additional. The seed implemented the
   self-consistent 22.

   Every dependent number was corrected **before** the walk, against values computed from the
   seeded database rather than from the screen: denominator before narrowing **22 → 20**, the
   headline **"3 of 22" → "3 of 20"**, households outside the stewardship **16 → 14**, and the
   whole-ward confirm **"back to 22" → "back to 20"**. The after-narrowing figure of **7** was
   correct as planned and is unchanged.

### Left unwalked

- **A real phone** was not used; 375px is an emulated viewport.
- **Dark mode and greyscale** were not exercised for the new panel. The band badges are unchanged
  from scenario 045, which verified them; the stewardship panel adds no new colour-carrying state.
- **Logging an actual visit to an out-of-stewardship household** was not completed — the picker
  labels were verified, but no visit was saved through that path. `tests/lib/visitProgress.test.ts`
  covers the labelling rule; the save path is unchanged by this slice.

## Notes

- The Elders Quorum is the **control** and its board is an assertion, not background. If its
  numbers move when the Primary narrows, the stewardship has leaked across organizations and that
  is the most serious thing this scenario can find.
- The seed writes **no stewardship rows at all**. Pressing the button is the scenario.
- Cross-org visibility is **off**, so the **All organizations** link should be **absent** for the
  Primary president and **present** for the bishop. Scenario 048 is where that view is walked.
