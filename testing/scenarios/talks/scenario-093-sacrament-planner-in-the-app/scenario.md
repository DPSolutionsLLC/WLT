---
name: The Sacrament Planner inside the app
scope: ITER-045
part: 1
tags: [full, sacrament, access, realtime]
prerequisites: migration 093 applied
---

## Purpose

Proves that the Sacrament tile opens the bishopric's Sacrament Planner under the app's chrome
bar, for the bishopric only. Who you are inside it follows the login. Practice mode stays
separate from the real records. A save by one person reaches another live. This needs a walk
rather than a unit test: it takes two simultaneous logins, a phone-width window, both themes,
and the Planner's own screens, which no component test renders.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, every module released |
| Users | `bishop` (Mark Andersen, bishop), `counselor` (Dana Whitmore, 1st counselor), `music` (Iris Calloway, music coordinator), `admin` (Theo Brandt, ward secretary + app-wide super admin) |
| Members | Laura and Ethan Brooks (Ethan has no phone of his own), Grace and Samuel Okafor, Nora Lindqvist |
| Planner settings | `bishopric` lists Mark Andersen (Bishop), Dana Whitmore (1st Counselor), Paul Hendry (2nd Counselor); `rotation` in that order |
| Planner Sundays | The next Sunday (owner Mark; Grace Okafor penciled in to speak on "Gratitude in hard seasons") and the one after (owner Dana, empty) |
| To Decide | Nora Lindqvist deferred for 90 days; Samuel Okafor pending, agreed by Mark only |
| Pray About | Laura Brooks for a talk (Mark's); Ethan Brooks for a prayer (Dana's) |
| History | 10 agenda lines across the three past Sundays, with who conducted |

**Sign in with:** `bishop@harness.wardleadershiptools.test`, `counselor@…`, `music@…`, `admin@…`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-093-sacrament-planner-in-the-app`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the bishop in a phone-width window (375px). Open the **Sacrament** tile.
4. In a second browser, sign in as the counselor and open the Sacrament tile.
5. As the counselor, open the next Sunday on **Sundays**, add a speaker and save.
6. As the bishop, turn on **Practice mode** (header on desktop; **More** on a phone), make a
   change, then **Clear test changes**.
7. Use Undo and Redo on a real change. Try "Write it fresh with Claude" on a message, and
   Download CSV on Records → History.
8. Sign in as the music coordinator. Then visit `/sacrament` as the bishop and as the admin.

## Verification Checklist

### Machine-checkable

- [x] The bishop's dashboard shows a Sacrament tile linking to `/sacrament-planner`
- [x] The music coordinator's dashboard has no Sacrament tile, and `/sacrament-planner` shows "Not permitted … limited to the bishopric"
- [x] The frame's header reads "Using as **Mark Andersen**" for the bishop and "Using as **Dana Whitmore**" for the counselor
- [x] There is no "You are" menu anywhere: not in the header, and not in the phone's More sheet
- [x] A Practice mode switch is in the header on desktop and in the More sheet on a phone
- [x] Pray About shows the bishop only Laura Brooks, and the counselor only Ethan Brooks
- [x] Who's Next leaves out Nora Lindqvist (deferred) and To Decide shows Samuel Okafor "waiting on Dana Whitmore, Paul Hendry". Nora is not in To Decide: a deferral returns there only when its time is up
- [x] The counselor's saved speaker is in `planner_documents` (layer `real`, collection `sundays`) with `updated_by` = the counselor, plus a `planner.document_saved` audit row whose detail is only `collection`, `documentId` and `layer`
- [x] The counselor's save appears in the bishop's window within a few seconds, with no reload
- [x] Undo and Redo put a real change back and forth, in the database as well as on screen
- [x] A practice change lands in layer `practice` only, does not appear in the counselor's window, and after "Clear test changes" no practice rows remain for the ward
- [x] `/sacrament` and `/prayers` redirect the bishop to `/sacrament-planner`; the admin (super admin) is NOT redirected from `/sacrament`
- [x] Download CSV saves `sacrament-speaker-history.csv`
- [x] The Planner's AI route returns a draft for the Planner's own prompt
- [x] The Planner has no light/dark button of its own, and switching the app's theme switches the Planner with no reload (decided reviewing this walk)
- [x] No horizontal overflow at 375px; the Planner's bottom tab bar sits at the bottom of the screen, not below it

### Needs a human eye

- [x] The Planner sits under the app's chrome bar with its own banner and bottom tab bar, and looks like the old Planner page, in light and in dark (user, 2026-10-24)
- [x] The Practice mode switch in the phone's More sheet reads as a switch you would find and understand (user, 2026-10-24)
- [x] The outer page scrolling 32px at phone width (to show the version footer below the Planner) is acceptable (user: leave it)
- [ ] Pressing "Write it fresh with Claude" on a real message fills the message box, and nothing is sent or saved
- [ ] On a real phone, Call and Text open the Phone and Messages apps (Ethan shows his mother's number, marked as hers)

## Failure Behavior

- [ ] A signed-in user with no bishopric calling who opens `/api/sacrament-planner/frame` directly gets a one-line 403 page and no member data. Automated in `tests/routes/sacrament-planner-frame.test.ts`.
- [ ] A save the server refuses shows the Planner's own "You can view this page but not save changes" message, not a crash. The 403 → `invalid_argument` mapping is automated in `tests/lib/sacramentPlanner/bridge.test.ts`.
- [ ] Other wards never receive this ward's saves live. Automated in `tests/rls/realtime-isolation.test.ts`.

## Walkthrough record

**2026-10-24, agent-driven** (Claude through Playwright, against `npm run dev` on port 3000 and the
hosted database). The user has not yet reviewed the screenshots or the six human-eye checks.
Sessions were minted through the service role (a magic-link token verified server-side) and
loaded as cookies, so no password was typed. Four browser contexts at once: the bishop at 375×812,
the counselor, the music coordinator and the admin at 1280×900. Screenshots are in
`testing/walk-screenshots/093-*.png` (git-excluded).

**Defect found and fixed during the walk (093-D1).** The bishop's header read "Not set: choose who
you are" although the login had resolved to "Mark Andersen". `renderActing()` clears a `me` that is
not on the bishopric list, and its first render runs before the `settings` documents load, so it
checked against the placeholder defaults (E1) and wiped the signed-in name. Fixed with one line in
`renderActing()` (the login wins outside practice), pinned by
`tests/lib/sacramentPlanner/assetEdits.test.ts`, which was shown to fail without the line.

**Observed values.**
- Headers: "Using as Mark Andersen" (bishop), "Using as Dana Whitmore" (counselor); no visible
  `actingAs` select in either; `#practiceMode2` present in the More sheet, no `#actingAs2`.
- Phone frame: top 61px, height 751px in an 812px viewport; `#bnav` bottom at 751 (the frame's
  bottom); horizontal overflow 0 inside the frame. The outer page is 844px tall (32px of scroll
  to the version footer).
- Pray About: bishop sees only "Brooks, Laura · Talk · Ministering"; counselor sees only
  "Brooks, Ethan · Prayer". Badge count 1 for each.
- Who's Next (counselor): "Showing 4 of 5 people", Nora absent. To Decide: "Okafor, Samuel waiting
  on Dana Whitmore, Paul Hendry … Proposed deferral · Lives elsewhere right now".
- Live update: the counselor saved `sundays/2026-11-01` slot s0 = "Lindqvist, Nora" through the
  Planner's own `write()` (the function its Save calls; the Sunday editor itself was not clicked).
  The save took 2,979 ms (first call to the route on a dev server); the bishop's unreloaded window
  had it 10 ms later. Row read back: `updated_by` = Dana; audit
  `{"layer":"real","collection":"sundays","documentId":"2026-11-01"}`.
- Undo (button title "Undo: saved by walk (Sunday Nov 1)") reverted the row to an empty slot in the
  database; Redo restored it. One audit row each.
- Practice: ticking the More-sheet switch gave "Using as 🧪 Test User", the practice bar, and sync
  "Practice only". A practice save wrote one `practice` row (audited `layer: "practice"`); the
  counselor's window still showed the slot empty. "Clear test changes" armed as "Tap again to erase
  1 test change", then "All test changes erased…"; 0 practice rows remained, audited as
  `planner.document_deleted`. Turning the switch off returned "Using as Mark Andersen".
- AI: `state.sample` is set. The Planner's music prompt returned a 743-character draft signed "Dana
  Whitmore"; audit `planner.draft_written` with `outputTokens` redacted (ITER-017, known).
- Download CSV (real button): `sacrament-speaker-history.csv`, header plus 10 lines.
- Access: music coordinator has no tile; page "Not permitted … limited to the bishopric"; frame route
  403 with no member names; direct PUT 403. Bishop `/sacrament` and `/prayers` → `/sacrament-planner`.
- Theme: the Planner's toggle changed only `planner:theme`; the app's Change theme (dark → light)
  left the Planner dark.
- Console: no errors or warnings on the bishop's page.

**Checklist corrections.**
- "To Decide shows Nora Lindqvist deferred" described a state the app cannot reach: a deferral
  returns to To Decide only when its time is up. Rewritten as Nora absent from Who's Next, Samuel in
  To Decide.
- "The admin (super admin) still sees the old hub" was wrong: the admin is not redirected, but their
  ward secretary calling cannot read the hub, so it says "Not permitted". They also get no tile. The
  Notes, CLAUDE.md and `legacyGate.ts` said the opposite and were corrected.
- Seven human-eye items had definite answers and were moved to Machine-checkable.
- The seed wrote history lines with an empty `auto` column, so everyone read "Talk never". The
  Planner counts `auto` (the matched ward-list name); the seed now fills it.

**User review, 2026-10-24.** The look, the Practice mode switch and the 32px scroll were accepted. The Planner's own light/dark button was removed at the user's request: it now follows the app's theme (`PlannerFrame.tsx` copies the app's `dark` class onto the Planner as `data-theme`, on load and on every change). Verified: light → dark → light with no reload.

**Not walked.** The "Write it fresh with Claude" BUTTON (no seeded Sunday reached a state that shows
the message panels; the capability was proven by calling it directly). Call and Text, which need a
real phone.

## Notes

- **The admin (super admin) gets no tile and no old hub here.** The tile follows the CALLING: a
  ward secretary holds neither `planner.use` nor `talks.view`, so the dashboard has no Sacrament
  tile, `/sacrament-planner` says "Not permitted", and `/sacrament` is not redirected but says "Not
  permitted" too. Only a session whose calling role is `super_admin`, or a bishopric calling, sees
  the old hub. A super admin with a bishopric calling (the user's own shape) opens both.
- **Program, Music and Topic history still link to the old hub.** In this ward those modules are
  released, so their links into `/sacrament` or `/assignments` now land on the Planner. That is
  expected (ITER-045 connects no pipelines).
- **Practice is shared by the ward**, as it was in the old Planner. "Clear test changes" clears
  everybody's practice changes.
