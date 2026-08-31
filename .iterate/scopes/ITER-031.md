# ITER-031: Removing an Activity Destroys a Cascade Nobody Was Warned About

**Type:** Bug
**Status:** In Progress
**Plan:** plans/youth-h-season-close-and-safe-remove.md
**Created:** 2026-08-30
**Found:** 2026-08-30, walking scenario 050 (`050-D1`). Not a checklist line — the walk found it.
**Raised to product by:** the user, 2026-08-30: *"it needs to be more clear as to what you are
removing… removal from either an individual or globally should not be allowed once follow up info
has been input by any user… the current youth could be disconnected."*
**Related:** `app/(app)/youth/ActivityProfileList.tsx:317`, migration 009 (the cascade),
`app/(app)/knowledge/DocumentList.tsx:133` (the house rule), `visits-f` (the refusal precedent),
`youth-g` (occasions), CLAUDE.md rule 5

## The defect

`ActivityProfileList.tsx:317` is:

```tsx
<Button variant="danger" onClick={() => deleteMutation.mutate(profile.id)}>Remove</Button>
```

No confirm. No undo. The red danger button fires on one click.

Migration 009 makes every hop below it `on delete cascade`:

```
youth_activity_profiles → activity_events → activity_attendees
                                          → activity_logs → activity_private_notes
```

So one click destroys the activity, **a whole season of games, every leader sign-up, every pastoral
follow-up, and the private notes attached to them** — the rows CLAUDE.md rule 5 calls private
forever, which the bishopric itself cannot read.

Observed twice during the walk: removing *Jazz band* took *Winter concert* with it
(`activity_events` 3 → 2); removing *Varsity basketball* took all three remaining events (3 → 0).

**The audit row does not record what was lost.** Its `detail` holds `orgId`, `memberId` and
`profileId` only, so nothing anywhere — not the log, not the UI — says a season and its notes went.

## What the button does NOT do, and why the confusion is the point

The user asked whether Remove takes the event *from the individual* or *globally, affecting every
youth tied to it*. The factual answer is **from the individual**: Remove sits on an activity
("Ethan Brooks — Varsity basketball"), `activity_events.profile_id` is a single foreign key, and
two team-mates at one game are two separate rows. Even when `youth-g` links them as one occasion,
removing Ethan's activity leaves the other young person's rows untouched.

**That is the correct behaviour and the button gives the reader no way to know it.** A leader who
believes Remove might wipe a fixture for four families will not press it; a leader who believes it
only tidies their own list will press it over a season of follow-ups. Both readings are available
from the same word.

## The fix has three parts, and the middle one is the substantial change

### 1. Say what is being removed

Name the young person and the activity, and say plainly that other youth at the same games are not
affected. `DocumentList.tsx:133` states the house rule already:

> *"Worded by CONSEQUENCE, not by action. 'Are you sure?' tells somebody nothing they did not
> already know; naming the passage count and saying what is NOT affected is what lets them answer
> it (the calendar-b confirm dialog is the precedent)."*

Applied here that is roughly: *"Removing Varsity basketball from Ethan Brooks deletes 12 games and
3 sign-ups. Other young people at the same games are not affected."* Twelve `window.confirm` sites
already exist; nothing needs designing.

### 2. REFUSE the delete once anybody has written a follow-up

**This is the user's rule and it is stronger than a confirm.** A follow-up is somebody's pastoral
record of a real conversation; it should not be destroyable as a side effect of tidying a schedule,
and a dialog that can be clicked through is not protection.

The precedent is `visits-f`'s empty bulk replace: **refused, with a sentence naming the
alternative**, rather than confirmed. Same shape here.

Note the refusal must consider follow-ups written by **any** author, including ones the reader
cannot see — `activity_logs` reads are org-scoped (migration 057c), so the check has to run
server-side against a count the reader is not shown. *"This activity has follow-ups recorded
against it"* without naming them is the right amount to disclose.

### 3. Offer the alternative the refusal names — unlink, don't delete

The user supplied it: *"if another youth has had someone report a followup, then the current youth
has yet to have anyone report, then the current youth could be disconnected."*

Two candidate meanings, and they are not the same thing — **this needs settling before build**:

- **Unlink from the occasion** (`activity_events.occasion_id = null`), leaving this young person's
  own events and history intact. Cheap, reversible, and exactly what `youth-g` built the nullable
  link for.
- **Close the activity rather than delete it** — which is **ITER-028**, already in the backlog.
  A season nobody is playing any more, whose history stays reachable, is precisely what "I want
  this off my list" usually means.

**These two items should be read together.** If ITER-028 ships first, "Remove" may only need to
become "Close", and the destructive path can be reserved for genuine mistakes — an activity created
in error, with nothing recorded against it. That is a much smaller surface to guard.

## Open questions

- **Should the confirm name the follow-ups and private notes at all?** The deleter may not be able
  to read them and may not know they exist. Naming a count discloses less than naming content and is
  probably right, but it is a rule 5 judgement, not an obvious call.
- **Is there any case for a hard delete once ITER-028 exists?** Possibly only "created by mistake,
  nothing attached" — which the refusal in part 2 already describes.
- **Does the same gap exist on event `Cancel`?** No — cancel is reversible and was walked. But
  nothing offers a *delete* of a single event today, and if one is ever added it inherits all of
  this.

## Deliberately not in scope

- **Changing who may press Remove.** `canManageActivityProfile()` was walked in scenario 049 across
  four accounts and is correct. This is about what the press does, not who may do it.
- **Softening the cascade in the schema.** The `on delete cascade` chain is right — an orphaned
  private note pointing at a deleted log would be worse. The guard belongs in the route and the UI.
