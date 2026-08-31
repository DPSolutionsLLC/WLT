---
id: youth-h-season-close-and-safe-remove
type: feature
iter: [ITER-028, ITER-031]
commits: [cb43666]
date: 2026-08-31
files:
  - supabase/migrations/060_activity_profile_close.sql
  - lib/youth/queries.ts
  - lib/youth/profileNeed.ts
  - lib/youth/activityOwnership.ts
  - lib/validation/youth.ts
  - app/api/youth/profiles/[id]/close/route.ts
  - app/api/youth/profiles/[id]/route.ts
  - app/(app)/youth/history/[member_id]/page.tsx
  - app/(app)/youth/history/[member_id]/YouthHistory.tsx
  - app/(app)/youth/YouthOverview.tsx
  - app/(app)/youth/ActivityProfileList.tsx
  - app/(app)/youth/youthQueries.ts
related:
  - youth-f-support-percentage-and-youth-cards
  - youth-g-occasions-and-event-detail
  - youth-d-followup-and-report-feed
  - youth-a-profiles-and-events
  - youth-follow-up-controls
  - visits-f-stewardship-and-all-orgs
---

## What was done

Two backlog items that turned out to be the same button. `/youth` ranked young people on a support
percentage computed from every past home game on a profile plus the next one, and **nothing ever
left that computation** — a basketball season that finished in February kept dragging Ethan's
number about in October (ITER-028). And `Remove` on an activity deleted unconditionally: migration
009 cascades `youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
activity_private_notes}`, so one press destroyed a season, every sign-up, every pastoral follow-up
and the private notes rule 5 calls private forever (ITER-031). A confirm dialog had been added
first, and a dialog can be clicked through.

They resolve together. Migration 060 adds a nullable `closed_at`; once a season can be **closed**,
*"I want this off my list"* has an answer that destroys nothing, and the destructive path narrows to
what it should always have been — an activity created by mistake with nothing recorded against it.
`/youth/history/[member_id]` is where a finished season goes, with its final numbers recomputed
against the instant it closed.

## Key decisions

- **A timestamp, never a boolean, and never a delete.** "When did this season end" is the question
  the history page asks, and the final percentage is **recomputed against that instant rather than
  stored** — the stored-versus-computed argument this module has now had seven times, answered the
  same way each time, because nothing in this project refreshes anything. Nullable, so a mistake is
  reopened by the same route with `{ closed: false }`.
- **The `/youth` grouping is built from EVERY profile, and that is the one line ITER-028 turns on.**
  Filter closed profiles out before `byMember` and a young person whose every season has finished
  produces no group and **vanishes from the ward** — exactly what the item forbids.
  `youthNeed()` does the running/closed partition instead, so the pills, the percentage, the badge,
  the sort and the status line all come out of one pass. They sort last **with no branch added for
  it**: `lowestSupport` is already null there, and `compareYouth` already sorts null last in both
  directions.
- **Migration 060 adds NO RLS policy, deliberately.** Closing is an ordinary UPDATE and 054d already
  describes the right boundary; a second permissive policy could only widen it. The omission is
  written into the migration so a later reader does not "notice" it.
- **The delete refusal needs a `security definer` count, for a reason the plan got wrong.** The plan
  said the caller cannot see another organization's follow-ups — but `activity_event_is_in_caller_org`
  scopes a log by the **event's** organization, not the author's, so an EQ president reads an RS
  leader's note on an EQ activity perfectly well. A failing test found it. The real reasons: the
  DELETE policy admits `entered_by = auth.uid()` and the log SELECT never mentions it, so a leader
  recalled to another organization may delete what they cannot read; and the refusal must be
  **uniformly evaluable** — whether an activity may be destroyed is a fact about the activity, not
  about who asks.
- **The count is never disclosed and neither is any content.** *"Has follow-ups recorded against
  it"* is the whole of what the 409 says, and it **names Close in the same sentence** —
  `visits-f`'s empty-bulk-replace precedent. No audit row for a refused write.
- **`Remove` renders only at `eventCount === 0`, and the gate is exact rather than a heuristic:**
  `activity_logs.event_id` has been `NOT NULL` since 057a, so no events implies no follow-ups. The
  true count is an embedded PostgREST count, which `ActivityProfileList` had predicted by name and
  deferred to this item.

## What the walk found

Scenario 060 was walked in a real browser on 2026-08-31, every write read back with the service
client. The data layer was clean — the 409 fired over a follow-up the caller genuinely could not
see, and the profile, its 12 events and the log were all intact afterwards with **no audit row**.
Three defects, all in the UI layer, all fixed and re-verified:

1. **The close dialog said "how well *he or she* is supported."** `ActivityProfile` carries no
   gender — nothing in this module does — so the app has no pronoun for a member and must not imply
   one. Now "how well **they are** supported", asserted as an *absence* so the phrase cannot return.
2. **Closing an activity you entered but whose organization is not yours returned 500.**
   `canManageActivityProfile()` mirrored 054d's `USING` only, but **an UPDATE must satisfy USING and
   WITH CHECK**, and WITH CHECK omits `entered_by` on purpose. One shape diverges —
   `org_id = another organization AND entered_by = me`, which is what a release and a recall leave
   behind — and **a failed WITH CHECK RAISES where a failed USING returns zero rows**, so it escaped
   as a 500 reading "Please try again", which was untrue. Pre-existing: the ordinary Edit had it
   since `youth-a`. Fixed both ways — the mirror now copies both halves so the controls are absent,
   and `isPolicyRefusal()` maps SQLSTATE 42501 onto the same `null` the quiet refusal returns.
3. **A fully-closed card read as a young person the app had lost track of** — the user's answer to
   the judgement question was a flat *no*. It was the only card on the page **with no pills at
   all**, so beside its neighbours it looked like data that had failed to load, and it never said
   *which* activity the young person does. A finished season is now a pill like any other, dashed
   and marked *Finished*; `closedCount` became `closedActivities` carrying the names, and the
   sentence lost its count because the pills now name themselves.

**One checklist line could not fail and was rewritten.** It asked for a reload to prove the frozen
number — but every seeded event is already past, so `closed_at` and `now` give identical answers.
Replaced with a probe event dated *after* a season closed and *before* today; the page kept reading
"2 of 4", not "2 of 5", which does distinguish them.

**A judgement question was answered "keep it" and recorded as a decision:** a closed season's number
still counts the game that was next at the closing instant, because a frozen figure should be a
snapshot of that moment. The explanatory clause stays with it — remove it and the counts stop adding
up.

**The first full suite run after the fixes came back with 29 failing files and was not reported as
green.** The errors were infrastructure reads rather than assertions; unrelated suites passed alone,
and a clean re-run confirmed 3315 passing. Transient hosted-project flakiness, and worth knowing it
happens on a shared project.

## Pattern

**A mirror of an RLS policy must copy every clause that governs the operation, not the one that
reads like the rule.** `USING` says which rows you may touch; `WITH CHECK` says what you may leave
behind, and an UPDATE needs both. Copying only the first produced a control that was offered and
then raised — and because a WITH CHECK failure *raises* where every other refusal in this codebase
returns zero rows, it surfaced as a 500 rather than as the sentence the module already had. Both
halves of that lesson generalise: mirror the whole policy, and handle the loud refusal beside the
quiet one.
