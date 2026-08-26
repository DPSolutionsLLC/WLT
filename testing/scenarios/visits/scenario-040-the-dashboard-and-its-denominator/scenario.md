---
name: The dashboard and its denominator
scope: visits
part: 1
tags: [visits, smoke, dashboard]
prerequisites: none
---

## Purpose

Two things on this page are only real on a screen.

**The denominator is smaller than the ward.** `listHouseholds()` filters the members it *attaches*,
not the households it *returns*, so a household whose people have all moved out comes back present
with an empty member list. Counting it makes every organization look permanently behind, and a
progress number a ward stops trusting is worse than no number. Two households here are emptied —
one by `moved_out`, one by `do_not_contact` — and neither may appear in the count or the list.

**Every status boundary needs a household at a precise distance from a precise goal start.** That
is unreasonable to arrange by hand and it is exactly what the numbers on this page depend on. Six
visitable households sit at six known distances, one per status, so the page can be read against
what it should say rather than against what it does say.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility OFF |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), EQ secretary (Peter Nakamura), RS president (Ruth Delacroix) |
| Goal | **Elders Quorum only** — every household, annual, period started 10 months ago |
| Goal | **Relief Society — none.** Switching to it must say so |
| Brooks | visited 30 days ago, two people went → **Visited** |
| Whitfield | visited 95 days ago, **nobody recorded as going** → **Visited** |
| Okonkwo | visited 300 days ago — 82% of the cadence → **Due soon**, and still counted as visited |
| Halvorsen | visited 396 days ago — 13 months, **before the period** → **Overdue** |
| Ferreira | two attempts, no completed visit ever → **Attempted, never reached** |
| Nakamura | no visit of any kind → **Not yet visited** |
| Delgado | both members `moved_out` → **must not appear** |
| Sorensen | its only member `do_not_contact` → **must not appear** |

Every visit is recorded by the **secretary** and none of them was made by the secretary. A
"Conducted by" column that fell back to the recorder would name Peter Nakamura on all four.

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-040-the-dashboard-and-its-denominator`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the EQ president and go to **Visits**. Read the banner before anything else.
4. Read down the household list. Six rows, six statuses.
5. Sort by **each** column in turn, both directions.
6. Narrow the window to 375px and read the same six households again.
7. Switch the theme to dark and look at the status pills.
8. Open **Visit goal** and press **Set a goal**. Add a second Elders Quorum goal — cadence
   *Twice a year*, period `2026-08-01` to `2027-07-31` — and save. Watch the banner and the
   statuses above it. (There is no way to EDIT an existing goal; visits-a only built a create
   form. Adding a goal whose period contains today is how the dashboard is made to recompute.)
9. Sign out, sign in as the **bishop**, and switch the organization to Relief Society.
10. Sign out, sign in as the **RS president** (`rs-president@harness.wardleadershiptools.test`).

## Verification Checklist

### Machine-checkable

- [ ] The banner reads **"3 of 6 households visited — 3 remaining"** — not 8, and not 6 of 8
- [ ] Delgado and Sorensen appear **nowhere** on the page: not in the list, not in the count
- [ ] `select count(*) from households where ward_id = '111…111'` returns **8**, so the two
      missing ones are being excluded rather than absent
- [ ] All five statuses are on screen: Brooks and Whitfield **Visited**, Okonkwo **Due soon**,
      Halvorsen **Overdue**, Ferreira **Attempted, never reached**, Nakamura **Not yet visited**
- [ ] Okonkwo reads **Due soon** and is still one of the three counted as visited
- [ ] Ferreira's **Visits this period** is **0** and its **Last attempted** shows a date
- [ ] Ferreira is counted in the **remaining**, not in the visited
- [ ] Halvorsen's **Last visited** shows a **year**, and it is a different year from the others
- [ ] Whitfield's **Conducted by** reads **"Nobody recorded"** — never "Peter Nakamura"
- [ ] Brooks' **Conducted by** names Miguel Cortez **and** Sister Alvarez
- [ ] Sorting by **Status** groups the statuses rather than scrambling them, and opens on Overdue
- [ ] Sorting by **Last visited** puts Nakamura (never visited) at the **same end** in both
      directions
- [ ] Saving the new *Twice a year* goal moves the statuses **and** the banner without a page
      reload
- [ ] Logging a visit from **Log a visit** moves the banner and that household's row without a
      page reload
- [ ] Signed in as the bishop, the **organization switcher is present**; as the EQ president it
      is **absent**
- [ ] With Relief Society selected, the page says **no goal is set** and shows **no denominator**
- [ ] The RS president sees the **Relief Society** dashboard, never the Elders Quorum one
- [ ] **Log a visit** still works: the form is there, one section down, and saving a visit still
      records it
- [ ] No horizontal scrolling at 375px; every button ≥ 44×44

### Needs a human eye

- [ ] Is the banner the first thing you read, and does "3 of 6" land as a fact rather than as
      something you have to reconstruct from the table under it?
- [ ] Would a leader looking at Okonkwo understand that it is **both** visited and due again? Or
      does "Due soon" beside a count of 1 read as a contradiction?
- [ ] **Attempted, never reached** — does it read as a household somebody is failing to catch at
      home, or does it read as an error? Is it obviously different from **Not yet visited**?
- [ ] In dark mode, are the five pills distinguishable — and are they still distinguishable with
      colour ignored entirely? (Cover the colour: `✓ ◑ ! ✕ ○` plus the words.)
- [ ] At 375px, is the stacked card readable, or is it a wall of labels? Is the sort control
      findable without the table header?
- [ ] The four action panels are collapsed under the dashboard. Does that read as "the page is
      the progress and the rest is available", or does it read as things being hidden from you?
- [ ] Does "Nobody recorded" read as a fact about the visit, or as data that failed to load?

## Failure Behavior

- [ ] An organization with no goal shows a sentence and no number — never "0 of 0"
- [ ] Covered by automated tests rather than by hand (`tests/routes/visitsProgress.test.ts`): an
      org leader passing another organization's `orgId` gets **their own** dashboard back rather
      than an empty one, the bishopric with no `orgId` is **asked which**, and a role without
      `visits.view` gets 403
- [ ] Covered by `tests/lib/visitProgress.test.ts`: the moved-out and do-not-contact exclusions,
      and `remaining === total - visitedCount` on every shape
- [ ] Covered by `tests/lib/householdStatus.test.ts`: every status boundary, built from the
      arithmetic rather than guessed at

## Walkthrough record

**2026-08-26 — driven by Claude in a real browser (Playwright), signed in as the EQ president,
the bishop and the RS president in turn.** Screenshots reviewed by the user separately. This is
agent-driven evidence, not a person using the app.

Note on setup: a dev server from an earlier session was already holding port 3000 and predated
this slice's code. It was killed and restarted before anything below was observed — a walk
against a stale server proves nothing.

### Observed

- **The denominator holds, and it is the central claim.** The banner read
  **"3 of 6 households visited — 3 remaining"**. A service-client scan found **8 household rows**
  in the ward: Delgado (2 members, both `moved_out`, 0 active) and Sorensen (1 member,
  `do_not_contact`, 0 active) were absent from the list, from the count, **and** from the
  household picker in the log form — the same six in both places, which is what stops the two
  numbers drifting.
- **All five statuses rendered on one screen**, each on the household seeded for it:
  Halvorsen `! Overdue` (Jul 26, 2025), Ferreira `✕ Attempted, never reached`,
  Okonkwo `◑ Due soon` (Oct 30, 2025), Nakamura `○ Not yet visited`,
  Brooks and Whitfield `✓ Visited`.
- **The year is on the dates.** Halvorsen read *Jul 26, 2025* against Brooks' *Jul 27, 2026* —
  one day apart in the month, a year apart in fact, and the column says so.
- **Okonkwo is due soon AND counted.** `Visits this period = 1`, status `Due soon`, and it is one
  of the three in the banner. This is the deviation recorded in `lib/visits/progress.ts` behaving
  as intended.
- **"Conducted by" never fell back to the recorder.** Every seeded visit was recorded by the
  secretary (Peter Nakamura) and his name appears on none of them. Whitfield read
  **"Nobody recorded"**; Brooks read **"Miguel Cortez and Sister Alvarez, ministering"**.
- **Sorting.** By status, ascending gave `Overdue → Attempted → Due soon → Not yet → Visited` and
  descending gave the exact reverse — grouped by rank, not scrambled alphabetically. By last
  visited, the dates reversed while Ferreira and Nakamura (both `—`) **stayed at the same end**
  in both directions.
- **A new goal recomputed the dashboard with no reload.** Saving an Elders Quorum goal at
  *Twice a year* (2026-08-01 to 2027-07-31) moved the banner to `0 of 6`, flipped Okonkwo from
  Due soon to Overdue, and changed the banner subtitle to the new goal's title.
- **The write path still works and was read back from the database, not the screen.** Logging a
  visit for Nakamura wrote `visit_logs` (`2026-08-26`, `completed`, `drop_in`, shared note
  intact, `org_id` = Elders Quorum), one `visit_participants` row naming Miguel Cortez, and one
  `visit_logged` audit row.
- **Collapsing does not discard a draft.** Typed 44 characters into the shared-notes box,
  collapsed the section (`hidden=true`), re-expanded: the text was byte-identical. The `hidden`
  approach in `CollapsibleSection` does what its header claims.
- **"Recent visits" survived, with flagging intact.** 7 visits listed and a
  **"Flag for ward council"** control on each — the reason that panel was kept rather than
  replaced.
- **Role scoping.** The bishop got the organization switcher and could read Elders Quorum
  (`3 of 6`) and Relief Society (no goal); the EQ president and the RS president got **no**
  switcher, and the RS president saw only Relief Society.
- **375px:** 0px horizontal overflow, **zero** tap targets under 44×44, the table swapped to six
  stacked cards, the sort control survived the collapse, and no raw uuid appeared on screen.
- **Greyscale:** the five pills stayed separable with colour removed entirely — `! ✕ ◑ ✓ ○` plus
  the word in every case.

### Defects found

1. **Logging a visit leaves the dashboard stale.** Log a visit for Nakamura: the row still reads
   `○ Not yet visited`, `Last visited —`, `Visits this period 0`, and the banner still says
   `3 of 6`. The database already holds the visit. A page reload shows `4 of 6` and
   `✓ Visited · Aug 26, 2026 · 1`, which isolates it to the client cache rather than the write.

   Root cause: `VisitLogForm` calls `router.refresh()`, which re-renders the Server Component —
   but `VisitProgressTable`'s TanStack query holds cached data and `initialData` is consulted
   only on first mount, so the fresh server payload is ignored. `VisitGoalPanel` was wired to
   invalidate `VISIT_PROGRESS_QUERY_KEY` for exactly this reason; the log form was not. This is
   the same stale-form trap `plans/retros/ai-a-client-and-settings.md` records for
   `router.refresh()`, arriving one component along.

2. **The bishopric lands on an organization that has no visit goals.** `initialOrgId` is
   `organizationOptions[0]?.id`, which resolves to **Bishopric** — so a bishop opening `/visits`
   reads *"No visit goal is set for this organization"* and has to know to switch to Elders
   Quorum. The message is honest; the default is wrong. The bishopric is the one organization
   that will essentially never carry household visit goals.

3. **A row can read `✓ Visited` while the banner counts it as not visited.** After the
   *Twice a year* goal above (period starting 2026-08-01), Brooks and Whitfield both showed
   `✓ Visited` with `Visits this period = 0` above a banner reading **"0 of 6 households visited
   — 6 remaining"**. Both halves are individually defensible — the status is anchored on the last
   completed visit against the cadence, the count is scoped to the goal period — but they
   contradict each other on screen, and this happens at the start of **every** new goal period.
   Raised as a design question rather than a bug; it needs a decision, not a patch.

### Checklist corrections

- **Step 8 described a control that does not exist.** It said to *change* the cadence on the
  existing goal and save. `VisitGoalPanel` (from visits-a) only offers **"Set a goal"** — there
  is no edit path for a visit goal anywhere in the app. Rewritten to create a second goal whose
  period contains today, which exercises the same recompute and is reachable.
- **Added a check for logging a visit updating the dashboard**, which nothing covered. It is the
  check Defect 1 fails, and its absence is why the plan's checklist would have passed while the
  page's headline number went stale on the most common action a leader performs.

### Fixed and re-walked, same day

D1 and D2 fixed and proven in the browser again. D3 was NOT patched — see below.

- **D1 fixed.** `VisitLogForm` now invalidates `VISIT_PROGRESS_QUERY_KEY` alongside its
  `router.refresh()`, the same pairing `VisitGoalPanel` already had.
  **Re-walked without reloading at any point:** logging a visit for Halvorsen moved the banner
  from `3 of 6 households visited — 3 remaining` to `4 of 6 … — 2 remaining` and flipped that row
  from `! Overdue` to `✓ Visited · Aug 26, 2026 · 1`.

  **It takes ~3.7 s**, measured by polling the banner rather than guessing — the POST plus a
  three-query re-read, all over the network to the hosted project on a dev server. An earlier
  probe of this same fix waited only 3 s and reported it still broken; the network request had
  already returned the correct payload. Worth knowing before anybody "fixes" it a second time:
  **a short wait here reads exactly like a stale cache.**

- **D2 fixed.** The bishopric now lands on the first organization that actually HAS a goal, not
  `organizationOptions[0]`. **Re-walked:** the bishop opens `/visits` on **Elders Quorum** with
  `3 of 6 households visited — 3 remaining`, instead of on Bishopric with "No visit goal is set".

- **D3 was not patched, deliberately.** Reviewing it, the user's conclusion was that the
  `Visited` badge should not exist at all — *"visited doesn't really provide any real value. what
  is most valuable is knowing how close to being due it is"* — which makes this a redesign of the
  goal model rather than a choice between the banner and the badge. Captured as **ITER-018**
  (`.iterate/scopes/ITER-018.md`): rolling cadences with no dates, cadence in days/weeks/months/
  years, editable goals, a per-household cadence override, a priority scale in place of the five
  buckets, a statistics banner, and household-level do-not-contact. **The contradiction this
  scenario found is still present in the shipped code** and is expected to be dissolved by that
  work rather than fixed here.

- **Attempt counts added** from the same review: the last-attempted column now renders
  `Aug 14, 2026 (2)` — the number of attempts since anyone last got in, so one knock and a
  standing pattern of them stop rendering identically. Suppressed at a count of 1, where the
  number would say nothing. **Re-walked:** Ferreira reads `Aug 14, 2026 (2)`.

- **Mobile card contrast raised** from the same review — the stacked cards were `bg-surface` on a
  `bg-surface-raised` Card, which is barely a step; they now carry a ring and shadow.

### Left unwalked

- **Sorting by Last attempted, Visits this period and Conducted by** were not each exercised in
  both directions. Household, Last visited and Status were, and all six share one `sortRows()`
  code path whose null-handling and tie-break are covered by the sort assertions above.
- **The `?appointment=` prefill through the new collapsible** was not re-walked: this seed books
  no appointments, and visits-d's scenario 044 covers that flow. The section's `defaultOpen`
  wiring for it is therefore **unproven in a browser** — worth a check when 044 is next walked.

## Notes

- **The seed dates are RELATIVE to today, unlike scenario 044's.** That is deliberate and the
  reason is in the seed file's header: "missed" is a monotone property and survives pinning, but
  "due soon" is a *window* — a household pinned into it in August has walked out of it by
  November. The checklist names statuses rather than dates for the same reason.
- The banner reads **3 of 6**, where the plan for this slice wrote 3 of 5. A sixth visitable
  household was added for `attempted_never_reached`, which is the state this whole feature makes
  visible and which the plan's household list predates. The denominator assertion is unchanged in
  substance: six, not eight.
- **"X of Y visited" means visited THIS PERIOD**, which is not the same set as "rows whose status
  is Visited". Okonkwo is due soon and has still been visited. The deviation is recorded in
  `lib/visits/progress.ts`.
- Steps 8 and the log-a-visit check both change what the rest of this scenario expects. Seed
  again before re-reading the checklist.
