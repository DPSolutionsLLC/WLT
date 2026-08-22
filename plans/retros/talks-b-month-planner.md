---
id: talks-b-month-planner
type: feature
iter: ["ITER-004"]
commits: ["036698c"]
date: 2026-08-21
files:
  - app/(app)/assignments/page.tsx
  - app/(app)/assignments/MonthPlannerBoard.tsx
  - app/(app)/assignments/AssignmentModal.tsx
  - app/(app)/assignments/SpeakerField.tsx
  - app/(app)/assignments/ApprovalPanel.tsx
  - app/(app)/assignments/AssignmentEditButton.tsx
  - app/(app)/assignments/ContactStagePanel.tsx
  - app/(app)/assignments/CommentThread.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
  - components/assignments/StageBadge.tsx
  - components/assignments/SpeakerLine.tsx
  - components/assignments/SpeakerList.tsx
  - components/assignments/PipelineStatusSummary.tsx
  - components/assignments/SmsHandoff.tsx
  - components/calendar/MonthGrid.tsx
  - app/(app)/calendar/page.tsx
  - app/(app)/calendar/MonthNavigation.tsx
  - app/(app)/calendar/sunday/[id]/page.tsx
  - lib/assignments/smsLink.ts
  - lib/assignments/messageTemplate.ts
  - lib/assignments/queries.ts
  - lib/auth/navigation.ts
  - app/globals.css
  - SPEC.md
related:
  - talks-a-pipeline-core
  - calendar-b-month-view
  - roster-b-picker-and-orgs
  - auth-b-invites-admin
  - foundation-a-scaffold
---

## What was done

The screens `talks-a` had no way to reach: a month planner where a bishopric plans a whole Sunday
through a modal, a per-Sunday detail page carrying approvals, comments and the contact stages, the
`sms:` handoff with its copy fallback, and the two reserved regions `calendar-b` left on
`SundayCell` and `SundayCard` — filled once, lighting up both the month grid and the 375px list.

ITER-004 lands on screen. An external speaker's waived contact stages read as **"Not applicable —
invited outside the ward"** with the name and date of who decided it, and the component test
asserts the *absence* of outstanding-task vocabulary rather than only the presence of the right
words.

887 tests pass, 40 of them new. Scenarios 012 and 013 walked.

## Key decisions

- **The pipeline is nine stages, not nine screens — and the nav now says so.** `NAVIGATION_ITEMS`
  pointed Talks at `/talks/pipeline`, a kanban SPEC.md guesses at and nothing has ever built. It
  now points at `/assignments`, and SPEC.md records the kanban as deliberately dropped rather than
  pending. A sidebar link to an unbuilt route 404s, and this was the one link every planner uses.
- **Two invalidation warnings, because two surfaces know different things.** `countApprovalsFor()`
  returns counts and deliberately never the rows, so the month planner can only say "2 members have
  approved". The detail page has the rows, so it names Peter and Daniel. `AssignmentModal` takes an
  optional `approvedNames` and words itself from whichever it was given — one component, one
  behaviour, two vocabularies.
- **`review` → `approve` exists in exactly one place.** `ContactStagePanel` renders a generic
  "Move to <next stage>" control for every stage except `review`, where it renders nothing and
  `ApprovalPanel` owns the move. Two buttons for one transition, in two panels on the same page, is
  how somebody approves a plan without meaning to.
- **The waiver is prose, not a greyed-out sequence.** No progress bar, no disabled buttons, no
  "pending". A disabled control reads as "this is coming"; the entire point of ITER-004 is that it
  is not coming. `ContactStagePanel.test.tsx` sweeps the rendered text for `/pending/`, `/waiting/`,
  `/not started/`, `/awaiting/` and fails on any of them — a machine proxy for the human judgement
  scenario 013 exists to make.
- **The waiver still moves nothing.** It is offered, pressed, and then every stage after it is a
  separate explicit transition. The panel renders the same "Move to …" control before and after.

## Stage token contrast — measured, not eyeballed

`calendar-b` checked these by eye and recorded that it had. Measured this time against **both**
backgrounds a badge can sit on, taking the worse of the two. WCAG AA needs 4.5:1 at this text size.

**Light** (`--surface` #f8fafc, `--surface-raised` #ffffff):

| plan | review | approve | request | confirm | notify | speak | appreciate | complete |
|---|---|---|---|---|---|---|---|---|
| 7.24 | 4.94 | 6.01 | 5.45 | 6.04 | 6.01 | 4.95 | 6.55 | 4.79 |

**Dark** (`--surface` #141414, `--surface-raised` #1c1c1c):

| plan | review | approve | request | confirm | notify | speak | appreciate | complete |
|---|---|---|---|---|---|---|---|---|
| 6.65 | 6.70 | 5.71 | 6.26 | 6.93 | 6.33 | 7.53 | 10.21 | 9.78 |

All eighteen passed as they stood, so **two** were retuned and sixteen left alone: light `plan`
measured 4.55 and light `appreciate` 4.71 — passing, but with no headroom at all for small text.
`--stage-plan` #64748b → **#475569** (7.24), `--stage-appreciate` #a16207 → **#854d0e** (6.55).
The nine token NAMES are unchanged; they are the contract with Phase 3.

The badge renders the token as **text on the surrounding surface**, not as white text on a filled
pill — which is why these are the ratios that actually apply. A filled pill would need a second
measurement per stage against its own fill.

## Deviations from the plan

- **`listTopicOptions()` was added to `lib/assignments/queries.ts`, and is not in the plan.**
  `plan` → `review` refuses without a `topic_id`, but the topic library — `lib/topics/queries.ts`,
  `/api/topics`, categories, `last_assigned_at`, the candidate queue — is all `talks-c`. Without
  some topic read, nothing built here could move a single assignment off the first stage. This is
  the smallest read that unblocks it, deliberately placed in the existing module rather than in a
  new `lib/topics/queries.ts` that `talks-c` would then have to reconcile with. **`talks-c` should
  delete it and repoint its two callers.**
- **`AssignmentEditButton.tsx` is not in the plan's file list.** The detail page is a Server
  Component and cannot hand `AssignmentModal` its open state — the same boundary `BulkAssignBar`
  hit with `MemberList` (roster-b). It also exists because this page knows who approved and the
  month planner does not.
- **`MonthNavigation` gained a `basePath` prop.** It hard-coded `/calendar?month=`, so reusing it
  on the planner would have navigated away from the planner.
- **`MonthGrid` takes `regionsBySundayId`, one map, not per-cell props.** The page builds both
  regions for the whole month from one read; the grid threads them through. The plan's "do not
  fetch per cell" is structural this way rather than a rule to remember.
- **The modal has no "Submit for review".** Every stage move lives on the detail page, so there is
  exactly one place in the app where a stage advances. Planning a full Sunday — speakers, topics,
  slot lengths — still never leaves the month view, which is what the success criteria asked for.

## Pitfalls hit

- **`react-hooks/set-state-in-effect` rejects `setState` in an effect body.** `SmsHandoff` read
  `matchMedia` into state on mount, which is the ordinary way to avoid a hydration mismatch and is
  now a lint error. Replaced with `useSyncExternalStore` — a server snapshot of `false`, a live
  subscription to the media query, no second render pass. Only `npm run lint` catches this.
- **`react-hooks/refs` rejects assigning to a ref during render.** `CommentThread` kept its target
  in a ref updated during render; it now syncs in its own effect. Same family as the rule roster-b
  hit from the other direction with a module-level variable — the ref is still necessary, because
  `target` is an object literal rebuilt every render and depending on it directly would tear down
  and rebuild the realtime channel on every keystroke.
- **`window.matchMedia` does not exist in jsdom.** Guarded, which the real code wanted anyway:
  answering "no messaging app" is the safe fallback, since it renders Copy with its explanation
  rather than a link that does nothing when tapped.
- **`MemberPicker` must be `mode="inline"` inside `AssignmentModal`.** Its default modal mode is a
  native `<dialog>`, and `Modal` is deliberately not built to stack (components/ui/Modal.tsx says
  so). The frozen interface already had the prop; nothing needed raising.
- **A type-only import of `lib/assignments/queries.ts` in a client component is safe**, and is what
  `MemberPicker` already does with `lib/roster/queries`. `import type` is erased, so `npm run build`
  is happy — it is the *value* import that fails.

## Known gaps

- **Realtime needs a publication that no migration creates.** `assignment_comments` is not in
  `supabase_realtime`, so a second browser will not see a comment appear without a reload. Posting
  and reading are plain HTTP and work regardless; the channel logs a console error rather than
  failing silently. Adding the table to the publication is a one-line migration nobody has written.
- **The confirmation message omits its scripture sentence, honestly.** `buildConfirmationMessage()`
  takes `suggestedScriptures` and `ContactStagePanel` passes `[]`, because `topics.suggested_scriptures`
  is not read by `listTopicOptions()`. The sentence is dropped rather than emitted empty. `talks-c`
  supplies the data; the signature does not change.
- **Route handlers are still unit-untested — but the reason recorded five slices running looks
  wrong.** Every retro since roster-b says "no local server". A route test does not need one:
  `tests/helpers/asRole.ts` already returns a real authenticated Supabase client, so mocking
  `createServerSupabaseClient()` and `requireSessionUser()` and calling the exported `GET`/`PATCH`
  with a plain `Request` should be enough. **Approved as the next slice**, ahead of `talks-c`.
- **About two-thirds of the harness checklist is mechanically automatable.** Of the 70 checks in
  scenarios 012 and 013, roughly 16 are route behaviour, ~30 are rendered text and controls, ~8 need
  a real browser, and only ~15 are genuine human judgement. The mechanical ones sit at the bottom of
  the checklist and are the ones most likely to be skipped — scenario 012 and 013 were walked as
  "most of them", which is the predictable outcome of a 37-item list. Trimming the scenarios to the
  human-judgement checks is the follow-up to the route-test slice.
- **`scenario-008` (roster-b's member picker) is still unwalked**, now handed forward five times.
  `SpeakerField` is its first real consumer and the interface is frozen.
- **`showFlags` renders nothing.** `ReliabilityFlag` is a deliberate no-op until `talks-d`. It is
  passed from `SpeakerField` where the planning view wants it, with no guessed rule behind it.
- **The `goalAlerts` reserved region is still empty** — it belongs to `talks-d`. `speakers` and
  `pipelineStatus` are now filled on both `SundayCell` and `SundayCard`.
- **Phase 6 must render speakers through `SpeakerLine`**, not by re-deriving a name from
  `member_id`, or an external speaker's title goes missing on the printed program.
