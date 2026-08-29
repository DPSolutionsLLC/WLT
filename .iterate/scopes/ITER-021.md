# ITER-021: "Say How It Went" Is Offered On Another Organization's Event

**Type:** Bug
**Status:** Completed
**Plan:** plans/youth-follow-up-controls.md
**Completed:** 2026-08-29
**Commit:** 17032a9
**Created:** 2026-08-28
**Found:** walking scenario 056 for `youth-d`, 2026-08-28
**Related:** `plans/retros/youth-a-*` (defect D1), `plans/retros/visits-d-*` — this is the same
defect a **third** time.

## Summary

A leader is offered a control the database then refuses. As the Young Men president:

1. `/youth` → **Show past events**
2. *Winter concert* — a **Young Women** activity — carries a **"Say how it went"** button
3. Type a shared note, press **Save follow-up**
4. Refused: *"That event belongs to another organization. You can record a follow-up on your own
   organization's activities, and on ward-wide ones."*

Nothing is written (`activity_logs` stayed at 3 rows, re-read with the service client) and
migration 057c's INSERT policy held. The refusal is graceful — a sentence in `role="alert"`, not a
500. **But the control should never have been offered.**

`08-youth-activities.md` and the `youth-d` plan both name this by quotation: *"a locked door
somebody was invited through"*.

## Root cause

`app/(app)/youth/EventList.tsx` gates the control on:

```ts
{canLog && canWriteFollowUp ? ( … )}
```

- `canLog` — the `youth_activities.log` permission. Says whether a leader may write follow-ups
  **at all**, never **which ones**.
- `canWriteFollowUp` — `isFollowUpWritable()`, which is only the clock and the cancelled flag.

Neither knows the event's organization. `youth-d` applied the ownership mirror to the
**ward-council flag** control (`canFlag` → `canManageActivityLog`) and not to the follow-up
control itself — so the lesson was half-applied inside the very slice that quoted it.

## Suggested fix

A `canWriteFollowUpOn(user, profile)` in `lib/youth/activityOwnership.ts`, beside
`canManageActivityProfile` and `canManageActivityLog`, mirroring migration 057c's INSERT policy:

```
with check (ward_id = current_ward_id()
            and logged_by = auth.uid()
            and (is_bishopric() or activity_event_is_in_caller_org(event_id)))
```

so: `is_bishopric() || profile.orgId === null || profile.orgId === user.orgId`.

**The `org_id is null` arm is not optional** — a ward-wide activity is writable by everybody, and
that case was verified working during the walk. `EventList` already holds the profiles
(`profilesQuery`), so the org is available without a new fetch.

**Do not narrow the API to match.** The route's 403 is correct and is what keeps the refusal
graceful; this is the UI agreeing with the boundary, not a second boundary (CLAUDE.md rule 2).

## Tests worth adding with it

- `tests/lib/activityOwnership.test.ts` covers `canManageActivityProfile` and **not**
  `canManageActivityLog`, which `youth-d` added untested. Both, plus the new helper, table-driven
  over the three arms.
- Scenario 056's checklist already carries the failing line, added during the walk:
  *"**"Say how it went" is absent on another organization's event.** Currently FAILS."*

## Widened during planning, 2026-08-28

**`app/(app)/youth/FollowUpPanel.tsx` has the same defect and this scope did not name it.**
"Waiting on your follow-up" gates its "Say how it went" button on `canLog` alone, with no
organization check of any kind.

It is reachable: `activity_attendees` writes are `is_bishopric() or user_id = auth.uid()`, so any
leader may add **themselves** to any organization's event. A Young Men president who signs up for a
Young Women game gets that game in their waiting list with a button the API refuses — the same
locked door, one component over.

Fixing `EventList` alone would ship this defect a fourth time inside the change that exists to
close it, so both call sites are in the plan. Confirmed with the user before planning.

**Also settled during planning:** the gate is not one check. Creating a follow-up is migration
057c's INSERT policy (organization); changing one is migration 058's UPDATE policy (author, no
organization arm). Using the INSERT rule on an existing log would hide "Change what you wrote"
from a leader who has since moved organizations but may still edit what they wrote — the mirror
mistake.
