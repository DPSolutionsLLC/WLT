---
id: sunday-types-meeting-split-walked
status: confirmed
commit: caffc32
date: 2026-08-22
area: calendar-sunday-types
related_retros: [sunday-types-meeting-split, calendar-a-rules-and-api, calendar-b-month-view, calendar-c-rotation-cadence]
supersedes: sunday-types-meeting-split
---

## What was tested

**Scenario 015 walked end to end by the user**, on the **deployed Vercel build** at
`wlt-iota.vercel.app`, at 412px in dark mode. All 28 checklist items pass. The superseded record
held at `best-yet` because steps 9–15 were unwalked; they are now done.

The walkthrough spanned three accounts — `bishop`, `eqpres`, `secretary` — and both the weekly and
monthly cadences.

## Result

**Confirmed working.** The meeting/Fast-Sunday split reads correctly on screen and the rotation
behaves under both cadences.

| Check | Result |
|---|---|
| `2027-11-21` reads "No meeting", not "Not set" or blank | ✅ |
| `2027-11-07` shows the Ward Conference badge and a conductor | ✅ |
| Fast Sunday displaced onto the 2nd Sunday by the ward conference | ✅ |
| `2027-11-28` reads Peter Nakamura — no turn spent on the cancelled Sunday | ✅ |
| `holiday` fires no meeting-cancelled warning, keeps conductor and slots | ✅ |
| 409 dialog names both the speakers at risk and the later Sundays changing | ✅ |
| Confirming reverts speakers to `plan` and shifts four December Sundays | ✅ |
| Monthly cadence: one name across all of January 2028 | ✅ |
| Monthly: cancelling `2028-01-16` leaves the other four unchanged | ✅ |
| Organization row: `11-07` "Not set" vs `11-21` "No meeting" | ✅ |
| As `secretary`, the organization row is read-only with no Save | ✅ |
| Ward Conference badge legible and distinct at 412px, dark mode | ✅ |

**The two that carry the most weight.**

`2027-11-07` reading **"Not set"** while `2027-11-21` reads **"No meeting"** is the entire point of
ITER-002. Before this change both rendered as a blank and were indistinguishable — one means a
rotation position nobody has filled, the other means there is no meeting to conduct. The ambiguity
had already cost a debugging session.

The January 2028 evidence, read from the fixture after the walk:

```
2028-01-02  fast_sunday       Mark Andersen
2028-01-09  standard          Mark Andersen
2028-01-16  stake_conference  -- none --      <- cancelled
2028-01-23  standard          Mark Andersen   <- unchanged
2028-01-30  standard          Mark Andersen   <- unchanged
```

That is Decision 1 on real rows: a month spends a turn unless *every* Sunday in it is cancelled.
The opposite of the weekly case in step 7, where cancelling one Sunday shifted four later ones.

Automated evidence at this commit: **1102 tests across 76 files**. `typecheck`, `lint`,
`harness:typecheck` and a production `build` all clean. Migration 027 applied to the linked hosted
project. Production deployment `6040778672`, state success.

**This is the baseline.** If Sunday types, the no-meeting rule, or the conducting skip regress
later, this commit and this scenario are the known-good reference.

## What the walkthrough caught that tests did not

Three defects, all found by a human looking at screens while 1102 tests were green. Worth recording
together, because they share one shape: **every test exercised a narrower path than a real user
takes.**

1. **The step 7 confirm failed** on migration 027's new CHECK. `SundayEditor` submits the whole
   form, so a type change arrives carrying `conductingUserId`, and the UPDATE spread it after the
   no-meeting clear. Every test had patched `{ type }` alone. **Fixed** in `0e4960a`, with
   regression tests verified by re-introducing the bug.
2. **`assignment_reverted` was silently dropped** in every harness ward — the harness trigger list
   had drifted from `supabase/seed/notification_triggers.sql` since migration 025. **Fixed.**
3. **`calendar.manage_org_conducting` is unreachable by every role that holds it.** An organization
   president has no Calendar nav link and gets "Not permitted" by direct URL. Pre-existing since
   `calendar-c`; missed because scenario 011 was never walked and the route test calls the handler
   directly, bypassing the page gate. **Not fixed** — scoped as ITER-007, because the obvious fix
   (granting `calendar.view`) would ship the wrong product under ITER-001's design.

## Still open — none of it blocks this confirmation

- **ITER-007** — the unreachable organization-conducting permission, above. Scenario 015 step 13
  now reads the organization rows as the bishop; the organization-leader half cannot be walked
  until this is fixed. **Scenario 011 carries the same broken assumption** in its own checklist and
  should be corrected or re-walked when ITER-007 lands.
- **ITER-006** — a rotation change does not apply to already-generated future months, so an
  `effective_from` date is inert for any month that already has rows. Found during this
  walkthrough; step 9 was rewritten around it.
- **11 console errors on every page load**, all `_rsc` 404s for unbuilt Phase 5–11 routes. The user
  confirmed nothing new is hiding among them. Pre-existing, cosmetic, and worth clearing eventually
  because eleven errors is somewhere a real one can hide.
- **The deployed build is now opened and verified for this area** — the item carried on the
  `talks-planner` and `role-access` records is closed here, but remains open on those two, which
  cover different surfaces.
