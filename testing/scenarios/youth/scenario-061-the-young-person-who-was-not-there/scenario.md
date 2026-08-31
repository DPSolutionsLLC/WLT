---
name: The young person who was not there
scope: youth
part: 11
tags: [youth, full, absence, support]
prerequisites: none
---

## Purpose

The support percentage on `/youth` measures the share of a young person's past **home** games where
at least one leader confirmed they went. It assumes the young person was **at** the game, and
nothing in the schema could say they were not.

So a youth who breaks an ankle in December and misses six games is measured, all winter, on six
games **nobody could have attended them at**, and every one counts against them. The number reports
neglect that did not happen — the same failure `youth-f` refused in the other direction when it
declined to render `0%` for a young person with no home games.

`carriesCoverageExpectation()` already excluded three categories, all for **one sentence** — *this
game could not have been a chance to support them*: `away` (no coverage expectation by design),
`cancelled` (it did not happen), `tbd` (not known to be a home game). ITER-030 found the fourth
missing from that list. This scenario is about whether the fourth reads like the three.

Seeding is what makes any of it **observable**. A percentage is a fraction over a season, not
something a screenshot can judge — the thing to prove is that **a number moves in the right
direction for the right reason**, which needs a real percentage on the card a moment before the
mark. It also has to prove the three **absences** (the pill's number, the coverage badge, the
follow-up prompt) and the two **presences**: the event stays listed and marked, and the follow-up
control still works.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `home_venues: ["Lincoln High School"]`, `cross_org_visibility: false` |
| Users | `bishop@…`, `ym-president@…` (**the account to sign in as**), `yw-president@…`, `ward-council@…` (**no organization**) |
| Households | Brooks, Kim, Diaz |
| Members | 4 youth — Ethan Brooks, Noah Brooks, Josh Kim (Young Men), Maya Diaz (**Young Women**) |
| Activity profiles | 5 — one already **closed**, one another organization's, one with nothing but excluded events |
| Events | 23 (1 **ward-wide**, 3 `away`, 2 `cancelled`) |
| Attendees | 7 rows |
| Follow-ups | 2 — one written by `ym-president`, one by `bishop` |

The five activities, and what each is for:

| Activity | Whose | Owner | State | What it is for |
|---|---|---|---|---|
| **Varsity basketball** | Ethan | Young Men | 6 played, 2 attended, 2 upcoming → **2 of 7 = 29%** | **the subject** — the number that must move |
| **Cross country** | Ethan | Young Men | **already closed** 20 days ago, 4 meets, 2 attended → **50%** frozen | the ITER-028 interaction, on screen rather than described |
| **Track and field** | Josh | Young Men | 2 played, 1 attended, 1 upcoming → **33%** | a number that must **not** move while Ethan's is marked |
| **Junior basketball** | Noah | Young Men | 2 `away` + 1 `cancelled`, **nothing else** | the **em-dash reference** — what the three existing exclusions already render |
| **Concert choir** | Maya | **Young Women** | 1 played and attended, 1 upcoming | the control must render here **too** — the gate is ward-wide |

**Noah's profile is the reference, not filler.** His pill reads an **em dash** from the first paint,
because every one of his events is already excluded by one of the three older rules. A fully-marked
Ethan must render **exactly the same way**. If Ethan lands on `0%` where Noah has a dash, the fourth
exclusion disagrees with the three it was meant to join, and the number is back to reporting neglect
that did not happen (`visits-f`, `youth-f`).

**Both follow-ups matter and whose they are is load-bearing.** `followUpState()`'s `hasLog` is about
**the reader's own** log, so proving *"the record survives the mark"* on a card needs a follow-up
`ym-president` wrote — that is the one on **game 2**. The **bishop's**, on game 5, proves the same
guarantee from the outside: it stays readable on `/youth/feed` after the game leaves the prompt. It
is the bishop's rather than the Young Women president's deliberately — migration 057c's INSERT
admits the bishopric or the **event's** organization, so a Young Women president could not have
written on a Young Men profile's game through the app.

**Sign in with:** `ym-president@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-061-the-young-person-who-was-not-there`
2. `npm run dev`, then open http://localhost:3000 and sign in as `ym-president@…`
3. Open **/youth**. Before touching anything, write down: Ethan's basketball percentage **and its
   sentence**, Josh's track percentage, Noah's pill, and the count in the heading of
   *"Waiting on your follow-up"*.
4. Sort by **Priority** and note where each young person falls. Reverse the direction and note it
   again.
5. Expand Ethan's card and press **Show past events**. Read the schedule: six home games, one away
   game, one cancelled one, two still to come.
6. On **Basketball game 1**, answer **No** to *"Is Ethan Brooks taking part?"*. Watch the pill
   **without reloading**.
7. Do the same on **games 3 and 4**. Read the pill and its sentence again.
8. Now mark the **next upcoming game** (*Basketball game 8*) **No**, and read the plan half of the
   sentence — it should point at **game 9**.
9. Mark **every** remaining past home game and **game 9** as well. Compare Ethan's pill with
   **Noah's**.
10. Press **No** again on one of the marked games to clear it, and watch the number come back.
11. Open **/youth/calendar**. Find the marked games and read what they carry.
12. Go back to **/youth** and read *"Waiting on your follow-up"* — its heading count and its rows.
13. On a **marked past game**, press **Say how it went** and save a follow-up.
14. Open **/youth/events/[id]** for a marked game, then **/youth/feed**.
15. Open **/youth/history/[Ethan's member id]** and read the closed cross-country season.
16. Find the ward-wide **Ward youth service evening** and look for the control. Then call the API
    directly from the console:
    `await fetch('/api/youth/events/<its id>', { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ youthAttended: false }) }).then(async r => [r.status, await r.json()])`
17. Read **/youth**, **/youth/calendar** and **/youth/events/[id]** at 375px, in both light and dark.

## Verification Checklist

### Machine-checkable

- [ ] Before anything is marked, Ethan's basketball pill reads a real percentage (**29%**) and its
      sentence names both halves — the games played **and** the next one.
- [ ] Marking a past home game **No** changes the pill's percentage **and its sentence**, together,
      **without a reload**. Both come from one computed value; a number that moves while the
      sentence does not is the ITER-022 defect.
- [ ] `youth_attended` is **false** on that row when re-read with the **service client**, and an
      audit row `youth_activity_event_updated` carries `youthAttended: false` and
      `changed: ["youthAttended"]`.
- [ ] Marking the **next** upcoming game moves the plan half to the **following** game. **The
      sentence names no date, so read the PERCENTAGE, not a date** (corrected during the
      2026-08-31 walk — the original line said to read a date off the sentence, which the app
      does not render there). The decisive sequence: with three past games marked the pill reads
      **50%**; marking *game 8* leaves it at **50%**, because the horizon moved to *game 9* and the
      denominator is unchanged; marking *game 9* as well takes it to **67%** and the trailing
      clause *"and nobody is down for the next one"* **disappears**. Had the horizon not moved,
      marking game 8 would have jumped straight to 67%.
- [ ] Marking **every** past home game and the next one leaves the pill showing an **em dash**,
      never `0%` — and it renders **identically to Noah's**, whose events are excluded by the three
      older rules.
- [ ] Ethan's card then sorts **last** under *Priority* in **both** directions, exactly as Noah's
      does. A null percentage is not a zero.
- [ ] **Josh's track percentage is unchanged** throughout, and so is the closed cross-country
      season's **50%** on `/youth/history/…`.
- [ ] A marked game **still appears** in the event list and on `/youth/calendar`, carrying a chip
      reading *"Ethan Brooks is not taking part"*.
- [ ] A marked game shows **no coverage badge**, and no left edge stripe. **Check *game 8*, which
      is +4 days out** — inside the 7-day notice window with nobody going, so before the mark it is
      `uncovered`, the loudest state on the page. (Corrected during the 2026-08-31 walk: the
      original line said "30 days out", but this seed's furthest upcoming home game is +11 days, so
      that check could not be performed as written — and +4 days is the stronger case anyway.)
- [ ] The marked past game leaves *Waiting on your follow-up*, and the heading **count** drops with
      it. The panel needed no logic change for that; if the count and the rows disagree, they are no
      longer one split.
- [ ] ***Say how it went* is still offered** on a marked past game, and saving one works.
      `isFollowUpWritable()` is deliberately untouched: **the prompt stops, the door stays open.**
- [ ] The follow-up **`ym-president` already wrote** on game 2 still shows its badge after that game
      is marked — the branch sits *after* `hasLog`, so a written record is never demoted.
- [ ] The **bishop's** follow-up on game 5 is still readable on `/youth/feed` after game 5 is
      marked.
- [ ] Pressing the active answer again clears to *nobody has said* (`youth_attended` **null** on
      re-read) and the percentage returns to **exactly** its earlier value.
- [ ] **Yes** works as well as **No**, both buttons carry `aria-pressed`, and the pressed one is
      conveyed by more than colour.
- [ ] The control **does render** on Maya's Concert choir — another organization's activity. The
      gate is ward-wide; hiding it there would be the mirror of `youth-a-D1`.
- [ ] The control does **not** render on the ward-wide **Ward youth service evening**; a direct
      `PATCH` against it answers **400** with a sentence, and `youth_attended` is still **null** on
      re-read.
- [ ] `{ "youthAttended": "false" }` → **400**, not a coerced write.
- [ ] Every value is read back with the **service client**, never off the screen.
- [ ] The chip is legible in **light and dark** and does not overflow at **375px**.
- [ ] The chip is visibly **distinct from the `Cancelled` chip** on the same card — two different
      facts, two treatments — and its dashed border has actually **compiled** (read `borderStyle`
      off the live element; Tailwind's whole-class-string trap drops an interpolated class
      silently).
- [ ] No horizontal overflow at 375px, and every button is at least 44×44.
- [ ] No React #418 hydration mismatch in the console on any page touched.

### Needs a human eye

- [ ] **Does *"Is Ethan Brooks taking part?"* read correctly on a game played last month **and** on
      one three weeks away?** The wording is deliberately tense-free, and this is the judgement it
      was chosen on rather than a settled fact — copy in this module has produced defects on every
      slice that shipped it.
- [ ] **Does *"Ethan Brooks is not taking part"* read right in both tenses too**, sitting on a past
      card and an upcoming one?
- [ ] **Should this control also appear on `/youth/events/[id]`?** It is deliberately only in the
      event list — a second entry point would be a second meaning of the same word (`youth-h`'s
      ground for refusing a second *unlink*). But that page is the event's own page, so if a leader
      reaches for it there, adding it is one prop rather than a redesign.
- [ ] **With the prompt gone, is there anything left telling a leader *why* they are no longer being
      asked about that game?** The chip is the only thing carrying it. Is that enough, or does the
      follow-up panel need to say something?
- [ ] Is it clear that **Yes** and **No** are an answer about the *young person*, and not about the
      leader? *"Did you go?"* lives a few inches away on the same card.
- [ ] Does the chip read as **information** rather than as an alarm? The whole point of the feature
      is that it *removes* alarm.

## Failure Behavior

- [ ] Marking with the dev server stopped mid-tap shows a **sentence** rather than failing silently.
- [ ] `PATCH /api/youth/events/<id>` with `{ "youthAttended": 0 }` → **400** with a sentence, and the
      row is unchanged on re-read.
- [ ] `PATCH` with `{ "youthAttended": null }` on the **ward-wide** event → **200** and no refusal.
      Clearing to null on a row with no young person says nothing about anybody, so there is nothing
      to object to.
- [ ] Signed in as an **org secretary** (`youth_activities.view` and `.log`, not `.manage`), the
      Yes/No control is **absent** — not present and refusing — and `PATCH` called directly answers
      **403**.
- [ ] Marking an event in **another ward** → **404**, with the row re-read to prove nothing was
      written. An RLS-denied UPDATE is a **zero-row success, not an error**.
- [ ] Pressing **No** twice in quick succession settles on one value rather than flickering between
      `false` and `null`.
- [ ] **Marking several games in a row.** The Yes/No buttons share `patchMutation` with *Edit* and
      *Cancel*, so while any one PATCH is in flight **every** Yes/No button on **every** card is
      disabled. Mark six games in succession and check that no press is silently lost — a press
      landing on a disabled button does nothing and says nothing. Added after the 2026-08-31 walk
      observed exactly that (finding D2).

## Walkthrough record

**2026-08-31 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every write was read back with the **service client**, never off the screen. Signed in as
`ym-president`. Evidence in `.walk061/` (git-excluded).

**The seed, read back from the database.** 5 profiles, 23 events, 7 attendee rows, 2 follow-ups.
Cross country already `closed_at = 2026-08-11T15:52Z`; every other profile null. Basketball's 6 home
games at −59.6d … −24.6d with **two** confirmed attendances (game 2 by `ym-president`, game 5 by
`bishop`) and one *unanswered* attendee row (game 3); one `away` at −17.6d, one `cancelled` at
−10.6d; upcoming home games at **+4.4d** and **+11.4d**. Every `youth_attended` null.

**THE HEADLINE RESULTS.**

| Check | Observed |
|---|---|
| Baseline | Ethan `Varsity basketball · 29%` + `Cross country · Finished`; Josh `33%`; Maya `50%`; **Noah `—`**; *Waiting on your follow-up* **(4)** |
| Baseline sentence | *"Somebody went to 2 of 6 home games played, and nobody is down for the next one."* |
| Mark one past game | pill **29% → 33%**, sentence **"2 of 6" → "2 of 5"**, **no reload**, chip appears — number and sentence move together |
| Mark two more | **50%**, *"2 of 3 home games played"*; follow-up count **4 → 3** as game 3 left the panel |
| **Horizon moves** | mark *game 8* → **still 50%** (moved to game 9); mark *game 9* → **67%** and the clause *"and nobody is down for the next one"* **disappears**. Had it not moved, game 8 alone would have given 67% |
| **All home games marked** | Ethan `Varsity basketball · —`, *"No home games played yet, and none coming up."* — **identical to Noah's**, whose events are excluded by the three older rules. Never `0%` |
| Sort | ascending Josh→Maya→**Ethan, Noah**; **reversed** Maya→Josh→**Ethan, Noah** — nulls last in BOTH directions, tie-broken on name ascending both ways |
| Controls unchanged | Josh **33%** and Maya **50%** never moved; closed Cross country **50%** never moved |
| **A genuine 0%** | clearing game 1 alone → **`0%`**, *"Somebody went to 0 of 1 home game played."* — a real zero (a game was played, nobody went) beside the em dash's "nothing could have been attended". Singular "game" correct |
| Full reversal | clearing all 8 → **exactly 29%**, identical sentence, follow-up count back to **(4)** |
| Coverage badge | *game 8* was `uncovered` at +4.4d (inside the notice window, nobody going); marked it carries **no badge** and `border-l-transparent`, not `border-l-danger` |
| `aria-pressed` | `Yes=false,No=true` when marked; `false,false` when cleared — both buttons carry it in every state |
| **Record survives** | game 2's badges went `["Home","Follow-up recorded"]` → `["Home","Follow-up recorded","Ethan Brooks is not taking part"]`; *Change what you wrote* still offered |
| **Door stays open** | wrote and saved a NEW follow-up on marked game 4; stored (`event=d668244e…`, `ya=false`) and visible on `/youth/feed` |
| Feed | all three follow-ups readable, including the **bishop's** on marked game 5 |
| **Closed-season composition** | marking a meet inside the closed season moved its frozen number **50% → 67%** (*"2 of 3"*) while still listing all **4 events** |
| Ward-wide event | **no fieldset**; `PATCH {youthAttended:false}` → **400** *"That event is not on a young person's activity, so there is nobody to record as taking part."*, row unchanged (`ya=null`) |
| Ward-wide, null | `PATCH {youthAttended:null}` → **200** — the deliberate no-op carve-out |
| Type refusal | `{youthAttended:"false"}` → **400** *"Invalid input: expected boolean, received string"* |
| **Ward-wide gate** | Maya's Concert choir (**Young Women**) carries the control: legend *"Is Maya Diaz taking part?"* |
| `true` round-trip | `PATCH {youthAttended:true}` → 200, false→true, and the value returns in the API response |
| Audit | 27 × `youth_activity_event_updated`, each carrying `changed:["youthAttended"]` and `youthAttended:false|true` beside `eventId`/`profileId`/`status` |
| Chip style | light `borderStyle:dashed`, `rgb(100,116,139)` = `--muted`; dark `rgb(161,161,170)` = `--muted` dark. `Cancelled` is solid `--warning` in both. The dashed border **compiled** (read off the live element) |
| Console | **no React #418 hydration mismatch** anywhere; the only two errors were the two 400s deliberately triggered |
| 375px | `scrollWidth == clientWidth == 360` on `/youth` and `/youth/profiles`; every Yes/No button **44px** tall |

**CHECKLIST CORRECTIONS MADE DURING THIS WALK — two items could not be performed as written.**

1. *"Marking the next upcoming game moves the plan half to the following game — read the date off
   the sentence"*. **The sentence names no date.** Rewritten to read the PERCENTAGE instead, which
   is decisive in a way a date would not have been: 50% → 50% (horizon moved) → 67% (horizon
   exhausted, clause dropped).
2. *"check one 30 days out"*. **This seed's furthest upcoming home game is +11 days**, so that check
   was unreachable. Rewritten to name *game 8* at **+4 days**, which is the stronger case anyway —
   inside the 7-day notice window it was `uncovered` before the mark.
3. A new line was ADDED for finding D2 below (marking several games in succession).

**NOT WALKED, and covered by the automated suite instead:**

- **A cross-ward PATCH → 404.** The harness seeds one ward only. Covered by
  `tests/routes/youthEvents.test.ts:850`, which re-reads the row with the service client to prove
  nothing was written.
- **An `org_secretary` → 403 and an absent control.** No such account exists in this seed. Covered
  by `tests/routes/youthEvents.test.ts:584`. The UI half gates on the same `canManage` flag that
  already hides *Edit* and *Cancel*.

**TWO FINDINGS. Both reported unfixed.**

**D1 — "Nobody recorded as taking part" on `/youth/feed` now collides with this slice's
vocabulary.** `components/visits/ReportTile.tsx`'s `NOBODY_RECORDED` renders on every youth tile
because `authorLabel` is always null there — pre-existing, and already flagged in
`lib/reports/types.ts` as *"TRUE and probably not useful"*. **This slice makes it misreadable
rather than merely useless.** "Taking part" is now a term of art meaning *the young person is or is
not taking part*, so a tile reading *"Nobody recorded as taking part"* on a game the young person
**did** attend now reads as a factual claim that they were absent. Two meanings of one phrase, on
adjacent screens, inside one module. Observed on game 5's tile, which has a confirmed attendee
(`bishop`). The standing instruction in `lib/reports/types.ts` says the fix is in `ReportTile`
**in place** with the visits feed re-verified — never a youth-only component; *"Nobody recorded as
attending"* would separate the two senses.

**D2 — a mark that lands on a disabled button is silently lost.** The Yes/No buttons reuse
`patchMutation`, which is shared with *Edit* and *Cancel*, so while **any one** PATCH is in flight
**every** Yes/No button on **every** card is `disabled`. Observed directly: a press on game 2 while
game 1's PATCH was still in flight did nothing — no mark, no message — and was only detectable by
reading the database. This lands squarely on the feature's motivating story, which is a young
person missing **six games in a row**. **The tradeoff is real and was deliberate**: the plan chose
`patchMutation` specifically for "no new mutation, no new error surface", and the behaviour matches
*Edit* and *Cancel* exactly. Worth deciding rather than assuming.

**TWO OBSERVATIONS — a number moved and the page does not say why.**

- **`/youth/history/[member_id]` renders no absence chip.** The closed season reads *"2 of 3 home
  games played"* above a list of **4** identical-looking rows. Task 9 did not put the chip on this
  page; nothing there distinguishes the excluded meet.
- **"2 events coming up" beside "none coming up".** Ethan's card shows *"2 events coming up"*
  (`upcomingCount`, purely date-based) while the pill's sentence says *"…and none coming up"* (the
  support horizon, which excludes marked games). Both true under their own definitions; on one card
  they read as a contradiction. Pre-existing in shape — an all-`away` upcoming season does the same
  — but this feature makes it easy to reach.

**Final database state left by the walk:** 8 basketball events `youth_attended = false`, game 6
`true`, cross-country meet 2 `false`; one new follow-up on game 4. Clean up with
`npm run seed:clean`.
