---
name: Every organization at once
scope: visits
part: 1
tags: [visits, full, stewardship, cross-org]
prerequisites: none
---

## Purpose

This view has no content of its own. Its entire content is **the relationship between three
organizations' data and one ward's households, at one instant** — and none of it can be arranged by
hand.

Three things are only real on this screen:

**A household nobody has claimed.** ITER-019 D3 makes a household outside an organization's
stewardship *vanish* from that organization's dashboard, which is right — an organization has
nothing to hand the next presidency about a family that was never theirs. What it creates is a
family invisible to **everybody**, and this page is the only place that shows up. Ravensworth is
that family, and its being sorted first, in the danger tone, is what made D3 safe to take.

**A "last seen" that disagrees with every dashboard.** Whitfield was visited by the **Relief
Society 12 days ago** and by the **Elders Quorum 300 days ago**, and the Primary **attempted** it
3 days ago. The ward-wide answer is *the Relief Society, 12 days ago* — which is not what the
Elders Quorum's own board says about the same family on the same day, and both are correct. The
attempt is more recent than either visit and must not win.

**The same page read by two different people.** The bishop and the RS president must now see the
*same* standings — migration 053 widened goals and cadences with the same ward setting that gates
this page, so an org leader reads every organization's progress, not just who claimed whom. That
reverses ITER-018's "a cadence is a presidency's private judgement" and ITER-019 D6, by a product
decision on 2026-08-27. You cannot check it without signing in twice, and the point is that
nothing differs.

**The pill is the whole vocabulary.** Each chip is the *same gauge pill* as your own board —
organization name, band colour, filled to show how far through the interval that family is — with
the band word dropped, because a reader who learned the colours managing their own organization
does not need it repeated three times per row. `Never visited` keeps its word: an empty pill with
no word is indistinguishable from a family at the very start of its interval, and those are
opposite situations. Hovering a pill gives the due date.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility **ON** |
| Households | **12**, each with one active adult |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), RS president (Ruth Delacroix), Primary president (Rosa Villanueva) |
| Goal — Elders Quorum | Every **1 year**, warning **2 months** ahead |
| Goal — Relief Society | Every **3 months**, warning **2 weeks** ahead |
| Goal — Primary | Every **6 months**, warning **1 month** ahead |
| Stewardship — Elders Quorum | **11** — everything except Ravensworth |
| Stewardship — Relief Society | **6** — Whitfield, Okonkwo, Ferreira, Nakamura, Delgado, Sorensen |
| Stewardship — Primary | **4** — Whitfield, Okonkwo, Brooks, Halvorsen |
| YM / YW / Sunday School | **Nothing seeded, no visit goal.** They must claim no household at all |
| **Whitfield** | claimed by **all three**; EQ **3-month override**; RS visit 12 days ago; EQ visit 300 days ago; Primary **attempt** 3 days ago |
| Okonkwo | claimed by **two** (EQ, RS, Primary — three, in fact); EQ visit 340 days ago → **Approaching** |
| Ferreira | claimed by EQ and RS; EQ visit 500 days ago → **Overdue** |
| **Ravensworth** | claimed by **nobody**, visited by nobody. *The row this page exists for* |
| Sorensen | **do-not-contact**, RS visit 600 days ago → shown, marked, **no band from anybody** |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-048-every-organization-at-once`
2. Kill anything already on port 3000, then `npm run dev` and open http://localhost:3000.
3. Sign in as the **bishop**. On **Visits**, find the **All organizations** link and follow it.
4. Read the **top row** before anything else, and read the summary line above the table.
5. Find **Whitfield**. Count its chips and read its "Last seen" line carefully — the date, the
   organization, and the person.
6. Find **Sorensen**, then **Ravensworth**.
7. Sort by each column, in both directions.
8. Sign out; sign in as the **RS president** and open the same page. Compare Whitfield's chips
   with what you saw in step 5.
9. As the **bishop**, go to **Admin** and turn cross-organization visibility **off**.
10. Sign in as the **RS president** again and look at the **Visits** page.
11. Narrow to 375px and read the whole table again.

## Verification Checklist

### Machine-checkable

- [ ] **Ravensworth sorts first** and reads *"No organization has claimed this household"*
- [ ] The summary above the table says **1 household is in no organization's stewardship**
- [ ] **Whitfield shows three chips** — Elders Quorum, Relief Society, Primary
- [ ] **Ferreira shows two**; **Ravensworth shows none**
- [ ] **Brooks shows exactly two** — Elders Quorum and Primary. **Young Men, Young Women, Sunday
      School and the Bishopric appear on no row anywhere**, having no visit goal, even though
      none of them has narrowed anything
- [ ] Each chip is the **same gauge pill as your own board**: organization name, band colour, and
      a fill showing how far through the interval that family is
- [ ] **No chip carries a band word** — except `Never visited`, which keeps it
- [ ] **No chip carries an explanatory sentence** of any kind
- [ ] **Hovering a pill shows the due date**; a never-visited pill has no due date and no tooltip
- [ ] Whitfield's **"Last seen" names the Relief Society**, 12 days ago
- [ ] Whitfield's "Last seen" names **who went — the bishop, Mark Andersen** — and **not** Ruth
      Delacroix, who recorded it
- [ ] The Primary's **attempt 3 days ago does not appear as "last seen"**, anywhere
- [ ] **As the bishop, every chip carries a band**
- [ ] **As the RS president, every chip carries a band too** — the Elders Quorum's `Overdue` and
      the Primary's `Never visited` on Whitfield are both visible to them, which is the ITER-018
      reversal working
- [ ] **The bishop's page and the RS president's page show the same standings**, row for row and
      pill for pill
- [ ] **Sorensen is shown, marked do-not-contact, and carries no band from any organization**,
      despite a 600-day-old visit against a 3-month cadence
- [ ] With cross-org visibility **off**, the RS president finds **no "All organizations" link at
      all** on the Visits page — absent, not present-and-refusing (ITER-007's failure mode)
- [ ] Navigating directly to `/visits/all-organizations` as the RS president with visibility off
      shows the **"turned off for this ward"** message, not a 500 and not an empty table
- [ ] Cards below `md:`, table at and above it; **no horizontal page scroll at 375px**
- [ ] **`window.innerWidth` was checked before any layout measurement was trusted**

### Needs a human eye

- [ ] The unclaimed row at the top: does it read as **a problem to fix**, or does it read as an
      error in the app?
- [ ] Whitfield reads *"Last seen: Relief Society, 12 days ago"* here while the Elders Quorum's own
      board says something quite different about the same family. Is that **legible as correct**,
      or does it read as two screens disagreeing?
- [ ] **The pills carry no words now.** Reading a row of two or three coloured, part-filled pills:
      can you tell at a glance how each organization is doing with that family, or do you find
      yourself wanting the word back?
- [ ] Does `Never visited` keeping its word, while the other three bands lose theirs, read as a
      deliberate exception or as an inconsistency?
- [ ] Three or four chips on one row at 375px: is that still readable, or does the row become a
      wall of pills?
- [ ] **The due date is only on hover.** Is that enough, or does the date need to be somewhere a
      phone can reach?
- [ ] Does the summary line at the top tell you what to **do**, or only what is true?
- [ ] Sorensen carries history and no band. On a page about coverage, does that read as
      "deliberately set aside" or as "missing"?

## Failure Behavior

- [ ] Covered by `tests/rls/visit-cross-org.test.ts`: with the setting **on** an org leader reads
      **both** organizations' stewardship claims, while cadences and goals stay narrow — the D6
      contrast, asserted in one file a few lines apart
- [ ] Covered by `tests/rls/household-stewardships.test.ts`: with the setting **off** an org leader
      reads only their own claims; writes never widen in either mode
- [ ] Covered by `tests/lib/allOrgProgress.test.ts`: the Bishopric is never a claimant, an attempt
      never wins "last seen", a steward whose goal is absent gets a null band, and the comparator
      puts unclaimed above everything
- [ ] A household with no active members never reaches this page at all — a third exclusion,
      distinct from both do-not-contact and unclaimed

## Walkthrough record

**2026-08-27 — driven by Claude in a real browser (Playwright), signed in as the bishop and the RS
president in turn, with cross-org visibility flipped off and back on mid-walk.** Screenshots
reviewed by the user separately. This is agent-driven evidence, not a person using the app.

The fixture was verified against the database before the page was opened: 12 households, the three
visiting stewardships at 11 / 6 / 4, YM/YW/SS at 1 each, **Ravensworth claimed by nobody**, and
Whitfield carrying an RS visit 2026-08-15, an EQ visit 2025-10-31 and a Primary **attempt**
2026-08-24 — the attempt being the most recent of the three, deliberately.

### Observed — as the bishop

- **Ravensworth sorts first**, flagged `!`, reading *"No organization has claimed this
  household"*. Summary above the table: *"1 household is in no organization's stewardship."*
- Tier line: *"Every organization's standing is shown, because you can read every organization's
  visit goal."*
- **Whitfield carries three chips** — `! Elders Quorum · Overdue`, `○ Primary · Never visited`,
  `✓ Relief Society · On track`. **Three organizations, three different answers about one family,
  at one instant.**
- **Whitfield's "Last seen" reads *"Aug 15, 2026 · Relief Society · Visited by Mark Andersen"***.
  Both halves of the headline claim hold: the **more recent Primary attempt (Aug 24) did not win**,
  and the line names **who went** (the bishop, a participant) rather than **who recorded it** (Ruth
  Delacroix, the RS president).
- **The Bishopric appears as a steward of nothing**, on any row.
- Ferreira `! Elders Quorum · Overdue`; Okonkwo `◑ Elders Quorum · Approaching`; Brooks
  `✓ Elders Quorum · On track` — every band matched the arithmetic computed from the seed dates
  before the page was opened.
- **Sorensen** is shown, marked `(do not contact)`, and carries **no band from any organization**
  despite a 600-day-old visit against a 3-month cadence.
- 12 rows total.

### Observed — as the RS president, the D6 reader tier

- Tier line: *"Only your own organization's standing is shown. How another organization judges its
  own progress stays with that presidency…"*
- **Whitfield still shows all three chips, and only the Relief Society one carries a band**:
  `Elders Quorum` (bare), `Primary` (bare), `✓ Relief Society · On track`.
- **The ward-wide "Last seen" is identical to what the bishop saw** — *"Aug 15, 2026 · Relief
  Society · Visited by Mark Andersen"*.
- Still 12 rows, still Ravensworth first, still *"1 household is in no organization's
  stewardship."*

  **Facts widened; judgements did not — and no `if (isBishopric)` produced that.** The chips came
  from `household_stewardships_select` (widened, migration 052); the missing bands came from
  `visit_goals_select` (deliberately not widened). Exactly ITER-019 D6, observed end to end.

### Observed — cross-org visibility turned off

- The **"All organizations" link is absent** from the RS president's Visits page — absent, not
  present-and-refusing (ITER-007's failure mode).
- Navigating directly to `/visits/all-organizations` renders **"Not permitted"** with the specific
  sentence *"Seeing every organization at once is turned off for this ward…"*, **no table, and no
  household name anywhere in the DOM**. Not a 500, not an empty table.

### Observed — sorting (all four columns, both directions)

Exercised per column, which scenario 045's walk had left undone. All correct:

- **Default (Priority):** Ravensworth (unclaimed) → the four RS `never_visited` families → Whitfield
  (`on_track`) → the six unbanded. Within the unbanded group: **never-seen first, then by name** —
  Halvorsen, Kowalski, Lindqvist, Mbeki (never seen), then Brooks, Sorensen (seen). Steps 3 and 4
  of the documented comparator, both firing.
- **Last seen:** **nulls sort last in BOTH directions**, the rule `VisitProgressTable` already
  keeps — the never-seen families stayed grouped at the end whichever way the arrow pointed.
- **Organizations:** fewest claimants first ascending — Ravensworth (0), then the 1-chip families,
  up to Brooks (5).
- **Household:** plain alphabetical, both ways.

### Observed — layout

- **375px: 0px horizontal overflow**, desktop table correctly `md:`-hidden (`offsetParent === null`
  checked before trusting the measurement), cards render, Ravensworth still first, and the sort
  control survives the collapse at 44px tall.

### Defects found

1. **The un-banded chip's tooltip asserts a cause it does not know, and is wrong in most cases.**
   Every chip with `priority === null` renders `title="Only this organization can see how it is
   doing."` — but a null band has **four** causes and that sentence names only one of them:

   | Observed | Real cause | Is the sentence true? |
   |---|---|---|
   | Brooks → Young Men / Young Women / Sunday School, read by the **bishop** | those organizations have **no visit goal** | **No** — the bishop can read every goal |
   | Sorensen → Elders Quorum / Relief Society, read by the **bishop** | the household is **do-not-contact**, not on the scale at all | **No** |
   | Whitfield → Elders Quorum / Primary, read by the **RS president** | RLS withheld the goal | **Yes** |

   So it is right in one of the three states this walk actually reached. `lib/visits/allOrgRows.ts`
   says of the four causes that *"all four render the same way, because 'no band' is the honest
   answer in every case"* — true of the **pill**, but the **tooltip** breaks that by naming a cause.

   **Introduced by this slice**, in `AllOrganizationsTable.StewardChip`. **Not fixed during the
   walk** — reported for a decision, because the fix is a wording question (drop the tooltip, or
   carry the reason through from the builder, which would mean a new field on `AllOrgSteward`).

### Notes carried forward

2. The **YM / YW / Sunday School stewardships in this fixture remain a workaround**, as the seed
   header and the Notes below already record. This walk confirms why they were needed: **Brooks
   visibly carries five chips**, three of them organizations that do no household visiting. In a
   real ward those three would be un-narrowed and would claim **every** household, making
   `unclaimed` permanently false and this page unable to do its job. **Success criterion 6 is
   reachable only because the fixture narrowed them by hand.** Still an open product decision.

### Changed after the user reviewed the screenshots, same day

The user answered the judgement questions and asked for three changes. **The observations above
describe the version that was walked, not the version now in the repo** — this scenario needs
re-walking before it can be called confirmed.

- **Cross-org visibility now widens progress, not just coverage.** Migration 053 adds
  `ward_allows_cross_org_visibility()` to `visit_goals_select` and
  `household_visit_cadences_select`, reversing ITER-018 and ITER-019 D6. The user's judgement:
  *"with the visibility of other organizations progress being turned on ... we should be able to
  see how they think they are doing by the pills."* The cadence had to follow the goal — a band
  prefers the per-household override, so widening the goal alone would have shown a pill computed
  from the wrong interval. **The RS president now sees every chip banded**, where the walk above
  recorded only the Relief Society one.
- **The chips are the gauge pill, with no words.** `GaugePill` was extracted from
  `VisitProgressTable` so the two tables cannot drift, and the chips render it with
  `showBandWord={false}` and the organization name as a prefix. `never_visited` keeps its word —
  an empty pill with no word is indistinguishable from a family at the start of its interval. The
  due date moved to a `title` on hover.
- **Defect 1 is fixed, by removal.** The tooltip that asserted a privacy reason is gone entirely,
  and so are both of the states it was covering: an organization with no usable goal is no longer
  a claimant, and every goal is now readable by every reader of this page. The remaining null band
  has exactly one cause — a do-not-contact household — which the row already states once.
- **The YM / YW / Sunday School workaround is deleted from the seed.** Brooks should now carry
  **two** chips rather than five. See the Notes.

### Left unwalked

- **A real phone** was not used; 375px is an emulated viewport.
- **Dark mode and greyscale** were not exercised on this page. The band pills are the shared
  `bandStyles.ts` tokens that scenario 045 verified in both themes and in greyscale; the chips add
  no new colour-carrying state, but the *chip* form factor was not re-checked in greyscale.
- **The bishop's admin toggle was not used** to flip cross-org visibility — the setting was flipped
  with the service client instead, because `/admin`'s toggle is scenario 042's subject and is
  covered there. The **effect** of the setting was walked in full on this page.

## Notes

**An organization claims households only if it has a visit goal**, and that rule is what this
fixture's YM / YW / Sunday School organizations exist to prove. They are in the ward, they have
narrowed nothing, and they claim nobody.

The first version of this scenario had to narrow those three to a token household each, purely so
they would stop claiming all twelve and let Ravensworth be unclaimed. The walk on 2026-08-27
recorded that workaround as a finding: in a real ward that had not done the same, no household
could ever be unclaimed and this page could not do its job. **Brooks carried five chips**, three of
them organizations that will never visit anybody.

The fix replaced a hardcoded "not the Bishopric" exclusion — a special case standing in for the
general rule it could not express. A visit goal is the honest test of *does this organization visit
households*, because it is the thing an organization sets when it decides to.

That rule was rejected once, on the grounds that goals are not readable across organizations and
`unclaimed` would give different answers to different readers. Migration 053 removed the objection
by widening `visit_goals_select` for the same ward setting that gates this page: everyone who can
reach this view reads every goal. **If that widening is ever reversed, the claimant rule becomes
reader-dependent and must be reconsidered with it.**
