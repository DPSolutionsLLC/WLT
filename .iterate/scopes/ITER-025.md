# ITER-025: Should Being There Earn The Right To Comment?

**Type:** Decision (policy)
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29: *"anyone should be able to click on the event and add their
comment after they confirm that they were present"*
**Related:** ITER-021 (which made the current rule visible), migration 057c, migration 058,
`lib/youth/activityOwnership.ts`

## Summary

Today a follow-up may be written by the bishopric, or by a leader in the organization that owns the
event. A leader from another organization **who actually attended** cannot write one — the route
answers 403 and, since ITER-021, the button is correctly absent.

The user wants presence to be enough.

**This is a policy decision, not a bug.** ITER-021 was right: it made the screen agree with the
database. The question here is whether the *database rule* should change.

## What is already true, and is not the problem

Both of these were verified on 2026-08-29 and neither needs work:

- **Several leaders can commit to one event.** `activity_attendees` writes are
  `is_bishopric() or user_id = auth.uid()`, so any leader may add themselves to any event. Two
  attendee rows on one event were observed during the walk.
- **Each leader gets their own follow-up.** The constraint is
  `activity_logs_one_per_author unique (event_id, logged_by)` — one per **author**, not one per
  event. Several leaders each writing their own comment is built and works.

The only thing missing is that the *organization* gate stands between an attending leader and the
comment box.

## The case for changing it

A leader who was in the gym saw what happened. Their account is the one worth having — this is the
same reasoning `app/api/youth/logs/route.ts` already uses to let somebody file a follow-up on an
event they never signed up for. Refusing the person who was actually present, while accepting one
who was not but happens to be in the right organization, is hard to defend on its own terms.

## The case against, and what it protects

The org gate is not arbitrary. `08-youth-activities.md`'s reasoning, carried into migration 057c,
is that **writing is where coordination becomes misrepresentation** — an Elders Quorum president
entering something "for the Young Women" is not coordination, it is somebody believing they did
something they did not. Reads are ward-wide precisely so the gate can sit on writes alone.

There is also a shape to be careful of: `activity_attendees` writes are self-service, so
"presence" is **self-asserted**. A rule of "anyone who says they were there may write" is a rule of
"anyone may write", reached in two steps. That may be perfectly fine — but it should be chosen
knowingly, not arrived at.

## Options

1. **Attendance earns it.** An attendee row on the event admits a follow-up, whatever the
   organization. Simple, matches the user's words. Note the self-assertion above.
2. **Attendance plus a confirmed answer.** Only a leader who has answered *"I went"* may write.
   Slightly stronger, and it gives `confirmed_attendance` a second job it is well suited to.
3. **Leave the gate, widen the reader instead.** Keep writes org-scoped and make sure the owning
   organization can see that an outside leader attended, so they can ask them. Cheapest, and
   probably unsatisfying.

## Sequencing

**Settle ITER-024 first.** If an occasion can hold rows from two organizations, a leader who wants
to comment on the young person they actually spoke to may find that person is simply a different
row — one their own organization owns — and the problem partly dissolves without a policy change.
Deciding this one first risks widening a policy that did not need widening.

## Not in scope

**Private notes do not move.** Whatever is decided here, `activity_private_notes` stays readable
only by its author (CLAUDE.md rule 5). Widening who may write a shared comment must not widen a
private note by one row, and any plan for this must say so explicitly.
