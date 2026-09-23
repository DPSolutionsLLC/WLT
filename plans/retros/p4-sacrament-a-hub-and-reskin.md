---
id: p4-sacrament-a-hub-and-reskin
type: feature
iter: null
commits: ["c39e70f"]
date: 2026-09-22
files:
  - lib/sacrament/sundayStatus.ts
  - components/sacrament/SundayCard.tsx
  - components/sacrament/StatusPill.tsx
  - app/(app)/sacrament/page.tsx
  - app/(app)/sacrament/SacramentCalendar.tsx
  - app/(youth)/ordinances/page.tsx
  - lib/auth/navigation.tsx
  - components/ui/Pill.tsx
  - components/ui/Card.tsx
  - plans/prototype/module-map.md
related:
  - p3-shell-and-tile-dashboard
  - design-system-tokens-and-primitives
  - program-c-public-pages
  - roster-b-picker-and-orgs
  - youth-e-overview-and-cross-navigation
  - talks-b-month-planner
  - talks-c-prayers-topics
  - calendar-c-rotation-cadence
  - auth-b-invites-admin
---

## What was done

Built `/sacrament`, the Sacrament **meeting** hub: a month of Sundays, each card carrying a row of
status pills that deep-link into the module owning that piece of work for that date. WLT already
held all of this information, spread across `/assignments`, `/prayers`, `/music` and `/program` —
four top-level routes that never referenced each other, so answering "is the 8th ready" meant
opening four pages and holding the answer in your head. The three absorbed modules are untouched:
no route handler changed, no RLS policy moved, no migration. They stop being entry points and
become destinations, which is the whole of the re-skin.

The hub replaced the separate Talks and Prayers dashboard tiles (15 → 14), and the youth PIN
ordinance screen moved out of `/sacrament` to `/ordinances` so the meeting could take the name the
prototype and the tile both use.

## Key decisions

- **`/sacrament` means the MEETING, not the ordinance.** Route groups share one URL space, so
  `app/(app)/sacrament` and `app/(youth)/sacrament` could not coexist. P4 arrived before P11 and
  claimed the name; the youth screen is now `/ordinances` and P11's adult screen is
  `/sacrament/ordinances`, labelled `Sacrament Ordinances` so two tiles are tellable apart.

- **One pure function owns every count** (`lib/sacrament/sundayStatus.ts`, `@/types/domain` imports
  only, no clock). The hub renders `Topics 2/3`; the page behind it shows two topics. Computed in
  two places they would drift, which is `youth-e`/ITER-022 exactly — a summary that carried the
  state and the date but not the **count**.

- **Topics and Talks are deliberately different metrics.** A topic can be decided before any
  speaker is picked, which is this ward's stated workflow; folding them into one "planned" count
  would report the whole first half of the work as nothing having happened.

- **The total is `sundays.speaking_slots`, never `assignments.length`.** Three slots with one
  assignment reads `1/3`; counting the rows would read `1/1` and call the Sunday done.

- **A pill is shown when there is work to count.** A Sunday with no speaking slots carries no talk
  pills at all. This reconciles two opposite-looking complaints: `program-c` found an omitted pill
  for work that DOES exist reads as broken, and the scenario-072 walk found `Topics 0/0` for work
  that does NOT exist reads as broken. Keyed on the slot count, never on `type === "fast_sunday"`,
  so a second definition of "has speakers" cannot drift from the calendar's.

- **The card itself opens the programme, so there is no programme pill.** The programme is the sum
  of everything else on the card, not one more item beside its parts. Built as a **stretched
  pseudo-element**, never an `<a>` wrapping the card — that would nest the pill anchors, which is
  invalid and unreachable by a screen reader. A test asserts zero nested links.

- **No conducting pill; the conducting NAME is the link** to the Sunday editor, where the
  per-Sunday override already lives. Who conducts is a standing rotation, not outstanding work, and
  `1/1` put a settled fact in a row of unsettled ones. The link is withheld (plain text) from
  anybody lacking `calendar.view`, which `talks.view` does not imply — the mirror of `youth-a-D1`.

- **The `complete` pill is a solid fill, which departs from `Pill`'s third rule with the
  measurement taken.** That header forbids fills because each owes a second contrast measurement
  per theme "and nobody would take it". `text-background` is a **token** that inverts in lockstep
  with `--stage-complete`, so one static class pair is correct in both (light `#15803d`/`#faf7f1`,
  dark `#4ade80`/`#1b1d1f`, both verified in the browser). A literal `text-white` is the exact trap
  the rule exists to prevent. `Pill`'s header records the exception so it reads as a decision.

- **An `assignments` pill is deliberately absent until P11** builds the adult ordinance screen. A
  pill pointing at a route with no page is the standing broken-link bug `p3` closed; a test fails
  the day somebody adds the key without the page.

- **Module-map corrections applied.** Behaviour 9 (rotation cadence) was **already built** in
  migration 024 — nine new behaviours is eight. `/talks/topics` is the ward-level topic LIBRARY,
  not a per-Sunday sub-view, and its heading now says "Topic library"; the prototype's *Topics*
  pill maps to `/assignments/[sunday_id]`, which is the likeliest thing to get backwards.

## What the walk caught that 3841 tests did not

Two defects, both found by driving the browser (scenario 072):

1. **Every pill was a 19px tap target.** `Pill` is `px-2 py-0.5 text-xs`, right for all ten of its
   previous callers because every one was a **badge**. These are the first *interactive* Pills in
   the app and nothing noticed the change of role — `SundayCard.test.tsx` asserted they were
   anchors and undimmed, which made them look thoroughly covered. **Fixed**: `min-h-11` on the
   anchor, so the badge shape is untouched everywhere else. The scenario checklist had no 44×44
   check, unlike nearly every other scenario in the harness; that omission is what let it through.

2. **The Music pill cannot reach its own Sunday — STILL OPEN.** `/music` is a rolling six-Sunday
   horizon from today with no date parameter, so `Music 2/3` on a Sunday further out lands on a
   page reading "The next 0 Sundays". Structural, not a far-future-seed artifact: any Sunday more
   than ~6 weeks out behaves this way, which is the horizon a bishopric plans at. Fixing it means
   giving `/music` a month parameter — a module this slice was not meant to touch, so it is its
   own slice.
