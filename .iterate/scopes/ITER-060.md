# ITER-060: Callings sandbox on the real roster

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-11-11

## Summary
Bring the prototype's Callings sandbox into the app, looking and working exactly as the user built
it, but starting from the real ward roster and every member's real callings instead of mock data.
A planning tool only: nothing in it changes anyone's real calling.

## Context
The user (2nd counselor) built the Callings sandbox extensively in the prototype and has it
"working pretty much exactly the way I want it to". The bishopric has a couple of significant
calling changes coming up and wants to play out ideas on the real ward now, before any of the
pipelines that would carry a plan out exist. The prototype's own build note says its mock
`CALLINGS` / `BASELINE_MEMBERS` "need to be replaced by the real roster once that module exists" —
the roster now exists (ITER-040's paste import).

## Desired Outcome
- A bishopric member opens the sandbox and sees the real ward: every active roster member with the
  callings LCR had at the **last roster paste**. That baseline is treated as current; it is not
  edited in the app.
- The sandbox works as the prototype's does today — its look, its navigation and its interactions
  (Step 1 pairing of callings and people, scenarios as an event log replayed over the baseline,
  undo/redo, reset, branches parked as alternate timelines with parent/child lineage, the
  Scenarios browser, "Sandbox home", the per-card counts of scenarios involving a person or calling).
- **Bishopric only:** the bishop and both counselors. Nobody else can open it or read its data.
- **Each bishopric member has their own sandbox**, and can **send a scenario to the other two**.
- Nothing in the sandbox ever changes a real calling, a permission, the roster or another module.
- Done when: the user can play out the upcoming real calling changes on the real ward, as they
  could in the prototype, and a second bishopric member can receive a scenario they sent.

## Scope Notes
- The prototype (`prototype/WLT.jsx`, the Callings component) is the authority for look AND flow
  (CLAUDE.md §12, module-map §6). Planning must open the component itself and add its navigation
  shape to module-map §6 if missing; the build note in `build-notes-raw.md §callings` is a summary,
  not the full behaviour. Module-map row: "Callings (sandbox) — NEW — scenario engine with branching".
- The baseline comes from the stored LCR calling text on each member (`members.callings`, stored by
  every paste and read by nothing today). The LCR wording must be turned into calling ↔ person pairs
  — overlaps with ITER-058's LCR-calling-string mapping; one mapping, not two.
- Calling deliberations are confidential: enforce bishopric-only with RLS, not only in the UI.
  Scenarios sent between members must stay inside the bishopric.
- A ward has ~357 members — the sandbox must stay usable on a phone with the real roster size.
- **Left out of this version** (held for later, see Deferred "Carry out a sandbox calling plan"):
  the prototype's "From the Agenda" queue and sending a scenario to the agenda (the user is holding
  agenda work), Calling Requests as a source, starting/carrying out a plan, and auto-filing finished
  scenarios into a history.
- P9 (`plans/P9-sandboxes-and-requests.md`) is the phase home; it says to build the event-log
  engine once so the Ministering sandbox can reuse it later.
- Related: ITER-058 (the roster decides app callings) is separate and comes first in priority; this
  item reads the roster's calling text and does not depend on logins being linked.

## Open Questions
- How a member who moves out (or a calling that disappears) between pastes affects saved scenarios
  that involved them.
- Whether "send to another bishopric member" is a copy they own or a shared scenario both can edit
  (check what the prototype does).
- What the sandbox shows for LCR callings it cannot map to a known calling.
