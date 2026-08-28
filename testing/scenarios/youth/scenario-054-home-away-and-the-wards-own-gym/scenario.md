---
name: Home, away, and the ward's own gym
scope: youth
part: 5
tags: [youth, full, classification, import]
prerequisites: none
---

## Purpose

Classification happens **on the way in** and is **never rewritten on re-import** — a guarantee
`youth-b` made *about this slice, in advance*:

> `status` and `event_type` are never touched on a matched row, so a hand-cancelled game and
> slice C's future home/away correction both survive.

Slice C is the change that starts writing `event_type` on an import at all, so it is the first
thing that could break it. That can only be checked by importing, correcting by hand, and
importing again — three steps and a file, which is exactly what a manual walkthrough is for.

The scenario also covers the **venue editor**, which is the reason classification works at all.
A timezone has a defensible fallback; a venue list does not. With no editor, auto-classification
is inert in every real ward and `home_venues` is a column nobody fills in — which is why it
shipped here rather than waiting for a Phase 11 admin screen.

`tests/lib/icsIdempotent.test.ts` pins the diff and `tests/lib/homeAwayClassification.test.ts`
pins the matching. Neither can answer whether the **preview screen says so, in words, before the
leader confirms** — and a guarantee nobody can see is a guarantee nobody trusts.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, **`home_venues` empty** — the tester configures it, which is the point |
| Users | `bishop@…` (bishop), `ym-president@…` (Young Men president) |
| Households | Brooks (2201 Canyon Road) |
| Members | 1 youth — Ethan Brooks, in Young Men |
| Activity profiles | 1 — *Varsity basketball*, Lincoln High School, owned by Young Men |
| Events | **none** — every row must come from the file |
| Fixture | `lincoln-basketball.ics`, scenario 051's file byte for byte |
| Second fixture | `lincoln-basketball-march.ics`, scenario 052's file. ADDED 2026-08-28 — see step 11 |

What the file contains, by location:

| Location | Entries | Becomes |
|---|---|---|
| Lincoln High School gym | 4 (one is a weekly practice) | 10 rows |
| Jefferson High School | 1 | 1 row — an away game published as UTC |
| Regional Sports Center | 1 | 1 all-day row |
| Lincoln High School cafeteria | 1 | **no row** — it has no `DTSTART`, and is listed under problems |

**Sign in with:** `ym-president@harness.wardleadershiptools.test` first, then
`bishop@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-054-home-away-and-the-wards-own-gym`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president@…`, open **/youth**, and confirm there is **no** Home venues panel.
4. Open **/youth/import**, choose *Ethan Brooks — Varsity basketball*, and upload
   `lincoln-basketball.ics`. **Read the preview before confirming** — every entry's home/away
   line, with no venues configured.
5. Confirm the import. Read the result screen, then `/youth`.
6. Sign out. Sign in as `bishop@…` and open **/youth**. Find the **Home venues** panel, open it,
   and read what it says will happen *before* saving anything.
7. Add `Lincoln High School` and save. Read the confirmation sentence.
8. Reload `/youth` and check whether any existing event changed.
9. Correct **one Lincoln game to Away by hand** using its Edit control — a deliberately
   wrong-looking correction. Correct the **Jefferson** game to Away as well, which is the
   right-looking one.
10. Open **/youth/import** and upload **the same file again**. It must report **0 to create, 0 to
    update, 12 already correct** — the two hand corrections do not even register as changes,
    because `event_type` is not a compared field. The confirm button is replaced by a disabled
    *Nothing to import*.
11. Now upload **`lincoln-basketball-march.ics`**, which contains two NEW games and one MOVED one.
    ADDED 2026-08-28: the checklist used to ask an identical re-import to "classify the new
    Lincoln games as Home", which is unreachable — an identical file creates nothing. Proving
    classification-on-create and the leave-alone rule needs a file that actually changes.
12. Confirm, then check both corrected games on `/youth`.
13. In Supabase, look at `activity_events.event_type` for the corrected rows and for the rest.
14. Add a game by hand on `/youth` at `Lincoln High School gym`, leaving the home/away select on
    its default. Then add another at the same location, choosing **Not yet known** explicitly.
15. Read the result screen and the preview at 375px.

## Verification Checklist

### Machine-checkable

- [ ] With no venues configured, the preview shows **every** entry as *Home or away not set* —
      not `Home`, and **never** `Away`. CHANGED 2026-08-28: the label was "Not yet known", which
      did not say *what* was not known.
- [ ] After confirming, every row on `/youth` carries the *Home or away?* coverage badge — and
      **only that**, with no second chip repeating it. CHANGED 2026-08-28: the card used to show
      both, and the chip was the vaguer of the two.
- [ ] The Home venues panel is **absent** for `ym-president@…` and **present** for `bishop@…` —
      absent, not present-and-refusing.
- [ ] The panel says, **before** the save, that existing events are not reclassified.
- [ ] Saving `Lincoln High School` stores it **exactly as typed** in `wards.settings.home_venues`
      — capitals intact. CHANGED 2026-08-28: it used to be lower-cased, and reading your own words
      back rewritten looked like a bug. Case is folded at comparison time instead.
- [ ] Saving does **not** change any existing event — `/youth` reads exactly as it did in step 5.
- [ ] `wards.settings` still holds `timezone` and `cross_org_visibility` after the save. *(The
      merge. A wholesale write here would delete the ward's other settings.)*
- [ ] Re-importing the **identical** file reports 0 to create, 0 to update, 12 already correct —
      a hand-corrected `event_type` is not a difference, so it is not even an update.
- [ ] Importing the **March** file classifies the new game at *Lincoln High School gym* as
      **Home** in the preview, before confirming.
- [ ] The new game at *Washington High School* previews as **Not yet known**, never *Away* —
      even though its own title reads "at Washington".
- [ ] The row under "to update" shows the **stored** value rather than the file's, and where the
      two differ it says **what this file would have set it to**. CHANGED 2026-08-28: "left as it
      is" alone did not say *instead of what*, so it read as filler rather than as a promise.
- [ ] After the second import, the hand-corrected Lincoln game is **still Away** — *the `youth-b`
      guarantee*.
- [ ] The Jefferson game is **still Away**, and was never auto-classified as away by the app.
- [ ] Nothing in the file ever produced an `away` classification on its own.
- [ ] A hand-entered event at `Lincoln High School gym` with the select left alone arrives
      **Home**.
- [ ] A hand-entered event with **Not yet known** chosen explicitly stays *Not yet known*, at the
      **same location** that classified the previous one as Home — a person's choice is not
      overwritten by the classifier.
- [ ] The `youth_activity_event_created` audit rows record `eventTypeSource` as
      `classified_from_location` for the first and `chosen` for the second.
- [ ] A `home_venues_updated` audit row exists carrying both the before and after lists.
- [ ] The result screen pluralises correctly at 1 and at many.
- [ ] Dates on every screen read `Sat, 2 Jan 2027`, never `1/2/2027`.
- [ ] No horizontal overflow at 375px.

### Needs a human eye

- [ ] On the first import, does *Home or away not set* on every row read as **the app declining to
      guess**, or as something that failed?
- [ ] Does the venue panel's sentence about existing events land **before** a leader saves, or is
      it buried where they will find it afterwards?
- [ ] "A match is on any part of the location" — is that comprehensible to somebody who has never
      thought about string matching?
- [ ] Does "Home or away stays Away — this file would have set it to Home" now make the override
      visible, where "left as it is" did not?
- [ ] Does the deliberately wrong correction (a Lincoln game marked Away) surviving the re-import
      feel **right** — the app respecting a person — or does it feel like a bug the app should
      have caught?
- [ ] Would a bishopric member reading the panel cold know what to type into it?

## Failure Behavior

- [ ] Saving 41 venues is refused with a sentence naming the limit.
  Automated: `tests/routes/homeVenues.test.ts` → *"refuses an over-long list with a sentence"*.
- [ ] An org president who reaches `PUT /api/ward-settings/home-venues` directly gets a 403
      naming the rule.
- [ ] Saving an empty list is accepted — a ward saying it has no home venues is a legitimate
      answer — and every future import then arrives *Not yet known*.
- [ ] The entry with no `DTSTART` appears under problems with a sentence, and creates no row.

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every `event_type` below was read back with the SERVICE CLIENT, never from the screen.

**The `youth-b` guarantee holds, including in its strongest form.**

- **First import, no venues configured.** All 12 occurrences previewed as **Not yet known** —
  zero "Home", zero "Away", including *Varsity Basketball at Jefferson* at *Jefferson High
  School*, which a naive classifier would have marked away. Stored: 12 rows, `{"tbd": 12}`.
  `home_venues` was `null` throughout. The entry with no `DTSTART` (*Season awards night*) was
  correctly listed under "1 entry this file could not use".
- **The venue panel is bishopric-only.** Absent for `ym-president@…` (`org_president`), present
  for `bishop@…`.
- **Saving `Lincoln High School`** stored `["lincoln high school"]` (lower-cased), and
  `timezone: America/Denver` and `cross_org_visibility: false` **both survived** — the merge.
  Audit row `home_venues_updated` with `previousHomeVenues: []`. No bishopric notification,
  correctly, because this ward seeds no counselors for the others to be notified.
- **Saving did NOT reclassify anything.** All 12 events were still `tbd` afterwards, including
  the 8 at "Lincoln High School gym" that now match the configured venue. The panel says this
  will happen before you save it.
- **Two hand corrections.** *Varsity Basketball vs Roosevelt* (at **Lincoln High School gym** — a
  deliberately wrong-looking correction the classifier would call `home`) → `away`. *Varsity
  Basketball at Jefferson* → `away`.
- **Re-importing the IDENTICAL file: 0 to create, 0 to update, 12 already correct.** The two
  corrections did not even register as changes, because `event_type` is not a compared field. The
  confirm button was replaced by a disabled **"Nothing to import"**.
- **Importing the March file (2 new games, 1 moved).** The preview said, before confirming:
  - to create: *Varsity Basketball vs Central*, Lincoln High School gym → **Home**
  - to create: *Varsity Basketball at Washington*, Washington High School → **Not yet known**
  - to update: *Varsity Basketball at Jefferson* → shown as **Away** (the stored value, not the
    file's), with *"Was … Fri, 22 Jan 2027, 19:30 — changing date and time. Home or away is left
    as it is."*
  - not in this file: *Team photo* and *vs Madison*, with "Nothing will change for them."
- **After confirming: 14 rows, `{"tbd": 11, "away": 2, "home": 1}`.** *Roosevelt* is **still
  `away`** despite sitting at the configured home venue. *Jefferson* is **still `away`** — and it
  is the strongest case in the whole scenario, because that row **was written** in this import
  (its date moved) and kept its `event_type` anyway.
- **Manual entry, both branches.** At the *same* location (`Lincoln High School gym`): leaving the
  select on **"Decide from the location"** stored `home` with audit
  `eventTypeSource: classified_from_location`; choosing **"Not yet known"** explicitly stored
  `tbd` with `eventTypeSource: chosen`. That is the whole reason
  `createActivityEventSchema` dropped its `.default("tbd")`. Both carry `source_uid = NULL`.
- **Copy.** Singulars and plurals correct throughout ("1 place", "1 entry this file could not
  use", "1 to update", "2 events are in the app and not in this file"). Every date read
  `Fri, 15 Jan 2027, 19:30` / `Fri, 28 Aug 2026` — never `1/2/2027`.

Corrections made to this file during the walk:

1. **Step 10 asked an identical re-import to "classify the new Lincoln games as Home".** That is
   unreachable: an identical file creates nothing, so there are no new games to classify. Split
   into step 10 (identical file → nothing to import, corrections invisible as changes) and a new
   step 11 using `lincoln-basketball-march.ics`, which has two new games and one moved one.
2. **Added `lincoln-basketball-march.ics`** to this scenario's folder (scenario 052's file,
   unchanged) so the scenario is self-contained.
3. **Sharpened the manual-entry check** to use the *same location* for both events, which is what
   makes "a person's choice is not overwritten" a real test rather than a coincidence.

Not walked: every "needs a human eye" line — those are in `walk-youth-c/REVIEW.html` with
screenshots.

### 2026-08-28, later — the review answers, and what changed

Two of this scenario's judgement questions came back as defects, and fixing the second one
introduced a third that this walkthrough then caught.

- **"Not yet known" was unreadable.** Asked what it meant, the reviewer could not tell: not known
  *whether anybody is going*? *whether it is home or away*? The label is now **"Home or away not
  set"**, which reads correctly as a standalone chip, as a preview row, and as a select option.
- **The lower-cased venue looked like a bug.** It now stores what the person typed, and
  `classifyEventLocation` folds case on both sides. Verified: panel reads *"1 place: Lincoln High
  School."*, and a location typed `lincoln high school GYM` still classifies `home`.
- **"Home or away is left as it is" did not say instead of what**, so it read as filler rather
  than as a promise being kept. The note now states the comparison the preview already holds.

**A copy defect introduced by that last fix, and caught by re-walking it.** The first version
interpolated the type label on both sides and rendered:

> Home or away stays Away — this file would have set it to **Home or away not set**.

It typechecked and broke no test. A label can be right on a chip and nonsense inside a clause, and
nothing about the types can tell the difference — which is the `youth-b` failure mode exactly.
The sentence is now built in two halves so the `tbd` label never enters one, and
`tests/components/youth/IcsPreviewNote.test.tsx` asserts that over **every** combination rather
than the three spelled out. Both branches verified in the browser:

- stored `away`, file would classify `tbd` → *"Home or away stays Away — this file would have left
  it for somebody to set."*
- stored `away`, file would classify `home` → *"Home or away stays Away — this file would have set
  it to Home."*

Also verified on the re-walk: with the venue configured **before** importing, 10 of the 12 rows
arrived `home` and 2 `tbd` — classification on the way in, working from a capitalised stored
venue.

## Notes

- **An unmatched location is `tbd`, never `away`,** and this is the decision a later reader is
  most likely to "improve". "Lincoln HS Gymnasium", "Lincoln High — auxiliary gym" and a typo all
  fail to match `lincoln high school`, and every one of them is a home game. Marking them away
  would silently remove them from the coverage model — an away event carries no coverage
  expectation by design — so nobody is asked, nobody notices, and no badge says so. The cost of
  reversing this rule is a game nobody attends. `lib/youth/classifyLocation.ts` argues it at
  length; `tests/lib/homeAwayClassification.test.ts` asserts the negative over every input.
- **Changing the venue list does not reclassify existing events.** Bulk reclassification is a real
  feature with its own confirm and it is not this slice. The panel says so out loud, because a
  leader who adds their school and sees nothing change will otherwise assume it is broken.
- The file is scenario 051's, unchanged. If it is ever edited, both scenarios move together.
