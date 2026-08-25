# Plan: Program A — Draft Assembly, Routes and Approval

**Created:** 2026-08-24
**Type:** feature
**Scope refs:** ITER-004 (partial — the program half of the external-speaker case begins here)
**Structure:** Sequential — plan 1 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** Phase 4 (`talks-a`…`talks-d`) and Phase 3, both merged. Nothing in Phase 5.

---

## Overview

The server half of the program builder. One pure function turns a Sunday into a `draft_data`
snapshot; four routes create it, read it, refresh it behind a diff, and approve it.

Nothing here renders a PDF, nothing is public, and nothing is on screen. Those are `program-c`,
`program-d` and `program-b`. This plan exists so that all three have a **stable, validated,
already-approved draft** to work from, rather than each re-deriving one.

The single most important idea: **the draft is a snapshot, not a view.** Once written it stops
tracking upstream data. An approved program that silently changes after the bishop approved it is
a trust problem, not a bug — so refreshing is an explicit action that shows a diff first.

**Success criteria**

- A secretary posts a `sunday_id` and gets back a draft with every field the meeting order needs,
  sourced from the calendar, assignments, prayers and ward settings.
- A Sunday with no confirmed speaker still produces a draft — with placeholders and an explicit
  `missing` list, never a throw and never a refusal.
- Changing an assignment after the draft exists does **not** change the draft. Proven against the
  hosted database, not reasoned about.
- Refresh returns a field-by-field diff and writes nothing until a second call says apply.
- Only the bishopric can approve. A secretary can do every other step alone, and so can a
  bishopric member.
- An external speaker (ITER-004) reaches the draft with their typed title intact.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `lib/program/draft.ts` | The `ProgramDraft` type and its Zod schema — the shape every other plan validates against |
| `lib/program/assembleDraft.ts` | Pure assembler: sources → draft. No I/O |
| `lib/program/gather.ts` | The I/O half: reads the six sources through their own query modules |
| `lib/program/diff.ts` | Pure field-by-field draft comparison for the refresh action |
| `lib/program/queries.ts` | Data access for `programs` |
| `lib/validation/program.ts` | Zod schemas for the four request bodies |
| `app/api/programs/route.ts` | `POST` — create or update a draft |
| `app/api/programs/[sunday_id]/route.ts` | `GET` — fetch a Sunday's draft |
| `app/api/programs/[id]/approve/route.ts` | `POST` — bishopric only |
| `app/api/programs/[id]/refresh/route.ts` | `POST` — diff, then apply on confirm |
| `supabase/migrations/036_program_notifications.sql` | Three new trigger keys for existing wards |
| `supabase/migrations/037_program_write_scope.sql` | Narrows `programs` writes below ward-wide |

### Modify

| File | What changes |
|---|---|
| `types/domain.ts` | `PROGRAM_STATUSES`, `PROGRAM_STATUS_LABELS`, `MISSING_FIELD_KEYS` |
| `supabase/seed/notification_triggers.sql` | The same three keys, for wards created later |
| `SPEC.md` | §Programs gains `/refresh`; §Trigger Keys gains the program keys |
| `types/database.ts` | Regenerate after the migrations |

---

## Dependencies

No new libraries. Everything needed is already installed and already used elsewhere.

Existing services this plan must go through rather than around:

- `lib/calendar/queries.ts` — `getSunday()`, `bishopricDisplayName()`, `listBishopricUsers()`
- `lib/assignments/queries.ts` — `listAssignments()`
- `lib/assignments/speaker.ts` — `speakerFrom()`, `externalDisplayName()`
- `lib/prayers/queries.ts` — `listPrayers()`
- `lib/topics/queries.ts` — `listTopicOptions()`
- `lib/roster/queries.ts` — member names
- `lib/audit/writeAuditLog.ts`, `lib/notifications/emitNotification.ts`
- `lib/auth/permissions.ts` — `assertCan()` with a resolved `roleAccess`

---

## Known Pitfalls (from retro context)

- **`talks-a`, `talks-b`** — *"Phase 6 must read the speaker through `speakerFrom()`, not
  `member_id`, or an external speaker vanishes from the printed program."* `assembleDraft` calls
  `speakerFrom()` and `externalDisplayName()`. It must never branch on `member_id` itself.
- **`talks-c`** — *"Phase 6 must read prayers and topics through their query modules, not by
  querying the tables directly."* `gather.ts` is the only file that touches Supabase, and it calls
  `listPrayers()` / `listTopicOptions()`, never `.from("prayer_assignments")`.
- **`talks-c`** — `prayer_assignments` still carries a **ward-scoped** select policy: any
  authenticated ward member can read and write prayer rows at the database level. The retro asked
  that this be raised *"before Phase 6 reads prayers onto a public program page."* **This is that
  moment** — see Task 11 and the Open Decision below.
- **`foundation-c-services`** — a new notification trigger key is a **two-part change**: the seed
  file for future wards *and* a migration insert for wards that already exist. One without the
  other is a notification that silently never fires.
- **`calendar-b`** — a raw uuid on screen tells a bishop nothing they can act on. Every id in the
  draft resolves to a name at assembly time, because the snapshot is what gets printed.
- **`role-access-overrides`** — `can()` / `assertCan()` take a resolved `roleAccess` as a required
  third argument. Resolve once per request into a local and pass it down; `cache()` does not dedupe
  it in a route handler.
- **`ai-b`** — a fixture whose own design hides a bug is worse than no fixture. The draft tests
  need a Sunday with **two** speakers (one member, one external) and **one** empty slot, or the
  plural/singular and placeholder paths cannot fail.

---

## Decisions This Plan Makes

Three were handed here deliberately. They are decided, with reasoning, rather than deferred again.

### 1. A ward conference is an ordinary program with a heading — not a second template

Handed over from Phase 3 (ITER-003), [06-program-music.md](06-program-music.md) §Open questions.

The meeting order of a ward conference is the same shape as any other Sunday: hymns, prayers,
sacrament, speakers. What differs is **who presides** and that the congregation should be told
what meeting they are in. A second template would double the bifold imposition work and the
physical print test for what amounts to one line.

`ProgramDraft.heading` is `null` for a standard Sunday and `"Ward Conference"` for
`type = 'ward_conference'`. `program-d` renders it above the date on the cover panel; when it is
`null` it renders nothing at all — not an empty element, following `talks-c`'s rule that an
absence renders as an absence.

Revisit only if a ward reports that their ward conference genuinely runs a different order.

### 2. `presiding_override` gets no default — it becomes a named missing field

Also handed over from Phase 3. The temptation is to prefill the stake president, since that is who
usually presides at a ward conference.

**No.** Writing a name nobody typed into a snapshot that then gets printed and emailed is the same
failure CLAUDE.md rule 3 exists to prevent — and `users` records no gender, which is why
`bishopricDisplayName()` already refuses to guess an honorific and why ITER-004 made an external
speaker's title typed rather than derived. A guessed presiding name is that mistake with a
congregation reading the result.

But leaving it silently blank is the *other* failure ITER-004 records — an outstanding task that
does not look like one. So:

- `presiding` resolves to `sundays.presiding_override` when set, otherwise the bishop.
- When the Sunday is a `ward_conference` **and** `presiding_override` is null, `presiding` still
  resolves to the bishop, and `missing` gains `presiding_unconfirmed_ward_conference` carrying the
  sentence *"A ward conference usually has a visiting presiding officer. Confirm who is presiding."*

The bishopric is told what to check. Nothing is guessed on their behalf.

### 3. The draft carries both a printed name and a public name for every person

ITER-004's remaining half, and the reason `program-c` can be made safe by construction.

A **printed** program names people in full — a paper handout in a chapel is not the open internet.
The **public web page** shows a ward member as first name + last initial, because the roster is
private data the ward never consented to publish.

An external speaker is a different case in both places. Their name was typed by the bishopric
*specifically in order to be printed*, there is no member record to protect, and a visiting stake
president is named in full on every paper program there has ever been. So:

| | `printedName` | `publicName` |
|---|---|---|
| Member speaker | `"Sarah Whitfield"` | `"Sarah W."` |
| External speaker | `"President Mark Andersen"` | `"President Mark Andersen"` |

Both are computed **once, at assembly**, and both are stored in the snapshot. `program-c`'s public
projection reads `publicName` and has no code path that can reach `printedName` — the privacy rule
is enforced by which field the projector selects, not by a SQL `CASE` a later migration could get
wrong. This is the most load-bearing decision in the plan.

The same split applies to prayers, the organist, the chorister and a musical number's performer.
Leadership contacts and missionary information are **never** public; they are absent from the
public projection entirely rather than redacted within it.

---

## Open Decision — raise, do not silently pick

**`programs` and `prayer_assignments` are writable by any authenticated ward member.** Both sit in
migration 019's ward-scoped RLS loop, so the route's permission check is the only write boundary —
exactly the shape CLAUDE.md rule 2 says not to rely on.

Task 11 narrows `programs` using `current_user_role()`, which is straightforward.
`prayer_assignments` is **not** narrowed by this plan: `talks-c` asked for a decision rather than an
inheritance, and changing the policy on prayers touches the talk pipeline, not the program builder.
Raise it with the user when executing Task 11; if they want it, it belongs in its own change.

---

## Tasks

### Task 1: Program domain types

**File:** `types/domain.ts` (modify)
**Action:** Add the program enums beside the existing pipeline ones.

```ts
export const PROGRAM_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "distributed",
] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = { ... };
```

Match `programs.status`'s CHECK in migration 007 exactly. Follow the `PIPELINE_STAGES` /
`ROLE_LABELS` pattern — a status added here must fail to compile until somebody names it on screen.

Also export `MISSING_FIELD_KEYS`, the closed set of things a draft can report as absent
(`presiding_unconfirmed_ward_conference`, `opening_hymn`, `sacrament_hymn`, `closing_hymn`,
`invocation`, `benediction`, `speaker_slot`, `organist`, `chorister`, `announcements`). A closed set
means `program-b` renders a sentence per key instead of interpolating a raw field name.

---

### Task 2: The draft shape and its schema

**File:** `lib/program/draft.ts` (create)
**Action:** Define `ProgramDraft` and the Zod schema that validates it.

The schema is the contract three later plans depend on: `program-b`'s manual editor, `program-b`'s
AI editor, and `program-d`'s renderer all validate against **this one schema**. Write it once here.

```ts
export const programSpeakerSchema = z.object({
  slotNumber: z.number().int().positive(),
  kind: z.enum(["member", "external", "empty"]),
  printedName: z.string().nullable(),
  publicName: z.string().nullable(),
  topic: z.string().nullable(),
});

export const programDraftSchema = z.object({
  version: z.literal(1),
  heading: z.string().nullable(),
  date: dateOnlySchema,
  sundayType: z.enum(SUNDAY_TYPES),
  presiding: nameFieldSchema,          // { printedName, publicName }
  conducting: nameFieldSchema,
  organist: nameFieldSchema.nullable(),
  chorister: nameFieldSchema.nullable(),
  openingHymn: hymnRefSchema.nullable(),
  invocation: nameFieldSchema.nullable(),
  wardBusiness: z.string().nullable(),
  sacramentHymn: hymnRefSchema.nullable(),
  specialNotes: z.string().nullable(),
  musicalNumber: musicalNumberSchema.nullable(),
  speakers: z.array(programSpeakerSchema),
  closingHymn: hymnRefSchema.nullable(),
  benediction: nameFieldSchema.nullable(),
  announcements: z.string().nullable(),
  leadershipContacts: z.array(contactSchema),
  missionaries: z.string().nullable(),
  missing: z.array(z.enum(MISSING_FIELD_KEYS)),
});
```

**Details:**

- `version: z.literal(1)` is not decoration. `draft_data` is untyped jsonb that will outlive this
  plan; a stored draft with no version is a migration nobody can write safely later.
- `hymnRefSchema` is `{ number: number; title: string }`. **Both**, because the snapshot must
  survive the hymn table changing under it — and because the hymnbook is only partially seeded
  (`program-e`), a number whose title cannot be resolved is a state that *will* occur.
- Every name is a `{ printedName, publicName }` pair per Decision 3. Do **not** add a plain `string`
  name field as a convenience; one exists so the other cannot be reached by accident.
- Reuse the date schema already in `lib/validation/calendar.ts`; do not define a second date shape
  (`calendar-a` records a shape-only date schema as a real bug).

---

### Task 3: Reading the sources

**File:** `lib/program/gather.ts` (create)
**Action:** One exported async function that collects everything `assembleDraft` needs.

```ts
export type ProgramSources = {
  sunday: Sunday;
  assignments: Assignment[];
  prayers: Prayer[];
  memberNames: Record<string, string>;
  topicTitles: Record<string, string>;
  hymnSelections: HymnSelection[];
  musicalNumber: MusicalNumber | null;
  bishopName: string | null;
  conductingName: string | null;
  wardSettings: ProgramWardSettings;
};

export async function gatherProgramSources(
  wardId: string, sundayId: string, supabase: SupabaseClient<Database>,
): Promise<ProgramSources | null>
```

**Details:**

- Returns `null` when the Sunday is not in this ward — the route turns that into a 404. Do not throw.
- **Every read goes through an existing query module.** No `.from("prayer_assignments")` here
  (`talks-c`). The two exceptions are `hymn_selections` and `musical_numbers`, which have no query
  module yet — `program-e` builds `lib/music/queries.ts` and this file switches to it then. Until
  then read them here, narrowly, and leave a comment saying exactly that.
- `memberNames` maps id → `"Sarah Whitfield"` for every member referenced by an assignment or a
  prayer, resolved once. This is what stops the draft carrying uuids (`calendar-b`).
- `wardSettings` reads `wards.settings` and pulls `leadership_contacts`, `missionaries` and
  `program_template`. Parse it with a Zod schema and **default every field** — a ward whose settings
  are `{}` must still produce a program.
- Run the independent reads with `Promise.all`. They do not depend on each other.

---

### Task 4: The assembler

**File:** `lib/program/assembleDraft.ts` (create)
**Action:** `assembleDraft(sources: ProgramSources): ProgramDraft`. Pure — no Supabase import, no
`await`, no clock read.

**Details:**

- **Speakers.** For each slot `1..sunday.speakingSlots`, find the assignment and call
  `speakerFrom({ memberId, externalSpeakerName, externalSpeakerTitle })`. Then:
  - `kind: "member"` → `printedName = memberNames[memberId] ?? null`,
    `publicName = publicNameFor(printedName)`
  - `kind: "external"` → `printedName = publicName = externalDisplayName(speaker)`
  - `kind: "empty"` → both `null`, and push `speaker_slot` onto `missing`
- **Which assignments count.** Only stage `notify` or later, per the phase plan. A slot whose
  assignment exists but sits at `plan` is `empty` for program purposes and belongs in `missing` — a
  speaker who has not been notified is not yet a speaker. Compare by index into `PIPELINE_STAGES`;
  do not hardcode a list of four stage strings.
- **`publicNameFor(full)`** is a small exported helper: `"Sarah Whitfield"` → `"Sarah W."`. Handle a
  single-word name (returns it unchanged), a hyphenated surname, and `null` (returns `null`). Test
  it directly — it is the function the public page's privacy rests on.
- **Presiding** per Decision 2. **Heading** per Decision 1.
- **Missing is a list, never a throw.** A Thursday program with no confirmed speaker, no hymns and
  no announcements assembles successfully with six entries in `missing`. That is the normal case,
  not the error case.
- No field is ever the string `"TBD"` or `"Not yet assigned"`. Absent is `null`, and `missing` names
  it. `program-b` decides the words; a placeholder baked into the data would be printed by
  `program-d` as though somebody had typed it.

---

### Task 5: The diff

**File:** `lib/program/diff.ts` (create)
**Action:** `diffDrafts(current: ProgramDraft, next: ProgramDraft): DraftChange[]`.

```ts
export type DraftChange = {
  field: string;            // "speakers.2.printedName", "openingHymn"
  label: string;            // "Second speaker", "Opening hymn"
  before: string | null;    // already rendered for display
  after: string | null;
};
```

**Details:**

- Compare field by field against a declared table of `{ path, label, render }`, not by walking the
  object generically. A generic walk puts `speakers.1.publicName` on screen, which tells a secretary
  nothing (`calendar-b`'s uuid rule again).
- `before` / `after` are **rendered strings**, so `program-b` displays a diff without knowing the
  draft's internals.
- An unchanged field produces no entry. An empty array means "nothing upstream has moved", and
  `program-b` shows that as a sentence rather than an empty panel.
- `missing` is diffed too — a slot that filled in since Thursday is the single most useful line the
  refresh can show.

---

### Task 6: Program data access

**File:** `lib/program/queries.ts` (create)
**Action:** Ward-scoped access to `programs`, following `lib/prayers/queries.ts` for shape.

Exports: `mapProgramRow`, `getProgramBySunday`, `getProgram`, `upsertProgramDraft`,
`setProgramStatus`, `recordProgramApproval`.

**Details:**

- Every function takes `wardId` first and filters on it, even though RLS also does. Both, always
  (CLAUDE.md rule 1).
- `mapProgramRow` parses `draft_data` with `programDraftSchema` and **returns the parse result**,
  not a cast. A malformed stored draft is a real possibility once `program-b`'s AI editor exists;
  the mapper is where it is caught, not where it is assumed away.
- `setProgramStatus` takes the expected current status and returns `null` when the row is not in it.
  A status machine that only moves forward from where the caller *thought* it was is how the approve
  route avoids a double-approval race. Legal moves: `draft → pending_approval → approved →
  distributed`, plus `pending_approval → draft` (the secretary withdraws) and `approved → draft`
  (a post-approval edit, which `program-d` must make loudly visible because the emailed PDF will
  not change).
- No `deleteProgram`. Nothing in Phase 6 deletes a program, and adding it now would be one more path
  to distributed data disappearing.

---

### Task 7: Request validation

**File:** `lib/validation/program.ts` (create)
**Action:** Zod schemas for the four bodies.

- `createProgramSchema` — `{ sundayId: uuid }`
- `updateProgramSchema` — `{ programId: uuid, draft: programDraftSchema }` (the whole draft; a
  partial patch of a snapshot is ambiguous about what it means for the fields it omits)
- `approveProgramSchema` — `{ approved: boolean, comment: string | null }`
- `refreshProgramSchema` — `{ apply: boolean }`

Reuse `programDraftSchema` from Task 2 rather than restating the shape. One schema, three consumers.

---

### Task 8: `POST /api/programs`

**File:** `app/api/programs/route.ts` (create)
**Action:** Create a draft for a Sunday, or replace an existing one.

Follow `app/api/assignments/[id]/approve/route.ts` exactly for structure: `requireSessionUser()`,
`resolveRoleAccess()`, `assertCan()`, work, `writeAuditLog()`, `respondToRouteError()` in the catch.

**Details:**

- `assertCan(user, "program.build", roleAccess)`.
- With no draft in the body: gather, assemble, insert. With a draft in the body: validate and store
  it as given — this is the manual-edit save path `program-b` uses.
- **409 when the program is `approved` or `distributed`.** An edit after approval is legitimate but
  it is a decision, not a save: the caller moves the status back to `draft` first. Say that in the
  error sentence.
- A Sunday where `holdsSacramentMeeting(type)` is false gets a **422**, not a draft. There is no
  program for a meeting that is not held; the CHECK in migration 027 already makes a conductor on
  such a Sunday unrepresentable, and this is the same rule one layer up.
- Audit `program_draft_created` / `program_draft_updated` with `{ programId, sundayId, missingCount }`.

---

### Task 9: `GET /api/programs/[sunday_id]`

**File:** `app/api/programs/[sunday_id]/route.ts` (create)
**Action:** Return the stored draft, or 404.

- `assertCan(user, "program.view", roleAccess)`.
- `params` is a `Promise` in Next 16: `{ params }: { params: Promise<{ sunday_id: string }> }`.
- Returns `{ program, missing }` where `missing` comes from the **stored** draft, not a fresh
  assembly. Recomputing it here would make the snapshot a view again through the back door.

> **Note for the executor:** the phase plan lists this route's auth as *"Secretary + bishopric +
> music"*, but `music_coordinator` does **not** hold `program.view` in `lib/auth/permissions.ts` —
> it holds `music.view` and `music.manage`. Do **not** widen `program.view` to fix that. The music
> coordinator's screen is `program-e`'s `/music` page, which shows Sundays, topics and selections;
> whether they also need the assembled program is a separate product question. Flag it, leave the
> matrix alone, and record it in the retro.

---

### Task 10: `POST /api/programs/[id]/approve` and `/refresh`

**Files:** `app/api/programs/[id]/approve/route.ts`, `app/api/programs/[id]/refresh/route.ts` (create)

**Approve:**

- `assertCan(user, "program.approve", roleAccess)` — held only by `bishop` and `counselor`.
- Requires current status `pending_approval`; anything else is a 409 whose sentence says where it
  actually is and to reload.
- Unlike a talk assignment, a program needs **one** bishopric approval, not three. A program is a
  document one member of the bishopric signs off; the 3-of-3 gate exists because a *speaking
  assignment* is a shared decision about a person. Do not copy `countApprovalsFor` here.
- On approve: status → `approved`, stamp `approved_by` / `approved_at`, audit, emit
  `program_approved`.
- `approved: false` moves it back to `draft` and emits `program_changes_requested` carrying the
  comment — the same shape as the assignment change-request path.

**Refresh:**

- `assertCan(user, "program.build", roleAccess)`.
- Gather and assemble fresh, diff against stored, and with `apply: false` **return the diff and
  write nothing**. With `apply: true`, store the newly assembled draft and audit
  `program_draft_refreshed` with the changed field names.
- Refuse with 409 on an `approved` or `distributed` program, for the same reason as Task 8.
- This route is the entire reason the snapshot rule is safe to keep. It must not be skippable from
  the UI.

---

### Task 11: Notification triggers and the write scope

**Files:** `supabase/migrations/036_program_notifications.sql`,
`supabase/migrations/037_program_write_scope.sql`, `supabase/seed/notification_triggers.sql`,
`SPEC.md` (create / modify)

**Triggers** — three new keys, as a two-part change (`foundation-c`):

| Key | Default roles |
|---|---|
| `program_pending_approval` | `bishop`, `counselor` |
| `program_approved` | `bishop`, `counselor`, `ward_secretary` |
| `program_changes_requested` | `bishop`, `counselor`, `ward_secretary` |

`program_distributed` belongs to `program-d`, which is what emits it. Do not add a key nothing
fires — an unfired key is indistinguishable from a broken one.

Migration 036 inserts these for **existing** wards; the seed file covers wards created later. Both,
or the notification silently never fires. SPEC.md §Trigger Keys lists no program keys at all today —
add all four there (marking `program_distributed` as `program-d`'s) in this same change, per
CLAUDE.md §1.

**Write scope** — migration 037 narrows `programs` below the ward-wide loop policy from 019:

```sql
drop policy programs_ward_insert on programs;
drop policy programs_ward_update on programs;
drop policy programs_ward_delete on programs;

create policy programs_builder_insert on programs for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );
-- update and delete likewise
```

The select policy stays ward-wide: a program is a document the ward is about to be handed, and
nothing in it is private to the bishopric. **Write** is the boundary that was missing.

Comment the migration with *why* — a future reader needs to know this deviates from 019's loop on
purpose. Roles are named as literals here rather than resolved through `wards.settings.role_access`,
because RLS cannot read a ward's override; note that limitation in the comment, and note that
`assertCan()` in the route is what honours the override. The two together are strictly narrower than
either alone, which is the correct direction.

Also add `POST /api/programs/[id]/refresh` to SPEC.md §Programs, which the spec does not list.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/programDraftAssembly.test.ts` | Every field's source; a member speaker, an external speaker and an empty slot in the same fixture; `missing` populated rather than thrown; a `{}` ward settings object still assembles |
| `tests/lib/publicNameFor.test.ts` | `"Sarah Whitfield"` → `"Sarah W."`; one-word name; hyphenated surname; `null` → `null` |
| `tests/lib/programDraftDiff.test.ts` | Changed / unchanged / newly-filled-slot; empty array when nothing moved; labels are human words, never dotted paths |
| `tests/db/program-snapshot.test.ts` | **The snapshot rule.** Create a draft, change the assignment's speaker in the database, re-read the draft — unchanged. Then refresh with `apply: false` and see the change in the diff but not in the row |
| `tests/routes/program-approval.test.ts` | `ward_secretary` gets 403 on approve and 200 on build, refresh and view; `bishop` gets 200 on all four; approving from `draft` is a 409; an approved program refuses an edit |
| `tests/rls/program-access.test.ts` | Ward A cannot read or write ward B's program; a `music_coordinator` **cannot insert** a program row post-037; a refused UPDATE is proven by re-reading the row with the service client |

**Route tests need no server** — call the handler as a function and mock only
`@/lib/supabase/server` via `tests/helpers/routeClient.ts`. Read that file's header comment before
writing the first one; the `vi.mock` hoisting trap is the likeliest hour to lose. `params` is a
Promise: `POST(request, { params: Promise.resolve({ id }) })`.

Assert a refused write by **re-reading the row** with the service client. An RLS-denied UPDATE is a
zero-row success, not an error — only INSERT raises.

---

## Test Scenarios (Harness)

### Scenario 028: A program draft with a gap in it

**Tags:** `program`, `smoke`, `iter-004`
**Purpose:** The Thursday case — the state that is hard to build by hand and the one that decides
whether the builder is usable. A seeded Sunday with one confirmed member speaker, one external
speaker mid-pipeline, one empty slot, two of three hymns and no announcements.

**Seed data summary:**
- `sundays` — 1 — a `standard` Sunday two weeks out, 3 speaking slots
- `assignments` — 2 — slot 1 a member at `notify`; slot 2 an external speaker
  (`external_speaker_title = 'President'`) at `notify` with the contact waiver set; slot 3 absent
- `prayer_assignments` — 1 — invocation at `done`; benediction absent
- `hymn_selections` — 2 — opening and closing; **sacrament hymn absent**
- `wards.settings` — `leadership_contacts` populated, `missionaries` empty

**Tester action:** Sign in as the ward secretary, build the draft for that Sunday, read what the app
says is missing.

**Verification checklist:**
- [ ] The draft builds — no error, no refusal
- [ ] Slot 2 reads **"President Mark Andersen"**, title intact (ITER-004)
- [ ] Slot 3 reads as an open slot, not as a blank line
- [ ] The sacrament hymn, the benediction and the announcements are each named as missing
- [ ] Nothing anywhere reads "TBD" or "Not yet assigned"

### Scenario 029: The snapshot holds

**Tags:** `program`, `full`
**Purpose:** Proves the plan's central rule in the app rather than in a test. Seeding is what makes
it cheap — the second half needs an upstream change against an already-stored draft.

**Seed data summary:** scenario 028's Sunday, plus a stored `programs` row already at
`pending_approval`.

**Tester action:** As the bishop, change slot 1's speaker on the assignment page. Return to the
program.

**Verification checklist:**
- [ ] The program still shows the **old** speaker
- [ ] Refresh offers a diff naming both the old and the new name
- [ ] Dismissing the diff leaves the program unchanged
- [ ] Applying it changes the program, and only then

---

## Validation Commands

Run the migrations against the linked hosted project first:

```bash
npm run db:push
npm run db:types
```

Then, in order:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

> `npm run db:reset` **wipes the hosted database** (CLAUDE.md §9). Do not run it. RLS tests share
> that project, so they must clean up after themselves and cannot assume an empty table.

The production build is not optional. Lint, typecheck and tests all pass while a build fails —
static generation runs code the dev server never does.

---

## Integration Notes

- **`program-b`** consumes `programDraftSchema` for its editor, `diffDrafts` for its confirm step,
  and the four routes. It adds no new draft fields.
- **`program-c`** adds `programs.public_data` and a `toPublicProgram(draft)` projector that reads
  **only** `publicName` fields. Decision 3 is what makes that projector safe by construction; do not
  weaken it by adding a convenience `name` field to the draft.
- **`program-d`** renders `ProgramDraft` and emits `program_distributed`. `heading` is the ward
  conference case from Decision 1.
- **`program-e`** replaces this plan's narrow inline reads of `hymn_selections` and
  `musical_numbers` with `lib/music/queries.ts`. `gather.ts` is the only file that changes.
- **Breaking changes:** none. Nothing existing reads `programs` today.
- **ITER-004 is not closed by this plan.** The printed half lands in `program-d` and the public half
  in `program-c`. Leave the scope open.
