---
name: The selection reaches the program
scope: program-e-music-and-hymns
part: 1
tags: [music, program, smoke]
prerequisites: none
---

## Purpose

The seam between this plan and `program-a`'s snapshot rule.

A program draft is a SNAPSHOT, not a view. Once it is stored it stops tracking the calendar, the
assignments, the prayers and the hymns it came from, and `POST /api/programs/[id]/refresh` is the
only sanctioned way to move it forward. `program-e` adds a fourth upstream source to that list,
and the rule has to hold for it exactly as it does for the other three.

The failure this guards against is the tempting one: a hymn selection that writes through into an
existing draft. It would feel helpful. It would also mean the secretary's approved program could
change under them between the approval and the printing, which is the whole reason the snapshot
exists.

> **Why a person walks this rather than a test.** `tests/db/program-snapshot.test.ts` already
> proves the stored draft does not move when its sources do. What it cannot judge is whether the
> refresh diff READS as a change worth accepting — whether "Sacrament hymn: (nothing) → 173 —
> While of These Emblems We Partake" tells a secretary what they are about to agree to.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `music@harness.wardleadershiptools.test` (music_coordinator), `secretary@harness.wardleadershiptools.test` (ward_secretary) |
| Members | 2 adults, in one household |
| Sunday | 2026-11-15, standard, 2 speaking slots, both assigned |
| Hymns chosen | Opening 19, closing 152. **No sacrament hymn** |
| Program | Already built and stored as a draft, listing the same opening and closing hymns and **no sacrament hymn**, with `sacrament_hymn` in its `missing` list |

The program is seeded ALREADY BUILT, with `draft_data` written out literally rather than
assembled. A seed that called `assembleDraft()` would agree with a fresh assembly by construction,
and the scenario would pass even if the app re-derived the draft on every read — which is the
exact bug it exists to catch (the same reasoning as scenario 029's seed).

The sacrament hymn is the one left empty, so there is a single, unambiguous gap to fill and a
single line to look for in the diff.

**Sign in with:** `music@harness.wardleadershiptools.test`, then
`secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- music/scenario-037-the-selection-reaches-the-program`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **music coordinator**.
4. Open **Music**, find **Sunday, November 15**, and set the **sacrament hymn** — search for
   `sacrament` and choose `173 — While of These Emblems We Partake`.
5. Sign out and sign in as the **ward secretary**.
6. Open **Program** and then Sunday, November 15.
7. Read the meeting order **before touching anything**.
8. Press **Refresh** and read the diff.
9. Apply it, then save.

## Verification Checklist

### Machine-checkable

- [ ] After step 4, `hymn_selections` holds three rows for that Sunday: opening 19, sacrament 173, closing 152
- [ ] After step 4 and BEFORE the refresh, the stored `programs.draft_data` still has `sacramentHymn: null` — the write did not reach through
- [ ] At step 7 the program screen shows the sacrament hymn as absent, and `sacrament_hymn` is still in the missing list
- [ ] The refresh diff names the sacrament hymn and shows both the **number and the title**, not the number alone
- [ ] The refresh diff does NOT list the opening or closing hymn as changed — they were already correct
- [ ] After applying and saving, `programs.draft_data.sacramentHymn` is `{ number: 173, title: "While of These Emblems We Partake" }`
- [ ] After applying and saving, `sacrament_hymn` is gone from the program's missing list
- [ ] The program's status is still `draft` — a refresh does not submit or approve anything
- [ ] An audit row exists for the hymn selection with action `hymn_selected` and module `music`
- [ ] No horizontal overflow at 375px on the diff panel

### Needs a human eye

- [ ] At step 7, the unchanged program does not look broken or stale — it looks like a program that has not been refreshed yet
- [ ] The diff line for the sacrament hymn tells the secretary what they are agreeing to without them needing to know what a snapshot is
- [ ] Applying the diff feels like accepting a change, not like the app correcting an error the secretary made
- [ ] The program screen after saving reads as complete rather than as "the gap has been patched"

## Failure Behavior

- [ ] Choosing a hymn for a Sunday whose program is already **approved** still saves the selection and still does not alter the approved program. The secretary must reopen the program before a refresh is offered — `program-c`'s walk added that button, and this is where the two plans meet
- [ ] Clearing a hymn on the Music screen after the program has been refreshed leaves the program showing the hymn until the next refresh. An absence upstream is a change like any other and travels the same way
- [ ] Signing in as a role without `music.manage` shows the Music screen with no Choose buttons, rather than buttons that fail when pressed

## Walkthrough record

Not yet walked.

## Notes

- This scenario needs no AI call and costs nothing to run. It is tagged `smoke` for that reason — it is the cheapest check that the music module and the program module still agree.
- If the refresh diff shows the opening or closing hymn as changed, the seeded `draft_data` has drifted from the seeded `hymn_selections`. That is a broken fixture, not a broken app — the two must be written to agree.
