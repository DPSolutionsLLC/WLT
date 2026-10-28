# ITER-054: Weekly Zoom attendance import

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-10-27
**Group:** GROUP-05 — Zoom stream: remote controls and invitees

## Summary
After sacrament meeting, the clerk or executive secretary downloads Zoom's participant report on
the church computer and uploads it in the Zoom module. The app matches each participant to an
invitee and records that week's attendance.

## Context
Raised 2026-10-27 by the user. Without Zoom API access a manual report download is the **only**
way attendance reaches the app. The user is happy with that: it becomes part of the clerk's
office routine right after sacrament meeting, on the church computer, by someone who already has
access to the church's Zoom account and its Reports.

The data this produces is new to everyone. The user wants to **pull as much as Zoom provides**,
see it, and only then decide what reports to build.

## Desired Outcome
- A place in the Zoom module to upload a Zoom participant/attendance report.
- Each row is matched to an invitee through the placeholder table (placeholder name/email) or a
  real registrant email.
- Attendance is recorded per person per meeting, updating ITER-053's **last attended** and
  **Sundays watched**.
- Rows that match nobody are shown, not silently dropped, so a person can sort them out.
- **Catch-up works.** If the regular person is away for a week or two, the missed weeks can be
  imported when they return — several weeks at once or one after another.
- **Re-importing a week never double-counts.** Importing the same meeting twice leaves the same
  result.
- **Who can import:** Bishop, both Counselors, Ward Clerk, Executive Secretary. (For the clerk
  and secretary this is the one write beyond editing ITER-052's questions; otherwise they are
  read-only.)
- **Shared-link detection:** flag a single link used from more than one place in the same
  meeting (overlapping sessions) — the prototype's "concurrency detection". Exact rule depends on
  what the real report contains.

## Scope Notes
- **Keep as much of the report as possible**, even columns not yet displayed, so later reports
  don't need a re-import. Build the reports themselves later, after seeing real data.
- **Zoom's data retention:** to the best of current understanding, Zoom keeps meeting
  participant reports for **about 12 months**, so a missed week or two is not urgent. Verify on
  the church account during planning (and whether the report's date range is limited per query).
- A recurring meeting has many occurrences under one meeting ID; the import must tell Sundays
  apart.
- Get a **real exported report** from the church account before planning — the column set
  decides the matching rule and the shared-link rule. Strip it of real names before it goes into
  the repo or a test fixture.
- Attendance attaches to the **person**, not the link (see ITER-053).
- Nothing reads the clock to refresh this; it is imported data (CLAUDE.md: computed, never
  stored — "last attended" and counts should be computed from the attendance rows).
- Times render in the ward's zone (rule 12).

## Open Questions
- Put a weekly "Import this week's Zoom attendance" reminder on someone's To Do? (Easy; the user
  hasn't decided.) If yes, on whose list?
- Which Zoom report exactly — Usage → Participants, or the meeting's attendee report? Planning
  checks which carries registrant email and join/leave times.
- How should someone who joined without a personal link (a non-registered guest) be treated?
