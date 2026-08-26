---
name: The shared and private note split
scope: visits-a-goals-logs-and-notes
part: 1
tags: [visits, smoke, privacy]
prerequisites: none
---

## Purpose

CLAUDE.md rule 5 says a private note is readable by its author and by nobody else — not the
bishop, not an admin, not a support query. That rule is already enforced four ways in code, and
three of the four are already tested: the policy by `tests/rls/private-notes.test.ts`, the module
boundary by an import list, the route responses by `tests/routes/visits.test.ts`.

**The fourth mechanism is a UI promise, and it is the only one a test cannot check.** A leader
writing a pastoral observation has to know, at the moment of typing, which box the bishop will
read. Two textareas stacked one above the other with correct labels can still be indistinguishable
at arm's length on a phone in a car park, which is where visits actually get logged.

So what a person is here to judge is: **can you tell the two boxes apart without reading them,
and does the one that needs caution get it?**

The emphasis sits on the SHARED field, not the private one — its label, its helper text and the
text being typed into it are all in the attention colour. That reverses the first build, after the
2026-08-25 walk: highlighting the private box said "be careful" about the only field that is
already safe, and a tinted panel with a heavy border read as a validation error. The field that
earns a person's caution is the one other leaders will read.

Everything else on this page — the counts, the permissions, the absence of the note from the
bishop's screen — is machine-checkable and `/walk` will do it.

Being two people at once is the other thing a tester cannot do alone. The seed writes a private
note authored by the EQ president so that "the bishop sees no trace of it" is a real check rather
than the tester failing to find their own note.

## Seed Data

What `seed.ts` creates. Keep this in step with the script — it is what the tester reads to know
whether the screen is showing the right thing.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility` **off** |
| Users | `bishop@` (bishop), `eq-president@` (org_president, Elders Quorum), `eq-secretary@` (org_secretary, Elders Quorum), `rs-president@` (org_president, Relief Society) |
| Households | 6 — five with active members, **Ferreira with one moved-out member and nobody else** |
| Visit goals | 2 — Elders Quorum annual, Relief Society biannual, both for 2026 |
| Visit logs | 4 — three Elders Quorum (Brooks 2026-02-08, Whitfield 2026-02-15, Okonkwo 2026-03-01 with **no shared notes**), one Relief Society (Halvorsen 2026-03-08) |
| Private notes | 1 — on the **Brooks** visit, authored by the EQ president, containing the string `PRIVATE-NOTE-CANARY-038` |

The Ferreira household is the one that must NOT appear in the household picker:
`DEFAULT_MEMBER_STATUSES` is `["active"]` and a moved-out household is not somewhere to visit.

The Okonkwo visit carries no shared notes on purpose — the empty state has to be on screen beside
the filled ones.

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-038-the-shared-and-private-note-split`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **EQ president**.
4. Open **Visits** from the sidebar.
5. Read the **Notes** section without touching it. Look at the Shared and Private fields.
6. Start typing in each note field. Watch the helper text, and watch the colour of your own
   words in the Shared box.
7. Log a visit to the **Whitfield** household, dated today, filling **both** note fields. Put a
   distinctive phrase in the private one.
8. Try to pick **Ferreira** in the household list.
9. Try to set the visit date to tomorrow.
10. Sign out. Sign in as the **EQ secretary** and open **Visits**.
11. Sign out. Sign in as the **bishop** and open **Visits**.
12. Press Ctrl+F (⌘F) on the bishop's page and search for `PRIVATE-NOTE-CANARY-038`, then for the
    phrase you typed at step 7.
13. Switch the theme to dark and look at the form again as the EQ president.

## Verification Checklist

### Machine-checkable

- [ ] The **Visits** link appears in the sidebar for all three accounts
- [ ] As the EQ president, **three** visits are listed, not four — the Relief Society visit is absent
- [ ] The Okonkwo visit renders as an ordinary row with no shared notes, not as a broken one
- [ ] **Ferreira does not appear in the household picker**; the other five households do. (This FAILED on the 2026-08-25 walk and was fixed — see the record.)
- [ ] The visit date field will not accept tomorrow's date, and the server refuses one too
- [ ] After step 7, `select count(*) from visit_logs where household_id = <Whitfield>` is 1
- [ ] After step 7, exactly one row exists in `visit_private_notes` for that visit, `user_id` = the EQ president
- [ ] The private note was sent in its OWN request to `/api/visits/<id>/private-note`, not as a field on `POST /api/visits` (check the network tab)
- [ ] As the bishop, **four** visits are listed — the bishopric reads every organization
- [ ] **Ctrl+F for `PRIVATE-NOTE-CANARY-038` on the bishop's page finds nothing**
- [ ] Ctrl+F for the step-7 private phrase on the bishop's page finds nothing
- [ ] The bishop DOES see the Brooks shared note ("brought a meal round after the surgery")
- [ ] `curl`ing `/api/visits` as the bishop returns a body containing no `private` key anywhere
- [ ] The EQ secretary sees the goal panel with **no Save control and no "Set a goal" button**, and the sentence "View only — your role does not set goals."
- [ ] The EQ secretary CAN log a visit — they hold `visits.create`
- [ ] An audit row exists with action `visit_logged` and module `visits`
- [ ] An audit row exists with action `visit_private_note_saved` whose detail names the visit id and **contains no note text**
- [ ] No raw uuid appears anywhere on the Visits page
- [ ] No horizontal overflow at 375px
- [ ] Every button and both textareas are at least 44px tall

### Needs a human eye

- [ ] **The two note fields are visually distinct without reading the labels.** Glance at the form
      from a foot away — the shared field is plainly the marked-out one. This is the check the
      scenario exists for; if you have to read to tell them apart, it has failed
- [ ] **Typing into the shared field, your own words come out in the attention colour.** That is
      the mechanism — the reminder is the content itself, not a panel drawn around the box
- [ ] The helper text on both fields is visible BEFORE typing and STAYS visible while typing —
      never a placeholder that vanishes at the first keystroke
- [ ] "Only you will ever see these — for your own recollection later" reads as a promise being
      kept, not as a warning about something going wrong
- [ ] Neither field reads as an ERROR state. The attention colour must say "others read this",
      not "you have made a mistake"
- [ ] "Notes" with "Shared" and "Private" beneath it reads as two kinds of one thing, rather than
      as two unrelated boxes that happen to sit together
- [ ] **Dark mode: the shared field is still the marked-out one and both remain legible**
- [ ] The EQ secretary's read-only goal panel reads as a role boundary, not as a page that failed
      to load
- [ ] At 375px, one-handed, the shared field is still obviously the shared one

## Failure Behavior

- [ ] Logging a visit with the shared notes filled and the private note failing to save reports
      the private-note failure as its own sentence and says the visit itself WAS saved. Telling
      somebody their note is stored when it is not is the one failure this feature cannot afford
- [ ] A private note that is only whitespace is refused with a sentence, not saved as blank
- [ ] Opening `/api/visits/<some other org's visit id>/private-note` returns **404, not 403** —
      the endpoint must not confirm that another organization's visit exists

## Walkthrough record

**Walked 2026-08-25 by Claude**, driven through a real browser (Playwright MCP) against the hosted
project on `localhost:3000`, with every write read back through the service-role client. The
judgement items were NOT walked by a person — they were captured as screenshots and are pending
the user's review.

**ONE DEFECT FOUND. See "Ferreira" below — the check failed, and the check is right.**

**Observed:**

- Seeded users read back from `users`: bishop (Mark Andersen), eq-president (Miguel Cortez,
  org `…a2`), eq-secretary (Peter Nakamura, org `…a2`), rs-president (Ana Delgado, org `…a3`).
- As the EQ president the list showed **three** visits — Okonkwo, Whitfield, Brooks. The Relief
  Society's Halvorsen visit was absent. The goal panel showed one goal, the EQ one.
- The Okonkwo visit, seeded with no shared notes, rendered as an ordinary row.
- **DEFECT — the household picker offered all six households including Ferreira**, whose only
  member is `moved_out`. Confirmed in the database: `members` holds one Ferreira row, status
  `moved_out`. `lib/roster/queries.ts:listHouseholds` filters the members it ATTACHES, not the
  households it RETURNS, so a household with nobody active comes back with `members: []`;
  `app/(app)/visits/page.tsx` mapped straight to options without checking. The check is correct
  and the app is wrong — `DEFAULT_MEMBER_STATUSES`'s own header names a visit-goal denominator as
  its reason for existing, and `visits-b` will compute that denominator over this list.
- Logging a Whitfield visit with both fields filled produced **two separate requests**:
  `POST /api/visits` → 201, then `POST /api/visits/f3ca4e13…/private-note` → 200. The private note
  was never a field on the log payload.
- Read back: one `visit_logs` row (`visit_date 2026-08-26`, `visit_type in_home`, shared notes
  present) and one `visit_private_notes` row with `user_id` = the EQ president, `created_at`
  01:50:40.424Z, `updated_at` 01:50:41.272Z.
- The visit-date field carried `max="2026-08-26"`. A direct `POST` with `2027-01-01` returned
  **400 — "A visit cannot be logged for a date in the future."**
- `GET /api/visits?orgId=<Relief Society>` as the EQ president returned **0 visits**.
- `GET /api/visits/<an RS visit>/private-note` as the EQ president returned **404**, not 403 —
  the endpoint does not confirm another organization's visit exists.
- As the EQ **secretary**: no "Set a goal" button, no "Save goal" button, the sentence
  "View only — your role does not set goals." present, and the "Log a visit" form fully available.
  They saw 1 goal and 4 visits.
- **As the bishop, the boundary held completely.** Four canary strings
  (`PRIVATE-NOTE-CANARY-038`, `WALK-PRIVATE-038`, and two phrase fragments) were searched for in
  the visible text, in the FULL page HTML, and in the `GET /api/visits` response body. **Zero hits
  in all three.** No key matching `/private/i` appeared anywhere in the payload. The 12 keys
  returned were exactly `id, orgId, householdId, visitedBy, visitDate, visitType, sharedNotes,
  flaggedForWardCouncil, flagSentAt, createdAt, householdName, visitedByName`.
- The bishop DID see the Brooks shared note, and saw 5 visits (the whole ward).
- `GET /api/visits/<Brooks>/private-note` as the bishop returned `{ "note": null }` — the EQ
  president's note, invisible.
- **An attempt to write another author's note was ignored rather than refused.** `POST` of
  `{notes, userId: <EQ president's id>}` as the bishop returned 200 and wrote the note under the
  BISHOP's id (`f495e8cc…`). The EQ president's row was untouched. Two notes now coexist on the
  one visit, one per author, which is what the unique `(visit_log_id, user_id)` constraint allows.
- A whitespace-only note returned **400 — "Write something, or delete the note instead."**
- Audit rows: `visit_logged` (module `visits`, detail naming orgId/visitDate/visitType/
  visitLogId/householdId) and `visit_private_note_saved` whose detail was **`{visitLogId}` and
  nothing else**. No note text in either.
- 375px: `scrollWidth 360 = clientWidth 360`, no overflow. **Zero** controls under 44px tall.
  No raw uuid in the rendered text.
- Helper text on both note fields stayed visible while typing, confirmed by screenshot at 375px.
- Light and dark both rendered; the private block is an amber-bordered tinted box in both.
- **No spontaneous console errors.** The four errors logged were all deliberate probe requests
  (400, 404, 400, 403).

**Not walked:** the failure-behaviour item where the visit saves but the private note fails —
inducing it needs the note endpoint to fail on demand, which was not arranged. The code path is
covered by reading `VisitLogForm.tsx`, not by a test.

**Reviewed by the user 2026-08-25, from screenshots.** Six of seven judgements passed. The
seventh — "does the private block read as an error state?" — was the one this walk was worried
about, and the answer reshaped the design.

**WHAT THE USER CHANGED, AND WHY IT IS THE RIGHT CALL:**

> "i don't think i like the way the private notes are flagged. i feel like if anything, the shared
> notes are the ones that should have attention brought to them."

Marking out the PRIVATE box said "be careful here" about the only field on the page that is
already safe — nobody but its author can ever read it. The field that earns a leader's caution is
the SHARED one, because that is the text other people will read. The emphasis was inverted:

1. Both fields now sit inside one **Notes** section, labelled **Shared** and **Private**, so the
   choice reads as two kinds of one thing rather than two unrelated boxes.
2. The tinted, heavy-bordered panel around the private field is **gone**. It is now an ordinary
   field, because writing privately is the ordinary case.
3. The shared field's label, helper text **and the text being typed into it** are in the attention
   colour (`text-warning`). Watching your own words come out in a different colour from everything
   else on the page is the reminder, and it cannot be missed the way a panel border can.
4. Copy rewritten: "Anyone who reviews this visit will read these." / "Only you will ever see
   these — for your own recollection later."

Verified after the change: shared ink `rgb(180, 83, 9)` in light and `rgb(251, 191, 36)` in dark,
private ink the ordinary foreground in both. The legend needed explicit spacing — a `legend` does
not participate in its fieldset's flex layout.

**THE FERREIRA DEFECT IS FIXED.** `app/(app)/visits/page.tsx` now filters the picker to households
with at least one active member. Re-verified in the browser: the picker offers **five** households
— Brooks, Halvorsen, Okonkwo, Tuiasosopo, Whitfield — and Ferreira is absent. **visits-b must
apply the same rule to its progress denominator.**

**The inaccurate comment is fixed.** `VisitLogForm.tsx` now names the `.dark` class on `<html>`,
which is what `app/globals.css` actually keys on.


## Notes

- The four mechanisms behind rule 5 are: a separate table, a separate module
  (`lib/visits/privateNotes.ts`), RLS with no bishopric branch, and a route test that asserts on
  serialized JSON. This scenario checks the fifth thing none of them can: whether a human can see
  the difference.
- `visits-b` replaces this page's body with the progress dashboard. The **form** is what this
  scenario is about, and it survives that change; the list layout does not, so do not write
  checks about the list's arrangement here.
