# P9 — Callings · Ministering · Calling Requests

**Depends on:** P5 (To Do). **Size:** Large. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** [prototype/module-map.md](prototype/module-map.md), and build-notes-raw.md §`callings`, §`ministering`, §`requests`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

Two scenario sandboxes and the request pipeline that feeds them.

## The shared mechanism

Both sandboxes are **an event log replayed on top of a real compiled baseline**, never mutating
real data. Undo and reset operate on the log itself. Build the engine once; the prototype built
Callings first and then deliberately reused its pattern for Ministering.

## Callings

Scenario branching and parking, a "From the Agenda" queue, draft→active promotion, and a
two-confirmation removal (a second bishopric member confirms). Parent/child scenario lineage.

## Ministering

Compiles a graph from the LCR export's **free-text "who ministers to me" field** — the reverse
view is genuinely compilable because those names use the same "Lastname, Firstname" form as the
member's own name field, **verified across the real 357-member roster**, not assumed.
Unresolvable names are flagged explicitly, never silently dropped.

Four described move types collapse to **three primitives**: reassign a recipient, restructure a
companionship, move a recipient between the EQ and RS programs.

**Confirmed separate from Visits** — the formal ministering program is not a quorum's own visit
goal. The naming still collides (the Visits tile blurb says "Ministering & check-ins"); settle it.

## Calling Requests

Non-bishopric leaders submit fill or release requests. A release is strictly about the release; a
refill spins off a **separate linked request** rather than one combined record.

Pipeline: `submitted` → `under_review` → `pending_response` → `awaiting_meeting` → `resolved`.
Resolution happens through the **Conducting Sheet's post-meeting confirmation** (P6), not a
bespoke mechanism — so P6 lands first or this ships without its last transition.
