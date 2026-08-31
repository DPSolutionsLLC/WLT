---
name: Two young people, one game
scope: youth
part: 9
tags: [youth, full, occasions, event-detail, cross-org]
prerequisites: none
---

## Purpose

`activity_events.profile_id` is a single foreign key, so **an event belongs to exactly one young
person**. Ethan Brooks and Josh Kim on the same basketball team, at the same game on Friday, are
**two rows**, two calendar cards, and nothing anywhere records that they are the same evening in
the same gym.

This scenario proves that one real game held as two rows can be **joined by a person**, that
`/youth/events/[id]` answers *"who else is in that gym"*, and that an occasion where **one** young
person has nobody committed reads as an **alert** while the others read as covered.

Seeding matters because the honest starting state is *two rows a school feed produced weeks apart,
in two different organizations* — twenty minutes of clicking to build by hand, and wrong the moment
the clock moves. The two titles differ on purpose (*"Game against Roosevelt"* and *"Game vs
Roosevelt"*), which is exactly why the link is **explicit and stored** rather than matched on title
and date.

A green suite cannot see the two things this walk is for: whether the count beside *"+N others"*
survives a filter, and whether the occasion badge moves when somebody signs up **without a
reload**.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…`, `ym-president@…` (**the account to sign in as**), `yw-president@…` |
| Households | Brooks, Kim, Reyes |
| Members | 3 youth — Ethan Brooks, Josh Kim (Young Men), Ava Reyes (**Young Women**) |
| Activity profiles | 3 — all *Varsity basketball*, two Young Men and one **Young Women** |
| Activity calendars | 2, one per Young Men profile, `source_type: "ics_upload"` |
| Events | 6 |
| Attendees | 1 row |

The events that carry the scenario:

| Event | When | Whose | Occasion | Must read |
|---|---|---|---|---|
| **Game against Roosevelt** | +3 days, 7:00pm | Ethan | **none** | `Nobody going`, red edge, *"From a schedule feed"* |
| **Game vs Roosevelt** | +3 days, 7:00pm | Josh | **none** | `Covered · 1`, *"From a schedule feed"* |
| Track time trial | +3 days, 4:00pm | Ethan | none | a plausible wrong answer in the picker |
| Choir rehearsal | +3 days, 5:30pm | Ava | none | the other plausible wrong answer |
| Game against Jefferson | **+10 days** | Ethan | none | **must never appear in the picker** |
| Game against Madison / Madison game | **−6 days** | Ethan + Josh | **already joined** | the past occasion, proving the page works after the game |

**Sign in with:** `ym-president@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.
**Why the Young Men president:** they own both Roosevelt rows, so joining them is ordinary work —
and adding **Ava**, a Young Women youth, is the cross-organization case falling out of the design
rather than being engineered.

## Steps

1. `npm run seed -- youth/scenario-059-two-young-people-one-game`
2. `npm run dev`, then open http://localhost:3000 and sign in as `ym-president@…`
3. Open **/youth/calendar**. Read the two Roosevelt cards — **two cards, one game**, and neither
   says anything about the other. This is the state the slice exists to fix.
4. Click the title of **Ethan's** Roosevelt card. Read the detail page before touching anything.
5. Press **This is the same game as…**. Read **every** option: it should offer the same-day events
   and **not** next week's, and each option should name the young person, not just the title.
6. Choose **Josh Kim · Varsity basketball**, then **Same game**.
7. Read the occasion badge. Josh has somebody going and Ethan does not, so the occasion must read
   as an **alert**, not as covered.
8. Press **I'll go** on **Ethan's** row and watch the occasion badge — **without reloading**.
9. Press **Another young person was at this** and add **Ava Reyes · Varsity basketball**.
10. Read Ava's new row: its home/away chip, its feed chip (or absence of one), and who is down.
11. Go back to **/youth/calendar** and read the Roosevelt cards again.
12. Filter the calendar to **Ethan** only, and read the marker on his card again.
13. Open **/youth**, expand Ethan's card, press **Show past events**, and open the **Madison**
    occasion's detail page from there.
14. On one row of the Roosevelt occasion, press **Not the same game**. Then re-join it.
15. Read `/youth/events/[id]` at 375px, in both light and dark.

## Verification Checklist

### Machine-checkable

- [ ] Before step 6, `/youth/calendar` shows **two separate Roosevelt cards** with **no marker** on
      either.
- [ ] Every event card's **title is a link** to `/youth/events/<id>`, and following it opens the
      detail page for that event.
- [ ] The join picker offers only events on **the same day**, and **Game against Jefferson**
      (+10 days) is **not** among them.
- [ ] The picker does **not** offer the event you are already on.
- [ ] Every option names the **time, the young person and the activity** — not the title alone.
      Both Roosevelt rows are *Varsity basketball*, so an option reading only the activity would be
      unusable.
- [ ] After joining, the detail page lists **both** Ethan and Josh, each with their own coverage
      badge and their own **I'll go**.
- [ ] With Josh covered and Ethan not, the **occasion badge reads `Nobody going`** and a sentence
      beside it says one of these young people has nobody going. It must **not** read `Covered`.
- [ ] Pressing **I'll go** on Ethan's row changes the occasion badge **without a reload**.
- [ ] Adding **Ava Reyes** creates a row on the same occasion, owned by **Young Women**, and the
      **Young Men president was permitted to do it** — the cross-organization case.
- [ ] Ava's new row is chipped **Home** (its location matches the ward's venue list). If the seed's
      location is altered to something unmatched, it reads **Home or away?** and **never Away**.
- [ ] Ava's row carries **no** *"From a schedule feed"* chip; the two imported rows still do.
- [ ] Back on `/youth/calendar`, all three cards read **"+2 others at this game"** and each links to
      the same page.
- [ ] **Filtered to Ethan only, his card still reads "+2 others at this game"** — not "+0". This is
      the one checklist line most likely to catch a real defect.
- [ ] A card with no occasion renders **no marker at all** — not "+0 others".
- [ ] Singular reads correctly too: unlink down to two rows and the marker says **"+1 other at this
      game"**, not "+1 others".
- [ ] The **past** Madison occasion renders in full at `/youth/events/<id>`; its rows are **not**
      hidden because the game has happened.
- [ ] **Not the same game** removes one row and leaves the others intact; re-joining restores it.
- [ ] Unlinking down to a **single** row leaves that row with **no marker**, and the occasion is
      gone rather than left behind holding one row.
- [ ] Every event still exists after an unlink — `set null`, never `cascade`.
- [ ] At 375px nothing overflows, and every control is at least 44px tall.

### Needs a human eye

- [ ] **Does the detail page answer "who else is in that gym" at a glance?** The occasion badge is
      above the rows and each row carries its own — is the relationship between them obvious, or
      does it read as two badges saying different things about the same event?
- [ ] Is *"This is the same game as…"* a sentence a leader would understand without being told what
      an occasion is? The word "occasion" appears nowhere on screen on purpose.
- [ ] Does *"+2 others at this game"* invite a tap, or read as decoration?
- [ ] In **dark** mode, does the occasion panel read as a panel rather than as a hole? `--surface`
      inverts meaning between themes (`youth-d` found exactly that).
- [ ] With three rows and two build controls, is the page still scannable on a phone, or has it
      become a form?

## Failure Behavior

- [ ] Joining with the dev server stopped mid-tap shows a **sentence** rather than failing
      silently.
- [ ] Joining two rows that are **already in different occasions** shows the route's sentence
      naming the alternative — *"Take one out of its game first, then join it to this one."* — and
      **neither row moves**. (Build a second occasion first: join the Track time trial and the
      Choir rehearsal, then try to join Ethan's Roosevelt row to the Track row.)
- [ ] Joining the same two rows twice shows *"Those two are already recorded as the same game."*
      rather than creating a second occasion.
- [ ] Signed in as an **org secretary** (a role with `youth_activities.view` but not `.manage`),
      the two build controls and **Not the same game** are **absent** — not present and refusing.

## Walkthrough record

**2026-08-29 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every write was read back with the **service client**. Signed in as `ym-president`, then as a
purpose-made `org_secretary`, then back.

**The seed, read back from the database.** 6 events. The two Roosevelt rows at **+3.1d, 7:00pm**,
both `home`, both carrying a `source_uid`, **both `occasion_id: null`** — Ethan's with `att=[]`,
Josh's with `att=[Miguel Cortez]`. Track time trial +2.9d and Choir rehearsal +3.0d on the same
day; Jefferson at **+10.1d**; the Madison pair at **−5.9d** already sharing occasion `e4426e82`.

**THE HEADLINE RESULTS.**

| Check | Observed |
|---|---|
| Before the join | two separate Roosevelt cards, **no marker on either** |
| Join picker contents | `4:00 PM · Ethan Brooks`, `5:30 PM · Ava Reyes`, `7:00 PM · Josh Kim` — **Jefferson (+10d) absent**, and the event being viewed absent |
| After joining | occasion `a706cd89` created, **both rows stamped**, occasion count 1→2, audit `created: true` |
| Occasion badge, one covered + one not | **`Nobody going`** + *"One of these young people has nobody going."* — the alert, not `Covered` |
| **I'll go** on Ethan's row | badge → **`Covered · 1`**, sentence gone, **`navigationCount` still 1** (no reload) |
| Adding Ava (Young Women) as the **Young Men** president | 201, row on the **same** occasion, `org=1a5`, occasion count **still 2** |
| Ava's row | `event_type=home`, audit `eventTypeSource: "classified_from_location"` — **not copied**; `calendar_id` null, `source_uid` null, **no feed chip** |
| All three cards on `/youth/calendar` | **"+2 others at this game"**, each linking to the same page |
| **Filtered to Ethan only** | 3 cards shown, Josh's and Ava's gone, **his card still reads "+2 others at this game"** |
| Cards with no occasion | **no marker at all** — never "+0 others" |
| Singular | after unlinking Ava, **"+1 other at this game"** on both survivors |
| Past Madison occasion | **renders in full**, both rows, no coverage badges (past → `not_expected`) |
| Empty picker | *"No other youth activity is scheduled that day. If somebody else was there, add them below instead."* |

**THE MIGRATION 046/047 REGRESSION, PROVED END TO END.** Pressing **Not the same game** on Ethan's
Madison row deleted occasion `e4426e82` (it did **not** raise), left **both** Madison events
standing with `occasion_id: null`, and kept **all 8 events** in the table. Audit recorded
`occasionRemoved: true`. Re-joining restored the pairing as a new occasion `c038bd70`.

**The three refusals, each asserted with a re-read afterwards showing nothing moved:**
same occasion → **409** *"Those two are already recorded as the same game."*; different occasions →
**409** *"Both of those are already part of a game with other young people. Take one out of its
game first, then join it to this one."*; itself → **400** *"An event cannot be the same game as
itself."* An unknown event id → **404**.

**Permissions, both directions.** As `org_secretary` (holds `youth_activities.view` and `.log`,
not `.manage`) the join picker, the add picker and **Not the same game** were **absent — 0
occurrences**, while all 3 rows and **I'll go** remained. `DELETE .../occasion` called directly
answered **403**. UI and API agree.

**TWO DEFECTS FOUND — see below. Both are in the new event-detail page and neither is in the data
layer.**

**BOTH DEFECTS WERE FIXED AND RE-VERIFIED THE SAME DAY, after the user reviewed the walk. A third
change came out of the judgement questions.** The record below states each as found, then as fixed.

**D1 — the join picker overflows at 375px. FIXED.** `documentElement.scrollWidth 393` vs
`clientWidth 360`. The single offending element is `JoinOccasionPicker`'s `<select>`: a `<select>`
sizes to its widest option, the options here are deliberately long (`time · young person ·
activity`), and `SELECT_CLASSES` carries no width cap. `/youth/calendar` at the same width measures
**360 = 360**, so this is specific to this slice rather than inherited.
**Fix:** `w-full min-w-0` on the select plus a `min-w-0 flex-1 basis-64` wrapper — `min-w-0` is the
half that does the work, because a flex item's default `min-width: auto` refuses to shrink below
its content and `w-full` alone would still have overflowed. `AddYouthToOccasion` was given the same
guard although it was not the offender: a long family name would reach the same place, and two
pickers in one card behaving differently at one width is what nobody finds until a ward with long
names uses it. **Re-measured: 360 = 360, zero offending elements.**

**D2 — the occasion sentence is plural on a solo event. FIXED.** An event with **one** row and no occasion
renders *"One of these young people has nobody going."* above a row whose own badge already reads
`Nobody going`. Reproduced on **Track time trial** (1 row, +2.9d, uncovered). The sentence is
correct only from two rows up.
**Fix:** the whole panel is now hidden below two rows, not just the sentence — guarding the sentence
alone would have left the duplicated badge. **ONE ROW IS NOT AN OCCASION**, and a single-row page is
now simply the young person's card, which is the honest rendering: there is no evening-wide fact to
summarise until a second row exists. Re-verified on *Track time trial*: no panel, no plural
sentence, `Nobody going` appearing exactly once. The two-row case is unchanged — banner present,
alert sentence present, still moving with no reload.

**D3 — a picker option omitted the event's title. RAISED AS A JUDGEMENT CALL, ANSWERED, FIXED.**
An option carried the profile's **activity name** but not the **event title**, so two events of one
young person on one day were indistinguishable apart from a time —
`4:00 PM · Ethan Brooks · Varsity basketball` was in fact *Track time trial*. The rule was *"never
the title ALONE"*, which is still right; dropping it entirely went one step too far.
**The user's answer: the title should be there.** Options now carry all four facts —
`4:00 PM · Ethan Brooks · Varsity basketball · Track time trial`. The activity says whose season a
row belongs to, the title says which event; neither is sufficient alone. This made D1 more urgent
rather than less, which is why the two were fixed together.

**The four judgement questions were answered by the user on 2026-08-29:**

1. *Two badges, one event — does the relationship read?* **Yes, it makes sense.** One youth covered
   and one not is exactly the case the banner exists for. The user added the rule that sharpens
   **ITER-027**: this is where a leader already committed to one young person should be told that
   **another young person at the same event has nobody committed to them** — the trigger is the
   COVERAGE GAP, not mere presence. Recorded in `.iterate/scopes/ITER-027.md`.
2. *Does "This is the same game as…" explain itself?* **Yes.** No change.
3. *Should an option carry the event's title?* **Yes** — D3 above.
4. *Does the occasion panel read as a panel or a hole in dark mode?* **A panel.** No change.

**Corrections made to the seed during the walk.** The first run failed with
`duplicate key … youth_activity_profiles_pkey`: `createYouthActivityProfile` derives its default id
from the **activity name alone**, and all three profiles are called *Varsity basketball* — which is
the point of the scenario. Fixed by passing explicit `testUuid("profile:<youth>:…")` ids, with a
comment saying why.

**Not walked.** The *"`away` is never copied onto the new row"* case was **not** re-driven in the
browser — `tests/routes/youthEvents.test.ts` pins it against the hosted project as a genuinely
authenticated user, seeding a source row hand-corrected to `away` at an unmatched venue and
asserting the new row is `tbd`. The two "with the dev server stopped / with the API failing" cases
were not simulated. Every "needs a human eye" line was captured as a screenshot and passed to the
user rather than self-assessed. Screenshots in `testing/walk-screenshots/059/`.

## Notes

- **An occasion is identity and nothing else** — no name, no date, no place. Those already live on
  the event rows, and a second copy could disagree with the first. That is why the page's heading
  is the viewed event's title rather than the occasion's.
- **The ICS import does not create occasions.** A leader joins imported rows by hand, which is the
  flow this scenario walks. Re-importing either feed will not link or unlink anything.
- **The picker's day is bounded in the WARD's zone**, because it is a query bound and must offer
  the same candidates to every reader. **CORRECTED 2026-08-30:** this note used to add *"The time
  printed on a card is still the reader's own zone — those are two different questions."* They
  were two different questions, and `c24d52b` gave them the same answer — a turn-up-at
  `timestamptz` now renders in the ward's zone too, because a `"use client"` component is
  server-rendered before hydration and on a server there is no reader, so the reader's zone
  resolved to the server's (UTC on Vercel). The bound and the printed time are therefore now in
  the same zone. **The reasoning for the bound is untouched** and still stands on its own: a query
  bound must be uniformly evaluable whatever the rendering rule happens to be.
- **The calendar marks; it does not collapse.** One card per young person still, because an
  occasion spans youth, organizations and activity types, and collapsing would leave all four of
  that page's filters without a single answer.
