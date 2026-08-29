---
id: youth-d-followup-and-report-feed
type: feature
iter: null
commits: [99af99f]
date: 2026-08-28
files:
  - lib/youth/activityLogs.ts
  - lib/youth/followUp.ts
  - lib/youth/privateNotes.ts
  - lib/youth/reportTiles.ts
  - lib/youth/activityOwnership.ts
  - lib/reports/preview.ts
  - lib/notifications/notifyWardCouncilFlag.ts
  - app/(app)/youth/FollowUpForm.tsx
  - app/(app)/youth/FollowUpPanel.tsx
  - app/(app)/youth/feed/YouthReportFeed.tsx
  - supabase/migrations/057_activity_logs_followup.sql
  - supabase/migrations/058_activity_log_update_check.sql
related:
  - youth-a-profiles-and-events
  - youth-b-ics-import
  - youth-c-coverage-and-calendar
  - visits-c-report-feed-and-cross-org
  - visits-a-goals-logs-and-notes
  - notification-trigger-drift
---

## What was done

Phase 8 slice D, the last: the game after it is over. A leader who was down for an event records
what happened — `activity_logs` holds the shared note, `activity_attendees.confirmed_attendance`
gets its first writer since Foundation B, and `activity_private_notes` gets its first row plus
CLAUDE.md rule 5's four independent mechanisms. `/youth/feed` is the youth return-and-report feed,
and a *Waiting on your follow-up* panel on `/youth` is how a leader finds out there is anything to
write at all.

**Written 2026-08-29, a day late.** Slices A, B and C each got a retro on the day; this one shipped
without one, and `plans/retros/INDEX.md` had no line for it either. That gap is not incidental to
what happened next — see below.

## Key decisions

- **A pastoral follow-up is org-scoped, while the calendar stays ward-wide.** Migration 057c gives
  `activity_logs` `visit_logs`' shape, resolved through the event's profile by a `security definer`
  helper with an explicit `profile.org_id is null` arm. This is the **one** read Phase 8 narrows,
  deliberately opposite to migration 054's rule, and the asymmetry is the feature: coordination data
  is shared, a pastoral note is not. The cost is named rather than discovered —
  `ward_council_member`, the role most likely to have no organization at all, sees only ward-wide
  follow-ups, its own, and everything when cross-org visibility is on.

- **A policy cannot express column immutability, and 057c tried.** Its UPDATE carried
  `with check (… and logged_by = auth.uid())`, meaning to stop reattribution while letting the
  bishopric clear a flag. WITH CHECK sees only the row that WOULD RESULT, never the row that was, so
  it locked the bishopric out of the one thing the USING clause had gone out of its way to allow.
  `tests/rls/activity-logs.test.ts` caught it on its first run and migration **058** replaced the
  policy with one predicate on both halves. The author guarantee moved to where
  `visit_logs.recorded_by`'s lives: the schema has no `loggedBy` field and the update function never
  assigns the column.

- **The report feed was REUSED, not forked, and that claim was tested rather than restated.**
  `ReportFeed` and `ReportTile` render both modules unchanged; this slice supplied a mapper and a
  twelve-line fetcher. `app/api/visits/[id]/route.ts` has **no diff at all**, which is how the two
  extractions are shown to be safe rather than asserted to be. One string was not generic and became
  a defaulted prop rather than a second component.

- **The private note posts to its own endpoint and is never a field on the log body**, which keeps
  "separate table, separate module, separate route" true at the wire format too. A new follow-up
  therefore saves in two steps.

## What the walk found, and what it cost

Two defects survived a green suite, both in the follow-up controls, both invisible to every test in
the repo:

1. **"Say how it went" was offered on another organization's event** — `visits-d` → `youth-a`-D1 a
   **third** time, inside the slice whose own plan quotes the lesson by name. `canFlag` got the
   ownership mirror; the follow-up control beside it did not.
2. **The form communicated by appearance alone** — neither answer button carried `aria-pressed`, so
   a screen reader heard two identical buttons.

Both fixed the following day as **ITER-021 / ITER-022**; see
[youth-follow-up-controls](youth-follow-up-controls.md).

## Pattern

**A retro written a day late is a retro that did not stop the next defect.** The whole reason this
project keeps retro context is that `visits-d`'s "locked door somebody was invited through" should
have been unmissable by the time slice D was built. It was recorded — twice — and the third sighting
still shipped, in the slice whose plan quoted it. Writing the record is necessary and demonstrably
not sufficient; what closed it in the end was a **pure function** (`canWriteFollowUpOn`) with an
inversion test attached, so the next person cannot re-derive the rule by hand and get it wrong.
