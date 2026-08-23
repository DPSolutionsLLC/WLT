---
id: talks-c-prayers-topics
type: feature
iter: null
commits: ["429f5f3"]
date: 2026-08-22
files:
  - supabase/migrations/028_topic_candidates.sql
  - lib/prayers/prayerPipeline.ts
  - lib/prayers/lastPrayed.ts
  - lib/prayers/queries.ts
  - lib/topics/topicRotation.ts
  - lib/topics/queries.ts
  - lib/validation/prayer.ts
  - lib/validation/topic.ts
  - app/api/prayers/route.ts
  - app/api/prayers/[id]/route.ts
  - app/api/topics/route.ts
  - app/api/topics/[id]/route.ts
  - app/api/topic-candidates/route.ts
  - app/api/assignments/[id]/route.ts
  - app/(app)/prayers/page.tsx
  - app/(app)/prayers/PrayerBoard.tsx
  - app/(app)/talks/topics/page.tsx
  - app/(app)/talks/topics/TopicList.tsx
  - app/(app)/talks/topics/TopicForm.tsx
  - app/(app)/talks/topics/CandidateQueue.tsx
  - components/prayers/LastPrayedLabel.tsx
  - components/roster/MemberPicker.tsx
  - app/(app)/assignments/ContactStagePanel.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
  - lib/assignments/queries.ts
  - lib/auth/navigation.ts
  - tests/routes/topic-candidates.test.ts
  - types/domain.ts
  - SPEC.md
related:
  - talks-a-pipeline-core
  - talks-b-month-planner
  - roster-b-picker-and-orgs
  - calendar-a-rules-and-api
  - foundation-c-services
---

## What was done

The two smaller halves of Phase 4: the prayer pipeline and the topic library. Prayers run their
own four-stage machine (`assign → ask → confirm → done`) with no approval gate, annotated with
"Last prayed March 2025" beside every name in the picker. The topic library is CRUD plus
staleness ordering, and the AI accept/reject queue is built and **shipped empty** so Phase 5 only
has to supply candidates.

Migration 028 adds `topic_candidates`, three indexes, and the unique index that makes "one
invocation and one benediction per Sunday" structural. 43 new tests across six suites, including
a full route suite over the candidate queue. 1161 tests pass. **Scenarios 016 and 017 were
written, seeded and walked end to end in a real browser** — every check passed, and the
walkthrough itself found two checklist items describing states the UI cannot reach, plus a
screenshot that under-demonstrated its own claim.

It also closes the two gaps `talks-b` handed forward: `listTopicOptions()` moved out of
`lib/assignments/queries.ts` into the topic module, and the confirmation message's scripture
sentence — silently dropped because the stopgap read only id and title — now has real data.

## Key decisions

- **`last_assigned_at` is stamped in the ROUTE, not in `transitionAssignment()`.** The plan put
  it in the data layer, but `transitionAssignment()` is deliberately a narrow write that stamps
  only its own columns, and having `lib/assignments/queries.ts` import `lib/topics/queries.ts`
  would tie two data modules together for one hint. The route is already where a legal transition's
  side effects happen — history rows, notifications, audit — and the stamp is one more of those.
- **The stamp fires at `approve` and survives a revert.** Not `plan`, because a plan that never
  gets approved should not burn the topic. Not `complete`, because the signal is needed while the
  bishopric is still choosing. And a backward move does not un-stamp it: the topic genuinely was
  chosen for a Sunday, and rolling it back would re-offer something they just discussed. All three
  are asserted against the hosted database, not reasoned about.
- **A "last prayed" label is `null`, and the word "Never" appears nowhere in the codebase.**
  Somebody who has not been asked is not a category of person, and "Never" beside a name reads as
  a judgement about them rather than as an absence of data. The absence IS the signal — the names
  with no label are exactly the ones to consider. `lastPrayedLabel(null)` returns `null` and the
  component returns `null` from it, so there is no styling decision that could reintroduce it.
- **Only prayers at `done` count, and the shaping function cannot see a stage at all.**
  `shapeLastPrayed` takes rows the caller has already filtered, so it is structurally incapable of
  counting a prayer that was merely asked. That is the same failure mode `COMPLETED_STAGE` guards
  on the talk side: a label for somebody who never prayed suppresses them for months with no
  symptom.
- **The prayer pipeline is a separate module from `lib/assignments/pipeline.ts`, deliberately.**
  The two machines share a shape but not a domain; merging them behind a generic would mean one
  set of gates answering two different questions — the mistake `FAST_SUNDAY_DISPLACING_TYPES` was
  living out on the calendar side.
- **There is no `prayers.*` permission.** Prayers ride on `talks.view` and `talks.plan`, because a
  prayer is part of planning the meeting. A separate permission would be one more thing to keep in
  step with talks for no behaviour anybody asked for.
- **`POST /api/topics` sets `source: "manual"` itself and will not read it from the request.** A
  caller that could name its own source could launder an AI suggestion into the library as if a
  person had typed it. `PATCH /api/topic-candidates` is the only path that writes
  `source: "ai_generated"`.
- **The candidate queue has no bulk path — no array in the schema, no checkbox column.** A bulk
  accept is an auto-add wearing a button. Adding one later would not be a convenience; it would be
  CLAUDE.md rule 3 being repealed.
- **A double-accept is refused with a 409, not silently ignored.** Without the state check, a
  double-tap creates the topic twice, and the second one has no candidate pointing at it.
- **A duplicate topic title is a 409 naming the clash, not a 500 saying "please try again".**
  Migration 018 has a UNIQUE index on `(ward_id, lower(title))` that nothing in this slice had
  been written against — the raw failure was a constraint name behind a fallback message for
  something retrying can never fix. All three write paths now translate it, and an accept that
  duplicates an existing topic leaves the candidate **pending** so the bishopric can reject it or
  rename the topic they already have.
- **Archive, never delete.** There is no DELETE handler on `/api/topics/[id]` at all, so a topic
  referenced by an assignment cannot vanish from its history even by mistake.
- **Staleness reads in words, never as a date.** "Used a while ago" is what a bishopric is
  actually asking; a timestamp makes them do the arithmetic themselves. The six-month boundary is
  inclusive and counts whole months — rounding a borderline topic toward "recent" costs one
  alternative, rounding the other way costs a congregation a repeat.

## Deviations from the plan

- **Migration is `028`, not `027`.** `plans/sunday-types-meeting-split.md` shipped first and took
  027 — the same collision the plan's own note recorded when it moved 026 → 027. Two migrations
  with the same number is a conflict the CLI resolves by filename order, silently.
- **Scenarios are `016` and `017`, not `014` and `015`.** Both of those were taken by
  `auth/scenario-014-ward-role-access-override` and `calendar/scenario-015-no-meeting-sundays`.
  Worth checking the manifest before numbering, not the plan.
- **The topic library lives at `/talks/topics`, not `/topics`.** SPEC.md §Component Structure
  specifies `/talks/topics` and `NAVIGATION_ITEMS` has always linked there. Building at the plan's
  path would have left the one Topics link in the sidebar pointing at a 404 — the exact thing
  `talks-b` had to fix for the Talks link.
- **`MemberPicker` gained an `annotations` prop, and the frozen interface table was updated to
  say so.** The plan says the interface is frozen and roster-b's rule is "RAISE IT rather than
  adding a prop quietly", so this is the raise. The prayer board's whole reason to exist is
  spreading prayers around, and that judgement is made WHILE choosing a name — a "last prayed"
  column elsewhere on the page is a different, worse product. It is a plain
  `Record<string, string>` of already-formatted text rather than anything prayer-shaped, so
  Phase 7's "last visited" and Phase 10's "last blessed" need no further change.
- **`LastPrayedLabel.tsx` is in `components/prayers/`, not `components/assignments/`.** CLAUDE.md
  §5 scopes components by module, and prayers are their own module.
- **A unique index on `(ward_id, sunday_id, prayer_type)` was added, and is not in the plan.** The
  plan's "a second write replaces the member rather than inserting" needs a constraint behind it or
  it is a race, not a rule. Without it a double-submit gives a Sunday two invocations.
- **`setPrayerMember()` was added and is not in the plan's signature list.** `upsertPrayer` is
  keyed by slot, which is what the board uses; `PATCH /api/prayers/[id]` holds an id and should not
  have to re-derive the Sunday and the type to change a name.
- **`listTopicOptions()` gained `suggestedScriptures`.** talks-b recorded the confirmation
  message's missing scripture sentence as a known gap and said talks-c supplies the data. It does,
  and `buildConfirmationMessage`'s signature is unchanged as promised — but `ContactStagePanel`
  needed a new prop to carry it, which touches a talks-b file.

## Pitfalls hit

- **A bash heredoc broke on a file containing `sundays!inner(date)`.** The `!` and the shell
  disagreed; the file went in through the Write tool instead. Worth knowing before losing time to
  it on any file with a PostgREST embedded-join select.
- **`Input` requires an `id` prop**, and a page with an add form and an inline edit form open at
  once needs them prefixed or two labels point at the same input. `TopicForm` takes an `idPrefix`.
- **A "6 months ago" boundary test asserted the wrong thing and the code was right.** 2026-02-21
  to 2026-08-22 is six whole months plus a day, which floors to six and stays `recent`; the bucket
  only flips once a seventh whole month has passed. The test name was corrected rather than the
  rule.
- **A screenshot claimed more than it showed, and only a human reading it caught that.** The
  fast-Sunday shot was captioned "two prayers" with only the invocation filled in, because the
  walkthrough had skipped the second half of scenario 016's step 8. The app was correct — both
  prayers assign fine on a Sunday with zero speaking slots, re-read from the database as two rows
  — but the evidence did not prove it. Worth remembering that a walkthrough can pass every check
  and still leave a claim unevidenced.
- **Two checklist items described states the UI cannot reach, and only a walkthrough found them.**
  Scenario 016 step 9 assumed an untouched prayer slot shows a disabled "Move to Asked" — it shows
  no stage control at all, because there is no row to move. Scenario 017 step 16 assumed a generic
  "send back a stage" button. Both were written from the plan and the code rather than from the
  running app, which is exactly the class of error a walkthrough catches and a test suite does not.
- **Migration 018's `topics_ward_title_key` was easy to miss.** It is a unique index on
  `lower(title)`, four migrations away from the table definition, and nothing in the plan
  mentioned it. It was found by reading `018_indexes.sql` for an unrelated reason. Worth grepping
  the index migration for any table a slice writes to, not just its `create table`.
- **`topics` is bishopric-only in BOTH the permission matrix and RLS**, so the plan's scenario
  checklist item "the secretary can view topics and cannot add" was not reachable — a ward
  secretary holds no topics permission at all. The scenario now asserts a "Not permitted" page,
  which is what actually happens and the more useful check.

## Known gaps

- **`prayer_assignments` keeps its WARD-SCOPED select policy from migration 019**, which is not
  the bishopric-only shape `assignments` and `topics` have. The plan asked for this to be
  confirmed rather than changed silently, and it has been left as it stands: **any authenticated
  member of the ward can read, insert, update and delete prayer rows at the database level.** The
  route's `talks.plan` check is the only write boundary. That is the same asymmetry `roster-a`
  recorded for `members` and `roster-b` for `member_organizations` — but it is worth a decision,
  not an inheritance. **Raise it before Phase 6 reads prayers onto a public program page.**
- **The picker shows the date but does not sort by it — ITER-008.** Raised while reviewing the
  walkthrough screenshots: "Last prayed March 2025" is on screen beside every name, but the order
  is still household-then-name, so finding who is overdue means reading every row. The information
  is there and doing no work. Backlogged rather than bolted on, because the same control belongs on
  speakers, visits and sacrament ordinances, and `MemberPicker`'s frozen interface deserves one
  designed change rather than two.
- **There is no generic backward-move control in the UI.** `canTransition` allows any backward
  move for the bishopric with a reason, and the route implements it, but the only button talks-b
  built is the decline path at `request`. So an approved plan cannot be sent back to review from
  the screen — only through the API. Found while walking scenario 017, which had assumed one
  existed. Not introduced here and not fixed here; worth a decision in `talks-d` or Phase 11.
- **`scenario-008` (roster-b's member picker) is still unwalked**, now handed forward six times —
  and this slice just added a prop to the component it covers.
- **The prayer and topic routes have no route tests; `/api/topic-candidates` does.** The queue got
  a full suite because it is the route CLAUDE.md rule 3 rests on and the one worth proving
  negatively — nothing reaches `topics` without an accept. `/api/prayers`, `/api/prayers/[id]`,
  `/api/topics` and `/api/topics/[id]` were not covered. The pure layer beneath them is
  exhaustive and `tests/helpers/routeClient.ts` makes backfilling cheap — a backlog item, not a
  blocker.
- **No notification fires for a prayer.** Nothing in the plan asked for one, and adding a trigger
  key means the two-part change `foundation-c` records (seed edit plus a migration insert for
  existing wards). If a prayer at `ask` should chase somebody, that is a decision to make
  deliberately.
- **`POST /api/topics/ai-suggest` does not exist.** SPEC.md now records it as Phase 5's, and
  records that it writes to `topic_candidates` and never to `topics`.
- **Phase 6 must read prayers and topics through their query modules**, not by querying the tables
  directly — the program builder needs prayer names and topic titles, and both are exposed for
  exactly that.
