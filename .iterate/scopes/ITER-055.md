# ITER-055: Bishopric Visits — the ward-wide visiting effort

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-28

## Summary
Turn the existing Visits tool into the bishopric's way of running a push to visit every household
in the ward: assign each household to the bishop or a counselor, carry it through their To Do and
appointments, record how each visit went, and keep the goal and its history to look back on.

## Context
Raised by the user (a counselor) 2026-10-28. The bishopric's current goal is to visit everyone in
the ward as soon as they can, and they want to track progress against the ward list, write reports
that are shared among the three of them, and be able to reflect on the history later. The user did
not know Visits already existed — it was built in Phase 7 (visits-a … visits-f, ITER-018/019) but
has not been re-skinned to the prototype and is likely unreleased in Buffalo Ward.

## Current Behavior
- `/visits` (tile "Visits", `visits.view`) lists households from the roster, excluding households
  with no active members; do-not-contact households are shown, marked, and counted in nothing.
- Visits are **organization-scoped**. The Bishopric is one organization; each org has a visit goal
  and sees its own progress. Other roles also hold `visits.view` (org presidents etc.).
- A visit goal is a **rolling cadence only** ("every household once every X"), measured from each
  household's last completed visit — four bands (never visited / overdue / approaching / on track).
  There is no one-time sweep, no finish line, and no record of past goals (one goal per org,
  replaced in place; the old dated-period model was removed deliberately — see CLAUDE.md §9).
- A visit log records participants (users only), completed vs attempted, appointment vs drop-in, a
  shared report, and a private note readable only by its author. Reports appear in the
  return-and-report feed and can be flagged for the bishopric.
- `visit_appointments` exist, but there is no assignment of a household to a leader, no To Do
  link, no companion invite with accept/decline, and no non-user companion.
- The ward's **cross-org visibility** setting widens visit logs, goals and cadences to every
  organization — which would expose the Bishopric's reports to org leaders.
- Household addresses ARE stored (roster paste import).

## Desired Outcome
**Who sees it:** the bishop and both counselors only, in every ward. Bishopric visits stay
bishopric-only regardless of the cross-org visibility setting. (The user may widen this later.)

**Goals**
- A goal is either a **sweep** (visit every household once — a finish line and a progress count)
  or a **repeating cadence** (the existing model), chosen per goal.
- A goal ends as **completed** or **set aside** ("no longer pursued", even if unfinished), and a new
  goal can then be set.
- Past goals stay on record with how they went (dates, how many households reached), so the
  bishopric can look back at any previous goal.

**The flow**
1. **Decide** — the bishopric picks a household and **assigns** it to the bishop or a counselor.
   Households can be divided among the three so nobody doubles up and each has their own list.
2. **To Do** — the assignment lands on the assignee's To Do.
3. **Schedule** — from the to-do they schedule the visit; it lands on their appointments (My
   Appointments). Companions: another bishopric member, or anyone else — **picked from the roster
   when they are a ward member (recorded as that actual member)**, or a typed name if not. A
   companion invite can be accepted or declined (prototype §2.9 #1).
4. **Contact / visit** — tap-to-call the household's phone and log an attempt (no answer / left a
   message / appointment set) in a couple of taps (prototype §2.9 #2); or record the visit with a
   **shared bishopric report** and an optional **private note**.
5. **Outcome** — the household is marked **done**, or **visited but still needs a visit**, with a
   reason marked (e.g. a member of the household wasn't home, spouse absent) and explained in the
   notes. The visit is always recorded either way.
6. **Afterward** — follow-ups from a visit become **to-dos** for whoever takes them, linked back
   to the visit; a report can be marked **"discuss in bishopric meeting"** so it appears on the
   next bishopric agenda.

**Planning an evening:** households can be grouped by **street** (from the stored address) to visit
nearby families together. Not a map.

**History:** every visit, attempt and report stays reviewable later.

## Scope Notes
- This is a modification of a large existing module, not a new one. Read the Visits row in
  `plans/prototype/module-map.md` §2.9 and §6 (navigation shape: sub-view machine) before planning;
  the prototype's Visits screens are authoritative for look and navigation.
- **Too large for one slice.** Natural slices: (a) bishopric-only visibility + re-skin;
  (b) sweep goals + goal history + set-aside; (c) assign → To Do → schedule with companions;
  (d) contact panel + "still needs a visit" outcome with reason; (e) follow-up to-dos + agenda
  hand-off; (f) street grouping.
- "Still needs a visit" reverses part of the current model, where any completed visit satisfies
  the household. Decide how it counts toward sweep progress and the cadence bands.
- Bishopric-only conflicts with the cross-org visibility decision in CLAUDE.md §9 (2026-08-27) and
  with other roles holding `visits.view`. The rule must live in RLS, not the UI (rule 2). Decide
  what other organizations' visit tracking keeps.
- Never-destroy rule: setting a goal aside or replacing it must keep its history.
- To Do writes for another person go through a source-owned service-role writer (P5 pattern —
  cf. `lib/todos/zoomLinks.ts`, `musicLinks.ts`); assignment is person-addressed.
- Non-member companions are typed names; member companions reference the roster member (a member,
  not necessarily a user account) — today participants are users only.
- Visits must be released for the ward (ITER-041 per-ward release) for the bishopric to see it.
- Addresses come from the LCR paste and may be blank for some households; street grouping must
  handle missing or oddly formatted addresses.

## Open Questions
- How does "visited but still needs a visit" count toward sweep progress — not done at all, or a
  separate "partly reached" count?
- Is the reason list fixed (e.g. member not home, spouse absent, asked to come back) or free text?
- Can a household be reassigned, and does the old to-do close or move?
- Does the bishopric keep separate goals per counselor, or one shared ward goal?
- Which agenda does "discuss in bishopric meeting" feed — the next bishopric meeting agenda?
- Should the existing org-level Visits (EQ / RS) stay as is for other organizations?
