# Plan: A Sunday's work is cancelled when its talks are lost (P4 Sacrament slice f2c)

**Created:** 2026-09-26
**Type:** feature — and a **reversal** of a standing rule (see Decisions)
**Phase:** P4 module 1 (Sacrament), slice `f2c`, after `f2b`. Slice `f3` (the assistant) follows,
and its migration moves from 085 to **086**.
**Structure:** one slice, one commit, one migration (085).

## Overview

When a Sunday stops holding a sacrament meeting, or a talk loses its slot, the Sunday's planning
work is **released and recorded as cancelled**. Nothing is deleted: each piece stays as a record,
marked cancelled, and leaves its place, so the Sunday reads as empty. Whoever asked each person
gets a **"Let ___ know it's cancelled"** to-do and confirms with **Told them**. If the Sunday
becomes a meeting again, planning simply starts over — there is nothing to undo.

### Decisions settled with the user (2026-09-26)

| # | Decision |
|---|---|
| C1 | When a Sunday is marked as not holding sacrament meeting, **all of its work is released**: speakers come off, and the work is recorded as **cancelled**. "By this point the speakers should be removed anyway." |
| C2 | A talk's record is **kept, marked cancelled** — who was asked stays on it, and a member's speaker history shows "Cancelled · Talk". |
| C3 | **Any lost talk triggers it**: no meeting (stake conference and the like), a Sunday that becomes Fast Sunday, or a slot that is cut. |
| C4 | "All the work" is **talks, prayers, music, and the Sunday's topics and references decisions**. |
| C5 | The confirmation that people were told is a **per-person to-do with Told them**, owned by whoever asked them. |
| C6 | If the Sunday becomes a meeting again, **the work starts over**. Unfinished "let them know" to-dos **stay open** — the cancellation happened — and anybody wanted back is asked again from scratch. |
| C7 | A cancelled talk **never counts** as having spoken, and does **not** count as "asked recently". |

### THE REVERSAL — record it in CLAUDE.md §9

Three places say a lost talk is **"reverted to `plan`, NEVER deleted"**, keeping its speaker:
`plans/03-calendar.md:414-416` (Pitfall 5), `plans/04-talks-pipeline.md:80-103`, and the code at
`lib/calendar/queries.ts:1490-1497`, `supabase/migrations/023_calendar.sql:138-140` and
`027:88-90`. `SundayEditor.tsx:105` even says never to call it "removed" or "cancelled".

C1 replaces "reverted to plan, speaker kept" with "cancelled, released". What the old rule
protected **survives**: the reason it gives is that "the planning work behind one is somebody's",
and a cancelled record keeps all of it — speaker, topic, references, comments, stage stamps. Only
its **place on the Sunday** is given up. Every one of those comments is rewritten in this slice.

### Decisions made in this plan (flag if they read wrong)

- **A `cancelled_at` + `cancelled_reason` pair**, not a new pipeline stage or status value. A
  pipeline stage is where the talk *is*; cancellation is that it *stopped*, from whatever stage.
  Reason ∈ `no_meeting | fast_sunday | slot_removed`. Same pair on `prayer_assignments`,
  `hymn_selections` and `musical_numbers`.
- **Readers exclude cancelled rows at the query layer**, not in each screen. `listAssignments`
  is the one door nearly every talk reader uses (hub, program, month board, calendar dots, topic
  usage, references, music topics), so it filters by default and one opt-in reads cancelled rows
  (the reconcile and the speaker's record). The prayer, hymn and musical-number queries get the
  same default. A reader that bypasses those functions is found by a source-reading test, the way
  `conductorHandoverSites.test.ts` finds conductor writes.
- **A cancelled talk keeps its `slot_number`** as part of the record; it no longer holds the slot
  because every slot check reads through `listAssignments`.
- **Prayers' one-per-type unique index becomes partial** (`where cancelled_at is null`).
  `upsertPrayer` already updates-then-inserts rather than using `onConflict`; its lookup gains the
  same filter.
- **Speaker history:** a member's cancelled talk writes `outcome = 'cancelled'` with
  `cancellation_days_notice` **null**. The `late_canceller` flag (≤ 7 days) is for a speaker who
  backs out, not a ward that cancels a meeting, and null never trips it.
  `plans/04-talks-pipeline.md:457-461` hands "making `cancelled` real" to whoever builds a
  cancellation path — this is that path, and C7 means **`not_asked_recently` must skip
  `cancelled` rows** (`reliabilityFlags.ts:96`).
- **Who is told**, per C5:
  - a talk: its open asks are marked (f2b), and a speaker who accepted gets their last asker a
    "Let ___ know" to-do (f2b) — unchanged, reworded from "no talk" to "cancelled";
  - a prayer at `ask` or `confirm`: its `asked_by` gets the to-do, linked by a new
    **`todos.ask_prayer_id`** (slice g needs this column anyway — migration 083's header already
    names it). A prayer still at `assign` was never asked, so nobody is told;
  - a musical number: nothing records who arranged it (`performer` is free text), so **the person
    making the change** gets the to-do. Linked by `todos.musical_number_id` for the same
    idempotence the other two get from their index;
  - a hymn choice: nobody — there is no person to tell. It is cancelled and that is all.
- **Topics and references:** the Sunday's `topics_finalized_at`, `references_finalized_at` and
  `references_skipped_at` are cleared. The topic and references themselves stay on the cancelled
  talk as its record.
- **The warning blocks on prayers and music too.** Today prayers "never block"
  (`lib/calendar/queries.ts:1572-1575`) because nothing happened to them; now they are cancelled,
  which is work somebody did. The message says "will be cancelled", names who will be told, and
  counts prayers and music.
- **f2b's rule 2 ("back on") is removed.** With the work released there is nothing on the Sunday
  to come back; C6 keeps the tell to-dos open. `talk_back_on` stays admitted by the CHECKs
  (dropping a value is a riskier migration than leaving it unused) and is documented as retired.
- **The notification** keeps its trigger key `assignment_reverted` (so nobody's opt-out moves) and
  changes its wording to say the talks were cancelled. Renaming the key is a separate decision.

### Known limitation, stated rather than discovered

`apply_fast_sunday` (SQL, `023_calendar.sql:84-170`) also runs from **calendar generation**
(`generateSundayRange`, `ensureMonthGenerated`, `ensureHorizonGenerated`), which today reverts talks
on a Sunday that becomes Fast Sunday with no warning and no notification. This slice **stops that
function touching assignments at all** (migration 085 redefines it), and `updateSunday` does the
cancelling in TypeScript before it runs, as it already reverts first. A generation that moves Fast
Sunday onto a Sunday with talks therefore leaves them **uncancelled but off** (`talkIsOff()` hides
them: the Sunday has 0 slots) until the next save of that Sunday reconciles them. That is the same
narrow case as the pre-existing Fast Sunday defect walking scenario 079 found (a month whose earlier
Sundays do not exist), and it should be fixed with it, as its own item.

## Relevant Files

| File | Change |
|---|---|
| `supabase/migrations/085_cancelled_sunday_work.sql` (new) | `cancelled_at`/`cancelled_reason` on assignments, prayer_assignments, hymn_selections, musical_numbers; partial prayer unique index; `todos.ask_prayer_id`, `todos.musical_number_id` (+ partial uniques, like 083b); `apply_fast_sunday` redefined without the assignment revert |
| `types/database.ts`, `types/domain.ts` | regenerate; `CANCELLED_REASONS`, the new fields on `Assignment`, prayer, hymn and musical-number types (rule 9) |
| `lib/assignments/queries.ts` | column lists + mappers; `listAssignments` excludes cancelled by default, with `{ includeCancelled: true }`; `cancelAssignments()`; history write for a cancelled member talk |
| `lib/prayers/queries.ts`, `lib/music/queries.ts` | same default filter; `cancelPrayers()`, `cancelMusic()`; `upsertPrayer`'s lookup skips cancelled |
| `lib/calendar/queries.ts` | `revertAssignmentsToPlan` → `cancelSundayWork`: talks above the slot (or all), prayers and music when the meeting is lost, the three decision stamps; `countWorkAtRisk` counts prayers and music and they now block; warning and notification wording; comments rewritten |
| `lib/assignments/reliabilityFlags.ts` | `not_asked_recently` skips `cancelled` |
| `lib/sacrament/conductorHandover.ts` | rule 1 reads cancelled talks (opt-in) and adds prayer and musical-number tells; rule 2 removed |
| `lib/sacrament/askWarnings.ts` | sentences say "cancelled" and include prayers and the musical number |
| `lib/todos/askLinks.ts`, `lib/todos/askSource.ts`, `lib/todos/queries.ts` | tell to-dos for prayers and musical numbers; the card's source for them |
| `lib/sacrament/talkAsks.ts`, `lib/todos/logLines.ts` | tell titles "Let ___ know it's cancelled"; sentences |
| `app/api/todos/[id]/answer/route.ts` | Told them for prayer and musical-number tells |
| `app/(app)/todos/TodoCard.tsx`, `AskDetails.tsx`, `app/(app)/appointments/AppointmentList.tsx` | the cancelled marker and Told them for the new kinds |
| `app/(app)/calendar/sunday/[id]/SundayEditor.tsx` | its "never say cancelled" wording, reversed |
| `tests/lib/cancelledReaders.test.ts` (new) | source-reading: no Sunday-work query skips the cancelled filter unless named on an exemption list |
| `tests/routes/cancelled-sunday-work.test.ts` (new), updates to `talk-off`, `sunday-update`, `db/conducting-reshift`, `reliabilityFlags` tests | behaviour, each proved able to fail |
| new scenario 081 + manifest; FEATURES, SPEC, P4 plan, CLAUDE.md §9, `plans/03-calendar.md`, `plans/04-talks-pipeline.md` | record it and the reversal |

## Testing Strategy

- **Route:** a Sunday with an asked speaker, an accepted speaker, a visitor, an asked prayer, an
  assigned-only prayer, two hymns and a musical number becomes a stake conference. Assert: every
  row cancelled with its reason and nothing deleted; history `cancelled` for the members with null
  notice; the three stamps cleared; tell to-dos for the two speakers' askers, the prayer's
  `asked_by` and the person making the change (musical number), none for the unasked prayer or the
  hymns; a retry creates nothing twice. Back to a meeting: the Sunday reads empty, planning a new
  talk in slot 1 and a new invocation succeeds, the tell to-dos are still open.
- **Fast Sunday and slot cut:** only the lost slots' talks are cancelled; prayers and music stay.
- **Readers:** the hub, program draft and month board no longer show the cancelled rows
  (component or query tests), plus the source-reading test.
- **Flags:** `not_asked_recently` ignores `cancelled`; `late_canceller` does not fire on a null
  notice.
- **Walk:** scenario 081 in the browser, at 375px too.

## Pitfalls (from retro context)

- **p5-b / f1:** another person's to-do is written only through the service role behind the
  source's own guard; partial unique + 23505 as success for idempotence; order source → link →
  audit.
- **calendar-b/c:** generation writes several statements with no transaction; every write here is
  conditional (`cancelled_at is null`) so a retry repairs a half-done run.
- **sacrament-topics-finalize-and-history:** a stale "decided" signal must not survive an edit.
- **youth-h (060-D2):** no policy moves in this slice; if one must, USING and WITH CHECK agree.
- **Never `npm run build` while `npm run dev` runs;** stopping dev orphans the Next.js child.
