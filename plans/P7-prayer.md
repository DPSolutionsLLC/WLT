# P7 — Prayer Roll & Prayer Items

**Depends on:** P4 (Agendas, for the Prayer Roll section). **Size:** Medium. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** [prototype/module-map.md](prototype/module-map.md) §2.7, and build-notes-raw.md §`prayer-roll`, §`prayer-items`, §`agendas-status-field`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

## Prayer Roll

Three tiers — `stewardship` / `quiet` / `one_time` — each with its own expiry rule. **Hard delete
on expiry with no history**, but **private notes persist independently** so they resurface if the
person cycles back onto the roll. That asymmetry is the decision, not an inconsistency.

Lightweight person records for free-text names, matched case-insensitively so a recurring name
reuses its record. Whole-household add produces **one** entry labelled "[Lastname] Household",
not one per member — the prototype shipped the per-member version and it was a real bug.

**Attribution** is hardwired for named tiers (no privacy option — these are prayed for by name)
and a **choice defaulting to anonymous** for quiet. Quiet names render lighter and drop into
their own scrollable subsection on the agenda: acknowledged as a group, not read one by one.

Entries **auto-tag to every agenda on creation** — the manual "Show on" checkboxes were built and
then removed, because tagging and adding being two steps meant the second was missed.

**A real Wake Lock API toggle** — genuinely native, no backend, with an honest disabled state on
an unsupported browser.

## Prayer Items (Prayer Focus)

Council-scoped and commitment-centric, distinct from the people-centric roll. Two types share one
list: **linked** (created by marking an agenda item) and **personal**.

**A linked item has no independent resolve action anywhere.** Resolution reads the parent agenda
item's status live; nothing stores a shadow flag. This depends on the agenda item
discussion-status field (`pending`/`discussed`/`decided`/`tabled`) — build that in P4's agenda
slice if it is not already there.

## Known traps

- **Ward-member submissions need a hand-entered name.** Leadership attribution works because the
  app knows the active role; a ward member has no account to derive one from. decisions.md §4.8.
- Unmarking deletes cleanly only if nobody has written a private note; otherwise orphan and keep.
