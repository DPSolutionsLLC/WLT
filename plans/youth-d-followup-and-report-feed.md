# Plan: Youth Activities — Follow-Up, the Shared/Private Split, and the Report Feed

**Created:** 2026-08-28
**Type:** feature
**Phase:** 8, slice D of four — the last. The specification is
[08-youth-activities.md](08-youth-activities.md) Steps 5 and 6; this file is the slice.

---

## Overview

Slice A gave the module profiles and hand-entered events. Slice B imported a season from a
school's `.ics`. Slice C answered *is anybody going?* — attendees, home/away, coverage computed
on read. All three are about a game that **has not happened yet.**

This slice is about the game after it is over. Three things:

1. **The follow-up log.** A leader who was down for an event records what happened:
   `activity_logs.shared_notes`, plus `activity_attendees.confirmed_attendance` — which has been
   a column with no writer since Foundation B, and which slice C narrowed the UPDATE policy for
   in advance, naming this slice.
2. **The shared/private split**, with Phase 7's rules unchanged. `activity_private_notes` gets
   its first row and CLAUDE.md rule 5's four independent mechanisms, one for one.
3. **The report feed, REUSED — not forked.** `visits-c` built `ReportFeed`, `ReportTile`,
   `lib/reports/types.ts`, `lib/reports/readStatus.ts` and `/api/reports/read-status` generic
   from the first line, and left the seam documented in five separate file headers. This slice
   supplies **a mapper and a fetcher** and writes no second component. If that turns out to be
   untrue, the genericity was a claim rather than a fact and the fix belongs in the shared half.

Plus the screen the first two exist for: **`/youth/feed`**, the youth return-and-report feed,
and a **"Waiting on your follow-up"** panel on `/youth` that is how a leader finds out there is
anything to write at all.

### Success criteria

- A game passes. The leader who was down for it opens `/youth`, sees it listed as waiting on
  them, and records in two taps that they went and how it was.
- A leader who was down and did **not** go says so, and the feed tile shows it — the exception,
  not every tile.
- The shared note is readable by the people the ward has decided may read it. The private note is
  readable by its author and by nobody, at any level, ever.
- Flagging a follow-up for ward council notifies the executive secretary with a one-liner that
  carries no note text of any kind.
- `/youth/feed` renders through the same `ReportFeed` component `/visits/feed` renders through,
  and `/visits/feed` still works after this slice touches the shared half.
- Nothing in this slice emits a notification that fires from a clock.

### Five decisions taken with the user before planning

1. **`activity_logs` reads become ORG-SCOPED, reversing this module's read-wide default.**
   This is the one decision in Phase 8 that goes the other way, and it is deliberate. Migration
   054 made *coordination* data ward-wide because a ward council exists to see across the
   organizations, and CLAUDE.md records "do not re-propose making the read org-scoped for
   consistency — the asymmetry IS the feature." **A pastoral follow-up note is not coordination
   data.** 08-youth-activities.md §Step 5 says "same shared/private split as Phase 7, with the
   same rules", and Phase 7's rule for `visit_logs` is `is_bishopric() or org_id =
   current_org_id() or ward_allows_cross_org_visibility()`. Migration 057 gives `activity_logs`
   that shape, resolved through the event's profile because the log has no `org_id` of its own.
   **What does NOT move: `youth_activity_profiles`, `activity_events` and `activity_attendees`
   keep their ward-wide SELECT.** The calendar promise in FEATURES.md §Module 10 is about the
   calendar, and it is kept in full. See *Consequence* below — this one has a cost, and the plan
   names it rather than discovering it in a walk.
2. **The ward-council flag helper is SHARED, not copied.** The recipient resolution moves to
   `lib/notifications/notifyWardCouncilFlag.ts` taking a `triggerKey`, a `title` and a composed
   `body`; `lib/visits/flagNotification.ts` keeps `wardCouncilFlagBody()` and delegates. This
   follows `notifyOrgLeadership`'s precedent exactly — that module took a `triggerKey` parameter
   rather than spawning a second copy, and its header says why: "a second module-specific copy of
   'who is this organization's leadership' would be a second answer to drift from the first, and
   the opt-out lookup inside emitNotification is keyed on the trigger, so a hardcoded key would
   have delivered a youth activity to somebody who had switched rotation notices off." The same
   sentence with "the ward council agenda" substituted is this decision.
3. **A confirmed non-attendance renders as `outcomeLabel: "Did not attend"`.** This DEVIATES from
   a comment `visits-c` wrote into `lib/reports/types.ts` — "Phase 8's activities have no such
   state, so it stays null there" — and that comment is amended in the same change rather than
   left to contradict the code. The reasoning that put "Attempted" on a visit tile is identical:
   a label on every tile reading "Went" is noise, and the one reading "Did not attend" is the
   point, because it is the only thing on the tile a leader has to act on.
4. **`youth_followup_prompt` is COMPUTED ON READ and emitted nowhere.** It fires from the clock —
   "after an event passes" — and nothing in this project fires from a clock: `pg_cron` is not
   enabled, `supabase/functions/` does not exist, `vercel.json` declares no crons.
   `lib/youth/followUp.ts` is a pure function of `(eventDate, status, hasLog, asOf)`, the third
   instance in this module of the rule that produced `coverage.ts`, `appointmentViewState()` and
   `householdVisitPriority()`. **This makes Phase 11's single decision about a mechanism cover
   SIX things, not five** — `youth_event_uncovered`, the Monday away-digest, `visit_overdue`,
   `refresh_goal_status()`, ICS re-sync, and now this. `youth-c` deliberately added no sixth;
   this slice adds one and says so, because the alternative is a notification emitted from a GET,
   which would put a write path outside a human confirm (rule 3).
5. **Any `youth_activities.log` holder may file their own follow-up — being a recorded attendee
   is not required.** §Step 5 says attendees get the *prompt*; it does not say only attendees may
   write. A leader who turned up without putting themselves down is exactly the person whose
   account is worth having, and refusing it would be a workflow rule enforced in a route
   pretending to be a boundary (rule 2). What attendance decides is only whether the form shows
   the **confirm-attendance** control: no attendee row, no such question to answer.

### Consequence of decision 1, stated up front

`ward_council_member` is the role most likely to have **no organization at all** — migration 054d
says so in as many words, and it is one of the two roles this module was built for. Under an
org-scoped `activity_logs` SELECT, such a reader sees only:

- follow-ups on **ward-wide activities** (`youth_activity_profiles.org_id is null`), and
- their own, and
- **everything, if the ward has cross-org visibility on.**

That is a real narrowing and it is the price of the decision, not a bug to patch later with an
`if (role === 'ward_council_member')` branch — which would be rule 2 broken in the most literal
way available. Two things in this plan make it legible rather than mysterious:

- `/youth/feed` states **in words** which mode the ward is in, exactly as `/visits/feed` does
  with `CROSS_ORG_VISIBILITY_STATE_LABELS`. "Why can I see the Young Women's follow-ups?" and
  "why can I not?" are the same question, and the page answers it.
- Scenario 056 walks it from an org leader's account on **both sides** of the setting.

If the walk finds this too narrow, the fix is a product decision about the setting — not a
special case for one role.

---

## Relevant Files

### Create

- `supabase/migrations/057_activity_logs_followup.sql` — tighten `activity_logs`; `updated_at`
  and a one-per-author constraint on both note tables; the org-scope helper and four replaced
  policies; the new trigger key; two indexes.
- `lib/reports/preview.ts` — `toPreviewText()` and `PREVIEW_MAX_CHARACTERS`, lifted out of
  `lib/visits/reportTiles.ts` so the youth mapper does not import a visits module.
- `lib/notifications/notifyWardCouncilFlag.ts` — the shared recipient resolution and emit.
- `lib/youth/followUp.ts` — **pure, client-importable.** Whether an event is waiting on a
  reader's follow-up.
- `lib/youth/activityLogs.ts` — server-only reads and writes over `activity_logs`.
- `lib/youth/privateNotes.ts` — server-only, author-only, over `activity_private_notes`.
- `lib/youth/flagNotification.ts` — the youth body builder, delegating to the shared helper.
- `lib/youth/reportTiles.ts` — the youth half of the feed seam. **Pure.**
- `lib/youth/reportFeed.ts` — one page of the youth feed, assembled. Server-only.
- `app/api/youth/logs/route.ts` — `POST` a follow-up.
- `app/api/youth/logs/[id]/route.ts` — `PATCH` shared notes and the ward-council flag.
- `app/api/youth/logs/[id]/private-note/route.ts` — `GET` / `POST` / `DELETE`, self only.
- `app/api/youth/feed/route.ts` — `GET` one page of the feed.
- `app/(app)/youth/feed/page.tsx` — the youth return-and-report page. Server Component.
- `app/(app)/youth/feed/YouthReportFeed.tsx` — the twelve-line client binding.
- `app/(app)/youth/FollowUpPanel.tsx` — "Waiting on your follow-up" on `/youth`.
- `app/(app)/youth/FollowUpForm.tsx` — attendance, shared note, private note, flag.
- `components/youth/FollowUpBadge.tsx` — one badge, shared by the panel and the event list.

### Modify

- `supabase/seed/notification_triggers.sql` — add `youth_activity_flagged_for_ward_council`.
  **A new trigger key is always BOTH the seed and a migration** or it silently never fires for
  one set of wards (migration 036's header).
- `types/domain.ts` — `FOLLOW_UP_STATES`, labels and tones; activity-log limits if any.
- `lib/reports/types.ts` — amend the `outcomeLabel` comment (decision 3). The
  `authorLabel`/`recordedByLabel` note stays correct and gains its second reader.
- `lib/validation/report.ts` — the `context` field's message becomes module-agnostic ("That
  filter is not valid."). It currently says "That organization is not valid." in a file whose own
  header says it is module-agnostic.
- `lib/validation/youth.ts` — `createActivityLogSchema`, `updateActivityLogSchema`,
  `upsertActivityPrivateNoteSchema`.
- `lib/visits/reportTiles.ts` — import `toPreviewText` from `lib/reports/preview.ts` instead of
  declaring it. **No behaviour change; the visits tile tests must still pass untouched.**
- `lib/visits/flagNotification.ts` — delegate to the shared helper, keep `wardCouncilFlagBody()`.
- `lib/youth/attendees.ts` — `ActivityAttendee` gains `confirmedAttendance: boolean | null`;
  add `setConfirmedAttendance()`.
- `lib/youth/queries.ts` — `getActivityLog` stays exactly as written (its header already
  anticipates this narrowing).
- `app/(app)/youth/page.tsx` — hand down the follow-up panel and its data.
- `app/(app)/youth/EventList.tsx` — a follow-up badge and a link on a past event.
- `app/(app)/youth/youthQueries.ts` — the follow-up cache key and what a log mutation invalidates.
- `lib/auth/navigation.ts` — a `/youth/feed` link for `youth_activities.view` holders, **if and
  only if** that file lists `/visits/feed` the same way. Check before adding; `youth-a` records
  that `/youth` needed no navigation change and that adding one would have been wrong.
- `testing/infrastructure/seedUtils.ts` — `createActivityLog` gains `flagSentAt`;
  `createActivityAttendee` gains `confirmedAttendance`. Both helpers already exist and are
  extended rather than replaced.
- `plans/INDEX.md` — the `youth-d` row: plan link, status, scenario numbers.
- `CLAUDE.md` §9 — the org-scoped-logs reversal, and the sixth clock-driven thing.

---

## Dependencies

**No new packages.** Everything here is a query, a policy, and arithmetic over data that exists.

Existing things this slice must **import rather than re-derive**:

- `components/visits/ReportFeed.tsx` and `components/visits/ReportTile.tsx` — **rendered, not
  copied and not modified.** 08-youth-activities.md §Pitfalls: "Forking the report feed. Two
  nearly identical components drift. Parameterize the one." If a change is genuinely needed,
  §Step 6 authorises changing it **in place** and re-verifying the visits feed.
- `lib/reports/readStatus.ts` — `listReadStatus`, `markRead`, `setBookmarked`, `markAllRead`.
  Its header says Phase 8 "adds nothing to this file". Hold to that.
- `app/api/reports/read-status/route.ts` — already carries a `youth_activity` entry in
  `REPORT_MODULES`, pointing at `getActivityLog`. **Verify it still resolves after 057 narrows
  the policy** — that is the whole point of the entry, and it has never been exercised.
- `lib/validation/report.ts` — `reportFeedQuerySchema`, `encodeReportFeedCursor`,
  `decodeReportFeedCursor`, `DEFAULT_FEED_PAGE_SIZE`.
- `lib/ward/wardTimezone.ts` — `readWardTimezone()`. The feed needs a date-only `occurredOn`
  from a `timestamptz`, and which day that is depends on a zone.
- `lib/notifications/emitNotification.ts`, `lib/notifications/notifyOrgLeadership.ts`,
  `lib/audit/writeAuditLog.ts`, `lib/auth/permissions.ts`
  (`can`/`assertCan`/`resolveRoleAccess`/`BISHOPRIC_ROLES`), `lib/auth/adminUsers.ts`
  (`displayName`, `listWardUsers`).
- `app/(app)/youth/youthQueries.ts` — the shared cache keys. `youth-a` defect D2 is what that
  file exists for; a new key that lives in a component instead is that defect again.

---

## Known Pitfalls (from retro context)

- **`talks-d-reliability-goals` — a permissive policy left in place keeps granting.** PostgreSQL
  ORs permissive policies together, so "adding a stricter policy beside the old one" changes
  nothing at all. Migration 057 **drops** `activity_logs_ward_select` before creating the
  narrower one. Restated by 048 for the same reason.
- **`talks-d` again — `null = null` is NULL, not true.** Every branch touching `org_id` needs an
  explicit `is null` arm. This has bitten three times already (`visit_goals`, 054d, 056c), and
  the activity-log policy resolves `org_id` through a join, which is a fourth place for it.
- **`visits-d` — a child row's scope is its PARENT's, not its own column.** `activity_logs` has
  no `org_id` at all, so this is not even a denormalization question: the parent scope is the
  only answer, and it must be enforced on **writes** as well as reads or an org leader can file a
  follow-up against another organization's event. Use a `security definer` helper, exactly as
  `visit_log_is_writable_by_caller()` does, because an inline subquery inside a policy is itself
  subject to the referenced table's RLS and would make a write check move with a read setting.
- **`visits-d` again — a bare `on delete set null` on a COMPOSITE foreign key nulls every
  referencing column including `ward_id`.** Migration 057 adds no foreign key, but if one is
  added, the column list is not optional.
- **`route-tests-and-realtime` — an RLS-denied UPDATE or DELETE is a zero-row success, not an
  error.** Only INSERT raises. Every refusal test re-reads the row with the service client;
  `removeAttendee`'s `false` return is the shape to copy.
- **`calendar-a-rules-and-api` — a `+` concatenation in a `select()` list widens the type to
  `string` and silently degrades every row to untyped.** One string literal, one line, however
  long it gets.
- **`visits-d` / `lib/youth/attendees.ts` — two foreign keys to the same table make an embed
  ambiguous and PostgREST refuses it.** `activity_logs.logged_by` is a single FK to `users`, so
  an inferred embed is fine there — but the moment the feed query also reaches `activity_events`
  and `youth_activity_profiles`, name every embed.
- **`roster-b-picker-and-orgs` — a query parameter the schema does not carry is silently
  ignored.** Read `components/visits/ReportFeed.tsx` for the exact names it sends before writing
  `app/api/youth/feed/route.ts`; do not assume them.
- **`visits-c` — each filter is its own query key**, so a mutation must patch the whole family.
  `ReportFeed` already does this via `patchAllPages`; the follow-up panel on `/youth` is a
  separate cache, and `ATTENDEE_MUTATION_INVALIDATES` is the pattern to extend.
- **`youth-a` defect D2 — a Server Component prop is not a cache.** Filing a follow-up must
  invalidate the events key too, or the badge on the event list disagrees with the panel above it.
- **`youth-b` / `youth-c` — a constant imported from a `"use client"` module reaches a Server
  Component as a function, not a string**, and a server-only module imported by a client one is a
  hard build failure (`youth-c`) or ~505KB of bundle (`youth-b`). `lib/youth/followUp.ts` imports
  **types only**, like `coverage.ts`. Limits live in the validation module and the server module
  reads them back.
- **`youth-b` / `youth-c` — seven copy defects across two slices, every one invisible to a green
  suite.** Dates read `Sat, 2 Jan 2027` and never `1/2/2027`; counts pluralise at 1 and at many;
  a label correct standing alone can be nonsense inside a clause. The suite proves the data is
  right and says nothing about whether the sentence on top of it can be read.
- **`visits-a` — the caution belongs on the SHARED field, not the private one.** Walking visits-a
  moved the emphasis, because a leader hesitating over the private box has it backwards: that one
  is safe. The **shared** note is the one other people read, and after decision 1 the set of
  those people depends on a ward setting — so the form must say who, not "be careful".
- **`program-e` / ITER-017 — `writeAuditLog` redacts any field whose name contains `token`, and
  the over-broad pattern catches `note` too, deliberately.** Never pass note text to an audit
  row; pass ids and changed KEYS. Do not rely on the denylist to save you.

---

## Tasks

### Task 1: Verify the tables, then write migration 057

**File:** `supabase/migrations/057_activity_logs_followup.sql` (create)

**Action:** Before writing a line of SQL, read the row counts with the **service client**, the
way 054, 055 and 056 each did — "applies immediately" is a checked claim, not a hope. Record the
numbers in the migration header.

```
activity_logs           expected 0
activity_private_notes  expected 0
activity_events         count, and how many have profile_id null
activity_attendees      count, and how many have confirmed_attendance not null
```

If `activity_logs` is non-empty, the NOT NULL tightening below must not ship as written — stop
and say so rather than working around it.

**Details — five parts:**

**057a — tighten `activity_logs` and give it a one-per-author constraint.**

```sql
alter table activity_logs alter column event_id  set not null;
alter table activity_logs alter column logged_by set not null;
alter table activity_logs add column updated_at timestamptz not null default now();
alter table activity_logs
  add constraint activity_logs_one_per_author unique (event_id, logged_by);
```

Both columns were nullable in migration 009 only because Foundation B created every table before
anything wrote to one — the same sentence 054b wrote about `member_id` and `activity_type`. A log
with no event is not a follow-up, and a log with no author cannot be edited by anybody.

**The plain unique index is exact here, and the contrast with 055b is the point.** 055b needed
`nulls not distinct` because `source_recurrence_id` is nullable and SQL's `null = null` is NULL
rather than true. Both columns here are `not null` as of the two lines above, so the clause would
add nothing. State the contrast in a comment; it is what stops the next reader "fixing" one of
the three indexes to match the others.

`updated_at` for the reason 044 gave `visit_private_notes` one: an edited record with no
`updated_at` cannot tell its reader when it last changed.

**057b — `activity_private_notes`, a mirror of migration 044.**

```sql
alter table activity_private_notes add column updated_at timestamptz not null default now();
alter table activity_private_notes
  add constraint activity_private_notes_one_per_author unique (activity_log_id, user_id);
```

The route is an upsert and there was nothing to upsert onto. Without the constraint a user
accumulates duplicate private notes and "the caller's note" stops being a single row anybody can
name. **Its four author-only policies from migration 019 are NOT touched, in either direction.**

**057c — the org scope, and four replaced policies.**

A `security definer` helper, following `visit_log_is_writable_by_caller()` (048) and
`ward_allows_cross_org_visibility()` (019). Inline, the subquery would be subject to
`activity_events`' and `youth_activity_profiles`' own RLS, which couples a log's visibility to two
other tables' policies and makes a **write** check move when a **read** setting moves.

```sql
create function activity_event_is_in_caller_org(target_event_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from activity_events event
    left join youth_activity_profiles profile
      on profile.id = event.profile_id
     and profile.ward_id = event.ward_id
    where event.id = target_event_id
      and event.ward_id = current_ward_id()
      and (profile.org_id is null or profile.org_id = current_org_id())
  );
$$;
```

- **A LEFT JOIN, not an inner one.** `activity_events.profile_id` is nullable, and an event with
  no profile must behave like a profile with no organization: **absent means ward-wide**, the same
  idiom `household_stewardships`, `household_visit_cadences` and 054a all use. An inner join would
  hide such a log from everybody but the bishopric, which is the opposite of absent-means-default.
- **`profile.org_id is null` is not optional** and is the `talks-d` hole in its fourth place.

Then, dropped and recreated — never shadowed:

```sql
drop policy activity_logs_ward_select on activity_logs;
drop policy activity_logs_ward_insert on activity_logs;
drop policy activity_logs_ward_update on activity_logs;
drop policy activity_logs_ward_delete on activity_logs;

create policy activity_logs_select on activity_logs
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or logged_by = auth.uid()
      or activity_event_is_in_caller_org(event_id)
      or ward_allows_cross_org_visibility()
    )
  );
```

`logged_by = auth.uid()` is on the SELECT deliberately: a leader must be able to read back what
they themselves wrote, even about a ward-wide activity in an organization they do not belong to.
It costs nothing and removes a whole class of "where did my note go".

```sql
create policy activity_logs_insert on activity_logs
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and logged_by = auth.uid()
    and (is_bishopric() or activity_event_is_in_caller_org(event_id))
  );
```

**`logged_by = auth.uid()` with NO bishopric exemption on INSERT.** A follow-up is a personal
account of an event. A bishopric member filing one under somebody else's name is not oversight,
it is a record of something that did not happen — the same reasoning that keeps `recordedBy` off
every request body in this app. The bishopric branch appears only on the **parent-scope** half, so
a counselor may write **their own** follow-up on any organization's event.

```sql
create policy activity_logs_update on activity_logs
  for update to authenticated
  using      (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()))
  with check (ward_id = current_ward_id() and logged_by = auth.uid());

create policy activity_logs_delete on activity_logs
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()));
```

USING and WITH CHECK differ on purpose, exactly as 054d's do: the bishopric may **clear a flag**
on somebody's follow-up (they own the agenda), but WITH CHECK's `logged_by = auth.uid()` means
nobody, bishopric included, may leave behind a row attributed to a different author.

**`activity_attendees` is not touched.** 056c already narrowed its UPDATE to
`is_bishopric() or user_id = auth.uid()`, naming this slice as the reason, and its ward-wide
SELECT stays load-bearing for coverage.

**057d — the trigger key**, for wards that already exist:

```sql
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'youth_activity_flagged_for_ward_council', array['executive_secretary'], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
```

The executive secretary and nobody else, matching `visit_flagged_for_ward_council` and migration
045's correction. **The seed file gets the same key in the same change** (Task 2) — one without
the other is a notification that silently never fires for one set of wards.

**057e — indexes**, leading with `ward_id` because every query does:

```sql
create index activity_logs_created_idx on activity_logs (ward_id, created_at desc);
create index activity_logs_event_idx   on activity_logs (ward_id, event_id);
```

The first is the feed's keyset order (Task 9); the second is "does this event have a follow-up
from me yet", which the panel asks for a screenful of events at once.

**No `HELD_BACK_UNTIL_DEPLOYED` entry**, on 054/055/056's shared reasoning: this is
additive-with-tightening on empty tables, it applies before the code deploys, and an unnecessary
entry HIDES a real migration from `tests/db/migrations.test.ts`.

---

### Task 2: The trigger key in the seed

**File:** `supabase/seed/notification_triggers.sql` (modify)

Add under the Youth activities block, beside the five keys already there:

```sql
  ('youth_activity_flagged_for_ward_council', array['executive_secretary']),
```

Update the header's key count if it names one. Carry a one-line comment in the style of the
`visit_flagged_for_ward_council` entry above it: the recipient is resolved explicitly by
`lib/notifications/notifyWardCouncilFlag.ts`, so `default_roles` is the opt-out surface rather
than the address list.

---

### Task 3: Regenerate types

**Action:** `npm run db:push`, then `npm run db:types`. `types/database.ts` is generated — do not
hand-edit it. Confirm `activity_logs.updated_at` and the non-null `event_id` / `logged_by` appear.

---

### Task 4: Domain types

**File:** `types/domain.ts` (modify)

Add beside `COVERAGE_STATES`, following its exact shape (a `const` tuple, a `Record` of labels, a
`Record` of tones, a rank function reading the tuple index):

```ts
export const FOLLOW_UP_STATES = ["awaiting", "did_not_attend", "logged", "not_due"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];
```

- `awaiting` — the event is past, not cancelled, the reader was down for it, and there is no log
  from them. **The only state the panel shows.**
- `did_not_attend` — a log exists and the reader confirmed they did not go. Ranks second because
  it is the state somebody may need to act on.
- `logged` — a log exists.
- `not_due` — the event is upcoming, or cancelled, or the reader was never down for it.

Labels are **sentences a leader would say**, not field names, and the `youth-c` walk is the
authority on why: "Not yet known" failed because it did not say what was not known. Suggested:
`"Waiting on your follow-up"`, `"Did not attend"`, `"Follow-up recorded"`, and render **nothing**
for `not_due` rather than a chip reading "Not due", which is a chip about nothing.

Tones reuse the `CoverageTone` union `youth-c` added if its members fit; otherwise `ContextTone`.
**Do not interpolate a Tailwind class name** — a static `Record` of complete class strings, the
rule `ReportTile`'s `TONE_CLASSES` states.

---

### Task 5: `lib/reports/preview.ts` — lift the shared half

**Files:** `lib/reports/preview.ts` (create), `lib/visits/reportTiles.ts` (modify)

Move `PREVIEW_MAX_CHARACTERS`, `ELLIPSIS` and `toPreviewText()` verbatim.
`lib/visits/reportTiles.ts` imports them; **its behaviour does not change, and
`tests/lib/reportTiles.test.ts` must pass untouched.** If that test imports `toPreviewText`
directly, re-point the import and nothing else.

Why: the youth mapper needs the same one-line preview, and a `lib/youth/*` file importing
`lib/visits/*` would say the two modules are related when they are not. The directory this
belongs in already exists — `lib/reports/` holds `types.ts` and `readStatus.ts`, both
module-agnostic by design.

Carry the original comments across intact. `toPreviewText` returns **null, never `""`** — an
empty string renders as a blank gap that reads as a note which failed to load — and it cuts at a
**word boundary**. Both are decisions with reasons, and neither survives a careless move.

---

### Task 6: The shared ward-council flag helper

**Files:** `lib/notifications/notifyWardCouncilFlag.ts` (create),
`lib/visits/flagNotification.ts` (modify)

**Action:** Move the recipient resolution and the emit; leave each module its own vocabulary.

```ts
export type NotifyWardCouncilFlagParams = {
  wardId: string;
  triggerKey: string;
  title: string;
  // Composed by the CALLER. This module puts no string of its own into a body.
  body: string;
};

export async function notifyWardCouncilFlag(
  params: NotifyWardCouncilFlagParams,
  client?: SupabaseClient<Database>,
): Promise<void>;
```

Everything from the current `lib/visits/flagNotification.ts` moves in unchanged: the
`executive_secretary` lookup on active users, the **warn-and-return** when a ward has none (never
a fallback to the bishopric — widening the audience is a product decision, and quietly is the
wrong way to take it), and the **never-throws** contract.

**The body rule moves with it, and it is the most important comment in the file.** The body is a
one-liner and nothing else: not the shared notes, not a summary of them, and above all not the
private note. A notification row is read by somebody who cannot open the record, it renders in a
bell menu with no permission check of its own, and Phase 11 may put it in a digest email.

`lib/visits/flagNotification.ts` keeps `wardCouncilFlagBody(orgName, familyName)` and its
`VISIT_FLAG_TRIGGER_KEY`, and calls the shared helper. Its exported function keeps its current
name and signature so `app/api/visits/[id]/route.ts` does not change at all — **the visits flag
path must be provably untouched**, and the way to prove it is that its call site has no diff.

---

### Task 7: `lib/youth/followUp.ts` — pure

**File:** `lib/youth/followUp.ts` (create)

Model it on `lib/youth/coverage.ts` line for line, including the three header rules: computed
never stored; client-importable (types only — one import of `lib/youth/queries.ts` pulls
`next/headers` into the browser bundle); and **`asOf` is a parameter, never a `new Date()`
inside**, so every row of one render is judged against the same instant.

```ts
export type FollowUpInput = {
  eventDate: string;
  status: EventStatus;
  // Whether the READER is recorded as an attendee. Not whether anybody is.
  isAttendee: boolean;
  // The reader's own log, if they have written one.
  hasLog: boolean;
  confirmedAttendance: boolean | null;
};

export function followUpState(input: FollowUpInput, asOf: Date): FollowUpState;
```

**Branch order is the rule, exactly as `eventCoverage`'s is:**

1. `status === "cancelled"` → `not_due`, **before the clock is consulted.** A cancelled game may
   be reinstated and must never generate a follow-up prompt at any distance from the clock —
   asserted three days out **and** three days past.
2. An unreadable `eventDate` → `not_due`. It cannot be acted on, and a permanent prompt on a
   screen whose prompts are supposed to mean something is worse than silence.
3. Still in the future → `not_due`. **"Past" is the start instant**, because this schema has no
   duration column. `coverage.ts`'s header names the same limitation from the other side; say so
   here too, so the next reader does not read a bug into a game that ended an hour ago.
4. `hasLog` → `confirmedAttendance === false ? "did_not_attend" : "logged"`.
5. `!isAttendee` → `not_due`. Nobody is *waiting* on somebody who never said they were going.
   Note in a comment that this does **not** stop them filing one (decision 5) — the panel is a
   prompt, not a permission.
6. Otherwise → `awaiting`.

Add `summariseFollowUp()` if the panel needs a count, for the reason `summariseCoverage()` exists:
the number in the heading and the rows beneath it must be two renderings of one computation, not
two computations.

---

### Task 8: Data access — logs, private notes, attendance

**Files:** `lib/youth/activityLogs.ts`, `lib/youth/privateNotes.ts` (create),
`lib/youth/attendees.ts` (modify)

**`lib/youth/privateNotes.ts`** is `lib/visits/privateNotes.ts` with `visit_log_id` replaced by
`activity_log_id`. Copy the header **in full** and adapt it — the enumeration of CLAUDE.md rule
5's four independent mechanisms (a separate table, a separate module, four author-only policies,
a test that reads route RESPONSES) is the reason the file exists, and a copy without it is just a
query. `getOwnPrivateNote` / `upsertOwnPrivateNote` / `deleteOwnPrivateNote`, same signatures.

- **No function takes a `userId` except the upsert**, which needs one to put in the column.
- **No `createServiceSupabaseClient` import**, and its presence is the smell.
- Null, not an error, for a note the caller did not write — the policy denies the ROW, so
  "somebody else's note" and "no note yet" are the same answer, which is correct for the caller.
- Never log the note body. Ids only.

**`lib/youth/activityLogs.ts`** — server-only:

```ts
export type ActivityLogWithContext = ActivityLog & {
  eventTitle: string | null;
  eventDate: string | null;
  profileId: string | null;
  profileName: string | null;
  activityType: ActivityType | null;
  loggedByName: string | null;
  confirmedAttendance: boolean | null;
};

listActivityLogsForFeed(wardId, { profileId?, limit, before }, client)
listActivityLogSummaries(wardId, client)       // id + profileId, for the unread count and contexts
listOwnLogsForEvents(wardId, eventIds, client) // Map<eventId, ActivityLog> for the panel
createActivityLog(wardId, userId, input, client)
updateActivityLog(wardId, id, input, flagSentAt, client)
```

- **`flagSentAt` is a separate parameter, never a body field**, exactly as
  `lib/visits/queries.ts` has it. A body that could stamp its own would be able to silence the
  notification.
- **THIS MODULE NEVER SELECTS FROM `activity_private_notes` AND NEVER IMPORTS THE MODULE THAT
  DOES.** `lib/youth/queries.ts` and `lib/youth/attendees.ts` both already carry that sentence;
  this file makes three, and it is the one where it would actually be tempting.
- One string literal on one line for the select list; **name every embed** — `logged_by` to
  `users` is a single FK, but the query also reaches `activity_events` and through it
  `youth_activity_profiles`, and slice B added relationships nearby.
- Order `.order("created_at", { ascending: false }).order("id", { ascending: false })`. The
  `youth-c` retro found `listActivityEvents` missing exactly this tiebreaker and left it; do not
  ship a second one.

**`lib/youth/attendees.ts`** — add `confirmed_attendance` to `ATTENDEE_COLUMNS` (still one
literal, still one line), `confirmedAttendance: boolean | null` to `ActivityAttendee` and its row
type, and:

```ts
export async function setConfirmedAttendance(
  wardId, eventId, userId, confirmed: boolean, client?
): Promise<boolean>;
```

Returns **false when the update touched no row** — an RLS-refused UPDATE is a zero-row success,
not an error, and `removeAttendee` already models the return shape and the sentence that goes
with it. 056c's policy is what decides; nothing here branches on a role.

---

### Task 9: The feed seam — mapper, then assembler

**Files:** `lib/youth/reportTiles.ts`, `lib/youth/reportFeed.ts` (create)

**`lib/youth/reportTiles.ts` is PURE** — no client, no await, no clock — so its test needs no
database. Read `lib/visits/reportTiles.ts` first; this is its sibling, and the header should say
so.

Mapping, field by field, and every one of these is decided in `lib/reports/types.ts`:

| Tile field | Youth value |
|---|---|
| `reportType` | `"youth_activity"` |
| `reportId` | the **log** id |
| `contextId` | the **profile** id — the activity, which is what the filter selects |
| `contextLabel` | the activity name |
| `contextTone` | `ACTIVITY_TYPE_TONES[activityType]` — shaped by `youth-a` for this |
| `subjectLabel` | the event title |
| `occurredOn` | the **event's** date, date-only, **in the ward's timezone** |
| `authorLabel` | **always `null`** |
| `recordedByLabel` | the `logged_by` user's display name |
| `outcomeLabel` | `"Did not attend"` when `confirmedAttendance === false`, else `null` |
| `previewText` | `toPreviewText(sharedNotes)` from `lib/reports/preview.ts` |
| `isRead` / `bookmarked` | from the `readStatus` map |

**`authorLabel` stays null, and this is not laziness.** `lib/reports/types.ts` spells it out:
`authorLabel` is WHO WENT, and `activity_logs` has no participants table at all, so mapping
`logged_by` onto it would put "who went" on one kind of tile and "who typed it" on the other under
the same label, with nothing on screen to tell them apart. The tile renders
`"Nobody recorded as taking part"` in that case, which for a youth follow-up is **true and not
useful** — flag it for the walk (checklist item, scenario 055) as the most likely copy defect in
this slice. If it reads badly, the fix is in `ReportTile` **in place**, with the visits feed
re-verified, per §Step 6 — not a youth-only component.

**`occurredOn` needs a zone.** `activity_events.event_date` is a `timestamptz`; `ReportTile`
formats `occurredOn` in **UTC** deliberately (a date-only value formatted locally shows the
previous day west of UTC). So the assembler must produce the date-only string in the **ward's**
zone via `readWardTimezone()` and `Intl.DateTimeFormat` with `timeZone` set — never
`.toISOString().slice(0, 10)`, which is UTC and puts a 7pm Friday game on Saturday for any ward
east of the line. `youth-c` recorded the mirror of this: `wardTimezone` decides what an imported
floating time MEANS; the reader's zone decides which day a card sits under. Here the **ward's**
zone is right, because `occurredOn` is a property of the event and must be the same string for
every reader — a cursor is built from it.

**`lib/youth/reportFeed.ts`** mirrors `lib/visits/reportFeed.ts` and is called by **both** the
page and the route, for the reason that file states: two copies of the assembly would drift, and
the way it shows is a second page whose tiles disagree with the first.

**ORDERING IS A DELIBERATE DEVIATION FROM VISITS, AND THE CURSOR IS THE TRAP.**
The visits feed orders on `visit_date` — the day it happened — because that column is on the row
being paged. A youth log's event date lives on a **different table**, and PostgREST cannot order
parent rows by an embedded column, so a keyset over it is not expressible. This feed therefore
orders on `activity_logs.created_at` — **newest report first** — while the tile displays the
**event's** date.

So: `encodeReportFeedCursor({ occurredOn: <the LOG's created_at, date-only>, createdAt })`, and
the youth query filters on `created_at` alone. **The cursor's `occurredOn` half must never be
taken from `tile.occurredOn`** — they are different dates, and doing so would page through the
feed in an order the query does not use, skipping and repeating rows. Write that in a comment at
the `encodeReportFeedCursor` call, which is the one line where it would be easy to get wrong.

Defend the ordering choice in the header; do not apologise for it. A return-and-report feed
ordered by when a report **arrived** never reorders under a reader, and a late-filed report
appears at the top where somebody will see it — which is arguably what visits should do too. Say
so; it is a question for whoever next touches that module.

The rest is `lib/visits/reportFeed.ts`'s shape unchanged and should be read from it rather than
reinvented: `limit + 1` then trimmed (asking for exactly `limit` cannot tell the last page from a
full one, so the reader is offered a Load More that returns nothing); `summaries` fetched
**unfiltered** and narrowed in memory, because it answers two questions at once — the unread count
under the current filter, and which contexts the filter may offer at all; `contexts` derived from
those summaries so the dropdown neither shrinks as the reader pages nor changes when a filter is
applied; and **no scope filter of its own** — RLS decided that in 057, and a filter restated here
would either duplicate the policy or quietly disagree with it.

**This module does not import `lib/youth/privateNotes.ts`, and must not.** The import list is
where a reviewer sees that in one glance.

---

### Task 10: Validation

**Files:** `lib/validation/youth.ts` (modify), `lib/validation/report.ts` (modify)

In `lib/validation/youth.ts`, beneath the "Who is going" block:

```ts
export const MAX_ACTIVITY_SHARED_NOTES = 2000;
export const MAX_ACTIVITY_PRIVATE_NOTES = 2000;

export const createActivityLogSchema = z.object({
  eventId: z.uuid("That event is not valid."),
  sharedNotes: sharedNotesSchema,          // trimmed, max, nullable, optional
  attended: z.boolean().optional(),        // absent means "do not touch the attendee row"
});

export const updateActivityLogSchema = z.object({
  sharedNotes: sharedNotesSchema,
  flaggedForWardCouncil: z.boolean().optional(),
  attended: z.boolean().optional(),
}).superRefine(/* "Nothing was changed." when the object is empty */);

export const upsertActivityPrivateNoteSchema = z.object({ notes: /* trimmed, min 1, max */ });
```

- **No `wardId`, no `loggedBy`, no `flagSentAt`** on any of them. The header of this file already
  states the rule for `wardId` and `enteredBy`; add `loggedBy` to that sentence.
- **`attended` is optional and its absence is meaningful**, the same load-bearing distinction
  `createVisitLogSchema.participants` draws between `undefined` and `[]`: absent means the caller
  said nothing about attendance and the attendee row is left exactly as it is. Only `true`/`false`
  writes `confirmed_attendance`.
- Match the empty-object `superRefine` and the message wording ("Nothing was changed.") already
  used by `updateActivityProfileSchema` and `updateActivityEventSchema`.

In `lib/validation/report.ts`, `reportFeedQuerySchema.context` currently reads
`z.uuid("That organization is not valid.")` in a file whose header says it is module-agnostic.
Change the message to `"That filter is not valid."` and leave everything else alone. Check
whether any test asserts that string before changing it.

---

### Task 11: The follow-up routes

**Files:** `app/api/youth/logs/route.ts`, `app/api/youth/logs/[id]/route.ts` (create)

Follow `app/api/youth/events/route.ts` and `app/api/visits/[id]/route.ts` exactly — including
resolving the session **outside** the `try` block, because `requireSessionUser()` redirects by
throwing an internal Next.js error and catching it turns a redirect into a 500.

**`POST /api/youth/logs`** — `assertCan(user, "youth_activities.log", roleAccess)`.

1. Parse the body.
2. Resolve the event with `getActivityEvent()` under the caller's client → **404 with one
   message** if absent. Not 403: a 403 confirms the event exists, which tells an org leader
   something about another organization's work they may not have. Copy the `NOT_FOUND` constant
   and its comment from the private-note route.
3. `createActivityLog()`. **A unique violation on `activity_logs_one_per_author` is a 409 with a
   sentence naming the alternative** — "You have already recorded a follow-up for this event.
   Open it to change what you wrote." — not a 500. `addAttendee`'s `UNIQUE_VIOLATION` handling is
   the pattern; the difference is that being already down for an event is the state the caller
   wanted, whereas a second follow-up is not, so this one is a 409 rather than a quiet 200.
4. If `attended` is present, `setConfirmedAttendance()`. **Only after the log is known to have
   been written**, mirroring how the visit PATCH replaces participants only once the visit itself
   is known writable.
5. `writeAuditLog({ action: "youth_activity_followup_logged", module: "youth_activities",
   detail: { activityLogId, eventId, changed: Object.keys(input), attended } })` — **the KEYS
   that changed, never their values.** `sharedNotes` in that list records that notes were
   written; the notes belong in the row.
6. Emit `youth_followup_submitted` to the owning organization's leadership via
   `notifyOrgLeadership({ triggerKey: "youth_followup_submitted", ... })`. That helper takes an
   `orgId`, so resolve it from the event's profile; a **ward-wide activity (null org) emits
   nothing** rather than falling back to every president in the ward, on `notifyWardCouncilFlag`'s
   reasoning that widening an audience quietly is the wrong way to take a product decision. The
   description carries the activity and event names and **no note text.**

**`PATCH /api/youth/logs/[id]`** — the flag transition, which is
`app/api/visits/[id]/route.ts` lines 100–185 with the nouns changed. Reproduce the table:

```
false -> true,  flag_sent_at IS NULL      set flag, stamp flag_sent_at, NOTIFY
false -> true,  flag_sent_at IS NOT NULL  set flag, do not notify        (re-flag)
true  -> false                            clear flag, CLEAR flag_sent_at
```

Clearing `flag_sent_at` on unflag is what lets a genuine re-raise notify again; leaving it set
makes the second raise silent, and an agenda item nobody was told about is the same as no agenda
item. Audit action is `youth_activity_unflagged` / `youth_activity_flagged` /
`youth_activity_followup_updated`, chosen the same way. Notify **after** the update commits,
through `lib/youth/flagNotification.ts`, whose failure never fails the request.

`params` is a Promise in Next 16: `PATCH(request, { params: Promise.resolve({ id }) })`.

---

### Task 12: The private-note route

**File:** `app/api/youth/logs/[id]/private-note/route.ts` (create)

`app/api/visits/[id]/private-note/route.ts` with `visit` → `activity log`. **Copy the header in
full and adapt it** — "there is no `userId` parameter on any verb here, and there never may be"
is the sentence that stops the next reader adding a convenience.

- `GET` / `POST` / `DELETE`. Permission is `youth_activities.log` **plus RLS, and the permission
  is the weaker of the two**: holding it lets somebody write THEIR OWN note and never widens whose
  notes they can read, because the policy names `auth.uid()`.
- Resolve the log first with `getActivityLog()` → the same 404 for "no such log" and "not yours".
- **No audit row on the GET.** Logging that somebody opened their own note would build exactly the
  record of private reflection this table exists to avoid keeping.
- Audit rows on POST and DELETE carry **the log id only** — never the body, never its length,
  never a preview. Do not rely on `redactSensitive()`; the rule is simply never to pass the text.
- `deleted: false` covers both "there was no note" and "the note was not yours", which are the
  same answer to this caller.

---

### Task 13: The feed route

**File:** `app/api/youth/feed/route.ts` (create)

`app/api/visits/feed/route.ts` with `visits.view` → `youth_activities.view` and
`readVisitReportFeed` → `readYouthReportFeed`. Read `components/visits/ReportFeed.tsx` for the
**exact** query-parameter names it sends (`before`, `context`, `limit`) rather than assuming them
— a name this handler does not read gets no error, just a silently ignored filter.

**No audit row: this is a read.** And this file does not import `lib/youth/privateNotes.ts` —
say so in the header, as the visits route does, because the header is where a reviewer checks it.

---

### Task 14: `/youth/feed`

**Files:** `app/(app)/youth/feed/page.tsx`, `app/(app)/youth/feed/YouthReportFeed.tsx` (create)

`app/(app)/visits/feed/*` is the template, and `VisitReportFeed.tsx` is twelve lines — that shape
is the intended one, and its header says so: "Phase 8 writes the same twelve lines against its own
endpoint."

- **Server Component, first page fetched here.** `talks-d` measured the unread flash at 268 ms
  unthrottled and 3.8 s at 20× CPU throttling — long enough to read the wrong answer.
- `can()` not `assertCan()`: a `ForbiddenError` escaping a Server Component becomes a 500 whose
  message Next strips in production.
- `ownContextId={null}`. The "only mine" checkbox selects the reader's own context, and for
  visits that is their organization. **There is no such thing as the reader's own activity**, so
  passing anything here would be a checkbox that means nothing. `ReportFeed` hides it on null.
- **State the cross-org mode in words**, with `CROSS_ORG_VISIBILITY_STATE_LABELS` if its wording
  fits a follow-up, or a youth-specific sentence if it does not. This is the mitigation for
  decision 1's consequence, and it is not optional.
- `emptyMessage` — a sentence about follow-ups, not about visits.
- The "notes are shortened to one line here; the whole note is on ⟨somewhere⟩" line the visits
  page carries needs a real destination. If there is no per-log detail view in this slice, say
  where the note lives instead — do not link to a page that does not show it.

---

### Task 15: The follow-up panel and form

**Files:** `app/(app)/youth/FollowUpPanel.tsx`, `app/(app)/youth/FollowUpForm.tsx`,
`components/youth/FollowUpBadge.tsx` (create); `app/(app)/youth/page.tsx`,
`app/(app)/youth/EventList.tsx`, `app/(app)/youth/youthQueries.ts` (modify)

**`page.tsx`** already resolves **one `asOf` per render** and hands it down — extend that, do not
add a second clock. It needs past events too, so the existing `listActivityEvents(wardId,
{ asOf })` call gains whatever slice A's options object needs for `includePast`; check its
signature rather than guessing.

**The panel** lists only `awaiting` events — the ones waiting on **this reader**. The heading
counts via `summariseFollowUp()` so the number and the rows are one computation. The empty state
is a sentence about there being nothing to write, not a blank card.

**The form**, in one modal, in this order:

1. **Did you go?** — rendered **only if the reader has an attendee row.** No row, no question.
2. **Shared note.** The label says **who can read it**, not "be careful" — and after decision 1
   that set depends on a ward setting, so the sentence must be true in both modes. `visits-a`
   moved this emphasis off the private field onto the shared one for exactly this reason.
3. **Private note.** Author-only, stated plainly, in a separate visually distinct block. It posts
   to its own endpoint — **never as a field on the log body**, which is what keeps rule 5's
   "separate table, separate module, separate route" true at every layer.
4. **Flag for ward council**, with a sentence naming who is notified (the executive secretary)
   and what they receive (a one-liner, no note text). `visits-c` found `/visits` offering this
   control on other organizations' visits where RLS refused it — **a locked door somebody was
   invited through** — and `youth-a` hit the same bug a second time. Render the control only when
   the caller could actually write the log: `lib/youth/activityOwnership.ts` exists for exactly
   this kind of mirror and should gain the log's rule beside the profile's.

**Cache invalidation goes in `youthQueries.ts`, never in a component** — that file exists because
`youth-a` defect D2 was three components each holding their own key:

```ts
export const YOUTH_FOLLOW_UP_QUERY_KEY = "youth-activity-follow-up";

export const FOLLOW_UP_MUTATION_INVALIDATES = [
  [YOUTH_FOLLOW_UP_QUERY_KEY],
  [YOUTH_EVENTS_QUERY_KEY],
  [YOUTH_ATTENDEES_QUERY_KEY],
] as const;
```

**All three, and the comment must say why**: `attended` writes `confirmed_attendance` on the
attendee row, the badge is derived from the log **and** the event, and the panel disappearing
while the event list still shows "waiting on you" is `ATTENDEE_MUTATION_INVALIDATES`'s defect
wearing a third hat.

---

## Testing Strategy

Priority order is CLAUDE.md §8. The RLS suites are the highest-value tests here because this
slice is the first in Phase 8 to **narrow** a read.

### Create

- **`tests/rls/activity-logs.test.ts`** — the centrepiece.
  - An org leader reads their own organization's follow-ups and **not** another's.
  - The same leader **does** read a follow-up on a **ward-wide** activity (`profile.org_id` null)
    — the absent-means-default branch, which is the one a careless policy loses.
  - A `ward_council_member` **with no `org_id`** reads ward-wide follow-ups and their own, and
    nothing else. This is decision 1's consequence, asserted rather than discovered.
  - Turn `cross_org_visibility` **on** and re-assert: every log readable. Off again: narrow. The
    suite asserts **both sides** of the setting, as `tests/rls/visit-cross-org.test.ts` does.
  - Bishopric reads everything.
  - **Writes:** an org leader cannot INSERT a log against another organization's event (the
    `visits-d` parent-scope hole, in its second module). `logged_by` cannot be somebody else's id,
    **not even for the bishopric**. UPDATE by a non-author is refused — **re-read the row with the
    service client to prove it**, because an RLS-denied UPDATE is a zero-row success.
- **`tests/rls/activity-private-notes.test.ts`** — the name 08-youth-activities.md §Tests gives
  it. Same absolute guarantee as `tests/rls/private-notes.test.ts`: the author reads it; the
  **bishop** does not; an admin does not; the org president does not; cross-org visibility **on**
  changes nothing. Assert the bishopric case explicitly and by name — that is the assertion the
  rule is actually about.
- **`tests/lib/youthFollowUp.test.ts`** — pure, table-driven. `cancelled` three days out **and**
  three days past, both `not_due`. The past/future boundary from both sides. `hasLog` with
  `confirmedAttendance` false / true / null. A non-attendee is never `awaiting`. An unparseable
  date.
- **`tests/lib/youthReportTiles.test.ts`** — pure. Every field in the table in Task 9, plus:
  `authorLabel` is null in **all** cases; `previewText` is null for an empty shared note and never
  `""`; `outcomeLabel` is null unless `confirmedAttendance === false`; `occurredOn` is the
  **event's** date **in the ward's zone** — assert with a ward zone that puts the event on a
  different day from UTC, or the test cannot fail.
- **`tests/routes/youthLogs.test.ts`** — happy path; the 409 on a second follow-up; the 404 for
  an event the caller cannot see; the flag transition in all three rows of the table, asserting
  `flag_sent_at` and whether a notification row appeared; **a 403 for a role without
  `youth_activities.log`** — check `lib/auth/permissions.ts` for a real one rather than guessing
  (`music_coordinator` holds none of the youth keys; `ward_council_member` holds all three).
- **`tests/routes/youthPrivateNote.test.ts`** — **asserts on the serialized response body**, not
  on tables. That is the fourth mechanism in rule 5's list, and the only one that catches a
  widened select after the types were changed to allow it. Assert that no response from
  `/api/youth/logs`, `/api/youth/feed` or `/api/youth/events` contains the private note's text —
  scan for the string, the way `tests/rls/public-program-anon.test.ts` does, rather than listing
  fields that may appear.
- **`tests/routes/youthFeed.test.ts`** — a page of tiles; the unread count under a filter matches
  what the filter shows; the cursor pages without repeating or skipping (seed enough logs to need
  two pages); an unknown `context` returns an empty page rather than a 403.
- **`tests/lib/wardCouncilFlag.test.ts`** — the shared helper: a ward with no executive secretary
  emits nothing and does **not** fall back; the body is the one-liner; the trigger key is the
  caller's.

### Modify

- `tests/lib/reportTiles.test.ts` — re-point the `toPreviewText` import if it has one. **No
  assertion changes.** If one is needed, the move was not behaviour-preserving.
- `tests/routes/reportReadStatus.test.ts` — add the `youth_activity` half. The `REPORT_MODULES`
  entry has existed since `visits-c` and has never been exercised; after 057 it resolves through
  a **narrowed** policy, so assert that a log the caller cannot read returns the shared 404.
- `tests/rls/youth-activity-scope.test.ts` — add an assertion that `activity_events`,
  `youth_activity_profiles` and `activity_attendees` **still** select ward-wide. The value of
  that assertion is entirely in its being next to the narrowing.
- `tests/db/migrations.test.ts` — nothing to add, and **that is the assertion**: 057 gets no
  `HELD_BACK_UNTIL_DEPLOYED` entry, and the existing test proves everything on disk is applied.

### Not tested, deliberately

- The notification **body wording**. `emitNotification` is already covered; what the sentence says
  is a walk question.
- That `ReportFeed` renders. It is `visits-c`'s component with `visits-c`'s tests; a second test
  of the same component would be the fork this slice exists to avoid, in test form.

---

## Test Scenarios (Harness)

Next free numbers are **055** and **056** (054 is `youth-c`'s). Run `npm run manifest` after
adding them.

### Scenario 055: The game is over and nobody has said how it went

**Tags:** `youth`, `full`, `follow-up`, `privacy`
**Purpose:** The whole follow-up loop, end to end, including the two things a green suite cannot
check: whether a leader can find out there is anything to write, and whether the shared/private
boundary is legible on the screen where it matters.

**Seed data summary:**
- Ward, organizations, and three users: a Young Men president, an org secretary in the same
  organization, and a bishop.
- Two activity profiles owned by the Young Men, one youth each.
- **Four events, all in the PAST**, seeded with explicit dates so the clock cannot drift them:
  one the president is an attendee of and has **no** log for (the row the panel must show); one
  the president attended **and already logged**; one **cancelled** that the president was down
  for (must **never** appear as waiting — this is the assertion 054c's ordering rule exists for);
  one the president was **never** down for.
- One upcoming event, so "past" is doing work rather than being every row.
- An existing `activity_log` from the org secretary with shared notes, **and a private note on it
  belonging to the secretary** — seeded so the bishop's inability to read it is testable without
  anybody typing it first.

**Tester action:** Sign in as the president. Open `/youth`. Record a follow-up on the waiting
event: confirm attendance, write a shared note, write a private note. Open `/youth/feed`. Then
sign in as the **bishop** and open the same log.

**Verification checklist:**
- [ ] `/youth` shows **exactly one** event waiting on the president — not the logged one, not the
      cancelled one, not the one they were never down for, not the upcoming one
- [ ] The cancelled past event appears nowhere as waiting, at any distance from the clock
- [ ] The form asks "did you go?" only because the president has an attendee row
- [ ] The shared-note field says **who can read it**, and the sentence is true for this ward's
      cross-org setting
- [ ] The private-note field says it is the author's alone, in a visually distinct block
- [ ] Saving updates the panel **and** the event list badge **and** the attendee line without a
      reload
- [ ] A second follow-up on the same event is refused with a sentence offering the edit path —
      not a 500, not a duplicate row
- [ ] `/youth/feed` shows the new report, unread, newest first
- [ ] Tapping it marks it read for the president and **not** for anybody else
- [ ] The tile's date is the **event's** date, formatted `Sat, 2 Jan 2027` — never `1/2/2027`
- [ ] The tile preview is one line of the **shared** note, ending in an ellipsis at a word
      boundary if it was cut
- [ ] The bishop can read the secretary's **shared** note and **cannot** read their private note,
      anywhere, by any route
- [ ] No horizontal overflow at 375px; correct in light and dark

**Judgement questions for the walk:**
- Does `"Nobody recorded as taking part"` on a youth tile read as a bug? It is true and probably
  useless here (Task 9). Would a leader understand it?
- Is the panel on `/youth` **findable**? `youth-c` found the uncovered banner correct and
  unfindable, and the fix was to name events rather than count them.
- Does the shared-note label survive both cross-org modes, or does it only read correctly in one?

---

### Scenario 056: A follow-up the ward council should hear about

**Tags:** `youth`, `full`, `rls`, `notifications`, `cross-org`
**Purpose:** The flag path and decision 1's boundary, from an account that is on the wrong side of
it. Seeding matters because the state — two organizations' follow-ups, an executive secretary, and
a ward setting toggled mid-walk — is tedious to build by hand and easy to build wrongly.

**Seed data summary:**
- Two organizations with a president each, a **ward council member with `org_id` null**, an
  **executive secretary**, and a bishop.
- One activity owned by organization A, one by organization B, and **one ward-wide activity**
  (`org_id` null) — the third is what makes the absent-means-default branch visible.
- A past event under each, each with an attendee and a follow-up log carrying shared notes.
- `cross_org_visibility` seeded **off**.

**Tester action:** Sign in as organization A's president; open `/youth/feed`. Flag their own
follow-up for ward council. Sign in as the executive secretary and open the bell. Sign in as the
**ward council member**. Then turn cross-org visibility **on** in admin and revisit both.

**Verification checklist:**
- [ ] With the setting **off**, A's president sees A's follow-up and the **ward-wide** one, and
      not B's
- [ ] The ward council member (no org) sees the **ward-wide** follow-up and their own, and the
      page **says in words** why the others are not there
- [ ] The bishop sees all three
- [ ] Flagging emits **one** notification, to the **executive secretary only**
- [ ] The notification body is the one-liner and contains **no** note text — shared or private —
      and the executive secretary, who holds no `youth_activities` permission, still cannot open
      the follow-up
- [ ] Unflagging and re-flagging notifies **again**; flagging twice without unflagging does not
- [ ] The flag control is **absent** on a follow-up the reader could not write — not present and
      then refused
- [ ] With the setting **on**, both presidents and the ward council member see all three, and the
      page's sentence about the mode changes to match
- [ ] `/visits/feed` still works, still flags, and still notifies — the shared helper moved
      beneath it
- [ ] No horizontal overflow at 375px; correct in light and dark

**Judgement questions for the walk:**
- Is "you cannot see the other organizations' follow-ups" a **sentence a leader accepts**, or does
  it read as the app being broken? This is the decision-1 question, and the walk is where it gets
  answered.
- Does the flag confirmation make clear the executive secretary receives a **pointer**, not the
  note? `visits-c` found a silent star inviting the reader to wonder whether they had summoned
  somebody.

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project (CLAUDE.md §9 — this is the only database)
npm run db:push

# Regenerate types after the migration
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests — the WHOLE suite, not a subset. 057 replaces live policies, and Tasks 5 and 6 move code
# the visits module depends on.
npm run test

# Regenerate the scenario manifest after adding 055 and 056
npm run manifest

# Production build. Lint, typecheck and tests can all pass while this fails: `youth-c` shipped a
# server-only constant into a client import chain and only the build caught it, and this slice
# adds two new pages and moves two shared modules.
npm run build
```

---

## Integration Notes

- **Migration 057 applies immediately**, before the code deploys, on 054/055/056's shared
  reasoning — additive-with-tightening on tables holding zero rows. **No `HELD_BACK_UNTIL_DEPLOYED`
  entry**, and adding one would make `tests/db/migrations.test.ts` blind to it. Confirm the row
  counts before writing the file (Task 1); if `activity_logs` is not empty, stop.
- **This slice NARROWS a read for the first time in Phase 8.** Anything already relying on
  `activity_logs`' ward-wide SELECT breaks. Today that is exactly one caller —
  `app/api/reports/read-status/route.ts`'s `REPORT_MODULES.youth_activity`, which has never been
  exercised — and narrowing it is correct. Grep for `activity_logs` before assuming there is no
  second.
- **Two shared modules move (Tasks 5 and 6) and the visits module must be re-verified**, not
  assumed. §Step 6 authorises changing shared code in place and re-verifying; it does not
  authorise skipping the second half. `app/api/visits/[id]/route.ts` should have **no diff at
  all** — if it does, the extraction changed a signature it should not have.
- **`components/visits/ReportFeed.tsx` and `ReportTile.tsx` should end this slice unchanged.**
  If the walk forces a change, make it **in place** and re-verify `/visits/feed` in the same
  session. Two nearly identical components is the pitfall 08-youth-activities.md names by name.
- **Phase 11 now inherits SIX things, not five.** `youth_followup_prompt` joins
  `youth_event_uncovered`, the Monday away-digest, `visit_overdue`, `refresh_goal_status()` and
  ICS re-sync as one decision about one mechanism. `youth-c` added no sixth; this slice does, and
  CLAUDE.md §9 must say so and say why (a prompt that fires "after an event passes" cannot be
  computed by the person reading it into existence).
- **Phase 9 inherits the ward-council agenda item.** A flagged follow-up notifies the executive
  secretary today and lands on nothing — there is no agenda screen yet. That is the same shape
  `visits-a` left, and it is not a gap this slice closes.
- **Not in this slice, recorded so it is not lost:** editing a follow-up's shared note has no
  history (`assignment_history` has no analogue here); `activity_events.entered_by` still does not
  exist (raised by `youth-a`, wanted with the unscoped leader-to-leader messaging feature); and
  `listActivityEvents` still orders without a tiebreaker, reproduced and deliberately left by
  `youth-c` — do not let a second one in.
- **`plans/INDEX.md` needs its `youth-d` row updated** on completion — plan link, status,
  scenario numbers — matching how `youth-a`, `youth-b` and `youth-c` are recorded. Phase 8 becomes
  shippable at that point, which is milestone **M5**.
- **CLAUDE.md §9 gains two entries:** the org-scoped-follow-up reversal (with the ward-council
  consequence stated, so nobody "fixes" it with a role branch), and the sixth clock-driven thing.
