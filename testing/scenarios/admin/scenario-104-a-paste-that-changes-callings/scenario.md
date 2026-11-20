---
name: A roster paste that changes callings
scope: admin
part: 1
tags: [callings, roster, import, full, destructive, ITER-058]
prerequisites: Migration 105 applied; Admin released for the Harness Test Ward.
---

## Purpose

ITER-058 slice **cr3**. A pasted ward list can now say that somebody's calling has changed. The
roster's own details still update as they always did, but **an app calling moves only when a person
ticks it** on the paste checklist. Somebody who may import the list but not decide callings is told
changes exist and is shown none of them.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward. `executive_secretary` is granted `roster.import` |
| bishop (Mark Andersen) | Linked; ward list says **Bishop** |
| counselor-1 (Aaron Pike) | Linked; **1st Counselor** in the app and on the stored list |
| counselor-2 (Lena Ortiz) | Linked; **2nd Counselor** in the app and on the stored list |
| ward-clerk (Ruth Kim) | Linked; **Ward Clerk** in the app and on the stored list |
| exec-secretary (Sam Lee) | May import; not bishopric; not on the list |
| Tom Reyes | A member with no account, phone `555-0100` |

### Fixture

`fixtures/paste-swap.txt`, opened in Notepad and copied with Ctrl+A, Ctrl+C. Fake people only. Against
the seed it **swaps the two counselors**, **leaves Ruth Kim off**, and changes Tom Reyes's phone to
`555-0199`.

**Sign in with:** `bishop@`, `counselor-1@`, `exec-secretary@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- admin/scenario-104-a-paste-that-changes-callings`
2. Sign in as **exec-secretary**. Open `/roster/import`, paste the fixture and press **Review changes**.
3. Sign in as **counselor-1** (Aaron). Paste the fixture and review.
4. Sign in as the **bishop**. Paste the fixture and review. Read the checklist without ticking
   anything in the calling groups, then press **Apply**.
5. Open **Admin → Users**.
6. Back on `/roster/import`, choose **Paste again**, paste the fixture and review. Tick both rows under
   **Calling changes** and press **Apply**.
7. Open **Admin → Users**.
8. Paste the fixture again and review. Find Ruth Kim under **No longer listed** and tick her.
9. Press **Apply**.
10. Repeat step 4's review at **375px**, in light and dark.

## Verification Checklist

- [ ] Step 2: the checklist reads *Calling changes are reviewed by the bishopric on Admin → Users.*
      with no calling names and no calling checkbox
- [ ] Step 3: Aaron's own row sits under *Calling changes you can't apply here* with *This is your own
      calling. Another member of the bishopric applies it.* and no checkbox. Lena's row can be ticked
- [ ] Step 4: **Calling changes (2)** lists *Aaron Pike: from 1st Counselor to 2nd Counselor* and *Lena
      Ortiz: from 2nd Counselor to 1st Counselor*. There is **no Calling releases group**: Ruth Kim's
      row under **No longer listed** reads *Ticking this marks them moved out* and *and ends their Ward
      Secretary calling*, with one checkbox. All three are **unticked**. Tom Reyes's phone change under
      **Changed** is ticked
- [ ] Step 4 after Apply: `members.callings` for Aaron reads *Bishopric Second Counselor* and Tom's phone
      is `555-0199`, but Aaron is still `counselor_position = 1` with `source = manual` (read back)
- [ ] Step 5: the Calling review on Admin → Users shows the two counselor rows, still unticked. Ruth Kim
      has no row there, because she was not marked moved out and the stored list still names her
- [ ] Step 6: the result reads *Callings: 2 changes applied*. Aaron is 2nd and Lena 1st, each
      `source = roster`. Two `calling_changed_from_roster` audit rows carry ids and roles and **no
      names**. The other bishopric members are notified (read back)
- [ ] Step 7: Admin → Users shows Aaron as 2nd Counselor and Lena as 1st, with no change waiting for them
- [ ] Step 8: Ruth has one checkbox, and ticking it makes the button read *Apply 1 change*
- [ ] Step 9: Ruth is `moved_out` and her calling has `is_active = false` (read back). Nobody was deleted
- [ ] Step 10 (375px): every group wraps without horizontal overflow, and every checkbox row and button
      is at least 44px tall

## Edge Cases

- A paste with no Callings column changes no calling, a calling id does not count as a stale roster
  item, and a release is tied to its move-out only when this paste leaves the person off:
  `tests/lib/rosterPasteCallings.test.ts`.
- A release ticked without its move-out is counted as out of date, and calling ids from an importer
  outside the bishopric are a 403 that writes nothing: `tests/routes/roster-paste-import.test.ts`.

## Walkthrough record

### 2026-11-19 — driven by Claude (Playwright, local dev server on :3000), five questions awaiting the user

Not yet used by a person. Every write was read back with the service-role client (`.walk104/q.mjs`,
excluded from git). Screenshots: `.walk104/shots/`. Review page:
https://claude.ai/artifact/BsxcArwLm1rANed32SUrFU. The full suite passed beforehand (400 files, 5,813 tests).

Observed:
- Step 2 (exec-secretary): the checklist read *Calling changes are reviewed by the bishopric on Admin →
  Users.*; two checkboxes only (Tom Reyes under Changed, Ruth Kim under No longer listed). The preview
  response carried `callingChanges: { rows: [], reviewedByBishopric: true }`.
- Step 3 (Aaron): *Calling changes (1)* held Lena's row; *Calling changes you can't apply here (1)* held
  *Aaron Pike: from 1st Counselor to 2nd Counselor.* with *This is your own calling…* and no checkbox.
- Step 4 (bishop): Calling changes (2), Calling releases (1) with *Ticking this also marks them moved
  out*, all unticked; Tom's phone ticked. After Apply: Aaron's `members.callings` *Bishopric Second
  Counselor*, Tom `555-0199`, Aaron still position 1 / `manual`, Lena 2 / `manual`. One `roster_imported`
  audit row (`membersUpdated: 4`, `silentFieldUpdates: 4`).
- Step 5: Admin → Users *Calling review (2)* — the two counselor rows, unticked; no row for Ruth.
- Step 6: *Callings: 2 changes applied*. Read back Aaron 2 / Lena 1, both `source = roster`. Two
  `calling_changed_from_roster` rows (ids, roles, positions, no names). Aaron and Lena notified *Mark
  Andersen applied 2 calling changes from the ward list: Aaron Pike: 2nd Counselor; Lena Ortiz: 1st
  Counselor.*
- Step 7: Lena *1st Counselor · From the ward list*, Aaron *2nd Counselor · From the ward list*; no
  Calling review section left.
- Step 8: Calling releases' Tick all disabled (No longer listed's enabled). Ticking Ruth's release ticked
  her move-out (button *Apply 2 changes*); unticking the move-out cleared both.
- Step 9: Ruth `moved_out`; her calling `is_active = false`, `ended_on = 2026-11-19`; audit
  `calling_changed_from_roster` with `rowKind: release`; 5 member rows (nobody deleted).
- Step 10 (re-seeded first, since step 9 left no calling rows): bishop and Aaron at 375px, light and
  dark — `scrollWidth` 375 every time, no element past the right edge, no button, summary or checkbox
  row under 44px.

No defects. One console error on Admin → Users, the known `UserRow` "missing key" warning (103b).
Checklist corrections: none needed this walk (steps 5 and 7 had been corrected while writing it).
Not walked here: the Edge Cases (Vitest suites, passing).

**The user's answers (2026-11-19):**
1. *Ward Secretary* vs *Ward Clerk*: the app should match the roster. **Deferred to its own change**:
   `ROLE_LABELS.ward_secretary` is read app-wide, so it becomes *Ward Clerk* everywhere, after cr3.
2. Ruth twice with linked ticks: it read as two separate things. **Fixed (defect 104-D1):** the release now
   sits inside her *No longer listed* row (*and ends their Ward Secretary calling*), one checkbox, counted
   as one change; *Calling releases* lists only people still on the list. Steps 4, 8 and 9 rewritten.
3. Aaron's own row at phone width in dark: fine.
4. The executive secretary's one sentence: fine as is.
5. *Callings: N changes applied* without names: fine, because the audit row records who applied it
   (`user_id`) and whose calling changed (`targetUserId`).

**Re-walk of 104-D1 (re-seeded):** the bishop's review had no Calling releases group; Ruth's row read
*Ticking this marks them moved out* / *and ends their Ward Secretary calling* with one checkbox; ticking
it moved the button from *Apply 1 change* to *Apply 2 changes* (Tom's phone plus Ruth). After Apply:
*Callings: 1 change applied*; Ruth `moved_out`, calling `is_active = false`; the counselors untouched
(`manual`, 1 and 2); the audit release row carries Mark Andersen's id. Seen in passing: `ended_on` read
`2026-11-20` at 01:13 UTC, the ward's evening of 11-19 (the `endCalling` UTC-date gap, outside cr3).
