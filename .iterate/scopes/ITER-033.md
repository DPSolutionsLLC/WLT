# ITER-033: A Team Has One Schedule and a Roster — Not One Schedule Per Young Person

**Type:** Architecture / Feature
**Status:** In Progress
**Plan:** plans/youth-j-team-and-roster.md
**Created:** 2026-08-31
**Raised by:** the user, 2026-08-31, reviewing the `youth-i` walk: *"i want the app to assume that
the connections made through initial channels is correct… i want as little friction as possible
setting up the connections to start with and then minimal friction after that to take care of edge
cases… someone simply has to go through each individual youth in the app and assign them to an
activity. then the app knows what events to tie the youth to."*
**Related:** `youth-a` (the model this changes), `youth-b` (ICS import), `youth-g`
(`activity_occasions`), `youth-h` (`closed_at`), `youth-i` (migration 061), ITER-030

## Summary

There is no **team** in this app. There is only *one young person's copy of a team*.

`activity_events.profile_id` is a **single** foreign key, so an event belongs to exactly one young
person. `activity_calendars.profile_id` is `NOT NULL` (migration 055c) and
`POST /api/youth/calendars/import` takes a `profileId`, so **a schedule is imported into one
youth's activity**. Consequently a squad of eight players on one twelve-game season is **eight
profiles, eight imports of the same file, and 96 event rows for 12 real games** — and
`activity_occasions` (migration 059) then exists to re-link those duplicates **one game at a time,
by hand**, so a card can say "+2 others at this game".

The user's model, stated 2026-08-31 and confirmed as the common case for this ward
(*"several youth share the same team schedule"*):

> Activity (Varsity Basketball) → **one** imported schedule → a **roster** of young people →
> the app derives youth × event.

Import once. Assign each youth once. Everything after that is edge cases.

## Why this is the right shape, not merely a cheaper one

**`activity_occasions` largely stops being necessary.** It exists only to repair a split the current
model creates — it re-links rows that describe the same evening. Under a roster, they were never
separate. A construct whose whole purpose is to undo the model's own damage is evidence the model is
wrong, not evidence the construct is clever. (What may survive is the genuinely cross-activity case:
one evening where a Young Men basketball game and a Young Women concert coincide. That is a
different question from "two team-mates at one game" and should be settled explicitly.)

**It also fixes a class of bug rather than an instance.** Today the same real-world game exists as N
rows that can silently disagree — one cancelled and one not, one corrected to `home` and one left
`tbd`, one re-imported and one not. There is no constraint that can hold them in step, because
nothing in the schema knows they are the same game.

## What changes, and what a plan has to settle

### The model

- A **team/activity** entity carrying the schedule: name, school/org, season, activity type,
  organization, and its ICS calendar. Roughly today's `youth_activity_profiles` **minus the
  member**.
- A **roster** join: (team, member), with a start and an end — see "leaving mid-season" below.
- `activity_events.profile_id` becomes a reference to the **team**, not to a young person.

### Where the exception markers move — AND THIS SUPERSEDES PART OF `youth-i`

`youth-i`'s migration 061 put `youth_attended` **on the event**, which was correct *only because* an
event belonged to exactly one young person. Once one event serves a roster, **"was this young person
taking part?" is a fact about (youth, event), not about the event**, and the column has to move to
the roster×event join. Migration 061 is therefore superseded by this item — not wrong, but scoped to
a model that is changing under it.

**What survives from `youth-i` unchanged**, and should be reused rather than rewritten:

- the fourth exclusion in `carriesCoverageExpectation()` and the whole metric argument;
- **null means nobody has said; never inferred; `true` is not a no-op** (the three-state rule);
- **an em dash, never `0%`**, and null sorting last in both directions;
- reversibility — pressing the active answer clears to null rather than to the other claim;
- the follow-up rule: **the prompt stops, the door stays open** (`isFollowUpWritable()` untouched);
- an ICS re-import never clears a hand-made mark.

### Leaving mid-season — the second thing the user asked for and which does not exist

> *"say someone moved away and an individual youth will be gone for the rest of the season, we
> should be able to indicate that as well."*

`youth_activity_profiles.closed_at` (migration 060a) closes a **whole activity**, meaning *this
season finished*. It is adjacent but not the same fact, and under a roster it is plainly the wrong
place: closing the team would end the season for **everybody**. This belongs on the **roster row** —
an end date, after which that young person's events stop counting for them while the team's schedule
carries on.

**A known leak to fix with it:** `ActivityCalendar` never reads `closed_at` at all (verified
2026-08-31), so a closed season's future games still render and still raise "Nobody going". Whatever
the roster's end-date rule turns out to be, the calendar has to honour it.

### The `youth-i` control's presentation — the defect that surfaced this

The Yes/No fieldset renders on **every** event card with nothing selected, so an optional exception
**reads as a question being asked of the reader on every row**. The user reacted to exactly this
from a screenshot: *"it appears that we are going to have to confirm every connection between an
individual youth and an event?"* It never did require that — but a control that has to be explained
is a control that is wrong. Whatever the model, the marker must **read as an exception**: absent
until invoked, not a standing unanswered question.

## Open questions for planning

1. **Migration path for existing rows.** The harness ward is disposable, but the Development Ward
   may hold real profiles and events. Does this collapse duplicate profiles into teams
   automatically, or is it expand-and-contract with a manual re-assign step?
2. **Does a team need an organization, or does it inherit per-roster-member?** A team could hold
   Young Men and Young Women (a mixed school squad). 054d scoped writes by `org_id` on the profile;
   that has to be re-derived.
3. **What happens to `activity_occasions`?** Retire it, or keep it for the genuinely
   cross-activity coincidence? Migration 059's decision text argues an occasion is an explicit
   stored identity and must never be inferred — that argument survives for the cross-activity case
   and dies for the team-mates case.
4. **Does a roster row carry a start as well as an end?** A youth joining in January is the mirror
   of one leaving in February, and the metric's denominator needs to know.
5. **Coverage and the support percentage become per-(youth, event) reads over shared events.** The
   arithmetic does not change, but every construction site does. `SupportEvent` is built in three
   places today.
6. **What does "assign a youth to an activity" look like as a screen?** The user's phrasing —
   *"someone simply has to go through each individual youth in the app and assign them to an
   activity"* — suggests youth-first, not team-first. Both directions may be wanted.
7. **JV vs Varsity from an imported calendar.** The user asked whether the import can split
   activities by level *"if the calendar breaks it down well enough"*. That is a parsing question
   and should be scoped separately from the model change — and probably answered "a person
   confirms", per `classifyLocation.ts`'s standing refusal of near-miss matching.

## Answered during planning — 2026-08-31

All seven settled before `plans/youth-j-team-and-roster.md` was written. Four were put to the user;
three were answered from the codebase.

1. **Migration path — automatic, and lossless.** Every existing profile becomes a team with a
   roster of exactly one (migration 062b), so no screen moves on the day it applies. **No merge
   path is built**: collapsing duplicates would destroy one profile's events, sign-ups and
   follow-ups, which is what `youth-h` narrowed `Remove` to prevent and what `visits-f` refused
   for empty bulk replace. Shipped expand-and-contract — 063 drops `member_id` after the deploy.
2. **`org_id` stays on the TEAM, unchanged.** A mixed squad is `org_id = null`, which already
   means ward-wide and already lets everybody write (054d's explicit branch). Per-roster-member
   scoping would be a second scoping rule for a question answered once — the thing 054d, 055c and
   056c each refuse by name.
3. **`activity_occasions` is KEPT, untouched.** It still answers the cross-activity coincidence a
   roster cannot. "+N others at this game" now reads the roster first and the occasion second —
   one list, two sources, both named.
4. **The roster row carries BOTH a nullable `started_on` and a nullable `ended_on`**, `date`
   columns a person picks, both absent by default (absent means the whole schedule). Symmetric,
   and the denominator needs both.
5. **The three `SupportEvent` construction sites collapse into one** exported `buildSupportEvents()`
   — and the window rule lives in exactly one function, `memberIsExpectedAt()`, which takes the
   membership start, the membership end **and** the team's `closed_at`. That is what closes the
   `ActivityCalendar` leak by construction rather than by a fourth screen remembering to check.
6. **Both directions, one route.** Youth-first on an expanded `/youth` card (the user's words) and
   team-first on `/youth/profiles` (where the schedule lives), both posting to
   `POST /api/youth/profiles/[id]/roster`.
7. **JV vs Varsity parsing stays out**, as this file's own text recommends. A person confirms.

**And one decision this scope did not anticipate:** an **empty roster stays LOUD**. "Nobody is
assigned yet" and "nobody is expected" must not be answered the same way, or a freshly imported
season leaves the coverage model with no badge anywhere saying so — `classifyLocation.ts`'s refusal
of near-miss matching, in a fourth place. Only a **closed season** goes quiet.

## Not in scope

- Re-opening the horizon rule (*every past home game plus the next one*), set by the user 2026-08-29.
- Google Calendar sync, still cut.
- Any notification or scheduled re-sync — Phase 11 already inherits six clock-driven things.
