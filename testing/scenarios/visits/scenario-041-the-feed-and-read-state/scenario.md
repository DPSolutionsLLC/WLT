---
name: The feed, read state, and Next Unread
scope: visits
part: 1
tags: [visits, smoke, feed]
prerequisites: none
---

## Purpose

**Per-user read state is invisible until two people have looked at the same feed.** Everything this
feature promises — that one leader reading a report leaves it unread for everybody else — is a
statement about two accounts, and it cannot be seen from one. `tests/rls/report-read-status.test.ts`
proves the policy holds at the table; what it cannot show is a leader marking a whole feed read and
a second leader opening the same page to find nothing has changed for them.

**Next Unread needs a queue with gaps in it.** The counselor arrives having read reports 2, 5 and 7
of eight, scattered on purpose: a broken implementation that restarts from the top of the list
every time passes on a contiguous block and fails here.

And the privacy line. Two private notes are seeded, both authored by the **EQ president**, on
visits in their own organization — the person a leak would reach first. "Not even your own private
note appears in the feed" is the assertion, and it is a screen question, not a table one.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, **cross-org visibility OFF** |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), EQ counselor (Daniel Whitfield), RS president (Ruth Delacroix) |
| Households | 12, one per report, one active member each |
| Visit logs | **12** — 8 Elders Quorum, 4 Relief Society, dated 28 Jun – 16 Aug 2026 |
| — of the 8 EQ | 2 have **no shared note**; 1 has a note far past the 120-character preview limit; 1 has a **multi-line** note; 1 is an **attempt** rather than a completed visit; 1 has **no participants** |
| Private notes | 2, both authored by the **EQ president**, text beginning `PRIVATE-ALPHA` / `PRIVATE-BRAVO` |
| Read status | 3 rows — the **EQ counselor** has read EQ reports at positions 2, 5 and 7 in feed order. The EQ president has none. |

**Sign in with:** `eq-president@harness.wardleadershiptools.test`, then
`eq-counselor@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-041-the-feed-and-read-state`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **EQ president**.
4. Open `/visits` and follow the **Return and report** link at the top.
5. Read the unread count. Press **Next unread** several times, watching where the page scrolls to.
6. Bookmark one report with the star control.
7. Press **Mark all as read** and read the confirmation before accepting it.
8. Reload the page.
9. Sign out, sign in as the **EQ counselor**, and open `/visits/feed`.

## Verification Checklist

### Machine-checkable

- [ ] The EQ president's feed opens reading **8 unread reports** — not 12, and not 0
- [ ] The EQ counselor's feed opens reading **5 unread reports**
- [ ] Twelve tiles are **not** shown to either of them: the four Relief Society reports are absent
      (cross-org visibility is off)
- [ ] Unread tiles are distinguishable **without colour** — there is a bullet mark and a heavier
      weight, not only a tint
- [ ] Tapping a tile marks it read and the unread count above decrements **immediately**, before
      any reload
- [ ] **Next unread** moves to the next *unread* tile in feed order and skips ones already read
- [ ] Pressing **Next unread** repeatedly walks all the way down and then wraps to the top rather
      than stopping
- [ ] **Mark all as read** asks for confirmation, and the confirmation names the number
- [ ] After the president marks everything read, the count reads **Nothing unread**
- [ ] **After the president has marked all read, the EQ counselor still opens on 5 unread** — this
      is the assertion the whole feature turns on
- [ ] The bookmark survives the reload in step 8
- [ ] The bookmark does **not** appear on the counselor's copy of the same tile
- [ ] Neither `PRIVATE-ALPHA` nor `PRIVATE-BRAVO` appears anywhere on the page — check with the
      browser's find, at 375 px and at desktop width
- [ ] The two reports with no shared note read **No shared note** rather than showing a blank gap
- [ ] The long note is cut with an ellipsis at a **word boundary**, and the tile is not taller
      than its neighbours
- [ ] The multi-line note previews its **first line only**
- [ ] The attempted visit is labelled **Attempted**; the seven completed ones carry no outcome
      label at all
- [ ] The report with no participants reads **Nobody recorded as taking part**, not the recorder's
      name
- [ ] Every tile names both who took part and, quieter, who recorded it
- [ ] No horizontal scrolling at 375 px on any tile
- [ ] The star control and the tile body are both at least 44 × 44

### Needs a human eye

- [ ] Read the unread marker cold: is it obvious at a glance which tiles you have not seen, in
      **greyscale**?
- [ ] Does **Mark all as read**'s confirmation make you comfortable pressing it — does it say
      clearly that this only changes what *you* see?
- [ ] After **Next unread** scrolls, is it obvious **which** tile you landed on, or do you have to
      hunt for it?
- [ ] Does a tile reading "No shared note" read as a deliberate fact about the visit, or as
      something that failed to load?
- [ ] Does the truncated long note read as a **summary**, or as a sentence that got cut off? The
      page says notes are shortened here — does that line land where you would look for it?
- [ ] Is the star obviously a *private bookmark* rather than the ward-council flag on the visit
      tracker? Two different things share the word "flag" in the database and must not share it
      on screen.
- [ ] Dark mode: is the unread tile's left edge and raised surface still legible against the read
      ones?
- [ ] One-handed at 375 px: can you get through eight reports with a thumb?

## Failure Behavior

- [ ] With the dev server stopped mid-session, tapping a tile shows a **visible** error message
      and the tile returns to unread — it does not silently stay marked read
- [ ] The same failure on **Mark all as read** restores every tile to its previous state and says
      why
- [ ] Signed in as `rs-president`, the feed shows the **four Relief Society reports only**
- [ ] The "Not permitted" path is **not walkable from this seed** — every account it creates holds
      `visits.view`, and no role in `lib/auth/permissions.ts` reaches `/visits/feed` without it.
      The refusal is covered by `tests/routes/reportReadStatus.test.ts` (403 for a caller holding
      only the youth permission) and by the page's own `can()` guard. Corrected during the
      2026-08-26 walk; the line previously said "sign in as the music coordinator if one is
      seeded", and none is.
- [ ] Marking a report read that the caller cannot see is refused with an answer that does not
      distinguish "not found" from "not yours" — asserted in
      `tests/routes/reportReadStatus.test.ts`, not by hand

## Walkthrough record

**2026-08-26 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every machine-checkable item was performed in the running app and verified by re-reading the
`report_read_status` table with the service-role client. Nothing below was confirmed from the
screen alone. The judgement items were left for a person; screenshots in `walk-visits-c/`.

**Observed values**

- EQ president opened on **8 unread**; EQ counselor on **5 unread**. Twelve visits are seeded;
  the four Relief Society ones were absent from both (visibility off).
- Tapping the Calderon tile: count went **8 → 7 immediately**, and the row appeared in the table
  as `read_at=2026-08-26T16:37:20.116Z`.
- **Next unread** walked Calderon → Doyle → Ellsworth → Fairbanks → Grant → Halvorsen → **wrapped
  to Andersen** → Brooks. It resumed after the focused tile rather than restarting at the top,
  and skipped every read tile. It disables itself while a save is in flight, so a fast repeated
  press is a no-op rather than a double advance.
- Bookmarking Doyle wrote `read_at=null, flagged=true` — bookmarked **without** being marked read,
  and the unread count stayed at 8.
- **Mark all as read** confirmed first, verbatim: *"Mark all 8 unread reports as read? This only
  changes what YOU see, and it cannot be undone one by one."* Declining wrote **zero** rows.
  Accepting wrote **8** rows sharing **one** `read_at` timestamp, and Doyle **kept**
  `flagged=true` — the mark-all upsert did not clobber the bookmark.
- After a full reload the feed rendered **"Nothing unread"** server-side, and Doyle's bookmark
  survived.
- **The assertion the feature turns on:** with the president's 8 rows written, the EQ counselor
  opened on **5 unread** (Brooks, Ellsworth and Grant read; the other five not), and Doyle showed
  **no bookmark** for them.
- RS president saw exactly her **4** Relief Society reports, no Elders Quorum, no private notes.
- Privacy: `PRIVATE-ALPHA`, `PRIVATE-BRAVO`, the multi-line note's second line ("porch light"),
  and even the word "private" were **absent from the page text** in every account tested.
- Preview truncation: the long note rendered at **118 characters** ending `…with her sister…`,
  cut at a word boundary. The multi-line note previewed its first line only. Two notes rendered
  **"No shared note"**.
- Ellsworth carried **"Attempted"**; the other seven carried no outcome label.
- Halvorsen read **"Nobody recorded as taking part"** rather than the recorder's name.
- 375 px: `scrollWidth === clientWidth`, no horizontal overflow. Next unread 114×44, Mark all as
  read 138×44, the tile bodies 214×172, the stars 44×44.
- **Failure path** (fetch to `/api/reports/read-status` forced to 500): the optimistic update
  **rolled back**, the count returned to its previous value, the server's message appeared in a
  `role="alert"`, and **no row was written**. Not a silent revert.

**Checklist corrections made during the walk**

- The "user with no `visits.view`" line asked the tester to sign in as a music coordinator. This
  seed creates no such account, and no role in the matrix reaches `/visits/feed` without
  `visits.view`, so the check was unreachable as written. Rewritten to name the automated test
  that covers the refusal.

**Left unwalked**

- Dark-mode and greyscale legibility, and every wording judgement, were deliberately left for a
  person — screenshots supplied.
- The app shell's floating ☰ navigation button overlaps a tile at 375 px. Confirmed **pre-existing**
  (it does the same on `/visits`) and out of scope for this slice; noted, not filed.

## Notes

- The Relief Society reports are seeded but invisible here on purpose. Scenario 042 turns
  cross-org visibility on and they appear; this scenario is the "off" half of that pair.
- Read state is **not** shared with the visit tracker at `/visits`. The Recent visits panel there
  shows every visit with its full shared note and no read state at all — that is the full-report
  view the feed's one-line preview points at.
