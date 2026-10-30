# ITER-058: The ward roster decides who holds which calling

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-30

## Summary
Make the LCR roster the source of truth for every app user's calling. Link each login to their
roster record once, derive their role (and counselor number) from their LCR calling, and put
calling changes from a new roster paste on the review checklist before they apply.

## Context
Raised by the user (2nd counselor) 2026-10-29 on the Zoom Remote links tab: it shows them as
**1st Counselor** and nobody as 2nd. The roster says they are the 2nd Counselor and Chris Haskell
is the 1st. The user expects the roster to drive this "at all times", updating when callings change.
The user chose NOT to hand-correct the number in the meantime — it is fixed by this item.

## Current Behavior
- Two unconnected records of callings exist:
  1. **The roster** (`members`): every LCR paste stores each member's callings as text
     (`callings`, `callings_sustained`, `callings_set_apart`, migration 090) — "silent", stored and
     never read by anything.
  2. **App callings** (`ward_role_assignments`, migrations 068–071): role + org + counselor
     position per user per ward, set at invite and on Admin → Users. This is what RLS
     (`current_user_role()`, `is_bishopric()` …), `can()`, notifications, the Planner's identity
     (`settings/bishopric` mapping) and Zoom remote links (`positionForCalling(role,
     counselorPosition)`) all read.
- The user's app calling carries `counselor_position = 1`, most likely from account setup; there is
  no screen that changes a counselor's number (open gap noted at ITER-051).
- App accounts and roster members are unrelated rows — no `users.member_id` or equivalent (noted in
  CLAUDE.md §9 for youth follow-ups).

## Desired Outcome
- **Everywhere:** a user's role in a ward (permissions, RLS, Planner identity, notifications, Zoom
  positions) follows their LCR calling on that ward's roster. Admin → Users no longer sets roles.
- **Linking login ↔ roster person, once per account:**
  - *New accounts:* the bishopric member sending the invite chooses the roster person; the invitee
    confirms "Yes, this is me" when creating the account. The invitee never picks a record.
  - *Existing accounts:* a one-time "Is this you?" — a roster email matching the login email links
    on their yes; anything else waits for an admin's approval.
- **Calling changes are reviewed, never automatic:** a roster paste that changes a calling (swap,
  release, new call) shows it on the paste review checklist; it applies only when ticked. A release
  removes access, so it is always deliberate.
- **New holder without an account:** the review says e.g. "Sister X is now Ward Clerk — no account
  yet" with an **Invite** button, the invite pre-tied to her roster record.
- Done when: once linked and reviewed, Remote links shows the user as 2nd Counselor and Chris
  Haskell as 1st; after a paste swapping them is ticked, both the app and the Planner follow.

## Scope Notes
- Large and security-sensitive: it moves the source of every permission decision. Standalone work;
  likely several slices (link table + linking flow; calling mapping; review checklist; invite tie-in;
  retiring role editing on Admin → Users).
- The link decides privileges, so a wrong link is a privilege escalation — the linking rules above
  are the guard. Enforce where the link is written (server-side), not just in the UI.
- Map LCR calling wording to app roles: bishop, counselors (1st/2nd → `counselor_position`),
  ward clerk/assistant clerks, executive secretary, org presidents/counselors/secretaries, music
  coordinator, ward council. Callings with no app role grant nothing. Assistant clerks are not
  modelled today (ITER-051 note).
- One active calling per ward per user (partial unique index). LCR people can hold several callings
  — a precedence rule is needed.
- Roles that are not LCR callings stay as they are: `super_admin` (`unit_assignments`), the youth
  PIN `sacrament_manager`, `resource_center_specialist`, stake roles.
- Preserve existing guards: the last bishop / last active super admin cannot be removed; bishop and
  counselors stay identical in admin rights; `updateCalling()` / `endCalling()` remain the only
  changers of an existing calling (they retire Zoom remote links).
- Multi-ward: a person can hold callings in several wards — each ward's roster governs only that
  ward.
- The Planner identifies people by calling label; records saved under a wrong label may need a
  check once identities are corrected.
- Related: ITER-040's deferred "three-way review" needed a stored callings snapshot — this may
  provide it. The roster paste import (`buildRosterDiff()`) is where review rows come from.

## Open Questions
- Exact LCR calling strings and how robustly to match them (LCR wording changes).
- What happens to an account whose roster record moves out or disappears.
- Whether an admin can still override a derived role in an emergency, and how that is reviewed.
- Rollout: existing accounts keep their current role until linked, or lose it?
