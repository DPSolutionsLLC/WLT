# Plan: Program D — The Bifold PDF and Distribution

**Created:** 2026-08-24
**Type:** feature
**Scope refs:** ITER-004 (closes the printed half of the external-speaker case)
**Structure:** Sequential — plan 4 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** `program-a`, `program-b` and `program-c` — all executed and merged. `program-c`
must land first: the QR code encodes a public URL, and a QR pointing at a page that does not exist
is a thing that gets printed and handed to a congregation.

**Unlocks Milestone M4** — the ward can print a real program.

---

## Overview

Turn an approved `ProgramDraft` into a physical object and then into an email.

- A bifold PDF: four panels on one landscape sheet, rendered server-side with
  `@react-pdf/renderer` (already installed, never yet used).
- A QR code encoding the `/public/[slug]` URL from `program-c`.
- Storage at `programs/{ward_id}/{sunday_date}.pdf` in a new private bucket.
- Email distribution via Resend — **the first application code in this repo to use Resend at all.**

**The two things most likely to go wrong are physical, not logical.** Panel imposition is not
reading order, and it cannot be verified by a test — only by folding paper. And distribution is
irreversible: an email that has gone cannot be recalled, which changes how the post-distribution
edit path has to behave.

**Success criteria**

- A generated PDF, printed on one landscape sheet and folded once, has the cover on the outside
  right and the back panel on the outside left.
- The QR code scans on a phone and lands on that Sunday's public program.
- A sparse draft (no speakers, two hymns missing) renders without throwing.
- An external speaker prints with their typed title (ITER-004, closed here).
- The distribution list receives the PDF; the librarian is on it.
- After distribution, the UI says in plain words that editing updates the web page and **not** the
  emailed PDF.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `lib/pdf/ProgramDocument.tsx` | The four-panel bifold document |
| `lib/pdf/panels/CoverPanel.tsx` | Outside right |
| `lib/pdf/panels/MeetingOrderPanel.tsx` | Inside right |
| `lib/pdf/panels/ContactsPanel.tsx` | Inside left |
| `lib/pdf/panels/BackPanel.tsx` | Outside left — missionaries, announcements, QR |
| `lib/pdf/theme.ts` | Registered fonts, the template's colours and spacing |
| `lib/pdf/qrCode.ts` | URL → PNG data URI |
| `lib/pdf/renderProgram.ts` | Draft → `Buffer`; the only file that calls `renderToBuffer` |
| `lib/program/storage.ts` | Upload and signed-URL read |
| `lib/program/distribution.ts` | Recipient list resolution and the Resend send |
| `lib/email/resend.ts` | The Resend client factory — server-only, key from env |
| `app/api/programs/[id]/generate-pdf/route.ts` | `POST` — render and store |
| `app/api/programs/[id]/distribute/route.ts` | `POST` — email and mark distributed |
| `supabase/migrations/039_program_storage.sql` | The `programs` storage bucket and its policies |
| `supabase/migrations/040_program_distributed_trigger.sql` | The `program_distributed` key |

### Modify

| File | What changes |
|---|---|
| `app/(app)/program/[sunday_id]/ProgramBuilder.tsx` | Generate-PDF and Distribute controls |
| `app/(app)/program/[sunday_id]/PostDistributionNotice.tsx` | New — the "the PDF will not change" sentence |
| `supabase/seed/notification_triggers.sql` | `program_distributed` |
| `lib/validation/program.ts` | Bodies for the two new routes |
| `.env.local.example` | `RESEND_FROM_ADDRESS` |
| `SPEC.md` | Record the storage path and the distribution list's location in ward settings |

---

## Dependencies

### The QR library — a decision, not a default

**No QR dependency is installed and none is approved.** CLAUDE.md §7 forbids installing one without
asking. This plan owns that decision, and it must be made with the user before Task 3 begins.

The recommendation is **`qrcode`** (npm, the `node-qrcode` package):

- Pure JavaScript, no native build step — which matters because the dev machine is Windows 11 Home
  with 2 cores and ~10 GB free disk (CLAUDE.md §9).
- `toDataURL()` returns a PNG data URI directly, which is exactly the shape
  `@react-pdf/renderer` needs. No canvas, no DOM.
- Ships its own types, or `@types/qrcode` if not.

Before installing, **report to the user** the resolved version, its dependency count, and its
install size. Do not install anything else in the same command.

Do **not** hand-roll QR encoding. It is Reed–Solomon error correction plus mask-pattern selection —
substantially more risk than the dependency it would replace, for a payload that gets printed and
scanned by strangers.

### Everything else is already installed

`@react-pdf/renderer@4`, `resend@6`. Neither has ever been called by application code — the
`deployment` retro records that `RESEND_API_KEY` sits in Vercel **unread**, because Supabase Auth
uses its own copy for SMTP. This plan is the first reader.

---

## Known Pitfalls (from retro context)

- **`deployment`** — *"Resend sends from `onboarding@resend.dev`… that test sender only delivers to
  the Resend account owner's own address, so **no real ward member can receive** a password reset
  today. Resend requires a verified domain."* **This applies unchanged to program distribution.**
  Until a domain is verified, distribution will succeed for the account owner and silently fail to
  reach anyone else. Treat that as a blocking question for Task 8 — see Open Decision.
- **`deployment`** — *"Vendor errors arrive stripped of their cause. Resend refusing an unverified
  sender reached us as a bare Supabase 500."* Log Resend's own response body on failure; do not let
  the cause exist only in Resend's dashboard.
- **`ai-a`** — six distinct error kinds beat one generic failure. Distribution has at least four
  worth separating: no recipients configured, the sender domain is unverified, the PDF is missing,
  and Resend itself failed. A secretary who sees "could not distribute" learns nothing.
- **`ai-b`, migration 032** — the storage-policy pattern is established: objects keyed
  `{ward_id}/…` so `(storage.foldername(name))[1]` reads the ward, schema-qualified
  `public.current_ward_id()`, and **no UPDATE policy** — replace by delete-and-reupload. Follow it.
- **`talks-b`** — stage-token contrast was **measured** in both themes, not eyeballed. The PDF has
  no dark mode, but it does have a `primary_color` from ward settings that can be configured into
  illegibility on paper. Guard the contrast.
- **`calendar-b`** — a confirm dialog is worded by consequence. "Email this program to 43 people?"
  not "Confirm distribution?".

---

## Open Decision — raise before Task 8

**Resend's sender domain is unverified.** Ask the user, before writing the distribute route:

1. Has a domain been verified in Resend since the `deployment` retro? If yes, what is the from-address?
2. If not — should distribution ship **disabled with an honest message** ("Email distribution needs
   a verified sending domain. The PDF is ready to download and send manually."), or ship enabled and
   deliver only to the account owner?

The recommendation is **disabled with an honest message**. A send that reports success and reaches
nobody is the worst of the three outcomes, and it is exactly the failure the `deployment` retro
records happening once already. The PDF and the public link are independently useful without email.

---

## Tasks

### Task 1: The PDF theme

**File:** `lib/pdf/theme.ts` (create)
**Action:** Fonts, colours, spacing, read from `wards.settings.program_template`.

**Details:**

- `@react-pdf/renderer` requires fonts to be **registered explicitly** — it does not inherit system
  fonts. Register from files under `public/fonts/`, not from a URL: a network fetch at render time
  is a cold-start failure on Vercel.
- `program_template` supplies `ward_name`, `church_name`, `cover_image_url`, `font_family`,
  `primary_color`. Every one gets a default; a ward with `settings = {}` must still print.
- **A limited CSS subset:** flexbox only, no grid, no `gap` in older versions, a subset of units.
  Build to those limits from the start rather than porting a web layout (the phase plan's warning).
- If `primary_color` fails a contrast ratio against white paper, fall back to the default and note
  it in the render result. Printing a program in pale yellow because a setting was mistyped is a
  ward-visible failure with no error.

---

### Task 2: The four panels

**Files:** `lib/pdf/panels/*.tsx` (create)
**Action:** One component per panel, each taking a slice of `ProgramDraft`.

**Details:**

- **Cover** — church name, ward name, `heading` when non-null (`program-a` Decision 1: this is the
  ward conference case, rendering nothing at all when null), the configurable image, and the date.
- **Meeting order** — the full order from FEATURES.md §Module 7, in order, with hymn numbers.
  Speakers render `printedName` — the **full** name, because a paper handout in a chapel is not the
  open internet, and `program-a` Decision 3 already computed it.
  **This is where ITER-004 closes:** an external speaker prints as "President Mark Andersen".
- **Contacts** — from `draft.leadershipContacts`. Never public (`program-c`), always printed.
- **Back** — missionary information, announcements, and the QR code.
- A `null` field renders **nothing** — no label, no dash, no "TBD". The `missing` list is
  `program-b`'s screen, not the printed page; a congregation does not need to read what the
  bishopric has not finished.
- Images need absolute URLs or buffers. A `cover_image_url` pointing at Supabase Storage must be
  fetched to a buffer server-side first.

---

### Task 3: The QR code

**File:** `lib/pdf/qrCode.ts` (create) — **after the dependency decision above**
**Action:** `programQrDataUri(publicUrl: string): Promise<string>`.

**Details:**

- Generate a **PNG data URI**. `@react-pdf/renderer` cannot render an SVG QR component — this is
  the phase plan's named pitfall.
- Error-correction level `M`, and a quiet zone. A program is folded and handled; a QR with no margin
  fails to scan when it sits against a fold.
- The URL comes from the `public_pages` slug. **If no slug row exists for this Sunday's program,
  create one** — `program-c` reads the row but nothing creates it, and a QR encoding `/public/null`
  is the kind of defect that survives every test and fails in a chapel.
- Minimum printed size ~20mm square. State it in a comment; it is a physical constraint, not a
  style choice.

---

### Task 4: Imposition

**File:** `lib/pdf/ProgramDocument.tsx` (create)
**Action:** Assemble four panels onto one landscape sheet, folded once.

**Details:**

On a landscape sheet folded once down the middle, there are two sides and four half-sheets:

| Sheet side | Left half | Right half |
|---|---|---|
| Front | **Back panel** (outside left) | **Cover** (outside right) |
| Reverse | **Contacts** (inside left) | **Meeting order** (inside right) |

Reading order is cover → meeting order → contacts → back. **Panel order on the sheet is not reading
order**, which is the phase plan's first pitfall.

- Two `<Page size="LETTER" orientation="landscape">` elements, each a horizontal flex row of two
  equal-width panels.
- Reverse-side ordering assumes a duplex printer flipping on the **long edge**. Say so in a comment
  — it is the assumption a wrong fold will trace back to.
- **`pdf-render.test.ts` cannot verify this.** It can verify that four panels exist and that each
  page has two. Folding paper is the only real check, and it is a Definition-of-Done item in the
  phase plan for that reason.

---

### Task 5: Rendering

**File:** `lib/pdf/renderProgram.ts` (create)
**Action:** `renderProgramPdf(draft, template, qrDataUri): Promise<Buffer>` via `renderToBuffer`.

**Details:**

- The **only** file that calls `renderToBuffer`. One entry point keeps cold-start cost in one place.
- Server-only. Add `import "server-only"` — a PDF renderer reaching a client bundle is a large
  regression that nothing else would catch.
- **Render on approval and on explicit request, never on every preview.** `program-b` shows an HTML
  preview during editing precisely so this is not on the keystroke path.
- Vercel cold starts are slow here. The route should be prepared for a multi-second render and the
  UI should show real progress rather than appearing hung.

---

### Task 6: Storage

**Files:** `lib/program/storage.ts`, `supabase/migrations/039_program_storage.sql` (create)
**Action:** A private bucket and ward-scoped policies.

**Details:**

- Bucket `programs`, `public: false`. Objects keyed `{ward_id}/{sunday_date}.pdf` — ward first, so
  `(storage.foldername(name))[1]` reads it, exactly as migration 032 does.
- Policies use schema-qualified `public.current_ward_id()`; `public` is not on the search path when
  evaluating against `storage.objects`.
- Read is **ward-wide** (any authenticated member of the ward may fetch their own program). Write is
  narrowed to the `program.build` roles, matching migration 037's shape.
- **No UPDATE policy**, per 032's reasoning. A regenerated program overwrites via delete-then-upload,
  or uses `upsert: true` on the client — pick one and say which in a comment.
- Anon does **not** get a policy here. The public page links to `pdf_url`; if that must be
  anon-readable, issue a **signed URL with a bounded lifetime** rather than opening the bucket.
  Decide it explicitly and record the choice — a public bucket of ward programs is a quiet privacy
  decision made by omission.

---

### Task 7: `POST /api/programs/[id]/generate-pdf`

**File:** `app/api/programs/[id]/generate-pdf/route.ts` (create)
**Action:** Render, store, write `pdf_url`.

- `assertCan(user, "program.build", roleAccess)`.
- Requires status `approved` or `distributed`. Rendering a `draft` would produce a PDF of a document
  nobody has approved, which is the phase plan's "generate on approval" rule as a guard rather than
  a convention.
- Creates the `public_pages` slug row if absent (Task 3), because the QR needs it.
- Audit `program_pdf_generated` with `{ programId, sundayDate, byteLength }`.
- A render failure returns a specific message. "Could not generate the PDF" with the underlying
  cause logged server-side — never swallowed (CLAUDE.md rule 7).

---

### Task 8: `POST /api/programs/[id]/distribute`

**Files:** `app/api/programs/[id]/distribute/route.ts`, `lib/program/distribution.ts`,
`lib/email/resend.ts` (create) — **after the Open Decision above**
**Action:** Email the PDF, mark distributed.

**Details:**

- `assertCan(user, "program.distribute", roleAccess)` — held by `ward_secretary` **and** the
  bishopric. The phase plan is explicit: never gate a step on the secretary role alone.
- Requires status `approved` and a non-null `pdf_url`.
- Recipients come from `wards.settings.program_distribution_list` plus the librarian entry. **An
  empty list is a 422 with its own sentence**, not a successful send to nobody.
- `lib/email/resend.ts` reads `RESEND_API_KEY` server-side. No `NEXT_PUBLIC_` prefix, never logged
  (CLAUDE.md rule 8). Lazy-initialise the client the way `lib/ai/client.ts` does, so importing the
  module does not require the key — otherwise every test that touches the import chain needs it.
- On success: status → `distributed`, stamp `distributed_at` / `distributed_by`, emit
  `program_distributed`, audit with the **recipient count** — never the addresses.
- Then `revalidatePath('/public/' + slug)` so `program-c`'s cached page updates immediately rather
  than in five minutes.
- **Partial failure is a real state.** Resend can accept some recipients and reject others. Report
  how many were sent and how many failed, with the reasons. Do not mark `distributed` on a total
  failure.

---

### Task 9: The post-distribution notice

**File:** `app/(app)/program/[sunday_id]/PostDistributionNotice.tsx` (create)
**Action:** Say what an edit after distribution actually does.

Wording, near-verbatim from the phase plan: **"This will update the online program. The emailed PDF
will not change."**

- Shown whenever a `distributed` program is edited.
- `program-c` clears `public_data` on `approved → draft`, so the public page goes dark until
  re-approval. The notice must say that too — a secretary who thinks they are making a small text
  fix should know the public link stops working until somebody re-approves.
- This is a consequence-worded warning, not a confirmation dialog. It does not block.

---

### Task 10: Triggers and env

**Files:** `supabase/migrations/040_program_distributed_trigger.sql`,
`supabase/seed/notification_triggers.sql`, `.env.local.example`, `SPEC.md` (create / modify)

- `program_distributed` → `bishop`, `counselor`, `ward_secretary`. Two-part change again: migration
  for existing wards, seed for future ones. `program-a` already added it to SPEC.md's key list
  marked as this plan's — remove the marker now that it fires.
- `.env.local.example` gains `RESEND_FROM_ADDRESS`. `RESEND_API_KEY` is already in Vercel.
- SPEC.md: record the storage path, the bucket's privacy, and that the distribution list lives at
  `wards.settings.program_distribution_list`.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/pdfRender.test.ts` | A **full** draft and a **sparse** one both render without throwing; the sparse one produces no "TBD" string; four panels across two pages |
| `tests/lib/qrCode.test.ts` | Returns a `data:image/png;base64,` URI; decodes back to the input URL; a slug with a hyphen survives |
| `tests/lib/programDistribution.test.ts` | Empty recipient list is refused; partial failure reports both counts; the audit detail carries a count and **no address** |
| `tests/routes/program-distribute.test.ts` | `ward_secretary` 200, `music_coordinator` 403; distributing a `draft` is 409; distributing with a null `pdf_url` is 409 |
| `tests/rls/program-storage.test.ts` | Ward A cannot read ward B's object; a `music_coordinator` cannot write one |

Mock Resend at the module boundary in tests. Do **not** send real email from a test suite — the
account has a low free-tier quota and the `deployment` retro's sender restriction makes the result
misleading either way.

---

## Test Scenarios (Harness)

### Scenario 034: Print it and fold it

**Tags:** `program`, `pdf`, `physical`, `full`
**Purpose:** The one check no test can perform. The phase plan makes it a Definition-of-Done item.

**Seed data summary:** scenario 028's Sunday with every gap filled — three speakers (one external),
three hymns, both prayers, a musical number, announcements, and leadership contacts.

**Tester action:** Approve, generate the PDF, **print it on one landscape sheet, double-sided, and
fold it once.** Then scan the QR code with a phone.

**Verification checklist:**
- [ ] Folded, the cover is on the **outside right** and the back panel on the **outside left**
- [ ] Opened, contacts are on the left and the meeting order on the right
- [ ] Nothing is cut off at the fold or the margins
- [ ] The external speaker prints as "President Mark Andersen" (ITER-004)
- [ ] The QR scans on the first try and opens **that Sunday's** public program
- [ ] The QR still scans when the sheet is folded

### Scenario 035: Distribution, and what happens after

**Tags:** `program`, `email`, `full`
**Purpose:** The irreversible step and the edit that follows it.

**Seed data summary:** as 034, plus a `program_distribution_list` of three addresses the tester
controls.

**Tester action:** Distribute. Then edit the announcements and re-approve.

**Verification checklist:**
- [ ] The confirm names the number of recipients before sending
- [ ] The PDF arrives and opens on a phone
- [ ] After distributing, editing shows the "the emailed PDF will not change" notice
- [ ] The notice also says the public link goes dark until re-approval
- [ ] Re-approving restores the public page with the new text
- [ ] The audit log has a row with a recipient **count** and no addresses

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm run test
npm run build
```

The production build matters more here than anywhere else in Phase 6: `@react-pdf/renderer` is a
large server-only dependency, and a font or `server-only` import that works in `next dev` can fail
static generation.

---

## Integration Notes

- **ITER-004 closes here**, together with `program-c`. Update the scope file and the backlog:
  printed name in `MeetingOrderPanel`, public name in `publicProjection.ts`.
- **`program-e`** fills the hymn fields the panels already render. Nothing in this plan changes when
  hymns arrive — a hymn is a number and a title either way.
- **Milestone M4 is reached when scenario 034's fold check passes**, not when the route returns 200.
- **Breaking changes:** none.
- **Cost note:** each generate-pdf is a cold-start-prone server render. If the ward regenerates
  repeatedly while proofreading, that is the HTML preview's job — watch for it in the walk and
  raise it if the preview is not carrying its weight.
