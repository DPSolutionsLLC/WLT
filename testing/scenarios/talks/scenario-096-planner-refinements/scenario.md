---
name: Sacrament Planner refinements
scope: ITER-057
part: 1
tags: [full, sacrament, planner, phone]
prerequisites: migration 093 applied
---

## Purpose

Proves the five changes the bishopric asked for in the Sacrament Planner (GROUP-04: ITER-057,
ITER-056, ITER-048, ITER-049, ITER-050, plan `plans/sacrament-planner-refinements.md`). Who's Next's
selection panel no longer hides the last rows on a phone, folds to one line and can place every
ticked person on a Sunday at once. Fast & Testimony Sundays start with no speaker slots. Pray About
cards show how full a Sunday is and warn instead of quietly adding a slot. Calls can look back over
past Sundays. The slot rules are unit-tested (`tests/lib/sacramentPlanner/slotRules.test.ts`); the
wiring is not, because the Planner is one HTML document in an iframe that no component test renders.
Every state here takes many clicks to reach by hand, so the seed makes each one a page load.

## Seed Data

Dates are computed from the day you seed. The seed prints them.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, every module released |
| Users | `bishop` (Mark Andersen, bishop), `counselor` (Dana Whitmore, 1st counselor) |
| Members | Grace, Samuel and Ruth Okafor; Laura and Ethan Brooks; Nora Lindqvist; Ken Tanaka; Elise Moreau; Omar Haddad; June Price; Lena Varga |
| Planner settings | `bishopric` lists Mark Andersen, Dana Whitmore, Paul Hendry; the rotation has Mark alone, so every Sunday is his month |
| Do Not Ask | Ruth Okafor, for 120 days |
| **S1** | The next Sunday that is not a first Sunday. Regular; Ken Tanaka, Elise Moreau and Omar Haddad penciled in to speak; both prayers open |
| **S2** | The Sunday after S1. Regular; two open speaking slots; June Price and Lena Varga penciled in to pray |
| First Sunday of the month after S2 | No document: it renders from the blank layout |
| **P1** | The most recent Sunday before today (1–7 days ago, so still editable): Grace Okafor accepted, Ken Tanaka "calling" with a message left, an emptied slot that Nora Lindqvist declined, both prayers accepted |
| **P2** | Two weeks before P1 (more than 9 days ago, so read only), same shape, declined by Omar Haddad |
| **P3** | Four weeks before P1, same shape, declined by Lena Varga, and also in the agenda history |
| Pray About (Mark's) | Laura Brooks for a talk on S1 (full); Nora Lindqvist for a talk, any Sunday in S2's month; Ethan Brooks for a prayer on S2 (both prayers filled) |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-096-planner-refinements` and note the dates it prints.
2. `npm run dev`, then open http://localhost:3000 and sign in as the bishop in a 375px-wide window.
   Open the **Sacrament** tile.
3. **Who's Next:** search "Okafor", tick one result, scroll to the bottom. Fold the panel, scroll
   again, reload.
4. Open the panel, tick all three Okafors, choose **A talk**, When = S2, press **Place on Sunday**.
   Then press Undo once.
5. **Sundays:** open the first Sunday of next month. Switch its type to Regular, type a topic in
   one new speaker slot, switch back to Fast & Testimony. Do not save.
6. **Pray About:** read each card's fill line. On Laura's card press Place, then See who's
   speaking, then Add a speaker anyway. Use + / − on Nora's month card's See the month, and on a
   talk card for S1 and S2. Press Place on Ethan's prayer card.
7. **Calls:** set View to Past Sundays. Open **Filters** (on a phone, Sort, From and To sit
   behind it; View and Find stay out), change Sort, set a window that leaves out P2, search
   "Lindqvist". Open P1 and P2.
8. Repeat the Pray About and Calls checks at desktop width, in both themes.

## Verification Checklist

### Machine-checkable

- [x] With one Okafor ticked, the last search result scrolls fully above the panel, open and folded
- [x] The folded panel is one line with the count, Place, Pray About and ▸; it is still folded after a reload; desktop shows no fold button
- [x] Place on Sunday is disabled while When is "Any Sunday in …"
- [x] Ticking the do-not-ask member plus two others, Talk, S2, Place on Sunday: two are penciled in on S2, the toast names Ruth Okafor as skipped "on the do-not-ask list", no Pray About card was created, and one Undo removes both
- [x] The first Sunday of next month shows hymns and prayers only; switching to Regular adds two empty speakers and a rest hymn; typing a topic in one, switching back to Fast removes only the other
- [x] The S1 talk card reads "3 of 3 speaking slots filled"; Place shows the warning; See who's speaking lists three names and opens S1; Add a speaker anyway places Laura in a fourth slot
- [x] + / − on S2 change the slot count by one; − on S1 (all named) says every slot has someone and writes nothing
- [x] The prayer card for S2 reads "2 of 2 prayers filled" and Place shows "Both prayers … are filled"
- [x] See the month lists each remaining Sunday of that month; Place here puts Nora on the chosen one and removes the card
- [x] Calls opens on upcoming, unchanged; Past Sundays shows P1, P2 and P3 newest first; Oldest first reverses them; a window excluding P2 hides it; searching "Lindqvist" finds P1
- [x] P1 has the usual controls; P2 and P3 have none and show outcomes, the decline line and a "Read only" chip
- [x] The past view's window and sort are still set after a reload; the search is not
- [x] Both themes; no horizontal scroll at 375px; every new button at least 44px tall on a phone

### Needs a human eye

- [ ] The folded panel's short labels ("Place", "Pray About") read clearly enough at 375px, where the full words do not fit on one line
- [ ] The full warning on a Pray About card reads as a choice to make, not as an error
- [ ] A read-only past Sunday reads as finished history rather than as something broken

## Failure Behavior

- [x] Place on Sunday aimed at a Sunday with unsaved edits on the Sundays tab refuses the whole batch and names the Sunday
- [x] A Calls screen left open across the day a Sunday locks refuses a button press with "This Sunday can no longer be changed here." (the 9-day rule itself is automated in `tests/lib/sacramentPlanner/slotRules.test.ts`)
- [ ] The slot rules are pinned to `body.html` by `tests/lib/sacramentPlanner/assetEdits.test.ts`, so a fresh copy of the Planner that drops one fails the suite

## Walkthrough record

**2026-10-30 — driven by Claude (Playwright, real app on localhost:3000, signed in as the bishop),
every write read back from `planner_documents` with the service-role client. Human-eye items are
waiting on the user's review of the screenshots in `testing/walk-screenshots/096/`.**

Seeded dates: S1 2026-11-08, S2 2026-11-15, first Sunday of next month 2026-12-06, P1 2026-10-25,
P2 2026-10-11, P3 2026-09-27.

- **Panel (375×780):** open, the list ends at y=253 and the panel starts at y=258 (`--bulkh` 404px);
  folded, the list ends at y=593 and the panel at y=597 (`--bulkh` 64px), height 56px, everything on
  one row: "1 selected · Place · Pray About · ▸". `planner:bulkFold` = "folded" and still folded after
  a reload. Desktop: fold button `display:none`, full labels, `--bulkh` 8px unused.
- **Place on Sunday:** disabled on "m:2026-11" with the title "Pick a Sunday under When…"; enabled on
  d:2026-11-15. Grace + Ruth + Samuel, Talk, Nov 15 → toast "2 penciled in on Nov 15 · Skipped: Ruth
  Okafor (on the do-not-ask list)"; DB: Speaker Okafor, Grace/tentative, Speaker Okafor,
  Samuel/tentative; **one** `planner.document_saved` audit row; considers still 3; Ruth still ticked.
  One Undo → DB back to the seeded document exactly.
- **Unsaved refusal:** with Dec 6 dirty, Place on Sunday → "Dec 6, 2026 has unsaved edits on the
  Sundays tab. Save or discard them there first, then place them."; no Dec 6 document written.
- **Fast & Testimony:** Dec 6 renders Opening Hymn, Opening Prayer, Ward Business, Sacrament Hymn,
  Sacrament, Closing Hymn, Closing Prayer. → Regular adds Speaker, Rest Hymn, Speaker (card dirty). A
  topic "Fasting with purpose" in the first; → Fast keeps that speaker (and the rest hymn beside it)
  and removes only the other.
- **Pray About:** fill lines "3 of 3 speaking slots filled" (Laura, Nov 8), "2 of 2 prayers filled"
  (Ethan, Nov 15), "See the month" (Nora). On Laura's card at Nov 15: "0 of 2" → + → toast "Nov 15: 3
  speaking slots", DB 3 speakers → − → DB back to 2. − on Nov 8 → "Every speaking slot has someone.
  Open the Sunday to change it."; DB unchanged and Undo title unchanged. Place on Nov 8 → `role=alert`
  "Nov 8 has no open speaking slot." + Add a speaker anyway / See who's speaking / Cancel; popup "Nov 8
  · Speakers" lists Ken Tanaka, Elise Moreau, Omar Haddad (Tentative), Close focused; Open this Sunday
  closes it and opens Sundays at Nov 8. Add a speaker anyway → DB: Brooks, Laura/tentative in a 4th
  speaker slot before Closing Hymn; consider deleted. Ethan: Place → "Both prayers on Nov 15 are
  filled." with no add-anyway; Cancel restores the row.
- **See the month:** "Any Sunday in November 2026 · Talk for Nora Lindqvist", Nov 1 (Fast, no
  slots), Nov 8 (4 of 4), Nov 15, 22, 29 (0 of 2); Place here on Nov 22 → DB Speaker Lindqvist,
  Nora/tentative, popup closed, card gone.
- **Calls:** upcoming unchanged (banner "3 upcoming Sundays have tentative names…", no cards, past
  fields hidden). Past: 2026-10-25, 2026-10-11, 2026-09-27; Oldest first reverses; From 2026-10-15 →
  only 10-25; "Lindqvist" → 10-25 with only the declined slot; "zzz" → "No past calls match these
  filters."; badge empty and no banner in the past view. 10-25 has its usual buttons + Message;
  10-11 "Read only (More than 9 days ago)" and 09-27 "Read only (In the agenda history)", zero
  buttons, rows "Accepted · Mark", "Left message Oct 6 Never marked accepted", "Omar Haddad declined
  Oct 5 · Out of town or unavailable that date". A stale Accepted button injected into 10-11 → toast
  "This Sunday can no longer be changed here.", DB unchanged. After reload: view past, From
  2026-10-01, Oldest first kept; Find cleared; `planner:callsPast` = {on, from, to, sort} only.
- **Layout:** zero horizontal overflow on Who's Next, Pray About, Sundays and Calls at 375px (frame
  and outer page). New buttons 44px tall at 375px (fold 44×44, Place 139×44, Pray About 150×44,
  + / − slot 44). Dark theme set through the app's theme control; the Planner followed (bg
  rgb(10, 14, 19)).

**Checklist corrections:** step 7 now says Sort, From and To sit behind **Filters** on a phone (the
step read as if they were on screen). The first failure-behaviour line was walked on Dec 6 (any
Sunday with unsaved edits), so it no longer names S2.

**Defects found (cosmetic, not fixed during the walk):**
1. In See the month and the See who's speaking popup, an empty slot reads "Open Open" (the
   placeholder word and the status chip).
2. In See the month, a Sunday with no speaking slots says it twice: "No speaking slots on Nov 1" in
   the heading line and "No speaking slots" in the list.
3. The fold button's ▾ / ▸ glyph renders very small inside its 44×44 box.

**Not walked:** a second real login watching the writes arrive live (covered by scenario 093);
a real phone.

## Notes

- The folded line shortens its two buttons to "Place" and "Pray About": the full labels do not fit
  beside the count and the fold button at 375px. Their accessible names stay in full.
- "Already-saved Fast & Testimony Sundays are left alone" (D2): only an unsaved first Sunday starts
  without speaker slots.
- The 9-day lock runs in the browser, like every other Planner rule (ITER-045 D1).
