# ITER-024: One Event, One Youth — Or One Occasion, Many Youth?

**Type:** Decision (schema)
**Status:** Completed — **DECIDED 2026-08-29: Option A′**, and shipped as Phase 8 slice `youth-g`
together with ITER-020's parked event-detail half, as Sequencing below required.
**Completed:** 2026-08-29
**Commit:** 668debb
**Plan:** plans/youth-g-occasions-and-event-detail.md
**Retro:** plans/retros/youth-g-occasions-and-event-detail.md

**What shipped:** migration 059 (`activity_occasions`, identity only, ward-wide on all four verbs;
`activity_events.occasion_id` nullable with `on delete set null (occasion_id)`),
`/youth/events/[id]`, the join and unlink route, `occasionWithEventId` on event creation, and a
"+N others at this game" marker counted from the unfiltered list. Walked as scenario 059; three
defects found and fixed, none in the data layer. **ITER-027 is unblocked and ITER-025's sequencing
question is answered** — neither was built here.

**Answers taken at planning time**, all three from the Open section below:
`activity_occasions` is **identity only** (no name); the **ICS import does not create occasions**
in this slice; **cross-organization occasions are supported** and an RLS test asserts one, since
they fall out of A′ rather than being engineered. Two further decisions the scope did not settle:
a leader may **both** join two existing rows and add a missing young person, and `/youth/calendar`
**marks rather than collapses** — an occasion spans youth, organizations and activity types, so
collapsing would leave all four of that page's filters without a single answer.
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29, reviewing the ITER-021/022 walk
**Blocks:** ITER-020 (the useful half), ITER-027 (entirely)
**Related:** migration 009 (`activity_events`), migration 054 (org scope), migration 055 (ICS
import), `lib/youth/coverage.ts`, `lib/youth/activityOwnership.ts`

## Summary

The user described a view where you *"click on an event and see a list of all of the youth tied to
that particular event"*, with coverage meaning *"if there is at least one leader that has committed
to the event **for that youth**, then it shows fully covered — but if even one youth is missing a
commitment within that event, it shows an alert"*.

**That is not expressible today.** `activity_events.profile_id` is a single nullable foreign key to
one `youth_activity_profiles` row, and a profile is one young person doing one activity. So an
event belongs to exactly **one** youth. `activity_attendees` holds **leaders**, not youth.

Two young people on the same team, at the same game, are **two separate event rows** right now.

## The concrete case

Ethan Brooks and Josh Kim are both on varsity basketball. There is one game on Friday against
Roosevelt. Today the database holds:

| Row | profile | title | when |
|---|---|---|---|
| event 1 | Ethan Brooks · Varsity basketball | Game against Roosevelt | Fri 7pm |
| event 2 | Josh Kim · Varsity basketball | Game against Roosevelt | Fri 7pm |

Two rows, one real game. The calendar shows two cards. Nothing anywhere records that they are the
same evening in the same gym.

## What actually happens under each option

### Option A — leave it. One event row per youth.

**Changes:** nothing. No migration.

- The calendar keeps showing one card per youth. One game with four ward youth on the team is four
  cards on Friday.
- *"All the youth at this event"* stays unanswerable, so the event-detail screen in ITER-020 can
  only ever show one youth. Adding a youth you noticed was missing means creating another event.
- Coverage is already exactly per-youth, which is correct and is why the current badge looks like
  it half-does what the user wants.
- ITER-027 (who else will be there / potential contact) cannot be built at all.

### Option B — one event, many youth. A join table.

**Changes:** a new `activity_event_participants (event_id, profile_id)`, and
`activity_attendees` gains a `profile_id` so a commitment says **which youth** you are going for —
without that, an event with five youth and one leader reads "covered" and the entire point of the
module is lost.

Then **four things that currently have one answer each stop having one:**

1. **Which organization owns the event.** Today it inherits from its single profile, and that drives
   the follow-up gate ITER-021 just shipped plus the RLS policies. With Young Men and Young Women
   youth in one row, there is no single answer — it needs its own `org_id`, or a rule.
2. **What a follow-up is about.** `activity_logs` is one per (event, author). Is a comment about the
   evening, or about a young person? The user wants *"click on an event for an individual youth and
   see all of the comments"* — which means comments hang off a youth, so this table changes shape,
   and `activity_private_notes` follows it.
3. **Coverage.** `eventCoverage()` takes an attendee count; it would take a per-youth roll-up.
4. **The ICS import.** Its match key is `(ward, calendar, source_uid, recurrence)` and a calendar
   belongs to one profile. One uploaded file would need to fan out to several youth.

Cost: a migration plus rework of the four systems above, three of which shipped in the last week.

### Option A′ — keep one row per youth, and add the missing link between them. **CHOSEN 2026-08-29.**

**Changes:** one nullable column (or small table) saying *these event rows are the same real-world
occasion*. Nothing else moves.

The reason this is the right shape is that **the module's atom is already correct**. Its whole
purpose — FEATURES.md §Module 10, and the user's own words, *"committing yourself to make contact
with that youth while you are there"* — is a commitment to **a young person on an occasion**. That
triple is exactly what an `activity_events` row plus its attendees already is. Option A is not
wrong about the atom; it is only missing the fact that two atoms can share an evening.

So add just that fact, and every want in ITER-020 becomes reachable:

| The user wants | Under A′ |
|---|---|
| Click an event → all youth tied to it | the other rows sharing the occasion |
| Add a youth who is missing | create a row for them in the same occasion |
| Alert if any youth lacks a commitment | worst-of over the occasion's rows — the rule `coverageRank()` already uses for day cells |
| Click a youth → their events | already the profile |
| Comments per youth on an event | already what `activity_logs` is, unchanged |

And **all four of Option B's casualties survive untouched**: each row keeps one organization, so the
ITER-021 gate still has a single answer; coverage stays exactly per-youth; the ICS import is not
touched; follow-ups and private notes keep their shape and their guarantees.

There is a pleasing consequence for cross-organization work: an occasion may hold a Young Men row
and a Young Women row, and each leader writes about their own organization's young person. That is
the correct behaviour, and it falls out rather than being engineered.

## Decision, 2026-08-29

**Option A′**, chosen by the user on the reasoning above: the atom is already right, and what is
missing is only that two atoms can share an evening.

## Sequencing — the column is worthless alone

A stored link that nothing reads changes no screen. This scope should therefore be planned
**together with the event-detail half of ITER-020**, which is the thing that reads it, rather than
shipped as a migration on its own. ITER-020's unblocked half (the youth view, sort buttons,
committing from the calendar, youth detail) can still go first and is most of the value.

## The trap to avoid

**Do not group by matching the title and date.** Two rows reading *"Game vs Roosevelt"* and *"Game
against Roosevelt"* would not group, and near-miss string matching is the exact thing
`lib/youth/classifyLocation.ts` refuses by name — *"a near-miss a clever matcher would catch is
exactly the case where a person should be asked"*. The link must be **explicit and stored**, set
when the rows are created together or joined by a person afterwards.

## Open

- **Does the occasion need a name of its own**, or is it only an identity — a bag of event rows with
  no attributes? Start with identity only; a title, place and time already live on the rows and a
  second copy could disagree with the first.
- **How does the ICS import create them?** One file uploaded against one youth's activity produces
  that youth's rows. A second youth on the same team gets their own upload — should those land in
  the same occasion, and if so, on what key? This is answerable later; the column is useful without
  it.
- **Does an occasion ever span organizations in practice?** If a ward never does this, the feature
  is simpler than the above allows for.
