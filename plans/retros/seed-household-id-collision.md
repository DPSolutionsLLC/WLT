---
id: seed-household-id-collision
type: bugfix
iter: null
commits: ["2af66b8"]
date: 2026-08-22
files:
  - testing/infrastructure/seedUtils.ts
related: [roster-b-picker-and-orgs, route-tests-and-realtime]
fixes: null
---

## What was broken

`npm run seed -- roster/scenario-008-member-picker-and-organizations` aborted partway through,
leaving 3 households and **zero** members. Scenario 008 was unwalkable from its first step, and
had been since it was written — it has never once seeded successfully.

The origin is `e9f88fd` (the harness itself), which predates the retro system, so there is no
feature retro to point `fixes:` at.

## Root cause

`createHousehold` derived its stable id from the family name alone:

```ts
id: options.id ?? testUuid(`household:${options.familyName}`)
```

Scenario 008 seeds two households named **Smith** — 3 North Road and 91 South Road — deliberately,
because keeping two same-named households apart is exactly what the picker's household grouping
has to do. Both derived the same uuid, the second insert violated `households_pkey`, and the seed
threw before reaching any of the 24 members or 13 organization memberships.

The seeded data disagreed with the scenario's own Seed Data table, which says 8 households and 24
members. Nothing compares the two.

## What fixed it

1. `createHousehold` now derives its id from the family name **and** the address:
   `testUuid(\`household:${familyName}:${address ?? ""}\`)`. Address is the right discriminator
   independently of this bug — `apply_roster_import` (migration 022) matches households on the
   pair, and `tests/db/roster-import.test.ts` has a case named "keeps two households with the same
   family name and different addresses apart".
2. Re-seeded and confirmed: 8 households, 24 members (12 adult, 8 youth, 4 child; 2 moved out,
   2 do-not-contact, 1 unhoused), 13 organization memberships.
3. Scenario 008 then walked end to end and passed.

Household ids change for every scenario, which is harmless: `seedRunner` deletes and recreates the
test ward on every run, so ids only need to be stable within a run and across re-runs, not across
formula changes.

## Pattern

**The failure was loud, accurate, and ignored for six phases.** The seed printed
`Could not seed households: duplicate key value violates unique constraint "households_pkey"` and
exited. Nothing was swallowed and nothing was misreported. The cost was not the bug — a one-line
fix — it was that scenario 008 was deferred six times, and a scenario that dies on step 1 is easy
to put down and hard to justify picking back up. The deferral and the breakage fed each other.

This is the third instance of one shape in two days: [[route-tests-and-realtime]] records a "there
is no local server" line copied through six retros without re-derivation, and realtime tests that
passed while realtime was entirely dead. In all three the information was present and correct;
nobody was looking at it.

**Two concrete rules fall out:**

- **A seed helper that derives an id from data must key on everything that makes the row unique.**
  A family name is not a household. If a scenario deliberately seeds two rows that differ only in
  a field the id ignores, the seed cannot work.
- **Walk a new scenario once, immediately, before deferring it.** Not the whole checklist — just
  far enough to prove it seeds and the first screen loads. A scenario that has never been run is
  not a test that is waiting; it is a test of unknown validity, and its value decays while the
  code it covers moves underneath it.
