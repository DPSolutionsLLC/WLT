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
opposite situations. The due date rides with the pill: on hover on the table, and written out
beside it on the phone cards, because a tooltip is unreachable by touch.

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
- [ ] **On the table, hovering a pill shows the due date**; a never-visited pill has no due date
      and no tooltip
- [ ] **On the phone cards, the due date is written out beside its pill** — `Due Jan 31, 2026`
      next to Whitfield's Elders Quorum pill — because a `title` is unreachable by touch. A
      never-visited pill still shows no date, and a do-not-contact household shows none at all.
      **Added 2026-08-27**, replacing a judgement question asking whether hover alone was enough;
      the reader answered that it was not
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
- [x] ~~**The due date is only on hover.** Is that enough, or does the date need to be somewhere a
      phone can reach?~~ **Answered 2026-08-27: it needed to be reachable by phone.** The cards now
      write the date beside each pill, and this became the machine-checkable line above. Kept
      struck through rather than deleted, because the answer is why that line exists.
- [ ] Does the summary line at the top tell you what to **do**, or only what is true?
- [ ] Sorensen carries history and no band. On a page about coverage, does that read as
      "deliberately set aside" or as "missing"?

## Failure Behavior

- [ ] Covered by `tests/rls/visit-cross-org.test.ts`: with the setting **on** an org leader reads
      **every** organization's stewardship claims, visit goals **and** per-household cadences —
      all four tables, asserted on both sides of the setting in one file. **Corrected on
      2026-08-27:** this line used to say cadences and goals "stay narrow — the D6 contrast", which
      migration 053 reversed. The old wording described the build walked earlier that day
- [ ] Covered by `tests/rls/household-stewardships.test.ts`: with the setting **off** an org leader
      reads only their own claims; writes never widen in either mode
- [ ] Covered by `tests/lib/allOrgProgress.test.ts`: an organization with no visit goal is never a
      claimant, an attempt never wins "last seen", and the comparator puts unclaimed above
      everything. **Corrected on 2026-08-27:** "the Bishopric is never a claimant" named the
      hardcoded exclusion this slice replaced; the Bishopric is now excluded because it has no
      goal, which is the general rule, and "a steward whose goal is absent gets a null band" is
      unreachable for the same reason — no goal means no chip at all
- [ ] A household with no active members never reaches this page at all — a third exclusion,
      distinct from both do-not-contact and unclaimed

## Walkthrough record

> **Two walks are recorded below, and the FIRST ONE IS SUPERSEDED.** Walk 1 describes the build as
> it stood before the user's review on 2026-08-27; walk 2 re-walked the same scenario after the
> three changes that review asked for. **Read walk 2 for what the app does now.** Walk 1 is kept
> because the defect it found and the reasoning it records are why walk 2's build looks as it does.

---

## Walk 1 — 2026-08-27 — SUPERSEDED, describes the pre-review build

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

---

## Walk 2 — 2026-08-27 — the re-walk after the review. **This is the current build.**

**2026-08-27 — driven by Claude in a real browser (Playwright), signed in as the bishop and the RS
president in turn, at 1440px and 375px, in light and dark, with cross-org visibility flipped off and
back on mid-walk.** Screenshots in `walk-048/`. This is agent-driven evidence, not a person using
the app.

Run against a dev server started fresh for this walk after confirming **nothing was listening on
3000 or 3001** — the stale-server trap that had caught three walks in a row. Verified by
`Get-NetTCPConnection` before starting and by reading back PID 20700 on port 3000 after.
`window.innerWidth` was read and asserted before **every** layout claim below.

**Automated first:** `tests/rls/visit-cross-org.test.ts`, `tests/rls/household-stewardships.test.ts`,
`tests/lib/allOrgProgress.test.ts` and `tests/db/migrations.test.ts` — **70 passed, 0 failed**.
`migrations.test.ts` passing is what proves 053 is applied to the hosted project and not held back.
`npm run harness:typecheck` clean after the seed edits below.

**Fixture read back from the database before the page was opened** (service client, not the screen):
12 households; Sorensen do-not-contact; stewardships EQ 11 / RS 6 / Primary 4; **Ravensworth claimed
by nobody**; goals on EQ (1 year), RS (3 months), Primary (6 months) and **no goal on Bishopric,
Sunday School, Young Men or Young Women**; the EQ's 3-month override on Whitfield; and Whitfield's
RS visit 2026-08-15 (participant **Mark Andersen**, recorder Ruth Delacroix), EQ visit 2025-10-31,
and Primary **attempt** 2026-08-24 — the attempt the most recent of the three, deliberately.

### Observed — migration 053 proved at the policy, not the screen

Signed in as each user with the anon client and read the four tables directly. **The RS president
and the bishop return identical sets:** all three visit goals, and the Elders Quorum's Whitfield
cadence override. `visit_private_notes` returns zero rows for both — wider reads on shared work did
not widen a private note by one row (CLAUDE.md rule 5).

### Observed — the bishop and the RS president, diffed row for row

Both pages were scraped with the same script and compared field by field — household, flag, last
seen, and for every chip its text, its `sr-only` word, its `title` and its **fill percentage**.

**12 rows, 21 chips, zero differences.** Not "looked the same" — identical on every compared field.

The sharpest single proof is Whitfield's Elders Quorum pill, which reads **`Due Jan 31, 2026`** for
the RS president. That date is reachable only through the EQ's private **3-month override**; the
EQ's plain 1-year goal would put it at Oct 31, 2026 and the pill would have read on-track. So the
**cadence widened alongside the goal**, exactly as migration 053 argued it had to.

### Observed — the chips are the gauge pill

| Household | Chips | Pills as rendered |
|---|---|---|
| Ravensworth | **0** | *"No organization has claimed this household"*, flagged `!`, danger tone, **sorted first** |
| Whitfield | **3** | `! Elders Quorum` fill **100%** · `○ Primary · Never visited` fill 0% · `✓ Relief Society` fill **13.04%** |
| Okonkwo | 3 | `◑ Elders Quorum` fill **93.15%** · Primary and RS never-visited |
| Ferreira | 2 | `! Elders Quorum` fill 100% · `○ Relief Society · Never visited` |
| **Brooks** | **2** | `✓ Elders Quorum` fill **8.22%** · `○ Primary · Never visited` — **five in walk 1** |
| Sorensen | 2 | `Elders Quorum`, `Relief Society` — **neutral, no mark, no fill, no band, no tooltip** |

- **No band word on any chip** except `Never visited`, which keeps it. Confirmed by reading the
  rendered text rather than by eye.
- **The band word lives in `sr-only`** — `position:absolute; width:1px; height:1px; clip:inset(50%)`,
  `display:block`, so it is clipped but still in the accessibility tree. Playwright's accessibility
  snapshot of Whitfield's cell reads **"Elders Quorum Overdue Primary · Never visited Relief Society
  On track"** — every band announced, properly separated. The `!` `○` `◑` `✓` marks are `aria-hidden`
  and correctly excluded from the computed name.
- **The due date is on `title`**, and surfaces as the pill's accessible description (`Due Jan 31,
  2026`). A never-visited pill has **no title at all** — not an invented one.
- **No chip carries an explanatory sentence.** Walk 1's defect is gone by removal, as intended.
- **Four bands, four distinct colours AND four distinct marks**, verified as computed styles in both
  themes: light `#b91c1c` / `#b45309` / `#15803d`; dark `#f87171` / `#fbbf24` / `#4ade80`. The fill
  is a tint at 0.15–0.25 alpha behind unchanged text, so the greyscale separation rests on the marks.

### Observed — an organization claims households only if it has a visit goal

**Young Men, Young Women, Sunday School and the Bishopric appear on no row anywhere** — scanned
across all 21 chips on both readers' pages. None of them has narrowed anything; all four are absent
purely for having no visit goal. Brooks carrying **two** chips instead of five is the same rule seen
from the other side. Walk 1's "Notes carried forward" item is resolved: the seed no longer narrows
those three by hand, and success criterion 6 is now reachable without a workaround.

### Observed — "last seen", and the attempt that must not win

Whitfield reads **"Aug 15, 2026 · Relief Society · Visited by Mark Andersen"** — identical for both
readers. All three claims hold at once: the **more recent Primary attempt (Aug 24) did not win**;
the line names the **Relief Society**, disagreeing with the Elders Quorum's own board about the same
family on the same day, both correct; and it credits **who went** (Mark Andersen, the bishop) rather
than **who recorded it** (Ruth Delacroix). A visit with an empty participant list reads *"Nobody
recorded as visiting"* rather than falling back to the recorder.

### Observed — sorting (all four columns, both directions)

- **Priority (default):** Ravensworth → Delgado, Halvorsen, Kowalski, Lindqvist, Mbeki, Nakamura →
  Brooks, Ferreira, Okonkwo, Whitfield → Sorensen. Matches `compareAllOrgRows` exactly. See the
  finding below about what this order now means.
- **Household:** plain alphabetical both ways.
- **Last seen:** **nulls last in BOTH directions** — the seven never-seen families stayed grouped at
  the end whichever way the arrow pointed.
- **Organizations:** fewest claimants first ascending — Ravensworth (0), the three 1-chip families,
  the 2s, then Okonkwo and Whitfield (3). **No 5-chip household exists any more.**

### Observed — cross-org visibility turned off

- The **"All organizations" link is absent** from the RS president's Visits page — zero matching
  anchors and the string "All organizations" nowhere in the body. Absent, not present-and-refusing.
- Navigating directly renders **"Not permitted — Seeing every organization at once is turned off for
  this ward…"**, with **no table and no household name anywhere in the DOM** (all twelve family names
  searched for in the full outer HTML). Not a 500, not an empty table.
- Setting flipped and restored with the service client and **read back from `wards.settings` both
  times** (`false`, then `true`) — never confirmed from the screen.

### Observed — layout and theme

- **375px: no horizontal overflow** (`innerWidth` 375, `scrollWidth` 360). Desktop table confirmed
  `md:`-hidden via `offsetParent === null` **before** any measurement was trusted; cards render;
  Ravensworth still first with a danger border; the sort control survives the collapse at **44px**.
- **Dark mode walked on this page for the first time** — walk 1 left it unwalked. All four bands
  resolve to distinct lighter tokens and the neutral pill stays muted.
- **Zero console errors and zero warnings** across the entire walk. **No raw UUID on screen.**

### Defects found

1. **The Admin toggle no longer describes what the setting does.** `CROSS_ORG_VISIBILITY_STATE_LABELS`
   and `CROSS_ORG_VISIBILITY_SCOPE_NOTE` still describe this setting purely in terms of **visit
   reports** — "Every organization's leaders can read every organization's visit reports." After
   migrations 052 and 053 the same setting also widens **stewardship claims, visit goals, and
   per-household cadence overrides**.

   So a bishop is told he is sharing reports, and is in fact also publishing every organization's
   goals and its private per-family judgements — the Elders Quorum's "hold the Whitfields to three
   months" becomes readable by the Relief Society president. That is a deliberate product decision,
   but the sentence read at the moment of deciding does not say so.

   Confirmed on screen (`Currently on. Every organization's leaders can read every organization's
   visit reports.`) and in the `window.confirm` dialog, which was opened during the walk. The same
   two strings also reach **the notification sent to the other two bishopric members**
   (`app/api/ward-settings/cross-org-visibility/route.ts:109`) and the **visit feed header**
   (`app/(app)/visits/feed/page.tsx:66`) — four surfaces, one understatement.

   **Not fixed during the walk** — it is a wording decision, and the copy is shared.

2. **"Priority" no longer orders by urgency in a way a reader can act on.** `never_visited` outranks
   `overdue` (ITER-018 D3), and `mostUrgentVisiblePriority` takes the **most urgent** band across a
   household's organizations. Now that every claiming organization contributes a band, **any**
   organization that has never visited a family pins that whole row to the top bucket — so **ten of
   twelve rows tie**, and the tie is broken by never-seen-ward-wide and then alphabetically.

   The visible consequence: **Brooks (on track, seen 31 days ago) sorts ABOVE Ferreira (overdue by
   16 months) and above Whitfield (overdue against a 3-month override)** — purely because Brooks
   comes first alphabetically among the ten that tie. The default column of this page ranks a
   healthy family above two neglected ones.

   Every individual rule here is behaving exactly as documented; it is the **combination** with the
   new claimant rule that flattens the order. **Not fixed during the walk** — reported for a
   decision, because the fix is a product question (does a newly-claiming organization's
   `never_visited` deserve to outrank a genuine overdue?), not a bug.

### Notes carried forward

3. **`AllOrgProgress.bandedOrgIds` is now computed, tested, and consumed by nothing.** Its comment
   says it exists "so the page can say plainly that it is showing one organization's bands rather
   than all of them" — the tier line that migration 053 removed. Harmless, but it documents a
   behaviour that no longer exists.

4. **`AllOrgSteward.priority`'s doc comment in `lib/visits/allOrgRows.ts` is stale.** It says null
   means "this reader may not see that organization's goal or cadence", that the table renders "an
   honest sentence", and lists four causes. After this slice the reader-tier cause is gone (053),
   the no-goal cause cannot occur (no goal means no chip), the honest sentence was deleted as walk
   1's defect, and **only do-not-contact remains reachable** — which the file header already says.
   Left unedited: it is app code, not scenario code.

### Corrections made to the scenario and its seed

- **`Failure Behavior`, first bullet** said `visit-cross-org.test.ts` proves "cadences and goals stay
  narrow — the D6 contrast". Migration 053 reversed exactly that, and the test now asserts the
  opposite. **Rewritten**, with the reversal named so it reads as a decision rather than a gap.
- **`Failure Behavior`, third bullet** said "the Bishopric is never a claimant" and "a steward whose
  goal is absent gets a null band". The first named the hardcoded exclusion this slice **replaced**;
  the second is now unreachable, because an organization with no goal has no chip at all.
  **Rewritten** to the general rule.
- **`seed.ts` — the reader-tier comment block** claimed "the RS president sees only the Relief
  Society chip banded — the other two name the organization with an honest sentence instead."
  **Both halves are now false** and the walk disproved them on screen. Replaced with the identical-
  pages result and the `Due Jan 31, 2026` proof that the cadence widened too.
- **`seed.ts` — the cadence-override comment** stated flatly that "household_visit_cadences is NOT
  widened by cross-org visibility … the RS president cannot read this row at all." **Directly
  contradicted by this walk.** Rewritten, with the old claim named as superseded.

These were fixture *documentation* wrong enough to mislead the next reader into thinking the page
was broken. `npm run harness:typecheck` passes after the edits, and the seed's behaviour is unchanged.

### Which of walk 1's recorded observations no longer hold

- ❌ *"Tier line: 'Every organization's standing is shown, because you can read every organization's
  visit goal.'"* — **both tier lines are gone.** One sentence now, for one reader tier.
- ❌ *"Whitfield still shows all three chips, and only the Relief Society one carries a band"* —
  **all three carry bands for the RS president now.**
- ❌ *"Facts widened; judgements did not"* — **judgements widened too.** That contrast was the whole
  of ITER-019 D6, and it is reversed.
- ❌ *"`! Elders Quorum · Overdue`, `✓ Relief Society · On track`"* — **the band words are gone**
  from the visible pill; they live in `sr-only`. `Never visited` keeps its word.
- ❌ *"Brooks visibly carries five chips"* — **two.**
- ❌ *"The Bishopric appears as a steward of nothing, on any row"* — still true, but **for a different
  reason**: it has no visit goal, not because it is the Bishopric.
- ❌ **Defect 1 of walk 1** (the un-banded chip's tooltip asserting a cause) — **fixed by removal,
  confirmed absent.**
- ✅ Still holding, re-verified: Ravensworth first and unclaimed; the summary line; "Last seen"
  naming the Relief Society and Mark Andersen; the attempt never winning; Sorensen shown, marked and
  unbanded; nulls-last sorting in both directions; the absent link and the "turned off" page; 375px
  with no overflow.

### Left unwalked

- **A real phone** was not used; 375px is an emulated viewport.
- **Greyscale** was not exercised. Light and dark both were, and all four bands carry a distinct
  mark as well as a distinct colour, but the chip form factor was not re-checked in greyscale.
- **The admin toggle was clicked and its confirmation dialog read**, which is further than walk 1
  got — but the dialog could not be accepted from the harness, so the setting was flipped with the
  service client as before. `/admin`'s toggle remains scenario 042's subject; its **wording** is
  defect 1 above.
- **No mutation happens on this page**, so there is no `audit_log` row to read back for it. The two
  setting flips bypassed the route deliberately and therefore wrote no audit row and sent no
  bishopric notification.

### Judgement answers, and the one change they produced — 2026-08-27, same day

The five judgement questions were put to the user with screenshots. **Four settled as they stand:**

- **The wordless pills read at a glance.** *"I like the way it looks."* No change.
- **`Never visited` keeping its word reads as a deliberate exception**, not an inconsistency —
  answered *"deliberate"*, which is the reading `GaugePill`'s band-aware rule was built for.
- **A three-chip row at 375px is still readable.** *"Looks good."* No change.
- **The summary line tells the reader what to do**, not only what is true. No change.

**One produced a change: the due date had to be reachable by phone.** *"It would be nice to be able
to reach it by phone too."*

A `title` is unreachable by touch, so on the card layout — the half of the page a phone actually
gets — the tooltip was not a second carrier of the due date, it was **no carrier at all**. The page
had been asserting in its own header comment that the tooltip was "a convenience rather than the
only carrier"; on this page, at this width, it was the only one.

**What changed**, in `app/(app)/visits/AllOrganizationsTable.tsx` and nowhere else:

- A new `StewardLines`, used **only by the phone cards**: one line per organization, the same
  `StewardChip` followed by `Due Jan 31, 2026` as visible muted text. A `never_visited` pill has no
  due date and gets no text — the same rule `GaugePill` applies to its tooltip, so the two cannot
  disagree about which pills have a date. A do-not-contact household shows none at all.
- **The desktop table is untouched** and keeps the compact wrap plus the tooltip. Verified after
  the change: no visible "Due" text in the chip cell, both tooltips intact, 0px overflow. Three
  organizations' dates spelled out in a table cell would wrap to three lines per row and cost
  exactly the scan the wordless pills were introduced to buy.
- **The summary card's last sentence was corrected.** It said *"Hover a pill for the date the next
  visit is due"* — true of the table and **false of the cards**. It now names both layouts.

**Verified in the browser at 375px after the change** (`window.innerWidth` read first, as always):

| Whitfield's card | Rendered |
|---|---|
| Elders Quorum | `! Elders Quorum` · **`Due Jan 31, 2026`** |
| Primary | `○ Primary · Never visited` — **no date**, correctly |
| Relief Society | `✓ Relief Society` · **`Due Nov 15, 2026`** |

Sorensen's two do-not-contact rows contain **only** the neutral pill, with no date span — confirmed
by reading each `li`'s child elements, after a first scrape produced a false positive by matching
the neutral pill's own `text-muted` class. **No horizontal overflow** at 375px
(`scrollWidth` 360). `npm run typecheck`, `npm run lint` and `tests/lib/allOrgProgress.test.ts`
(24 passed) all clean afterwards.

**Still open, and not decided:** defects 1 and 2 above — the Admin toggle's wording, and the default
Priority ordering. Neither was raised in the answers, and neither has been touched.

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
