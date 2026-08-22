---
id: sunday-types-meeting-split
status: best-yet
commit: caffc32
date: 2026-08-22
area: calendar-sunday-types
related_retros: [sunday-types-meeting-split, calendar-a-rules-and-api, calendar-b-month-view, calendar-c-rotation-cadence]
supersedes: null
---

## What was tested

Scenario 015 (`calendar/scenario-015-no-meeting-sundays`), **steps 3–8 walked by the user** against
the hosted project, signed in as `bishop`. Feature commit `0e4960a`; this record sits at `caffc32`.

Covered: the November 2027 grid, the ward-conference and stake-conference detail pages, changing a
standard Sunday to `holiday`, and changing it to `stake_conference` with the 409 dialog and confirm.

**The walk found a real bug that the whole automated suite had missed.** Step 7 produced the 409
dialog correctly but the confirm write failed:

```
new row for relation "sundays" violates check constraint
"sundays_no_conductor_without_meeting"
```

`SundayEditor` submits the entire form on every save, so a type change arrives carrying
`conductingUserId` — and the UPDATE object spread that value *after* the no-meeting clear, putting
the conductor back and hitting migration 027's new CHECK. **1102 tests were green while this was
broken**, because every DB and route test patched `{ type }` alone and none ever sent the field
combination the real form sends. There was no user workaround: selecting "Nobody" first would not
help, since the type and the conductor travel in one request.

Fixed by deciding `conducting_user_id` once, with the no-meeting rule outranking the submitted
value. Two regression tests added in `tests/db/no-meeting-sundays.test.ts`, **verified by
re-introducing the bug and watching them fail** before restoring the fix.

The walk also surfaced that the harness notification-trigger list had drifted from
`supabase/seed/notification_triggers.sql` since migration 025, silently dropping
`assignment_reverted` in every harness ward. The two lists were diffed — that was the only drift —
and corrected.

## Result

**Everything walked passes.** The split reads correctly on screen and the rotation behaves.

| Check | Result |
|---|---|
| `2027-11-21` reads "No meeting", not "Not set" or blank | ✅ |
| `2027-11-07` shows the Ward Conference badge and a conductor | ✅ |
| Fast Sunday sits on the 2nd Sunday, displaced by the ward conference | ✅ |
| `2027-11-28` reads Peter Nakamura — no turn spent on the cancelled Sunday | ✅ |
| Stake conference detail page: "No meeting" for every organization, no select, no Save | ✅ |
| `holiday` produces no meeting-cancelled warning and keeps conductor + slots | ✅ |
| 409 dialog names both the speakers at risk and the later Sundays changing | ✅ |
| Confirming reverts speakers to `plan` and shifts the later Sundays | ✅ (after the fix) |

The `holiday` row is the one that matters most: it is the false alarm ITER-002 opened with, and it
is gone.

Automated evidence at this commit: **1102 tests across 76 files**, including
`tests/lib/sundayTypeLists.test.ts` (table-driven over `SUNDAY_TYPES`, so a future type must answer
both questions), the gap test in `conductingSkip.test.ts`, and end-to-end monthly-cadence coverage
in `conducting-reshift.test.ts`. `typecheck`, `lint`, `harness:typecheck` and a production `build`
all clean. Migration 027 applied to the linked hosted project.

## Still needs testing

This is why the record is `best-yet` rather than `confirmed`.

- **Scenario 015 steps 9–15 have not been walked.** That is the corrected monthly-cadence step
  (switch effective 2028-01-01, read January 2028, cancel `2028-01-16`), the `eqpres` organization
  view, the `secretary` permission check, and the 375px / dark-theme pass. The monthly *mechanism*
  is pinned by tests, but **nobody has looked at those screens** — and the two defects this session
  found were both things tests passed and a human did not.
- **The Ward Conference badge's contrast is unverified by eye** in either theme. Colour values are
  deliberately not asserted in tests, so this can only come from the walkthrough.
- **The organization skip has not been seen from `eqpres`'s own account.** The bishop's view of the
  Elders Quorum rows was checked; the org leader's was not.
- ~~The deployed Vercel build has not been opened.~~ **Closed 2026-08-22** — see below. Still open
  on the `talks-planner` and `role-access` records, which cover different surfaces.

## Note on step 9

The user reported the monthly cadence switch as not working. **It was the scenario that was wrong,
not the app.** `replaceConductingRotation()` only inserts rotation rows; `conducting_user_id` is
stored and never recomputed, and `populateConducting()` fills nulls only — so a rotation change
cannot alter an already-generated month. Scenario 011 had already recorded this, and the plan had
quoted the `calendar-b` pitfall about untraced checklist claims. The step was rewritten to observe
the cadence on a month generated *after* the switch, and the mechanism is now covered by a real
test rather than a checklist assertion.

That diagnosis did expose a genuine product gap — a rotation change never applies to
already-generated future months, which makes an `effective_from` date inert. Scoped separately as
**ITER-006**; deliberately not fixed here.

## Deployed build — opened and verified 2026-08-22

The push auto-deployed: `vercel.json` enables git deployments on `main` only, so `caffc32`
produced production deployment `6040778672`, state **success**. Nothing needed triggering, and the
Vercel CLI being logged out was irrelevant.

**Production is serving this commit**, verified by signing in as the harness bishop at
`wlt-iota.vercel.app` and reading November 2027. Two things on that page exist only in this commit:

- the **Ward Conference** badge on `2027-11-07`, a Sunday type that did not exist before
- **"Conducting: No meeting"** on `2027-11-21`, the new `ConductingLabel` state

Production reads the same hosted Supabase project the harness seeds into, so migration 027 and the
scenario fixture are both live to it. `2027-11-07` also showed its confirmed speaker and three
slots, and `2027-11-28` its two speakers — the ward conference keeping everything an ordinary
Sunday has.

**A December anomaly was investigated and dismissed.** Production initially showed December
conductors in the order 1, 3, 1, 2 — not a coherent weekly cycle, since consecutive
meeting-holding Sundays must advance by exactly one position. It was **fixture pollution, not a
code fault**: the step 9 experiments had left three extra bishopric rotations in the ward
(`2026-08-23 monthly`, `2027-11-01 monthly`, and `2027-11-02 monthly` with **all three positions
empty**), and `activeRotation()` resolves against the latest `effective_from` that is not in the
future. Settled by rebuilding scenario 015's exact shape on an isolated fixture and replaying the
walkthrough, which produced the correct consecutive cycle:

```
step 6 holiday          -> reshift sacrament=0     (nothing moves; a holiday holds a meeting)
step 7 stake_conference -> reshift sacrament=4

2027-12-05 Peter Nakamura   2027-12-12 Daniel Okafor
2027-12-19 Mark Andersen    2027-12-26 Peter Nakamura
```

The fixture was re-seeded clean afterwards and production re-checked.

### Observations from the deployed build

- **11 console errors on every page load**, all 404s on `_rsc` prefetches for routes that do not
  exist yet — `/talks/topics`, `/program`, `/music`, `/visits`, `/goals`, `/youth`, `/agendas`,
  `/tithing`, `/ai-settings`, `/knowledge`, `/admin/audit-log`. Pre-existing and unrelated to this
  work: the app shell links every module, including the Phase 5-11 ones nobody has built. Harmless
  today, but it is eleven errors of noise that a real error would hide in.
- **The rotation form accepted a set with all three positions empty.** That is how
  `2027-11-02 monthly` came to exist, and it leaves every Sunday from that date resolving to
  nobody. Whether that should be refused is a real product question, and it is not part of this
  change or of ITER-006.
