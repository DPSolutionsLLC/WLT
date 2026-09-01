---
name: A schedule with nobody on it yet
scope: youth
part: 13
tags: [youth, full, roster, coverage, regression]
prerequisites: none
---

## Purpose

Two teams here produce the same raw fact — **zero young people expected at this game** — and they
must be answered in **opposite** ways. Getting that wrong is silent in both directions, which is
why it needs a person.

**The Concert Choir has been imported and nobody has been assigned to it yet.** That is not an
error state: ITER-033's flow is *import once, then assign*, in the user's own words, so **every
ward passes through it on every schedule they import**. Its games must stay **loud** — ordinary
uncovered coverage, badges, a place in the count strip — because answering an empty roster with
"no expectation" would silently remove a whole season from the coverage model, with no badge
anywhere saying so and nobody asked to attend any of it. That is
`lib/youth/classifyLocation.ts`'s *"an unmatched location is `tbd`, never `away`"* for a fourth
time: **an absence of evidence is not evidence.**

**Cross Country's season has been closed out**, and two of its meets fall after the closing
instant. Those must go **quiet**. That is the leak ITER-033 records by name: before `youth-j`,
`ActivityCalendar.tsx` and `calendar/page.tsx` contained **no reference to `closedAt` at all**, so
a closed team's future games went on raising "Nobody going" for ever, and nothing on any screen
offered a way to stop it short of deleting the games.

**Why a green suite cannot replace this.** The Concert Choir failure mode is a *disappearance*. If
`lib/youth/roster.ts`'s branch 5 is ever "tidied up" so an empty roster answers `no_expectation`,
every unit test still passes except the one that names it, the screen shows **fewer** warnings, and
it looks like an improvement. Somebody reading the coverage strip is the only thing that catches
that.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, home venues: Lincoln High School, Ward cultural hall |
| Users | `bishop`, `yw-president` (Renata Alvarez) |
| Youth | Sofia Nash (on Cross Country), **Clara Brooks (on no team at all)** |
| Activity 1 | **Concert choir** — imported, season running, **roster is EMPTY** |
| Activity 2 | **Cross country** — season **closed** 5 days ago, Sofia on the roster |
| Calendar | 1, on the choir — so its games read "From a schedule feed" |
| Events | **8** — 4 upcoming choir concerts (two inside the 7-day notice window); 4 cross-country meets: **2 before** the closing instant, **2 after** and still upcoming |

**Sign in with:** `yw-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-063-a-schedule-with-nobody-on-it-yet`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `yw-president`.
4. Open `/youth/calendar`. Read the **coverage strip at the top** and then every card.
5. Open `/youth/profiles` and read both activity cards, including the "Who is on this" panel.
6. Open `/youth` and note who is listed.
7. Back on `/youth/profiles`, add **Clara Brooks** to the Concert Choir.
8. Return to `/youth` and find Clara.

## Verification Checklist

### Machine-checkable

- [ ] The Concert Choir's **four** upcoming concerts appear on `/youth/calendar`, each with a
      coverage badge — **uncovered** for the two inside the notice window, **unassigned** for the
      two beyond it. Not absent, and not `not_expected`.
- [ ] Those four are **counted in the strip at the top**. The strip and the cards agree.
- [ ] Cross Country's **two meets before** the closing instant behave as ordinary past events.
- [ ] Cross Country's **two meets after** the closing instant raise **nothing** — no coverage badge
      and no contribution to the strip — even though both are upcoming and nobody is down for them.
      **This is the ITER-033 leak, closed.**
- [ ] `/youth/profiles` shows the Concert Choir with a sentence saying nobody is on it yet **and
      what that means for its games**, not a blank panel.
- [ ] Cross Country's card carries a "Season closed" chip and its button reads `Reopen`.
- [ ] `/youth` lists **Sofia** (with no pill percentage for the closed season, a "Finished" pill,
      and a link to her history) and does **not** list Clara, who is on no team.
- [ ] After step 7, Clara appears on `/youth` immediately, carrying a "Concert choir" pill.
- [ ] Clara's pill reads a **real percentage or an em dash — never `0%`**. (Four upcoming home
      concerts with nobody down for the next one is a genuine `0%`; if no home concert has been
      played *and* none is coming up it would be an em dash. Either is correct; `0%` where nothing
      could have been supported is not.)
- [ ] Adding Clara does **not** change Sofia's card.

### Needs a human eye

- [ ] Standing in front of `/youth/calendar` with no other context: is it **obvious** that the
      Concert Choir's concerts need somebody, and equally obvious that Cross Country's later meets
      do not?
- [ ] Does the Concert Choir's empty-roster sentence read as **something you can fix in a minute**,
      or as an error the app is reporting at you?
- [ ] The two silences look identical in the data. On the screen, do they read as **two different
      situations**, or do you have to work out which is which?
- [ ] Cross Country's two later meets are still **listed** on the calendar — they have simply gone
      quiet. Does their presence read as deliberate, or as rows the app has forgotten about?
- [ ] Is the roster panel's empty state legible one-handed at 375px, in both themes?

## Failure Behavior

- [ ] Creating an activity with **nobody** selected is allowed, and the form says so before you
      submit. A form that refused it would force a leader to name the players before they have the
      schedule in front of them, which is the friction this slice removes.
- [ ] The Concert Choir has events, so **`Remove` is absent** on its card — only `Close the season`
      is offered (youth-h's gate, unchanged).
- [ ] Reopening Cross Country brings its two later meets **back** to ordinary coverage. Closing it
      again takes them out. The same control in both directions is what makes a mistake
      recoverable.
- [ ] Signed in as an `org_secretary`, the "Add a young person" control is **absent** — not
      present-and-failing.

## Walkthrough record

### 2026-08-31 — driven by Claude (agent), screenshots for human review

**The user started this walk themselves** and got as far as signing in, then handed it over. Two
things tripped them up on the way in and are worth recording, because the next person will hit
both: the browser autofilled `ym-president` from scenario 062 and this seed does not create that
account (only `bishop` and `yw-president`), and `/youth/calendar` has **no sidebar entry** — it is
reached from `/youth` or by URL.

Walked on `localhost:3000` against the hosted project as `yw-president`, then again as
`yw-secretary`. Every write read back with a service-role client. Evidence in `walk-063/`
(git-excluded); review page published.

**Ground truth at walk time** — ward zone `America/Denver`, now `2026-08-31 19:48 MDT`, Cross
Country closed at `2026-08-26T18:00:00+00:00`.

**Both answers were computed from the stored rows through the real `eventCoverage()` and
`eventYouthAttendance()` BEFORE the browser was opened**, so the screen was compared against an
expectation rather than allowed to explain itself. Every one matched:

| Event | Computed | On screen |
|---|---|---|
| Choir concert 1 | `expected` (empty list) → `uncovered`, 2.0 days | "Nobody going" |
| Choir concert 2 | `expected` (empty list) → `uncovered`, 5.0 days | "Nobody going" |
| Choir concert 3 | `expected` (empty list) → `unassigned`, 12.0 days | "Nobody yet" |
| Choir concert 4 | `expected` (empty list) → `unassigned`, 20.0 days | "Nobody yet" |
| Cross country meet 3 | `no_expectation / season_closed` → `not_expected` | no badge |
| Cross country meet 4 | `no_expectation / season_closed` → `not_expected` | no badge |

**Branch 5 is doing its job on a screen.** An empty roster returns `kind: "expected"` with an
EMPTY list, so the choir's four concerts carry real badges and are counted — and the strip reads
*"2 home events in the next week with nobody going: Choir concert 1, Wed, Sep 2, 7:00 PM; Choir
concert 2, Sat, Sep 5, 7:00 PM."* Strip and cards agree, and both name the same events.

**The ITER-033 leak is closed on a screen.** Both post-close meets are upcoming with nobody signed
up, and both raise nothing.

**Other observed values:**

- `/youth` before adding Clara: *"1 young person shown."* — Sofia with `Cross country · Finished`,
  no percentage, and a link to `/youth/history/…`. Clara absent.
- After adding Clara: *"2 young people shown."* — `Clara Brooks · Concert choir · 0%`, tooltip
  *"No home games played yet, and nobody is down for the next one."* **A genuine 0%**, and Sofia's
  card byte-identical.
- Reopen/close proved **in both directions**: strip 2 → 3 → 2, meet 3 gaining then losing a
  "Nobody going" badge, `closed_at` moving null → timestamp in the database.
- The create form says *"You can leave this empty and add the young people once the schedule is
  in."*
- `Remove` absent on the choir (4 events); only `Close the season`.
- **Audit rows for every mutation** (rule 6): `youth_activity_roster_added`,
  `youth_activity_roster_removed`, `youth_activity_profile_reopened`,
  `youth_activity_profile_closed`, each carrying ids plus member and activity names.
- **Zero console errors** across the whole walk. No horizontal overflow; every button ≥ 44px.

**0 defects.** Every one of the eight steps was performed as written, and no step described a
state the app cannot reach — the first Phase 8 scenario for which that is true on a first walk.

**A seed gap was closed mid-walk.** The Failure Behavior checklist asks for an `org_secretary`
sign-in and no such account existed, so that check had never been performable — **the identical
gap found in scenario 062 the same day**. `yw-secretary` (Priya Raman) was added and the check
then walked: the choir card renders with **zero buttons**, `Add a young person` / `Close the
season` / `Edit` all absent, while the roster, the sentence and `I'll go` stay present — `I'll go`
correctly, because that is `youth_activities.log`, which the role holds.

**Raised by the walk and NOT fixed — it is a wording judgement, and it is with the user:** the
empty-roster sentence is unchanged for a reader who cannot act on it. An `org_secretary` sees
*"…until **you add** the young people who play"* beside no control to add anybody. The gate is
right; the sentence addresses an action to somebody who has no way to take it.

**One checklist line contradicts itself and was left as written**, pending the user's call: *"Clara's
pill reads a real percentage or an em dash — **never `0%`**"*, whose own parenthetical then says a
genuine `0%` is correct here. Both halves are right — the headline is shorthand for "never a
*meaningless* `0%`" — but read quickly it would score a correct app as a failure.

**Not verified:** the deployed build (this walk was localhost only; `df25b40` was walked on
production earlier the same evening, but 063's seed data never existed there); no real device —
and note the mobile shots are **412px, not 375**, because the browser was running Samsung Galaxy
device emulation which overrode the viewport; the bishopric path; and the `/youth/history` page
for Sofia, which this scenario does not ask for.

## Notes

- **The closing instant is five days ago and the dates are computed from the seed time**, so
  "before" and "after" stay true however long after seeding the walk happens. Do not write absolute
  dates into this file.
- Every seeded venue is a ward home venue on purpose. An `away` or `tbd` game carries **no**
  coverage expectation by design, so a stray one would make the Concert Choir's silence prove
  nothing at all.
- Sofia's Cross Country pill carries **no percentage** on `/youth` — that is ITER-028's decision,
  not a bug. A closed season's number lives on `/youth/history/[member_id]` and nowhere else.
