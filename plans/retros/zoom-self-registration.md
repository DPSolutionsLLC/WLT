---
id: zoom-self-registration
type: feature
iter: ITER-052
commits: ["6b8006b"]
date: 2026-10-31
files:
  - supabase/migrations/096_zoom_self_registration.sql
  - supabase/migrations/097_zoom_question_follow_ups.sql
  - lib/zoom/registrations.ts
  - lib/zoom/registrationRow.ts
  - lib/zoom/registrationAnswers.ts
  - lib/zoom/registrationQuestions.ts
  - lib/zoom/registrationSettings.ts
  - lib/zoom/registrationLimits.ts
  - lib/zoom/registrationTokens.ts
  - lib/zoom/publicRegistration.ts
  - lib/zoom/access.ts
  - lib/zoom/zoomView.ts
  - lib/validation/zoomRegistration.ts
  - app/api/public/zoom-registrations/route.ts
  - app/api/zoom/registration-settings/route.ts
  - app/api/zoom/registration-questions/route.ts
  - app/public/[slug]/page.tsx
  - app/public/[slug]/RegistrationForm.tsx
  - app/public/[slug]/status/
  - app/(app)/zoom/RegistrationsPanel.tsx
  - app/(app)/zoom/RegistrationCard.tsx
  - app/(app)/zoom/RegistrationSettingsModal.tsx
  - app/(app)/zoom/RegistrationQuestionsModal.tsx
  - supabase/migrations/098_zoom_decline_note_bishopric_only.sql
  - lib/zoom/registrationApprovals.ts
  - lib/zoom/registrationMatch.ts
  - lib/todos/zoomLinks.ts
  - lib/todos/queries.ts
  - app/api/zoom/registrations/[id]/route.ts
  - app/api/zoom/registrations/[id]/match/route.ts
  - app/api/todos/[id]/route.ts
  - app/(app)/zoom/DeclineRegistrationModal.tsx
  - app/(app)/zoom/MatchRegistrationModal.tsx
  - app/(app)/todos/TodoCard.tsx
  - types/domain.ts
related: [zoom-link-pool-and-invitees, zoom-remote-links, program-c-public-pages, released-modules-per-ward]
---

## What was done
ITER-052 slice **z3a** only (z3b approvals and z3c emails remain). A public page at
`/public/[slug]` lets anyone ask for a stream link: name, phone, optional email, "are you a member",
and up to eight ward-chosen questions. Auto-approve hands out the next free link from ITER-053's
pool through `approve_zoom_registration()`, which creates an ordinary `zoom_invitees` row, so an
empty pool, the waiting state and the "Give ___ a Zoom link" to-do all reuse one mechanism. The
registrant keeps a private status page behind a 32-byte token; the bishopric, clerk and executive
secretary see a **Sign-ups** tab with settings, a QR/copy link and the question editor.

## Key decisions
- **One public write, through a route handler with the service role** — never an anon RPC, which
  could be called straight from the public key past every limit. Public reads are two narrow anon
  `security definer` functions. Only the token's SHA-256 is stored, hidden by a column grant, so
  `select("*")` on `zoom_registrations` is a 42501. No IP address is stored: a honeypot, 40
  sign-ups and 10 auto-approvals per rolling 24 hours, and a phone seen before is never auto-approved.
- **Follow-up questions (migration 097), added after the user's review of the walk:** the address
  is asked only after Yes to the missionaries, and is required then. Built as a generic
  `shown_when_yes_to` link (one level deep, parent must be yes/no — checked in app code because a
  CHECK cannot read another row). **`questionsFor()` is the one rule** for both the form and the
  submit route; an answer to an unasked follow-up is dropped, never stored.
- **`checkAnswers()` and the "Declined before" / "Same phone" flags live in their own pure files**
  (`registrationAnswers.ts`, `registrationRow.ts`) rather than in the plan's named modules, so the
  client form could import the rule without pulling in a server client. The planned settings GET
  route was not built — the page reads settings server-side.

## What broke while building
- **PostgREST cannot self-embed through a composite `(id, ward_id)` FK** — the referrer name embed
  failed at runtime. Replaced by a second `.in("id", …)` query (`readReferrerNames`).
- **"Same phone as an earlier request" flagged BOTH requests**, including the earlier one (found on
  the walk). A flag named "earlier" must compare `createdAt`; fixed and covered both ways.
- **A negative test was refused for the wrong reason**: the one-level-deep refusal used a
  short-answer parent, so the yes/no refusal fired first and the test passed without reaching its
  rule. Rewritten with a yes/no follow-up as the parent.
- **The Questions window at 375px** squeezed each prompt to one word per line beside its buttons;
  the walk's overflow check could not catch it because nothing overflowed. Fixed with a minimum
  basis on the text column.

## Follow-ups (not built)
- z3b (approvals, member matching) and z3c (emails, waits on ITER-039's sender address).
- A missionary-referral workflow for a Yes; the QR on the programme PDF; letting a registrant edit
  or withdraw; a bell notification for unseen pending sign-ups.
- The wrong-token status page's tab title still reads "Your stream link".
- The Zoom tab row scrolls inside itself at 375px, cutting off "Link pool".
- ~~`decline_note` is readable by the clerk and executive secretary~~ — closed by z3b (migration 098).
- SPEC.md and FEATURES.md never documented ITER-053's pool and invitees.

## z3b — bishopric approvals and roster matching (pending commit)

With approvals on, a request waits until **every serving bishopric member** approves; the last
approval runs `approve_zoom_registration()` and gives the next free link (or waits, with "Give ___ a
Zoom link" on the bishopric's To Do). **Let's talk first** shows only on the card; **Not this time**
declines on one member's word with an optional private note; **Finish approval** approves a request
left waiting on a released calling. A "member" sign-up puts **Match ___ to the roster** on every
bishopric list; the first match (or a decline) closes every copy.

### Key decisions
- **Unanimity is decided in SQL** (`respond_to_zoom_registration()`, 096), while "Waiting on" is
  **computed on read** against `listBishopricUsers()` (`waitingOnNames()`), so a released calling
  stops blocking with no write. `finish` records nothing and only re-runs the check.
- **Migration 098 revokes `decline_note` from `authenticated`.** The clerk and executive secretary
  read the same tab, so the note is read only by `readDeclineNotes()` with the service role after
  `canManageInvitees()`. The RLS suite asserts the 42501 for all three readers.
- **A match is allowed after approval** (the to-do outlives it, and the match carries onto the
  invitee); only a declined sign-up refuses it (409).
- **The decline sentence is one constant** (`DECLINED_STATUS_SENTENCE`) read by the status page and the
  decline window, so the window shows exactly what the person will see.

### What broke while building
- **The plan's audit flag `hasNote` would have been redacted** — `writeAuditLog()` blanks any key
  containing "note". Renamed `declinedWithMessage`, after music's `returnedWithMessage`.
- **`insertRow` in the seed helpers selects `id`**, which `zoom_registration_responses` does not have;
  the seed upserts on `(registration_id, user_id)` instead.

### Found on the walk (scenario 098, 2026-10-31)
- **Finish approval appeared unexplained** — the card read only "Approved by you, Owen Pryce". The user
  asked for an explanation: `waitingOnNames()` now returns a `finishReason` naming a released member
  who wanted to talk first, or saying the bishopric has changed. A button that appears because of
  something off-screen needs a sentence beside it.
- Step 7 of the checklist asked to *tick* a to-do that has no checkbox; corrected to remove + a direct
  route call.

### Follow-ups (not built)
- z3c: emails (waits on ITER-039's sender address). Music's own emails could delegate to the same
  sender helper then.
- Matching a moved-out member was not walked in the browser (route test covers the 400).

### Validation
Full suite 363 files / 5367 tests passed before the walk fix; `registrationApprovals.test.ts` 10/10
after it. Lint clean (5 old warnings elsewhere), typecheck and harness typecheck clean, production
build succeeded, migration 098 applied with `db:push`.
