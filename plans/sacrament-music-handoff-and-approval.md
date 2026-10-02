# Plan: Music coordinator handoff and conductor approval

**Created:** 2026-10-02
**Type:** feature
**Scope refs:** ITER-038
**Slices:** `ma` → `mb` → `mc`, one commit each, in that order (each builds on the one before)

## Overview

Today a Sunday's music is a set of live picks (`hymn_selections`, `musical_numbers`) that the music
coordinator edits with nobody told and nothing coming back. The only signal is a dimmed
**Topics pending** card on `/music` until the conductor finalizes topics.

This plan closes the loop, in the prototype's shape (`module-map.md` §2.2 behaviours 1–3, build
notes `music` and `music-completion-gate`) plus the user's ITER-038 additions:

1. **`ma` — Chorister and organist become real fields.** A per-Sunday `sunday_music` row holds a
   chorister and an organist, each a roster member OR a typed name. The programme's Organist and
   Chorister lines, hard-coded `null` today because "no table holds them", read from it.
2. **`mb` — Submit → review, with a completion gate.** The coordinator **submits** a Sunday's music
   once it is complete (3 hymns + chorister + organist + a filled musical number if one exists). The
   **conductor of that Sunday** gets a "Review the music" to-do and **approves**, or **sends it back
   with a note**, which reopens the coordinator's to-do with the note on it. Any edit after
   submit/approve returns it to draft with a visible banner and the review to-do closes.
3. **`mc` — Finalizing topics tells the coordinator.** Finalizing topics puts "Choose the music for
   Sunday, …" on every active music coordinator's To Do, writes a notification row, and emails
   anyone who switched email on. If topics change afterwards, submitted/approved music goes back to
   draft ("Topics changed") with picks kept, and re-finalizing tells them again ("Topics changed —
   check the music").

### Decisions settled with the user (2026-10-02)

| # | Question | Decision |
|---|---|---|
| D1 | How is the coordinator told? | **To Do always + notification row + email only if they opted in.** The notification bell is a placeholder until P12, so the row is written now to appear when the bell lands. The opt-in is a toggle on `/music`, because no Account page exists (P8). |
| D2 | Topics change after the coordinator started? | **Reopen and tell on re-finalize.** Submitted/approved → draft with a "Topics changed" banner, picks untouched; re-finalizing sends a "Topics changed" to-do (+ email if opted in). |
| D3 | Interaction with the programme's approval? | **Soft warning only.** Hymns stay live, exactly as today. The programme builder shows a non-blocking "Music not approved yet" line. Nothing is hidden and nothing is blocked. |
| D4 | Submit gate? | **3 hymns + chorister + organist + any musical number filled.** The user asked for chorister/organist "placeholders"; they are built as real but minimal fields (member or typed name). **No roster/calling-derived defaults** — the prototype's `defaultChoristerFor` is a later slice. |

### Assumptions made in planning (flag at execute time if the user disagrees)

- **A1 — Recipients are every active `music_coordinator` calling in the ward**, resolved through
  `ward_role_assignments` joined to `users.is_active` (the `emitNotification` rule). None → finalize
  still succeeds and its response says "No music coordinator holds a calling in this ward, so nobody
  was told." Several → each gets a to-do; one submitting completes them all.
- **A2 — Approve/return needs `topics.manage` (bishopric-only), not "is the conductor".** The
  to-do is routed to the conductor, but bishopric authority is shared (CLAUDE.md §7: "never build a
  check that grants the bishop something a counselor lacks"), so any bishopric member may decide.
- **A3 — Nobody approves their own submission** (the prototype's own bug fix, generalized from the
  coordinator role to the person). Refused with a 403 and a sentence naming the alternative.
- **A4 — Submit is refused while topics are not finalized** ("The conductor hasn't finalized this
  Sunday's topics yet."), and refused when nobody conducts the Sunday (`NO_CONDUCTOR`'s pattern —
  the review must go to somebody).
- **A5 — One email toggle governs both emails** (topics ready, music sent back). It writes
  `email_enabled` on two `notification_user_prefs` rows together. Rendered only for somebody whose
  active calling is `music_coordinator`, because they are the only recipients of those triggers —
  a display decision, not an authorization one.
- **A6 — The review is done on the `/music` card**, not on the to-do. The to-do carries an
  **Open music** link (`/music?sunday=<id>&from=todos#sunday-<id>`). One place to approve, so the
  card and the to-do cannot disagree.

### Success criteria

- A coordinator can enter a chorister and organist; the programme picks them up on assembly/refresh.
- The `/music` card shows `n/m picked` and a workflow pill (`Draft` / `Pending approval — <conductor>`
  / `Approved` / `Sent back`), both from ONE pure `musicCompletionFor()`.
- Submit produces exactly one open "Review the music" to-do on the conductor's list; approve closes it;
  send-back closes it and reopens the coordinator's to-do with the note on its timeline.
- Editing a hymn, the musical number, chorister or organist after submit/approve returns to draft with
  a banner, and the conductor's open review to-do closes as no longer needed.
- Finalizing topics puts one "Choose the music" to-do on each coordinator's list (idempotent — pressing
  again adds nothing), writes `music_topics_ready` notification rows, and emails opted-in coordinators
  when email is configured; the finalize response reports what happened.
- A topic change after submission reopens the music; re-finalizing sends "Topics changed".
- A Sunday that loses its meeting closes every open music to-do; a conductor change moves an open
  review to-do to the new conductor (the existing reconcile).

## Relevant Files

**Migration and types**
- `supabase/migrations/089_sunday_music_review.sql` — create — `sunday_music` table, todo link
  columns, closed reasons, log kinds, `notification_user_prefs.email_enabled`, three trigger rows.
- `supabase/seed/notification_triggers.sql` — modify — the three new trigger keys for new wards.
- `types/database.ts` — regenerate (`npm run db:types`) after 089 is applied.
- `types/domain.ts` — modify — `MUSIC_REVIEW_STATUSES`, `MUSIC_RETURNED_REASONS`, `MusicTodoRole`,
  new `TODO_LOG_KINDS` and `TODO_CLOSED_REASONS` values, `Todo.musicLink`.
- `tests/db/migrations.test.ts` — check — 089 is purely additive; NO `HELD_BACK_UNTIL_DEPLOYED` entry.

**`ma` — chorister and organist**
- `lib/music/sundayMusic.ts` — create — read/map `sunday_music`; `upsertSundayMusicPeople()` (service role).
- `lib/validation/music.ts` — create or extend whichever file holds the hymn/musical-number schemas —
  `sundayMusicPeopleSchema` (chorister/organist: `{ memberId } | { name } | null`).
- `app/api/sundays/[id]/music/route.ts` — create — `PATCH` chorister/organist under `music.manage`.
- `app/(app)/music/MusicPeopleForm.tsx` — create — two pickers (roster member or typed name).
- `app/(app)/music/SundayMusicCard.tsx` — modify — render `MusicPeopleForm`; take `sundayMusic` prop.
- `app/(app)/music/MusicSundayList.tsx`, `app/(app)/music/page.tsx` — modify — load and pass `sundayMusic`.
- `lib/program/gather.ts` — modify — `ProgramSources.sundayMusic`.
- `lib/program/assembleDraft.ts` — modify — organist/chorister from `sundayMusic` instead of `null`.

**`mb` — submit, review, reopen**
- `lib/music/musicCompletion.ts` — create — pure `musicCompletionFor()`.
- `lib/music/musicReview.ts` — create — `submitMusic()`, `approveMusic()`, `returnMusic()`,
  `reopenMusicIfNeeded()`; the ONLY writer of `sunday_music.status`.
- `lib/todos/musicLinks.ts` — create — create/reopen/close/hand over music-linked to-dos (service role).
- `app/api/sundays/[id]/music/submit/route.ts` — create — `POST`, `music.manage`.
- `app/api/sundays/[id]/music/review/route.ts` — create — `POST { decision: "approve" } | { decision: "return", note }`, `topics.manage`.
- `app/api/hymns/select/route.ts` — modify — call `reopenMusicIfNeeded()` after POST and DELETE.
- `app/api/musical-numbers/route.ts` — modify — call `reopenMusicIfNeeded()` after POST and DELETE.
- `app/api/sundays/[id]/music/route.ts` — modify (from `ma`) — call `reopenMusicIfNeeded()`.
- `app/(app)/music/SundayMusicCard.tsx` — modify — completion pill, workflow pill, banner, Submit, Approve / Send back.
- `app/(app)/music/MusicReviewControls.tsx` — create — Approve + Send back (note window).
- `app/(app)/music/SubmitMusicButton.tsx` — create — disabled with "n left" until complete.
- `lib/todos/queries.ts`, `lib/appointments/queries.ts` — modify — select `music_sunday_id, music_role`; map `musicLink`.
- `lib/todos/logLines.ts` — modify — sentences for the new log kinds.
- `app/(app)/todos/TodoCard.tsx` — modify — **Open music** link when `musicLink` is set.
- `app/api/todos/[id]/route.ts` — modify — DELETE refuses an OPEN music-linked to-do (409), mirroring the open-ask rule.
- `lib/sacrament/conductorHandover.ts` — modify — rule 1 closes music to-dos when the meeting is lost; rule 2 hands an open review to-do to the new conductor.
- `app/(app)/program/[sunday_id]/page.tsx` (+ `ProgramBuilder.tsx` or `MissingPanel.tsx`, whichever renders notices) — modify — soft "Music not approved yet" line (D3).

**`mc` — topics finalized → coordinator**
- `lib/music/topicsHandoff.ts` — create — `handTopicsToMusic()` and `reopenMusicForTopicChange()`.
- `lib/email/musicEmails.ts` — create — `sendMusicEmail()` over `getResendClient()`, gated on `emailConfiguration()`.
- `lib/notifications/musicEmailPreference.ts` — create — read/write `email_enabled` on the two trigger rows.
- `app/api/session/music-email/route.ts` — create — `PUT { enabled }`, the person's own preference (own client; RLS self policies from 019).
- `app/(app)/music/MusicEmailToggle.tsx` — create — "Email me when topics are ready or music is sent back".
- `app/(app)/music/page.tsx` — modify — render the toggle for a `music_coordinator` calling (A5).
- `app/api/sundays/[id]/topics-finalized/route.ts` — modify — after finalize call `handTopicsToMusic()`; after un-finalize call `reopenMusicForTopicChange()`; return a `music` summary; **rewrite the "NOTHING IS NOTIFIED" header** as a recorded reversal.
- `lib/topics/finalize.ts` — modify — `unfinalizeTopicsIfNeeded()` calls `reopenMusicForTopicChange()` when it actually cleared the topics stamp.
- The hub/Topics component that presses Finalize topics (find via `grep -rn "topics-finalized" components app --include=*.tsx`) — modify — show the returned `music` summary line.

**Tests (see Testing Strategy)**
- `tests/lib/musicCompletion.test.ts`, `tests/lib/musicReopenSites.test.ts`, `tests/lib/musicTopicSites.test.ts` — create.
- `tests/rls/sunday-music.test.ts` — create.
- `tests/routes/music-people.test.ts`, `tests/routes/music-review.test.ts`, `tests/routes/music-handoff.test.ts`, `tests/routes/music-email-preference.test.ts` — create.
- `tests/lib/conductorHandover.test.ts` / `tests/routes/*handover*` (whichever covers reconcile) — extend.
- `tests/routes/topics-finalized.test.ts` — extend.

**Harness**
- `testing/scenarios/talks/scenario-087-music-handoff-and-approval/` — create, then `npm run manifest`.

**Docs**
- `CLAUDE.md` §9 — new entry. `SPEC.md`, `FEATURES.md` — music workflow. `plans/prototype/module-map.md` §2.2 + §6.2 — correct "the workflow pill belongs with the programme" (it is the music submission's own status). `plans/P4-module-reskins.md` — Music row status.

## Dependencies

- **No new libraries.** `resend` is installed; `lib/email/resend.ts` already gates on configuration.
- Existing helpers to reuse: `writeAuditLog()`, `emitNotification()` (explicit `recipientUserIds`),
  `resolveRoleAccess` / `assertCan`, `respondToRouteError` / `readJsonBody`, `requireSessionUser`,
  `createServiceSupabaseClient`, `readConductorName`, `formatSundayLabelWithYear`, `readWardTimezone`,
  `wardDateOnly`, `findUsersOutsideWard()` (not needed — no user id comes from a body; see Pitfalls),
  `MemberPicker`, `resolveSiteUrl()` (`lib/program/queries.ts`) for the email link.
- **Environment:** none new. Email sends only when `RESEND_API_KEY` and a verified
  `RESEND_FROM_ADDRESS` exist; otherwise `emailConfiguration()` returns a reason that is reported,
  never swallowed.
- **Migration 089 is purely additive** and applies before the code deploys
  (`npm run db:push -- --dry-run`, then `npm run db:push`, then `npm run db:types`).

## Known Pitfalls (from retro context)

- **sacrament-finalize-hands-off-asks / sacrament-finalize-prayers** — a partial unique index of the
  "one open X per owner" kind turns a second insert into 23505. Treat 23505 as "already there" ONLY
  where that is true; when a reviewer changes (handover) close the old row before inserting the new.
  "Touched" means lines the OWNER wrote (`OWNER_LOG_KINDS`), not system lines.
- **sacrament-finalize-prayers** — when reads switch from "any linked to-do" to a specific link
  column, check every existing reader of that column (`listToldPrayerIds` read everything linked and
  went wrong). The new `music_sunday_id` must not be read by any `*Told*` helper.
- **sacrament-f2c-cancelled-sunday-work** — readers of `hymn_selections` / `musical_numbers` skip
  cancelled rows; `musicCompletionFor()` must be fed the live rows only. `tests/lib/cancelledReaders.test.ts`
  reads the source — a new reader must filter `cancelled_at is null` or be a named exemption. The
  people side belongs in the **reconcile**, which asks of the STATE so a retry finishes a half-run.
- **conductorHandoverSites** — every writer of `sundays.conducting_user_id` already calls the
  reconcile; put the music to-do handover INSIDE the reconcile so it inherits all of them.
- **sacrament-topics-finalize-and-history (`b2`)** — un-finalize is about WHAT changed, never WHO
  moved. Reopening music on a topic change must hook the SAME places that clear the stamp, not a
  new list; `tests/lib/topicsFinalize*` already reads those routes' source.
- **foundation-c-services** — an RLS-denied UPDATE/DELETE is a zero-row success. Re-read with the
  service client to assert a refused write in tests.
- **p5-a-todo-core** — `writeAuditLog()` blanks any detail key containing `note` or `token`. Name the
  return-note detail key `returnedWithMessage: true` (boolean) — never put the note text in audit
  detail; its durable home is the to-do log line.
- **unit-hierarchy-and-ward-switch** — migration 069: never add a composite `(user, ward_id) → users`
  FK. `submitted_by` is a plain `references users (id) on delete set null`.
- **explicitTimeZone** — every date in a to-do title, email or banner goes through
  `formatSundayLabelWithYear` (UTC for a `date` column) or names its zone.
- **HANDOFF gotchas** — 7.7 GB RAM: never run `npm run build` while `npm run dev` runs; stop the dev
  server before the full suite. Python edits on Windows: `newline=''` (repo is LF).

## Tasks

### Migration (do first, once, before `ma`)

#### Task 1: Migration 089
**File:** `supabase/migrations/089_sunday_music_review.sql` (create)
**Action:** One additive migration with a header in the house style (what it is, "APPLIES
IMMEDIATELY… PURELY ADDITIVE… NO HELD_BACK entry", and each WHY).
**Details:**
- **089a `sunday_music`** — one row per Sunday that has any music state:
  ```
  id uuid pk default gen_random_uuid()
  ward_id uuid not null references wards (id) on delete cascade
  sunday_id uuid not null
  chorister_member_id uuid null, chorister_name text null
  organist_member_id uuid null,  organist_name text null
  status text not null default 'draft' check (status in ('draft','submitted','approved'))
  submitted_at timestamptz null
  submitted_by uuid null references users (id) on delete set null
  approved_at timestamptz null
  returned_at timestamptz null
  returned_reason text null check (returned_reason in ('sent_back','music_changed','topics_changed'))
  return_note text null check (return_note is null or length(btrim(return_note)) between 1 and 1000)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  unique (ward_id, sunday_id)
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade
  ```
  - Member FKs: copy `prayer_assignments.member_id`'s FK shape and on-delete action exactly
    (composite `(…_member_id, ward_id) → members (id, ward_id)`).
  - CHECKs: a person is a member OR a name, never both
    (`not (chorister_member_id is not null and chorister_name is not null)`, same for organist);
    names `length(btrim(x)) between 1 and 120`; `status <> 'submitted' or submitted_at is not null`;
    `status <> 'approved' or approved_at is not null`;
    `(returned_at is null) = (returned_reason is null)`;
    `return_note is null or returned_reason = 'sent_back'`.
  - **RLS: SELECT only** — `ward_id = current_ward_id()`. **No insert/update/delete policy.** Every
    write goes through `lib/music/*` with the service role behind a route guard. This is the
    `access_requests` precedent (migration 073): the status machine and "nobody approves their own"
    (A3) are enforced by the ABSENCE of a write policy, not by a route check somebody could forget.
    Say so in the header.
- **089b todo link** — `alter table todos add column music_sunday_id uuid references sundays (id) on delete set null, add column music_role text check (music_role in ('choose','review'))`;
  **No pair CHECK between the two columns**, deliberately: `on delete set null` nulls only the id, so
  a deleted Sunday would violate one, and `on delete cascade` is refused because it would destroy a
  person's to-do. Document instead that every reader treats `music_sunday_id is null` as "unlinked",
  whatever `music_role` holds.
  Partial unique index `todos_one_open_music_todo_per_owner on todos (music_sunday_id, music_role, user_id) where completed_at is null and music_sunday_id is not null`.
  Index `todos_music_sunday_idx on todos (music_sunday_id) where music_sunday_id is not null`.
- **089c `todos_closed_reason_check`** — drop and re-add with the 088 list **plus**
  `'music_reopened'`, `'meeting_cancelled'`. Comment: "MUST STAY IN STEP WITH TODO_CLOSED_REASONS".
- **089d `todo_log_entries_kind_check`** — drop and re-add with the 088 list **plus**
  `'music_submitted'`, `'music_approved'`, `'music_sent_back'`, `'music_reopened'`,
  `'topics_changed'`, `'meeting_cancelled'`. Add CHECK `kind <> 'music_sent_back' or (body is not null and length(btrim(body)) > 0)` (the note IS the line, like `note`).
- **089e** — `alter table notification_user_prefs add column email_enabled boolean not null default false;`
  with a comment: per person, per trigger; false means in-app only. Self-writable already (019).
- **089f** — insert the three triggers for every existing ward, migration 074's exact shape:
  `('music_topics_ready', array['music_coordinator'])`, `('music_submitted', array['bishop','counselor'])`,
  `('music_sent_back', array['music_coordinator'])`, `on conflict (ward_id, trigger_key) do nothing`.

#### Task 2: Seed, types, domain
**Files:** `supabase/seed/notification_triggers.sql`, `types/database.ts`, `types/domain.ts` (modify)
**Details:**
- Seed: add the three rows in the music area of the list.
- `npm run db:push -- --dry-run`, `npm run db:push`, `npm run db:types`. Never hand-edit `database.ts`.
- `types/domain.ts`:
  - `export const MUSIC_REVIEW_STATUSES = ["draft", "submitted", "approved"] as const;`
  - `export const MUSIC_RETURNED_REASONS = ["sent_back", "music_changed", "topics_changed"] as const;`
  - `export const MUSIC_TODO_ROLES = ["choose", "review"] as const;` + types.
  - Extend `TODO_LOG_KINDS` and `TODO_CLOSED_REASONS` (same order as the SQL).
  - `Todo` gains `musicLink: { sundayId: string; role: MusicTodoRole } | null` (**required** field so
    every construction site is a compile error until it supplies it — rule 9).
  - `MusicPerson = { memberId: string; name: string } | { memberId: null; name: string }` and
    `SundayMusic = { sundayId; chorister: MusicPerson | null; organist: MusicPerson | null; status;
    submittedAt; submittedByUserId; approvedAt; returnedAt; returnedReason; returnNote }`.

### `ma` — Chorister and organist

#### Task 3: Read/write module
**File:** `lib/music/sundayMusic.ts` (create)
**Details:**
- `SUNDAY_MUSIC_COLUMNS` as ONE string literal on one line (calendar-a retro), embedding member
  names through the composite FK name, e.g.
  `chorister:members!sunday_music_chorister_member_id_ward_id_fkey (first_name, last_name)` — check the
  real constraint names after `db:types`.
- `getSundayMusic(wardId, sundayId, client)` → `SundayMusic` (a missing row maps to the empty draft —
  absent means default, the house idiom; do NOT insert on read).
- `listSundayMusic(wardId, sundayIds, client)` → `Map<sundayId, SundayMusic>` for `/music` and the hub.
- `upsertSundayMusicPeople({ wardId, sundayId, chorister, organist })` — service role; upsert on
  `(ward_id, sunday_id)`; touches ONLY the four people columns and `updated_at`. Accepts
  `undefined` = leave alone, `null` = clear.
- Ordinary errors: log with context and throw (rule 7), as `lib/music/queries.ts` does.

#### Task 4: Validation
**File:** `lib/validation/music.ts` (create; if a music schema file already exists under
`lib/validation/`, add to it instead)
**Details:** `musicPersonSchema = z.union([z.object({ memberId: z.uuid() }), z.object({ name: z.string().trim().min(1).max(120) })]).nullable()`;
`sundayMusicPeopleSchema = z.object({ chorister: musicPersonSchema.optional(), organist: musicPersonSchema.optional() }).refine(at least one key present, "Nothing to save.")`.

#### Task 5: Route
**File:** `app/api/sundays/[id]/music/route.ts` (create)
**Details:**
- `PATCH`. Order: `requireSessionUser` → server client → `resolveRoleAccess(supabase, user.wardId, user.orgType)` → `assertCan(user, "music.manage", roleAccess)` → parse id + body.
- Read the Sunday through the CALLER's client (`getSunday`) — 404 `NOT_IN_WARD` if null; refuse a
  Sunday with no meeting (`holdsSacramentMeeting`) with a 400 sentence.
- A `memberId` must be a member of THIS ward: read it through the caller's client (`getMember`);
  missing → 400 "That person isn't on your ward's roster." (members are ward-scoped by RLS, so this
  is the subject check — the CLAUDE.md "author is not a subject" rule).
- `upsertSundayMusicPeople(...)`; `writeAuditLog` action `sunday_music_people_updated`, module
  `music`, detail `{ sundayId, date, changedFields }` — never the names.
- Return `{ sundayMusic }`. `respondToRouteError` with route label and fallback.
- (`mb` adds the reopen call here.)

#### Task 6: UI
**Files:** `app/(app)/music/MusicPeopleForm.tsx` (create), `SundayMusicCard.tsx`, `MusicSundayList.tsx`, `page.tsx` (modify)
**Details:**
- `"use client"`. Two compact rows, "Chorister" and "Organist", each showing the current name with a
  small edit button opening a window (compact-UI preference): **Pick from roster** (`MemberPicker`)
  or **Type a name**, and ✕ to clear. Follow `MusicalNumberForm.tsx` for fetch/error/refresh idiom.
- Read-only rendering when the viewer lacks `music.manage` (mirror how the card hides
  `MusicalNumberForm`).
- `page.tsx`: `listSundayMusic` for the window's Sunday ids, pass `sundayMusic` per entry.

#### Task 7: Programme feed
**Files:** `lib/program/gather.ts`, `lib/program/assembleDraft.ts` (modify)
**Details:**
- `ProgramSources.sundayMusic: SundayMusic` loaded in `gather.ts` with the other sources.
- In `assembleDraft.ts` replace `organist: null, chorister: null` and its "No table…" comment with
  values built from `sundayMusic` using the SAME helper the conducting/presiding names use
  (`recordName` / `typedName` — pick whichever matches the draft field's type). A null person stays
  null and stays in `missing`. The refresh route diffs, so a typed-over draft is not overwritten.
- Extend the existing assemble-draft tests for both a member and a typed name.

### `mb` — Submit, review, reopen

#### Task 8: Completion gate (pure)
**File:** `lib/music/musicCompletion.ts` (create)
**Details:**
```ts
export type MusicCompletion = { filled: number; total: number; missing: string[]; complete: boolean };
export function musicCompletionFor(input: {
  selections: HymnSelection[];       // live rows only
  musicalNumber: MusicalNumber | null; // live row only
  sundayMusic: SundayMusic;
}): MusicCompletion
```
- Items: Opening hymn, Sacrament hymn, Closing hymn, Chorister, Organist; plus "Musical number"
  ONLY when a live musical number row exists, filled when it has a non-blank `pieceTitle` AND
  `performer`. `missing` lists the human labels in that order.
- Header: the prototype's rule — ONE definition used by the pill, the Submit button AND the server
  (`submitMusic` and `approveMusic` re-check it), so they cannot disagree.

#### Task 9: The workflow — one writer
**File:** `lib/music/musicReview.ts` (create)
**Details:** SERVER-ONLY. Every write uses the service role, after the caller's own client has read
the Sunday (so the ids are ones RLS admitted). Each function returns a discriminated outcome
`{ ok: false, status, error } | { ok: true, ... }` like `finalizeSpeakers()`.
- `submitMusic({ wardId, sundayId, actingUserId, client })`:
  1. Load Sunday (404), refuse no-meeting (400), refuse `topicsFinalizedAt === null` (400, A4), refuse
     `conductingUserId === null` (400, reuse `NO_CONDUCTOR`'s wording adapted: "…the music goes to them for review.").
  2. Load live selections, musical number, `sundayMusic`; `musicCompletionFor` incomplete → 400
     "Still to pick: Opening hymn, Organist." (from `missing`).
  3. Already `submitted` → idempotent success, no writes. `approved` → 409 "This music is already approved."
  4. Upsert `status='submitted', submitted_at=now(), submitted_by=actingUserId, returned_at/reason/note = null`.
  5. `musicLinks.completeOpenTodos({ sundayId, role: 'choose', logKind: 'music_submitted' })` (all coordinators).
  6. `musicLinks.createReviewTodo({ ownerUserId: conductor, ... })` — title
     `Review the music for ${formatSundayLabelWithYear(date)}`, `assigned_by = actingUserId`.
  7. `emitNotification({ triggerKey: 'music_submitted', recipientUserIds: [conductor], ... })`.
  Return `{ sundayMusic, conductorName, reviewTodoId }`.
- `approveMusic({ wardId, sundayId, actingUserId, client })`: status must be `submitted` (else 409
  with a sentence); `submitted_by === actingUserId` → 403 "You submitted this music, so another member
  of the bishopric approves it." (A3); re-check completion (a hymn cancelled since → 409); set
  `approved`, `approved_at`; complete open review to-dos with `music_approved`.
- `returnMusic({ ..., note })`: status must be `submitted`; same self-check (A3); set
  `status='draft', returned_at=now(), returned_reason='sent_back', return_note=note`; complete open
  review to-dos (`music_sent_back` line on the REVIEWER's to-do too? — no: their line is
  `completed`; put the note only on the coordinator's); `musicLinks.reopenOrCreateChooseTodo({ owner:
  submitted_by ?? every coordinator, logKind: 'music_sent_back', body: note })`; emit
  `music_sent_back` to the same people; `mc` adds the email here.
- `reopenMusicIfNeeded({ wardId, sundayId, reason: 'music_changed' | 'topics_changed' })`: reads
  status; `draft` → no-op (one read in the ordinary case, the `unfinalizeTopicsIfNeeded` promise);
  otherwise set `draft`, `returned_at=now()`, `returned_reason=reason`, `return_note=null`,
  `approved_at=null`; close open review to-dos with `closed_reason='music_reopened'` and log
  `music_reopened`. Returns `{ reopened: boolean }`.
- **Header must state:** this file is the ONLY writer of `sunday_music.status`; the table has no
  write policy (089a), so a client cannot skip it; `tests/lib/musicReopenSites.test.ts` holds every
  music write route to calling `reopenMusicIfNeeded()`.

#### Task 10: To-do links
**File:** `lib/todos/musicLinks.ts` (create)
**Details:** Model on `lib/todos/askLinks.ts` (service role, `MusicLinkWriteError` with
`completedIds` for a partial run, log lines via the same insert helper `askLinks` uses).
- `createChooseTodos({ wardId, sundayId, ownerUserIds, title, notes, assignedByUserId, logKind? })` —
  per owner: if an OPEN choose to-do exists → leave it (return it as `existing`); else if a
  COMPLETED one exists → reopen it (`completed_at=null`, log `reopened`… use the given `logKind`
  instead when supplied, e.g. `topics_changed` / `music_sent_back` with body); else insert. 23505 on
  the partial index = a concurrent insert → treat as existing.
- `createReviewTodo(...)` — insert; on 23505 the conductor already has one → existing.
- `completeOpenTodos({ sundayId, role, logKind, body? })` → sets `completed_at=now()` + log line.
- `closeOpenTodos({ sundayId, role?, closedReason, logKind })` → `completed_at=now()`,
  `closed_reason`, log line.
- `listOpenMusicTodos({ wardId, sundayIds })` → `{ id, userId, sundayId, role }[]` for the reconcile.
- `handOverReviewTodo({ todo, toUserId, ... })` — close old `handed_over` + log `handed_over`, then
  insert a clean copy for the new conductor (close FIRST — the partial index is per owner, but keep
  the order the asks use).

#### Task 11: Routes
**Files:** `app/api/sundays/[id]/music/submit/route.ts`, `app/api/sundays/[id]/music/review/route.ts` (create)
**Details:**
- submit: `POST`, `assertCan(user, "music.manage", …)`, no body. Call `submitMusic`. Audit
  `sunday_music_submitted` `{ sundayId, date }`. Return outcome JSON.
- review: `POST`, `assertCan(user, "topics.manage", …)`, body
  `z.discriminatedUnion("decision", [z.object({ decision: z.literal("approve") }), z.object({ decision: z.literal("return"), note: z.string().trim().min(1, "Say what to change.").max(1000) })])`
  in `lib/validation/music.ts`. Audit `sunday_music_approved` / `sunday_music_sent_back` (two actions,
  the topics-finalized precedent), detail `{ sundayId, date, returnedWithMessage: true }` for a return.
- Both: `respondToRouteError`, `params` is a Promise.

#### Task 12: Reopen on every music write
**Files:** `app/api/hymns/select/route.ts`, `app/api/musical-numbers/route.ts`, `app/api/sundays/[id]/music/route.ts` (modify)
**Details:** after a successful write (POST and DELETE), `await reopenMusicIfNeeded({ wardId, sundayId, reason: "music_changed" })`
and include `reopened` in the JSON so the card can show the banner without a reload. **Not** on AI
suggest (`/api/hymns/suggest` writes nothing — confirm by reading it; if it writes, add it). If a
reopen fails, the write already happened: log, and return the write's success with
`reopenFailed: true` and a sentence (no silent failure, no 500 over a saved hymn).

#### Task 13: Card UI
**Files:** `app/(app)/music/SundayMusicCard.tsx` (modify), `SubmitMusicButton.tsx`, `MusicReviewControls.tsx` (create)
**Details:**
- Collapsed card (module-map §6.2 item 2): TWO pills — completion `n/m picked` (ok tone when full)
  and workflow `Draft` / `Pending approval — <conductor name>` / `Approved` / `Sent back`. When
  topics are not finalized the existing single `Topics pending` replaces BOTH (unchanged rule).
- Open card: a banner when `returnedReason` is set — `sent_back`: "Sent back by the conductor: <note>";
  `topics_changed`: "The topics changed after this was submitted. Your picks are kept — check them and submit again.";
  `music_changed`: "Changed after it was submitted — submit again when it's ready."
- `SubmitMusicButton` (holders of `music.manage`): disabled with "n left: …" until complete; hidden when
  `submitted`/`approved`.
- `MusicReviewControls` (holders of `topics.manage`, status `submitted`): **Approve** and **Send back**
  (a small window with a required note, ✕ to cancel). If the viewer is the submitter, render the
  buttons disabled with the A3 sentence — the prototype's "disable with a message, don't just hide".
- Card props gain `sundayMusic`, `completion` (computed in `page.tsx` from `musicCompletionFor`),
  `conductorName`, `canSubmit`, `canReview`, `viewerUserId`.

#### Task 14: To-do surfaces
**Files:** `lib/todos/queries.ts`, `lib/appointments/queries.ts`, `lib/todos/logLines.ts`, `app/(app)/todos/TodoCard.tsx`, `app/api/todos/[id]/route.ts` (modify)
**Details:**
- Add `music_sunday_id, music_role` to both select strings (each stays ONE literal); map to
  `musicLink` (null when `music_sunday_id` is null).
- `logLines.ts`: `music_submitted` "Music submitted for review", `music_approved` "Music approved",
  `music_sent_back` "Sent back: <body>", `music_reopened` "The music changed — this review is no longer needed",
  `topics_changed` "The topics changed — check the music", `meeting_cancelled` "No sacrament meeting this Sunday any more".
- `TodoCard`: when `musicLink` → an **Open music** link to `/music?sunday=<id>&from=todos#sunday-<id>`.
  Verify `/music` accepts `from=todos` for its back link; if `ContextualBackLink` only knows
  `sacrament`, add `todos` there in the same small way.
- DELETE: an open to-do with `musicLink` → 409 "This comes from a Sunday's music and closes itself when the music moves on." (mirror the open-ask branch and constant naming).

#### Task 15: Reconcile
**File:** `lib/sacrament/conductorHandover.ts` (modify)
**Details:**
- Load `listOpenMusicTodos` with the other Sunday work in `readSundays`/`SundayWork`.
- Rule 1 (meeting lost — the same predicate the cancelled-music branch uses): `closeOpenTodos` for
  BOTH roles with `closed_reason='meeting_cancelled'`, log `meeting_cancelled`; reset the
  `sunday_music` status to `draft` with returned fields null (names kept). Idempotent by state.
- Rule 2 (live meeting): an open `review` to-do whose owner ≠ current conductor → `handOverReviewTodo`.
  No conductor → leave it (the asks' rule).
- Extend `ReconcileResult` with `musicClosedIds`, `musicHandedOverIds` and include them in
  `writtenTodoIds()`.

#### Task 16: Programme soft warning (D3)
**Files:** `app/(app)/program/[sunday_id]/page.tsx` + the component that renders notices (modify)
**Details:** read `getSundayMusic`; when `status !== 'approved'` render one quiet line "Music not
approved yet — the conductor approves it on Music." with a link to `/music?sunday=<id>`. Non-blocking:
no button disabled, no route changed.

### `mc` — Topics finalized → coordinator

#### Task 17: Email sender
**File:** `lib/email/musicEmails.ts` (create)
**Details:**
- `sendMusicEmail({ to: { userId, email }[], subject, text, html }) → { sent: string[]; failed: { userId, reason }[]; notConfigured: string | null }`.
- `emailConfiguration()` first; not configured → return `notConfigured: reason`, send nothing.
- One `client.emails.send` per recipient (follow `lib/program/distribution.ts`), each failure caught,
  logged with userId (never the address in logs — rule 8 spirit) and returned. Never throws.
- Bodies are plain: "The topics for Sunday, October 12, 2026 are ready: <topics>. Choose the music:
  <siteUrl>/music?sunday=<id>". `resolveSiteUrl()` null → omit the link line rather than send localhost.
- For `sent_back`: "The conductor sent back the music for <date>: "<note>"" + link. The note is a
  bishopric member's words to the coordinator — that is its purpose.

#### Task 18: Email preference
**Files:** `lib/notifications/musicEmailPreference.ts`, `app/api/session/music-email/route.ts`, `app/(app)/music/MusicEmailToggle.tsx` (create); `app/(app)/music/page.tsx` (modify)
**Details:**
- `MUSIC_EMAIL_TRIGGERS = ["music_topics_ready", "music_sent_back"] as const`.
- `readMusicEmailEnabled(userId, wardId, client)` — true only if BOTH rows exist with `email_enabled`.
- `writeMusicEmailEnabled(...)` — upsert both rows on `(user_id, trigger_key)` with the caller's OWN
  client, setting `email_enabled` and **never touching `is_enabled`** on update (insert default true).
- `readEmailRecipients(wardId, userIds, triggerKey)` (service role) — users with `email_enabled = true`
  AND `is_enabled` not false AND a non-blank `users.email`.
- Route `PUT { enabled: boolean }`: `requireSessionUser`; `assertCan(user, "music.view", …)`; write;
  audit `notification_email_preference_changed` `{ triggers, enabled }`.
- Toggle: rendered only when `user.role === "music_coordinator"` (A5). Shows the current state and,
  if `emailConfiguration()` is not configured, a muted sentence "Email isn't set up for this ward yet,
  so nothing will be sent until it is." (computed server-side and passed down; never import
  `lib/email/resend.ts` into a client component — it throws in the browser by design).

#### Task 19: The handoff
**File:** `lib/music/topicsHandoff.ts` (create)
**Details:**
- `handTopicsToMusic({ wardId, sundayId, actingUserId, client })`:
  1. Sunday through the caller's client; no meeting → `{ skipped: "no_meeting" }`.
  2. Coordinators: active `music_coordinator` callings joined to active users (service role; the
     `resolveRoleRecipients` query shape in `emitNotification.ts`). None → `{ noCoordinator: true }`.
  3. `topicsChanged = sundayMusic.returnedReason === 'topics_changed'` OR a completed choose to-do exists.
  4. `createChooseTodos` — title `Choose the music for <date>` or `Topics changed — check the music for <date>`;
     notes = the topic titles (`listSundayTopicTitles`, which returns titles only — the music
     coordinator must never be handed assignments); logKind `topics_changed` when `topicsChanged`.
  5. Only for owners whose to-do was CREATED or REOPENED (not `existing`): `emitNotification`
     (`music_topics_ready`, explicit recipients) and `sendMusicEmail` to those with the preference.
     This is the idempotence: pressing Finalize twice adds nothing and emails nobody twice.
  6. Return `{ coordinatorCount, toldUserIds, emailedCount, emailProblem: string | null, noCoordinator }`.
- `reopenMusicForTopicChange({ wardId, sundayId })` → `reopenMusicIfNeeded({ reason: "topics_changed" })`.
  It does NOT tell anybody — telling happens on re-finalize (D2).
- Header: record the reversal — the prototype refused to notify because it "would still require
  assuming a group with the music-coordinator role exists"; WLT resolves real callings and handles
  zero honestly, which is the condition the prototype could not meet.

#### Task 20: Wire finalize and un-finalize
**Files:** `app/api/sundays/[id]/topics-finalized/route.ts`, `lib/topics/finalize.ts` (modify)
**Details:**
- Route, `finalized: true`: after `setTopicsFinalized` + audit, `music = await handTopicsToMusic(...)`.
  A throw from the handoff must NOT un-do the finalize: catch, log, and return
  `{ sunday, music: { error: "Topics are finalized, but the music coordinator couldn't be told. Press Finalize again to retry." } }`.
- Route, `finalized: false`: `await reopenMusicForTopicChange(...)`.
- Replace the "NOTHING IS NOTIFIED" header block with "THE MUSIC COORDINATOR IS TOLD — ITER-038,
  REVERSING b2" and the reason (D1).
- `lib/topics/finalize.ts` `unfinalizeTopicsIfNeeded()`: when it actually cleared
  `topics_finalized_at` (before non-null), call `reopenMusicForTopicChange`. Keep its "one SELECT in
  the ordinary case" promise.
- Also check `cancelSundayWork()`'s topic-stamp clearing: if it clears `topics_finalized_at` while
  the meeting stays (slot cut), the reconcile does not reopen music — call
  `reopenMusicForTopicChange` from the reconcile's live-meeting branch when `topicsFinalizedAt` is
  null and status is not draft. (State-asked, so it is safe to run every time.)

#### Task 21: Show the result
**File:** the client component that PATCHes `/topics-finalized` (find with grep) (modify)
**Details:** after a successful finalize, one short line from `music`: "Told the music coordinator
(emailed 1)." / "No music coordinator holds a calling in this ward, so nobody was told." /
the email problem sentence / the handoff error sentence. Nothing on un-finalize.

#### Task 22: Docs
**Files:** `CLAUDE.md`, `SPEC.md`, `FEATURES.md`, `plans/prototype/module-map.md`, `plans/P4-module-reskins.md` (modify)
**Details:**
- CLAUDE.md §9: one entry "THE MUSIC IS SUBMITTED, REVIEWED BY THE CONDUCTOR, AND REOPENS ON ANY
  CHANGE — DECIDED 2026-10-02 (ITER-038, migration 089), REVERSING b2's 'nothing is notified'":
  `sunday_music` has no write policy; `lib/music/musicReview.ts` is the only status writer;
  D1–D4; A2/A3; email opt-in on `notification_user_prefs.email_enabled`; hymns stay live (D3).
- module-map §6.2: correct "THE WORKFLOW PILL … belongs with the programme" — it is the music
  submission's own status (prototype `MusicSundayEditor`), now built. §2.2: mark 1–3 built,
  4 (roster-derived defaults) still open.
- SPEC.md (schema + routes), FEATURES.md (Music module).

## Testing Strategy

Route tests follow CLAUDE.md §8 (`tests/helpers/routeClient.ts`, mock only the client factory,
`seedFixtures`, `fixtures.cleanup()`, re-read refused writes with the service client).
**Check fixture permissions first**: `music_coordinator` holds `music.manage` and `talks.view`, NOT
`topics.manage`; `bishop`/`counselor` hold all three.

- `tests/lib/musicCompletion.test.ts` — table-driven: empty → 0/5; 3 hymns only → 3/5 missing
  Chorister, Organist; with a musical number lacking performer → 5/6 not complete; all → complete;
  a typed-name person counts as filled.
- `tests/rls/sunday-music.test.ts` — ward A cannot read ward B's row; **every role** (including
  bishop and music_coordinator) is refused INSERT (raises) and UPDATE/DELETE (zero rows — re-read
  proves unchanged) through their own client. This is what makes A3 un-skippable.
- `tests/routes/music-people.test.ts` — coordinator sets a member and a typed name; a member from
  ward B → 400; org_president → 403; no-meeting Sunday → 400; audit row carries no names.
- `tests/routes/music-review.test.ts` — submit incomplete → 400 naming what's missing (test data
  must pass the topics-finalized and conductor checks first, so it fails on completion — the
  negative-path rule); submit before topics finalized → 400 (data otherwise complete); submit with no
  conductor → 400; submit → one review to-do on the conductor + choose to-dos completed; submit twice →
  still one review to-do; coordinator calls review → 403; submitter-bishop approves own → 403;
  other counselor approves → approved + review to-do completed; return without note → 400; return →
  draft/`sent_back`/note, coordinator's to-do reopened with a `music_sent_back` line carrying the note;
  a hymn change after approve → draft/`music_changed` and the review to-do closed `music_reopened`.
- `tests/lib/musicReopenSites.test.ts` — reads the source of `app/api/hymns/select/route.ts`,
  `app/api/musical-numbers/route.ts`, `app/api/sundays/[id]/music/route.ts` and fails unless each
  calls `reopenMusicIfNeeded(`. Also asserts no file outside `lib/music/` writes `sunday_music`
  (`grep` for `from("sunday_music")` followed by insert/update/upsert/delete). Prove it can fail
  by temporarily removing one call.
- `tests/lib/musicTopicSites.test.ts` — the topics-finalized route and `lib/topics/finalize.ts`
  call `reopenMusicForTopicChange(`.
- `tests/routes/music-handoff.test.ts` — finalize topics → one choose to-do per active coordinator,
  notes carry titles only (no speaker names); finalize twice → no second to-do, no second
  notification row; deactivated coordinator gets nothing; zero coordinators → `noCoordinator: true`
  and the finalize still 200; un-finalize after submit → draft/`topics_changed`, review to-do
  closed; re-finalize → the coordinator's to-do reopened with a `topics_changed` line and the
  "Topics changed —" title; email: mock `@/lib/email/resend` (`emailConfiguration` + `getResendClient`)
  to assert one send per opted-in coordinator and none for the not-opted-in one, and that
  `notConfigured` is reported, not thrown.
- `tests/routes/music-email-preference.test.ts` — PUT writes both trigger rows for the caller only,
  leaves `is_enabled` untouched on an existing opted-out row, refuses a role without `music.view`.
- Reconcile — extend the existing conductor-handover tests: conductor changes with an open review
  to-do → moved; meeting lost → both roles closed `meeting_cancelled` and status reset; a re-run does
  nothing new.
- `tests/routes/topics-finalized.test.ts` — extend: response carries `music`; a handoff failure
  still returns 200 with the stamp set.
- Programme: extend the assemble-draft unit test (organist/chorister from `sundayMusic`).
- **Guards to keep green:** `cancelledReaders`, `conductorHandoverSites`, `explicitTimeZone`,
  `navigationRoutesExist`, `user-author-fks` (089 adds a `users (id)` reference — confirm the test's
  rule admits a single-column FK, it should), `ward-isolation` (`sunday_music` HAS `ward_id`, so no
  exception list change), `migrations.test.ts`, `topicsFinalize*`, `speakersFinalizeSites`,
  `prayersFinalizeSites`.

## Test Scenarios (Harness)

### Scenario 087: Music handoff and conductor approval
**Tags:** talks, music, todos, full
**Purpose:** Walks the whole loop across three accounts — bishopric finalizes topics, the coordinator
is told and submits, the conductor reviews — which needs a month of Sundays, topics, a conductor,
a coordinator calling and hymn data in exact states that are slow to build by hand.
**Seed data summary:**
- `sundays` — 3 upcoming meeting Sundays, conductor = a counselor; A: topics set, NOT finalized;
  B: topics finalized, music complete except organist; C: topics finalized, music submitted and
  pending review (submitted by the coordinator).
- `ward_role_assignments` — one active `music_coordinator` (account with a seeded email, email
  preference ON), one bishop, one counselor (the conductor).
- `assignments` — topic titles on A, B, C. `hymn_selections` — 3 on B and C; `musical_numbers` — one
  filled on C. `sunday_music` — chorister set on B; both set and `submitted` on C.
- `todos` — C's open review to-do on the counselor.
**Tester action:** As the counselor, finalize A's topics. As the coordinator, open To Do, follow
**Open music** to A, pick hymns/chorister/organist, submit. On B, try to submit (blocked), add the
organist, submit. As the counselor, send C back with a note; approve A. As the coordinator, see C's
note, change one hymn, resubmit. As the bishop, change a topic on A after approval; re-finalize.
**Verification checklist:**
- [ ] Finalizing A shows "Told the music coordinator…" and the coordinator has "Choose the music for <A>" with A's topics in the notes
- [ ] Pressing Finalize again on A adds no second to-do
- [ ] B's Submit is disabled and names "Organist"; after adding one it submits
- [ ] Each submit puts exactly one "Review the music for …" on the counselor's To Do
- [ ] Pills read `n/m picked` and `Pending approval — <counselor>` / `Approved` / `Sent back`
- [ ] Send back without a note is refused; with a note, the coordinator's to-do reopens and shows the note, and C's card shows the banner
- [ ] The coordinator cannot see Approve/Send back; a bishop who submitted sees them disabled with the reason
- [ ] Changing a hymn on an approved Sunday returns it to Draft with the "Changed after it was submitted" banner and the review to-do closes
- [ ] Changing a topic on approved A returns it to Draft "The topics changed…"; re-finalizing gives the coordinator "Topics changed — check the music for <A>"
- [ ] The programme builder for A shows "Music not approved yet" while it is not approved, and the Organist/Chorister lines carry the names
- [ ] The email toggle shows only for the coordinator; with email unconfigured it says so
- [ ] Every date reads in the right day (no off-by-one) on to-dos, banners and pills

## Validation Commands

```bash
# Migration (once, before ma) — dry run first; it may time out connecting, retry
npm run db:push -- --dry-run
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Targeted tests while building (each slice)
npx vitest run tests/lib/musicCompletion.test.ts tests/lib/musicReopenSites.test.ts tests/lib/musicTopicSites.test.ts tests/rls/sunday-music.test.ts tests/routes/music-people.test.ts tests/routes/music-review.test.ts tests/routes/music-handoff.test.ts tests/routes/music-email-preference.test.ts tests/routes/topics-finalized.test.ts

# Full suite (stop the dev server first; ~50–75 min; rerun a timed-out file alone)
npm test

# Production build (never while `npm run dev` is running)
npm run build

# Harness manifest after the scenario is written
npm run manifest
```

## Integration Notes

- **Three commits:** `ma` (089 + people + programme feed), `mb` (workflow + to-dos + reconcile +
  programme warning), `mc` (handoff + email + preference). 089 lands with `ma` and covers all three,
  because it is purely additive and splitting it buys nothing (ITER-036's single 088 precedent).
- **Reversal recorded, not silent:** `topics-finalized/route.ts`'s "NOTHING IS NOTIFIED" header and
  module-map §6.2's "the workflow pill belongs with the programme" are both corrected in this work.
- **Nothing about the live hymn data changes** (D3): the programme, the hub's Music pill and AI
  suggestions read `hymn_selections` exactly as today.
- **No permission matrix change.** `music.manage` and `topics.manage` already exist with the right
  holders; `tests/lib/permissions.test.ts` should not move.
- **Known limits, written into the CLAUDE.md entry:** no roster-derived chorister/organist defaults
  (prototype behaviour 4, later); the in-app notification is unreadable until P12's bell; a review
  to-do follows the conductor only through the reconcile (conductor writes), so a Sunday whose
  conductor is unset keeps the review where it was.
- Close ITER-038 with `/commit` after `mc`; GROUP-02 then has ITER-035 and ITER-037 left, both
  waiting on P7 Prayer Items.
