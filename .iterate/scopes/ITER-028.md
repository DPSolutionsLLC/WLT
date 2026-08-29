# ITER-028: Closing Out a Season, and the History That Outlives It

**Type:** Feature
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29, reviewing the scenario 057 walk: *"we need to be able to close
out a season so the stats do not show anymore. it would still be very nice to be able to look at
their history. a link within their card to look at their history would be good. as well as maybe a
historical page to see an overview of all the youth should be considered."*
**Related:** `youth-f` (the support percentage), `lib/youth/profileNeed.ts`,
`app/(app)/youth/YouthOverview.tsx`, ITER-026 (a leader's own page)

## Summary

`/youth` ranks young people on a **support percentage** computed from every past home game on a
profile plus the next one. Nothing ever leaves that computation. A basketball season that finished
in February keeps contributing to Ethan's number in October, and a ward that has run this app for
two years is ranking its youth on games nobody remembers.

The ask is three things, and they are separable:

1. **Close out a season** so its stats stop appearing on `/youth`.
2. **Keep the history reachable** — a link on the young person's card to what happened.
3. **Possibly a historical overview** across all youth, as its own page.

## This reverses a standing decision, deliberately

`CLAUDE.md` §9 has said since `youth-f`:

> **No season boundary is introduced.** If a ward is ever found reusing one profile across years,
> that is when a season model is worth designing — not before.

That test was "wait until a ward does something wrong". It has been **superseded by a direct
product request**, which is a better reason than the one it was waiting for. Record the reversal
rather than quietly contradicting the entry.

## What already exists, and how far it gets

- **`youth_activity_profiles.season_schedule` is free text** (`"November to February"`). Nothing
  can compute against it and nothing should start trying to — it is a note for humans. A close-out
  needs a real column.
- **A profile is already one activity for one season** by convention, which is the whole reason
  `youth-f`'s "every event on the profile" arithmetic is defensible. That convention is the thing
  this scope makes enforceable rather than assumed.
- **`lib/youth/profileNeed.ts` is pure and takes `asOf` as a parameter.** A closed season needs no
  new arithmetic — it needs to not be passed in.

## Shape

**Schema.** A `closed_at timestamptz` on `youth_activity_profiles` (nullable; null means running).
A timestamp rather than a boolean, because "when did this season end" is the question the history
page asks and a boolean cannot answer it. **Never a delete** — the record is the point.

**The read path.** `/youth` shows running profiles only. The obvious trap: a young person whose
every profile is closed must **not** vanish from the ward, and must not read as a young person with
no activities. Decide explicitly whether they drop off `/youth` or appear with a "nothing running"
state — `describeHouseholdForVisits()` is the precedent for making that one function's answer.

**The percentage.** A closed season's number is **frozen at close**, not recomputed — the "plus the
next one" half has no meaning once nothing is next. Whether it is stored at close or recomputed
with a `closed_at` horizon is the one real design question here, and it is the same
stored-versus-computed argument this module has had six times. Computing it with the close date as
the clock is almost certainly right and keeps the "nothing in this project refreshes anything" rule
intact.

**The card link.** "See their history" on each card, to a per-youth page listing closed seasons
with their final numbers and their events.

**The overview page.** Deliberately last, and possibly cut. It is a reporting screen, and the ward
has not asked what question it answers yet.

## Who may close a season

`youth_activities.manage`, on the owning organization — the same gate that created the profile.
Not `.log`. A closed season is a coordination decision, not a pastoral note, so migration 054d's
write policies already describe the right boundary and no new policy shape is needed.

## Open questions

- **Does closing a season close its events?** An event on a closed profile is still a fact. It
  should stay readable on the calendar and the feed; only `/youth`'s ranking excludes it.
- **Reopening.** A season closed by mistake must be reopenable, which is why `closed_at` is
  nullable rather than a one-way flag.
- **Does the follow-up panel still surface a closed season's unwritten follow-ups?** Probably yes —
  the leader still owes the account — but it is a decision, not an obvious answer.
- **Interaction with ITER-026.** A leader's own page and a youth's history page are two different
  cuts of the same rows. Build the youth one first; do not let them fork.

## Sequencing

Independent of ITER-024 → ITER-027, which are blocked on the occasion link. This one blocks on
nothing and can be planned as soon as it is wanted.
