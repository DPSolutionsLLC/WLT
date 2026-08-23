---
name: Overdue goals reach the planner
scope: talks-d-reliability-goals
part: 1
tags: [talks, full, goals, calendar]
prerequisites: none
---

## Purpose

Whether a standing goal reaches the bishopric **at the moment it can act on one** — which is while
choosing speakers for a particular Sunday, not while glancing at a month.

The first version of this put overdue goals on every calendar cell. Walking it killed that: three
overdue goals wrap to nine lines in a ~130px grid column, on every Sunday of every month, whether
or not anybody is planning. The alerts now live on the Sunday planning page as a banner that can be
dismissed for the month, and the question this scenario asks is whether that lands better.

It also carries two things no unit test reaches: a goal pointing at a **deleted household** (because
`target_id` is polymorphic and carries no foreign key), and whether **org-scoped ownership** reads
correctly on a board where the bishopric sees every organization's goals at once.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds `goals.manage` |
| | `eqpres` (org_president, Elders Quorum, Samuel Reyes) — holds `goals.view` and `goals.manage`, and **owns two of the eight goals** |
| | `music` (music_coordinator, Elena Duarte) — holds **no** goals permission |
| Goals | **8, spread deliberately across the buckets** |
| | *Overdue* — "Every quorum presidency speaks once a year" (12 months, fulfilled 2025-02-01) |
| | *Overdue* — "Visit every widow each quarter" (3 months, fulfilled 2026-01-10) |
| | *Due soon, ~87%* — "Youth speaker twice a quarter" (6 months, fulfilled 2026-03-15) |
| | *On track, ~74%* — "Ward council reviews the ministering list" (6 months, fulfilled 2026-04-09) |
| | *On track* — "New members speak within six months" (12 months, fulfilled 2026-06-01) |
| | *On track* — "Elders Quorum presidency message" (24 months, fulfilled 2026-05-01, `group` target) |
| | *Never fulfilled, past its interval* — "Ask every adult to pray each year" (12 months, created 2025-01-15) |
| | *Never fulfilled, still inside it* — "Interview every youth twice a year" (6 months, created 2026-07-01) |
| Targets | Two members, one live household, one organization, one `group`, and two with no target |
| | **One pointing at a deleted household** — the row is removed after the goal is written, which is the state no foreign key can prevent |
| | Every goal's cached `goals.status` column is seeded to **disagree** with the computed value, on purpose |
| Ownership | **Two goals belong to the Elders Quorum** — "Every quorum presidency speaks once a year" (owned by *and* about it) and "Ask every adult to pray each year" (owned by it, about a household) |
| | The other six are **ward-level** (`org_id` null), which migration 030 makes bishopric-only |
| Sundays | July and August 2026, standard, 3 speaking slots each |
| Assignments | Speakers across the July Sundays at various stages, so all three reserved regions have something to render at once |

**Sign in with:** `bishop@`, `eqpres@`, `music@` — all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-019-goals-on-the-calendar`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/goals` and read the whole board before touching anything.
   **Note the order, each badge, and which goals carry an owner chip.**
4. Find the goal whose target was deleted and read how it renders.
5. Set the "Showing" filter to each target kind in turn, then back to "Every goal".
6. Press **Add a goal**, give it a member target and a 6-month frequency, and save. Note its
   badge, where it lands, and whether it shows an owner chip.
7. Press **Edit** on any goal, change the frequency, and save.
8. Press **Mark fulfilled** on "Every quorum presidency speaks once a year" and watch the row
   **without reloading the page**. Give it a couple of seconds — it is a real round trip.
9. Open `/calendar?month=2026-07`. Read the cells at desktop width, then at 375px.
10. Open `/assignments?month=2026-07` and press into **Sunday, July 12**.
11. Read the banner at the top of that Sunday — it starts **collapsed to one line**. Press
    **Show them** to expand it, then collapse it again. Then press **Dismiss for this month**.
12. Go back and press into **Sunday, July 19** — same month.
13. Now press into a Sunday in **August** and compare. Note that **August has no seeded
    assignments** — use it for the "banner is back" and "one more alert" checks, and go back to a
    **July** Sunday for anything about the banner sitting alongside the assignments.
14. In the Supabase dashboard, read `select title, org_id, status from goals where ward_id =
    '11111111-1111-4111-8111-111111111111'` and compare `status` against the badges on screen.
15. Sign out. Sign in as `eqpres`, open `/goals`, and try every write control there is.
16. Sign out. Sign in as `music` and open `/goals`.
17. Re-check both themes on every screen.

## Verification Checklist

The board

- [ ] **Overdue sorts first**, then due soon, then on track — the board opens on what somebody has
      to act on
- [ ] The two goals either side of 80% land in the **right buckets**: the 2026-03-15 one reads
      **Due soon** (~87% elapsed) and the 2026-04-09 one reads **On track** (~74%)
- [ ] The never-fulfilled goal **past** its interval reads **Overdue**
- [ ] The never-fulfilled goal **inside** its interval reads **On track**
- [ ] Every goal says when it was last fulfilled, and a never-fulfilled one says so in words
      rather than showing a blank or an epoch date
- [ ] Colour is never the only signal — every badge carries its status as a **word**

The dead target — the case no foreign key prevents

- [ ] The goal whose household was deleted renders **something honest** — it names the kind of
      target and says the record no longer exists
- [ ] It does **not** render a blank row, a raw uuid, "undefined", or crash the board
- [ ] The `group`-targeted goal also renders without crashing. `group` has no table to resolve
      against, so it degrades the same way

Creating and editing

- [ ] The "This goal is about" control offers **Member, Household, Organization and the whole
      ward** — and does **not** offer Group. There is no table to verify a group against, and an
      unverifiable target is the permanent mystery this rule exists to prevent
- [ ] Saving with an empty title is refused with a sentence saying what to do. **Set the target
      back to "The whole ward" first** — the client-side target check fires before the request, so
      with a half-filled target you get that message instead and never reach the title rule
- [ ] Saving with a frequency of 0 or a blank frequency is refused
- [ ] Choosing a target kind without choosing which one is refused before the request
- [ ] A newly created goal appears with a status computed from **today**, not from the cached column
- [ ] Editing a goal saves and the board reflects it without a manual reload
- [ ] Editing a goal **cannot** change its last-fulfilled date. There is no control for it, and
      that separation is deliberate — an edit must not quietly move a goal back on track

Marking fulfilled

- [ ] Step 8: the goal moves to **On track immediately, with no page reload**
- [ ] It re-sorts out of the overdue group in the same moment
- [ ] Its "last fulfilled" line now shows today

The calendar — what should NOT be there any more

- [ ] **No goal alerts appear on any calendar cell**, at desktop width or at 375px. They were
      removed after the first walk; a cell showing them again means the revert did not hold
- [ ] The calendar's other two regions still render — speaker names and the pipeline summary — so
      the absence above is a real removal rather than an empty month

The banner — the point of this scenario

- [ ] Step 11: the Sunday planning page opens with a banner **collapsed to a single summary line**
      — the goal titles are NOT visible until it is expanded
- [ ] The summary **names both numbers** when both kinds are present: "3 ward goals are overdue,
      1 is due soon". A heading that counts only the overdue ones above a longer list invites the
      reader to count lines and doubt the number — that was the first walk's finding
- [ ] The plurals are right: one overdue goal reads "1 ward goal **is** overdue", and the second
      clause does not repeat the subject ("…, 1 is due soon", not "…, 1 ward goal is due soon")
- [ ] **Show them** expands it, and the goal titles appear
- [ ] Expanding also reveals **why it is interrupting** — "worth a look while you are choosing
      speakers". It lives inside the panel so the collapsed line has one job: state the count
- [ ] **Dismiss for this month is reachable without expanding.** Dismissing is what somebody does
      INSTEAD of reading the list, so it must not be hidden behind the toggle
- [ ] The summary is genuinely **one line at 375px**, not a paragraph squeezed beside the button
- [ ] Each alert says **Overdue** or **Due soon** in words, not by colour alone
- [ ] **On-track goals appear nowhere in the banner.** An on-track goal is not a warning
- [ ] The alerts are computed **as of that Sunday**, not as of today — a July Sunday and an August
      Sunday can legitimately differ, and the August one should show one more
- [ ] Step 11: **Dismiss for this month** makes it disappear with no reload
- [ ] Step 12: a **different Sunday in the same month** stays dismissed
- [ ] Step 13: a Sunday in **August** shows the banner again — the dismissal is per month
- [ ] Reloading the page keeps it dismissed
- [ ] **The dismissed banner never flashes.** Reload a dismissed Sunday and watch closely: it must
      not appear-then-vanish. The server reads the cookie and omits it, so there is nothing to
      correct after hydration — a flash means something has gone back to deciding this on the client
- [ ] Dismissing a SECOND month keeps the first dismissed — the cookie holds a list, not one value
- [ ] The banner does not push the assignments off the screen at 375px, and nothing scrolls
      sideways. **Check this on a JULY Sunday** — August has no seeded assignments, so it cannot
      show the banner and the slots together
- [ ] Collapsed, the banner is a small fraction of the phone screen — the first speaker slot should
      be comfortably above the fold

The cached column — the compute-on-read rule

- [ ] Step 14: the `goals.status` column is **stale and disagrees with the screen** for at least
      one goal. That is correct. The column is a cache the UI never reads
- [ ] If every value matches, look harder — either the seed happened to line up, or something is
      reading the column, which is the bug 04-talks-pipeline.md §Step 9 names

Ownership — org-scoped since migration 030

- [ ] On the bishop's board, the **two Elders Quorum goals carry an owner chip** naming it
- [ ] The other six carry **no chip** — for a viewer who sees everything, unlabelled is the
      ward-level one, and "None" would be noise on six rows out of eight
- [ ] "Every quorum presidency speaks once a year" shows the chip **and** the target line, and they
      are visibly different things — one says who owns it, one says what it is about
- [ ] Step 6: a goal the **bishop** creates gets **no owner chip**. A bishopric author writes a
      ward-level goal, not a bishopric-org one
- [ ] Step 15: `eqpres` sees **exactly two goals** — their own — and not the other six
- [ ] `eqpres` can create and fulfil, and anything they create stays on their own board
- [ ] Sign back in as `bishop` and confirm the goal `eqpres` created is **visible to the bishopric**
      with an Elders Quorum chip. Bishopric authority is total (CLAUDE.md §7)

Permissions

- [ ] `music` gets a **"Not permitted"** page, not an empty board
- [ ] The Goals link appears in the sidebar for `bishop` and `eqpres` and not for `music`
- [ ] `music` sees no goal alert banner on a Sunday planning page either

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] Every panel keeps a **visible border in dark mode**
- [ ] Every tap target clears 44×44
- [ ] No raw uuid appears anywhere on the board or the calendar

## Failure Behavior

**Automated where it can be.** `tests/lib/goalStatus.test.ts` pins every boundary — on_track below
80%, due_soon at exactly 80% (built as a whole number of days rather than eyeballed), overdue on the
day the interval ends, both never-fulfilled cases, a zero and a negative interval, a future-dated
fulfilment, and month-end clamping. The sort order is pinned there too.

`tests/rls/goal-access.test.ts` proves the org scoping against the real database: the bishopric
reads and writes all three of a ward's goals, an EQ president reads exactly their own across the
whole ward, the Relief Society's is hidden from them on read, update, insert and delete, a
ward-level goal is invisible to both org presidents, and cross-ward isolation holds. It includes
the check that would have caught a leftover ward-scoped policy — PostgreSQL ORs permissive policies
together, so a surviving `goals_ward_select` would have made migration 030 a no-op that looked
like a success.

What is left for a human is whether the **banner earns its interruption**: whether it reads as help
at the moment of planning rather than as a nag, and whether dismissing-for-the-month is the right
granularity. Neither is a thing a test asserts.

## Notes

**Why a household is deleted after the goal is written.** `goals.target_id` is polymorphic and
carries **no foreign key** (migration 010's comment is explicit), so nothing in the database stops
a goal outliving its target. The route verifies the target on the way in, which is the only place
it can be checked — but a household deleted afterwards produces exactly this row, and the board has
to survive it. Seeding it is the only way to see that.

**Why the cached `status` column is seeded WRONG on purpose.** `createGoal` writes a status that
does not match what `goalStatus()` computes. If the board ever agrees with that column, something
is reading it — and the whole point of computing on read is that a stored status goes stale
silently.

**The 80% pair has a walk window.** Status is computed against TODAY, so a fixed fulfilment date
drifts across the boundary as the calendar moves. The pair is placed ~10% clear on each side, which
is honest between **2026-08-09 and 2026-09-02**. Walked outside that window, adjust the two dates in
`seed.ts` rather than the assertion — the exact-day behaviour lives in `tests/lib/goalStatus.test.ts`,
which builds its boundary as a whole number of days rather than eyeballing one.

**Steps 6 to 8 change data.** A goal created through the UI has a random id and survives a
re-seed, and step 8 overwrites a fulfilment date. Run `npm run seed:clean` and re-seed for a clean
run.

**The dismissal lives in the browser, not the database.** A COOKIE,
`wlt_goal_alerts_dismissed`, holding a comma-separated list of dismissed `YYYY-MM` months, capped
at twelve. So it is per-browser and per-device rather than per-user: the same bishop on a phone
will see the banner again. That is the deliberate cheap choice — a dismissible convenience is not
worth a table and a migration — but if a ward asks for it to follow them across devices, that is
the change, and it belongs with Phase 11's notification settings. Clearing site data resets it,
which is also how to re-run steps 11 to 13 without re-seeding.

**Why a cookie and not `localStorage`.** It WAS localStorage, which the server cannot read — so the
banner was rendered for everybody and hidden after hydration, painting a dismissed banner and then
removing it. Measured: **268 ms** unthrottled, **645 ms** at 4x CPU, **3.8 s** at 20x. A cookie
travels with the request, so `app/(app)/assignments/[sunday_id]/page.tsx` decides before the HTML
exists and there is nothing to correct. Re-measured after the change: never painted, at any of the
three rates.

**pg_cron is not enabled on this project**, so `refresh_goal_status()` is never running in the
background. Nothing on this checklist depends on it — the UI never reads the column it maintains.
To exercise it by hand: `select refresh_goal_status();` in the dashboard, then re-run step 14 and
watch the column come into agreement while nothing on screen changes.

## Walkthrough record

> **This record describes the FIRST design, and two of its findings are what changed it.** The
> calendar observations below are history: goal alerts were removed from the month grid, and the
> org-scoping recorded here as an open asymmetry was closed by migration 030. Kept rather than
> rewritten, because the reasoning is why the current design exists. **The banner and the
> ownership checks above have not been walked yet.**

**Walked 2026-08-22 by Claude (agent-driven), through a real browser (Playwright MCP) against the
hosted project.** Not a person using the app — every value below was read back from the database
with the service-role client or from the live API, and the judgement calls about wording and
density were escalated to the user with screenshots rather than ticked here.

**Observed values**

- Board order on load: three Overdue (Ask every adult to pray each year / Every quorum presidency
  speaks once a year / Visit every widow each quarter), then Due soon (Youth speaker twice a
  quarter), then four On track. Exactly the designed spread.
- The 80% pair landed correctly: 2026-03-15 read **Due soon**, 2026-04-09 read **On track**.
- Never-fulfilled pair landed correctly: created 2025-01-15 read **Overdue**, created 2026-07-01
  read **On track**.
- **All eight cached `goals.status` values disagreed with the screen.** Compute-on-read is proven,
  not assumed.
- Dead household target rendered "Household — this record no longer exists". The `group` target
  rendered "Group — this record no longer exists".
- Create form offered Member / Household / Organization / the whole ward, and **not Group**. The
  filter still offers Group, so an existing group goal can be found.
- Validation refusals all fired with sentences: frequency 0 and blank both gave "Give the frequency
  as a whole number of months, 1 to 120."; a target kind with no target gave "Choose which one this
  goal is about, or set the target to none."; an empty title gave "Give the goal a title."
- A goal created through the UI landed with `target_type=member`, `freq=6`, and
  **`status = null`** — the cached column is not written on insert. Audit row `goals/goal_created`
  written with the goal id, target type and frequency.
- Mark fulfilled moved Overdue → On track with **no page reload**, and stamped today's date.
  Audit rows `goals/goal_fulfilled` carried both `previousFulfilledAt` and `fulfilledAt`.
  **It takes ~2–2.5 seconds** against the hosted project; the button is disabled meanwhile.
- Calendar, July, desktop: all three reserved regions rendered together on 07-12, 07-19 and 07-26
  — speaker names, the pipeline summary, and three goal alerts. **No clipping** (`scrollHeight`
  equalled `clientHeight` on every cell) and **no horizontal page overflow** (1265/1265).
  Cells grew from the `min-h-40` floor to 282px under their content, which is normal flow —
  `min-h-40` did not have to be changed.
- Calendar, July, 375px: same three regions stacked in the card list, no horizontal scroll
  (360/360).
- Calendar, August: 08-02 and 08-09 showed three alerts; **08-16, 08-23 and 08-30 showed three
  plus "+1 more goal"**. The 80% boundary for "Youth speaker twice a quarter" falls between
  08-09 and 08-16, and the calendar shows it happening.
- `music` (music_coordinator): no Goals link in the sidebar, "Not permitted" page with no goal
  titles in the HTML, `GET /api/goals` → **403**, and **no goal alerts on their calendar** —
  the separate `goals.view` gate on the calendar page works.
- `eqpres` (org_president): reads all **8** ward-wide goals including the bishopric's, creates
  (**201**) and fulfils (**200**). This is what the permission matrix granted and what migration
  019's ward-scoped policy allowed. **Raised as a product question, answered, and fixed** —
  migration 030 scopes goals to their owning organization, and `tests/rls/goal-access.test.ts`
  now proves an org president cannot touch another org's goal or see a ward-level one.

**Corrections made to this checklist during the walk**

1. "Overdue and due-soon goals appear on the July Sunday cells" was **wrong**. Due-soon does not
   appear in July at all, because status is computed as of each Sunday's date and the due-soon
   goal is still on track then. Split into a July check and an August check.
2. The "+N more" check could never fire in July — there are only three alerts. Pointed at
   2026-08-16 or later, where a fourth joins them.
3. Step 11 now says what to compare in August rather than just "compare".

**Left unwalked**

- Both themes were exercised (light on the board and the member pages, dark on the calendar and
  the 375px views) but not every screen in both. No theme-specific defect was seen.
- `refresh_goal_status()` was not invoked. Nothing on this checklist depends on it, and pg_cron is
  not enabled, so it is never running on its own.

## Walkthrough record — second walk, current design

**Walked 2026-08-23 by Claude (agent-driven), through a real browser (Playwright MCP) against the
hosted project.** Not a person using the app. Every write was read back with the service-role
client; every permission answer came from a browser genuinely signed in as that role.

**Two defects found, neither fixed during the walk.** Everything else passed.

### The board

- Order on load, matching the database exactly: three **Overdue** (Ask every adult to pray each
  year / Every quorum presidency speaks once a year / Visit every widow each quarter), one
  **Due soon** (Youth speaker twice a quarter), four **On track**. Alphabetical within bucket.
- The 80% pair landed right for 2026-08-23: 2026-03-15 at ~87% read **Due soon**, 2026-04-09 at
  ~74% read **On track**.
- Never-fulfilled pair: created 2025-01-15 read **Overdue**, created 2026-07-01 read **On track**.
- **All 8 cached `goals.status` values disagreed with the screen.** Compute-on-read proven again.
- Dead household target: "Household — this record no longer exists". `group` target: "Group — this
  record no longer exists". No blank rows, no "undefined", no crash.
- Filters returned member 2, household 2, org 1, group 1, all 8 — every one correct.
- No raw uuid in the rendered text of the board, the calendar, or the Sunday page.

### Creating, editing, fulfilling

- Create form offered **The whole ward / Member / Household / Organization** and **not Group**.
- Refusals, all with sentences: frequency `0` and blank both gave "Give the frequency as a whole
  number of months, 1 to 120."; a target kind with no target gave "Choose which one this goal is
  about, or set the target to none."; an empty title gave "Give the goal a title."
- A goal created by the **bishop** landed with `org_id = null`, **no owner chip**, and
  `status = null` in the column. Audit row `goal_created` carried `orgId: null`.
- Editing frequency 12 -> 2 on "New members speak within six months" recomputed **On track ->
  Overdue** and left `last_fulfilled_at` **unchanged at 2026-06-01**, confirmed in the database.
  The edit form offers title, target kind, target, frequency and notes — and no fulfilment control.
- **Mark fulfilled** moved Overdue -> On track in **2700 ms**, with **no page reload**, re-sorted
  the card from index 1 to index 5, and stamped 2026-08-23. The button is `disabled` while saving.
  Audit row carried both `previousFulfilledAt` and `fulfilledAt`.

### The calendar — the removal held

- July 2026 at **1280px** and at **375px**: **no goal alerts on any cell**, while the speakers
  region ("Slot 3 — open") and the pipeline summary ("1 still planning, 1 awaiting approval") both
  still rendered. No horizontal overflow at either width (360/360 at 375px).

### The banner

- Sunday, July 12: heading **"3 ward goals are overdue"**, explainer **"Worth a look while you are
  choosing speakers for this Sunday."**, three alerts each prefixed **Overdue:**. No on-track goal
  appeared. The banner renders **above** the assignment cards.
- **Dismiss for this month** removed it with no reload and wrote
  `wlt:goal-alerts-dismissed:2026-07 = "1"`.
- Reloading the same Sunday kept it hidden. **July 19 — a different Sunday in the same month —
  also kept it hidden.** A Sunday in **August showed it again**, and with **four** alerts
  (three overdue plus "Due soon: Youth speaker twice a quarter") against July's three, which is the
  as-of-that-Sunday computation visible on screen.
- At 375px on July 12: banner 250px tall, first assignment slot at y=484 against an 800px
  viewport — **not pushed below the fold** — no horizontal overflow, "Dismiss for this month" is a
  44px tap target.
- Dark theme: the banner keeps a real border — `rgb(46,46,46)` on a `rgb(10,10,10)` page, 1.46:1,
  with the panel itself 1.16:1 lighter than the ground. Same `border-border` token every Card uses.

### Ownership

- Bishop's board: owner chips on **exactly** the two Elders Quorum goals, none on the other six.
  Targeted by CSS class, not by text — "Elders Quorum presidency message" contains the org name in
  its TITLE and correctly carries no chip.
- "Every quorum presidency speaks once a year" showed the chip **Elders Quorum** and the target
  line **"Organization: Elders Quorum · every 12 months"** — the two are visibly separate.
- `eqpres` saw **exactly 2 goals**, both Elders Quorum. Created a third through the UI: stamped
  `org_id = 11111111-...-a2` from the session, audit row confirmed. Fulfilled one successfully.
- Signed back in as `bishop`: **9 goals**, including the one `eqpres` created, carrying an Elders
  Quorum chip. Bishopric authority is total (CLAUDE.md §7).
- `music`: no Goals link in the sidebar, "Not permitted" page with **no goal titles in the HTML**,
  `GET /api/goals` -> **403**, **no banner** on a Sunday planning page, **no goal alerts** on the
  calendar.

### DEFECT 1 — the goals page still claims the alerts are on the calendar  [FIXED]

`app/(app)/goals/page.tsx:65` renders:

> "Overdue goals come first, and the overdue and due-soon ones also appear on the calendar."

They do not. They were moved to the Sunday planning page, and this walk confirmed the calendar
carries none. The page tells the user something false, on the very screen the feature lives on.
Reproduction: seed this scenario, sign in as `bishop`, open `/goals`, read the subtitle.

**Fixed the same day**, in the same change that collapsed the banner — the copy now points at the
Sunday planning page, which is where the alerts actually are.

### DEFECT 2 — FEATURES.md still describes the old design  [FIXED]

Two claims went stale when the alerts moved and were not caught in that change:

- `FEATURES.md:153` — "Monthly view showing Sunday type, assignment pipeline status, speaker names,
  and goal alerts"
- `FEATURES.md:423` — "Overdue and due-soon goals surface as alerts on the planning calendar"

`SPEC.md` and `plans/04-talks-pipeline.md` were both updated; `FEATURES.md` was missed. CLAUDE.md §1
says the specs win unless the spec is wrong — here the spec is wrong, because the product decision
changed, so it needs updating rather than obeying.

**Fixed the same day.** Line 153 no longer lists goal alerts among the month view's contents, and
line 423 now describes the dismissible banner and records why the calendar version was withdrawn.

### The two questions this walk raised — both answered and shipped the same day

**"The heading counts overdue goals; the list can be longer."** Answered: **name both numbers.**
`summarizeAlerts()` now produces "3 ward goals are overdue, 1 is due soon", establishing the subject
once rather than repeating it. `tests/lib/goalAlertSummary.test.ts` pins every plural and both
single-kind cases.

**"At 375px the banner is 250px tall before the first speaker slot."** Answered: **collapse it to a
single summary line that expands.** It is now a native `<details>` — 78px collapsed at desktop,
one line at 375px, with the goal titles and the "worth a look" explainer both inside the panel.
Dismiss sits OUTSIDE the toggle, because dismissing is what somebody does instead of reading.
Measured after the change: collapsed 134px at 375px against 250px before, and the first speaker slot
moved from y=484 to y=367.

### Corrections made to this checklist during the walk

1. **Step 13 and the 375px check pointed at August**, which has no seeded assignments — so it could
   never show the banner and the assignment slots together. Both now say to use a July Sunday for
   that, and August only for "the banner is back" and "one more alert".
2. **The empty-title check was unreachable as written.** The client-side target check fires first,
   so with a half-filled target you get "Choose which one this goal is about" and never reach the
   title rule. The check now says to clear the target first.
3. **The heading check said "its heading counts them"**, which is ambiguous once due-soon goals are
   in the list. Reworded to say it counts the overdue ones, and pointed at the open question above.

### Left unwalked

- ~~Whether a dismissed banner flashes before hydration hides it.~~ **SETTLED AND FIXED.** It did:
  measured with a pre-paint `requestAnimationFrame` sampler under CDP CPU throttling at **268 ms**
  (1x), **645 ms** (4x) and **3.8 s** (20x). The dismissal moved from `localStorage` to a cookie so
  the server decides, and the same measurement now reports it never painted at any of the three
  rates, across 3,458 sampled frames. `useSyncExternalStore` and its subscribe plumbing were deleted
  in the process — the component got smaller.
- The scenario's step 14 asks for the Supabase dashboard; the equivalent read was done with the
  service-role client instead.
- **A third instrument error, caught:** measuring whether the collapsed panel's contents were
  hidden, `getBoundingClientRect()` on a descendant of a closed `<details>` returned a non-zero
  height. Chrome uses `content-visibility: hidden` there, and descendants still report intrinsic
  sizes even though nothing renders. The list's OWN rect (0) and `document.body.innerText`
  (excludes it) are the readings that tell the truth.
- Both themes were exercised on the board, the banner and the calendar, but not on every screen.

