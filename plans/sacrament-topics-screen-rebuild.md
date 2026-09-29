# Plan: Sacrament — rebuild the Topics & Talks screen, and retire the topic library

**Created:** 2026-09-29
**Type:** feature
**Source:** [sacrament-flow-audit.md](sacrament-flow-audit.md) §3, plus four user decisions taken
while planning (below). Module-map row: [prototype/module-map.md](prototype/module-map.md) §2.1.
**Structure:** five sub-slices, **one commit each** (the RESKIN+ rule, CLAUDE.md §12):
`t1` topic words on the talk → `t2` topic history replaces the library → `t3` the screen →
`t4` the speaker window → `t5` the topic window.

---

## Overview

Both the **Topics** and **Talks** pills on the Sacrament hub open `/assignments/[sunday_id]`. That
page is still the Phase 4 talk-pipeline page: one big card per talk, a single modal that edits
everything, the pipeline on show, and a back link to a month planner that no menu reaches any more.
The prototype's `ModuleView` (`prototype/WLT.jsx` 6372–6632) shows what it should be instead: a
compact list of what still has to be done on one Sunday.

### User decisions — 2026-09-29 (these override the audit where they differ)

1. **NO TOPIC LIBRARY.** In the user's words: they don't want "a library of preselected topics".
   A talk's topic is **the words typed for it**. What they do want is "a good usable history of
   topics that have been used". When picking a topic for a talk, a small window lets you type one,
   **check it against that history**, or **ask AI for suggestions**. `/talks/topics` stops being a
   library and becomes a **searchable topic history**: sortable by date, speaker or topic. It gets
   a **dashboard tile** again. This **reverses** the audit's decision 2 ("free text with library
   hints") and `sacrament-topics-finalize-and-history` `b1`'s "the library and its AI candidate
   queue stay".
2. **Delete on a talk = cancel it, and shift up.** The talk is cancelled and kept as a record,
   using the f2c machinery (speaker history `cancelled`, plus a "Let ___ know it's cancelled"
   to-do if the speaker had been asked). Later talks move up one slot, and the Sunday gets one
   fewer speaker.
3. **Details opens a window.** Each talk row has a small **Details** button that opens a popup with
   its slot length, Approvals, Contacting the speaker and Comments. The 9-stage pipeline stays
   (decision U5); it is just no longer on the main screen. This matches
   [compact-ui-preference] in memory.
4. **Suggest topics = AI.** It uses the existing generation stack (`lib/ai/topicSuggestions.ts`,
   retrieval, `callClaudeStructured`) and returns **drafts that are never stored**. A suggestion
   reaches a talk only when the planner picks it and presses Save (rule 3).

### Out of scope, and said so

- **Day categories (slice `d`)** and **placed musical numbers (slice `e`)** come after this plan,
  on top of the screen it builds. Until then the row's category chip shows the talk's
  **assignment type**, and the speaker window keeps the "Kind of talk" select.
- **The prototype's household grouping** in the speaker picker belongs to slice `d` (it is driven
  by the "Household" day category). `t4` lists members flat, most overdue first.
- **Send asks** stays on the hub's Talks pill, where f1 put it.
- **Dropping the `topics` / `topic_candidates` tables and `assignments.topic_id`.** They stop being
  written or read, and their data is kept (never destroy what somebody wrote). Dropping them is a
  later, deliberate migration.

### Success criteria

- From the hub, the Topics or Talks pill opens a screen shaped like the prototype's:
  - a **"← Back to calendar"** link, the eyebrow "Topics · {date}", and the heading **"What still
    needs to happen"**
  - the **Speakers this week** stepper
  - one compact row per talk, where the speaker line and the topic line each open **their own
    window** and each carry **their own status tag** and a **Clear** button
  - **Details** and **Delete** on each talk's title row
  - Finalize at the **bottom**, with the prototype's wording
  - **"View the full program for this date →"** at the foot
- A topic is any words, up to 200 characters. Nothing anywhere in the app still requires a library
  topic.
- `/talks/topics` is a topic history: search, sort, and "Coming up" marked. It has a dashboard tile.
- The speaker window lists members most overdue first, with "last spoke …" and a **History**
  button (bishopric only). It also offers **"Use '…' as typed"**.
- The topic window shows **"Used before, most recent first"** while you type, and offers **Check
  topic** and **Suggest topics** (AI drafts, never stored).
- Lint, typecheck, the full suite and the production build all pass. Scenarios 083 and 084 have
  been walked in a browser.

---

## Relevant Files

### t1 — topic words on the talk
- `supabase/migrations/086_talk_topic_words.sql` — **create**. Use the next free number (086
  unless f3 has taken it). Adds `assignments.topic_title` and backfills it.
- `types/database.ts` — **regenerate** (`npm run db:types`).
- `lib/assignments/queries.ts` — modify: `Assignment.topicTitle`, column list, mapper,
  create/update writes. `SpeakerHistoryRow` gains `topicTitle` (via `attachAssignmentContext`).
- `lib/validation/assignment.ts` — modify: replace `topicId` with `topicTitle`.
- `lib/assignments/pipeline.ts` — modify: the required field becomes `topicTitle`.
- `lib/topics/finalize.ts` — modify: `topicShapeChanged()` tests `"topicTitle" in patch.fields`.
- `app/api/assignments/route.ts`, `app/api/assignments/[id]/route.ts` — modify: accept and
  write `topicTitle`; stop writing `topic_id`; stop stamping `topics.last_assigned_at`.
- `app/api/assignments/[id]/ai-message/route.ts` — modify: retrieval query from `topicTitle`;
  scriptures from the talk's references (see Task 1.6).
- `app/api/sundays/[id]/references/route.ts` — modify: `topicTitle` from the talk;
  `suggestedScriptures` removed.
- `components/sacrament/ReferenceSearchDialog.tsx` — modify: remove the suggested-scripture picks.
- `lib/sacrament/sundayStatus.ts`, `app/(app)/sacrament/page.tsx` — modify: `topicTitle !== null`.
- `lib/sacrament/sundayAsks.ts` — modify: read `topicTitle` directly (drop the `getTopic` loop).
- `lib/todos/queries.ts`, `lib/appointments/queries.ts`, `lib/todos/askSource.ts` — modify: the
  `ask:assignments` embed selects `topic_title` instead of `topics!…(title)`.
- `lib/music/sundayTopics.ts` — modify: titles from `topic_title`.
- `lib/program/assembleDraft.ts` — modify: `assignment.topicTitle`.
- `lib/references/queries.ts` — modify: filter on `topicTitle !== null`.
- `app/(app)/assignments/AssignmentModal.tsx` — modify: the topic `<select>` becomes a text input.
  This is temporary for the month planner; `t3` stops the per-Sunday page using this modal.
- `app/(app)/assignments/MonthPlannerBoard.tsx`, `app/(app)/assignments/page.tsx` — modify: stop
  passing `topics`.
- `app/(app)/assignments/[sunday_id]/page.tsx`, `app/(app)/assignments/ContactStagePanel.tsx` —
  modify: `topicTitle`; scriptures from references.
- Every test fixture that builds an `Assignment` or posts `topicId` — modify (the compiler lists
  them).

### t2 — topic history replaces the library
- `lib/topics/topicHistory.ts` — **create**. Pure functions: `topicSimilarity`,
  `similarTopicUses`, `filterAndSortTopicHistory`, `timeAgoLabel`.
- `lib/topics/queries.ts` — modify: `listRecentTopicUsage` becomes `listTopicHistory`
  (all time, reads `topic_title`, drops `topicId`). `mapTopicUsageRows` is updated to match.
- `app/(app)/talks/topics/page.tsx` — **rewrite** as the history page.
- `app/(app)/talks/topics/TopicHistoryList.tsx` — **create** (client: search, sort, list).
- `app/(app)/talks/topics/RecentTopicUsage.tsx` — **delete** (replaced by `TopicHistoryList`).
- **Library UI deletions** (approved by accepting this plan):
  `app/(app)/talks/topics/{TopicList,TopicForm,CandidateQueue,SuggestTopicsButton}.tsx`.
- **Library route deletions:** `app/api/topics/route.ts`, `app/api/topics/[id]/route.ts`,
  `app/api/topics/ai-suggest/route.ts`, `app/api/topic-candidates/route.ts`, and their tests
  `tests/routes/topic-candidates.test.ts` and `tests/routes/ai-suggest.test.ts`, plus any
  `tests/**` that only exercise the deleted routes/components (grep for their imports).
- `lib/auth/navigation.tsx` — modify: the Topics item becomes **"Topic history"**, with
  `onDashboard` removed (so it shows as a tile) and a new blurb. It keeps `topics.view`.
- `lib/topics/topicRotation.ts` — check. If only library code used it, it goes with the library;
  otherwise `RECENT_MONTHS` stays.

### t3 — the screen
- `app/(app)/assignments/[sunday_id]/page.tsx` — **rewrite** into the prototype's shape.
- `components/sacrament/TalkRow.tsx` — **create** (one compact talk row).
- `lib/sacrament/talkRowStatus.ts` — **create** (pure: the speaker tag and the topic tag).
- `components/sacrament/SpeakerCountStepper.tsx` — **create**.
- `components/sacrament/TalkDetailsWindow.tsx` — **create** (slot length, Approvals, Contacting,
  Comments, in a `Modal`).
- `components/sacrament/SpeakerWindow.tsx` — **create** (basic version: the existing
  `SpeakerField` plus "Kind of talk"; `t4` upgrades it).
- `components/sacrament/TopicWindow.tsx` — **create** (basic version: a text input and Save; `t5`
  upgrades it).
- `components/sacrament/TopicsFinalizedPanel.tsx` — modify: the prototype's wording, rendered at
  the bottom.
- `app/(app)/assignments/SundaySlotList.tsx` — modify or fold into the page. **Keep
  `sundaySlotEntries()`**: its "talks outside the slots are listed after, never dropped" rule
  still applies.
- `supabase/migrations/087_remove_talk.sql` — **create** (next free number): a `remove_talk()`
  SQL function (Task 3.6).
- `lib/assignments/removeTalk.ts` — **create**.
- `app/api/assignments/[id]/route.ts` — modify: a new PATCH action `remove`.
- `lib/validation/assignment.ts` — modify: the `remove` action schema.

### t4 — the speaker window
- `lib/assignments/speakerOrder.ts` — **create** (pure: most overdue first, plus a "last spoke"
  label).
- `components/sacrament/SpeakerWindow.tsx` — modify: the ordered list, History, "use as typed".
- `components/sacrament/PersonHistoryWindow.tsx` — **create**.
- `app/(app)/assignments/[sunday_id]/page.tsx` — modify: pass speaker history (bishopric only).

### t5 — the topic window
- `components/sacrament/TopicWindow.tsx` — modify: the live hint, Check topic, Suggest topics.
- `app/api/assignments/topic-suggestions/route.ts` — **create**: `POST`, which returns drafts and
  writes nothing.
- `lib/ai/topicSuggestions.ts` — modify: a slim `talkTopicIdeasSchema` and prompt builder for
  talk topics. Remove the candidate-only helpers once `t2` has deleted their only caller.
- `lib/validation/aiRequests.ts` — modify: the request schema (optional `context`, `sundayId`).

### Docs (updated in the sub-slice that makes them true)
- `SPEC.md` — `assignments.topic_title`; the route changes; the library routes gone.
- `FEATURES.md` — the Topics module now means "topic history + the topic window".
- `plans/prototype/module-map.md` §2.1 — record decision 1 as a reversal of correction (b)'s
  library premise, and record `t1`–`t5` as built.
- `plans/P4-module-reskins.md` §1 — a slice note.
- `CLAUDE.md` §9 — **one** short entry: "A TALK'S TOPIC IS ITS WORDS; THERE IS NO TOPIC LIBRARY —
  DECIDED 2026-09-29".
- `plans/sacrament-flow-audit.md` §3 — point at this plan.

---

## Dependencies

- **No new libraries.**
- **Reuse:**
  - `cancelSundayWork` semantics and the save-time reconcile (`lib/sacrament/conductorHandover.ts`),
    for Delete
  - `unfinalizeTopicsIfNeeded` / `clearTalkShapeStamps` (`lib/topics/finalize.ts`)
  - `listSpeakerHistoryByMember` and `reliabilityFlags`
  - `Modal` (which fits its content and is a bottom sheet on phones)
  - `SpeakerField`, `MemberPicker` (`mode="inline"`), `SpeakerLine`, `ApprovalPanel`,
    `ContactStagePanel`, `CommentThread`, `GoalAlertBanner`
  - `lib/ai/client.ts` `callClaudeStructured`, `retrieveChunks` and `buildSystemPrompt`
  - `writeAuditLog`, and `readJsonBody` / `respondToRouteError`
  - the page-view helper in `lib/users/userSettings.ts`, to remember the history page's sort
    ([remember-page-view] in memory)
- **Migrations:** two, which must be applied to the hosted DB (`npm run db:push`), followed by
  `npm run db:types`. Both are additive, so neither is held back behind a deploy. `t1`'s backfill
  must run **before** the new code reads `topic_title`, and applying the migration before the
  deploy guarantees that.

---

## Known Pitfalls (from retro context)

- **sacrament-topics-finalize-and-history** — the un-finalize rule is about **what changed**: a
  topic set, changed or cleared un-finalizes, and so does a slot-count change. `t1` renames the
  field `topicShapeChanged()` inspects, so the source-reading test that guards the three write
  paths must be updated and **proved able to fail**. Delete (`t3`) changes the slot count and must
  un-finalize.
- **sacrament-topics-finalize-and-history** (walk) — a history window relative to **today** needs
  seed data relative to today. Scenario 084's seed dates are computed from the run date, never
  fixed.
- **sacrament-topics-finalize-and-history** — the "Recently used" row broke at 375px because a
  fixed-width date column squeezed the title. The history list stacks below `sm:`.
- **talks-b-month-planner** — `MemberPicker` must be `mode="inline"` inside a `Modal` (they do not
  stack). The same rule applies to History opened from inside the speaker window: **replace** the
  window's content with the history view and a Back button. Never open a second `Modal`.
- **talks-b-month-planner** — `react-hooks/set-state-in-effect` and `react-hooks/refs` are lint
  errors. Only `npm run lint` catches them.
- **talks-b-month-planner** — render speakers through `SpeakerLine` / `speakerDisplayName`, never
  re-derive a name from `member_id`.
- **sacrament-references-over-pgvector** — a modal needs `h-fit`, not `h-auto`. Never run
  `npm run build` while `npm run dev` is running (every API route answers 404 afterwards).
- **p4-sacrament-a / sundayStatus** — the hub and this page must agree on what "has a topic"
  means. `sundayStatus.ts`'s count and this page's topic tag read the **same** field
  (`topicTitle !== null`).
- **Sacrament f2c** — a cancelled talk is a record that every reader skips
  (`tests/lib/cancelledReaders.test.ts`). Any new read of `assignments` (the history list, the
  topic hints, the speaker order) must skip `cancelled_at is not null`, or that test must be
  extended to cover it.
- **CLAUDE.md §9 "an author is not a subject"** — `remove_talk()` writes no user id, so
  `findUsersOutsideWard()` is not needed. If a later change makes it write one, add the check.
- **HANDOFF gotcha** — stopping `npm run dev` orphans the Next child on port 3000. Kill it by PID
  after confirming its command line.

---

## Tasks

### Sub-slice t1 — a talk's topic is its words

#### Task 1.1: Migration — `assignments.topic_title`
**File:** `supabase/migrations/086_talk_topic_words.sql` (create)
**Details:**
- `alter table assignments add column topic_title text check (topic_title is null or (char_length(btrim(topic_title)) between 1 and 200));`
- Backfill: `update assignments a set topic_title = t.title from topics t where t.id = a.topic_id and t.ward_id = a.ward_id and a.topic_title is null;`
- **No change to `topic_id`, `topics` or `topic_candidates`.** They are simply no longer written.
- Header comment (the *why*): decision 1. The talk carries the words the speaker was asked to speak
  about, so a later rename elsewhere cannot rewrite what somebody was asked. The old columns are
  kept for their data.
- Apply it (`npm run db:push`), then run `npm run db:types`.

#### Task 1.2: The `Assignment` type and data layer
**File:** `lib/assignments/queries.ts` (modify)
- `topicId` → `topicTitle: string | null` on `Assignment`. Update the column list and
  `mapAssignmentRow`.
- `createAssignment` / `updateAssignmentFields` write `topic_title`, trimmed, with an empty string
  stored as null. Remove the `topics.last_assigned_at` stamp call (`lib/topics/queries.ts` ~334)
  from every caller.
- `attachAssignmentContext` selects `topic_title` too, so `SpeakerHistoryRow` gains
  `topicTitle: string | null` (for `t4`'s History window).

#### Task 1.3: Validation
**File:** `lib/validation/assignment.ts` (modify)
- Replace `topicId: z.uuid(...)` in both schemas with
  `topicTitle: z.string().trim().max(200, "Keep the topic under 200 characters.").nullable().optional()`,
  where an empty string becomes null.
- Export `MAX_TOPIC_TITLE = 200` from `types/domain.ts` and use it in both the schema and the
  input's `maxLength`.

#### Task 1.4: Rules that name the field
- `lib/assignments/pipeline.ts`: the required fields become `["speaker", "topicTitle", "slotNumber"]`,
  and the missing-field sentence stays "a topic".
- `lib/topics/finalize.ts`: `"topicTitle" in patch.fields`. Update the comment.
- The source-reading test for the finalize writers (find it with
  `grep -rn "topicShapeChanged" tests`): update it, then **prove it can fail** by temporarily
  removing the helper call from one route.

#### Task 1.5: Every reader switches
Work through the reader list in Relevant Files. `tsc` will list every site once `topicId` is gone
from the type. For the PostgREST embeds in `lib/todos/queries.ts`, `lib/appointments/queries.ts`
and the comment in `lib/todos/askSource.ts`, replace
`topics!assignments_topic_id_ward_id_fkey (title)` with `topic_title` on the `ask:assignments`
embed, and update each mapper. **Keep each select string on ONE line** (the literal-type rule
recorded in `lib/topics/queries.ts`).

#### Task 1.6: Scriptures without a library
- `ai-message` route: the retrieval query becomes `assignment.topicTitle`. `suggestedScriptures`
  becomes the talk's own **scripture** references from `listReferencesForAssignments(wardId, [id])`,
  filtered to `kind === 'scripture'` and mapped to their citation text (check the field name in
  `lib/references/queries.ts`).
- `[sunday_id]/page.tsx` → `ContactStagePanel` gets its scriptures the same way (one
  `listReferencesForAssignments` call for all the Sunday's talks).
- References route: drop `suggestedScriptures` from `ReferencesTalk`. `ReferenceSearchDialog`:
  remove the one-tap suggested-scripture picks. The search itself is untouched.
- **Say this in the commit's retro.** The picks came from the library's `suggested_scriptures`,
  which no longer exist for new topics. The references a planner actually chooses are the better
  source anyway.

#### Task 1.7: The month planner's modal
**File:** `app/(app)/assignments/AssignmentModal.tsx` (modify)
- Replace the topic `<select>` with an `Input` labelled "Topic" (`maxLength={MAX_TOPIC_TITLE}`,
  placeholder "Type a topic…"). Remove the `topics` prop and the empty-library sentence.
- `AssignmentEditButton`, `MonthPlannerBoard` and `assignments/page.tsx`: stop loading and passing
  `listTopicOptions`.

---

### Sub-slice t2 — topic history replaces the library

#### Task 2.1: Pure history helpers
**File:** `lib/topics/topicHistory.ts` (create). No clock, no `Date` in local time: every function
takes `today: DateOnly`.
- `topicSimilarity(a, b)`: a port of the prototype (4582). Lower-case, split on `/\W+/`, keep words
  of 3 or more letters, and match when either word is a **prefix** of the other.
- `similarTopicUses(typed, history)`: returns `[]` under 2 characters. Otherwise it finds the
  similar entries, **dedupes on the lower-cased trimmed topic keeping the most recent use**, and
  sorts newest first (prototype 4590).
- `timeAgoLabel(date, today)`: "N days/months/years ago", or "Never spoken" for null, with the
  prototype's thresholds (4566). A future date reads **"Coming up"**, not a negative number.
  Computed from `DateOnly` strings through `lib/calendar/dates.ts` helpers.
- `filterAndSortTopicHistory(entries, { query, sort })`: `query` matches the topic or the speaker
  name, case-insensitively. `sort` is `date_desc | date_asc | topic | speaker`, and ties break on
  date descending.
- Type `TopicHistoryEntry = { assignmentId, sundayId, date, topicTitle, speakerName: string | null, isUpcoming }`.

#### Task 2.2: The read
**File:** `lib/topics/queries.ts` (modify)
- Rename `listRecentTopicUsage` to `listTopicHistory(wardId, { today }, client)`. It reads **all
  time**, with no `topicUsageWindow`. It selects `id, sunday_id, slot_number, topic_title,
  external_speaker_name, speaker:members!assignments_member_id_ward_id_fkey (first_name,
  last_name)`, filtered with `.not("topic_title","is",null).is("cancelled_at", null)`.
- Resolve dates through `listSundays` as it does today. Rewrite `mapTopicUsageRows` to produce
  `TopicHistoryEntry`.
- Keep the header's reasoning about reading `assignments` directly, and about looking forward and
  marking what it finds.

#### Task 2.3: The page
**Files:** `app/(app)/talks/topics/page.tsx` (rewrite), `TopicHistoryList.tsx` (create)
- Gate: `can(user, "topics.view", roleAccess)` (unchanged), and `NotPermitted` otherwise.
- Heading "Topic history" with the line "Every topic given in sacrament meeting, and who gave it."
- Client list with:
  - a search input ("Search topics or speakers")
  - a sort select (Newest first / Oldest first / Topic A–Z / Speaker A–Z)
  - rows showing date · topic · speaker, with upcoming rows carrying a **Coming up** pill
- The row layout stacks below `sm:` (see Pitfalls). The empty state says what fills the list:
  "Topics appear here once a talk has one."
- **The sort choice is remembered on the account** through the page-view helper
  (`lib/users/userSettings.ts`, `PUT /api/session/page-view`), following the pattern
  `/appointments` uses.
- Dates render via `formatSundayLabel` (a `date` column, so UTC; rule 12).

#### Task 2.4: Retire the library
- Delete the files listed under t2 in Relevant Files, then
  `grep -rn "TopicList\|TopicForm\|CandidateQueue\|SuggestTopicsButton\|/api/topics\|/api/topic-candidates" app components lib tests testing`.
  Fix or remove every hit. Any harness scenario that walks the library gets a one-line note that
  it is retired; don't delete scenarios.
- `lib/auth/navigation.tsx`, the Topics item:
  - label **"Topic history"**
  - blurb "Every topic used, when, and by whom."
  - remove `onDashboard: false`
  - rewrite the ⚠️ comment: the candidate queue is gone because there is no library (decision 1),
    so the reason to keep the row but withhold the tile no longer holds
  - the item stays in the hub's shortcut row as well
- `lib/topics/queries.ts`: remove only the functions that now have **no caller** (`tsc` plus grep
  will show them). Leave the table-level types alone if migrations or tests still use them.
- `tests/lib/navigationRoutesExist.test.ts` must stay green.

---

### Sub-slice t3 — the screen

#### Task 3.1: The pure row status
**File:** `lib/sacrament/talkRowStatus.ts` (create)
- `speakerTag(talk, hasOpenAsk)` returns
  `{ label, tone: "missing" | "pending" | "ok" }`, applying the first rule that matches:
  1. no speaker → "Needs speaker" (missing)
  2. `requestOutcome` accepted → "Accepted" (ok)
  3. declined → "Declined" (missing)
  4. `hasOpenAsk` → "Ask sent" (pending)
  5. otherwise → "Speaker selected" (pending)

  **Reuse** f1's ask-state inputs from `lib/sacrament/talkAsks.ts` / `sundayAsks.ts`; do not
  re-derive open asks. The hub's four-state pill and these tags must not disagree.
- `topicTag(talk)`: "Topic selected" (ok) or "Needs topic" (missing).
- Tones map to existing tokens (`--success`, `--warning`, `--danger`). Every tag carries words, so
  colour is never the only signal (ITER-022).

#### Task 3.2: `TalkRow`
**File:** `components/sacrament/TalkRow.tsx` (create, client)
- **Title line:** "Talk {slot}" plus a small category chip, which shows
  `ASSIGNMENT_TYPE_LABELS[type]`, and only when the type is not `sacrament_talk` (slice `d`
  replaces this). On the right sit the small buttons **Details** and **Delete**:
  - **Delete** only when `canRemove` (`talks.plan` ∧ `calendar.manage`) and the Sunday has more
    than one talk
  - both buttons keep 44px tap targets while their visible part stays small (the StatusPill
    pattern)
- **Speaker line:** a button covering the line. It shows `SpeakerLine` (or "Nobody yet", muted)
  with the speaker tag, and **Clear** when a speaker is set. Clicking opens `SpeakerWindow`.
- **Topic line:** the same shape, showing `topicTitle` or "No topic yet" at a smaller weight, with
  the topic tag and Clear. Clicking opens `TopicWindow`.
- **Clear is a sibling button, never nested inside the line's button** (a nested interactive
  element is invalid HTML).
- Without `talks.plan`, the lines are plain text and there is no Clear, Delete or window (absent,
  not disabled).
- **Clearing must honour approvals.** If the talk has approvals, Clear first shows
  `describeInvalidation()` inline with **"Clear and reset approvals"**. The same rule applies to
  saving from either window. Reuse `describeInvalidation` from `AssignmentModal.tsx`; move it to
  `lib/assignments/invalidation.ts` if a component can't import it cleanly.
- Clear calls `PATCH /api/assignments/[id]` `{action:"update", fields:{ memberId:null, externalSpeaker:null }}`
  or `{ topicTitle:null }`, then `router.refresh()`. Errors show a `FormError` under the row.

#### Task 3.3: `SpeakerWindow` and `TopicWindow` (basic)
- `SpeakerWindow`:
  - a `Modal` titled "Assign a speaker" or "Change speaker", with the subtitle "Talk i of n"
  - body: `SpeakerField` (inline picker) plus a "Kind of talk" select (`ASSIGNMENT_TYPES`), then
    Cancel / Save
  - on a talk that does not exist yet (an open slot), Save POSTs `/api/assignments` with
    `slotNumber`; otherwise it PATCHes
  - reuse `AssignmentModal`'s request code by extracting `saveAssignment()` into
    `lib/assignments/saveAssignment.ts` (client-safe). Do not copy it.
- `TopicWindow`: "Set a topic" or "Change topic", "Talk i of n", an `Input` (autofocus,
  `maxLength`), then Cancel / Save. Save is disabled while the input is blank.
- Both windows get the approvals confirm (Task 3.2).

#### Task 3.4: `SpeakerCountStepper`
**File:** `components/sacrament/SpeakerCountStepper.tsx` (create, client)
- The label is "Speakers this week", with " (default)" appended when the count equals the ward's
  `default_speaking_slots`.
- Controls: − / count / + / **Save**, with a range of 1–6. Save is disabled when unchanged.
- − is disabled when the **last** slot's talk has a speaker, with the hint "Clear one speaker slot
  to go lower." (the prototype's rule). Removing a talk from the middle is what Delete is for.
- Save PATCHes `/api/sundays/[id]` `{ speakingSlots }`. **Follow `SundayEditor`'s
  warn-then-confirm protocol** for that route (find it in `app/(app)/calendar/`). If the route
  answers with a warning, show it and resend with the confirm flag. Do not bypass it.
- After a successful save, if the user holds `admin.manage_ward` and the new count ≠ the ward
  default, show inline: "Make {n} the default for Sundays added from now on?" with **Yes** / **No**.
  Yes calls the ward calendar settings route (`app/api/ward-settings/calendar/route.ts`; check its
  method and body). The wording is honest: the setting only affects Sundays generated later.
- Rendered only with `calendar.manage`. Otherwise the page shows the count as text.

#### Task 3.5: `TalkDetailsWindow`
**File:** `components/sacrament/TalkDetailsWindow.tsx` (create, client)
- A `Modal` titled "Talk {slot} — details" with four sections, in this order:
  1. **Slot length** (the minutes input from `AssignmentModal`, with its own Save; `talks.plan`
     only)
  2. **Approvals** (`ApprovalPanel`)
  3. **Contacting the speaker** (`ContactStagePanel`)
  4. **Comments** (`CommentThread`)
- All the data comes from props the server page already loads today: the approvals, comments,
  bishopric names and scriptures per assignment. Nothing is fetched on open.
- **The visitor's title stays in `SpeakerField`** (the external side), where it already lives.

#### Task 3.6: Delete — cancel and shift up
**Files:** `supabase/migrations/087_remove_talk.sql`, `lib/assignments/removeTalk.ts`, the
PATCH route and its schema.
- **SQL function** `remove_talk(p_assignment_id uuid) returns void`, `security invoker` so RLS
  still applies, `set search_path = public`. In **one transaction**:
  1. Lock and read the talk. Raise if it is missing, already cancelled, or not in
     `current_ward_id()`.
  2. Read its Sunday. Raise with a distinct message if `speaking_slots <= 1`.
  3. `update assignments set cancelled_at = now(), cancelled_reason = 'slot_removed' where id = p_assignment_id;`
     (`slot_removed` already exists in 085's CHECK).
  4. `update assignments set slot_number = slot_number - 1 where sunday_id = … and cancelled_at is null and slot_number > <removed slot>;`
  5. `update sundays set speaking_slots = speaking_slots - 1, topics_finalized_at = null, <the other talk-shape stamps clearTalkShapeStamps clears> where id = …;`
     Read `lib/topics/finalize.ts` for the exact columns, and **keep a references skip standing**,
     as that helper does.

  There is no unique index on `(sunday_id, slot_number)` (verified), so the shift needs no
  temporary offset. Re-check this at execution time.
- `removeTalk(wardId, assignmentId, client)` calls the RPC, maps the two raise messages to
  `InvalidInputError` / a 409 with a sentence, then **runs the f2c save-time reconcile** for that
  Sunday. Find the entry point in `lib/sacrament/conductorHandover.ts` that
  `updateSunday()` calls after `cancelSundayWork`. That reconcile writes the speaker-history
  `cancelled` row (with a null notice) and the "Let ___ know it's cancelled" to-do for the asker.
  It is retry-safe by design.
- Route: `PATCH /api/assignments/[id]` `{ action: "remove" }`. It checks
  `assertCan(talks.plan)` **and** `assertCan(calendar.manage)`, then `removeTalk`, then
  `writeAuditLog({ action: "assignment.remove", detail: { sundayId, slotNumber, shiftedCount } })`.
  The audit carries no names and no topic.
- UI: Delete opens a small confirm in the row (not a second `Modal`) reading "Remove talk {n}?
  {Speaker} will be told it's cancelled. Later talks move up." The middle sentence appears only
  when the talk had a member who was asked. Then **Remove talk** / **Keep**.

#### Task 3.7: The page
**File:** `app/(app)/assignments/[sunday_id]/page.tsx` (rewrite). Keep the existing gates, the
`notFound()` handling, the goal-alert logic and its cookie read.
- Top:
  - a link **"← Back to calendar"** → `/sacrament?month={monthOf(date)}`. Check that the hub reads
    `?month=`; if it uses another parameter, match it.
  - eyebrow "Topics · {formatSundayLabel}"
  - `h1` **"What still needs to happen"**
  - `SundayTypeBadge`
- `GoalAlertBanner`, unchanged (WLT-only, kept deliberately).
- **When `speakingSlots === 0`:** a single card, "This Sunday has no speaking slots, so there are
  no talks to plan.", and nothing else from the topics section.
- Otherwise:
  - `SpeakerCountStepper`
  - one `TalkRow` per `sundaySlotEntries()` entry; an open slot renders a row with "Nobody yet" /
    "No topic yet", and its first save creates the assignment
  - `TopicsFinalizedPanel` at the **bottom**, reworded:
    - Not finalized: title "Not finalized yet", body "Once you're done deciding speakers and
      topics for this day, finalize it — that's what tells the music coordinator it's ready to
      work on, even before speakers accept.", button **Finalize topics**
    - Finalized: title "✓ Finalized", body "Ready for the music coordinator to work on. Any change
      you make here will un-finalize it again.", button **Undo**
    - Keep its gate (`topics.manage`) and the UTC stamp.
- A small **"Comments on this Sunday"** button opening the Sunday-level `CommentThread` in a
  `Modal` (WLT-only, kept, moved off the main screen).
- Foot: **"View the full program for this date →"** → `/program/{sunday.id}`.
- Data loaded (`Promise.all`):
  - assignments, members, bishopric, Sunday comments, per-assignment approvals and comments (as
    today)
  - the Sunday's open asks (f1's loader)
  - the talks' references (for scriptures)
  - the ward default speaking slots (`readDefaultSpeakingSlots`)
  - **no `listTopicOptions`**
- Remove the `SundaySlotList` render-prop plumbing if the page no longer needs it. **Keep
  `sundaySlotEntries` and its test.**

#### Task 3.8: Hub consistency
- `sundayPillHrefs()` is unchanged (both pills → `/assignments/{id}`).
- Update the long comment above it only where it names the page's old behaviour.

---

### Sub-slice t4 — the speaker window

#### Task 4.1: Pure ordering
**File:** `lib/assignments/speakerOrder.ts` (create; imports only `@/types/domain` and
`lib/calendar/dates.ts`)
- `lastSpokeOn(history)` returns the latest `sundayDate` among entries with
  `outcome === "completed"`. Cancelled and declined entries never count (f2c's rule, matching
  `reliabilityFlags`).
- `orderSpeakerCandidates(members, historyByMember)`:
  - never spoken first (alphabetical among them)
  - then the oldest `lastSpokeOn` first
  - ties alphabetical by last name, then first name
- With **no history available** (a non-bishopric planner), the order is plain alphabetical, and
  the caller passes `null` so the window can say nothing rather than claim "Never spoken".

#### Task 4.2: `SpeakerWindow` upgrade
**File:** `components/sacrament/SpeakerWindow.tsx` (modify). Reshape it after
`AssignSpeakerModal` (prototype 6091). Keep "Kind of talk", which drives youth vs adult as today.
- When a speaker is chosen: a chip with the name and an ✕ (icon-only remove).
- Otherwise:
  - a search input (autofocus, placeholder "Search by name, or browse the list below…")
  - a **Show list / Hide list** toggle
  - the ordered list, one row per member: the name as a button, a muted "last spoke 8 months
    ago" (or "Never spoken"), the reliability flags already computed for bishopric planners, and a
    small **History** button (bishopric only)
- When the search has text: **"Can't find them? Use "{text}" as typed"**. This sets an
  **external** speaker with that name, and a small optional "Title" input appears under the chip
  (`EXTERNAL_TITLE_HINT`). That is WLT's visiting speaker, now reached the prototype's way.
- **This replaces `SpeakerField`'s member/external radio in this window.** `SpeakerField` stays for
  `AssignmentModal` (the month planner). Don't change it.
- Implement the list directly over the members the page passes in (already loaded), not through
  `MemberPicker`. `MemberPicker` has no ordering or History hook. Filter by category exactly as
  `MemberPicker`'s `filter={{categories:[category]}}` does; reuse its predicate if it is exported.

#### Task 4.3: `PersonHistoryWindow`
**File:** `components/sacrament/PersonHistoryWindow.tsx` (create)
- **Not a second `Modal`:** it renders *inside* `SpeakerWindow`, replacing the list, with
  "← Back to the list".
- Content, from `SpeakerHistoryRow[]`:
  - the name, and "Speaking history — N talks"
  - completed talks newest first: date · topic (`topicTitle`, or "No topic recorded") · kind of
    talk
  - then "Declined asks — N, for pattern-spotting": date · "Talk" · the decline reason label
    (existing labels) · notes
  - the empty state "No talks on record yet."

#### Task 4.4: Page wiring
- Only when the user holds a bishopric role, as `app/(app)/assignments/page.tsx`'s
  `readSpeakerFlags` already decides: load `listSpeakerHistoryByMember` once, and pass both the
  history map and the computed flags to the rows' windows.
- Otherwise pass `null`. **Never fetch history on a non-bishopric planner's behalf** (the talks-d
  rule).

---

### Sub-slice t5 — the topic window

#### Task 5.1: The suggestions route
**File:** `app/api/assignments/topic-suggestions/route.ts` (create)
- `POST { sundayId, context?: string (≤300) }`. Resolve the session **outside** the try block (the
  redirect rule recorded in the old ai-suggest route). Then:
  1. `assertCan(talks.plan)`
  2. parse with Zod
  3. confirm the Sunday is in the ward
  4. load AI settings and the topic history (`listTopicHistory`)
  5. build the retrieval query from `context` and the ward's topic preferences/context
  6. `retrieveChunks`
  7. `buildSystemPrompt`
  8. `callClaudeStructured` with `talkTopicIdeasSchema`, `thinking: { type: "adaptive" }` and
     `output_config: { effort: "high" }` (CLAUDE.md §3; **never** `budget_tokens`)
- The prompt names the topics used in the last `RECENT_MONTHS` months and the ones coming up, and
  asks for **5 new topics, each with a one-sentence why**. Filter out any title
  `topicSimilarity`-matching a recent or upcoming use. Return `{ suggestions: [{ title, why }] }`.
- **It writes nothing** except `writeAuditLog({ action: "ai.topic_suggestions", detail: { sundayId, count } })`
  (an AI call is audited the way the other AI routes are; check `ai-message`). No topic, no
  candidate, no assignment.
- On an Anthropic error, respond through `respondToRouteError` / the existing AI error mapping
  (`lib/ai/errors.ts`) with an actionable sentence.

#### Task 5.2: Schema and prompt
**File:** `lib/ai/topicSuggestions.ts` (modify)
- Add `talkTopicIdeasSchema = z.object({ topics: z.array(z.object({ title: z.string().min(3).max(120), why: z.string().min(10).max(240) })).min(1).max(8) })`.
- Add `buildTalkTopicPrompt({ context, recentTitles, upcomingTitles, month })`. It is pure. The
  month gives the season a nudge, as the prototype's rule-based version leans on the time of year.
- Delete the candidate-only helpers (`formatTalkCitation`, `filterNovelSuggestions`, the old
  schema) only if `t2` left them with no caller, and update their tests in step.

#### Task 5.3: `TopicWindow` upgrade
**File:** `components/sacrament/TopicWindow.tsx` (modify). Reshape it after `AssignTopicModal`
(prototype 6275).
- Props: `talkIndex`, `totalTalks`, `current`, `history: TopicHistoryEntry[]` (passed from the
  page) and `today`.
- **Live hint:** under the input, when `similarTopicUses(text, history)` is non-empty, show a box
  titled "Used before, most recent first" with lines reading `"{topic}" — {timeAgoLabel}`. An
  upcoming use reads `— coming up {date}`.
- **Check topic** (disabled while blank) gives a sentence: "No similar topic found in the ward's
  history." or `Similar topic "{t}" was used {label}.`
- **Suggest topics** toggles a box containing:
  - the context input, labelled "Add context to steer the suggestions (optional)", with a
    placeholder in the prototype's spirit (no real names)
  - **Get suggestions**, which POSTs to the route while showing "Thinking…"
  - suggestion chips (the title, with the why shown beneath or as its description); tapping one
    fills the input
  - **More suggestions**, which calls again and appends, skipping titles already shown
  - the footnote: "Suggestions are drafts. Nothing is saved until you press Save."
- Errors appear in a `FormError` inside the box.
- Save and the approvals confirm are unchanged from `t3`.

---

## Testing Strategy

Every new test is **proved able to fail** (break the code temporarily, watch it go red, restore)
before it is believed. That is the house rule.

**t1**
- `tests/routes/assignments.test.ts` (modify): POST and PATCH with `topicTitle`.
  - A 201-character topic → 400.
  - A blank topic → stored as null.
  - `topics.last_assigned_at` no longer moves.
- `tests/routes/topics-finalized.test.ts` (modify): a `topicTitle` change un-finalizes, and a
  pipeline transition does not.
- The finalize source-reading test (modify, then prove it can fail).
- `tests/db/…`: a backfill assertion. Seed a talk with `topic_id`, run the backfill SQL against it
  (or assert that post-migration rows with a `topic_id` have a matching `topic_title`). Use
  whatever pattern `tests/db/` already uses for migrations.
- `tests/routes/talk-references.test.ts`, `ai-message.test.ts`, `talk-asks.test.ts`,
  `myAppointments.test.ts`, `todos.test.ts` (modify): fixtures move to `topicTitle`. `ai-message`
  asserts that scriptures come from the talk's scripture references.
- `tests/lib/cancelledReaders.test.ts`: still green, and extended if it enumerates readers.

**t2**
- `tests/lib/topicHistory.test.ts` (create):
  - prefix similarity ("fai" ↔ "Faith")
  - words of 2 or fewer letters ignored
  - dedupe keeps the most recent use
  - newest-first order
  - `timeAgoLabel` boundaries (29 days, 30 days, 364 days, 365 days, a future date → "Coming up",
    null)
  - `filterAndSortTopicHistory` for every sort, plus search by topic and by speaker
- `tests/lib/recentTopicUsage.test.ts`: rename or rewrite for `listTopicHistory`'s mapper
  (external speaker fallback, upcoming flag, cancelled and topic-less rows excluded).
- `tests/lib/navigationRoutesExist.test.ts`: green, with no edits expected.
- Deleted route tests are removed along with their routes.

**t3**
- `tests/lib/talkRowStatus.test.ts` (create): each of the five speaker states, and both topic
  states.
- `tests/components/sacrament/TalkRow.test.tsx` (create):
  - lines are buttons only with `talks.plan`
  - Clear appears only when set
  - Delete is absent when there is one talk or without `calendar.manage`
  - Clear on an approved talk shows the invalidation sentence first
- `tests/components/sacrament/SpeakerCountStepper.test.tsx` (create):
  - − is disabled when the last slot has a speaker, and the hint appears
  - the 1..6 bounds hold
  - Save is disabled when unchanged
  - the default prompt appears only for `admin.manage_ward` and a changed count
- `tests/routes/assignment-remove.test.ts` (create; route-test pattern, CLAUDE.md §8). Seed a
  Sunday with 3 talks, the middle one with an asked member. Remove the middle one, then assert:
  1. it is cancelled with `slot_removed`
  2. talk 3 is now slot 2
  3. `speaking_slots` is 2
  4. `topics_finalized_at` is cleared
  5. a `cancelled` history row exists
  6. a "Let ___ know it's cancelled" to-do exists for the asker
  7. an audit row exists

  Refusals, each asserted by **re-reading the rows**:
  - removing the last remaining talk → 409, nothing changed
  - removing an already-cancelled talk → 409
  - `music_coordinator` (no `talks.plan`) → 403
  - a role with `talks.plan` but not `calendar.manage` → 403 (check the matrix for a real one)
  - a talk in another ward → 404

  Refusal data must pass every earlier check (the global rule): the second-ward talk is a real,
  uncancelled talk in a Sunday with 3 slots.
- `tests/lib/sundaySlotEntries…`: the existing test stays green.

**t4**
- `tests/lib/speakerOrder.test.ts` (create):
  - never spoken first
  - oldest first after that
  - a cancelled or declined entry does not count as spoken
  - ties alphabetical
  - null history → alphabetical
- `tests/components/sacrament/SpeakerWindow.test.tsx` (create):
  - the list order renders
  - "Use … as typed" appears only with search text and yields an external speaker
  - History is absent without history
  - History replaces the list and Back returns (no second dialog in the DOM)

**t5**
- `tests/routes/topic-suggestions.test.ts` (create): mock the Anthropic client the way
  `tests/routes/ai-message.test.ts` does.
  - Happy path returns suggestions.
  - A suggestion similar to a recent topic is filtered out.
  - **Row counts of `assignments`, `topics` and `topic_candidates` are unchanged** after a
    success and after a failure.
  - The request carries `thinking: {type:"adaptive"}` and no `budget_tokens`.
  - A role without `talks.plan` → 403.
  - An Anthropic error → the actionable message.
- `tests/lib/topicSuggestions.test.ts` (modify): `buildTalkTopicPrompt` names the recent and
  upcoming titles and the month.
- `tests/components/sacrament/TopicWindow.test.tsx` (create):
  - the live hint appears after 2 characters and dedupes
  - Check topic gives both sentences
  - tapping a chip fills the input and does not save

---

## Test Scenarios (Harness)

### Scenario 083: The Topics screen
**Tags:** sacrament, talks, full
**Purpose:** walks the rebuilt per-Sunday screen end to end. The states that matter (an asked
speaker, an accepted speaker, a declined one, approvals present, a middle talk to delete) take
many clicks to reach by hand.
**Seed data summary (dates relative to the run date, a whole generated-looking calendar per the
HANDOFF note):**
- Sundays: every Sunday for 3 months. Sunday A (≈3 weeks out) has 4 slots:
  - talk 1: a member speaker, **accepted**, with a topic
  - talk 2: a member speaker, **ask open**, with no topic
  - talk 3: **declined**, with a topic
  - talk 4: open
- Approvals: talk 1 has 2 of 3 bishopric approvals.
- Users: the harness bishop (counselor1) as conductor of Sunday A; a `music_coordinator`.
**Tester action:** sign in as counselor1 → Sacrament → Sunday A's Topics pill.
**Verification checklist:**
- [ ] "← Back to calendar", "Topics · {date}" and "What still needs to happen" are shown; Back
      returns to the hub on Sunday A's month
- [ ] The rows read: Accepted / Ask sent + Needs topic / Declined / Needs speaker + Needs topic
- [ ] Clearing talk 1's topic first warns that the two approvals will be reset
- [ ] Details on talk 1 opens a window with Slot length, Approvals, Contacting and Comments; the
      window fits its content on a 375px screen
- [ ] Delete on talk 2 names the speaker being told; after Remove, talk 3 becomes Talk 2, the
      stepper reads 3, the finalize panel reads "Not finalized yet", and the asker has a "Let ___
      know it's cancelled" to-do
- [ ] The stepper's − is disabled while the last talk has a speaker, and the hint says why
- [ ] Changing the count and saving offers "Make N the default…" (bishop)
- [ ] "View the full program for this date →" opens `/program/{id}`
- [ ] As `music_coordinator`: no windows, no Clear, no Delete, no stepper, but the page reads
      correctly
- [ ] Light and dark, and 375px wide

### Scenario 084: Topic history and the two windows
**Tags:** sacrament, topics, ai, full
**Purpose:** the hints and the ordering depend on history relative to **today**, which cannot be
typed in by hand. (That is the lesson of scenario 073.)
**Seed data summary:**
- Completed talks with topics:
  - "Faith in Jesus Christ" ≈2 months ago
  - "Faith and works" ≈8 months ago
  - "Gratitude" ≈14 months ago
- One upcoming talk: "Faith in Jesus Christ" ≈5 weeks ahead
- One cancelled talk whose topic must **not** appear
- Members: one who has never spoken; one who last spoke 3 years ago; one who spoke 2 months ago
  and declined twice (so the history window shows declines)
- One visiting speaker with a title
**Tester action:** sign in as counselor1; open Topic history from the dashboard tile; then open a
Sunday's topic and speaker windows.
**Verification checklist:**
- [ ] The dashboard shows a **Topic history** tile, and the hub's shortcut row also links it
- [ ] History lists every seeded topic except the cancelled one; "Coming up" marks the future use
- [ ] Search "grat" finds Gratitude; sorting by Speaker A–Z reorders; the sort is remembered after
      a reload
- [ ] Typing "fai" in the topic window shows both Faith topics, newest first, with "coming up" on
      the upcoming one and no duplicate row
- [ ] Check topic on "Service" reads "No similar topic found…"
- [ ] Suggest topics returns ideas; none resembles "Faith…" or "Gratitude"; tapping one fills the
      field and nothing is saved until Save
- [ ] The speaker window lists the never-spoken member first, then the 3-years member
- [ ] History on the decliner shows the talk plus "Declined asks — 2", with no second dialog
      stacked
- [ ] Typing an unknown name offers "Use … as typed"; saving shows them on the row with a title
      field available
- [ ] 375px wide, light and dark

`t1` and `t2` alone need no scenario of their own: `t1` is covered by route tests and scenario
083, and `t2` by scenario 084. Write 083 with `t3` and 084 with `t5`, then walk each in the
browser (Playwright MCP against `npm run dev`; hide the dev badge per HANDOFF).

---

## Validation Commands

Run per sub-slice, in order:

```bash
# Linting
npm run lint

# Type checking (app, then harness)
npm run typecheck
npm run harness:typecheck

# Tests — the sub-slice's files first, then the full suite in the background (~50 min on the
# shared hosted DB; rerun any timeout / "fetch failed" file alone before calling it a regression)
npx vitest run tests/lib/topicHistory.test.ts tests/routes/assignment-remove.test.ts   # etc.
npm test

# Production build — stop `npm run dev` first (and kill the orphaned child on port 3000)
npm run build
```

Migrations: `npm run db:push`, then `npm run db:types`, **before** running the tests for `t1`
and `t3`.

---

## Integration Notes

- **This reverses a recorded decision.** `sacrament-topics-finalize-and-history` `b1` kept
  `/talks/topics` alive for the AI candidate queue, and module-map §2.1 correction (b) treats the
  library as a WLT-only supporting surface. Both get a dated note saying the library is retired by
  the user's decision (2026-09-29), and why. Do not silently delete the old reasoning.
- **Data is kept:** `topics`, `topic_candidates` and `assignments.topic_id` stay, unread and
  unwritten. A later migration drops them, held back until after the deploy
  (`HELD_BACK_UNTIL_DEPLOYED`), because the running build would still select them.
- **User-visible losses, all deliberate:**
  - the library page and the AI candidate queue
  - the "Used recently" badge on library topics
  - the suggested-scripture one-tap picks in the References search window
- **Deploy order:** apply 086 (the backfill) before deploying `t1`. The migration is additive, so
  the old build keeps working against it.
- **The month planner (`/assignments`)** keeps working with a free-text topic, but nothing links to
  it. Retiring it is a separate question for the user, not for this plan.
- **Retros:** one per sub-slice via `/execute`. The HANDOFF's missing f1–f2c and Fast Sunday
  retros are still outstanding and are **not** part of this plan.
- **Commits:** the user commits each sub-slice with `/commit`. Never commit on their behalf.
