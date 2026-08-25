# Phase 6 — Program Builder, Music & Public Pages

Hymn selection, the bifold sacrament program PDF, AI-assisted program editing, approval
and distribution, and the two public no-auth pages.

**Depends on:** Phase 5. **Unlocks:** Milestone M4 — the ward can print a real program.
**Reference:** [FEATURES.md](../FEATURES.md) §Modules 7, 8; [SPEC.md](../SPEC.md) §Sacrament Program PDF.

---

## Sub-plans — execute these, not this file

This phase is too large to execute in one pass. Split 2026-08-24 into five sequential plans,
following the `talks-a`…`talks-d` and `ai-a`…`ai-d` precedent. **This file remains the reference
for what the phase must achieve; the sub-plans are what get executed.**

| # | Plan | Covers | Status |
|---|---|---|---|
| 1 | [program-a-draft-and-approval.md](program-a-draft-and-approval.md) | Step 2 + Step 5 — draft assembly, the snapshot rule, program routes, approval | Ready |
| 2 | [program-b-builder-screen.md](program-b-builder-screen.md) | Step 4 — the builder screen, HTML preview, refresh diff, AI editing | Ready |
| 3 | [program-c-public-pages.md](program-c-public-pages.md) | Step 6 — the safe projection, the public shell, `/public/[slug]` | Ready |
| 4 | [program-d-pdf-and-distribution.md](program-d-pdf-and-distribution.md) | Step 3 + distribution — bifold PDF, QR, storage, Resend | Ready |
| 5 | [program-e-music-and-hymns.md](program-e-music-and-hymns.md) | Step 1 — music coordination, hymn selection, AI suggestions | ⛔ **Blocked** |

**Two orderings are deliberate and not arbitrary:**

- **`program-c` comes before `program-d`.** The QR code encodes the public program URL. Building
  the PDF first means either a QR pointing at a page that does not exist, or a placeholder nobody
  remembers to replace before it is printed and handed to a congregation.
- **`program-e` is last and blocked.** `supabase/seed/hymns.sql` holds 42 of 341 hymns and forbids
  padding it with plausible entries — a wrong number gets sung. The other four plans were written
  not to need hymn data, so Milestone M4 is reachable without it: a secretary can type a hymn
  number and title by hand, which is correct behaviour for a partial hymnbook rather than a
  workaround. `program-e` Task 0 is the gate, and it needs a source the user supplies.

**One dependency is unapproved.** No QR library is installed. `program-d` owns that decision and
must raise it before its Task 3; nothing earlier in the sequence touches it.

---

## Goals

1. Music coordinator selects hymns with AI assistance; selections feed the program
2. Program draft assembles automatically from calendar, assignments, prayers, and hymns
3. PDF renders in the Buffalo Ward bifold layout with an embedded QR code
4. Approval and email distribution
5. Public program page and the shared public-page shell

---

## Step 1 — Music Coordination

The music coordinator has a narrow role: upcoming Sundays, hymn selection, musical numbers.
No access to anything else.

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/hymns` | GET | Authenticated | Search seeded hymn table by number, title, tag |
| `/api/hymns/suggest` | GET | Music coord + bishopric | AI suggestions for a Sunday's topics |
| `/api/hymns/select` | POST | Music coord + bishopric | Save opening / sacrament / closing selection |
| `/api/musical-numbers` | POST | Music coord + bishopric | Log performer and piece |

`/music` page shows upcoming Sundays with the assigned speaker **topics** (not the full
assignment detail — the coordinator does not get pipeline access), current selections, and
missing-selection warnings.

**AI hymn suggestions.** Input: the Sunday's assigned topics. Output: candidate hymns each
with a one-line note explaining the connection. Match on `hymns.topic_tags` first, then let
Claude rank and explain — do not ask the model to recall hymn numbers from memory, because
it will hallucinate them. **Pass the candidate list in the prompt and require the model to
choose from it.** Validate every returned hymn number against the table before display.

The coordinator accepts, modifies, or ignores. `ai_suggested` records which selections
originated as suggestions.

---

## Step 2 — Program Draft Assembly

`lib/program/assembleDraft.ts` — pure function, given a `sunday_id`, producing the
`draft_data` JSON:

| Field | Source |
|---|---|
| Date | `sundays.date` |
| Presiding | Bishop by default; `sundays.presiding_override` if set |
| Conducting | `sundays.conducting_user_id` |
| Organist / Chorister | Music coordinator entry or manual |
| Opening / Sacrament / Closing hymn | `hymn_selections` |
| Invocation / Benediction | `prayer_assignments` |
| Speakers | `assignments` at stage `notify` or later |
| Ward/Stake business, special notes, announcements | Free text, secretary |
| Musical number | `musical_numbers` if present |
| Leadership contacts | `wards.settings.leadership_contacts` |
| Missionary information | `wards.settings.missionaries` |

The draft is a **snapshot**, not a live view. Once created it stops tracking upstream
changes — otherwise an approved program silently changes after approval. Provide an
explicit "refresh from current data" action that shows a diff before applying.

**Missing data is expected.** A program built Thursday may lack a confirmed speaker.
Render placeholders and list what is missing rather than refusing to build.

---

## Step 3 — PDF Rendering

`lib/pdf/ProgramDocument.tsx`, rendered server-side with `@react-pdf/renderer`.

Bifold, four panels on one landscape sheet:

| Panel | Position | Contents |
|---|---|---|
| Cover | outside right | Church name, ward name, configurable image, date |
| Meeting order | inside right | Full order with roles and hymn numbers |
| Leadership contacts | inside left | Auto-populated from ward settings |
| Back | outside left | Missionary info, announcements, **QR code** |

Panel order on the physical sheet is *not* reading order — get the imposition right:
on a landscape sheet folded once, the left half of the front is the back panel and the
right half is the cover. Print a test before calling it done.

**QR code** encodes the public program URL. Generate as a data URI server-side and embed
as an image — `@react-pdf/renderer` cannot render a QR component.

Template configuration lives in `wards.settings.program_template`: ward name, church name,
cover image URL, font family, primary colour.

Store the PDF in Supabase Storage at `programs/{ward_id}/{sunday_date}.pdf`.

> **`@react-pdf/renderer` has real constraints:** a limited CSS subset (flexbox only, no
> grid), fonts must be registered explicitly, and images need absolute URLs or buffers.
> Build the layout against those limits from the start rather than porting a web layout.
> Cold-start rendering can be slow — consider generating on approval rather than on
> every preview, and show an HTML preview during editing.

---

## Step 4 — AI Program Editing

`/api/programs/[id]/ai-edit`. The secretary or a bishopric member describes a change in
plain English; Claude returns an updated draft.

- Maintain conversation history in component state; send the full history each call
- Include the **current draft JSON** in every request so the model edits current state
- Return the updated draft as **structured output** against a JSON schema matching
  `draft_data`, so the response is guaranteed parseable
- Validate the returned draft with the same Zod schema the manual editor uses. Reject and
  surface an error rather than storing a malformed draft
- **Show a diff before applying.** The user sees exactly what changed and confirms

This is the highest-risk AI surface in the app, because the output is structured data
rather than reviewable prose. Validation and the diff step are not optional.

---

## Step 5 — Approval & Distribution

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/programs` | POST | Secretary + bishopric | Create or update draft |
| `/api/programs/[sunday_id]` | GET | Secretary + bishopric + music | Fetch draft |
| `/api/programs/[id]/generate-pdf` | POST | Secretary + bishopric | Render and store |
| `/api/programs/[id]/approve` | POST | **Bishopric only** | Approve |
| `/api/programs/[id]/distribute` | POST | Secretary + bishopric | Email to the distribution list |

Status flow: `draft → pending_approval → approved → distributed`.

1. Secretary finalizes the draft and generates the PDF
2. Sends in-app to bishopric for approval
3. Once approved, emails the PDF to the ward distribution list and the librarian
4. **Bishopric can do the whole thing if the secretary is unavailable** — never gate a
   step on the secretary role alone

Email via Resend. Distribution list lives in ward settings.

**Post-distribution edits.** The public page always reflects the latest approved version,
so an edit after distribution updates the web page but not the emailed PDF. Make that
explicit in the UI: "This will update the online program. The emailed PDF will not change."

**Leadership contacts auto-update.** When a user's name or role changes, prompt:
"Leadership contacts in the sacrament program may be affected. Update the template now?"
Admin confirms or dismisses — no silent propagation.

---

## Step 6 — Public Pages

Two public pages share one shell. Phase 10 adds the assignments page; build the shell here.

`/public/[slug]` — looks up `public_pages` by slug, branches on `page_type`.

**Security.** These render with no session. Read through the safe SQL views created in
Phase 0 (`public_program`, `public_sacrament_assignments`), not the base tables.

Exposed: first name and last initial, hymn numbers and titles, dates, meeting order,
announcements, ward name.
**Never exposed:** phone numbers, addresses, full last names, notes, member IDs, emails.

Every field added to a public page is a privacy decision. Review the projection whenever
the view changes.

Design: clean, mobile-optimized, no login prompt, no app chrome. Someone scans the QR code
in a chapel on a phone with poor signal — keep it light and fast. Cache with a short TTL
and revalidate on approval so edits appear promptly.

---

## Tests

| Test | Asserts |
|---|---|
| `draft-assembly.test.ts` | Correct sourcing of each field; missing data yields placeholders, not a throw |
| `draft-snapshot.test.ts` | Changing an upstream assignment does not mutate an existing draft |
| `hymn-validation.test.ts` | An AI-suggested hymn number not in the table is rejected |
| `pdf-render.test.ts` | Renders without throwing for a full draft and a sparse one |
| `ai-edit-validation.test.ts` | A malformed AI draft is rejected, not stored |
| `program-approval.test.ts` | Only bishopric approves; secretary can do everything else |
| `public-projection.test.ts` | The public view exposes no phone, address, full last name, or notes. **Highest priority** |
| `public-no-auth.test.ts` | `/public/[slug]` renders with no session and 404s for an inactive slug |

---

## Definition of Done

- [ ] Music coordinator page: upcoming Sundays, topics, hymn search, selections
- [ ] AI hymn suggestions validated against the hymn table, with rationales
- [ ] Program draft assembles from all sources and is a stable snapshot
- [ ] PDF renders in correct bifold imposition with a working QR code
- [ ] Physical print test passes — panels fold correctly
- [ ] AI conversational editing with schema validation and a diff-confirm step
- [ ] Approval and email distribution work; bishopric can complete the flow alone
- [ ] Public program page renders with no auth and leaks nothing
- [ ] Leadership contact changes prompt rather than propagate silently
- [ ] All eight tests pass

---

## Pitfalls

- **Bifold imposition.** Panels are not in reading order. Print a physical test.
- **QR code component in the PDF.** Generate a data URI first; the PDF renderer cannot
  render an SVG QR component.
- **Live draft instead of a snapshot.** An approved program that changes underneath the
  bishop is a trust problem, not just a bug.
- **Hallucinated hymn numbers.** Constrain the model to a candidate list and validate the
  result against the table. Never trust a recalled number.
- **Unvalidated AI-edited drafts.** Structured output plus Zod plus a diff. All three.
- **Public page over-exposure.** The single most likely privacy incident in this app.
  Go through the view, not the tables.
- **`@react-pdf/renderer` cold starts.** Generate on approval, not on every keystroke;
  preview in HTML.

---

## Open questions handed over from Phase 3 (ITER-003) — ANSWERED 2026-08-24

Both are decided in [program-a-draft-and-approval.md](program-a-draft-and-approval.md)
§Decisions This Plan Makes, with the reasoning recorded there:

1. **A ward conference is an ordinary program with a heading**, not a second template. The meeting
   order is the same shape; only the presiding officer and a heading differ, and a second template
   would double the bifold imposition work and the physical print test for one line.
2. **`presiding_override` gets no default.** It becomes a named missing field instead — a guessed
   presiding name is a name nobody typed, printed and emailed to a ward. The bishopric is told what
   to confirm rather than having it filled in for them.

The original wording follows, kept because the reasoning is what a later reader needs.



`ward_conference` became a real Sunday type in migration 027. Phase 3 deliberately stopped at
the calendar's own behaviour — it displaces Fast Sunday, keeps a conductor, keeps speaking
slots, and leaves organization conducting alone. Two questions about it are **program**
decisions and belong here:

1. **How does a ward conference render on the program?** A stake presidency usually attends
   and the meeting is often structured differently from an ordinary Sunday. Does the program
   template change, or is it an ordinary program with a different heading?

2. **Should `presiding_override` default for it?** The stake president usually presides at a
   ward conference, so a default is tempting. Phase 3 deliberately did **not** prefill it: the
   bishopric can type it, and guessing a default in a Phase 3 file would have put a Phase 6
   product decision in the calendar's data layer. Decide it here, with the program in front of
   you — and note that whoever presides is not always whoever conducts, which is exactly what
   `presiding_override` exists to express.

Neither is blocking. A ward conference renders today as an ordinary Sunday with a badge.
