# ITER-042: Speakers & Prayers — a standalone tracker for the bishopric

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-10-14

## Summary
A new standalone module, **Speakers & Prayers**, where the bishopric records who spoke and who
prayed each Sunday, plans upcoming Sundays, and sorts households and people by how long since they
last spoke or prayed — so that everyone possible is cycled through. It reads people and households
from the real ward's roster and is the **source of truth** for speaking history from day one.

## Context
Third of three items in GROUP-03, and the reason for the group. The bishopric (the user plus the
bishop and first counselor) want to use a real tracker **now**, on real data, while the rest of the
app — including the Sacrament module, which also records talks and prayers — is still being built.

The user's original plan (`speaker-tracker-plan.md`, provided in chat 2026-10-14) gave the module
its own people/household tables imported from the ward list. Discovery changed that: the roster
itself is now imported from the same report (ITER-040), so the tracker reads the roster and keeps
only its own Sundays and assignments. It lives in the **real ward** (ITER-041), released there
alongside the tithing calculator.

**Direction of truth, decided:** this module's history is the real record. When Sacrament is
finished, its speaking history is migrated **from** this module — never the reverse — and nothing
recorded here is changed by that migration.

## Desired Outcome
- **People and households come from the roster** (ITER-040). No separate copy. Moved-out people
  keep their history attached but are not offered in pickers.
- **The tracker's own records:**
  - **Sundays:** date, notes, status (planned / held).
  - **Assignments:** type (opening prayer / closing prayer / talk), order (talks only), person — or
    a typed name for a visitor or edge case — speaking for (**Household / Quorum / Youth**, talks
    only), topic, notes, and who created / last updated it.
- **Age groups, computed on each Sunday's date (never stored):**
  - **Primary** until January of the year the child turns 12 (the Church's rule, derived from birth
    year).
  - **Youth** from then until the 18th birthday.
  - **Adult** from 18 (an 18-year-old still at home is an adult).
- **Rotation rules:**
  - A **Household** talk resets the household's clock **and** the person's own clock. A Primary
    child speaking with their family is a Household talk.
  - A **Youth** talk (a youth filling a slot, e.g. for a couple with no children) resets **only**
    that youth's clock; their household still comes up in turn.
  - A **Quorum** talk (speaking for a quorum, organization or calling) resets **only** the person's
    clock.
  - **Prayers** have their own person-level clocks and never affect household rotation.
  - A husband and wife speaking for their household on the same Sunday are two Household talks.
  - Everyone starts at **"Never"**; history is backfilled later.
- **No "due" status.** Households and people are sorted by time since last talk / prayer, with
  "Never" first. The user analyses by sorting and filtering and decides for themselves.
- **Screens:**
  1. **Sunday Planner** (default). Pick a Sunday, defaulting to the next upcoming one. Add the
     opening prayer, closing prayer and speakers. The person picker is a type-ahead over active
     people of all ages, with a free-text fallback, **ordered so whoever has waited longest comes
     first**. Speakers drag to reorder; each gets a Speaking For tag. Beside each picked person:
     last talk, last prayer, household's last talk. Below: a **generated plain-text message** that
     updates live, with one **Copy** button:
     ```
     Sacrament Meeting – Sunday, Oct 19
     Opening Prayer: Jane Smith
     Speakers:
     1. John Doe
     2. Mary Doe
     3. Sam Jones (youth)
     Closing Prayer: Bob Brown
     ```
     (with each speaker's topic when one is entered).
  2. **Households** — sortable by time since the household last spoke ("Never" first); columns:
     household, number of adults / youth / Primary, last household talk, days since. Expand to see
     each member's last talk and prayer.
  3. **People** — search; filter by age group, gender, moved out; sort by last talk, last prayer,
     total talks, never spoken.
  4. **History** — past Sundays, each openable and editable; **keyboard-friendly entry** so
     backfilling a couple of years is fast.
- **No Suggestions screen** — dropped in discovery. Households and People are the "look and
  ponder" screens; the planner's pickers carry the same ordering at the point of choice.
- **Shared and live:** all three bishopric members see and edit the same data, and an edit by one
  appears for the others.
- **Name:** "Speakers & Prayers" (dashboard tile and module title).
- **Done when:** the bishopric plans a real Sunday in the real ward, copies the message, and sees
  that Sunday reflected in the Households and People sorts afterwards.

## Scope Notes
- **Out of scope:** any change to the existing Sacrament module or its data; merging into
  Sacrament (a later migration); topics library, music, conducting sheet, programme printing;
  sending texts or notifications (copy only); AI suggestions; importing the user's historical
  document (a separate later task); ministering, callings or any other module exposure.
- **Two records of who spoke** will exist for a while (this module and Sacrament). That is a
  deliberate stopgap: in the real ward only this module is released, and Sacrament's records live
  in the test ward. The later migration is one-way, from here.
- **Dates:** a Sunday is a `date`; anything rendered from a timestamp names its zone (CLAUDE.md
  rule 12).
- **Privacy:** speaking history is leaders-only and never published.
- A typed-name assignment (visitor) has no clock to reset and appears in no household or person
  sort.
- A person who moves household between imports: their talks stay theirs; which household a past
  Household talk counts for needs a decision in planning (the household at the time, most likely).
- Real-time sync between three users: planning decides the mechanism; the requirement is that one
  user's edit is not silently overwritten by another's stale screen.
- The user's original plan asks for a build-notes entry for this build (bugs found and fixed, what
  was deferred, what is real versus stubbed) — fold into the retro.

## Open Questions
- When a person changes household between imports, does a past Household talk count for the old
  household or the new one?
- Should the copied message use first + last name, or the preferred name as the roster holds it?
- Does "held" need to be set by hand, or is a past Sunday held by the calendar (computed, not
  stored, per the project's convention)?
- What should the planner do with a Sunday with no sacrament meeting (stake or general
  conference)?
