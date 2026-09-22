---
name: A stake and its wards
scope: P2
part: 2
tags: [admin, full]
prerequisites: none
---

## Purpose

**The first time scenario 066's state is reachable without seeding.**

Scenario 066 proved that one person holding a real calling in two wards works — and said plainly
that *"there is no UI anywhere for assigning a second calling until `proto-d`, so this state cannot
be reached by hand at all."* This is `proto-d`. A super admin creates a stake, nests wards under
it, and gives somebody a calling in a second ward, and 066's state exists because a person made it.

The other half is what a ward must **not** see. "Anyone who belongs to one ward never sees the
unit layer at all" is a stated requirement of this phase (CLAUDE.md §7), and this scenario is where
it is checked against a ward that now genuinely **does** sit under a stake — which scenario 065
could not check, because there was no stake anywhere.

**The destructive case is the one worth walking:** deleting a stake that still has wards under it
must **fail loudly**. `on delete restrict` is what enforces it (migration 065a, "rather than
silently orphaning or destroying them"), and the screen's job is to turn that into a sentence
naming what to do first.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 2 — "Harness Test Ward", "Harness Second Ward" |
| Units | **none** — the scenario creates them |
| Users | 4 — a super admin, ward 1's bishop, ward 1's EQ president, ward 2's bishop |
| Callings | one each — **nobody starts with two** |

**The super admin:** `super-admin@harness.wardleadershiptools.test`
**The person who will gain a second calling:** `eq-president@harness.wardleadershiptools.test`

⚠️ **No units are seeded on purpose.** Every ward starts with `unit_id: null`, which is exactly
what migration 065's backfill produces for a real ward. If the screen only works against units
that already exist, this scenario is where that shows.

## Steps

1. Sign in as the **super admin**. Open **Administration**.
2. Confirm **Stakes & wards** is listed. Open it.
3. Create a stake. Leave the unit number **empty**.
4. Confirm it appears with "No unit number yet".
5. Edit it and type a unit number. Confirm it saves.
6. Create two ward units under that stake.
7. Try to remove the stake.
8. Give the EQ president a calling in the second ward via `POST /api/callings`.
9. Sign in as the **bishop** and look for any trace of the unit layer.

## Verification checklist (machine-checkable)

- [ ] A super admin creates a stake and nests two wards under it
- [ ] `unit_number` starts **empty** and saves when typed
- [ ] A second unit given the **same** unit number is refused with a sentence (**409**), not a 500
- [ ] Assigning a second calling makes `GET /api/session/active-ward` return **two wards** for
      that person only
- [ ] Every other account still gets `[]` from that endpoint — one calling is not a choice
- [ ] A ward admin sees **no Stakes & wards entry anywhere**: not on `/admin`, not in the
      navigation, and `/admin/stakes` by URL answers "Not permitted"
- [ ] `POST /api/units` as the bishop answers **403**
- [ ] An authenticated INSERT into `units` at the table is **refused** — the route is not the only
      boundary
- [ ] Deleting a stake with wards under it **fails loudly** (`409`, `on delete restrict`), and the
      stake is still there afterwards
- [ ] Deleting a stake with nothing under it succeeds
- [ ] An audit row exists for the unit creation, the unit update and the calling assignment
- [ ] Assigning a calling in a ward the caller is not acting in, **without** super admin, is a 403
- [ ] Releasing the last active bishop of a ward is refused with a sentence (**409**)

## Needs a human eye

- [ ] Does "No unit number yet" read as a normal, expected state rather than as missing data?
- [ ] When the stake deletion is refused, does the message make the next step obvious — move the
      wards first — without saying how many there are?
- [ ] Does the screen make the nesting visible at a glance, or does it read as a flat list?
- [ ] At 375px, do the unit cards and the add-a-unit form stay usable?

## Walkthrough record

**Not yet walked.**
