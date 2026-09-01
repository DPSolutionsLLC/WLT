---
id: youth-empty-roster
status: confirmed
commit: df25b40
date: 2026-08-31
area: youth-empty-roster
related_retros: [youth-j-team-and-roster]
supersedes: null
---

## What was tested

Scenario 063 — the two silences. The user began the walk themselves, signed in, and handed it to
Claude, who drove the rest via Playwright on localhost against the hosted project as
`yw-president` and then `yw-secretary`. Every write read back with a service-role client. Marked
**confirmed** on the user's instruction.

### NOT verified

The deployed build (063's seed data never existed on production); no real device — the mobile
shots are **412px, not 375**, because Samsung Galaxy device emulation overrode the viewport; the
bishopric path; Sofia's `/youth/history` page, which this scenario does not ask for.

## Result — 13 checks, 0 defects, 0 checklist corrections

Both coverage answers were computed from the stored rows through the real `eventCoverage()` and
`eventYouthAttendance()` **before the browser was opened**, and every one matched the screen.

**An empty roster stays LOUD.** The Concert Choir has nobody on it; its four concerts carry real
badges — `uncovered` at 2.0 and 5.0 days ("Nobody going"), `unassigned` at 12.0 and 20.0
("Nobody yet") — and the strip reads *"2 home events in the next week with nobody going: Choir
concert 1, Wed, Sep 2, 7:00 PM; Choir concert 2, Sat, Sep 5, 7:00 PM."* Strip and cards name the
same events. This is `lib/youth/roster.ts` branch 5 proved on a screen rather than in a unit test.

**A closed season goes QUIET.** Cross Country's two post-close meets are upcoming with nobody
signed up and raise nothing — `no_expectation / season_closed` → `not_expected`, no badge, no
strip entry. That is the ITER-033 leak closed where a person can see it.

**Reversible in both directions:** reopening the season took the strip 2 → 3 and gave meet 3 a
"Nobody going" badge; closing it again took both away. `closed_at` moved in the database each way.

Other observed values: adding Clara Brooks put her on `/youth` immediately at a genuine **0%**
(*"No home games played yet, and nobody is down for the next one."*) and left Sofia's card
identical; the create form says *"You can leave this empty and add the young people once the
schedule is in."*; `Remove` is absent on the choir (4 events); every mutation wrote an audit row;
zero console errors.

**An `org_secretary` account was added to the seed mid-walk** — the Failure Behavior check asked
for that sign-in and no such account existed, the identical gap found in scenario 062 the same
day. The check then passed: zero buttons on the activity card, with the roster, the sentence and
`I'll go` still present.

## Open, and carried forward rather than fixed

- **The empty-roster sentence does not change for a reader who cannot act on it.** An
  `org_secretary` sees *"…until **you add** the young people who play"* beside no control to add
  anybody. The gate is right; the wording addresses an action to somebody who cannot take it.
- **One checklist line contradicts itself:** *"never `0%`"* with a parenthetical saying a genuine
  `0%` is correct. Read quickly it would score a working app as a failure.

Both are wording decisions, both are recorded in the scenario file, and neither blocks anything.
