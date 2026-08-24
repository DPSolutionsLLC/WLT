---
name: Preview before you save
scope: ai-a-client-and-settings
part: 1
tags: [ai, full, settings]
prerequisites: none
---

## Purpose

The preview panel's entire value is that it runs against **unsaved** settings, and no automated
test can judge whether the tone the bishopric asked for is the tone that came back. A route test
can prove the draft settings reached `buildSystemPrompt` and that nothing was written to the
database — both are already asserted in `tests/routes/ai-settings.test.ts`. What it cannot prove
is that a person typing "warm and brief, never formal" *hears the difference* in what comes back.

Two saved versions are seeded, deliberately plain in tone, so "the draft changed when I changed
the tone" is a real comparison rather than a first impression.

It also carries the one thing about the versioning a bishopric will notice being wrong: that
restoring an older configuration **adds** a row rather than removing the ones after it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds `ai_settings.view` and `ai_settings.manage` |
| | `counselor1` (counselor, position 1, Peter Nakamura) — identical access; saved the older version |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds **no** `ai_settings` permission |
| AI settings | **2 versions**, append-only, on different dates by different people |
| | *Older* — saved by Peter Nakamura on **12 July 2026**. Tone: "Standard tone. Complete sentences." Conference recency: 10 years |
| | *Active* — saved by Mark Andersen on **12 August 2026**. Tone: "Standard tone. Write in full paragraphs and use formal address." Conference recency: **no limit** (blank) |
| Knowledge base | **Nothing.** A ward with zero documents gets layers 1 and 2 and no layer 3 — the state `ai-a` ships |

**Sign in with:** `bishop@`, `counselor1@`, `secretary@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

`ANTHROPIC_API_KEY` must be set to a working key in `.env.local`. Scenario 021 is the one that
breaks it on purpose.

## Steps

1. `npm run seed -- ai/scenario-020-preview-before-you-save`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open **AI Settings** from the sidebar and read every field before
   touching anything. **Note the Tone & Voice text and whether the conference-years box is blank.**
4. Scroll to **Version history** and read both rows.
5. Scroll back up. In the **Try these settings** box type:
   `Ask Sister Alvarez to speak on the fourth of October about enduring in faith.`
   Press **Preview** and read the output. Note whether it sounds formal.
6. **Without saving**, change Tone & Voice to `warm and brief, never formal` and press
   **Preview** again with the same prompt. Compare the two outputs.
7. Reload the page. Read Tone & Voice again.
8. In Scripture preferences, use the ↑ / ↓ buttons to reorder the canon priority, then **Remove**
   one book and **Add** a different one.
9. Press **Save as a new version**, then read the history again.
10. Press **Restore** on the *oldest* row, read the confirmation sentence, then confirm it.
11. Sign out and sign in as `secretary`. Try to reach `/ai-settings` directly.

## Verification Checklist

### Machine-checkable

- [ ] The form loads the **12 August** values, not the 12 July ones — Tone & Voice reads
      "Standard tone. Write in full paragraphs and use formal address."
- [ ] The "Only talks from the last … years" box is **blank**, not `0` — null means no limit
- [ ] The scripture priority list reads `1. Book of Mormon`, `2. New Testament`, in that order
- [ ] History lists both seeded versions **newest first**, with the correct names
      (Mark Andersen, then Peter Nakamura) and dates (12 August 2026, 12 July 2026)
- [ ] **Only** the newest row is badged `Active`, and that row has no Restore button
- [ ] Preview returns real text and the token line under it shows a **non-zero** written-token
      count
- [ ] After the reload in step 7, Tone & Voice shows the **seeded** August value again — the
      preview saved nothing
- [ ] Saving in step 9 adds a **third** row to the history; the two seeded rows are both still
      listed
- [ ] Restoring the oldest row in step 10 adds a **fourth** row rather than removing any —
      the count goes up, never down
- [ ] After the restore, the newest row is badged Active and is attributed to whoever pressed it
- [ ] **After the restore, the form above visibly changes to the restored version's values** —
      Tone & Voice, the canon priority order and the conference-years box all follow it, with no
      page reload. *(This regressed once: `router.refresh()` preserves client state, so the form
      kept the values it mounted with and the restore looked like it had done nothing. Covered now
      by `tests/components/ai-settings/AiSettingsForm.test.tsx`.)*
- [ ] The restore prints a confirmation naming both halves — that the settings above now show
      this version, and that it was added to the top of the history
- [ ] Signed in as `secretary`, `/ai-settings` shows "Not permitted" — **not** an empty form
- [ ] No horizontal scrolling at 375px on any of the seven sections
- [ ] The ↑ / ↓ / Remove buttons are at least 44×44

### Needs a human eye

- [ ] Does the step-6 output actually sound different from the step-5 output? If the two read the
      same, the draft settings are not reaching the model.
- [ ] Does the preview output read as a **sample** rather than as a message that has been sent?
      "Sample output — not sent to anyone" plus the dashed border should make that unmistakable
      at a glance.
- [ ] Does the note "This runs against what is on screen, including changes you have not saved"
      land before you press the button, or does it read as an afterthought below it?
- [ ] Does the restore confirmation sentence remove the fear? Read it cold: does
      "Your current settings stay in the history — nothing is deleted" answer the question you
      actually had?
- [ ] Is the canon-priority reorder control obvious, or did you have to work out what ↑ does?
- [ ] After a restore, is it obvious **which** version is now active without counting rows?
- [ ] Seven cards on one page at 375px — does it read as a settings screen you could work through
      one-handed, or as a wall?
- [ ] Both themes: is the dashed sample block distinguishable from the cards around it in dark
      mode as well as light?

## Failure Behavior

- [ ] Pressing **Preview** with an empty prompt refuses with
      "Type something for the preview to respond to." and does not spend a call.
      *(Also covered by `tests/routes/ai-settings.test.ts`.)*
- [ ] Typing `11` into "Most scriptures to suggest" and saving refuses with a sentence naming the
      ceiling, and **no** new version appears in the history
- [ ] Adding the same book of scripture twice is impossible through the controls — a book already
      in the priority list has no Add button
- [ ] A preview that fails leaves the output area **empty** rather than showing the previous draft
- [ ] What happens when the AI itself is unreachable is scenario 021, not this one

## Walkthrough record

**Walked 2026-08-23 by the user, by hand in a browser.** Everything passed except the restore.

**Defect found — the form did not follow a restore.** Restoring a version added the row and badged
it Active, but the seven settings fields above kept the values they had been mounted with, so the
restore read as having done nothing. Cause: `router.refresh()` re-runs the Server Component and
hands down fresh props but deliberately **preserves client state**, so `AiSettingsForm`'s
`useState` initialiser never ran again. The form was the only visible evidence a restore had
happened and it was the one thing that did not move.

Every server-side test passed throughout, and was right to: the row was appended with the correct
content and saver, and RLS allowed it. The defect lived entirely between a correct server and a
component that never re-read it.

Fixed by resetting the draft during render when the active version id changes, and a
`role="status"` line now names both halves of what a restore did. Covered by
`tests/components/ai-settings/AiSettingsForm.test.tsx`, confirmed to fail without the fix before
being kept. Two checklist items were added above for it.

**Two feature requests raised during the walk**, both backlogged rather than built:
- **ITER-009** — name a settings version, with a default title and a custom override, so the
  history is readable by circumstance rather than by date.
- **ITER-010** — per-leader settings applied automatically when it is that leader's turn to
  conduct and plan, with nothing to remember.

**Not re-walked after the fix.** The restore path and the two new checklist items are the items to
confirm on the next pass.

## Notes

- Every preview is a real, billed Claude call. Six or seven presses is the whole scenario; there
  is no need to hammer it.
- The token line will very often show **0 read from cache**. That is not a bug: the minimum
  cacheable prefix is about 1024 tokens and this ward's settings are shorter than that. The line
  is there so `ai-b` and `ai-c` — which add a much longer prefix — have somewhere to watch it
  start working.
- The seeded dates are fixed, so the history's "12 July 2026 / 12 August 2026" does not drift as
  the calendar moves.
