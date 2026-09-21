---
name: One person, two callings
scope: P2
part: 1
tags: [auth, admin, full]
prerequisites: none
---

## Purpose

**The model, walkable.** One person holds a **real calling in each of two wards** — Relief
Society president in ward 1, ward secretary in ward 2 — and carries that ward's role and that
ward's access while acting there. There is no visitor tier, no reduced-rights guest, and no
cross-ward read.

This replaces **scenario 064**, which walked a *visiting officer* borrowing another ward under a
reduced permission list. That scenario was deleted rather than annotated: two scenarios describing
rival models is worse than one, and the record of what 064 proved lives in
`plans/retros/unit-hierarchy-and-ward-switch.md`.

This is the one behaviour in Phase 2 that cannot be proved by a unit test alone, because the thing
that would go wrong is not a query returning the wrong rows — it is **the page frame naming one
ward while the rows on it come from another**, or **the navigation showing ward 1's modules while
acting in ward 2**, or the switch quietly signing the switcher out.

Seeding is most of the value. There is no UI anywhere for assigning a second calling until
`proto-d`, so this state cannot be reached by hand at all.

**The switcher CONTROL is a P3 chrome component and does not exist yet.** Until it does, the
switch is driven through `PATCH /api/session/active-ward`, and the checks below say so where it
matters. The checks about the control are written now so that P3 has them waiting; mark them
**not yet applicable** rather than failed while the control is unbuilt.

## Seed Data

| Entity | Detail |
|---|---|
| Units | **none** — deliberately. A switch needs a calling, not a hierarchy (migration 070a) |
| Wards | 2 — "Harness Test Ward", "Harness Second Ward" |
| Users | 5 — the two-calling person, ward 1's bishop and EQ president, ward 2's bishop and EQ president |
| Callings | **6** — one each, except the two-calling person, who holds two |
| Ward 2 | 4 households, 8 members, 2 visit logs (one carrying a **private note** by ward 2's bishop), 2 Sundays |

**The person the scenario is about:** `two-callings@harness.wardleadershiptools.test`

| Ward | Role | Organization |
|---|---|---|
| Harness Test Ward (home) | `org_president` | Relief Society |
| Harness Second Ward | `ward_secretary` | none |

The two disagree on purpose: `org_president` holds `visits.*` and no `agendas.*`;
`ward_secretary` is the reverse. So "which role is this session" has a **visible** answer in the
navigation rather than only a stored one.

**Also sign in as:** `bishop@`, `eq-president@`, `second-ward-bishop@`,
`second-ward-eq-president@` — all on `harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-066-one-person-two-callings`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as **two-callings**. Walk `/dashboard`, `/roster`, `/visits`. Note the role shown and
   the modules in the nav.
4. `GET /api/session/active-ward` and read the response.
5. `PATCH /api/session/active-ward` with `{"activeWardId": "<second ward id>"}`.
6. Reload `/dashboard`. Walk `/roster`, `/calendar`. Note the role and the nav **again**.
7. **Write something in ward 2** — open a Sunday in October 2026 and set its conductor
   and a note. (Not a visit: her ward 2 calling holds no `visits.*` — see the checklist
   note below.)
8. Search the page source in ward 2 for the private note's text.
9. `PATCH` with `{"activeWardId": null}` and confirm you are back in ward 1.
10. Sign in as **eq-president** and fetch `GET /api/session/active-ward`.
11. Open the browser console on at least one page and check for errors.

## Verification Checklist

### Machine-checkable

- [ ] In ward 1 the header names **Harness Test Ward** and the calling reads **Relief Society
      President** — the ORGANIZATION, not the bare "Organization President". *(Tightened
      2026-09-21: the parenthetical used to accept the generic label, and the walk found the
      app rendering exactly that. Defect 066-D1, fixed the same day — `describeCalling()`.)*
- [ ] After switching, the header names **Harness Second Ward** and the role reads **ward
      secretary**
- [ ] **The nav changes between the two.** Different callings grant different modules — ward 1
      offers the visit tools, ward 2 does not; ward 2 offers the agenda/calendar tools, ward 1's
      Relief Society calling does not
- [ ] `GET /api/session/active-ward` lists **both** wards for this person, and `wards: []` for
      the EQ president
- [ ] A **Sunday edited in ward 2 persists** — set its conductor and a note, then read
      `sundays` back. *(Corrected 2026-09-21 during the walk: this said "a visit logged in
      ward 2", which this person CANNOT DO. Her ward 2 calling is `ward_secretary`, and
      `WARD_SECRETARY_PERMISSIONS` holds no `visits.*` at all — the check described a state
      the app cannot reach. The calendar is her ward 2 write, which is why the seed puts two
      Sundays there.)*
- [ ] The **audit row for that edit is filed under ward 2 while its author's `users.ward_id`
      is ward 1** — `audit_log(ward_id = ward 2, user_id = <a ward 1 user>)`. **This is the
      row the composite foreign keys forbade**, and it is the walkable form of what
      `tests/rls/ward-callings-write.test.ts` proves on `visit_logs`, `activity_logs` and
      `programs`. `writeAuditLog()` never throws, so before migrations 067/069 this row
      would simply have been missing, with nothing on screen to say so.
- [ ] The **Conducting dropdown in ward 2 offers only ward 2's bishopric**, never ward 1's —
      `listBishopricUsers` reads callings scoped to the ward being acted in
- [ ] Ward 2's private note is **absent from the page source** in both wards
- [ ] While acting in ward 2, **no ward 1 household appears anywhere** — not on `/roster`, not on
      `/visits`. There is no cross-ward read in either direction
- [ ] One audit row per switch, filed under **the ward being entered** (`active_ward_switched` in
      ward 2, `active_ward_cleared` in ward 1)
- [ ] The sign-in audit row for this person is filed under the ward they resolved to, and its
      `detail.role` names that ward's calling
- [ ] `users.ward_id` is **unchanged** throughout — a switch never moves an account
- [ ] No new console error appears on any page (the two pre-existing 404 prefetch errors for
      `/agendas` and `/admin/audit-log` are known and unrelated — CLAUDE.md §9)

### Needs a human eye

**All four were put to the user on 2026-09-21 and answered. Their answers are recorded here so a
later reader does not re-litigate them.**

- [x] **Is it obvious *which calling* you are acting under, or only which ward?**
      → **NO, AND IT HAD TO BE FIXED.** "It should not be as vague as organization president. It
      should indicate what organization it is referring to." Became defect **066-D1**; fixed the
      same day by `describeCalling()` in `types/domain.ts`, so the chrome now reads **Relief
      Society President**. Re-verified in the browser in both wards.
- [x] **Does switching feel like changing hats, or like changing accounts?**
      → **Changing hats.** "It looks like just changing hats." The model reads correctly.
- [x] Does the nav change read as *"different ward, different job"* or as *"something is broken
      and modules are missing"*? → **Different job.** Settled with the answer above.
- [x] Is there anything on ward 2's pages that a ward 2 leader would find surprising — any sign
      that this person is a guest rather than one of theirs? → **"Nothing surprising."** No
      visitor tier leaks into the presentation.
- [ ] **Deferred, not passed — the clipped mobile header (066-D2).** The user answered "it can
      wait": the chrome line is rebuilt with P3's switcher control, and until then a person with
      two callings can see which ward but not which calling on a phone. Re-raise it in P3.

## Failure Behavior

- [ ] `PATCH /api/session/active-ward` naming ward 2 is a **403** with a sentence for the EQ
      president, who holds one calling. The sentence names the reason in the model's own terms:
      *"You do not hold a calling in that ward."* Covered automatically by
      `tests/routes/session-active-ward.test.ts`.
- [ ] `{"activeWardId": null}` returns 200 for everybody. Clearing never needs authorization.
- [ ] **Ending the second calling takes effect on the next read, with `active_ward_id` still
      set.** Set `ward_role_assignments.is_active = false` for the ward 2 row with the service
      client, reload, and the session is back in ward 1 as an org president — `current_ward_id()`
      re-validates on every read rather than trusting the column. Covered by
      `tests/rls/ward-callings.test.ts`.
- [ ] A stake assignment reaches **nothing**. `STAKE_OFFICER_PERMISSIONS` is empty and
      `can_act_in_ward()` no longer consults `unit_assignments` at all. Covered by
      `tests/routes/session-active-ward.test.ts`.

## Walkthrough record

**2026-09-21 — driven by Claude (agent) in a real browser at localhost:3000, screenshots reviewed
by the user.** Every write read back with the service-role client; every absence checked against
full page source rather than rendered text.

**Every machine-checkable item above passed.** Observed values:

| Check | Observed |
|---|---|
| Seed shape | 2 wards, 5 users, **6 callings**, **0 units** |
| Ward 1 header | `Harness Test Ward` · `Marianne Whitfield · Organization President` |
| Ward 2 header after switch | `Harness Second Ward` · `Marianne Whitfield · Ward Secretary` |
| Nav, ward 1 | Dashboard, Roster, **Visits, Goals, Youth Activities** |
| Nav, ward 2 | Dashboard, Roster, **Calendar, Talks, Prayers, Program, Music, Agendas** |
| `GET /api/session/active-ward` (her) | both wards, `activeWardId: null`, `homeWardId` = ward 1, `unitId: null` on both |
| `GET` (eq-president) | `wards: []` |
| Ward 2 write | `sundays.ward_id` = ward 2, `notes` = "Walked by Marianne from her ward 2 calling", `conducting_user_id` = Dale Okonkwo |
| Conducting dropdown in ward 2 | **only** "Dale Okonkwo" — ward 1's bishop never offered |
| Cross-ward audit row | `sunday_updated` · ward = **ward 2** · `user_id` = a **ward 1** user |
| Switch / clear audit | `active_ward_switched` ward 2; `active_ward_cleared` ward 1 |
| Sign-in audit | `login` ward 1, `detail.role = "org_president"` |
| Audit note redaction | `notesChanged: "[redacted]"` — note text never enters the trail |
| `users.ward_id` | ward 1 before, during and after |
| Private note | absent from page source in **both** wards (51,400 chars scanned) |
| Ward 1 household while in ward 2 | "Brooks" absent from text **and** source |
| Refusal (eq-president) | **403** "You do not hold a calling in that ward, so you cannot act in it." |
| Clear (eq-president) | **200** — clearing never needs authorization |
| Console errors | **0** from page loads; the single logged error was the deliberate 403 probe |
| Phone width (390px) | no horizontal scroll, `scrollWidth` 390 = `clientWidth` 390 |

**THE LOAD-BEARING NEGATIVE: zero units were seeded and the switch worked anyway.** Under the
visiting-officer model the switch authorised itself by walking `wards.unit_id → parent_id`. It now
asks only "do you hold an active calling there", so no stake is needed and none exists here.

**Defect found — 066-D1: the chrome named the ROLE but not the ORGANIZATION.** The header and the
dashboard both read "Organization President", which tells somebody holding two callings only half
of what they need. Put to the user as a judgement and answered: *"it should not be as vague as
organization president. it should indicate what organization it is referring to."* **Fixed the
same day**: `ORG_SCOPED_ROLE_SUFFIXES` + `describeCalling()` in `types/domain.ts` (a FULL Record,
so a new role fails to compile until somebody decides whether it is org-scoped),
`lib/callings/callingLabel.ts` for the read, wired into both render sites so they cannot disagree.
Re-verified in the browser: ward 1 now reads **"Marianne Whitfield · Relief Society President"**
and ward 2 still reads **"Ward Secretary"** — a calling with no organization is left alone rather
than becoming "Harness Second Ward Ward Secretary". Covered by `tests/lib/describeCalling.test.ts`
(6 tests, including the drift guard and the degraded-read fallback).

**Defect found — 066-D2, DEFERRED BY THE USER ("it can wait"): at phone width the header clips the
calling away entirely.** The chrome
line naming the ward and the calling is given **100px** for **205px** of text, rendering as
"Harness Sec…" over "Marianne Whitfi…". On `/roster` nothing else visible on the page names the
calling. The full string is in the DOM, so it is CSS truncation rather than missing data. **Not
caused by this change** — the header predates it — but this change is what makes the clipped half
load-bearing, because the role is now the only thing distinguishing two callings. Put to the user
as a judgement: blocker now, or wait for P3's chrome bar.

**Checklist corrections made during the walk:** one. "A visit logged in ward 2 persists" described
a state this person **cannot reach** — her ward 2 calling is `ward_secretary` and
`WARD_SECRETARY_PERMISSIONS` holds no `visits.*` at all, so the check could never have passed.
Rewritten to the Sunday edit she can actually do, with the cross-ward-write proof moved to the
**audit row**, which is the same composite-foreign-key case in a reachable form. Two checks were
added from what the walk revealed: the audit row itself, and the ward-scoped Conducting dropdown.

**Left unwalked:** the known `/agendas` prefetch 404 (CLAUDE.md §9) did not appear, because the
walk navigated directly rather than hovering the nav — the check excluding it remains correct but
was not exercised. The switcher CONTROL is still P3's and does not exist, so every check about it
is **not yet applicable** rather than passed; the switch was driven through
`PATCH /api/session/active-ward`.

## Notes

- Walk **scenario 065 first**. It is the cheaper of the two and it establishes the baseline —
  a ward that sees no sign any of this exists — that this scenario deliberately departs from.
- If the nav does *not* change between the two wards, the app is reading the role off the person
  rather than off the calling. That is migration 066's mistake exactly, and it is the single most
  likely regression in this area.
- The seed creates **no stake and no units**, and that is load-bearing as documentation: if this
  scenario ever starts needing `ensureTestUnits()`, the `unit_assignments` arm of
  `can_act_in_ward()` has come back.
