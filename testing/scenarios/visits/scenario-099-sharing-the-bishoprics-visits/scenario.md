---
name: Sharing the Bishopric's visits
scope: visits
part: 1
tags: [visits, full, rls, sharing, ITER-055]
prerequisites: Migration 099 applied; Visits released for the Harness Test Ward. Since bv2 the seed also sets a visit goal for the Elders Quorum and the Relief Society.
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
2. Open the **Feed** tab.
3. Type `/visits/all-organizations` in the address bar.
4. Sign in as the **1st counselor**, open **Visits**, open the **Sharing** tab.
5. Under **Who can see the Bishopric's visits?**, turn on **Elders Quorum**, and press **Save
   sharing**.
6. Sign in as the **bishop** and open the notification bell.
7. Sign back in as the **EQ president** and open **Visits**, then the **Feed** tab.
8. Sign in as the **RS president**, open **Visits**, then the **Feed** tab.
9. Sign in as the bishop, open **Admin**.
10. **(bv2)** Sign in as the **EQ president**, open **Visits**, and on the **Households** tab
    press **Cadence** on Castillo, then **Log visit** on Brennan, then **Visit goal**, **Which
    households** and **Appointments** in turn. Change **Sort by** to **Household**.
11. **(bv2)** Choose **Relief Society** in the Organization selector and press **Visit goal**.
12. **(bv2)** Open the **Feed** tab, then reload the page.
13. **(bv2)** Type `/visits/feed` in the address bar.

## Verification Checklist

- [ ] Step 1: the EQ president's **Recent visits** lists Castillo, Dawson, Ellery and Fontaine —
      and **not** Ashby or Brennan
- [ ] Step 1: the Organization selector offers Elders Quorum and Relief Society only
      _(Corrected 2026-10-31: this used to add "on Relief Society, no cadence control can be
      changed". The seed sets no visit goal, and the cadence control only appears once a goal
      exists, so no organization showed one and the check could not fail. Seed a goal for both
      organizations before reinstating it.)_
- [ ] Step 1: the tabs read **Households · Feed** only — no **All orgs** and no
      **Sharing** _(bv2: these were a link and a section until the re-skin)_
- [ ] Step 2: the feed's sentence names the Relief Society as shared with the Elders Quorum
- [ ] Step 2: no tile carries any text containing "PRIVATE"
- [ ] Step 3: the address redirects to `/visits`, there is no All orgs tab, and the page
      opens on the tab the EQ president last used — **Feed**, from step 2 _(bv2: this was a refusal
      page until the old address became a redirect, the user's choice. Corrected 2026-11-01: this
      said "opens on Households", but a tab the reader cannot see falls back to the remembered tab,
      and step 2 had just remembered Feed)_
- [ ] Step 4: the counselor's tabs read **Households · Feed · All orgs · Sharing**
- [ ] Step 4 (375px): all four tabs fit on one line, with no scrollbar under them _(099-D2)_
- [ ] Step 4: the Sharing tab lists one row per organization, the **Bishopric first**, and no row
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
- [ ] Step 10: the page reads **People & Care** above the title **Visits**
- [ ] Step 10: each household is one card: name and band pill on the first line with small
      **Log visit** and **Cadence** buttons, then a line saying when it is due (or "Never
      visited."), and who last went
- [ ] Step 10: Castillo's card says **this household's own cadence**; Ellery's says **1 attempt
      since**
- [ ] Step 10: **Cadence** opens a window with the "Visit this household once every" controls
      already showing; **Log visit** opens a window with Brennan already chosen
- [ ] Step 10: Visit goal, Which households and Appointments each open their own window, sized
      to their content (a bottom sheet at 375px), and the heading changes to "Households, by
      household" after the sort change
- [ ] Step 11: the window title names the **Relief Society**, lists the Relief Society's goal
      only, and offers no **Set a goal** or **Edit** — a shared organization is read-only
      _(the bv1 follow-up: the panels used to stay the reader's own organization)_
- [ ] Step 12: after the reload the page reopens on the **Feed** tab, still sorted by Household
- [ ] Step 13: `/visits/feed` lands on `/visits` with the Feed tab open
- [ ] Every screen above works at 375px wide in light and dark

## Failure Behavior

- If Ashby or Brennan appear for the EQ president at step 1, the old switch is still reaching a
  visit policy — check migration 099 applied.
- If the Bishopric row is missing at step 4, the ward has no Bishopric organization.

## Walkthrough record

**2026-11-01 — bv2, driven by Claude (Playwright against `npm run dev` at 375px, writes read back
with the service role through `.walk099/readback099.mjs`).** Not yet reviewed by the user.
Screenshots `bv2-*.png` in `.walk099/` (git-excluded). The password was read inside the browser
script from `.env.local` and never entered the transcript. Every step 1–13 was completed as written.

Observed:

- Step 1: tabs `Households · Feed`; selector Elders Quorum, Relief Society; Recent visits Ellery
  (Oct 20, attempted), Fontaine, Dawson, Ellery, Castillo — no Ashby or Brennan; Flag only on the
  three EQ visits. No console warnings or errors.
- Step 2: "…and the visits of the Relief Society, which the bishopric has shared with yours." 5
  tiles; "PRIVATE" nowhere; no horizontal overflow.
- Step 3: landed on `/visits?tab=all_organizations`, tabs `Households, Feed`, Feed selected
  (checklist corrected — see the step 3 item).
- Step 4: counselor tabs `Households, Feed, All organizations, Sharing`; Bishopric row first;
  exactly two chips pressed (EQ ⇄ RS); every chip 44px.
- Step 5–6: "Saved." Read back: grants EQ→RS, RS→EQ, Bishopric→EQ (`created_by` set on the new
  one); audit `visit_sharing_updated {added: [Bishopric→EQ], removed: [], grantCount: 3}`; one
  notification, to Mark: "Visit sharing changed — Peter Nakamura changed which organizations can see
  each organization's visits." None to Peter.
- Step 7: Recent visits now 7, with Brennan (Oct 11) and Ashby (Oct 4) "Recorded by Mark
  Andersen", no Flag, no private text; selector still EQ, RS; feed tiles for both labelled
  Bishopric; sentence "…the visits of the Bishopric and Relief Society…".
- Step 8: RS feed names the Elders Quorum only; no Ashby or Brennan.
- Step 9: "Cross-organization youth follow-ups" … "This no longer affects visits. Who can see each
  organization's visits is set by the bishopric on the Visits page."
- Step 10: eyebrow "People & Care", h1 "Visits"; card buttons 44px. Castillo: "Due Jan 5, 2027 ·
  this household's own cadence" / "Last visited Oct 5, 2026" (no "by" — the seed records no
  participants). Ellery: "Never visited." / "1 attempt since". Cadence opened as a bottom sheet
  (y 534, h 278) showing **3 months**; Log visit opened with Household = **Brennan**. Visit goal
  (h 333), Which households (h 335), Appointments (h 736) each opened their own sheet. Sort by
  Household → "Households, by household", cards Ashby…Fontaine.
- Step 11: "Visit goal — Relief Society", one goal ("Every household once a year"), no buttons but
  Close; the page read "The bishopric has shared the Relief Society's visits with yours…". Cadence
  on Castillo opened read-only ("Every year", Close only).
- Step 12: after reload, Feed selected; Households heading "Households, by household". Stored
  view read back: Miguel `{tab: feed, sort: familyName}`.
- Step 13: `/visits/feed` → `/visits?tab=feed`, Feed selected — with **Households** remembered at
  that moment, so the address decided it.
- 375px: no page-level horizontal overflow on any tab, light or dark.

**DEFECT 099-D2 (bv2):** for the bishopric at 375px the four tabs do not fit — the tab row is 383px
in a 343px box, "Sharing" ends at x=399, and a grey browser scrollbar shows under the tabs.
**Resolved 2026-11-03 (user's choice):** the tab is labelled **All orgs**; step 4 gained a 375px
check. Not re-walked.

Found beside the checklist (for the user to decide):

- On a shared organization, **Log a visit** and each card's **Log visit** and **Cadence** stay.
  Cadence opens read-only; Log visit records a visit for the reader's OWN organization. Both sit
  under the sentence "only its own leaders change them".
- The read-only goal window says "View only — your role does not set goals." The EQ president can
  set goals; it is read-only because the organization is shared.
- "1 attempt since" on a never-visited household reads unfinished.
- The doubled heading inside windows ("Log a visit" / "Log a visit", "Visit goal — …" / "Visit
  goals") and a card border inside the sheet.
- On narrow cards the two buttons wrap under the name (Brennan, Fontaine) while others fit
  (Ellery).
- **Older than bv2:** the log form's default date is computed in UTC (`formatDateOnly(new Date())`
  in `page.tsx`, unchanged by bv2). Walked at about 8pm Mountain on Nov 1, it defaulted to
  **11/02/2026**, and `max` allows that date.


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
