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
5. Open the Sacrament tile, then navigate to **August 2027** with the month controls.
6. Read the pill row on each of the five Sundays without clicking anything.
7. Click **every** pill on 08-15 and come back each time. Check the date you landed on.
8. Resize to 375px and read the month again. Switch themes.
9. Sign out. Sign in as the Relief Society president and open `/sacrament` directly.
10. Sign out. Sign in with the youth PIN account if one exists in your database, or simply open
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
- [ ] The Music pill on 08-15 lands on **`/music` showing August 2027**, scrolled to the 08-15
      card — not the current month, and not an empty page. **This is 072-D1 re-armed**; the
      destination now reads `?month=` and the href now carries one
- [ ] `/music` opened from the **nav**, with no month, shows the **current** month
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
- [ ] A hand-edited `?month=` of nonsense falls back to the current month rather than erroring
- [ ] Automated: `tests/lib/sacramentSundayStatus.test.ts` pins every count,
      `tests/components/sacrament/SundayCard.test.tsx` pins the card's shape, and
      `tests/lib/navigationRoutesExist.test.ts` fails if `/sacrament` loses its page

## Walkthrough record

> **THE 072-D1 FIX IS NOT YET WALKED — 2026-09-23.** `/music` became a month board
> (`plans/p4-sacrament-music-month.md`) and the walk was deliberately SKIPPED at the user's
> instruction. The two Music checklist items below are therefore **unverified in a browser**:
> lint, typecheck, 3856 unit tests and a production build are green, and none of them can prove
> the destination honours the `?month=` the pill now sends — which is exactly what 072-D1 was.
> Re-walk before trusting the Music pill.

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

**072-D1 — THE MUSIC PILL CANNOT REACH ITS OWN SUNDAY. FIXED 2026-09-22**, by
`plans/p4-sacrament-music-month.md` (`78f1505`). `/music` is now a month board — `?month=YYYY-MM`,
`MonthNavigation`, two empty states — and `sundayPillHrefs()` sends it the Sunday's own month
plus an anchor, exactly as the Prayer pill already did. The original finding, kept because the
reasoning is what the next reader needs:

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

## Notes

**The most likely thing to get backwards in this slice is which "Topics" is which.** The hub's
Topics pill is the **per-Sunday editor** at `/assignments/[id]`. `/talks/topics` is the
**ward-level library** a slot's topic is chosen *from*. The prototype has no library at all —
`plans/prototype/module-map.md` §2.1 correction (c) records this. Walk both.

**No finalize checkmarks anywhere.** Behaviours 3–5 need the To Do module (P5) and this slice
deliberately builds only the surface they will live on. A checkmark appearing here is a bug, not
a missing feature.
