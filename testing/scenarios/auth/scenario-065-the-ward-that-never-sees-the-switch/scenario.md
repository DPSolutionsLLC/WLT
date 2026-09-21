---
name: The ward that never sees the switch
scope: P2
part: 1
tags: [auth, smoke]
prerequisites: none
---

> **Still valid after the 2026-09-21 model correction, and RE-WALK IT.** This scenario proves a
> NEGATIVE — that a leader who belongs to one ward sees no sign the unit layer exists — and that
> promise is unchanged by the correction, which is about how a person reaches a SECOND ward.
>
> It is also the cheapest proof that migrations 068–070 were the no-op they claim to be: every
> account here now holds a CALLING rather than a `users.role`, and if that is invisible to these
> four, it is invisible to every ward in production. Two checks below name a wording change and a
> changed reason; everything else stands exactly as walked.

## Purpose

Phase 2 put a stake tier, a super admin and a ward switch into the schema. This scenario proves
that **none of it reached anybody who belongs to one ward** — which is the phase's stated
requirement and the thing a schema change is least likely to be honest about on its own.

The state seeded here is not a contrivance. One ward with one `units` row above it and **no
parent** is exactly what migration 065's backfill produces for every ward that already existed,
so this is the state every real ward is in today and will stay in until somebody creates a stake
in `proto-d`. If a unit, a stake or a ward control appears anywhere on these pages, it appears in
production.

It is tagged `smoke` deliberately: this is cheap to walk and it is the check that catches a later
phase leaking the unit layer into ordinary chrome.

## Seed Data

| Entity | Detail |
|---|---|
| Units | 1 — one `ward` unit, **no parent**, which is what the backfill produces |
| Wards | 1 — "Harness Test Ward"; **no second ward and no stake** |
| Users | 4 — bishop, EQ president, ward council member, music coordinator |
| Households | 2 — Brooks, Calloway |
| Members | 3 — 2 adults, 1 youth (in Young Men) |
| Other | 1 visit log, 2 Sundays |

**Sign in with each of:**
`bishop@`, `eq-president@`, `ward-council-member@`, `music-coordinator@`
— all on `harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-065-the-ward-that-never-sees-the-switch`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **bishop**. Walk `/dashboard`, `/roster`, `/calendar`, `/visits`, `/youth`.
4. Fetch `GET /api/session/active-ward` and read the response.
5. Repeat 3–4 as the **EQ president**, the **ward council member** and the **music
   coordinator**.
6. Open the browser console on at least one page and check for errors.

## Verification Checklist

### Machine-checkable

- [ ] `GET /api/session/active-ward` returns `wards: []` for **all four** accounts
- [ ] The same response returns `activeWardId: null` and a `homeWardId` equal to the ward's id
- [ ] No page source anywhere contains the words "stake", "unit" or "unit number" for any of the
      four accounts (the word "Stake Conference" as a Sunday TYPE is a pre-existing calendar
      value and does not count — it comes from `SUNDAY_TYPES`, not from this phase)
- [ ] `/roster` lists Brooks and Calloway for the bishop, exactly as before migration 065
- [ ] The visit seeded on the Brooks household is visible to the EQ president on `/visits`
- [ ] `users.active_ward_id` is `null` for all four accounts and no page offers to change it
- [ ] `unit_assignments` holds **zero** rows for all four accounts
- [ ] `PATCH /api/session/active-ward` with the ward's OWN id returns 200 — setting your active
      ward to the ward you are already in is a no-op, not a refusal
- [ ] No new console error appears on any page (the two pre-existing 404 prefetch errors for
      `/agendas` and `/admin/audit-log` are known and unrelated — CLAUDE.md §9)

### Needs a human eye

- [ ] Does any page show a ward name, badge or chip that was not there before? A ward label is
      not wrong in itself, but on a single-ward app it is new furniture that answers a question
      nobody asked
- [ ] Is there any control, menu item or affordance anywhere that hints a different ward exists?
- [ ] Do the dashboard and sidebar look **identical** to how you remember them — not merely
      correct, but unchanged?
- [ ] Does anything read as though a feature is missing or half-built for these users?

## Failure Behavior

- [ ] `PATCH /api/session/active-ward` naming ANY other ward id is a **403** with a sentence for
      every one of these four accounts — they hold one calling, so there is nowhere for them to
      go. Covered automatically by `tests/routes/session-active-ward.test.ts`.
      **The sentence changed on 2026-09-21** and the walkthrough record below quotes the old one:
      it now reads *"You do not hold a calling in that ward, so you cannot act in it. Choose one
      from the list."* The old wording described the visiting-officer rule, which no longer
      exists.
- [ ] `{"activeWardId": null}` returns 200 for all four. Clearing never needs authorization, and
      this ward is where they already are.
- [ ] This ward cannot be switched INTO by anybody either — **and the reason changed on
      2026-09-21.** It used to be that its unit has no parent, so `can_act_in_ward()`'s ancestor
      walk found nothing above it. It is now simply that **nobody else holds a calling here**;
      the hierarchy is not consulted at all (migration 070a). `unit_ancestor_ids()` survives for
      proto-d's screens, and `tests/lib/unitAncestors.test.ts` still exercises its cycle guard,
      but the switch no longer walks it.

## Walkthrough record

**2026-09-21 — driven by Claude (agent) in a real browser at localhost:3000, screenshots reviewed
by the user.** All four accounts signed in and walked.

**Every machine-checkable item above passed.** Observed values:

| Check | Observed |
|---|---|
| Ward unit | `Harness Test Ward unit`, type `ward`, **`parent_id: null`** — the backfill shape |
| `GET /api/session/active-ward` | `{wards: [], activeWardId: null, homeWardId: …111}` for **all four** accounts (bishop, EQ president, ward council member, music coordinator) |
| `unit_assignments` for all four | **0 rows** |
| `users.active_ward_id` for all four | `null` |
| Unit vocabulary sweep | 0 hits for `stake`, `unit number`, `unit_id`, `active_ward`, `super admin`, `switch ward` across `/dashboard`, `/roster`, `/calendar`, `/visits`, `/youth`, `/goals`, `/admin` — all 200 |
| `/roster` as bishop | `Brooks` and `Calloway` both listed |
| `/visits` as EQ president | the seeded Brooks visit visible |
| `PATCH` own ward id | `200` — a no-op, not a refusal |
| `PATCH` another ward id | `403` "You are not assigned over that ward, so you cannot act in it. Choose one from the list." |
| `PATCH {activeWardId: null}` | `200` |
| `PATCH` malformed id | `400` "Choose a ward from the list." |
| Console errors | none from page loads; the only two were the deliberate 403/400 probe fetches above |

**Settled mechanically rather than by eye** — and therefore *not* put to the user:

- *"Does any page show a ward name, badge or chip that was not there before?"* — `git status`
  shows **no `components/` source file and no `app/(app)/layout.tsx` was modified** by this work
  (only two files under `tests/components/`). The ward name in the banner is pre-existing chrome.
  That is stronger evidence than a person's memory of the old screen.
- *"Do the dashboard and sidebar look unchanged?"* — same argument, same evidence.

**Checklist corrections made during the walk:** none. Every check described a reachable state and
every one could have failed.

**Left unwalked:** nothing in this scenario. The two known pre-existing 404 prefetch errors
(`/agendas`, `/admin/audit-log`) did not appear in this run, so the check that excludes them was
not exercised — it remains correct but untested here.

## Notes

- If a check in the **Machine-checkable** list fails, the phase is not invisible and that is a
  release blocker, not a polish item. The whole argument for applying migrations 065 and 066
  ahead of any UI is that they change nothing anybody can see.
- Walk this one BEFORE scenario 066. It is the cheaper of the two and it establishes the
  baseline that 066 then deliberately departs from. (Scenario 064 was its predecessor and was
  deleted on 2026-09-21 — it walked the visiting-officer model the product does not want.)
