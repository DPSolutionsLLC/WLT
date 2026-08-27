---
name: Editing a goal, and who may
scope: visits
part: 2
tags: [visits, full, goals, permissions]
prerequisites: none
---

## Purpose

**There has never been an edit path for a visit goal.** The PATCH route and `updateVisitGoal()`
have both existed since `visits-a`; only the UI was missing. Scenario 040's step 8 worked around it
by creating a *second* goal whose period contained today — the only way to make the dashboard
recompute — which quietly taught wards to stack goals rather than change their minds. ITER-018
part 3 closes that, and this scenario is what proves it: the goal edits **in place**, and no second
goal appears.

**The permission split needs a screen, not a unit test.** ITER-018 Decision 5 put the household
cadence behind `visits.manage_goals` on its own route rather than behind the roster's
`roster.manage`. Two consequences follow that you have to look at to check:

- An org **secretary** holds `visits.view` and `visits.create` and *not* `visits.manage_goals`.
  They must see the goal and the dashboard, find no Edit button and no cadence control on any row,
  and be **told** it is a role boundary rather than left with an absent button.
- An org **president** holds `visits.manage_goals` and *not* `roster.manage`. They must be able to
  set a household's cadence **and** still be refused the roster's own edit controls. If those two
  permissions had been collapsed into one, this would pass in one direction and fail in the other.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Goal — Elders Quorum | **Exactly one.** "Visit every family" — every **1 year**, warning **2 months** ahead |
| Goal — Relief Society | "Visit every sister" — every 6 months, warning 1 month ahead. The bishop's cross-organization target |
| Users | EQ president (Miguel Cortez, `visits.manage_goals`), **EQ secretary** (Peter Nakamura, `visits.view` only), bishop (Mark Andersen), RS president (Ruth Delacroix) |

Four households at distances chosen against **both** cadences, so the edit in step 5 moves the page:

| Household | Last visited | At every 1 year | At every 6 months |
|---|---|---|---|
| Brooks | 20 days ago | On track ~5% | On track ~11% |
| Okonkwo | 150 days ago | On track ~41% | **Approaching ~83%** |
| Halvorsen | 250 days ago | On track ~68% | **Overdue ~138%** |
| Nakamura | never | Never visited | Never visited |

Two rows move, one of them across two bands, and Nakamura stays put as a control against a page
that simply re-randomised on save.

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-046-editing-a-goal-and-who-may`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **EQ president** and go to **Visits**. Note the four bands and the goal list.
4. Open **Visit goal**. There should be exactly one Elders Quorum goal, with an **Edit** button.
5. Press **Edit**, change the cadence from *every 1 year* to *every 6 months*, and save. Watch the
   bands and the statistics above move. Allow the full **~3.7 s** round trip.
6. Press **Edit** again and change the warning window to *1 month*. Watch the Approaching count
   shrink.
7. Press **Edit** again and try to set the warning window to *1 year* against the 6-month cadence.
8. While the editor is open, look at the **Organization** select.
9. On the dashboard, set a household cadence on **Halvorsen**, then go to **/roster** and try to
   edit a household there.
10. Sign out, sign in as the **EQ secretary** (`eq-secretary@harness.wardleadershiptools.test`) and
    look for every control.
11. Sign out, sign in as the **bishop**, switch to **Relief Society**, and edit that goal.

## Verification Checklist

### Machine-checkable

- [ ] The goal **edits in place** — after step 5 there is still exactly **one** Elders Quorum goal
      in the list, with the new cadence on it
- [ ] The goal's summary line reads the cadence and the warning window in words, and shows no
      period dates
- [ ] The dashboard **recomputes after the save without a reload**: Okonkwo moves to Approaching
      and Halvorsen to Overdue
- [ ] Shortening the warning window to 1 month **shrinks the Approaching count** without a reload
- [ ] A warning window **equal to or longer than the cadence is refused**, with a message naming
      the field — and the refusal happens in the form, not only at the server
- [ ] The **Organization select is disabled while editing**, and says why
- [ ] Signed in as the **bishop**, the Organization select is **still disabled while editing** —
      `org_id` is not patchable for anybody
- [ ] The **EQ secretary** sees the goal and the dashboard
- [ ] The EQ secretary sees **"View only — your role does not set goals"** and has **no Edit
      button** and **no cadence control on any row**
- [ ] The **EQ president can set a household cadence** on the dashboard
- [ ] The EQ president gets **"not permitted"** on `/roster` edit controls — the two permissions
      stayed separate
- [ ] The **bishop can edit the Relief Society's goal** and set Relief Society household cadences
- [ ] Every successful edit writes a `visit_goal_updated` row to `audit_log`; every cadence write
      writes `household_visit_cadence_set`
- [ ] No horizontal scrolling at 375px; every button ≥ 44×44

### Needs a human eye

- [ ] Is it obvious that **Edit** changes the existing goal rather than creating another? Does the
      open form read as "editing this one" or as a blank new-goal form?
- [ ] The disabled Organization select — does the sentence beneath it explain *why* in a way that
      stops somebody hunting for the enabled version?
- [ ] The refused warning window: does the message tell the person **what to type instead**, or
      only that they were wrong?
- [ ] For the **EQ secretary**: does the page read as *"this is not your job"* or as *"this page is
      broken for me"*? The absent controls plus the one sentence — is that enough?
- [ ] For the **EQ president** hitting the roster boundary: are the two refusals distinguishable?
      They can set a family's cadence but not edit the family. Does that feel coherent, or
      arbitrary?
- [ ] Watching the bands move after the cadence edit — is the change **legible**, or does the page
      just seem to flicker into a different state?
- [ ] Does the two-number-plus-two-select cadence editor (amount, unit; amount, unit) read easily,
      or is it four controls where a sentence would have been clearer?

## Failure Behavior

- [ ] Covered by `tests/lib/visitValidation.test.ts`: the notice-shorter-than-cadence refusal in
      both the create and the update schema, the per-unit ceilings, and a partial patch being let
      through for the route to re-check
- [ ] Covered by `tests/routes/visits.test.ts`: an org secretary creating a goal gets 403, an org
      president naming another organization gets 403, the bishopric with no `orgId` gets 400
- [ ] Covered by `tests/routes/householdVisitCadence.test.ts`: `org_secretary` gets 403 on the
      cadence route specifically — the assertion that proves it kept `visits.manage_goals` rather
      than the wider `visits.view`
- [ ] The PATCH route re-checks the merged cadence and notice against the stored row, so a partial
      patch cannot make a coherent goal incoherent

## Walkthrough record

**Not yet walked.**
