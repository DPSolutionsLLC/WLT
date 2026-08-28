---
id: youth-a-profiles-and-events
type: feature
iter: null
commits: ["6b23fcd"]
date: 2026-08-27
files:
  - supabase/migrations/054_youth_activity_scope.sql
  - lib/validation/youth.ts
  - lib/youth/queries.ts
  - lib/youth/eventInstant.ts
  - lib/youth/activityOwnership.ts
  - lib/notifications/notifyOrgLeadership.ts
  - app/api/youth/profiles/route.ts
  - app/api/youth/profiles/[id]/route.ts
  - app/api/youth/events/route.ts
  - app/api/youth/events/[id]/route.ts
  - app/(app)/youth/page.tsx
  - app/(app)/youth/youthQueries.ts
  - app/(app)/youth/ActivityProfileList.tsx
  - app/(app)/youth/ActivityProfileForm.tsx
  - app/(app)/youth/ManualEventForm.tsx
  - app/(app)/youth/EventList.tsx
  - types/domain.ts
related:
  - visits-d-attempts-appointments-and-participants
  - talks-d-reliability-goals
  - visits-c-report-feed-and-cross-org
  - visits-f-stewardship-and-all-orgs
---

## What was done

Phase 8 slice A of four: activity profiles and hand-entered events, and `/youth` stopped being a
404 that `lib/auth/navigation.ts` had linked four roles to since `auth-a`. Migration 054 answers
the question migration 019 left addressed to this phase by name — **reads stay ward-wide and only
writes are org-scoped** — plus four routes, five client components, and the four test suites.
Google Calendar sync is cut, as the phase plan's own Pitfalls section instructs; `ical.js` is
approved for slice B and deliberately not installed here.

## Key decisions

- **`org_id` goes on `youth_activity_profiles` alone, and null means ward-wide.** Events,
  attendees and logs inherit their organization through the profile, so a second copy of the
  answer cannot disagree with the first. Migration 019's `..._ward_select` survives **untouched**
  and only the three write policies are replaced; that contrast is the decision, not an oversight,
  because FEATURES.md §Module 10 gives the ward council the full calendar. Absent-means-default is
  the same idiom `household_stewardships` uses (`visits-f`).
- **Every write policy carries an explicit `org_id is null` branch** — the `talks-d` hole. SQL's
  `null = null` is NULL, so without it a ward-wide row would be written and then hidden from its
  own author. `ward_council_member` is both the role most likely to have no organization and the
  widest role in the app, so this is the ordinary path here rather than an edge case. It is also
  where the profile route **departs from `visit-goals`**: a null-org author gets 201 and a
  ward-wide row, not 409, because a profile with no org is a legitimate visible state where a goal
  with no org is invisible.
- **Coverage is computed on read; `covered`/`uncovered` left `activity_events.status`.** The clock
  decides them and nothing in this project refreshes anything (no `pg_cron`, no
  `supabase/functions/`, no `vercel.json` crons). `youth_event_uncovered` and the Monday digest
  join `visit_overdue` and `refresh_goal_status()` as Phase 11's single decision — that is now four
  computable things that fire from nothing. `cancelled` was added against SPEC.md's four values:
  without it the only way off the list is a delete, which loses the record it was ever scheduled.
- **An event instant must carry its offset**, refused with a sentence naming the problem, and
  `lib/youth/eventInstant.ts` keeps the wall clock the person typed and appends the offset in
  force *at that moment* rather than converting. That makes the round trip idempotent by
  construction, which is what makes the double-conversion bug impossible rather than merely absent.
  Slice B inherits a column with no ambiguous rows in it.

## What the walkthrough changed

Two defects, both found by driving the real app and both fixed before commit:

1. **Edit and Remove were offered on every organization's activity** (`youth-a-D1`). RLS refused
   the writes, so nothing leaked — but a leader was handed a destructive-sounding control on
   another presidency's work. This is `visits-d`'s finding arriving a second time in the same
   shape, and the second time is worse because the pattern was already written down as
   `canManageVisitLog()`. Fixed with `lib/youth/activityOwnership.ts` mirroring policy 054d, with
   explicit guards against `null === null`. **Events are deliberately NOT gated the same way** —
   they keep ward-wide write policies, and hiding a control the API allows is the mirror mistake.
2. **The event form and the schedule went stale** (`youth-a-D2`). `ManualEventForm`'s activity list
   was a Server Component prop that never refetched, so creating an activity left the form beneath
   it insisting "Add an activity first" — dead-ending the module's primary flow. `StewardshipPanel`
   already carried the rule in a comment written during `visits-b`: *stating a rule in one module
   does not apply it in another.* Fixed by moving both cache keys, both fetchers, and
   `PROFILE_MUTATION_INVALIDATES` into `app/(app)/youth/youthQueries.ts` so all three components
   share one key.

Also worth carrying forward:

- **A checklist written from the plan can quietly drop the half that is hard to pass.** Scenario
  049's line "is told why in a sentence — *not shown a control that fails*" became only "the stored
  row does not change" when the scenario was written, and the app passes that. The weaker line is
  what would have let D1 ship as walked and green. Restored, and it caught the bug.
- **`notifyOrgLeadership` hardcoded its trigger key** (`org_conducting_rotation_changed`). Given an
  optional `triggerKey` rather than copied, because the opt-out lookup inside `emitNotification` is
  keyed on the trigger — a hardcoded key would have delivered a youth activity to somebody who had
  switched *rotation* notices off.
- **A screenshot must demonstrate the claim its caption makes.** One review image asserted the
  bishop's organization select while the scrolling modal had cut it off; the underlying claim was
  verified in the DOM, but the picture did not show it and the reviewer rightly called it.

## Handed forward

- *Slice B* gets a validated instant format, `calendar_id` null on every hand-entered row, and an
  approved `ical.js`.
- *Slice C* gets `EVENT_TYPES` with a `tbd` default, and inherits the open question of whether
  `completed` still earns its place in `activity_events.status`.
- *Slice D* gets `ACTIVITY_TYPE_TONES`, already shaped.
- **`activity_events` has no `entered_by` column.** Raised while reviewing the walk: showing who
  recorded an event needs migration 055, and the unscoped leader-to-leader messaging feature
  (recorded in `plans/INDEX.md`) cannot address an author without it. The two want doing together.
- **A cancelled event is still counted as "upcoming"** in the schedule heading. Left open
  deliberately for the user to settle rather than assumed.
