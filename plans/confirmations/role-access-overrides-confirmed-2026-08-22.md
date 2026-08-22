---
id: role-access-overrides-walked
status: confirmed
commit: 8e5bff6
date: 2026-08-22
area: role-access
related_retros: [role-access-overrides, foundation-c-services, route-tests-and-realtime]
supersedes: role-access-overrides
---

## What was tested

**Scenario 014 walked end to end by the user**, against the hosted project. All ten Verification
Checklist items passed. This is what the superseded record was missing: that record held at
`best-yet` for one reason only — the walkthrough had been agent-driven via Playwright and no human
had looked at the screens.

The user's walk found something the agent's did not. Step 5 said "open the calendar", which lands
on the current month; the seed creates June 2027, so the bishop saw **0 Sundays** and an empty
month. That read as a failure and was not one — the calendar generates a missing month only for
someone holding `calendar.manage` (`app/(app)/calendar/page.tsx:82`), because generation is a
write and a read-only viewer silently writing would be a surprise. The override removes
`calendar.manage` from the bishop, so the month correctly stays empty.

The agent's walkthrough had missed this entirely by navigating straight to the Sunday detail URL
and never opening `/calendar` as the bishop. Fixed in `8e5bff6`: steps 5 and 7 now name
`/calendar?month=2027-06` explicitly, following the convention scenario 011 already used, and the
generation behaviour was promoted to two checklist items — the scenario went from 8 checks to 10.

## Result

**Confirmed working.** The ward's `role_access` override reaches every permission check in the app.

| Check | Result |
|---|---|
| Ward secretary sees organization controls | ✅ |
| The save succeeds and shows him in the Elders Quorum | ✅ |
| `member_organizations` holds the new row | ✅ |
| `audit_log` row written (`member_organizations_updated`) | ✅ |
| `/calendar` shows "0 Sundays" and does **not** generate | ✅ |
| `/calendar?month=2027-06` shows all four seeded Sundays | ✅ |
| Bishop cannot edit a Sunday — controls **absent** | ✅ |
| Counselor cannot either, though never named | ✅ |
| Bishop still reaches `/admin/users` | ✅ |
| No console errors | ✅ |

**The three that carry the most weight.** Bishopric equivalence held in the running app — the
counselor lost `calendar.manage` from an override naming only the bishop (CLAUDE.md §7).
`/admin/users` still loaded, so a ward cannot configure its own bishopric out of the admin screen.
And the ward secretary's write succeeded on `member_organizations`, the one route where migration
019 grants the write to every member of the ward, so `assertCan` is the entire boundary.

Automated evidence at this commit: `tests/routes/role-access-overrides.test.ts` (9 cases over real
handlers), 30-odd new unit cases including the deny-list looped over
`NON_OVERRIDABLE_PERMISSIONS` × `ROLES`, and a full suite of **1003 tests across 68 files**.
`typecheck`, `lint`, `harness:typecheck` and a production `build` all clean.

**This is the baseline.** If role access regresses later, this commit and this scenario are the
known-good reference.

## Still open

Neither blocks this confirmation; both are carried forward.

- **The deployed Vercel build has not been opened.** Pushed through `fe32a94`; production deploy
  untested. Shared with the `talks-planner` record, where it has been open since 2026-08-21.
- **Nothing in the app writes `role_access`.** Every observation here is of a state reachable only
  by seeding, so the delta shape has never round-tripped through a real form. By design until
  Phase 11 ships the admin matrix — but that screen is the first thing that will exercise the
  write path, and it should be treated as unproven until it does.
- **A cosmetic wording bug surfaced.** The empty-month card reads "A member of the bishopric or
  the ward secretary can create it by opening this month" — which the bishop reading it just
  failed to do. The copy assumes the default matrix. Recorded in the scenario's Notes; worth
  settling when Phase 11 builds the matrix screen, alongside every other message that names a role
  rather than a permission.
