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
- [ ] No new console error appears on any page (the pre-existing 404 for `/admin/audit-log` is
      known and unrelated — CLAUDE.md §9).
      **Corrected 2026-09-21, second walk: there is only ONE such link now, not two.** `/agendas`
      answers **200** — Phase 9 Part A shipped the page (migration 064) and this parenthetical
      outlived it. The third sidebar link CLAUDE.md §9 names, `/sacrament`, answers 200 and
      silently redirects to `/dashboard`, which produces no console error at all.

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

### Second walk — 2026-09-21, against the CALLINGS model (migrations 068–071, `2bd7f4e`)

**Driven by Claude (agent) in a real browser (Chrome via Playwright) at localhost:3000, all four
accounts signed in through the real login form; screenshots reviewed by the user.** The record
above ran against the **visiting-officer** model and is kept because which model each ran against
is the point.

**The no-op claim HOLDS. Every machine-checkable item passed.** Observed values:

| Check | Observed |
|---|---|
| Migration 071 state | **Applied.** `users` columns are `id, ward_id, first_name, last_name, email, username, is_active, theme_preference, created_at, active_ward_id` — `role`, `org_id` and `counselor_position` are **gone**, so this walk genuinely exercised the new model |
| `ward_role_assignments` | 4 rows, one per account, `is_active: true` — bishop, org_president (+`org_id`), ward_council_member, music_coordinator |
| Ward unit | `Harness Test Ward unit`, type `ward`, **`parent_id: null`** — the backfill shape, unchanged |
| `GET /api/session/active-ward` | `{wards: [], activeWardId: null, homeWardId: …111}` for **all four** |
| `unit_assignments` | **0 rows in the whole table** |
| `users.active_ward_id` | `null` for all four, before and after the probes |
| Unit vocabulary sweep | **0 hits** for `stake`, `unit`, `unit number`, `unit_id`, `active_ward`, `super admin`, `switch ward` — searched in **both the rendered HTML and the visible text**, across `/dashboard`, `/roster`, `/calendar`, `/visits`, `/youth`, `/goals`, `/admin` × 4 accounts (28 page loads, all 200). HTML bodies 24k–66k chars, so the pages were fully rendered when scanned |
| Ward name element | a plain `<p class="truncate text-sm font-semibold">` with **no clickable ancestor** on all four accounts |
| Every interactive control enumerated | bishop 36, EQ president 13, ward council member 11, music coordinator 13 — **not one** of them ward-, unit- or stake-related. Full inventory in the review page |
| `/roster` as bishop | `Brooks` and `Calloway` both listed |
| Visit as EQ president | Brooks row reads **`Last visited: Sep 6, 2026`**; expanding *Recent visits* shows `2026-09-06 · In-home visit · Dropped in`, `Recorded by Miguel Cortez`, and the shared note *"Good visit. Ethan is enjoying the season."* |
| `PATCH` own ward id | **200**, and `active_ward_id` **read back from the database** as `…111` — plus one `active_ward_switched` audit row (24 → 25) |
| `PATCH` another ward id | **403** *"You do not hold a calling in that ward, so you cannot act in it. Choose one from the list."* — **the new sentence**. Database **unchanged** and **no audit row written** (25 → 25): a refused write is not a mutation |
| `PATCH {activeWardId: null}` | **200**, read back as `null`, one `active_ward_cleared` row (25 → 26) |
| `PATCH` malformed id | **400** "Choose a ward from the list.", database unchanged |
| Audit detail | `{toWardId, fromWardId}` under module `units` — ids only, no token, key or PIN |
| Console errors | **0** across all 28 page loads for all four accounts. The only errors seen anywhere were the deliberate 403/400/404 probe fetches |
| 375px | no horizontal overflow on any page (`scrollWidth == clientWidth == 375`); the mobile nav toggle is a **56×56** floating button, above the 44×44 floor |
| `tests/routes/session-active-ward.test.ts` + `tests/lib/unitAncestors.test.ts` | **19 passed** |

**The two updated checks were verified as NEW, not as quoted in the first record:** the 403
sentence is the calling wording, and a ward is unreachable because nobody holds a calling in it —
`unit_assignments` is empty and the hierarchy is never consulted.

**ONE HUMAN-EYE CHECK COULD NOT BE SETTLED MECHANICALLY THIS TIME, AND THE FIRST RECORD'S
SHORTCUT IS NO LONGER VALID.** That record settled *"does any page show something that was not
there before"* and *"do the dashboard and sidebar look unchanged"* by observing that no
`components/` file and no `app/(app)/layout.tsx` had been modified. **`2bd7f4e` modifies both
`app/(app)/layout.tsx` and `app/(app)/dashboard/page.tsx`**, so that argument does not carry over
and was not reused. The diff is `ROLE_LABELS[user.role]` → `readCallingLabel(user, supabase)` in
both places, and its visible effect on these four accounts is exactly one string:

| Account | Before | Now |
|---|---|---|
| bishop | Bishop | Bishop |
| **eq-president** | **Organization President** | **Elders Quorum President** |
| ward-council-member | Ward Council Member | Ward Council Member |
| music-coordinator | Music Coordinator | Music Coordinator |

Only the EQ president moves, because the other three hold no `org_id` and `describeCalling(role,
null)` returns the same `ROLE_LABELS` string. This is the deliberate 066-D1 fix, it names an
organization rather than a ward, and **it discloses no second ward, stake or unit** — so the
scenario's promise is intact. It was put to the user rather than ticked, because *"identical to
how you remember it"* is literally false and a walk should not quietly decide that for them.

**Reproduced, already-known, and NOT a new finding: defect 066-D2**, deferred to P3 by the
commit that introduced it. At 375px the header identity line has **99px** of usable width while
the EQ president's label needs **231px**, so it renders as `Miguel Cortez ·…` with the calling cut
away entirely; the ward name clips too (128px into 99px). The dashboard body still says it in
full, which is what keeps it legible.

**BOTH JUDGEMENTS WERE PUT TO THE USER WITH SCREENSHOTS AND BOTH WERE ACCEPTED, 2026-09-21.**
The calling label naming the organization stands as the one visible change to a one-ward account,
and 066-D2's clipping stays deferred to P3 rather than being pulled forward now that the label is
longer. So all four human-eye checks are settled for this walk: two by the user's answer, one
(*"any control or affordance hinting a different ward exists?"*) mechanically by the control
inventory, and the fourth — *"does anything read as missing or half-built?"* — by the same answer
that accepted the clipping.

**Checklist corrections made during this walk:** one. The console-error check named **two**
pre-existing 404 prefetch errors; `/agendas` is no longer one of them — Phase 9 Part A shipped
the page and it answers 200. Corrected in place above.

**Left unwalked:** nothing in this scenario. As in the first walk, the excluded-404 clause was
not exercised by a page load — zero console errors appeared — so it was verified by probing
`/agendas`, `/admin/audit-log` and `/sacrament` directly instead (200, 404, 200-then-redirect).

## Notes

- If a check in the **Machine-checkable** list fails, the phase is not invisible and that is a
  release blocker, not a polish item. The whole argument for applying migrations 065 and 066
  ahead of any UI is that they change nothing anybody can see.
- Walk this one BEFORE scenario 066. It is the cheaper of the two and it establishes the
  baseline that 066 then deliberately departs from. (Scenario 064 was its predecessor and was
  deleted on 2026-09-21 — it walked the visiting-officer model the product does not want.)
