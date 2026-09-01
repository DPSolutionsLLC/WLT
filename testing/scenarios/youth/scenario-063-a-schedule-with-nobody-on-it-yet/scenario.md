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

Not yet walked.

## Notes

- **The closing instant is five days ago and the dates are computed from the seed time**, so
  "before" and "after" stay true however long after seeding the walk happens. Do not write absolute
  dates into this file.
- Every seeded venue is a ward home venue on purpose. An `away` or `tbd` game carries **no**
  coverage expectation by design, so a stray one would make the Concert Choir's silence prove
  nothing at all.
- Sofia's Cross Country pill carries **no percentage** on `/youth` — that is ITER-028's decision,
  not a bug. A closed season's number lives on `/youth/history/[member_id]` and nowhere else.
