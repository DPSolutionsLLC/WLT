---
id: role-access-overrides
status: best-yet
commit: 310a708
date: 2026-08-22
area: role-access
related_retros: [role-access-overrides, foundation-c-services, route-tests-and-realtime]
supersedes: null
---

## What was tested

**Scenario 014 walked end to end — but by the agent via Playwright, not by the user.** That is the
single reason this is `best-yet` rather than `confirmed`. Every checklist item was observed against
the real app in a real browser session against the hosted project; none of it was observed by a
human.

The user's own attempt did not complete. It looked like a permissions failure — the member detail
page errored, then hung on render — and was diagnosed as a wedged Turbopack dev server: 77 worker
crashes logged, the earliest at 01:49, nine hours before the scenario was seeded and hitting a
*different* member id. No application error appeared in the dev log at any point. The server was
restarted and the page rendered correctly on the first try. See the retro's Pattern section.

Automated evidence at this commit:

- `tests/routes/role-access-overrides.test.ts` — 9 cases over real route handlers against the
  hosted project, with the client factory as the only mock, so a pass proves RLS allowed the query
- `tests/lib/permissions.test.ts` — 30-odd new cases: delta resolution order, the deny-list looped
  table-driven over `NON_OVERRIDABLE_PERMISSIONS` × `ROLES`, bishopric equivalence under divergent
  deltas asserted across the full `PERMISSIONS` list, per-role malformed granularity
- Full suite: **1003 tests across 68 files**, all passing
- `typecheck`, `lint`, `harness:typecheck` and a production `build` all clean

## Result

**All 8 of scenario 014's Verification Checklist items passed.**

| Check | Evidence |
|---|---|
| Ward secretary sees organization controls | Checkboxes + "Save organizations" rendered |
| The save succeeds | 200, page re-rendered with the new membership |
| `member_organizations` holds the new row | Service-client read: David Nguyen → Elders Quorum |
| An `audit_log` row was written | `member_organizations_updated`, 15:48:02Z |
| Bishop cannot edit a Sunday — controls **absent** | Read-only definition list, no edit control |
| Counselor cannot either, though never named | Identical read-only page |
| Bishop still reaches `/admin/users` | Page loaded fully, all three accounts listed |
| No console errors | 0 error-level messages across five page loads |

**The two that carry the most weight.** The counselor losing `calendar.manage` from an override
that named only the bishop is bishopric equivalence (CLAUDE.md §7) holding in the running app
rather than only in a unit test. And `/admin/users` still loading proves the `admin.*` lock is what
keeps a ward from configuring its own bishopric out of the admin screen.

**The widening case is the sharpest of the eight.** Migration 019 grants INSERT/UPDATE/DELETE on
`member_organizations` to every authenticated member of the ward, so RLS is not a boundary on that
route at all — `assertCan` is the only one. The ward secretary's write succeeding *because of* the
override, and being refused without it, is the whole fix demonstrated on the one route where
getting it wrong would be a hole rather than a cosmetic bug.

## Still open

- **A human has not walked this.** The evidence above is strong but agent-produced; a person has
  not looked at the screens. This is the item that blocks `confirmed`.
- **The `roster.manage` widening was walked; the `calendar.manage` narrowing was only observed.**
  The bishop's Sunday page was confirmed to lack edit controls, but no attempt was made to force
  the write past the missing UI — that path is covered by `tests/routes/role-access-overrides.test.ts`
  case 6 on a different route (`GET /api/sundays`), not on the Sunday editor itself.
- **Nothing writes `role_access` in the app.** The whole feature is reachable only by seeding, so
  every observation here is of a state no user can currently produce. That is by design until
  Phase 11 ships the admin matrix, but it means the delta shape has never survived a round trip
  through a real form.
- **The deployed Vercel build has not been opened.** Pushed at `fe32a94`; production deploy
  untested. Carried forward from the `talks-planner` record, still true.
- **Harness state is dirty.** Scenario 014's ward still holds the walkthrough's write (David Nguyen
  in the Elders Quorum). `npm run seed:clean` clears it before a fresh walk.
