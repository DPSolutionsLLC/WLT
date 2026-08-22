# ITER-007: `calendar.manage_org_conducting` Is Unreachable by Every Role That Holds It

**Type:** Bug
**Status:** Backlogged
**Created:** 2026-08-22

## Summary

`org_president` and `org_counselor` hold `calendar.manage_org_conducting` — the permission that
exists so an organization's presidency can set who conducts their own meeting on a given Sunday.
They do **not** hold `calendar.view`, and the only UI that exposes that control is the Sunday
detail page, which is gated on `calendar.view`.

The result: the permission cannot be exercised through the app by anybody who has it.

## Context

Found on 2026-08-22 while walking scenario 015 step 13, signed in as `eqpres`.

Verified on the deployed build:

- The navigation shows **no Calendar link at all** for an organization president — only Dashboard,
  Roster, Visits, Goals and Youth Activities.
- Opening `/calendar?month=2027-11` directly renders
  **"Not permitted — The ward calendar is limited to ward leadership."**
- `app/(app)/calendar/page.tsx:58` and `app/(app)/calendar/sunday/[id]/page.tsx:45` both gate on
  `can(user, "calendar.view", roleAccess)`.

## Why it went unnoticed

Two independent reasons, both worth recording:

1. **Scenario 011 was written but never walked.** Its own retro says so
   (`plans/retros/calendar-c-rotation-cadence.md`). Its checklist contains the item "A June Sunday
   detail page has an **Organization meetings** section listing Elders Quorum", to be checked as
   `eqpres` — which would have failed immediately.
2. **`tests/routes/org-conducting.test.ts` passes**, including a case acting as `eqPresident`. It
   calls the route handler directly, so it never crosses the page gate. The API genuinely works;
   only the UI is unreachable. This is the same shape as the `conductingUserId` bug found earlier
   the same day: a test exercising a narrower path than a real user takes.

## Current Behavior

| Role | `calendar.view` | `calendar.manage_org_conducting` | Can reach the control? |
|---|---|---|---|
| bishop / counselor | yes | yes | yes |
| ward_secretary | yes | no | n/a |
| executive_secretary | yes | no | n/a |
| music_coordinator | yes | no | n/a |
| **org_president** | **no** | **yes** | **no** |
| **org_counselor** | **no** | **yes** | **no** |
| org_secretary | no | no | n/a |

`calendar-c`'s plan assumed the pairing worked. It says of the Organization meetings card: "Gate
the whole section on `calendar.view`" — and separately grants `calendar.manage_org_conducting` to
org leadership. Nothing reconciled the two.

## Desired Outcome

An organization president can reach and use the control the permission describes.

## Superseded in part by ITER-001 — read this first

**Do NOT fix this by granting `calendar.view` to organization leadership.** That was the obvious
option when this was written; a conversation on 2026-08-22 ruled it out.

The intended design (ITER-001, refinements section) is that **every role gets a calendar view, and
role decides what is on it** — an Elders Quorum presidency sees *their* conducting, *their* lesson
talk, *their* events, not the bishopric's sacrament meeting planning. A blanket `calendar.view`
grant does the opposite: it hands the EQ president the bishopric's month grid, Sunday types and
notes. It would make this ticket's symptom go away by shipping the wrong product.

So this is a **symptom of ITER-001**, not an independent bug. Two ways to close it:

1. **Fold it into ITER-001** and accept that `calendar.manage_org_conducting` stays unreachable
   until the org calendar lands. Honest, but that permission has already been dead since
   `calendar-c` and ITER-001 is three or four plans.
2. **Ship the smallest org-scoped view now** — "your organization's conducting", listing the
   Sundays that organization's rotation governs and who conducts each, with the same
   `manageableOrgIds()` scoping the route already uses. No bishopric notes, no Sunday types, no
   speakers. This makes the permission live, and it is **not throwaway**: it is the first slice of
   ITER-001's per-organization layer and establishes the org-scoped page shape the rest builds on.

**Recommend option 2**, gated on ITER-001's seam being confirmed at planning time so the page is
built where the org calendar will actually live.

## Scope Notes

The original analysis below stands as the record of what was measured, but the fix direction is
superseded by the section above.

**Adding `calendar.view` to `ORG_LEADERSHIP_PERMISSIONS` was the obvious option and is now
rejected.** It widens what an organization leader sees on a Sunday:

- Sunday type, date and conducting — `calendar-c` already states "who conducts is not sensitive",
  so this part looks uncontroversial.
- **`sundays.notes`** — free text the bishopric writes. This is the one to think about. It is
  rendered on both the month grid and the detail page, and nothing today suggests a bishopric
  writes it expecting six organization presidencies to read it.
- Speaking slots and the Speakers section are **not** a concern: that section is separately gated
  on `talks.view`, which org leadership does not hold.

So the real question is narrower than it first looks: **is `sundays.notes` bishopric-private?** If
yes, the fix is not a blanket `calendar.view` grant — it is either a narrower permission
(`calendar.view_conducting`), or hiding `notes` from anyone without `calendar.manage`, or a
dedicated per-organization page that shows only that organization's Sundays and conductor.

Alternatives worth weighing before picking:

1. **Grant `calendar.view` to org leadership**, and decide separately what happens to `notes`.
   Smallest change; largest exposure question.
2. **A dedicated org-scoped view** — "your organization's conducting", listing Sundays and that
   organization's conductor only. No bishopric notes, no Sunday types. More work; no exposure
   question at all, and arguably the better product.
3. **Drop the permission** and make organization conducting bishopric-only. Cheapest, but it
   discards a deliberate `calendar-c` design decision — the whole point was that a presidency
   decides who conducts its own meeting.

Recommend **option 2** if the notes question resolves as "bishopric-private", option 1 otherwise.

## Related

- **ITER-001** — per-organization calendars. This is a symptom of that gap; see the section above.
- Blocks scenario 015 step 13 as originally written, and scenario 011's organization-leader checks.
  Scenario 015 was amended on 2026-08-22 to verify the organization rows as the bishop instead,
  with a pointer here.
- Touches the permission matrix, so it interacts with ward `role_access` overrides (ITER-005). A
  ward could already grant `calendar.view` to org leadership through an override today — which
  means the ward-level workaround exists while the default does not.

## Open Questions

1. **Is `sundays.notes` bishopric-private?** Everything else follows from this.
2. If a dedicated org view is built, does it belong in Phase 3, or with the organization pages?
3. Should scenario 011's untested organization-leader checklist items be corrected at the same
   time, or does that scenario get re-walked after the fix?
