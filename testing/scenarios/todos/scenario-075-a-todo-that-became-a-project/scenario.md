---
name: A to-do that became a project
scope: P5
part: 1
tags: [todos, full, P5]
prerequisites: none
---

## Purpose

The shape of To Do only shows with data in it: overdue against do-today against someday
ordering, a project's computed progress, a plain item turning into a project the moment it gets
its first step (with no mode switch), and one timeline where an automatic "Checked off …" line
sits **between** two written notes by time. The scenario also proves privacy on screen: the bishop
has a to-do of their own, and neither leader can see the other's. Seeding gives all of that at
once. The table-level guarantees are already Vitest (`tests/rls/todos.test.ts`,
`tests/routes/todos.test.ts`); this walk is for the screen.

## Seed Data

Dates are relative to **today in America/Denver**; the seed prints which day it used.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `eq-president@harness.wardleadershiptools.test` (Elders Quorum president, Miguel Cortez); `bishop@harness.wardleadershiptools.test` (bishop, Mark Andersen) |
| President's to-dos | **Send the ministering assignments** (due yesterday → Overdue); **Call Brother Okafor about the move** (do date today → Do today); **Plan the quorum service project** (tag *Service project*, due in 10 days, 3 steps with 1 done, notes, 3 timeline lines); **Order new hymnbooks for the quorum** (no dates, no steps → Someday); **Return the chapel key** (completed yesterday) |
| Project timeline | note (30 min ago) → `Checked off "Call the food bank coordinator"` (20 min ago) → note (10 min ago) |
| Bishop's to-do | **Draft the tithing declaration schedule** (due in 10 days) |

**Sign in with:** `eq-president@harness.wardleadershiptools.test`, then `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- todos/scenario-075-a-todo-that-became-a-project`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the Elders Quorum president.
4. On the dashboard, open **To Do** (Tasks & Communication).
5. Read the order of the open list.
6. Tap **Plan the quorum service project** to open it. Read the steps and the timeline.
7. Check off **Book the Saturday slot**. Read the timeline again.
8. Close it; open **Order new hymnbooks for the quorum**; add the step "Get a price from the distribution center".
9. Choose the **Service project** tag filter, then **All tags**.
10. Switch to **Done**.
11. Sign out; sign in as the bishop; open To Do.

## Verification Checklist

### Machine-checkable

- [ ] The dashboard shows a **Tasks & Communication** section with a **To Do** tile, and no My Appointments tile (not built until p5-c)
- [ ] The open list reads, top to bottom: Send the ministering assignments (**Overdue**) → Call Brother Okafor about the move (**Do today**) → Plan the quorum service project (**Upcoming**) → Order new hymnbooks for the quorum (**Someday**)
- [ ] **Return the chapel key** is absent from Open and present under **Done**
- [ ] The project shows `1/3`; the hymnbooks item shows **no** progress pill at all (not `0/0`)
- [ ] After step 7 the project shows `2/3` and a new `Checked off "Book the Saturday slot"` line is the **last** line of the timeline
- [ ] The seeded `Checked off "Call the food bank coordinator"` line sits **between** the two notes, not in a separate list
- [ ] After step 8 the hymnbooks item shows `0/1` with no other change — no mode switch, no "convert" control
- [ ] A `todo_step_added` audit row exists for step 8; no audit row's `detail` contains any title, step label or note text
- [ ] The **Service project** filter shows only the project; the tag filter row is absent under **Done** (no done item has a tag)
- [ ] Signed in as the bishop, To Do lists only **Draft the tithing declaration schedule** — none of the president's five
- [ ] Signed in as the president, the bishop's to-do appears nowhere, under Open or Done
- [ ] At 375px: no horizontal overflow; each card's Edit / ✕ group stays on the title line; every control is at least 44×44
- [ ] No raw uuid on screen

### Needs a human eye

- [ ] Do **Do** and **Due** read as clearly different without explanation, on the card and in the edit window?
- [ ] Do the automatic timeline lines read as quieter than the notes, in both light and dark themes?
- [ ] Does the ✕ → "Remove?" arming read as a deliberate second step rather than a glitch?
- [ ] Does the page sentence ("Nobody else can see it…") read as reassurance rather than a warning?

## Failure Behavior

- [ ] Saving a to-do with an empty title shows "Give it a title." in the window and saves nothing
- [ ] Adding an empty step shows "Say what the step is." beside the step field
- [ ] A to-do id belonging to somebody else answers 404, not 403 — covered by `tests/routes/todos.test.ts` ("answers 404 to the bishop…"); do not re-test it by hand
- [ ] A stake officer is refused To Do entirely — covered by `tests/routes/todos.test.ts` ("refuses a role without personal_tools.use")

## Walkthrough record

**2026-09-24 — driven by an agent (Claude, Playwright against `npm run dev` on :3000), with the
four judgement checks handed to the user as screenshots.** Not yet a person using the app.
Every write was read back with the service-role client (`testing/walk-screenshots/scenario-075/
readback.mjs`; final state in `final-readback.txt` beside it). Screenshots are in the same folder.

Seed: today = 2026-09-24 (America/Denver).

**Machine-checkable — observed values**
- Dashboard (president): sections Meetings & Programs, People & Care, **Tasks & Communication**
  holding exactly one tile, **To Do**. No My Appointments tile. ✅
- Open list order: Send the ministering assignments `Overdue · Due Wed, Sep 23` → Call Brother
  Okafor about the move `Do today · Do Thu, Sep 24` → Plan the quorum service project
  `Upcoming · 1/3 · Service project · Due Sun, Oct 4` → Order new hymnbooks for the quorum
  `Someday`. ✅ Return the chapel key absent from Open, sole item under Done. ✅
- Hymnbooks showed no progress pill before step 8. ✅
- Project timeline: `Sep 24, 6:33 AM` note → `6:43 AM Checked off "Call the food bank
  coordinator"` → `6:53 AM` note (12:33/12:43/12:53 UTC). The automatic line sits between the notes. ✅
- Step 7: DB `Book the Saturday slot` done_at set; log line `step_done "Book the Saturday slot"`
  at 13:05:18Z, rendered last as `Sep 24, 7:05 AM`; card `2/3`. ✅
- Step 8: DB step `Get a price from the distribution center` created; card `0/1`; the card's controls
  were Edit, ✕, the step's ✕, Add, Add note — no mode switch or convert control. ✅
- Audit: `todo_step_updated {done, stepId, todoId, renamed}` and `todo_step_added {stepId, todoId}`;
  0 audit rows contain any title, label or note text. ✅
- Tag filter: Service project → only the project; All tags → all four; no tag row under Done. ✅
- Bishop: To Do lists only Draft the tithing declaration schedule (screen and `GET /api/todos`); Done
  reads "Nothing completed yet."; `GET` and `PATCH /api/todos/<president's project>` → **404** "That
  to-do could not be found."; the title in the DB was unchanged. ✅
- 375px: `scrollWidth − clientWidth = 0`; the Edit/✕ group sat on the title row on all four cards; no
  uuid in the page text. ✅
- **Tap targets: ❌ — defect 075-D1** below.
- Failure paths: an empty title gives "Give it a title." in the window, and nothing is saved ✅. An empty
  step gives "Say what the step is." ✅, **but see 075-D2** for where it appears.
- Console: 0 errors, 0 warnings on every page, apart from the two deliberate 404 fetches.

**Defects found**
- **075-D1** — the card-level "mark done" checkbox is a **20×20** tap target (all four cards), below
  the app's 44×44 rule. Step checkboxes pass, because each is wrapped in a 44px label; the card
  checkbox has no label around it.
- **075-D2** — "Say what the step is." renders in the card-level error slot under the title,
  **237px above** the step field on the seeded project. The plan asked for errors inline next to
  their control. Not visible from the field on a phone.

**Both defects FIXED the same day, on the user's decision, and re-checked in the browser at 375px**
(`10-fixes-D1-D2-375.png`), in `app/(app)/todos/TodoCard.tsx` only:
- D1: the checkbox now sits in a 44×44 label (measured 44×44). A tap 3px inside the corner
  completed the to-do, and unticking under Done reopened it. DB: `completed` then `reopened` log
  lines; `todo_completed` / `todo_reopened` audit rows.
- D2: each error remembers the control that caused it. "Say what the step is." now renders **4px
  below the step field**, with nothing under the title. Card-level errors (done, remove) stay under
  the title.

**Needs a human eye — answered by the user from the screenshots, 2026-09-24: all four pass.**
Do/Due read as different; automatic timeline lines read quieter than notes in both themes (and the
ward-zone date-and-time stamps are accepted); ✕ → "Remove?" reads as deliberate; the privacy
sentence reads as reassurance.

**Checklist corrections:** none. Every check described a reachable state.

**Not verified here:** the dark theme was applied by adding the `dark` class directly, because the
seeded account's saved preference overrides the emulated system setting. The screenshot is the
real dark stylesheet, but the toggle itself was not exercised.

## Notes

- Timeline stamps are in the **ward's** zone with the time (e.g. "Sep 24, 4:12 PM"). That is a
  deliberate departure from the date-only UTC stamps elsewhere — see the header of
  `app/(app)/todos/TodoTimeline.tsx` — and is one of the things this walk should judge.
- "Overdue" and "Do today" are computed on each page load from the ward's date. Re-seed if you walk
  this across midnight in Denver.
