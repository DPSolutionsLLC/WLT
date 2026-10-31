---
id: zoom-self-registration
type: feature
iter: ITER-052
commits: []
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
- `decline_note` is readable by the clerk and executive secretary (by design of the SELECT policy;
  revisit with z3b's decline flow).
- SPEC.md and FEATURES.md never documented ITER-053's pool and invitees.
