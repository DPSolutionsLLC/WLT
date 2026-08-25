# Plan: Program B — The Builder Screen and the AI Editor

**Created:** 2026-08-24
**Type:** feature
**Structure:** Sequential — plan 2 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** [program-a-draft-and-approval.md](program-a-draft-and-approval.md) — executed and
merged first. `program-a` owns the draft schema, the diff, and all four routes; this plan adds no
new draft fields and no new server-side draft logic.

---

## Overview

The on-screen half. A secretary opens a Sunday, sees the assembled program, edits any field,
watches what is still missing, refreshes from current data behind a diff, sends it for approval,
and — the highest-risk surface in the app — asks Claude in plain English to change it.

Three things distinguish this from an ordinary form:

1. **The draft is a snapshot, so "what has moved upstream" is a first-class question.** The refresh
   diff panel is the answer, and it is the same component the AI editor uses to confirm its change.
2. **Missing is not an error state.** A Thursday program with three gaps is the normal case. The
   screen reports gaps as work remaining, never as a failure.
3. **The AI editor returns structured data, not prose.** Prose a human skims and corrects.
   A JSON draft that silently drops a field looks fine on screen and prints wrong. Structured
   output, Zod, and a diff — all three, no exceptions.

**Success criteria**

- A secretary edits any field on the program and saves; the stored draft matches what is on screen.
- The missing list reads as sentences a person can act on, never as field names.
- Refresh shows what changed upstream and writes nothing until the secretary confirms.
- "Add a note that the Primary will sing" produces a diff naming exactly that change, and applying
  it is a second, separate action.
- An AI response that fails schema validation surfaces an error and **leaves the draft untouched**.
- The bishopric can complete the whole flow without the secretary, and vice versa for everything
  except approval.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `app/(app)/program/page.tsx` | Server Component — the Sunday list, who needs a program |
| `app/(app)/program/[sunday_id]/page.tsx` | Server Component — loads the draft, guards on `program.view` |
| `app/(app)/program/[sunday_id]/ProgramBuilder.tsx` | `"use client"` — the editor shell and its TanStack Query cache |
| `app/(app)/program/[sunday_id]/MeetingOrderForm.tsx` | `"use client"` — the field-by-field editor |
| `app/(app)/program/[sunday_id]/MissingPanel.tsx` | What is still needed, as sentences |
| `app/(app)/program/[sunday_id]/RefreshButton.tsx` | `"use client"` — calls `/refresh` with `apply: false` |
| `app/(app)/program/[sunday_id]/AiEditPanel.tsx` | `"use client"` — the conversation, its history, and its errors |
| `components/program/DraftDiff.tsx` | The shared diff table — refresh and AI edit both render it |
| `components/program/ProgramStatusBadge.tsx` | Four statuses, themed both ways |
| `components/program/ProgramPreview.tsx` | The HTML preview of the meeting order |
| `lib/program/missingMessages.ts` | `MISSING_FIELD_KEYS` → the sentence shown for each |
| `lib/ai/programEdit.ts` | The system prompt block and the structured output schema |
| `lib/validation/aiProgramEdit.ts` | Zod for the ai-edit request body |
| `app/api/programs/[id]/ai-edit/route.ts` | `POST` — returns a proposed draft, stores nothing |

### Modify

| File | What changes |
|---|---|
| `components/layout/Sidebar.tsx` | A Program link behind `program.view` |
| `lib/auth/navigation.ts` | The nav entry and its permission |
| `types/domain.ts` | `AI_MODULES` gains `program_edit` |
| `lib/ai/moduleInstructions.ts` | The `program_edit` instruction block |
| `SPEC.md` | §Component Structure gains the `/program` tree |

---

## Dependencies

No new libraries. TanStack Query, Zod and the Anthropic SDK are all already in use.

Existing services to go through, not around:

- `lib/ai/client.ts` — `callClaudeStructured()`, `GENERATION_MAX_TOKENS`, and the six typed error
  kinds. Do not construct an SDK client here.
- `lib/ai/systemPrompt.ts` — assembles the ward's settings into a system prompt with the cache
  breakpoint on the last stable block.
- `components/assignments/SpeakerLine.tsx` — see the pitfall below.
- `components/ui/*` — `Button`, `Card`, `Modal`, `Input`, `FormError`, `NotPermitted`.

---

## Known Pitfalls (from retro context)

- **`talks-b`** — *"Phase 6 must render speakers through `SpeakerLine`, not by re-deriving a name
  from `member_id`, or an external speaker's title goes missing."* The nuance here: `program-a`
  already resolved both names into the snapshot, so this screen renders
  `draft.speakers[i].printedName` directly. **Do not re-derive from `member_id` and do not reach for
  the roster.** If you find yourself importing `speakerFrom` in this plan, the draft shape is wrong
  — fix `program-a`, not this screen.
- **`ai-a`** — `router.refresh()` **preserves client state**. Restoring a settings version left the
  form stale while every server test passed. This screen has exactly the same shape: applying a
  refresh or an AI edit must reset the form's client state from the new draft, not merely refetch on
  the server. This is the most likely bug in this plan.
- **`ai-c`** — every AI failure reaches the user as its own sentence, beside a control that still
  holds whatever was there before. Never a generic "something went wrong", never a cleared form.
- **`ai-b`** — the "all 1 of its passages" plural bug. Any count on this screen ("2 items still
  needed") needs a fixture with **one** and with **several**, or the singular path cannot fail.
- **`talks-c`** — an absence renders as an absence. A missing organist is a blank, not "Never" and
  not "None assigned" — the `MissingPanel` is where the app says what is needed, once, rather than
  every empty field apologising for itself.
- **`calendar-b`** — the confirm dialog is worded by **consequence**, not by mechanism. "Apply these
  4 changes to the program?" not "Overwrite draft_data?".
- **`roster-b`** — `MemberPicker`'s interface is frozen. If this screen needs a person picker for
  the organist or chorister, use it as-is; do not add a prop.

---

## Tasks

### Task 1: Missing-field sentences

**File:** `lib/program/missingMessages.ts` (create)
**Action:** Map each `MISSING_FIELD_KEYS` entry to the sentence a person reads.

```ts
export const MISSING_MESSAGES: Record<MissingFieldKey, string> = {
  sacrament_hymn: "No sacrament hymn has been chosen.",
  speaker_slot: "A speaking slot is still open.",
  presiding_unconfirmed_ward_conference:
    "A ward conference usually has a visiting presiding officer. Confirm who is presiding.",
  ...
};
```

`Record<MissingFieldKey, string>` is deliberate — a key added in `program-a` fails to compile here
until somebody writes its sentence. Same discipline as `ROLE_LABELS` and `PROGRAM_STATUS_LABELS`.

`speaker_slot` can appear more than once. The panel groups repeats into one line with a count
("2 speaking slots are still open") — and per the `ai-b` pitfall, the singular and plural forms both
need a test.

---

### Task 2: The Sunday list and the detail shell

**Files:** `app/(app)/program/page.tsx`, `app/(app)/program/[sunday_id]/page.tsx` (create)
**Action:** Server Components. Guard, load, hand to the client component.

**Details:**

- `assertCan(user, "program.view", roleAccess)` at the top of each; render `NotPermitted` on a
  `ForbiddenError` rather than a redirect, matching the existing app pages.
- The list shows the next eight Sundays that hold a sacrament meeting, each with its status badge
  and its missing count. Sundays where `holdsSacramentMeeting(type)` is false are **absent from the
  list entirely** — not greyed out. There is no program for a meeting that is not held, and a
  disabled row reads as "this is coming" (`talks-b`'s waiver reasoning).
- The detail page loads the stored draft via `lib/program/queries.ts` directly — a Server Component
  does not fetch its own API route.
- A Sunday with no program row yet renders a single "Build the program" action, not an empty form.
- 375px first. The meeting order is a long single column on a phone; it does not become a table
  until `sm:`.

---

### Task 3: The editor

**Files:** `ProgramBuilder.tsx`, `MeetingOrderForm.tsx`, `MissingPanel.tsx`,
`ProgramPreview.tsx`, `ProgramStatusBadge.tsx` (create)
**Action:** The client editing surface.

**Details:**

- `ProgramBuilder` owns the TanStack Query cache for this program and the form state. Follow
  `MonthPlannerBoard.tsx` for the established shape of a client board over a Server-rendered page.
- Every field in `programDraftSchema` is editable, **including** ones sourced from upstream. The
  program is a snapshot: correcting a name on the program does not and must not write back to the
  roster or the assignment. Say so once in the UI, near the save control.
- Validate the form with `programDraftSchema` — the same schema the route uses. One schema, both
  sides (CLAUDE.md §6).
- Save posts the **whole draft** to `POST /api/programs`. A partial patch of a snapshot is ambiguous
  about the fields it omits.
- `ProgramPreview` renders the meeting order as HTML in reading order. It is **not** the bifold
  layout and must not try to be — panel imposition is `program-d`'s problem and a fake preview of it
  would be worse than none. Label it "Preview" and let `program-d` add the PDF button beside it.
- `ProgramStatusBadge` reuses the token approach `StageBadge` established, and **contrast is
  measured in both themes**, not eyeballed (`talks-b` retuned two tokens after measuring).
- The send-for-approval control moves `draft → pending_approval` and emits
  `program_pending_approval`. It is visible to anyone holding `program.build` — a bishopric member
  can do it themselves when the secretary is away.

---

### Task 4: The shared diff and the refresh flow

**Files:** `components/program/DraftDiff.tsx`, `RefreshButton.tsx` (create)
**Action:** One diff component; two callers.

**Details:**

- `DraftDiff` takes `DraftChange[]` from `program-a` and renders label / before / after. It is
  presentational — it does not know whether the change came from a refresh or from Claude.
- An empty array renders a sentence — "Nothing has changed since this program was built" — not an
  empty table.
- Refresh calls `/refresh` with `apply: false`, shows the diff in a `Modal`, and applies only on
  confirm. The confirm button is worded by consequence: **"Apply these 4 changes"**, not "Confirm".
- **After applying, reset the form state from the returned draft.** This is the `ai-a` trap
  restated: `router.refresh()` alone leaves the client form holding the old values, and every
  server-side test still passes. Reset explicitly.
- Refresh is hidden — not disabled — once the program is `approved` or `distributed`. The route
  refuses it anyway; the UI should not offer a thing that will 409.

---

### Task 5: The AI edit route

**Files:** `lib/ai/programEdit.ts`, `lib/validation/aiProgramEdit.ts`,
`app/api/programs/[id]/ai-edit/route.ts`, `types/domain.ts`, `lib/ai/moduleInstructions.ts`
(create / modify)
**Action:** Plain-English editing that **stores nothing**.

**Details:**

- Add `"program_edit"` to `AI_MODULES` and write its block in `MODULE_INSTRUCTIONS`. Follow
  `ai-c`'s shape exactly.
- Request body: `{ draft: ProgramDraft, history: ChatTurn[], instruction: string }`. The client
  sends the **current draft** and the **full conversation history** on every call, per the phase
  plan — the model edits current state rather than remembering it.
- Call `callClaudeStructured({ format: zodOutputFormat(programDraftSchema), effort: "medium", ... })`.
  The output schema is `program-a`'s draft schema, unchanged. `effort: "medium"` matches message
  drafting; this is an editing task, not a generative one.
- **Do not catch `AiRequestError`.** Let it reach `respondToRouteError`, which maps each of the six
  kinds to its own status and its own sentence (`ai-c`). Catching it here is how the silent-AI-
  failure pitfall starts.
- The route **returns** `{ draft, changes }` — the proposed draft and `diffDrafts(current, proposed)`
  — and writes to no table. Saving stays the existing `POST /api/programs` call, made by the user
  pressing Apply. That is CLAUDE.md rule 3, and it is why this route is not a mutation.
- Audit `program_ai_edit_generated` with `{ programId, changedFields, outputTokens }`.

  > **Note:** `outputTokens` is currently stored as the string `"[redacted]"` by
  > `writeAuditLog`'s sensitive-key filter — that is **ITER-017**, pre-existing and out of scope
  > here. Log the field anyway, exactly as `ai-c`'s routes do, so this route is fixed along with
  > them when ITER-017 lands. Do not work around the filter locally.

- **Validation is layered and all three layers are required.** Structured output makes the response
  parseable; `programDraftSchema` makes it *valid*; the diff makes it *visible*. A schema-valid
  draft that quietly dropped the benediction passes the first two and is caught only by the third.

---

### Task 6: The AI panel

**File:** `AiEditPanel.tsx` (create)
**Action:** The conversation surface.

**Details:**

- History lives in component state, as SPEC.md §Program AI Editor specifies. It is not persisted —
  a conversation about a draft is working state, not a record.
- Each response renders as a `DraftDiff` plus an Apply button. **The response is never applied
  automatically**, and there is no "always apply" preference to add later.
- Applying resets the form state from the applied draft (the `ai-a` trap again) and appends a turn
  to the history so the next instruction edits from there.
- An error renders as its own sentence beside a panel that still holds the conversation and the
  unchanged draft. Nothing is cleared on failure (`ai-c`).
- Hidden once `approved` or `distributed`, matching Refresh.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/components/program/MissingPanel.test.tsx` | One missing item and several; the singular/plural split; every key has a sentence |
| `tests/components/program/DraftDiff.test.tsx` | Renders labels not dotted paths; empty array renders the sentence, not an empty table |
| `tests/components/program/ProgramBuilder.test.tsx` | **Applying a diff resets form state** — the `ai-a` regression, asserted on the rendered input values, not on a refetch call |
| `tests/routes/program-ai-edit.test.ts` | A valid response returns a draft and changes; a schema-invalid response is a 4xx **and no row is written**; each AI error kind maps to its own status |
| `tests/lib/programEditPrompt.test.ts` | The prompt carries the current draft and the full history; the ward's settings reach the system block |

The structural no-autosave test matters most: after a successful `ai-edit` call, re-read the
`programs` row with the service client and assert `draft_data` is **byte-identical** to before.
`ai-c` proved this shape is worth writing explicitly.

---

## Test Scenarios (Harness)

### Scenario 030: Editing a program by describing the change

**Tags:** `program`, `ai`, `full`
**Purpose:** The highest-risk AI surface in the app, exercised end to end. Needs a real draft with
real gaps, which is what makes seeding worth it.

**Seed data summary:** scenario 028's Sunday and its `programs` row at `draft`.

**Tester action:** As the ward secretary, open the program and type
*"Add a note that the Primary children will sing during the sacrament, and change the ward business
to mention the new Elders Quorum secretary."*

**Verification checklist:**
- [ ] The reply is a **diff**, not a new program — the old and new text are both visible
- [ ] Exactly the two described fields appear in the diff; nothing else moved
- [ ] Nothing is saved until Apply is pressed — navigating away discards it
- [ ] After Apply, the form on screen shows the new text (not the old values)
- [ ] A second instruction edits the **already-updated** draft, not the original

### Scenario 031: The program that is not ready

**Tags:** `program`, `smoke`
**Purpose:** Proves "missing is not an error". Reuses scenario 028's gaps.

**Tester action:** Open the same Sunday and read the missing panel without fixing anything.

**Verification checklist:**
- [ ] Every gap is a sentence naming what to do, never a field name like `sacrament_hymn`
- [ ] Two open speaking slots read as one line with a count, correctly pluralised
- [ ] The program can still be sent for approval with gaps — it warns, it does not block
- [ ] Nothing on screen reads as an error or a failure

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

No migrations in this plan, so no `db:push`. If `types/domain.ts` changed, `npm run typecheck` is
what catches every unwritten label.

---

## Integration Notes

- **No new draft fields.** If this screen wants one, it belongs in `program-a`'s schema and every
  consumer sees it. Adding a field here would make the AI editor's output schema disagree with the
  renderer's input.
- **`program-d`** adds a "Generate PDF" button beside `ProgramPreview` and the distribute control
  beside the approve one. It reuses `ProgramStatusBadge` unchanged.
- **`program-e`** adds the hymn fields' pickers. Until then hymn fields are typed by hand as a
  number and a title, which is correct behaviour for a partially-seeded hymnbook, not a stopgap.
- **Breaking changes:** none.
