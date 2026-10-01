# Plan: Finalize hands speakers and prayers to To Do

**Created:** 2026-09-30
**Type:** feature
**Scope refs:** ITER-036
**Structure:** one plan, two commits — `fa` (speakers) then `fb` (prayers)

## Overview

The user tested the live site, picked topics, references and speakers, and nothing reached To Do.
In the build, Finalize triggers nothing: speaker asks come only from a small **"Send asks (N)"**
button on the hub's Sunday card, which appears only after References is finalized or skipped, and
prayers have no asks at all.

The user's model (GROUP-02, `.iterate/scopes/ITER-035…038.md`): **finalizing means "I've prayed
about it and decided"**, separately per kind — topics, references, speakers, prayers. Finalizing
speakers or prayers is what puts one ask to-do per chosen person on the **conductor's** To Do.

### Decisions settled with the user (2026-09-30)

| # | Decision |
|---|---|
| D1 | **Four separate finalizes.** Topics and References keep theirs. Speakers and prayers gain one each, and that finalize **replaces "Send asks"**. |
| D2 | **Changing a chosen person after finalizing un-finalizes that kind.** Re-finalizing sends asks only to anybody new — nobody already asked is asked again. |
| D3 | **Un-finalizing or changing a person, when their ask is only on To Do** (not scheduled, not answered), **removes the ask**: deleted if the owner never touched it, otherwise closed with a line so nothing they wrote is lost. |
| D4 | **When their ask has an appointment booked, or they already accepted, the ask stays and the change WARNS before confirming** — naming the person and what is at stake ("You have an appointment with Maria Lopez on Sat, Sep 26, 7:00 PM to ask her." / "Tomas Reyes has already accepted — you'll need to let him know."). The same warning appears on any change that affects such a person: un-finalizing, changing the speaker, **or changing their topic**. Soft, never blocking (CLAUDE.md §12: conflict checks are soft). |
| D5 | **The References gate on asking is dropped.** Speakers finalize on their own; the ask card shows the topic's references **read live**, so references added later still show. |
| D6 | **Asks go to the Sunday's conductor** (unchanged, U1). Finalizing as someone else says so: "The asks go to Peter Nakamura's To Do." No conductor → refused with a sentence. |

### Success criteria
- Finalizing speakers on a Sunday creates exactly one open ask per chosen speaker not yet asked, on
  the conductor's To Do; a second finalize creates none. The "Send asks" button is gone.
- Changing a speaker after finalizing un-finalizes speakers; the old person's untouched ask is
  deleted (touched → closed); re-finalizing asks only the new person.
- A scheduled or accepted person is never silently dropped: every surface that changes them warns
  first, naming them.
- The same holds for prayers (`fb`): finalize prayers → one ask per chosen prayer-giver; Accepted on
  the ask moves the prayer to Confirmed, Declined frees it; handover, talk-off and cancellation
  (f2, f2b, f2c) cover prayer asks exactly as they cover talk asks.
- Lint, typecheck, the targeted suites, the full suite and the production build pass.
  `explicitTimeZone`, `navigationRoutesExist`, `cancelledReaders`, `conductorHandoverSites`,
  `user-author-fks`, `ward-isolation` and `migrations.test.ts` stay green.

## Relevant Files

**fa — speakers**
- `supabase/migrations/088_finalize_speakers_prayers.sql` — create — `sundays.speakers_finalized_at`
  and `sundays.prayers_finalized_at` (timestamptz, nullable — never a boolean, no `_by` column:
  migration 069 and `b2`'s precedent); new `todos.closed_reason` value and log kind `unfinalized`.
  **Both columns land in fa** so fb needs no migration of its own. ⚠️ This takes **088**, which the
  paused f3b plan had claimed — renumber f3b to **089** in
  `plans/sacrament-talk-asks-conductor-and-assistant.md` (Task 7).
- `types/database.ts` — regenerate (`npm run db:types`)
- `types/domain.ts` — modify — `Sunday.speakersFinalizedAt`, `Sunday.prayersFinalizedAt`;
  `TODO_CLOSED_REASONS` / `TODO_LOG_KINDS` gain `unfinalized`
- `lib/calendar/queries.ts` — modify — `SUNDAY_COLUMNS`, `mapSundayRow` (rule 9);
  `setSpeakersFinalized()` / `setPrayersFinalized()` beside `setTopicsFinalized()`
- `lib/sacrament/finalizePeople.ts` — create — server: `finalizeSpeakers()` (create the asks —
  today's Send asks body, moved), `unfinalizeSpeakersIfNeeded()` (the speaker-change trigger),
  `withdrawAsks()` (D3: delete untouched, close touched)
- `lib/sacrament/askImpact.ts` — create — **pure**: `describeAskImpact()` builds D4's warning
  sentences from `{ personName, scheduledFor, accepted, change }`; ward zone passed in (rule 12)
- `app/api/sundays/[id]/speakers-finalized/route.ts` — create — `PATCH { finalized: boolean }`,
  shaped like `topics-finalized/route.ts`; `talks.request`; GET returns the D4 impact list for an
  un-finalize confirm
- `app/api/sundays/[id]/asks/route.ts` — modify — POST removed (its body moved to
  `finalizeSpeakers()`); GET kept for the pill state
- `app/api/assignments/[id]/route.ts`, `app/api/assignments/route.ts` — modify — a speaker set,
  changed or cleared calls `unfinalizeSpeakersIfNeeded()` and, for the old person, `withdrawAsks()`
  in place of today's unconditional close (D2, D3)
- `lib/todos/askLinks.ts` — modify — `withdrawAsks()` primitives (delete-if-untouched, close as
  `unfinalized` / `speaker_changed` otherwise)
- `lib/todos/askSource.ts`, `lib/todos/queries.ts`, `lib/appointments/queries.ts`,
  `app/(app)/todos/AskDetails.tsx` — modify — the ask card shows the topic's **references live**
  (D5). The embed text stays one literal in both query files (calendar-a retro)
- `lib/sacrament/talkAsks.ts` — modify — `talksAskState()` gains the finalized stamp; the
  `references_open` lock reason goes (D5)
- `components/sacrament/TalkAsksCheck.tsx` — modify — the "Send asks (N)" button becomes a
  **finalize** control (FinalizeToggle's pill geometry), with D6's "goes to ___" sentence and D4's
  warning on un-finalize
- `components/sacrament/SpeakerWindow.tsx`, `components/sacrament/TopicWindow.tsx`,
  `components/sacrament/ApprovalSafeSave.tsx`, the month planner's `AssignmentModal` — modify — the
  warn-first step also fires on D4's ask impact, not only on approvals
- `app/(app)/assignments/[sunday_id]/page.tsx` — modify — a **Finalize speakers** panel beside
  `TopicsFinalizedPanel`; pass each talk's ask impact (scheduled time, accepted) to its row
- `app/(app)/sacrament/page.tsx`, `lib/sacrament/sundayStatus.ts`, `lib/sacrament/sundayAsks.ts` —
  modify — the Talks pill reads the stamp

**fb — prayers**
- `lib/prayers/prayerAsks.ts` — create — pure: `prayerNeedsAsk()`, `buildPrayerAskTitle()` ("Ask
  ___ to give the opening prayer"), notes
- `lib/prayers/prayerOutcome.ts` — create — server: the ONE function recording a prayer's answer
  (`requestOutcome.ts`'s shape): Accepted → `assign → ask → confirm` (two legal steps, `asked_by` =
  the ask's owner); Declined → member cleared, back to `assign`; resolves every open copy
- `lib/sacrament/finalizePeople.ts` — modify — `finalizePrayers()`, `unfinalizePrayersIfNeeded()`
- `lib/todos/askLinks.ts` — modify — prayer asks on `ask_prayer_id`; **`listToldPrayerIds` must
  count only `talk_off_at`-stamped rows** (today it counts any linked to-do, which would read every
  prayer ASK as "already told")
- `app/api/sundays/[id]/prayers-finalized/route.ts` — create
- `app/api/todos/[id]/answer/route.ts` — modify — answers a prayer ask through `prayerOutcome.ts`
- `app/api/prayers/[id]/route.ts` — modify — changing who prays un-finalizes prayers and withdraws
  (D2, D3); a manual stage move on the Prayers board resolves the open ask through
  `prayerOutcome.ts`, so the two paths cannot disagree
- `lib/sacrament/conductorHandover.ts` — modify — rules 1 and 2 cover prayer asks: handover moves
  them, talk-off marks them, cancellation tells through the existing prayer path
- `lib/todos/askSource.ts`, `lib/todos/queries.ts`, `lib/appointments/queries.ts`,
  `app/(app)/todos/AskDetails.tsx`, `app/(app)/todos/TodoCard.tsx`,
  `app/(app)/appointments/AppointmentList.tsx` — modify — a prayer ask card (which prayer, which
  Sunday, contact line), Accepted / Declined
- `components/sacrament/SundayCard.tsx`, `lib/sacrament/sundayStatus.ts`,
  `app/(app)/sacrament/page.tsx` — modify — the Prayer pill gains its finalize control

**Both — docs, tests, harness**: SPEC, FEATURES, `plans/P4-module-reskins.md`, module-map §2.1,
CLAUDE.md §9 (one entry), tests and scenarios below.

## Dependencies
- **No new libraries.**
- **Reuse, do not re-derive:**
  - `setTopicsFinalized()` / `topics-finalized/route.ts` / `FinalizeToggle` — the finalize shape
  - Today's Send asks body (`app/api/sundays/[id]/asks/route.ts` POST) → `finalizeSpeakers()`
  - `createAsksForSunday`, `closeAsksForAssignment`, `resolveAsksForAssignment`, `listOpenAsks`,
    `buildAsksForTalks`, `loadSundayAsks` (f1/f2)
  - `recordRequestOutcome()` / `speakerChanged()` (`lib/assignments/requestOutcome.ts`)
  - `isTodoUntouched()` (`lib/todos/untouched.ts`) — D3's "never touched"
  - `transitionPrayer()`, `setPrayerMember()`, `canTransitionPrayer()` (prayer pipeline)
  - `reconcileSundayAsks()` (f2/f2b/f2c) — the one place asks follow the calendar
  - `formatAppointmentInstant()`, `readWardTimezone()`, `wardDateOnly()`
  - `findUsersOutsideWard()` for any user id from a request body (CLAUDE.md §7)
- **Permissions:** finalize/un-finalize speakers and prayers and answer an ask: `talks.request`
  (bishopric). Changing a speaker/prayer stays `talks.plan`. No new permission.

## Known Pitfalls (from retro context)
- **sacrament-topics-finalize-and-history** — un-finalize is about **what** changed, never **who
  moved**. For speakers: a speaker set, changed or cleared un-finalizes; a pipeline transition, an
  accept or a decline does **NOT** (a decline clears the speaker through `recordRequestOutcome` —
  that path must not un-finalize, or every decline would silently reopen the Sunday). Guard every
  write path with a **source-reading test**, as `topicsFinalize` does.
- **sacrament-f1-send-asks-and-answers** — 078-D1: the control must stay busy until
  `router.refresh()` lands (run it in a transition). An open ask cannot be ticked or deleted by its
  owner (409) — D3's delete is the service role acting for the finalize, not the owner.
- **sacrament-f2-asks-follow-the-conductor** — the reconcile asks of the STATE; a finalized Sunday
  whose conductor changes still hands over. A failed half-run must repair on retry: every write
  idempotent (83b's partial index, 23505 = success; closes conditional on still open).
- **sacrament-f2c-cancelled-sunday-work** — every reader skips cancelled rows;
  `tests/lib/cancelledReaders.test.ts` reads the source. A cancelled talk or prayer is never
  offered for finalize.
- **sacrament-f3a-time-elsewhere** — another leader's time is a note, not an appointment; D4's
  warning reads the OWNER's own `scheduled_for`.
- **p5-b-agenda-link-two-keys / p5-a-todo-core** — another person's to-do is written only by the
  service role behind the route's guard, after reading the source through the caller's client; the
  audit detail carries ids, never a title or note, never a key containing "note".
- **youth-h (060-D2)** — no policy moves in this plan; if one must, USING and WITH CHECK agree.
- **Rule 12** — D4's sentence formats a `timestamptz` in the ward's zone.
- **Never `npm run build` while `npm run dev` runs**; check port 3000 first.

## Tasks

### Commit fa — speakers

#### Task 1: Migration 088
**File:** `supabase/migrations/088_finalize_speakers_prayers.sql` (create)
- `alter table sundays add column speakers_finalized_at timestamptz, add column prayers_finalized_at timestamptz;`
  with comments naming D1 and pointing at `lib/sacrament/finalizePeople.ts`.
- Extend `todos.closed_reason`'s CHECK and `todo_log_entries.kind`'s CHECK with `unfinalized`
  (copy migration 084's drop-and-recreate of both constraints, keeping every existing value).
- **Backfill:** a Sunday that already has an open or answered ask is stamped
  `speakers_finalized_at = now()`, so no live Sunday reads "not finalized" over asks already sent.
- `npm run db:push -- --dry-run` first (the auto-mode check refuses a blind apply), then
  `npm run db:push`, then `npm run db:types`.

#### Task 2: Types, mapper, setters
**Files:** `types/domain.ts`, `lib/calendar/queries.ts`, `lib/todos/logLines.ts`
- `Sunday.speakersFinalizedAt` / `prayersFinalizedAt` through `SUNDAY_COLUMNS` and `mapSundayRow`.
- `setSpeakersFinalized()` / `setPrayersFinalized()` copy `setTopicsFinalized()` (idempotent).
- `unfinalized` in `TODO_CLOSED_REASONS`, `TODO_LOG_KINDS`, and a sentence in `logLines.ts`
  ("The decision was reopened").

#### Task 3: Withdraw an ask (D3)
**File:** `lib/todos/askLinks.ts` (modify)
- `withdrawAsks({ wardId, assignmentId?, prayerId?, reason })`: for each OPEN ask on that talk or
  prayer, **skip** any with `scheduled_for` set (D4: it stays); otherwise delete it when untouched
  (`isTodoUntouched` — no steps, no log lines written by the owner, not scheduled, not complete) and
  close it with `reason` and a line when touched. Service role, `ward_id` on every write, returns
  `{ deletedIds, closedIds, keptIds }` for the audit row.
- An answered (accepted) talk has no open ask, so it is never withdrawn; D4 warns for it instead.

#### Task 4: Pure ask impact (D4)
**File:** `lib/sacrament/askImpact.ts` (create)
- `type AskImpact = { personName: string; scheduledFor: string | null; accepted: boolean }`.
- `describeAskImpact(impacts, change: "unfinalize" | "speaker" | "topic", wardZone): string | null`
  — null when nobody is scheduled or accepted. Sentences: "You have an appointment with Maria Lopez
  on Sat, Sep 26, 7:00 PM to ask her." / "Tomas Reyes has already accepted — you'll need to let him
  know." For `topic`: "…you'll want to tell her about her new topic." Pronoun-free if simpler
  ("…to let them know") — never guess a pronoun from a name.

#### Task 5: finalizePeople — speakers
**File:** `lib/sacrament/finalizePeople.ts` (create; SERVER-ONLY)
- `finalizeSpeakers({ wardId, sundayId, actingUserId, client })`: read via the caller's client
  (`loadSundayAsks`); refuse without a conductor (400 sentence, D6); stamp
  `speakers_finalized_at`; then create asks for every talk that `talkNeedsAsk` (the old POST body,
  without the references check — D5). Stamp first, asks second: a half-run is finished by pressing
  again (idempotent). Returns created ids and the conductor's name.
- `unfinalizeSpeakers({ … })`: clear the stamp, then `withdrawAsks(reason: "unfinalized")` for every
  talk on the Sunday.
- `unfinalizeSpeakersIfNeeded({ wardId, sundayId, before, after })`: only when the SPEAKER changed
  (`speakerChanged()`), never on a transition/accept/decline — header carries the topics-finalize
  table adapted for speakers.

#### Task 6: Routes
**Files:** `app/api/sundays/[id]/speakers-finalized/route.ts` (create), `.../asks/route.ts`,
`app/api/assignments/[id]/route.ts`, `app/api/assignments/route.ts` (modify)
- `PATCH { finalized }` under `talks.request`: finalize or un-finalize; audit
  `sunday_speakers_finalized` / `sunday_speakers_unfinalized` with ids (asks created / deleted /
  closed / kept). `GET` returns `{ conductorName, impacts: AskImpact[] }` for the confirm.
- Remove `POST /asks`; keep `GET`.
- Speaker change in PATCH `/assignments/[id]` and a speaker set by POST `/assignments` on a
  finalized Sunday: `withdrawAsks(reason: "speaker_changed")` for the old person (replacing today's
  unconditional close), reset the outcome as today, then `unfinalizeSpeakersIfNeeded`. A
  scheduled ask is kept and its owner sees "Speaker changed" on the timeline — add that line without
  closing it, so the appointment is not lost.

#### Task 7: Renumber f3b
**File:** `plans/sacrament-talk-asks-conductor-and-assistant.md` (modify) — every "088" in the
revised f3 section becomes **089**, with a note that ITER-036 took 088.

#### Task 8: Hub and Topics screen
**Files:** `components/sacrament/TalkAsksCheck.tsx`, `lib/sacrament/talkAsks.ts`,
`lib/sacrament/sundayAsks.ts`, `lib/sacrament/sundayStatus.ts`, `app/(app)/sacrament/page.tsx`,
`app/(app)/assignments/[sunday_id]/page.tsx` (modify)
- `talksAskState()`: `locked` loses `references_open`; a new `not_finalized` state ("N to ask")
  precedes `pending`. The tab becomes a finalize checkmark (FinalizeToggle pill geometry, attached
  to the Talks pill — the b-slice walk finding about unattached checkmarks).
- Pressing it: a small confirm naming where the asks go (D6). Un-pressing: the confirm fetches the
  route's GET and shows `describeAskImpact(…, "unfinalize")` when non-null.
- Topics screen: a **Finalize speakers** panel beside `TopicsFinalizedPanel`, same control.
- Busy until the refresh lands (078-D1).

#### Task 9: Warnings on change (D4)
**Files:** `components/sacrament/ApprovalSafeSave.tsx`, `SpeakerWindow.tsx`, `TopicWindow.tsx`, the
month planner's `AssignmentModal`, `app/(app)/assignments/[sunday_id]/page.tsx` (modify)
- The page passes each talk's `AskImpact` (from `listOpenAsks` + `requestOutcome`, read once).
- `ApprovalSafeSave` takes an optional `extraWarning: string | null`; the warn-first step fires
  when approvals exist **or** the warning is non-null, showing both sentences.
- SpeakerWindow uses `change: "speaker"`, TopicWindow `change: "topic"`.

#### Task 10: References live on the ask card (D5)
**Files:** `lib/todos/askSource.ts`, `lib/todos/queries.ts`, `lib/appointments/queries.ts`,
`app/(app)/todos/AskDetails.tsx` (modify)
- Embed the talk's references in the ask embed (both select literals, verbatim) and render them
  under the topic. The notes keep their snapshot; the card is the live view.

#### Task 11: Docs for fa
- SPEC (migration 088, the routes, D1–D6), FEATURES (Sacrament: finalize replaces Send asks),
  `plans/P4-module-reskins.md` (slice `f` amended by ITER-036), CLAUDE.md §9 one entry: *"Finalize
  is the trigger; a speaker change un-finalizes; an unscheduled ask is withdrawn, a scheduled or
  accepted one stays and warns."*

### Commit fb — prayers

#### Task 12: Pure prayer asks
**File:** `lib/prayers/prayerAsks.ts` (create) — `prayerNeedsAsk(prayer, hasOpenAsk)` (a member, not
cancelled, stage `assign`, no open ask); titles "Ask ___ to give the opening prayer" / "…closing
prayer" (`PRAYER_TYPE_LABELS`); notes (Sunday in words, contact line).

#### Task 13: One prayer outcome function
**File:** `lib/prayers/prayerOutcome.ts` (create)
- `recordPrayerOutcome({ wardId, prayerId, outcome, actorUserId, client })`: Accepted → transition
  `assign → ask` (stamping `asked_by` = the ask's owner) then `ask → confirm`, each through
  `canTransitionPrayer`; Declined → `setPrayerMember(null)` and back to `assign`. Then
  `resolveAsksForPrayer()` closes every open copy. The only writer of a prayer's answer.

#### Task 14: Prayer ask links
**File:** `lib/todos/askLinks.ts` (modify)
- `createPrayerAsks`, `resolveAsksForPrayer`, `listOpenPrayerAsks` on `ask_prayer_id` (the
  partial unique index `todos_one_open_prayer_item_per_owner` already exists, migration 085).
- **Fix `listToldPrayerIds` to count only `talk_off_at`-stamped rows** (pass `onlyStamped: true`),
  and make the f2c tell path stamp its prayer tell to-dos — otherwise an open prayer ASK reads as
  "already told" and a cancelled prayer's person is never told. A test proves it.

#### Task 15: finalizePrayers and routes
**Files:** `lib/sacrament/finalizePeople.ts`, `app/api/sundays/[id]/prayers-finalized/route.ts`
(create), `app/api/prayers/[id]/route.ts`, `app/api/todos/[id]/answer/route.ts` (modify)
- Same shape as speakers (Tasks 5–6). Changing who prays un-finalizes prayers and withdraws.
- The answer route accepts a prayer ask (Accepted / Declined; no decline reason — prayers keep no
  history row) via `recordPrayerOutcome`.
- A manual stage move on the Prayers board to `ask`/`confirm` resolves the open ask through the
  same function.

#### Task 16: Reconcile covers prayer asks
**File:** `lib/sacrament/conductorHandover.ts` (modify) — rule 2 hands prayer asks to the conductor;
rule 1 marks open prayer asks on a cancelled prayer (`talk_off_at`) instead of creating a separate
tell when an open ask exists (f2b's rule for talks). Extend `conductorHandoverSites.test.ts` if a
new conductor-write path appears (none expected).

#### Task 17: Cards, hub, docs
- Prayer ask card and appointment row (Accepted / Declined), the Prayer pill's finalize control.
- SPEC / FEATURES / CLAUDE.md §9 entry extended to prayers; module-map §2.1.

## Testing Strategy

**Pure**
- `tests/lib/askImpact.test.ts` — every change kind; scheduled only, accepted only, both, neither
  (null); the time in the ward's zone (01:00 UTC → previous evening in Denver); no pronoun guessed.
- `tests/lib/talkAsks.test.ts` — extend: `not_finalized` precedes `pending`; `references_open` gone.
- `tests/lib/prayerAsks.test.ts` — `prayerNeedsAsk` for each condition, each negative differing in
  exactly one field (global rule: negative-path data passes every earlier check).
- `tests/lib/speakersFinalizeSites.test.ts` — **source-reading**: every write path that can change
  a speaker (`app/api/assignments/route.ts`, `[id]/route.ts`, `remove_talk` caller) references
  `unfinalizeSpeakersIfNeeded`, and `recordRequestOutcome` does **not** (a decline must not
  un-finalize). Proved able to fail.

**Routes** (`// @vitest-environment node`, `tests/helpers/routeClient.ts`, re-read with the service client)
- `tests/routes/speakers-finalized.test.ts`:
  - finalize creates one ask per speaker on the **conductor's** list, with References undecided (D5)
  - a second finalize creates none; no conductor → 400 with the sentence
  - change a speaker → un-finalized; old untouched ask **deleted**; a touched one (with a step)
    **closed** with `speaker_changed`; re-finalize asks only the new person
  - un-finalize → untouched asks deleted, a **scheduled** ask **kept**; GET lists the scheduled
    and accepted people
  - a **decline does not un-finalize**
  - audit rows carry ids, no title or note
- `tests/routes/prayers-finalized.test.ts`: the same shape for prayers; Accepted moves the prayer to
  `confirm` with `asked_by` = owner; Declined frees it; a cancelled prayer with an open ask is
  marked, not double-told (`listToldPrayerIds` fix).
- `tests/routes/talk-asks.test.ts`, `conductor-handover.test.ts`, `talk-off.test.ts` — update for
  the removed POST (use the finalize route) and prayer asks in the reconcile.

**Guards to keep green:** `cancelledReaders`, `conductorHandoverSites`, `explicitTimeZone`,
`navigationRoutesExist`, `user-author-fks`, `ward-isolation`, `migrations.test.ts`,
`notification-triggers-seed`.

## Test Scenarios (Harness)

`testing/scenarios/talks/`, numbers continue from 084.

### Scenario 085: Finalize speakers and they reach To Do
**Tags:** sacrament, todos, full, P4
**Purpose:** The exact path the user expected and found broken. Seeding a month with a conductor,
topics and speakers but **no references decided** proves D5.
**Seed data summary:**
- Ward (America/Denver), bishop + 2 counselors, a conducting rotation; Sunday A conducted by the
  1st counselor with 3 talks (2 members, 1 visitor), References **not** decided
- Sunday B conducted by the 2nd counselor, 2 talks
**Tester action:** as the **bishop** (not the conductor), finalize speakers on A from the hub; as the
1st counselor open To Do; schedule one ask; as the bishop change that speaker, then un-finalize B.
**Verification checklist:**
- [ ] The finalize confirm says the asks go to the 1st counselor's To Do
- [ ] The 1st counselor has 3 asks, each showing topic and references (none yet, then one added
      later appears without re-sending)
- [ ] Changing the scheduled speaker **warns first**, naming the appointment time in Denver time
- [ ] After the change, speakers read **not finalized**; re-finalizing asks only the new person
- [ ] Un-finalizing B removes its unscheduled asks from the 2nd counselor's To Do
- [ ] No "Send asks" button anywhere
- [ ] Is "finalized = I've prayed and decided" clear from the control's wording? (judgement)

### Scenario 086: Finalize prayers
**Tags:** sacrament, prayers, todos, full, P4
**Purpose:** Prayer asks are new end to end.
**Seed data summary:** Sunday A with both prayers assigned (stage `assign`), conducted by the 1st
counselor.
**Tester action:** finalize prayers on the hub; as the conductor accept one and decline one; check
the Prayers board.
**Verification checklist:**
- [ ] Two asks: "Ask ___ to give the opening prayer" / "…closing prayer"
- [ ] Accepted → the Prayers board shows **Confirmed**; Declined → the prayer is open again
- [ ] Choosing a new person un-finalizes prayers; re-finalizing asks only them

## Validation Commands

```bash
# Migration and types (fa only)
npm run db:push -- --dry-run
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests: targeted first
npx vitest run tests/lib/askImpact.test.ts tests/lib/talkAsks.test.ts tests/lib/prayerAsks.test.ts tests/lib/speakersFinalizeSites.test.ts tests/lib/cancelledReaders.test.ts tests/lib/conductorHandoverSites.test.ts tests/routes/speakers-finalized.test.ts tests/routes/prayers-finalized.test.ts tests/routes/talk-asks.test.ts tests/routes/conductor-handover.test.ts tests/routes/talk-off.test.ts tests/routes/todos.test.ts tests/rls/todos.test.ts
# Then the full suite (~50–75 min; stop the dev server first — memory)
npm test

# Production build — check port 3000 is free first (Get-NetTCPConnection -LocalPort 3000)
npm run build

# Harness manifest after adding scenarios
npm run manifest
```

## Integration Notes
- **Breaking change:** `POST /api/sundays/[id]/asks` is removed; the hub was its only caller.
- **Backfill** (Task 1) keeps every Sunday that already has asks reading "finalized", so the
  deploy moves no live Sunday.
- **ITER-035 (candidates)** will feed finalize a longer list; the finalize act and D2–D4 do not
  change. **ITER-038 (music)** hangs off the existing topics finalize, independent of this.
- **f3b** sits on top of this plan and now uses migration **089**.
- **Not in scope, recorded:** a "Let ___ know" to-do when an ACCEPTED speaker is replaced (D4
  warns only, by the user's answer); speaker refinements the user has not raised yet.
