# ITER-023: A Third Hand-Maintained Copy Of The Notification Trigger Keys

**Type:** Chore
**Status:** Completed
**Plan:** plans/notification-trigger-drift-test.md
**Completed:** 2026-08-28
**Commit:** b2b8aab
**Created:** 2026-08-28
**Found:** walking scenario 056 for `youth-d`, 2026-08-28
**Related:** migration 036's header — *"A new trigger key is always BOTH the seed and a migration
or it silently never fires for one set of wards."*

## Summary

The trigger keys live in **three** places, and the third one drifted:

1. `supabase/seed/notification_triggers.sql` — 30 keys, for new wards.
2. A migration per new key — `insert … from wards … on conflict do nothing`, for wards that
   already exist.
3. **`NOTIFICATION_TRIGGERS` in `testing/infrastructure/seedUtils.ts`** — a hand-maintained array
   the harness ward is seeded from.

`youth-d` updated (1) and (2) and not (3). The symptom in the harness was the exact failure
migration 036 warns about: flagging a follow-up **stamped `flag_sent_at`, wrote an audit row
saying `notified: true`, and delivered nothing.** `emitNotification` looks the trigger up in
`notification_settings`, found no row for the harness ward, and returned silently.

**Real wards were never affected.** Migration 057d had inserted the row for all eight. The failure
is confined to the harness — which is precisely where it is worst, because the harness is where
such a failure is supposed to be *caught*.

## Current state

`youth_activity_flagged_for_ward_council` was added to `seedUtils.ts` during the walk, to unblock
scenario 056. **Four keys are still missing**, all pre-existing since `program-c`:

- `program_pending_approval`
- `program_approved`
- `program_changes_requested`
- `program_distributed`

They were left alone deliberately: adding them changes what the program scenarios observe, and
that is the program slice's call rather than `youth-d`'s. Any scenario asserting one of those four
notifications is currently asserting against silence.

## The actual fix

Not another careful edit. **A test that diffs the array against the seed file**, so the third copy
cannot drift again:

- parse the `('key', array[…])` tuples out of `supabase/seed/notification_triggers.sql`
- compare key sets, and the `default_roles` for each, against `NOTIFICATION_TRIGGERS`
- fail naming the difference in both directions

`tests/db/hymn-seed.test.ts` is the nearest precedent for a test that reads a seed file. This
belongs in `tests/db/` and needs no database at all — both inputs are files on disk.

Then decide the four `program_*` keys with whoever owns Phase 6, and re-run the program scenarios.

## Why it is worth doing rather than remembering

The comment above the array already said *"Must match supabase/seed/notification_triggers.sql
exactly. A harness ward seeded from a stale copy of this list restores the old roles and quietly
disagrees with production."* It said that **while being wrong by five keys**. A rule stated in a
comment beside the thing it governs was not enough; the drift is silent by construction, because
the only symptom is a notification that does not arrive.
