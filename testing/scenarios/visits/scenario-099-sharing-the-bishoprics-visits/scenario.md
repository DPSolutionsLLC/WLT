---
name: Sharing the Bishopric's visits
scope: visits
part: 1
tags: [visits, full, rls, sharing, ITER-055]
prerequisites: Migration 099 applied; Visits released for the Harness Test Ward
---

## Purpose

ITER-055 slice **bv1**. Each organization's visits are now its own. The **bishopric decides**,
organization by organization, who else may see them. The old ward switch ("organizations can see
each other's visit reports") no longer reaches visits at all; it governs youth follow-ups only.

Three things are only real with seeded data and two sign-ins:

- **The switch is ON and it does nothing for visits.** The Elders Quorum president sees the Relief
  Society's visits because of a *sharing grant*, and does **not** see the Bishopric's, even
  though the switch is on.
- **The Bishopric's visits are stored with no organization**, as the app writes them, and a grant
  on the ward's Bishopric organization still reaches them.
- **A grant opens reading, never writing**, and never a private note.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, old switch **ON** (to prove it no longer matters) |
| Users | bishop (Mark Andersen), 1st counselor (Peter Nakamura), EQ president (Miguel Cortez), RS president (Ruth Delacroix) |
| Households | 6 — Ashby, Brennan, Castillo, Dawson, Ellery, Fontaine |
| Bishopric visits | Ashby, Brennan — stored with **no organization**, each with the bishop's private note |
| EQ visits | Castillo, Dawson — each with the EQ president's private note |
| RS visits | Ellery, Fontaine — each with the RS president's private note |
| Sharing | EQ → RS and RS → EQ (the day-one grants for a ward whose switch was on). **Bishopric shared with nobody.** |

## Steps

1. Sign in as the **EQ president** and open **Visits**.
2. Open **Return and report**.
3. Try `/visits/all-organizations` by typing it in the address bar.
4. Sign in as the **1st counselor**, open **Visits**, expand **Who can see each organization's
   visits**.
5. Under **Who can see the Bishopric's visits?**, turn on **Elders Quorum**, and press **Save
   sharing**.
6. Sign in as the **bishop** and open the notification bell.
7. Sign back in as the **EQ president** and open **Visits** and **Return and report** again.
8. Sign in as the **RS president** and open **Return and report**.
9. Sign in as the bishop, open **Admin**.

## Verification Checklist

- [ ] Step 1: the EQ president's **Recent visits** lists Castillo, Dawson, Ellery and Fontaine —
      and **not** Ashby or Brennan
- [ ] Step 1: the Organization selector offers Elders Quorum and Relief Society only
      _(Corrected 2026-10-31: this used to add "on Relief Society, no cadence control can be
      changed". The seed sets no visit goal, and the cadence control only appears once a goal
      exists, so no organization showed one and the check could not fail. Seed a goal for both
      organizations before reinstating it.)_
- [ ] Step 1: there is no **All organizations** link, and no **Who can see…** section
- [ ] Step 2: the feed's sentence names the Relief Society as shared with the Elders Quorum
- [ ] Step 2: no tile carries any text containing "PRIVATE"
- [ ] Step 3: the page refuses with a sentence pointing back to the Visits page, and links to both
      **Your Visits page** (`/visits`) and **Back to the dashboard**
- [ ] Step 4: the section lists one row per organization, the **Bishopric first**, and no row
      offers the Bishopric as a choice
- [ ] Step 4: Elders Quorum ⇄ Relief Society are already on; nothing is on in the Bishopric row
- [ ] Step 5: "Saved." appears
- [ ] Step 6: a **Visit sharing changed** notification row exists for the bishop naming Peter
      Nakamura, and none for the counselor (read back from `notifications`)
      _(Corrected 2026-10-31: this said "open the notification bell". The bell is a placeholder
      until P12 and opens nothing, so this step reads the row instead.)_
- [ ] Step 7: the EQ president now sees **Ashby and Brennan** too, with their shared reports and
      **no** private note; there is no Flag button on them
- [ ] Step 7: the selector still offers Elders Quorum and Relief Society only — **the Bishopric
      is never a selector choice**, for anybody, the bishop included _(added 2026-10-31: the walk
      found choosing it read "never visited" for every household, defect 099-D1, and the user
      chose to remove it rather than map it)_
- [ ] Step 7: the feed tiles for Ashby and Brennan are labelled **Bishopric**, and the feed's
      sentence names the Bishopric and the Relief Society
- [ ] Step 8: the RS president still does **not** see Ashby or Brennan
- [ ] Step 9: the admin toggle now reads **Cross-organization youth follow-ups** and says it no
      longer affects visits
- [ ] Every screen above works at 375px wide in light and dark

## Failure Behavior

- If Ashby or Brennan appear for the EQ president at step 1, the old switch is still reaching a
  visit policy — check migration 099 applied.
- If the Bishopric row is missing at step 4, the ward has no Bishopric organization.

## Walkthrough record

**2026-10-31 — driven by Claude (Playwright against `npm run dev` at 375px, every write read back
with the service role).** Not yet reviewed by the user. Screenshots in `.walk099/` (git-excluded).
Signed in through the browser's saved login with only the email changed, so the harness password
never entered the transcript.

Observed:

- Seed: 7 organizations including a Bishopric; grants EQ→RS and RS→EQ; `cross_org_visibility`
  true.
- Step 1: Recent visits "4 logged": Fontaine, Dawson, Ellery, Castillo. Selector: Elders Quorum,
  Relief Society. No `/visits/all-organizations` link, no "Who can see…" section. Flag on the two
  EQ visits only. No console warnings or errors.
- Step 2: "You see your own organization's visits, and the visits of the Relief Society, which the
  bishopric has shared with yours." 4 tiles; "PRIVATE" nowhere.
- Step 3: "Not permitted. Every organization at once is shown to the bishopric only.
  Organizations the bishopric has shared with yours are on the Visits page…". Its only link is
  Back to the dashboard.
- Step 4: 7 rows, Bishopric first, the Bishopric never offered as a viewer; EQ⇄RS pressed; the
  Bishopric row all off; every chip 44px tall; horizontal overflow none.
- Step 5: "Saved." Read back: grant Bishopric→EQ with `created_by` set; audit
  `visit_sharing_updated {added: [Bishopric→EQ], removed: [], grantCount: 3}`; after a fresh
  load as the bishop the section reads "3 shares".
- Step 6: one notification row, to Mark: "Visit sharing changed — Peter Nakamura changed which
  organizations can see each organization's visits." None to Peter.
- Step 7: Recent visits "6 logged", now with Brennan (Oct 11) and Ashby (Oct 4), "Recorded by
  Mark Andersen", no Flag on either, no private-note text. Feed: 6 tiles, Ashby and Brennan
  labelled Bishopric; sentence "…the visits of the Bishopric and Relief Society…".
  **DEFECT 099-D1:** choosing **Bishopric** in the selector shows Ashby and Brennan "Last
  visited —". `readVisitProgress()` filters visit logs on the chosen organization's id, and
  bishopric visits are stored with `org_id = null`, so the Bishopric's progress can never show
  a visit. The bishop's own selector has the same gap from before this slice; bv1 shows it to
  every organization the Bishopric is shared with.
- Step 8: RS president's feed: 4 tiles, no Ashby or Brennan; sentence names the Elders Quorum.
- Step 9: "Cross-organization youth follow-ups … This no longer affects visits. Who can see each
  organization's visits is set by the bishopric on the Visits page." Rendered in dark.

Found beside the checklist (for the user to decide):

- With a shared organization selected, the goal, stewardship and log panels below stay those of
  the reader's **own** organization (they are rendered once on the server and do not follow the
  selector), while the banner above says "Open the visit goal below to set one." Nothing can be
  written to the other organization — RLS refuses it — but the page reads as though it could.
- The feed's organization filter offers Every organization, Elders Quorum and Relief Society — no
  Bishopric, although Bishopric tiles appear.

**099-D1 resolved the same day (user's choice, option b):** the Bishopric is left out of the
Organization selector for every reader, the bishop included, because its visits are stored with
`org_id = null` and the progress table filters on an organization id. Bishopric visits are read in
Recent visits and the feed. Re-walked: the EQ president's selector reads Elders Quorum, Relief
Society with Recent visits still "6 logged"; the bishop's reads Elders Quorum, Primary, Relief
Society, Sunday School, Young Men, Young Women, opening on Elders Quorum.

**Step 3 changed the same day (user's choice):** the refusal now links to both the Visits page
and the dashboard. Re-walked: links `/visits` "Your Visits page" and `/dashboard` "Back to the
dashboard".

**User's answers on the review page:** the panels that do not follow the selector wait for bv2's
re-skin; the sharing panel reads well, the dark selected chip included; the feed's sentence reads
well, and the feed filter stays without a Bishopric choice for now.

Every step was completed as written. The sharing panel was captured light (counselor, before) and dark
(bishop, after).

## Notes

- **Scenario 048 is superseded in part by this slice.** It walks the RS president on the
  all-organizations page with the switch on; that page is now the bishopric's alone (ITER-055 P4),
  so its RS-president steps no longer apply.
