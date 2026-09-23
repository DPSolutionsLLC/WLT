---
name: One Sunday, six pills, and the page each one opens
scope: P4
part: 1
tags: [talks, sacrament, full, p4]
prerequisites: none
---

## Purpose

The Sacrament hub's whole value is that **a pill's count matches the page behind it**. That needs
a month of Sundays in deliberately different states of completeness, which is tedious to build by
hand and is exactly the mismatch a green suite cannot see: ITER-022 shipped a summary reading
`Covered · 0` directly above an event card reading `Covered · 1`, because the summary type carried
the state and the date but not the **count**. Both numbers were correct; they only disagreed once
they were on screen together.

`p3-shell-and-tile-dashboard` is the second reason. **All four of its walk defects lived in the
seam between a layout and a page, and 3798 passing tests saw none of them** — route tests call
handlers directly and never render a layout. This slice adds a page under `app/(app)/`, moves a
page out of `app/(youth)/`, and changes what the dashboard offers. Every one of those is a seam.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | 3 — a bishop, a first counselor, and a Relief Society president |
| Members | 6 adults, one household each |
| Topics | 5, in the ward topic library |
| Sundays | 5 — all of August 2027, which opens on a Sunday |

| Sunday | State | What it is for |
|---|---|---|
| **08-01** | `fast_sunday`, `speaking_slots = 0`, one prayer | **No talk pills at all** — and prayers survive zero slots |
| **08-08** | Untouched, **no conductor** | Every pill `0/3` and **visible**; `Conducting: open` |
| **08-15** | 2 topics / **1 speaker**, 1 prayer, 2 hymns, no programme | The two talk pills **disagree** — the point of the slice |
| **08-22** | 3 topics / 3 speakers, 2 prayers, 3 hymns | Every pill **filled solid green** |
| **08-29** | `stake_conference` | No sacrament meeting: a sentence, **no pill row** |

| Sign in as | Role | What it is for |
|---|---|---|
| `bishop@harness.wardleadershiptools.test` | bishop | The whole hub |
| `counselor1@harness.wardleadershiptools.test` | counselor | Conducting 08-15 — a name that is not the bishop's |
| `rs-president@harness.wardleadershiptools.test` | org_president | **Holds no `talks.view`** — the refusal path |

**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> **`org_president` not holding `talks.view` is not the intuitive answer**, and a
> `music_coordinator` — who sounds further away — does hold it. `lib/auth/permissions.ts` is the
> source of truth (CLAUDE.md §8).

## Steps

1. `npm run seed -- talks/scenario-072-one-sunday-six-pills`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the bishop. Open the browser console and **leave it open**.
4. Read the dashboard. Count the Sacrament-related tiles.
5. Open `/calendar` **once** and check the database for a 12-month horizon. Open it a **second**
   time and check that nothing was written.
   ⚠️ **DO THIS BEFORE STEP 9.** The seed creates only the five Sundays of August 2027, so until
   the horizon has run there is nothing for the jumped-to card to sit *among* — step 9's
   "in date order" check has no content without it.
6. Open the Sacrament tile, then navigate to **August 2027** with the month controls.
7. Read the pill row on each of the five Sundays without clicking anything.
8. Click **every** pill on 08-15 and come back each time. Check the date you landed on.
9. Open `/music` from the nav and read the collapsed list. Then come back to 08-15 and press its
   Music pill, and read where you land, what is expanded, and what the back link says.
10. Resize to 375px and read the month again. Switch themes.
11. Sign out. Sign in as the Relief Society president and open `/sacrament` directly. Open
    `/calendar` as them and confirm it creates no Sundays.
12. Sign out. Sign in with the youth PIN account if one exists in your database, or simply open
    `/ordinances` and `/sacrament` and note where each lands.

## Verification Checklist

### Machine-checkable

- [ ] The dashboard shows **one Sacrament tile, not three** — the separate Talks and Prayers
      tiles are gone, and **Topics survives** as the ward topic library
- [ ] `/assignments` and `/prayers` typed directly **still work** — the routes were not touched,
      only their dashboard entry points
- [ ] **08-08 renders `Topics 0/3` and `Talks 0/3` — visible, not omitted.** An omitted empty
      slot reads as "failed to load", which looks correct enough that nobody reports it
- [ ] **08-15 reads `Topics 2/3` above `Talks 1/3`** — the two counts differ, and the page behind
      each shows exactly that many
- [ ] 08-15 reads `Prayer 1/2` and `Music 2/3`
- [ ] **08-01 shows NO Topics and NO Talks pill at all**, and still offers `Prayer 1/2` and
      `Music 0/3` — a fast Sunday has both prayers and three hymns, and no speakers.
      ⚠️ **CHANGED 2026-09-22 by the walk.** This used to ask for `0/0` in the complete tone;
      the user read that as a card that had failed to load. Keyed on `speaking_slots`, **not** on
      the Sunday type, so a ward zeroing the slots on an ordinary Sunday gets the same answer
- [ ] **08-29 shows a sentence naming the conference and NO pill row at all**
- [ ] 08-22 reads every pill full, including `Talks 3/3` — **the third speaker is external**
      (ITER-004), so a build counting only `member_id` shows `2/3` here
- [ ] **A complete pill is a SOLID GREEN FILL**; empty and partial stay outlined. Check **both
      themes**: the text is `text-background`, a token that inverts with the fill, so a literal
      colour would pass in light and fail in dark
- [ ] **The card itself opens that Sunday's programme** — press the date heading, or anywhere on
      the card that is not a pill
- [ ] **No link is nested inside another link.** The card is a stretched pseudo-element, not an
      `<a>` wrapping the pills, which would be invalid and unreachable by a screen reader
- [ ] **The conducting name is a link to the Sunday editor**, where the bishopric member can be
      changed for that Sunday. It is the ONLY route there now that the conducting pill is gone —
      including on 08-08, where it reads `open`
- [ ] **There is no Program pill and no Conducting pill.** Four pills per Sunday, not six
- [ ] **Every pill on 08-15 opens THAT Sunday**, not the nearest one — check the date on each
      landing page. The prototype shipped this exact bug (`openProgram(key)` ignored its key)
- [ ] The Prayer pill lands on `/prayers` **scrolled to 08-15**, not at the top of the month
- [ ] The Music pill on 08-15 opens **`/music` with the 08-15 card ALREADY EXPANDED**, its two
      chosen hymns visible — not a list to scroll, and not an empty page. **This is 072-D1
      re-armed**, and the fix was RESHAPED on 2026-09-23: `/music` is a collapsed rolling list
      again and the link INSERTS the jumped-to Sunday into it
- [ ] That card sits **in date order** among the ordinary upcoming Sundays, not pinned to the top
- [ ] The page shows **"Back to Sacrament Calendar"**, and pressing it returns to `/sacrament`
- [ ] `/music` opened from the **nav** shows the list **collapsed — nothing expanded** — and has
      **NO back link in the page at all**. The chrome bar's unconditional "← Dashboard" is the way
      home, and a second link beside it saying the same thing is the duplication the user removed
      on 2026-09-23. ⚠️ **CHANGED BY THE WALK** — this item used to require "Back to Dashboard"
- [ ] `/music?from=<anything unrecognised>` **also shows no back link** — never the raw value, and
      never a fallback
- [ ] Clicking a second card **closes the first**. One open at a time, never two
- [ ] The **Collapse** button inside an open card closes it
- [ ] A **Collapse all** control appears above the list **only while a card is open**, closes it,
      and then disappears. ⚠️ **There is deliberately NO "Expand all"** — §6.1's rule is
      single-open ⇔ jump target, and expanding everything is the `Set` that rule forbids on a page
      somebody is deep-linked into. Its absence is the design
- [ ] `/music?sunday=<a uuid that does not exist>` renders the ordinary collapsed list, no crash
- [ ] The card's completion pill reads `2/3 chosen` on 08-15 — **the same numbers as the hub's
      `Music 2/3` pill**, because both count `HYMNS_PER_SUNDAY`
- [ ] Each of the six pills is a **link** — focusable, reachable by Tab, no dimming
- [ ] 08-08 reads `Conducting: open`; 08-15 names the **counselor**, 08-22 the **bishop**
- [ ] `/talks/topics` is titled **"Topic library"** and is a different page from the Topics pill
- [ ] `/sacrament` as the Relief Society president gives the **"Not permitted" sentence** — not a
      500, and not an empty grid, which is a different claim
- [ ] **Zero console errors** on `/sacrament` and on `/dashboard`
- [ ] At 375px there is **no horizontal page scroll** and the month controls do not overflow
- [ ] **Every pill is at least 44×44.** ⚠️ **ADDED DURING THE WALK, 2026-09-22 — the checklist
      was written without it and nearly every other scenario in this harness has it.** These are
      the first INTERACTIVE `Pill`s in the app; every previous one was a badge, so `px-2 py-0.5
      text-xs` had never had to be a tap target before. **Was defect 072-D2; FIXED the same day**
      — the target grows on the anchor, so `Pill`'s badge shape is untouched everywhere else
- [ ] The month controls move between July, August and September and the pills re-read correctly

### The rolling 12-month horizon — slice 1

- [ ] As the bishop, open `/calendar` **once**. Then confirm in the database that the ward now
      holds a full year:
      `select count(*), min(date), max(date) from sundays where ward_id = '<ward>'` returns
      **52 or 53**, starting in the CURRENT month and ending 12 months later.
      ⚠️ **CORRECTED DURING THE WALK, 2026-09-23.** This item first asked for
      `date > current_date` returning **≥ 50**, which is wrong and would have failed a correct
      build: the horizon is **whole months from `monthStart(today)`**, so it deliberately includes
      the Sundays already past in the current month. Observed 52 total and **49** in the future.
      The whole-month range is what makes the coverage check exact — see
      `ensureHorizonGenerated()`'s header
- [ ] Re-open `/calendar`, and open it again on a **different month**.
      `select max(created_at) from sundays where ward_id = '<ward>'` is **unchanged** — the later
      visits wrote nothing, because the coverage check found the horizon already full
- [ ] **The seeded Sundays are not disturbed.** After the horizon runs, 08-01 is still
      `fast_sunday` with 0 slots and 08-29 is still `stake_conference`, **with their original
      ids** — `generateSundayRange()` inserts with `ignoreDuplicates`, and an overwrite here would
      silently discard every bishopric edit in the year
- [ ] **⚠️ THE `calendar.manage` GATE CANNOT BE WALKED IN THIS SCENARIO, and that is a fixture
      gap rather than a skipped check.** The gate only means something for somebody who holds
      `calendar.view` **and not** `calendar.manage`. This scenario's three users are a bishop and
      a counselor (both hold manage) and an `org_president`, who holds **neither** — so
      `/calendar` refuses them at the *view* gate and writes nothing for the wrong reason.
      The right fixture is a `music_coordinator`; **scenario 036 seeds one**, and the check lives
      there. At the table it is `tests/rls/calendar-access.test.ts`, which calls the page as a
      music_coordinator and was proved able to fail (swapping the actor to the bishop takes the
      ward from 1 Sunday to 52)

### The route move — Option A

- [ ] **`/ordinances` is the youth ordinance screen.** A `sacrament_manager` signing in by PIN
      lands there
- [ ] **`/sacrament` is the meeting hub** and an adult opening it is NOT bounced to `/dashboard`
- [ ] `/sacrament/ordinances` is a **404** — P11 has not built it, and the dashboard does not
      offer it

### Needs a human eye

- [ ] Reading one card answers "how ready is this Sunday" **without opening anything**
- [ ] `Topics` and `Talks` sitting side by side read as **two different questions**, not as one
      number rendered twice by mistake
- [ ] The empty, partial and complete tones are distinguishable **in both themes**, and no pill is
      legible in one and invisible in the other
- [ ] 08-01 does not read as **broken** — a Sunday with nothing to plan should look settled, not
      like a card that failed to load
- [ ] 08-29's sentence reads as a fact about the Sunday, not as an error
- [ ] The month of five cards at 375px is **scannable** — a leader should not have to zoom
- [ ] The Sacrament tile's blurb makes it clear this is the **meeting**, not the ordinance

## Failure Behavior

- [ ] A month with no Sundays generated shows the "not on the calendar yet" card and **creates
      nothing** — generating a month is a calendar write and stays on `/calendar`
- [ ] A hand-edited `?month=` of nonsense falls back to the current month rather than erroring —
      on `/sacrament` and `/prayers`. **On `/music` the parameter is dead** and is ignored
      silently; `?sunday=` of nonsense is ignored there too
- [ ] Automated: `tests/lib/sacramentSundayStatus.test.ts` pins every count,
      `tests/components/sacrament/SundayCard.test.tsx` pins the card's shape, and
      `tests/lib/navigationRoutesExist.test.ts` fails if `/sacrament` loses its page

## Walkthrough record

> **THE 072-D1 FIX IS NOW WALKED — 2026-09-23. See the second record at the end of this
> section.** The reshaped fix was driven in a real browser and verified against the database.
> The paragraph that follows is kept as the record of the window in which it was unwalked.
>
> **THE 072-D1 FIX WAS NOT WALKED WHEN FIRST SHIPPED, AND WAS RESHAPED ONCE — 2026-09-23.**
>
> First `/music` became a month board (`plans/p4-sacrament-music-month.md`, `06910f8`) and the
> walk was deliberately SKIPPED at the user's instruction. The user then saw that deployed and
> **reversed the mechanism the same day**: `/music` is a collapsed rolling list again, and the
> link inserts the jumped-to Sunday into it in date order — the prototype's own fix for this
> defect (`plans/music-collapsed-list-and-rolling-year.md`, module-map.md §6.2 item 6).
>
> **The defect and the diagnosis were right both times; only the mechanism moved.** The Music
> checklist items below are still **unverified in a browser**: lint, typecheck, the unit suite
> and a production build are green, and none of them can prove the destination opens the card the
> pill sent it to — which is exactly what 072-D1 was. Re-walk before trusting the Music pill.

**2026-09-22 — driven by Claude (agent) in a real browser; screenshots for the user to review.**
That distinction matters: this is agent-driven evidence, not a person using the app, and the
seven judgement checks were captured rather than answered.

Screenshots: `.walk/scenario-072/` (excluded from git via `.git/info/exclude`, deliberately kept).
Dev server on **port 3000** (3001 was refused — another `next dev` already held the directory).

### Observed — the pill row, read against the database

Every count below was cross-checked with a service-role read (`.walk/readback.mjs`), not taken
from the screen. **The UI and the database agreed on all 30 pills.**

| Sunday | Topics | Talks | Prayer | Music | Program | Conducting |
|---|---|---|---|---|---|---|
| Aug 1 `fast_sunday`, 0 slots | `0/0` complete | `0/0` complete | `1/2` | `0/3` | `0/2` | Mark Andersen |
| Aug 8 untouched | `0/3` | `0/3` | `0/2` | `0/3` | `0/2` | **open** |
| Aug 15 partial | **`2/3`** | **`1/3`** | `1/2` | `2/3` | `0/2` | Peter Nakamura |
| Aug 22 complete | `3/3` | `3/3` | `2/2` | `3/3` | `2/2` | Mark Andersen |
| Aug 29 `stake_conference` | *no pill row — "No sacrament meeting — Stake Conference."* | | | | | |

- **Dashboard: 14 tiles, was 15.** One `/sacrament`. `/assignments` and `/prayers` absent from
  the grid; both still answer **200** when typed. `/talks/topics` survives, titled **"Topic
  library"**.
- Routes: `/sacrament` **200** (h1 "Sacrament — September 2026" with no param),
  `/ordinances` **redirects an adult to `/dashboard`**, `/sacrament/ordinances` **404**.
- Tones resolve to real colours — `complete` `rgb(74,222,128)`, `partial` `rgb(251,191,36)`,
  `empty` `rgb(148,163,184)`. No interpolated-class bug.
- Shape: **24 pills, all `<A>`, 0 dimmed, 0 `tabindex="-1"`**.
- Prayer anchor: `/prayers?month=2027-08#sunday-11b5…` scrolled to **y=818** with the
  "Sunday, August 15" card at viewport top.
- **Zero console errors and zero warnings** on a clean `/sacrament` load.
- 375px: `scrollWidth 360 === clientWidth 360`, **0** elements past the viewport.
- Month nav: Next → `?month=2027-09`, "0 Sundays", the "not on the calendar yet" card. **The hub
  created nothing** — ward still holds exactly 5 `sundays` rows, September 2027 has 0.
- `org_president`: `/sacrament` renders **"Not permitted — Sacrament meeting planning is limited
  to ward leadership."** with a link back. Their dashboard has **5 tiles and no Sacrament**.

### Design changes made after the walk, on the user's review (2026-09-22)

Q1, Q2, Q3 and Q5 passed. Q4 produced four changes, all landed the same day:

1. **A complete pill is now a solid green fill**, empty and partial still outlined — the row is
   scanned, and weight survives skimming where hue does not.
2. **The Program pill is gone; the CARD opens the programme.** The user's model: pressing a
   Sunday shows what its programme will look like, incomplete parts included. The programme is
   the sum of the card, not one more item beside its parts.
3. **The Conducting pill is gone; the conducting NAME is now the link** to the Sunday editor,
   where the per-Sunday override already lives. Who conducts is a standing rotation, not a piece
   of outstanding work, and `1/1` put a settled fact in a row of unsettled ones.
4. **A Sunday with no speaking slots shows no talk pills at all** — see the checklist note.

**Still to come:** an `assignments` pill (who passes, blesses and prepares) is deliberately held
until P11 builds the adult ordinance screen, because a pill pointing at a route with no page is
the broken-link bug P3 closed.

### Defects found

**072-D1 — THE MUSIC PILL CANNOT REACH ITS OWN SUNDAY. FIXED 2026-09-22, RESHAPED 2026-09-23.**
Both records are kept, because the second is not a new defect and the first was not wrong.

*Fix 1 (`06910f8`, `plans/p4-sacrament-music-month.md`):* `/music` became a month board —
`?month=YYYY-MM`, `MonthNavigation`, two empty states — and `sundayPillHrefs()` sent it the
Sunday's own month plus an anchor, exactly as the Prayer pill already did.

*Fix 2 (`plans/music-collapsed-list-and-rolling-year.md`), on the user's decision after seeing
fix 1 deployed:* the month board is **reversed**. `/music` is the prototype's collapsed rolling
list of the next 8 Sundays, and the pill carries `?sunday=<id>&from=sacrament` — the page INSERTS
that Sunday into the list in date order and opens its card (module-map.md §6.2 item 6). A Sunday
a year out is reachable because the link puts it in the list, not because the reader navigated to
its month. `?month=` is now dead on `/music`.

The original finding, kept because the reasoning is what the next reader needs:

`Music 2/3` on Aug 15 links to
`/music`, which is a rolling **six-Sunday horizon from today** with no date parameter
(`HORIZON_SUNDAYS` in `app/(app)/music/page.tsx`). Aug 2027 is outside it, so the destination
renders *"The next 0 Sundays that hold a sacrament meeting"* and *"There are no sacrament
meetings on the calendar yet."* A pill reporting real, correct work lands on a page claiming
nothing exists. **This is the exact failure the hub was built to prevent**, and it is structural
rather than an artifact of a far-future seed: any Sunday more than ~6 weeks out behaves this way,
which is precisely the horizon a bishopric plans at. The page's own comment reasoned about not
sending a `?month=` the destination ignores, and missed that the destination cannot show the date
at all.

**072-D2 — EVERY PILL IS A 19px TAP TARGET.** 24 of 27 controls on the page are under 44×44.
`Pill` is `px-2 py-0.5 text-xs`, which was right for all ten of its previous callers because
every one of them was a **badge**. These are the first interactive Pills in the app, and nothing
in the primitive or its tests flagged the change of role. `min-h-11` is the established
convention across 10+ components.

### Checklist corrections made during the walk

- **Added a 44×44 check.** The checklist was written without one; nearly every other scenario in
  this harness has it. Its absence is what let D2 through the plan and the tests — and
  `SundayCard.test.tsx` asserts the pills are anchors and undimmed, which made them *look*
  thoroughly covered.
- **Sharpened the "opens THAT Sunday" check** to name the Music pill explicitly, since the
  original wording was satisfied by an href containing the right id and D1 is about the
  destination being unable to honour it.

### Not walked

- **The PIN sign-in flow.** This scenario seeds no `sacrament_manager`, so "a youth account
  signing in by PIN lands on `/ordinances`" was **not** driven end to end. What WAS verified:
  `/ordinances` exists in the youth shell and bounces an adult to `/dashboard`, and the three
  redirect strings are updated in source. Seeding a youth account here would be worth it.
- Both-themes and tap-target measurements were taken on the bishop's view only, not on the
  `org_president`'s refusal page.
- The counselor account was never signed in as; it exists to put a name that is not the bishop's
  on Aug 15's conducting line, which was verified from the bishop's view.

---

**2026-09-23 (second walk) — driven by Claude (agent) in a real browser; the reshaped 072-D1 fix
plus the 12-month Sunday horizon.** Agent-driven evidence, not a person using the app: every
machine-checkable item below was performed and read back through the service-role client
(`.walk/readback.mjs`), and the judgement items were captured as screenshots for the user rather
than answered.

Screenshots: `.walk/scenario-072-reshape/` (excluded from git via `.git/info/exclude`,
deliberately kept). Dev server on **port 3000**.

### Slice 1 — the rolling 12-month horizon

| Moment | `count(*)` | `max(created_at)` | Range |
|---|---|---|---|
| After seeding | **5** | 17:05:19.239 | 2027-08-01 → 2027-08-29 |
| After the bishop's **first** `/calendar` | **52** | 17:07:07.531 | **2026-09-06 → 2027-08-29** |
| After a visit to `?month=2026-10` | 52 | 17:07:07.531 | unchanged |
| After a **third** visit to `/calendar` | 52 | **17:07:07.531 — unchanged** | unchanged |

- **47 Sundays created in one visit**, spanning whole months from September 2026 to August 2027.
- **Repeat visits wrote nothing.** `max(created_at)` is identical across three loads, which is the
  coverage check doing its job — `calendar-c`'s "a read that re-runs writes on every page view" is
  the bug this had to avoid, and it did.
- **The seeded Sundays survived untouched**, with their original ids: 08-01 still `fast_sunday`
  with `speaking_slots = 0`, 08-29 still `stake_conference`. `ignoreDuplicates` held.
- **The generated year is correct, not merely present:** 2026-10-04 is general conference and is
  absent from the Music list, and October's fast Sunday has moved to **10-11** accordingly.

**FIRST-RUN COST, MEASURED AS THE PLAN ASKED — and it produced the one open defect below.**
Three timed `/calendar` fetches from the browser, dev server against the hosted project:

| Load | Wall time |
|---|---|
| First (creates 47 Sundays + conducting resolution) | **8 996 ms** |
| Second | 2 736 ms |
| Third | 2 865 ms |

So the horizon costs **~6.2 s once per ward**, on top of a 2.7 s baseline. Every later visit is
free. Reported rather than acted on: the plan names the alternative (move it behind the existing
`POST /api/sundays` and a button) and says explicitly **not** to shrink the horizon silently.
Measured in dev against a remote database, so production is likely faster — but not 6 s faster.

### Slice 2 — Music as a collapsed list

**The jump, end to end.** `Music 2/3` on 08-15 →
`/music?sunday=11b53542…&from=sacrament#sunday-11b53542…`:

- **9 Sundays**, and the 8 window rows are collapsed. August 15 2027 is **`aria-expanded="true"`**
  and sits **last — in date order**, after November 22 2026, not pinned to the top.
- `scrollY = 970`, with the card's top at **viewport y = 0**. The fragment scrolled it into view.
- The card reads **`2/3 chosen`** and *"One hymn still to choose."*, showing
  `19 — We Thank Thee, O God, for a Prophet` and `193 — I Stand All Amazed`, with the closing slot
  *"Not chosen yet"*. **The database holds exactly those two rows** (`opening 19`,
  `sacrament 193`) — the card, the hub pill and the table all agree.
- Back link: **"← Back to Sacrament Calendar" → `/sacrament`**.
- **Zero console errors and zero warnings.**

**Single-open, and the controls.**

- Opening October 18 **closed** August 15. Exactly one `aria-expanded="true"` at all times.
- **Collapse** (92 × 44) closed the open card: 0 open, and the button unmounted with its panel.
- **Keyboard:** Tab moves from one collapsed card to the next as a real `<button>`; **Enter opened
  the focused card and focus stayed on it.**
- Every summary row is **963 × 44** at desktop and 44 high at 375px. `aria-controls` points at the
  panel only while it exists, and the panel is present when it does.

**From the nav, with no parameters:** heading *"Music"*, **8 Sundays**, **0 expanded**, back link
**"← Back to Dashboard" → `/dashboard`**. No month navigation anywhere on the page.

> **⚠️ THAT LAST OBSERVATION IS NOW OUT OF DATE, AND IT IS WHY.** Seeing it beside the chrome
> bar's own unconditional "← Dashboard" — two back links, stacked, to the same place — the user
> decided on 2026-09-23 that the contextual link should render **only for a real origin**.
> `ContextualBackLink` now returns `null` when `from` is absent or unrecognised, and
> `tests/components/layout/ContextualBackLink.test.tsx` (6 tests, proved to fail if the fallback
> returns) pins it. The observation is kept because it is the evidence the decision was made
> from. The "Back to Sacrament Calendar" half is unchanged.

**Every fallback path, fetched and parsed (all 200, none crashed):**

| URL | Result |
|---|---|
| `?sunday=00000000-0000-4000-8000-000000000000` | ordinary list, 8 cards, 0 expanded |
| `?sunday=banana` | ordinary list — the uuid guard stopped it reaching Postgres |
| `?sunday=<the stake-conference Sunday>` | **ignored**, 8 cards — no card for a meeting not held |
| `?from=https://evil.example.com` | back link is **"Back to Dashboard" → `/dashboard`**, never the supplied string |
| `?from=toString` | **"Back to Dashboard"** — `Object.hasOwn` held; a bare lookup would have returned `Object.prototype.toString` and rendered `href={undefined}` |
| `?month=2027-08` | **ignored silently**, ordinary 8-card list |

**375px, both themes.** `scrollWidth 360 === clientWidth 360`, **no horizontal scroll**, and **zero
elements past the viewport**. Every *visible* control ≥ 44×44; the only sub-44 hits are 0 × 0
`Close` / `Clear this hymn` buttons inside **closed** `HymnSearchModal` dialogs — pre-existing
markup, not this slice. Rendered and captured in **dark and light**.


### Defect found after the walk, by answering Q4

**072-D3 — THE HORIZON COSTS ~14 s EVERY MONTH, NOT ONCE. OPEN; NOT FIXED, BY REQUEST.**

Reviewing Q4 the user accepted the 9-second first load on a stated premise — *"I guess we're
talking about very first initial login … I assume after that it'd be loading a week at a time
which would not really take any extra time at all"* — and said plainly that if the cost recurred,
*"we need to discuss something to do differently to try to remedy"*.

**The premise is wrong, so the measurement was taken.** Deleting one month from inside the
horizon (July 2027, 4 Sundays) leaves it exactly as a month rolling off the front does — short,
by the coverage check's reckoning. The next `/calendar` load:

| State of the horizon | Wall time |
|---|---|
| Complete (52 of 52) | **2 720 ms** |
| **Short by ONE month (48 of 52)** | **14 216 ms** |
| First ever run, 5 of 52 present | 8 996 ms |

**Short by four Sundays is SLOWER than empty.** The cause is that `ensureHorizonGenerated()` calls
`generateSundayRange(from, to)` for the **whole 12-month range** whenever the count falls short.
The insert itself is cheap — `ignoreDuplicates` means only the 4 missing rows land — but the three
passes that follow are not: `resolveMonth()` runs once per month **for all twelve**, and
`populateConducting()` / `populateOrgConducting()` sweep the entire year, now against a fuller
table than the first run had.

**So the cost is monthly, not one-off:** the first person holding `calendar.manage` to open the
calendar after the window rolls forward pays ~14 s. Every other visit that month is ~2.7 s.

**The fix is contained and is NOT applied here**, because the user asked to discuss it rather than
have it changed: generate only the months that are actually missing instead of the whole range.
`sundaysInRange()` already produces the expected dates and the existing rows are one query away, so
the gap is computable — and a one-month generation is precisely what `ensureMonthGenerated()`
already costs on a fresh month. That keeps the no-op path untouched and turns the monthly 14 s into
roughly the 2.7 s baseline plus one month's work.

Two alternatives, both worse and both recorded so they are not re-proposed as new: moving
generation behind a button (the plan's named alternative) makes the recurrence manual rather than
cheap, and shrinking the horizon is the thing the plan explicitly forbids doing quietly.


### Checklist corrections made during this walk

1. **The horizon count assertion was WRONG and would have failed a correct build.** It asked for
   `date > current_date` returning **at least 50**. The horizon runs in **whole months from
   `monthStart(today)`**, so it deliberately includes the current month's already-past Sundays:
   observed **52 total, 49 future**. Rewritten to assert the total and the range. The whole-month
   shape is not incidental — it is what makes the coverage arithmetic exact.
2. **The `calendar.manage` gate cannot be walked in this scenario**, and the item that claimed it
   could was ticking for the wrong reason. The gate only means anything for somebody holding
   `calendar.view` and **not** `calendar.manage`; 072's only non-manager is an `org_president`, who
   holds **neither**, so `/calendar` refuses them at the *view* gate — "Not permitted — The ward
   calendar is limited to ward leadership." — and no write was ever attempted. Verified anyway that
   the count stayed at 52. The check has been **moved to scenario 036**, which seeds a
   `music_coordinator` (the exact fixture), and it is asserted at the table in
   `tests/rls/calendar-access.test.ts`.
3. **Steps reordered.** `/calendar` now runs before the Music jump, because until the horizon
   exists the seed holds only August 2027 and there is nothing for the jumped-to card to sit
   *among* — the "in date order" check had no content.

### Not walked

- ~~**The full `npm run test` suite did not finish.**~~ **It finished after the walk ended and is
  GREEN: 250 files, 3879 tests, exit code 0**, in 3076 s (51 min — slow because the walk was
  seeding and signing in against the same hosted project throughout, and every RLS suite goes over
  the network). `npm run lint`, `npm run typecheck` and `npm run build` also pass.
  **One caveat, stated rather than glossed:** the run started at 10:40 and two later edits to
  `app/(app)/music/page.tsx` (the empty-state reorder and the `key` on `MusicSundayList`) landed
  after it began. Neither is covered either way — **no test in this repo imports the music page**,
  which is the deliberate gap the Testing Strategy names, and is exactly why the walk above is the
  instrument for them. Both were verified in the browser instead.
- **The hub's own pill row was not re-read** — it did not change in this slice, and the 2026-09-22
  walk above covers it. Only the Music href was re-verified, on all four Sundays.
- **No `music_coordinator` signed in.** That is scenario 036's walk, still outstanding.
- One console 404 appears in the log for `/api/auth/signout`: **that was the agent probing for a
  route that does not exist**, not the app. Sign-out was then done through the real control.


## Notes

**The most likely thing to get backwards in this slice is which "Topics" is which.** The hub's
Topics pill is the **per-Sunday editor** at `/assignments/[id]`. `/talks/topics` is the
**ward-level library** a slot's topic is chosen *from*. The prototype has no library at all —
`plans/prototype/module-map.md` §2.1 correction (c) records this. Walk both.

**No finalize checkmarks anywhere.** Behaviours 3–5 need the To Do module (P5) and this slice
deliberately builds only the surface they will live on. A checkmark appearing here is a bug, not
a missing feature.
