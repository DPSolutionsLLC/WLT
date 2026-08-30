# ITER-030: Nobody Could Have Gone — Recording That the Young Person Missed It

**Type:** Feature
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-30
**Raised by:** the user, 2026-08-30, reviewing the scenario 050 re-walk: *"we probably should add an
option to report that a youth did not go to a particular event. maybe they missed it for whatever
reason. in that case, the event is removed from that youths statistics all together. shouldn't be
counted as attented or missed. and not counted against to calculate their support factor."*
**Related:** `youth-f` (the support percentage), `youth-c` (`cancelled`),
`lib/youth/profileNeed.ts` §`carriesCoverageExpectation`, `lib/youth/coverage.ts`,
migration 056 (`activity_events.status`), CLAUDE.md §9 "Youth support is CONFIRMED attendance"

## Summary

The support percentage measures the share of a young person's past **home** games where at least one
leader said "I went". It assumes the young person was at the game. Nothing in the schema can say
they were not.

So a youth who breaks an ankle in December and misses six games is measured, all winter, on six
games **nobody could have attended them at** — and every one of those counts against them. The
number reports neglect that did not happen, which is the exact failure `youth-f` fixed in the other
direction when it refused to render `0%` for a young person with no home games.

## Why this is a gap rather than a new idea

The model **already excludes three categories of event from the denominator**, each for the same
underlying reason — do not measure support nobody was expected to give:

| Excluded | Because |
|---|---|
| `away` games | No coverage expectation by design (`08-youth-activities.md` §Step 4) |
| `cancelled` games | It did not happen |
| `tbd` location | Not known to be a home game, and a wrong `away` guess is worse than asking |

"The young person was not there" belongs in that table and is missing from it. All four are the same
sentence: *this game could not have been a chance to support them.*

The precedent is explicit in CLAUDE.md §9: rendering `0%` "would put the one person nobody could
possibly have supported at the top of 'least supported', which is `visits-f` exactly." A missed
season does the same thing more slowly.

## Where it goes

**One predicate, one place.** `lib/youth/profileNeed.ts` has exactly one function deciding what
counts:

```ts
function carriesCoverageExpectation(event: ProfileNeedEvent): boolean {
  if (event.status === "cancelled") return false;
  if (event.eventType !== "home") return false;
  return Number.isFinite(new Date(event.eventDate).getTime());
}
```

`isExpectedPast()` and `isExpectedNext()` are both this predicate plus a side of the clock, and its
header comment says a second copy is what would let somebody retune one of them. **This feature is a
fourth line in that function and nowhere else** — which is also what makes it cheap.

`lib/youth/coverage.ts` must be checked in the same change: a missed game should presumably stop
reading as *uncovered* on the calendar too, for the same reason it stops counting.

## Storage — a column, not a computation

This is the one place in Phase 8 where a **stored value is right**, and the precedent is exact.
CLAUDE.md §9 on `cancelled`: *"a called-off game is a fact a person knows and nothing else can
express."* Whether a young person turned up is the same kind of fact. It is not clock-derived, so
none of the "computed on read" reasoning (`coverage.ts`, `appointmentViewState()`,
`householdVisitPriority()`) applies against it.

`activity_events.profile_id` is a single foreign key — an event belongs to exactly **one** young
person — so the fact has an unambiguous home on `activity_events`.

## The design question that must be settled first

**Is "the youth missed it" a `status` value, or a separate column?**

`status` is currently `upcoming | cancelled` (migration 056 dropped `completed`). Adding
`youth_absent` there is tempting and is probably **wrong**: status answers *did this event happen*,
and a game the young person missed still happened — other youth may have been at it, and under
`youth-g` it may share an occasion with rows that are entirely unaffected. Collapsing the two would
make "the game was called off" and "Ethan was ill" the same fact, and the record of which is which
is the thing a presidency actually needs.

**Recommendation: a separate nullable column** — three states, not two. `null` = nobody has said;
`true` = they took part; `false` = they missed it. Null-means-unknown is the same idiom as
`activity_attendees.confirmed_attendance`, and it keeps "assumed present" distinguishable from
"confirmed present", which `youth-c` established is worth preserving (the `.default("tbd")` removal
was exactly this argument).

## Open questions

- **Who may record it?** Probably the same gate as the follow-up (`canWriteFollowUpOn()`), not the
  wider `youth_activities.manage` — this is pastoral knowledge, not schedule management.
- **Where is it offered?** The follow-up form already asks "did you go?" of the leader. Asking "did
  *they* go?" beside it is natural, but ITER-021/022's lesson applies: it must not appear
  unprompted, and it must not be offered on a row the reader cannot write.
- **Does a missed game show on the card at all?** It should almost certainly stay visible and
  marked — the `do_not_contact` rule from visits, where a household stays *shown and marked* and is
  counted in nothing. Making it vanish loses the record.
- **Does it interact with ITER-028's season close?** A closed season and a missed game both remove
  events from the live number by different routes; whichever ships second should read the first.

## Deliberately not in scope

- **Any inference.** A young person's absence is never derived from an empty attendee list, a
  cancelled sibling event, or anything else. This is `classifyLocation.ts`'s refusal of near-miss
  matching in a third place: a person knows this and nothing else does.
- **Attendance tracking for youth generally.** This records an exception so a metric stays honest.
  It is not a register, and it must not grow into one — `activity_attendees` is leaders, and it
  stays leaders.
- **Changing the horizon.** `youth-f`'s "every past home game plus the next one" was set by the
  user and is not reopened here.
