---
name: The young person nobody has been to see
scope: youth
part: 7
tags: [youth, full, overview, sorting, support-percentage]
prerequisites: none
---

## Purpose

`/youth` lists **one card per young person**, each carrying **one pill per activity** with a
**support percentage**. The percentage is **the history of support plus the plan for the next
event**: every past home game, counted on whether a leader confirmed they went, plus the **next**
home game, counted on whether anybody is signed up for it. This scenario proves the number is
right, that the sort built on it is right, and that **absence of data never reads as neglect**.

Three claims, and they need a real screen:

1. **A card is a person.** Ethan is in two activities. Before 2026-08-29 he rendered as **two
   cards**, and the old seed hid it by giving every young person exactly one activity.
2. **A missing percentage sorts LAST in both directions.** Three of the five young people have had
   no home game played at all. If any of them renders `0%`, or leads either direction, that is the
   `visits-f` trap arriving in this module: a comparator whose missing value sorts anywhere but
   last makes "nothing to say" read as an emergency, and every row is individually correct while
   the list is useless.
3. **Only a confirmed "I went" is support — on a game already played.** `confirmed_attendance` is
   `boolean | null` and carries three meanings; two of them must not count. All three are on this
   screen at once.
4. **The next game is counted on the PLAN, not on attendance.** Nobody can confirm going to a game
   that has not happened, so the next one counts as supported when somebody is *signed up*. This is
   the half a leader can move today, and signing up for a game must change the number on the spot.

`tests/lib/youthProfileNeed.test.ts` pins the arithmetic. What no unit test can show is whether a
leader opening this page **reads the right five names in the right order, with numbers they can
check**.

Seeding matters because the ranking is a function of the clock over a **season of history** — a
state that takes twenty minutes of clicking to build by hand and is wrong the moment the clock
moves.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…` (bishop), `ym-president@…` (Young Men president), `yw-president@…` (**Young Women** president — the account to sign in as) |
| Households | Brooks, Chen, Okafor, Nielsen |
| Members | 5 youth — Ethan Brooks, Maya Chen, Josh Okafor, Sofia Nielsen, Liam Nielsen |
| Activity profiles | **6**, across two organizations plus one ward-wide (`org_id` null — Debate club). **Ethan has two.** |
| Events | 25, all placed relative to the seed time |
| Attendees | 9 rows, carrying **all three** values of `confirmed_attendance` |
| Follow-ups | 1, so the panel at the top of the page has both a written and an unwritten case |

**The arithmetic, which you can check by hand rather than trust.** The denominator is *past home
games played* **+ the next home game, if there is one*:

| Young person | Activity | Played | Confirmed | Next game | Pill |
|---|---|---|---|---|---|
| **Ethan** Brooks | Varsity basketball | 8 | 1 | somebody down | **2 of 9 → 22%** |
| | Track and field | 4 | 3 | *none* | **3 of 4 → 75%** |
| **Maya** Chen | Concert choir | 5 | 2 | **nobody down** | **2 of 6 → 33%** |
| **Josh** Okafor | Club soccer | **0** (4 away) | — | none | **—** |
| **Sofia** Nielsen | Debate club (**ward-wide**) | **0** (1 tbd, 1 cancelled) | — | none | **—** |
| **Liam** Nielsen | Cross country | **0** (no events) | — | none | **—** |

**Ethan's priority is his LOWEST activity, 22% — not an average.** An average would put him at 49%,
behind Maya, and the basketball season is the one nobody is turning up to.

**Only the NEXT game counts, never the rest of the fixture list.** Counting the whole remaining
season would let an imported schedule drag every percentage down for a reason nobody did anything
about; counting only the past would make the number unmovable — a leader could not change it by
signing up for anything, only by waiting.

**Maya's five choir events carry all three meanings of `confirmed_attendance`:**

| Event | Attendee | `confirmed_attendance` | Counts? |
|---|---|---|---|
| Winter concert (−6d) | yw-president | **null** — signed up, never answered | **no** |
| Regional choir festival (−13d) | yw-president | **true** | **yes** |
| Autumn showcase (−20d) | bishop | **true** | **yes** |
| Choir rehearsal showcase, week four (−27d) | *nobody* | — | no |
| Choir rehearsal showcase, week five (−34d) | ym-president | **false** — said they did not go | **no** |
| *Spring concert (+2d — the **next** game)* | *nobody* | *n/a — counted on the plan* | *no* |

**Read the tooltip, not just the percentage.** Two different faults both produce 50% on her pill:
a `null` starting to count (3 of 5, nobody down) and somebody signing up for the Spring concert
(2 of 5, somebody down). The tooltip says which — *"Somebody went to 2 of 5 home games played, and
nobody is down for the next one."* is the correct one on a fresh seed. **67%** would mean a `false`
has started counting too.

**Sign in with:** `yw-president@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

**Why the Young Women president and not the Young Men one.** The follow-up panel lists only events
waiting on the reader **personally and writable by their organization** (migration 057c, ITER-021).
Reading as the leader whose organization owns Maya's choir gives a writable waiting row without
touching Ethan's percentages. It also gives the live case in step 9: *Choir rehearsal showcase,
week four* has **nobody** at it, and she never signed up — so saying "I went" must **create** her
attendee row.

## Steps

1. `npm run seed -- youth/scenario-057-the-young-person-nobody-has-been-to-see`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `yw-president@…` and open **/youth**. Read the default order top to bottom, and read
   every pill, before touching anything.
4. Press the direction button beside **Sort by** — it should read *Least supported first*. Read the
   order again.
5. Switch **Sort by** to *Name*. Toggle its direction. Switch back to *Priority*.
6. Type `ethan` into **Find a young person**, then `choir`, then clear it.
7. Expand **Ethan**'s card. Read the events listed, then press **Show past events**.
8. Collapse Ethan, expand **Maya**, press **Show past events**.
9. On *Choir rehearsal showcase, week four* — the one she is **not** down for — press **Say how it
   went**, answer **I went**, and save. Watch her pill without reloading.
9b. Press **I'll go** on *Spring concert* — the **next** game — and watch her pill again. This is
   the plan half, and it is the only number on the page a leader can move today.
10. Open **/youth/profiles** from the header and confirm everything the old `/youth` held is there.
11. Read `/youth` at 375px, in both themes.

## Verification Checklist

### Machine-checkable

**One card per young person**

- [ ] **Ethan appears exactly ONCE**, with **two** pills: *Track and field · 75%* and
      *Varsity basketball · 22%*, in that order — activity-name order, so two renders of the card
      never disagree.
- [ ] The count line reads **5 young people shown** — young *people*, not activities, now that a
      card is a person.
- [ ] Each pill's percentage matches the seeded counts exactly (see the table above).
- [ ] Hovering a pill shows both halves in words — *"Somebody went to 1 of 8 home games played,
      and somebody is going to the next one."* — and **the singular is right**: a 1-of-1 pill must
      read *home game*, not *home games*.
- [ ] **Track and field's tooltip has no second half at all** — *"Somebody went to 3 of 4 home
      games played."* — because nothing is coming up. A trailing "and nobody is down for the next
      one" there would be describing an event that does not exist.

**What counts as support**

- [ ] A leader who **signed up and never answered** does not count *on a past game*. Maya's
      *Winter concert* has an attendee and her pill is still **33%**.
- [ ] A leader who answered **"I did not go"** does not count. Her *week five* rehearsal has an
      attendee and her pill is still **33%**.
- [ ] Maya's pill is **33%** exactly, and her tooltip reads *"Somebody went to 2 of 5 home games
      played, and nobody is down for the next one."* Check the sentence, not only the number — 50%
      has two possible causes and only the tooltip separates them.

**The plan half**

- [ ] Ethan's basketball pill is **22%**, not 13%: 1 of 8 played **plus** the next game, which the
      bishop is down for. Dropping the plan half would show 13%; counting the whole future would
      show something lower still.
- [ ] Pressing **I'll go** on Maya's *Spring concert* moves her pill **33% → 50%** with no reload,
      and the tooltip's second half flips to *"and somebody is going to the next one."*
- [ ] An activity with **nothing coming up** counts only its history — Ethan's track stays **75%**
      whatever happens to anybody's schedule.

**Absence of data is not a zero**

- [ ] **Josh, Sofia and Liam all show `—` on their pills, never `0%`.** Three different reasons —
      all away, tbd-and-cancelled, and no events at all — and all three must read the same way,
      because they are the same fact: nothing to count on either side of the clock.
- [ ] Hovering one of those pills reads *"No home games played yet, and none coming up."*
- [ ] **A genuine 0% is NOT an em dash.** An activity whose next home game has nobody down for it
      and nothing played yet reads **0%** and sorts **first** — that is a real score a leader can
      move, not missing data. The seed has no such case; make one by adding a future home game to
      Liam's Cross country from `/youth/profiles`, and remove it afterwards.
- [ ] Under **Priority / Least supported first**, the order is
      **Ethan (22%), Maya (33%), Josh, Liam, Sofia** — the lowest percentage first, the three
      no-data young people last, in name order.
- [ ] **Reversing the direction** to *Most supported first* gives
      **Maya (33%), Ethan (22%), Josh, Liam, Sofia** — the three no-data young people **stay
      last**. *(The single most valuable line in this file. It is the deliberate opposite of the
      sort it replaced, where a null sorted first.)*
- [ ] The **name tie-break does not flip** with the direction: Josh, Liam, Sofia stay in that order
      in both.
- [ ] **Sort by Name** gives **Ethan, Josh, Liam, Maya, Sofia** and its reverse gives
      **Sofia, Maya, Liam, Josh, Ethan** — every percentage ignored in both.
- [ ] The direction button says **what it does** — *Least supported first* / *Most supported first*
      under Priority, *A to Z* / *Z to A* under Name — never "ascending".
- [ ] Percentages are **not colour-coded**. The coverage badge is the only coloured signal on a
      card.

**Search**

- [ ] Searching `ethan` leaves **one** card and the count reads **1 young person shown**.
- [ ] Searching `choir` leaves **Maya's** card — search matches activity names as well as the
      young person's name.
- [ ] Searching `track` leaves **Ethan's** card, with **both** pills still on it.
- [ ] Search is case- and whitespace-insensitive: `ETHAN`, `ethan` and `  ethan  ` agree.
- [ ] Clearing restores all five and **5 young people shown**.

**The expanded card**

- [ ] Expanding **Ethan** shows events from **both** activities — basketball and track — and
      **nobody else's**.
- [ ] **Show past events** inside Ethan's card reveals **8 basketball games and 4 track meets**,
      and the heading's count changes with them. *(The count and the list must agree: a card
      showing "1 of 8" must expand to a list where eight home games are findable — ITER-022.)*
- [ ] The expanded card is **visually distinct** from the ones around it — a left accent border —
      so it is obvious where one young person's block ends and the next begins.
- [ ] Only **one** card is open at a time; expanding Maya collapses Ethan.
- [ ] The card toggle carries `aria-expanded` and `aria-controls`, and both change with the state.
- [ ] Ethan's card badge reads **`Covered · 1`**, matching the single attendee on his one upcoming
      game. *(The youth-e walk found every covered card reading `Covered · 0`. The **number** is
      the check, not the state.)*
- [ ] Liam's card renders with **`Cross country · —`**, "0 events coming up", and no error.

**The live case — a follow-up that says "I went"**

- [ ] Inside Maya's expanded card, *Choir rehearsal showcase, week four* offers **Say how it went**
      even though this reader is **not** down for it.
- [ ] The form asks **Did you go?** and the sentence beneath reads *"You are not down for this one.
      Saying you went adds you to who was there."*
- [ ] Answering **I went** and saving moves **Maya's pill from 33% to 50%** — in the **same
      interaction**, without a reload. *(The percentage is derived from the widened attendee cache
      entry, which `FOLLOW_UP_MUTATION_INVALIDATES` refetches. If the pill does not move, the
      derivation is reading a prop — defect youth-a-D2.)*
- [ ] Her attendee row now exists with `confirmed_attendance = true` and **`assigned_by` null** —
      null means she added herself, which is what happened.
- [ ] Answering **I did not go** on some other unattended past event creates **no** attendee row at
      all, and that event's coverage is unchanged. *(A row created to record an absence would put
      somebody on the list the coverage badge counts.)*

**Everything youth-e already held**

- [ ] Writing a follow-up removes the row from **Waiting on your follow-up** and the heading's
      count drops in the same interaction.
- [ ] The panel's heading reads **Waiting on your follow-up (1)** on first paint — the *Regional
      choir festival*, already written up, is not listed.
- [ ] **Ask someone to go** is **absent** for this reader, not present-and-refusing. She is an org
      president, not the bishopric.
- [ ] **/youth/profiles** holds the activity list, the schedule (unfiltered, headed *Schedule*) and
      the add-event form. Its heading reads **Activities and schedule**, and it carries **no**
      second copy of the follow-up panel.
- [ ] `/youth?youth=<Ethan's basketball profile id>` opens with **Ethan's card** already expanded —
      the parameter still names a profile and resolves to the young person who owns it. A made-up
      uuid opens the page with nothing expanded rather than erroring.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] **Does the percentage read as a fact or as a score?** "Varsity basketball · 13%" is the
      strongest thing this page says about a young person. It measures **recorded** support, not
      support — does it read that way, or does it read like a grade somebody failed?
- [ ] **Is `—` obviously "nothing has been played" rather than "nothing loaded"?** Three of the
      five cards carry it. `youth-c` found an empty state rendering nothing reads as a failed load.
- [ ] **Do two pills on one card read as two seasons, or as one confusing card?** Ethan at 13% and
      75% at the same time is the whole reason a card is a person.
- [ ] **Does the direction button read as a control or as a label?** It says *Least supported
      first* — a leader has to understand that pressing it changes the order rather than describing
      it.
- [ ] **Is "Priority" the right word?** It is the code's word for "least supported first". Would a
      leader who has never read this file know what it ranks on?
- [ ] **Does the left accent on an expanded card fight the danger stripe inside it?**
      `COVERAGE_EDGE_CLASSES` puts a red left edge on an uncovered event **inside** the card that
      now has a primary left edge of its own. If the two compete, the outer card should take a
      heavier full border instead.
- [ ] Is the **expand-in-place** card the right shape on a phone, or does an opened card bury the
      rest of the list?
- [ ] Does the **follow-up panel above the list** still read as the first thing on the page?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Pressing **I'll go** with the dev server stopped mid-tap shows a sentence rather than failing
      silently.
- [ ] With `/api/youth/events` failing, the page shows an error message **and keeps showing the
      cards it already had**. REWRITTEN 2026-08-29 during the walk: this line used to end "rather
      than an empty list that reads as 'this ward has no activities'", and that half **cannot
      fail** — the server seeds the list, so a failed refetch always still has rows to render. The
      risk worth checking is the opposite one: a **stale** list with no notice. So the check is now
      that the sentence appears *and* the list survives, which can fail either way.
- [ ] A search matching nothing reads **"Nothing matches that search. Clear it to see everybody
      again."** — not the same sentence a ward with no activities gets.
- [ ] Inside an expanded card with no events, the empty state reads for a **person**
      (*"Nothing coming up for this young person…"*), not for an activity.

## Walkthrough record

**THE METRIC CHANGED AFTER THIS WALK.** The record below is accurate for what was on screen at the
time, and its percentages are **superseded**: the horizon became *every past game plus the next
one* on the user's instruction after reading question 2 of the review page, so 13% is now 22% and
40% is now 33%. Everything the walk proved about **structure** — one card per person, the null
sorting last in both directions, the write paths, the deep link, the counts, 375px — is unaffected
and was re-verified in the browser after the change. **The re-verification is at the end.**

**2026-08-29 — driven by Claude in a real browser (Playwright), against the hosted project.**
Signed in as `yw-president`. **Every value below was read back with the service client**, never
taken from the screen alone. The seed places events relative to `now`; distances are what the
database held at walk time. **No defects found.** Review page carrying the seven judgement
questions and their screenshots:
`https://claude.ai/code/artifact/c3070821-45e6-431a-8185-63ed213dcfca`

**The seed, read back from the database rather than taken from the script:**

| Young person | Activity | events | past home, not cancelled | confirmed | pill |
|---|---|---|---|---|---|
| Ethan Brooks | Varsity basketball | 9 | **8** | 1 | **13%** |
| Ethan Brooks | Track and field | 4 | 4 | 3 | **75%** |
| Maya Chen | Concert choir | 6 | 5 | 2 | **40%** |
| Josh Okafor | Club soccer | 4 | **0** (all away) | — | **—** |
| Sofia Nielsen | Debate club (**org NULL**) | 2 | **0** (1 tbd, 1 cancelled) | — | **—** |
| Liam Nielsen | Cross country | 0 | 0 | — | **—** |

**Ethan rendered ONCE, with two pills**, in activity-name order — the case the previous seed could
not make, and the reason the card-per-profile problem survived the youth-e walk.

**All four orders, read off the live DOM and compared against orders computed independently from
the database:**

| Rank | Priority ▲ *Least supported first* | Priority ▼ *Most supported first* | Name ▲ | Name ▼ |
|---|---|---|---|---|
| 1 | **Ethan Brooks** (13%) | **Maya Chen** (40%) | Ethan Brooks | Sofia Nielsen |
| 2 | Maya Chen (40%) | Ethan Brooks (13%) | Josh Okafor | Maya Chen |
| 3 | Josh Okafor (—) | Josh Okafor (—) | Liam Nielsen | Liam Nielsen |
| 4 | Liam Nielsen (—) | Liam Nielsen (—) | Maya Chen | Josh Okafor |
| 5 | Sofia Nielsen (—) | Sofia Nielsen (—) | Sofia Nielsen | Ethan Brooks |

- **The assertion this slice turns on holds: reversing the direction swapped Maya and Ethan and left
  the three no-data young people LAST, in name order.** The nulls did not flip with the direction —
  the deliberate opposite of the `nobody_all_season` sort this replaced.
- The **name tie-break did not reverse** with the direction in either priority order.
- **Name ignores support entirely**: Liam and Josh (no data) sit *between* the percentage-holders
  rather than being pushed last, in both directions.
- Tooltips read *"Somebody went to 1 of 8 home games."*, *"…3 of 4…"*, *"…2 of 5…"*, and
  *"No home games played yet."* on all three em-dash pills. **No `0%` anywhere on the page.**
- **The pills carry no colour system.** All six computed to one identical style
  (`color rgb(161,161,170)`, transparent fill, `border rgb(46,46,46)`) while the coverage badges
  were green `rgb(74,222,128)` and red `rgb(248,113,113)`.

**Search**, all read off the DOM: `ethan` → 1 card / **"1 young person shown."** (the singular is
right); `   ETHAN   ` → identical; `choir` → Maya; `track` → **Ethan, with both pills still on
him**; `zzzz` → 0 cards and *"Nothing matches that search. Clear it to see everybody again."*;
cleared → 5 cards / "5 young people shown."

**Expansion.** `aria-expanded` was `true` on exactly one card, with `aria-controls` pointing at the
one rendered panel. Ethan's card opened at **"Ethan Brooks (1 upcoming event)"**; **Show past
events** widened it to **"(13 events)"** — **9 basketball + 4 track**, matching the database
exactly, and nobody else's. Expanding Maya collapsed Ethan. Throughout, the panel above still read
**"Waiting on your follow-up (1)"**, proving the shared seed was not poisoned by the filtered
render. Ethan's card badge read **`Covered · 1`** and the event card inside it read `Covered · 1` —
the youth-e defect stays fixed. Only the expanded card carried the accent border
(`border-left: 4px rgb(29,78,216)`); the other four had none.

**The live case — a follow-up saying "I went" on an event the reader never signed up for.**
On *Choir rehearsal showcase, week four* (no attendee rows at all) the form asked **"Did you go?"**
with both buttons at `aria-pressed="false"` and the sentence *"You are not down for this one.
Saying you went adds you to who was there. Leaving it is fine — the follow-up saves without it."*
Answering **I went** and saving moved the pill **40% → 60%** and the tooltip to *"Somebody went to
3 of 5 home games."* — **in the same interaction, without a reload**. Read back with the service
client: one attendee row, `confirmed_attendance = true`, **`assigned_by = null`**. The audit row
carried `attended: true`, `attendanceRecorded: true`, **`attendeeCreated: true`**.

**The refusal half.** On *week five* the same form, answered **I did not go** and saved: the
follow-up was written, **no attendee row was created** (the event still held only the Young Men
president's `confirmed_attendance = false` row), the pill stayed at 60%, and the audit row read
`attended: false`, `attendanceRecorded: false`, **`attendeeCreated: false`**. That is the boundary —
a row created to record an absence would put somebody on the list the coverage badge counts.

**Deep link.** `/youth?youth=b3e9bbe4…` — Ethan's **track** profile — opened **Ethan's** card
already expanded, proving a profile id resolves to the young person who owns it from either of his
activities. A made-up uuid rendered all five cards with **none** expanded and no error.

**The two filtered empty states read for a PERSON**, which is what changed with the prop: Liam's
card gave *"Nothing coming up for this young person. Show past events, or add one from the
activities page."* and, widened, *"No events have been entered for this young person yet."*

**`/youth/profiles`.** `h1` = "Activities and schedule"; sections *Activities (6 activities)*,
*Add a youth activity*, *Schedule (2 upcoming events)*, *Add an event*. **No second follow-up
panel.** **"Ask someone to go" was absent** for the org president (0 occurrences), not
present-and-refusing.

**Failure behaviour.** With `/api/youth/events` intercepted to a 500, a follow-on mutation surfaced
**"Could not load the activity events."** while all five cards stayed rendered — never the "No
activities have been entered for this ward yet" fallback. The attendee write itself succeeded and
the card badge and the event card inside it moved to `Covered · 1` together.

**375px**, both themes: `scrollWidth 360 = clientWidth 360`, no horizontal overflow. Every
`button`, `select` and `input` at least 44px tall; the only sub-44 targets were the three **inline
prose links** in the page header, which pre-date this change.

**Correction made to this checklist during the walk.** The `/api/youth/events` failure line was
**half unfalsifiable** and has been rewritten (see Failure Behavior). The server seeds the list, so
a failed refetch always still has rows to render — the "empty list" it guarded against cannot
occur. The real risk is a **stale** list with no notice, and the check now names both halves so it
can fail for the thing that could actually break.

**Deliberate side-effects left in the harness data:** the two follow-ups filed above, plus one
attendee row on *Spring concert* from exercising the failure path. Maya's choir pill therefore
reads **60%** rather than the seeded 40% until the scenario is reseeded, and her badge reads
`Covered · 1` rather than "Nobody going". Re-running the seed restores every figure in the table at
the top of this file.

**Not walked:** the seven "needs a human eye" lines — those are the review-page questions, with
screenshots in `testing/walk-screenshots/057f-*.png`.

### Re-verified 2026-08-29, after the horizon changed

The user answered the review page: questions 1, 4 and 7 approved as-is; question 2 asked for the
denominator to become *every past event plus the next one*. That was built, the scenario was
reseeded, and the page was read again in the browser against the database:

| Pill | Tooltip |
|---|---|
| `Track and field · 75%` | "Somebody went to 3 of 4 home games played." — **no second half**, nothing is coming up |
| `Varsity basketball · 22%` | "Somebody went to 1 of 8 home games played, and somebody is going to the next one." |
| `Concert choir · 33%` | "Somebody went to 2 of 5 home games played, and nobody is down for the next one." |
| `Club soccer · —` · `Cross country · —` · `Debate club · —` | "No home games played yet, and none coming up." |

- **The plan half is live and actionable.** Pressing **I'll go** on Maya's *Spring concert* moved
  her pill **33% → 50%** with no reload, and the tooltip's second half flipped to *"and somebody is
  going to the next one."* That is the property the change exists for: before it, no action a
  leader could take today moved this number.
- **The order did not change** — Ethan (22%), Maya (33%), then Josh, Liam, Sofia — so every
  ordering claim above still holds.
- **Question 6 was decided, not deferred:** "Did you go?" stays asked of everybody as an interim,
  because it never appears unprompted and the trigger the user wants — a leader with their own
  youth at the same event — is blocked by two schema facts (no `users.member_id`; an event belongs
  to one profile until ITER-024). Recorded in CLAUDE.md §9.
- **Question 3 became ITER-028** (closing out a season, with the history that outlives it), which
  reverses the standing "no season boundary" decision. Not built here.

<details>
<summary>The previous walk (youth-e — three sorts, one card per activity). Kept because the defect it found and the fix are still load-bearing.</summary>

Driven by Claude in a real browser (Playwright), against the hosted project. Every value was read
back with the **service client**, never from the screen alone. Signed in as `yw-president`.

**Both sorts, read off the live DOM — and the top of one was not the top of the other:**

| Rank | *Nobody going yet* (default) | *Nobody has been in a while* | *Name* |
|---|---|---|---|
| 1 | **Maya Chen** (`Nobody going`) | **Ethan Brooks** (run 8) | Ethan Brooks |
| 2 | Ethan Brooks | Maya Chen (run 0) | Josh Okafor |
| 3 | Josh Okafor | Josh Okafor | Liam Nielsen |
| 4 | Liam Nielsen | Liam Nielsen | Maya Chen |
| 5 | Sofia Nielsen | Sofia Nielsen | Sofia Nielsen |

The `visits-f` trap was closed: the three no-signal profiles sorted in the last group under both.
Search, expansion, the deep link, `/youth/profiles`, "Ask someone to go" absence and 375px in both
themes all passed; details are in git history for this file.

**ONE DEFECT FOUND, AND FIXED — the overview card badge rendered `Covered · 0` for every covered
profile.** `YouthOverview` passed a literal `attendeeCount: 0` to `CoverageBadge`, which appends
` · {attendeeCount}` for the `covered` state only, because `ProfileNeed` carried `worstUpcoming`
and `soonestNeedOn` but **not** the attendee count of that event. Proved against the database:
Ethan's upcoming game held `att=1 [bishop]` while his card said `Covered · 0`. The **state** half
was correct, so this was a wrong *number*, not a stale view — the Pitfall 3 / ITER-022 shape, a
card displaying a number that is not the value it computed. Fixed by carrying the whole event row:
`ProfileNeed.worstUpcomingAttendees` is taken off the same row `worstUpcoming` and `soonestNeedOn`
come from, so the three cannot describe different events. `youthNeed()` preserves that tie across
activities by reducing over whole `ProfileNeed`s rather than three fields of three.

</details>

## Notes

- **Why the horizon is "every past game plus the next one".** Decided 2026-08-29 after walking
  this scenario. The number should be *the history of support plus the plan of support for the next
  event*. Counting the whole remaining season would let an imported fixture list drag every
  percentage down for a reason nobody did anything about; counting only the past would make the
  number unmovable. There is still **no season boundary in the schema** —
  `youth_activity_profiles.season_schedule` is free text (`"November to February"`) and nothing can
  compute against it — so "played" means past *on this profile*, and the profile is still the
  season. **Closing a season out is asked for and not built** (CLAUDE.md §9).
- **Home games only.** An away game carries no coverage expectation **by design**
  (`08-youth-activities.md` §Step 4), so counting one would manufacture alarm about a rule working
  correctly. Josh exists to make that visible: four away games, nobody at any, and his pill still
  reads `—`.
- **"Expected" means a past HOME event that was not cancelled.** Three exclusions, three different
  reasons, and `lib/youth/profileNeed.ts` comments each one. Josh and Sofia make all three visible
  on a real screen.
- **"Past" is the START instant.** This schema has no duration column, so a game that kicked off an
  hour ago is already past. Named in `lib/youth/coverage.ts` and `lib/youth/followUp.ts`, and not a
  bug to raise.
- **The percentage measures RECORDED support.** It is only as true as the reporting, which is why
  a follow-up saying "I went" now creates the attendee row. If a walk finds leaders still not
  recording, the answer is fewer taps, not a different metric.
- The notification bell in the header is an inert placeholder until Phase 11. Read the
  `notifications` table instead.
