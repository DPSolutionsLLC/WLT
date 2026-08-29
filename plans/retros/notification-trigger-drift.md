---
id: notification-trigger-drift
type: bugfix
iter: [ITER-023]
commits: ["b2b8aab"]
date: 2026-08-28
files:
  - testing/infrastructure/seedUtils.ts
  - tests/db/notification-triggers-seed.test.ts
  - supabase/seed/notification_triggers.sql
  - SPEC.md
related: [foundation-c-services, program-c-public-pages, program-d-pdf-and-distribution, youth-c-coverage-and-calendar]
fixes: program-a-draft-and-approval
---

## What was broken

One list of notification trigger keys is hand-maintained in three places, and all three disagreed:
the seed SQL had 30, SPEC.md had 28, and `NOTIFICATION_TRIGGERS` in the harness had 26. Flagging a
youth follow-up in the harness stamped `flag_sent_at`, wrote an audit row saying `notified: true`,
and **delivered nothing** — `emitNotification()` looked the key up in `notification_settings`,
found no row for the harness ward, and returned silently.

**Real wards were never affected**, which is what made it survive: migrations 036, 041 and 057d
inserted every row for all eight of them. The failure was confined to the harness — which is where
it is worst, because the harness is where such a failure is supposed to be caught. Scenario 035's
checklist line about the program having gone out had never once been reachable.

## Root cause

Three copies of one list, kept in step by a comment. The comment above `NOTIFICATION_TRIGGERS`
said "Must match supabase/seed/notification_triggers.sql exactly" **while being wrong by five
keys.** Migration 036's header stated the rule as two parts (seed file + migration); there are
four counting SPEC.md and the harness, so following the stated rule faithfully still produced the
drift.

The drift is silent by construction. A missing row produces no error and no log — the only symptom
is a notification that does not arrive, and nothing observes an absence until somebody walks a
scenario looking for it. Three slices each added a key correctly to the files their own plan named:
`program-a` (036, three keys), `program-d` (041, `program_distributed`) and `youth-d` (057d,
`youth_activity_flagged_for_ward_council`). None was wrong on its own terms.

## What fixed it

1. Added the four `program_*` keys to `NOTIFICATION_TRIGGERS`, bringing it to the canonical 30.
2. Added `youth_activity_flagged_for_ward_council` and a new `-- Youth Accounts` section holding
   `youth_account_locked` to SPEC.md §Trigger Keys.
3. Created `tests/db/notification-triggers-seed.test.ts` — parses all three lists from disk and
   diffs them in **both** directions, plus `default_roles` order-insensitively for every shared
   key. No database; the three inputs are files.
4. Replaced the two comments that asserted the match with ones naming the test that now enforces
   it, and closed scenario 031's Defect 2 in its walk record.

No migration, no schema change, no route touched. `emitNotification()` still returns silently on an
unknown key — that contract is deliberate ("a notification outage must not become an app outage").
What changed is that the drift producing an unknown key is now caught before it reaches a ward.

## Pattern

**A rule kept by a comment beside the thing it governs is not kept.** This is `roster-c` and
`visits-b` a third time: the comment asserting the invariant was itself wrong, and had been for
several slices, because nothing executed it.

Two further lessons, both earned rather than assumed:

- **A file-diff test passes on empty input.** With the seed parser deliberately broken, the
  "carries every key the seed SQL carries" assertion **passed on two empty arrays** — precisely the
  `ai-b` / `program-e` / `youth-c` "test that cannot fail" pattern. An anchor-key assertion per
  source is the only thing that caught it, and any future file-parsing test here needs one. All
  five failure modes were exercised by mutation and reverted, rather than the suite being trusted
  because it was green.
- **The test compares; it never counts.** No total is asserted anywhere, because a test that must
  be edited every time a key is added is a test somebody eventually edits without thinking.

Deliberately not done: collapsing the third copy into a shared import. The **SQL copy is
irreducible** — a `.sql` seed file cannot import a TypeScript array — so a file-diff test is
required whatever happens to the harness copy, and given it must exist anyway, moving harness
infrastructure as well buys no additional guarantee.
