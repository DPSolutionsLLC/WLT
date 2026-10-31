# Plan: Zoom self-registration with bishopric approval

**Created:** 2026-10-30
**Type:** feature
**Scope refs:** ITER-052

## Overview

A **public page**, reached by a QR code or a shared link, where anyone can ask for a link to watch
the sacrament meeting stream. They give a name, phone, optional email, say whether they are a
member of the ward, and answer a few questions the ward chooses. Once approved — automatically, or
by **every serving member of the bishopric** — they get a personal Zoom join link taken from the
**same link pool** the bishopric hands out on visits (ITER-053). The person only ever fills in the
app's form; there is no Zoom API.

The registrant keeps a **private status page** (a secret link). It shows "waiting", their link
once approved, or a neutral "not this time". Inside the app, a new **Registrations** tab on Zoom
lists the requests, carries the approvals, and holds the settings and the question list.

### Built in three slices, three commits

| Slice | What it delivers | Usable on its own? |
|---|---|---|
| **z3a** | Migration 096; settings, question editor, QR; the public form; the submit route; the status page; auto-approve; the Registrations tab (read + settings + questions) | Yes, with auto-approve on |
| **z3b** | Approve / Let's talk first / Not this time / Finish; member matching and its to-dos | Yes, with approvals on |
| **z3c** | Emails: bishopric on a new registration; registrant on submit, approval and denial | Sends nothing until ITER-039 sets `RESEND_FROM_ADDRESS` |

Run `/execute` once per slice (`/execute plans/zoom-self-registration.md` and say which slice), or
in one session if it goes smoothly. **Commit between slices.**

### Decisions settled with the user (2026-10-30, `/planning`)

| # | Decision |
|---|---|
| D1 | **"Let's talk first" shows on the request only.** No extra notification. The other two see "Bishop wants to talk first" on the card. |
| D2 | **A denied registrant sees a neutral note and may register again.** Their status page reads that the ward couldn't give them a link right now and suggests speaking with the bishop. No reason is shown. A new registration from the same phone arrives as a new pending request marked **"Declined before"** (computed on read). |
| D3 | **The member-match to-do goes to every serving bishopric member; the first match closes every copy** — the ITER-053 `closeWaitingLinkTodos` pattern. |
| D4 | **Everyone gets a placeholder link from the pool.** With auto-approve on they get it at once; with approvals on, only once approved — then it appears on their status page and is **emailed automatically** if they gave an address (z3c). |

### Decisions made in planning (flag at plan review if any is wrong)

| # | Decision | Why |
|---|---|---|
| P1 | **A registration is its own table (`zoom_registrations`), and approval creates an ordinary `zoom_invitees` row** with `source = 'self_registration'`. | Pending and declined people are not invitees and must never appear on the Invitees list. Once approved they ARE invitees, so the link, the waiting state, the to-do and ITER-054's attendance all reuse ITER-053's one mechanism. |
| P2 | **Approval needs every active bishopric calling in the ward**, read from `ward_role_assignments` at the moment of each response. A vacant position is simply absent. **Any one member can decline**, because approval is unanimous anyway. | Matches "every occupied position" without a separate positions list; bishop and counselors are equal (§7). |
| P3 | **Approval and link-giving are one SQL function** (`approve_zoom_registration`), called both by the last approval and by auto-approve. | supabase-js has no transactions; status, invitee row and link must land together or not at all. |
| P4 | **The public page lives at `/public/[slug]` as a third branch**, resolved by which function answers for the slug (program-c's "which view answers IS the page type"). The slug is a `public_pages` row with a new `page_type = 'zoom_registration'`. The status page is `/public/[slug]/status/[token]`. | One public shell, one slug namespace, no middleware change (`/public` is already public). |
| P5 | **Nothing under `app/public/` touches the service role.** Reads go through two `security definer` functions granted to `anon` that return narrow shapes. The **write** goes through `POST /api/public/zoom-registrations`, a route handler (not under `app/public/`) that validates, rate-limits and writes with the service role. | Keeps program-c's rule. A write RPC granted to anon would let anyone skip the route's limits by calling it directly with the public anon key. |
| P6 | **The status token is 32 random bytes; only its SHA-256 is stored.** The referral code is a separate short code, never the token. | A leaked database row cannot open anybody's status page; sharing a referral link can never share a person's own Zoom link. |
| P7 | **Abuse protection with no IP storage:** a hidden honeypot field; a **ward-wide cap of 40 registrations per rolling 24 hours** (beyond it: "lots of requests right now — please try again tomorrow"); an **auto-approve cap of 10 per rolling 24 hours** (beyond it the request is held as pending); and a **same-phone request is never auto-approved** (held, marked "Same phone as an earlier request"). The page can be switched off. | The pool is the scarce thing, and these protect it without a new secret or storing IP addresses (personal data). Rolling windows avoid any time-zone arithmetic. |
| P8 | **The ward's custom questions are rows with soft-off, never deleted.** Two kinds: yes/no and short text. Audience: everyone, members only, or non-members only. At most 8 active. Answers are stored as a **snapshot** (prompt + answer) on the registration, so editing a question never rewrites an old answer. | Never destroy what somebody wrote (decisions.md §1.1/1.2). |
| P9 | **"Would you welcome a visit from the missionaries?" is a default question** (yes/no, non-members), created when registration is first set up. It can be edited or turned off like any other. **The prototype's referral workflow** (new → sent to missionaries → visit arranged, member to accompany) **is not built here.** The answer shows on the registration card. | Reconciles the overlap the scope named, without building a second workflow nobody asked for yet. Recorded as a follow-up. |
| P10 | **Pending requests reach the bishopric through the Registrations tab** (with a count on the tab) **and email** (z3c). No bell notification and no per-request to-do. | Three to-dos per request would flood To Do; the email plus the count is enough, and no fifth copy of the trigger list is needed. Revisit if pending requests get missed. |
| P11 | **The QR is shown and downloadable on the Registrations settings window**, for the bishopric to put on whatever they print. **It is not added to the app's bifold programme PDF.** | The programme PDF's back panel already holds a QR and needs a physical fold check; the bishopric's programme now comes out of the Planner. A follow-up if wanted. |
| P12 | **Permissions:** approving, flagging, declining, matching and the settings use the existing `zoom.manage_invitees` + bishopric calling (`canManageInvitees()`). Editing questions is a **new `zoom.manage_registration_questions`** held by the bishopric, the ward clerk and the executive secretary, non-overridable, mirrored by `canManageRegistrationQuestions()`. Reading the tab follows `canViewInvitees()`. | The scope's table: bishopric does everything; clerk and executive secretary edit questions and read the rest. |
| P13 | **A sharer can be anyone holding a status page** (an approved, pending or declined registrant). `?ref=` carries their referral code; an unknown code simply records no referrer. Invitees added on visits have no status page and no referral code in this slice. | The scope's last open question, answered as assumed and stated to the user. |
| P14 | **Emails carry no phone numbers or answers.** The bishopric email says a name and "open Zoom → Registrations". | Email is not a private channel. |
| P15 | **The registrant can't edit or withdraw a request** in this slice. | Keeps the public surface to one write. |
| P16 | **Added walking scenario 097 (2026-10-30, migration 097): a question can be a FOLLOW-UP to a yes/no question**, asked only after Yes. New pages start with "What's your address?" (short answer, required) under the missionary question. The user's words: "we don't need it unless they want to meet with the missionaries". Built generically (a `shown_when_yes_to` link) rather than as a fixed address field, because wards can rename or turn off the missionary question. One level deep; required only while shown; an answer to an unasked follow-up is not stored. | Asks for an address only from the people who need to give one. |

### Success criteria

- A person scanning the QR fills the form on a phone and lands on their own status page.
- With **auto-approve on**, the status page shows their personal join link at once (or "approved —
  your link is on its way" when the pool is empty, with a "Give ___ a Zoom link" to-do on every
  bishopric member's list).
- With **approvals on**, the request waits until the bishop and both counselors (whoever is
  serving) approve; "Let's talk first" and "Not this time" behave as D1/D2; the last approval puts
  the link on the status page.
- "Yes, I'm a member" puts "Match ___ to the roster" on each bishopric member's To Do; matching on
  the card closes every copy and records the member on the registration and its invitee.
- A shared link records who referred them.
- No `join_url`, phone, email or answer ever reaches an audit row, a log line or the bishopric
  email.

## Relevant Files

### Slice z3a
- `supabase/migrations/096_zoom_self_registration.sql` — create — tables, policies, grants, functions (Task 1)
- `types/database.ts` — modify — regenerate after `db:push` (`npm run db:types`)
- `types/domain.ts` — modify — `ZOOM_INVITEE_SOURCES` gains `self_registration`; registration types and enums
- `lib/auth/permissions.ts` — modify — new `zoom.manage_registration_questions` (bishopric, ward secretary, executive secretary; non-overridable)
- `lib/access/accessModules.ts` — modify only if its import-time check demands the new permission be placed (it asserts coverage — read it first)
- `lib/access/releasedModules.ts` — modify — the zoom module's `tables` gains the three new tables
- `lib/zoom/access.ts` — modify — `canManageRegistrationQuestions()`
- `lib/audit/writeAuditLog.ts` — modify — `userId: string | null` (null = a member of the public)
- `lib/validation/zoomRegistration.ts` — create — Zod schemas for the public form, settings and questions
- `lib/zoom/registrationTokens.ts` — create — status token, its hash, referral code
- `lib/zoom/registrationSettings.ts` — create — read/set up/update settings, ensure the slug
- `lib/zoom/registrationQuestions.ts` — create — list, add, edit, turn off/on, reorder
- `lib/zoom/registrations.ts` — create — submit, list, read, the flags computed on read
- `lib/zoom/registrationLimits.ts` — create — the pure cap decisions (P7)
- `lib/zoom/registrationRow.ts` — create — pure wording for a registration card
- `lib/zoom/publicRegistration.ts` — create — anon reads for the public pages (the two RPCs)
- `lib/zoom/registrationQr.ts` — create — or reuse `joinLinkQrDataUri` directly if its name can stay honest; prefer reusing it (see Task 9)
- `lib/zoom/zoomView.ts` — modify — tab `registrations`
- `app/api/public/zoom-registrations/route.ts` — create — the public submit
- `app/api/zoom/registration-settings/route.ts` — create — GET/PUT settings, POST set up
- `app/api/zoom/registration-questions/route.ts` — create — POST add
- `app/api/zoom/registration-questions/[id]/route.ts` — create — PATCH edit / turn off / move
- `app/public/[slug]/page.tsx` — modify — third branch: the registration form
- `app/public/[slug]/RegistrationForm.tsx` — create — client form
- `app/public/[slug]/status/[token]/page.tsx` — create — the status page
- `app/public/[slug]/status/[token]/StatusPanel.tsx` — create — copy, share, add-to-home-screen
- `app/public/layout.tsx` — modify — metadata: generic title/description (it says "Sacrament Meeting"/"program" today); keep `noindex`
- `app/(app)/zoom/page.tsx` — modify — load registrations, settings, questions
- `app/(app)/zoom/ZoomTabs.tsx` — modify — the Registrations tab
- `app/(app)/zoom/RegistrationsPanel.tsx` — create — list + Settings / Questions buttons
- `app/(app)/zoom/RegistrationCard.tsx` — create
- `app/(app)/zoom/RegistrationSettingsModal.tsx` — create — switches, link, QR, download
- `app/(app)/zoom/RegistrationQuestionsModal.tsx` — create
- Tests (see Testing Strategy)
- `testing/scenarios/zoom/scenario-097-zoom-self-registration/` — create
- `.env.example` (if present) — no new variable needed

### Slice z3b
- `supabase/migrations/098_zoom_decline_note_bishopric_only.sql` — create — hide `decline_note` from `authenticated` (addendum A1)
- `types/database.ts` — regenerate after 098 (`npm run db:types`)
- `tests/rls/zoom-registrations.test.ts` — modify — the bishop no longer reads `decline_note` by name; the clerk and executive secretary are refused it (addendum A1)
- `lib/zoom/registrationApprovals.ts` — create — respond, finish, decline, who-is-still-waiting
- `lib/zoom/registrationMatch.ts` — create — match to a roster member
- `lib/todos/zoomLinks.ts` — modify — match to-do create/close; waiting-link to-dos for every bishopric member
- `lib/todos/queries.ts` — modify — `zoomRegistrationLink` mapping, tick and delete refusals
- `lib/todos/logLines.ts` — modify only if the new close line needs its own wording (it shows the body since ITER-053)
- `types/domain.ts` — modify — `Todo.zoomRegistrationLink`
- `app/(app)/todos/TodoCard.tsx` — modify — the match to-do's source line and no checkbox
- `app/api/zoom/registrations/[id]/route.ts` — create — PATCH `{ action: approve | talk_first | decline | finish }`
- `app/api/zoom/registrations/[id]/match/route.ts` — create — POST `{ memberId }`
- `app/(app)/zoom/RegistrationCard.tsx` — modify — the buttons and approval line
- `app/(app)/zoom/DeclineRegistrationModal.tsx` — create
- `app/(app)/zoom/MatchRegistrationModal.tsx` — create — reuses `MemberPicker`
- `testing/scenarios/zoom/scenario-098-zoom-registration-approvals/` — create

### Slice z3c
- `lib/email/sendTextEmails.ts` — create — a generic "send this text email to these addresses" (see Task 22)
- `lib/email/zoomRegistrationEmails.ts` — create — the four messages
- `app/api/public/zoom-registrations/route.ts`, `app/api/zoom/registrations/[id]/route.ts` — modify — send after the write
- `app/(app)/zoom/RegistrationSettingsModal.tsx` — modify — "Email the bishopric about each new request" switch becomes live and says when email is not set up

### Docs (in the slice that changes the behaviour)
- `SPEC.md`, `FEATURES.md` — Zoom section
- `CLAUDE.md` §9 — a new entry (Task 26)
- `plans/prototype/module-map.md` — Zoom row and §6 tab list
- `plans/P10-message-and-zoom.md` — "Built" note
- `.iterate/scopes/ITER-052.md`, `.iterate/BACKLOG.md` — via `/commit`

## Dependencies

- **No new libraries.** `qrcode` (already used), Node `crypto`, Zod, Resend client (z3c).
- **No new environment variables.** z3c uses `RESEND_API_KEY` / `RESEND_FROM_ADDRESS`, which
  ITER-039 sets; until then `emailConfiguration()` reports "not configured" and nothing is sent.
- `resolveSiteUrl()` (`lib/program/queries.ts`) builds every absolute link (QR, share, emails).
  When it returns null, the QR and share link show a sentence instead of a localhost URL.
- ITER-053's pool: `assign_next_zoom_link()`, `createWaitingLinkTodo()`, `closeWaitingLinkTodos()`,
  `readJoinUrl()`, `joinLinkQrDataUri()`, `normalizePhone()`.
- `listBishopricUsers()` (`lib/calendar/queries.ts`) — who must approve and who gets to-dos.
- `MemberPicker` — unchanged interface (ITER-053 kept it frozen; read name/phone from its cache
  entry the same way `InviteeFields` does if needed).

## Known Pitfalls (from retro context)

- **zoom-link-pool-and-invitees** — `select("*")` on `zoom_join_links` through a user client is a
  42501 (column grant). Name columns. The join URL leaves the server only in the status RPC
  (behind a token) and ITER-053's two routes; **never** an audit row or log line. Audit the write
  that DID happen even when a later step fails (z2b/z2c's rule 6 finding).
- **zoom-link-pool-and-invitees** — a `source_completed` line shows its body; write a body that
  reads right ("They were matched to the roster.").
- **zoom-link-pool-and-invitees** — Bash heredocs with apostrophes fail on this machine; use
  Write/Edit for file content.
- **program-c-public-pages** — **one 404 for every way of not existing** (unknown slug, inactive,
  wrong type). A database error throws (500), never a 404. **Check `document.cookie` is empty**
  before believing anything about a public page in a walk. **A dropped/recreated function loses
  its grants** — verify the anon grants by calling through the anon key after `db:push`.
- **program-c-public-pages** — a PostgREST bulk insert nulls keys missing from some rows; seed
  rows with identical keys.
- **program-c-public-pages** — `revalidate` is not applied by `next dev`. The status page must be
  dynamic (no caching) — it changes on approval and is per-person.
- **zoom-remote-links** — adding a module key or table can break a test that borrowed a name;
  `tests/db/module-release-policies.test.ts` requires the restrictive policy on every new table
  in the catalog. The hosted auth rate limit fails route files in a full run; re-run them alone.
- **released-modules-per-ward** — the public page must also refuse when the ward has not released
  Zoom. RLS's `ward_module_released()` reads the session, which anon has none of, so the RPCs read
  `ward_release_settings` directly (no row = everything released).
- **CLAUDE.md §9 "public pages leak surface"** — every field on a public page is a privacy
  decision. The form page shows the ward name and the questions; nothing else from the ward. The
  status page shows only the registrant's own name and link.
- **060-D2** — a policy with WITH CHECK needs both halves mirrored; these tables have **no write
  policy at all**, so this does not arise — do not add one "for convenience".
- **Negative-path test data must pass every earlier check** (global rule): e.g. the over-cap test
  must submit otherwise valid bodies, or it is refused by validation and proves nothing.

## Tasks

---

### SLICE z3a — the public form, settings and auto-approve

### Task 1: Migration 096
**File:** `supabase/migrations/096_zoom_self_registration.sql` (create)
**Action:** Write the schema with a long header comment in the style of 095 (why each choice).
**Details:**

**096a. `public_pages.page_type`** — widen the CHECK to `('sacrament_assignments', 'program',
'zoom_registration')`. Find the constraint's real name first (`007_programs.sql`, line 29 — it is
an inline check, so it is named `public_pages_page_type_check`; confirm with
`select conname from pg_constraint where conrelid = 'public_pages'::regclass`). Drop and re-add.
Confirm `public_program`'s view filters `page_type = 'program'` so a new type cannot leak into it.

**096b. `zoom_registration_settings`** — one row per ward:
```
ward_id                 uuid primary key references wards(id) on delete cascade
is_open                 boolean not null default false
auto_approve            boolean not null default false
email_bishopric_on_new  boolean not null default true
updated_by              uuid references users(id) on delete set null
updated_at              timestamptz not null default now()
created_at              timestamptz not null default now()
```
`email_bishopric_on_new` only matters when auto-approve is on; with approvals on the bishopric is
always emailed (scope).

**096c. `zoom_registration_questions`**:
```
id          uuid pk default gen_random_uuid()
ward_id     uuid not null references wards(id) on delete cascade
prompt      text not null check (length(btrim(prompt)) between 1 and 200)
kind        text not null check (kind in ('yes_no', 'short_text'))
audience    text not null check (audience in ('everyone', 'members', 'non_members'))
is_required boolean not null default false
position    integer not null
is_active   boolean not null default true
created_by  uuid references users(id) on delete set null
created_at, updated_at timestamptz not null default now()
unique (id, ward_id)
```
Index `(ward_id, position)`. No delete path anywhere (P8).

**096d. `zoom_registrations`**:
```
id                           uuid pk default gen_random_uuid()
ward_id                      uuid not null references wards(id) on delete cascade
display_name                 text not null check (length(btrim(display_name)) between 1 and 120)
phone                        text not null check (char_length(phone) between 7 and 40)
phone_digits                 text not null check (phone_digits ~ '^[0-9]{7,20}$')  -- for same-phone checks
email                        text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254))
says_member                  boolean not null
answers                      jsonb not null default '[]'::jsonb   -- [{questionId, prompt, kind, answer}]
status                       text not null default 'pending' check (status in ('pending','approved','declined'))
held_reason                  text check (held_reason is null or held_reason in ('approvals_on','daily_limit','same_phone'))
status_token_hash            text not null unique check (status_token_hash ~ '^[0-9a-f]{64}$')
referral_code                text not null unique check (referral_code ~ '^[A-Za-z0-9]{10}$')
referred_by_registration_id  uuid
member_id                    uuid
matched_by                   uuid references users(id) on delete set null
matched_at                   timestamptz
decided_by                   uuid references users(id) on delete set null   -- null when auto-approved
decided_at                   timestamptz
decline_note                 text check (decline_note is null or length(decline_note) <= 500)  -- bishopric-only, never shown to the registrant
invitee_id                   uuid unique
created_at, updated_at       timestamptz not null default now()
unique (id, ward_id)
constraint zoom_registrations_decided check ((status = 'pending') = (decided_at is null))
constraint zoom_registrations_invitee check (invitee_id is null or status = 'approved')
foreign key (member_id, ward_id) references members(id, ward_id) on delete set null (member_id)
foreign key (referred_by_registration_id, ward_id) references zoom_registrations(id, ward_id) on delete set null (referred_by_registration_id)
foreign key (invitee_id, ward_id) references zoom_invitees(id, ward_id)
```
`zoom_invitees` has no `unique (id, ward_id)` today — add it in this migration (095 only made
`zoom_join_links` composite-referenceable). Indexes: `(ward_id, created_at desc)`,
`(ward_id, phone_digits)`, `(ward_id, status)`.

Note the column named `decline_note`: `writeAuditLog()` redacts any detail key containing "note",
which is fine because it must never be audited anyway — the audit carries `hasNote: true` only.

**096e. `zoom_registration_responses`** (z3b uses it; created now so z3b needs no migration):
```
registration_id uuid not null
ward_id         uuid not null
user_id         uuid not null references users(id) on delete cascade
response        text not null check (response in ('approve','talk_first'))
responded_at    timestamptz not null default now()
primary key (registration_id, user_id)
foreign key (registration_id, ward_id) references zoom_registrations(id, ward_id) on delete cascade
```
User FKs are single-column (ward-callings-model, migration 069).

**096f. `zoom_invitees`** — widen `source` to `('visit', 'self_registration')`. Do not add a
`registration_id` column on invitees — the link lives on `zoom_registrations.invitee_id` (one
direction, one source of truth).

**096g. `todos.zoom_registration_id`** (z3b) — `uuid references zoom_registrations(id) on delete set null`,
unique partial index `todos_one_open_zoom_registration_todo_per_owner on todos (zoom_registration_id, user_id) where zoom_registration_id is not null and completed_at is null`,
and a plain partial index on `zoom_registration_id`.

**Policies (SELECT only, no write policy on any new table — 095's shape):**
- `zoom_registration_settings`, `zoom_registration_questions`, `zoom_registrations`,
  `zoom_registration_responses`: `for select to authenticated using (ward_id = current_ward_id() and (is_bishopric() or current_user_role() in ('ward_secretary','executive_secretary')))`.
- **Restrictive** `…_module_released` policy on all four, exactly as 095.
- `revoke all … from anon` on all four tables.
- **`status_token_hash` is hidden from `authenticated` by a column grant**, as `join_url` is:
  `revoke select on zoom_registrations from authenticated; grant select (every column except status_token_hash) …`.
  Comment that `select("*")` on `zoom_registrations` is a 42501.

**Functions (all `security definer`, `set search_path = public, extensions, pg_temp`):**

1. `zoom_registration_form(p_slug text)` → returns one row or none:
   `ward_name text, is_open boolean, questions jsonb` (active questions ordered by position:
   `id, prompt, kind, audience, is_required`). Answers only when `public_pages` has an active row
   with that slug and `page_type = 'zoom_registration'`. `is_open` is false when the settings row is
   closed **or** the ward has not released `zoom` (read `ward_release_settings` directly: no row =
   released; a row = `'zoom' = any(released_modules)`). **Grant execute to `anon` and
   `authenticated`.**

2. `zoom_registration_status(p_token text)` → one row or none:
   `slug text, ward_name text, display_name text, status text, link_given boolean, join_url text, referral_code text`.
   Looks up by `encode(extensions.digest(p_token, 'sha256'), 'hex')`. `join_url` is non-null only
   when `status = 'approved'` and the invitee has a link. Never returns phone, email, answers,
   notes or anybody else's data. **Grant execute to `anon` and `authenticated`.** Reject tokens
   that are not 43 base64url characters before hashing (return no row).

3. `approve_zoom_registration(p_ward_id uuid, p_registration_id uuid, p_decided_by uuid)` →
   `table (invitee_id uuid, join_link_id uuid)`. In one transaction: lock the registration
   `for update`; if not `pending` return no row; insert the `zoom_invitees` row
   (`source = 'self_registration'`, `display_name`, `phone`, `email`, `member_id`,
   `assigned_by = p_decided_by` — null when auto); set the registration `approved`, `decided_by`,
   `decided_at`, `invitee_id`, `held_reason = null`; then call `assign_next_zoom_link(p_ward_id, new_invitee_id)`
   and return both ids (link id null = pool empty). **Service role only.**

4. `respond_to_zoom_registration(p_ward_id uuid, p_registration_id uuid, p_user_id uuid, p_response text)`
   (z3b) → `table (status text, invitee_id uuid, join_link_id uuid, waiting_on uuid[])`.
   `p_response in ('approve','talk_first','finish')`. Lock the registration `for update`; must be
   `pending`. For `approve`/`talk_first`, upsert the response row. Then compute
   `required = active bishopric callings in the ward on active accounts`
   (`ward_role_assignments.role in ('bishop','counselor') and is_active` joined to `users.is_active`);
   `waiting_on = required minus users whose response is 'approve'`. If `waiting_on` is empty **and**
   at least one approval exists, call `approve_zoom_registration(…, p_user_id)`. `finish` writes no
   response — it only re-runs the check (for when a calling was released while pending).
   **Service role only.** The route has already checked `canManageInvitees()`, so `p_user_id` is a
   bishopric member of this ward.

Grant/revoke exactly as 095: `revoke all … from public, anon, authenticated` then grant to the
right role. After `db:push`, **call the two anon functions with the anon key** to prove the grant
(program-c pitfall).

Leave `types/database.ts` regeneration to Task 2.

### Task 2: Apply and regenerate types
- `npx supabase db push --linked --dry-run`, then `npm run db:push` (may need a retry on timeout).
- `npm run db:types`.
- `tests/db/migrations.test.ts` — check whether it needs this migration listed anywhere; it is not
  held back (nothing in the deployed build selects a dropped column).

### Task 3: Domain types, permission and module catalog
**Files:** `types/domain.ts`, `lib/auth/permissions.ts`, `lib/access/releasedModules.ts`,
`lib/access/accessModules.ts` (only if required), `lib/zoom/access.ts` (modify)
**Details:**
- `ZOOM_INVITEE_SOURCES = ["visit", "self_registration"]` (its comment names migration 095b — update it to 096f).
- Add `ZOOM_REGISTRATION_STATUSES`, `ZOOM_REGISTRATION_HELD_REASONS`,
  `ZOOM_REGISTRATION_QUESTION_KINDS`, `ZOOM_REGISTRATION_QUESTION_AUDIENCES` as `as const` arrays
  with derived types, mirroring the CHECKs.
- `lib/auth/permissions.ts`: add `"zoom.manage_registration_questions"` to `PERMISSIONS`, to the
  bishopric's list (wherever `zoom.manage_invitees` is granted), to `WARD_SECRETARY` and
  `EXECUTIVE_SECRETARY` lists (beside their `zoom.view`), and to `NON_OVERRIDABLE_PERMISSIONS`
  with a comment line in the existing comment block. Run `tests/lib/permissions.test.ts` — it
  asserts the matrix; update the expected rows deliberately.
- `lib/access/releasedModules.ts`: zoom module `tables` gains `zoom_registration_settings`,
  `zoom_registration_questions`, `zoom_registrations`, `zoom_registration_responses`; update the
  description ("…, who holds a link, and public sign-ups.").
- `lib/zoom/access.ts`: `canManageRegistrationQuestions(user, roleAccess)` =
  `can(user, "zoom.manage_registration_questions", roleAccess) && INVITEE_READER_ROLES.includes(user.role)`
  (the super-admin bypass is why the calling check is needed).

### Task 4: Audit rows with no user
**File:** `lib/audit/writeAuditLog.ts` (modify)
**Details:** `WriteAuditLogParams.userId: string | null`. `audit_log.user_id` is already nullable
(migration 015). Document in a short comment: null means the action came from a member of the
public (or the system, e.g. auto-approve). Every existing caller passes a string, so nothing else
changes. The public route passes the **service client** (no session to satisfy an insert policy) —
check `writeAuditLog`'s client parameter accepts it.

### Task 5: Validation
**File:** `lib/validation/zoomRegistration.ts` (create)
**Details:** Reuse the field builders' behaviour from `lib/validation/zoom.ts` (empty → null, never
""; phone via `normalizePhone`; lower-cased email). If reusing means exporting
`inviteeDisplayName`/`inviteePhone`/`inviteeEmail` from `lib/validation/zoom.ts`, export them rather
than copying them.
- `publicRegistrationSchema`: `slug` (1–100), `displayName`, `phone` (**required** here),
  `email` (optional), `saysMember` (boolean, required: "Tell us whether you're a member of the ward."),
  `answers` (array ≤ 8 of `{ questionId: uuid, answer: string | boolean }`; short text ≤ 500),
  `ref` (optional, `^[A-Za-z0-9]{10}$`, invalid → treated as absent, not an error), `website`
  (the honeypot: optional string; any non-empty value is a bot).
- `registrationSettingsSchema`: `isOpen?`, `autoApprove?`, `emailBishopricOnNew?` — at least one.
- `createQuestionSchema`: `prompt` (1–200), `kind`, `audience`, `isRequired`.
- `updateQuestionSchema`: any of `prompt`, `audience`, `isRequired`, `isActive`, `move: 'up' | 'down'`;
  `kind` is **not** editable once created (old answers were given to that kind).
- Server-side answer checks live in `lib/zoom/registrations.ts` (Task 8), not the schema, because
  they need the ward's live questions.

### Task 6: Tokens and codes
**File:** `lib/zoom/registrationTokens.ts` (create; server-only `typeof window` guard as
`lib/email/resend.ts` has)
- `createStatusToken(): { token: string; hash: string }` — `randomBytes(32).toString("base64url")`
  (43 chars) and `createHash("sha256").update(token).digest("hex")`.
- `createReferralCode(): string` — 10 characters from `[A-Za-z0-9]` using `randomInt`.
- `statusPageUrl(siteUrl, slug, token)` and `registrationPageUrl(siteUrl, slug, referralCode?)` —
  pure; return null when `siteUrl` is null.
- **Never log a token.** Unit-test the hash matches the SQL digest (one shared fixture).

### Task 7: Settings and questions
**Files:** `lib/zoom/registrationSettings.ts`, `lib/zoom/registrationQuestions.ts` (create)
- `readRegistrationSettings(supabase)` — through the caller's client (RLS reads it) → settings or
  null (not set up yet). Also read the slug from `public_pages` — **`public_pages` may not be
  readable by these roles**; check its SELECT policy. If not, read slug with the service role behind
  `canViewInvitees()` in the page and say so in a comment.
- `setUpRegistration({ wardId, actorUserId }, service)` — idempotent: insert the settings row
  (`on conflict do nothing`), ensure one active `public_pages` row of type `zoom_registration` with a
  slug `zoom-` + 16 hex chars (`generateProgramSlug()`'s pattern), and insert the default
  missionary question (P9) **only if the ward has no questions yet**. Returns settings + slug.
- `updateRegistrationSettings(...)` — service role; returns the changed field names for the audit.
- Questions: `listQuestions(supabase, { includeInactive })`, `addQuestion` (position = max + 1;
  refuse a 9th active question with a sentence naming "turn one off first"), `updateQuestion`
  (`move` swaps positions with the neighbour among **active** questions; turning on a 9th is
  refused the same way). All writes service role, all filter `ward_id`.

### Task 8: Submitting a registration
**Files:** `lib/zoom/registrationLimits.ts`, `lib/zoom/registrations.ts` (create)
- `registrationLimits.ts` (pure, unit-tested):
  `WARD_DAILY_REGISTRATION_LIMIT = 40`, `AUTO_APPROVE_DAILY_LIMIT = 10`.
  `decideIntake({ recentCount, recentAutoApprovedCount, autoApprove, samePhoneExists })` →
  `{ kind: 'refuse_busy' } | { kind: 'pending', heldReason } | { kind: 'auto_approve' }`.
  Order: busy first; approvals on → `approvals_on`; same phone → `same_phone`; auto cap →
  `daily_limit`; else auto-approve.
- `checkAnswers(questions, saysMember, answers)` (pure): drop answers to questions not shown to
  this audience; refuse a missing required answer ("Please answer: <prompt>"); refuse a wrong type;
  return the **snapshot** array `{ questionId, prompt, kind, answer }` in question order.
- `submitRegistration(input, service)`:
  1. Resolve slug → ward with the service role: `public_pages` active, type `zoom_registration`.
     Unknown/closed → a `RegistrationClosedError` (the route answers 404 with one generic
     sentence for every way of not existing).
  2. Read settings (`is_open`) and release state; closed → same error.
  3. Honeypot filled → **pretend success**: return a fake-looking result without writing (the
     route answers exactly as a real success but with no status URL that works — simplest: answer
     201 with `{ statusUrl: null, message }` and the form shows the same "thanks" text). Log one
     `console.warn` without any field values.
  4. Counts in the last 24h for this ward: registrations; auto-approved (`decided_by is null and status = 'approved'`);
     whether `phone_digits` matches an existing registration in any state.
  5. `decideIntake` → refuse / pending / auto.
  6. Referral: look up `ref` → registration id in this ward, else null.
  7. Insert the row (token hash, referral code — retry once on a 23505 for either unique).
  8. If auto: `rpc('approve_zoom_registration', { p_decided_by: null })`; if it returns no link,
     create a waiting-link to-do for **every** bishopric member (`listBishopricUsers(wardId, service)`,
     `createWaitingLinkTodo` per owner). A failure after the insert throws an error that carries the
     registration id so the route still audits the insert (rule 6).
  9. Return `{ registrationId, token, slug, status, linkGiven }`.
- `listRegistrations(supabase)` — caller's client, **named columns** (never the token hash),
  embeds the matched member's name, the referrer's display name, the responses with responder names.
  Returns newest first.
- Flags computed on read (pure, unit-tested, `describeRegistrationFlags(registration, all)`):
  `declinedBefore` (another registration with the same `phone_digits` is declined),
  `samePhoneAs` (the earliest other one, if any), `heldReason` from the column.

### Task 9: The public submit route
**File:** `app/api/public/zoom-registrations/route.ts` (create)
**Details:** No session. `readJsonBody` → `publicRegistrationSchema.parse` →
`submitRegistration(…, createServiceSupabaseClient())`.
- Answers: `201 { statusUrl }` (built from `resolveSiteUrl()`; when null, return the path
  `/public/<slug>/status/<token>` and let the browser navigate relatively — the page is same-origin),
  `404 { error: "This sign-up page isn't available." }` for every way of not existing,
  `429 { error: "Lots of people are signing up right now. Please try again tomorrow." }` for busy,
  `400` with the Zod sentence for invalid input (via `respondToRouteError`).
- Audit `zoom_registration_submitted` with `userId: null`, detail `{ registrationId, saysMember,
  autoApproved, heldReason, linkGiven, referred: boolean }` — **no name, phone, email, answers,
  token or referral code.** Audit `zoom_registration_auto_approved` is folded into the same row
  (`autoApproved: true`).
- `export const dynamic = "force-dynamic"`. Never log the body.
- Read `lib/auth/routeErrors.ts` first: `respondToRouteError` must not turn a 404/429 into a 500.

### Task 10: Anon reads for the public pages
**File:** `lib/zoom/publicRegistration.ts` (create)
- Uses **only** `createAnonSupabaseClient()` and accepts no client argument (the
  `lib/program/publicQueries.ts` rule, with its header comment adapted).
- `getRegistrationForm(slug)` → `{ wardName, isOpen, questions }` or null. Parse the jsonb with Zod.
- `getRegistrationStatus(token)` → `{ slug, wardName, displayName, status, linkGiven, joinUrl, referralCode }` or null.
- An RPC **error** throws (500); "no row" returns null (404). program-c's rule.

### Task 11: The public form page
**Files:** `app/public/[slug]/page.tsx` (modify), `app/public/[slug]/RegistrationForm.tsx` (create),
`app/public/layout.tsx` (modify)
- In the page: after the program branch and before the assignments branch, `getRegistrationForm(slug)`;
  if it answers, render the form (or, when `isOpen` is false, a "Sign-ups for the stream are closed
  right now. Please speak with a member of the bishopric." panel — an honest answer for a QR
  already printed, like `NotAvailableYet`). Keep `revalidate = 300` for the program branch; the
  form's config being up to 5 minutes stale is acceptable — **but** a "closed" page must not hide a
  reopen for long: call `revalidatePath(`/public/${slug}`)` from the settings route on every change.
- `RegistrationForm` (client): heading "Watch {wardName} sacrament meeting", one sentence saying
  what the information is for ("The bishopric uses this to send you a personal link to the
  stream. We don't share it."), fields name / phone / email (optional), the member question as two
  large buttons (Yes / No), then the questions for that audience (yes/no as two buttons, short
  text as an input), the visually hidden honeypot `website` input (`tabIndex={-1}`,
  `autoComplete="off"`, `aria-hidden`), and Submit. Read `ref` with `useSearchParams()` (wrap in
  `<Suspense>` as Next requires). On 201, `window.location.assign(statusUrl)`; on error show the
  route's sentence. Mobile-first, 375px, both themes, 44px targets, labels on every input.
- `layout.tsx` metadata: title "Ward" → keep it generic (e.g. `"Ward page"`) and description
  generic, because the shell now serves two kinds of page. **Keep `robots: noindex`.** Each page may
  set its own `title` via `generateMetadata` **without any query** (static strings).

### Task 12: The status page
**Files:** `app/public/[slug]/status/[token]/page.tsx`, `StatusPanel.tsx` (create)
- `export const dynamic = "force-dynamic"`; also `headers: Referrer-Policy: no-referrer` via
  `metadata.referrer = "no-referrer"` so the token never leaves in a Referer header when they tap
  the Zoom link.
- `getRegistrationStatus(token)`; null or a slug that doesn't match the URL's slug → `notFound()`.
- States:
  - **pending**: "Thanks, {name}. Your request is with the bishopric. Keep this page — your link
    will appear here." + Share with a friend.
  - **approved, link given**: a large **Join the stream** button (`href={joinUrl}`), **Copy link**,
    "Add this page to your home screen" instructions (iPhone: Share → Add to Home Screen; Android:
    ⋮ → Add to Home screen), and Share with a friend. Say plainly: "This link is just for you —
    please don't share it. Use Share with a friend instead."
  - **approved, no link yet** (pool empty): "You're approved. Your link is on its way — check back
    here."
  - **declined** (D2): "We weren't able to give you a stream link right now. Please speak with the
    bishop." No reason. No share button.
- **Share with a friend** shares `registrationPageUrl(site, slug, referralCode)` — never the status
  URL or the join URL. `navigator.share` with a copy-to-clipboard fallback; reuse the pattern in
  `app/(app)/zoom/LinkHandoff.tsx` if it fits without changing its interface.
- No polling. A "Check again" button reloads the page.

### Task 13: Settings, questions and QR routes
**Files:** `app/api/zoom/registration-settings/route.ts`, `app/api/zoom/registration-questions/route.ts`,
`app/api/zoom/registration-questions/[id]/route.ts` (create)
- Settings: `POST` = set up (idempotent), `PUT` = update. Both `canManageInvitees()`; service role
  write; audit `zoom_registration_settings_changed` with `changedFields` (names only) or
  `zoom_registration_set_up`; `revalidatePath` the slug. Return the settings, slug and the
  absolute registration URL (or null with a sentence when `resolveSiteUrl()` is null).
- Questions: `canManageRegistrationQuestions()`; audit `zoom_registration_question_added` /
  `_changed` with `{ questionId, changedFields }` — **not the prompt text** (it is ward wording,
  harmless, but keep audit rows to ids and field names like ITER-053's D3).
- The QR: built **in the browser** in the settings window with `joinLinkQrDataUri()` from
  `lib/zoom/joinLinkQr.ts` — rename nothing; if its name reads wrongly for a non-join URL, add a
  one-line generic export `urlQrDataUri` in the same file and have `joinLinkQrDataUri` call it.
  "Download QR" saves the PNG data URI (`<a download="zoom-sign-up-qr.png">`).

### Task 14: The Registrations tab (read, settings, questions)
**Files:** `lib/zoom/zoomView.ts`, `app/(app)/zoom/page.tsx`, `ZoomTabs.tsx` (modify);
`RegistrationsPanel.tsx`, `RegistrationCard.tsx`, `RegistrationSettingsModal.tsx`,
`RegistrationQuestionsModal.tsx`, `lib/zoom/registrationRow.ts` (create)
**Before building, open the prototype's Zoom component in `prototype/WLT.jsx`** (search
`ZoomPage` / `recipients`) and module-map §6's Zoom line, per CLAUDE.md §12 step 1b. It is a
sub-view machine with tabs. Follow the compact-UI memory: results-only list, small grouped
buttons per item opening windows.
- Tab key `registrations`, label **Sign-ups**, visible when `canViewInvitees()`; place it after
  `invitees`. The tab label carries the pending count ("Sign-ups · 3") when > 0.
  `zoomView.test.ts` updates.
- Panel: a small header row with **Settings** (bishopric) and **Questions** (bishopric, clerk,
  executive secretary) buttons; when registration is not set up, a single **Set up sign-ups**
  button for the bishopric and a sentence for the others.
- List: **Waiting** (pending, oldest first) then **Recent** (approved/declined, newest first,
  collapsed after 10 with "Show more"). Group by day with alternating shading (remember-page-view
  memory applies to chronological lists).
- `describeRegistrationRow()` (pure): name; "Member of the ward (not matched yet)" / "Matched to
  {member}" / "Not a member"; phone and email shown to readers (they are the ward's leaders);
  answers as "prompt — answer"; "Referred by {name}"; flags ("Same phone as an earlier request",
  "Declined before", "Held: lots of sign-ups today"); status line ("Waiting", "Approved · Guest 07",
  "Approved · waiting for a link", "Declined"); a date stamp in **UTC date-only** like the Invitees
  rows (rule 12, second case).
- Settings window: three switches (Sign-up page open; Approve automatically; Email the bishopric
  about each new sign-up — disabled with a note when auto-approve is off, because then they are
  always emailed), the registration link with Copy, the QR with Download, and a one-line note that
  the QR is for printing on the programme.
- Questions window: list (active then turned off), add form, edit prompt/audience/required,
  Turn off / Turn on, ↑ ↓. Kind is shown, not editable.
- Remember the open tab on the account (`readPageView` / existing save path) — already handled by
  `zoomView` once the tab is in the enum.

### Task 15: Tests and scenario for z3a — see Testing Strategy. Then docs for z3a (Task 26, the parts that are true after z3a).

---

### SLICE z3b — approvals and matching

#### z3b addendum (2026-10-31, re-checked against what z3a actually built)

Read this before Task 16. It overrides the tasks below where they disagree.

- **A1 — The decline note is the bishopric's alone, enforced by the database (user's decision
  2026-10-31).** z3a's migration 096 grants `decline_note` to `authenticated` in the column grant,
  and `zoom_registrations_select` admits the ward clerk and executive secretary, so they could
  read it. Task 19's "Only the bishopric sees this" would be false. Fix:
  - **Migration 098** (`098_zoom_decline_note_bishopric_only.sql`): `revoke select on
    zoom_registrations from authenticated;` then re-grant the **same column list as 096 minus
    `decline_note`** (still minus `status_token_hash`). Header comment says why. Nothing in the app
    selects `decline_note` today (`REGISTRATION_COLUMNS` in `lib/zoom/registrations.ts` doesn't
    name it — **re-confirm before applying**), so this needs no `HELD_BACK_UNTIL_DEPLOYED` entry.
    `db:push --dry-run` first.
  - **Reading it:** the card shows the note only to the bishopric. Load it with the **service
    role, after `canManageInvitees()`**, in a separate small read keyed by the declined ids on the
    page (`readDeclineNotes(wardId, ids, service)` in `lib/zoom/registrationApprovals.ts`), the
    same shape as the Remote links tab (service-role read after the permission check). Never add
    `decline_note` to `REGISTRATION_COLUMNS`, and never return it from a route the clerk can reach.
  - **Writing it** is already service-role only (no write policy); unchanged.
  - **Tests:** in `tests/rls/zoom-registrations.test.ts`, change "lets the bishop read every other
    column by name" to drop `decline_note`, and add: bishop, clerk and executive secretary each get
    **42501** selecting `decline_note` by name. Fix the 096 migration's header comment only via the
    098 header (never edit an applied migration).
- **A2 — Name the tab as built.** z3a named the tab **Sign-ups**, not "Registrations". Use
  "Sign-ups" in every UI string, to-do body ("…once they're matched on Zoom → Sign-ups.") and email
  in z3b/z3c.
- **A3 — `createWaitingLinkTodosForBishopric` already exists** in `lib/zoom/registrations.ts`
  (z3a built it there for auto-approve with an empty pool). Task 16 reuses it; **do not** move or
  duplicate it into `lib/todos/zoomLinks.ts`. Task 18's match to-do helpers still go in
  `lib/todos/zoomLinks.ts`, beside `createWaitingLinkTodo` / `closeWaitingLinkTodos`.
- **A4 — Pure helpers live in their own files** (z3a's precedent: `registrationRow.ts`,
  `registrationAnswers.ts`) when a client component needs them. `waitingOnNames()` is rendered by
  `RegistrationCard.tsx`; if it would pull a server client into the bundle, put it in
  `lib/zoom/registrationRow.ts` instead.
- **A5 — Already in place from 096 (no migration needed for these):** `zoom_registration_responses`
  (SELECT-only), `todos.zoom_registration_id` with its one-open-per-owner partial unique index, and
  `respond_to_zoom_registration()` (service role only). Read its body before writing Task 16 —
  return shape `(status, invitee_id, join_link_id, waiting_on uuid[])`.
- **A6 — z3a follow-ups NOT folded in** (stay out of scope): the wrong-token tab title, the Zoom
  tab row scrolling at 375px, SPEC/FEATURES for ITER-053.

### Task 16: Approval logic
**File:** `lib/zoom/registrationApprovals.ts` (create)
- `respondToRegistration({ wardId, registrationId, userId, response }, service)` → calls
  `respond_to_zoom_registration`; returns `{ status, inviteeId, joinLinkId, waitingOn }`. A null
  row (not pending / not found) → `{ status: 'not_pending' }`.
- On approval with `joinLinkId === null` → waiting-link to-dos for every bishopric member
  (Task 8's helper, shared — put it in `lib/todos/zoomLinks.ts` as
  `createWaitingLinkTodosForBishopric`).
- `declineRegistration({ wardId, registrationId, userId, note }, service)` — one UPDATE
  `… where status = 'pending'` setting `declined`, `decided_by`, `decided_at`, `decline_note`;
  zero rows → `not_pending`. Then close any open match to-dos (Task 18) with the line "The sign-up
  was declined."
- `waitingOnNames(registration, bishopric)` (pure): who has not approved yet, and who said "talk
  first" — for the card. **Computed on read** against `listBishopricUsers()`, so a released
  calling drops out without a write. When pending and nobody is left waiting, the card shows
  **Finish approval** (the `finish` response).

### Task 17: Approval route
**File:** `app/api/zoom/registrations/[id]/route.ts` (create)
- `PATCH` body `{ action: 'approve' | 'talk_first' | 'finish' | 'decline', note? }` (Zod, a
  discriminated union; `note` ≤ 500, only on decline, optional). `canManageInvitees()` → else 403.
- `params` is a Promise (Next 16).
- Answers `200 { registration }` (re-read through the service role, mapped like the list), `404`
  for unknown, `409 { error: "This sign-up was already decided." }` for not pending.
- Audit `zoom_registration_responded` `{ registrationId, response }`,
  `zoom_registration_approved` `{ registrationId, inviteeId, linkGiven, waitingTodoIds }`,
  `zoom_registration_declined` `{ registrationId, hasNote }`. Audit the approval even when the
  to-do write after it fails (rule 6, ITER-053's finding).

### Task 18: Member match and its to-dos
**Files:** `lib/zoom/registrationMatch.ts` (create), `lib/todos/zoomLinks.ts`, `lib/todos/queries.ts`,
`types/domain.ts`, `app/(app)/todos/TodoCard.tsx` (modify), `app/api/zoom/registrations/[id]/match/route.ts` (create)
- On submit with `saysMember = true` (z3a's submit gains this in z3b): `createMatchTodo` for every
  bishopric member — title `Match {displayName} to the roster`, tag `Zoom`, `assigned_by` null,
  `zoom_registration_id` set; 23505 = already there (the 095c idempotence pattern).
- `matchRegistration({ wardId, registrationId, memberId, userId })`: `assertPickableMember()`
  through the caller's client (active members only), then service-role update of
  `zoom_registrations.member_id/matched_by/matched_at` and, if `invitee_id` is set, the invitee's
  `member_id` (its `display_name` stays — a snapshot). Close every open match to-do with
  `source_completed` and the body "They were matched to the roster." A re-match is allowed
  (wrong person picked) and audits `previousMemberId: boolean` only.
- `Todo.zoomRegistrationLink: { registrationId: string } | null`; mapping in `lib/todos/queries.ts`;
  **no checkbox** and **not deletable while open** (add beside `ZOOM_TODO_TICK` / `open_zoom`:
  "This closes itself once they're matched on Zoom → Sign-ups."). `TodoCard` shows the source line
  linking to `/zoom` (the tab is remembered; add `?tab=registrations` only if `/zoom` already reads
  a tab param — check before adding one).
- Route: `POST { memberId }` → `canManageInvitees()`; audit `zoom_registration_matched`
  `{ registrationId, memberId, closedTodoIds }`.

### Task 19: The card's controls
**Files:** `RegistrationCard.tsx` (modify), `DeclineRegistrationModal.tsx`, `MatchRegistrationModal.tsx` (create)
- For the bishopric on a pending card: **Approve**, **Let's talk first**, **Not this time**,
  and **Match to roster** when `saysMember`. Your own response is shown pressed. A line under the
  name: "Approved by Bishop Smith · Wants to talk first: Brother Haskell · Waiting on: you".
  Names, never he/she ("them").
- **Not this time** opens a small window: an optional private note ("Only the bishopric sees
  this") and the exact sentence the person will see. Confirm.
- After any action, refresh the list and the tab count (`router.refresh()` as the Remote links
  panel does after a save).
- The clerk and executive secretary see the same cards with no buttons.

### Task 20: Tests and scenario 098 — see Testing Strategy. Then the z3b docs.

---

### SLICE z3c — emails

### Task 21: Read z3a/z3b's routes; confirm where each send happens. Email is always **after** the write and **never** changes the HTTP status of the write.

### Task 22: A generic text-email sender
**File:** `lib/email/sendTextEmails.ts` (create)
- `sendTextEmails({ to: { key: string; email: string }[], subject, text })` →
  `{ sent: string[], failed: { key, reason }[], notConfigured: string | null }`, the exact loop
  `sendMusicEmail()` runs, keyed by an opaque `key` (a user id or a registration id) so no address
  is ever logged.
- **Do not change `lib/email/musicEmails.ts` in this plan** (out of scope). Leave a one-line
  follow-up in the retro: music could delegate to this ("one mechanism" the second time it is
  needed — this is the second time).

### Task 23: The four messages
**File:** `lib/email/zoomRegistrationEmails.ts` (create; pure builders + one `send…` each)
- **Bishopric, new sign-up** — to every active bishopric calling's `users.email` (service read,
  `users.is_active`). Sent when approvals are on (always) or auto-approve is on and
  `email_bishopric_on_new`. Subject "New stream sign-up: {name}". Body: the name, "Waiting for your
  approval" or "Approved automatically", and `{site}/zoom` (open Sign-ups). **No phone, email,
  answers.**
- **Registrant, received** (they gave an email, request pending): "We got your request" + their
  status page link.
- **Registrant, approved** (D4): their status page link **and** the join link, with "This link is
  just for you."
- **Registrant, declined** (D2): the same neutral sentence as the status page. No reason.
- A null `resolveSiteUrl()` drops link lines (music's rule) — the approved email then still
  carries the join link itself.

### Task 24: Wire them in
- Submit route: after the insert/auto-approve, send "received" or "approved" to the registrant and
  the bishopric email. Failures are logged against the registration id and **not** surfaced to
  the public (they have their status page either way).
- Approval route: on `approved` send "approved"; on `declined` send "declined". The response gains
  an `email` sentence (`describe…Problem`) the card shows, music's pattern ("…couldn't be emailed.
  Their status page has it either way.").
- Settings window: when `emailConfiguration()` is not configured, show "Email isn't set up yet, so
  nobody is emailed. Sign-ups still appear here." (pass the boolean from the page; the reason
  strings mention the programme PDF and must not be shown here).

### Task 25: Tests for z3c — see Testing Strategy.

### Task 26: Documentation (per slice)
- `CLAUDE.md` §9: a new entry **"A ZOOM SIGN-UP IS A REQUEST, NOT AN INVITEE — DECIDED 2026-10-30
  (ITER-052, migration 096, plans/zoom-self-registration.md)"** covering P1, P3, P5, P6, P7, D2,
  the status token's column grant, and that the public write is a route with the service role
  while public reads are anon `security definer` functions. Keep it to one paragraph-sized entry.
- `SPEC.md` (tables, functions, routes), `FEATURES.md` (Zoom: sign-ups).
- `plans/prototype/module-map.md` Zoom row (slice 3) and §6's Zoom tab list (`Sign-ups`).
- `plans/P10-message-and-zoom.md` "Built" note.

## Testing Strategy

All DB-backed tests run against the hosted project; seed with `seedFixtures(handles)` and clean up
in `afterAll`. Route tests follow CLAUDE.md §8 (`tests/helpers/routeClient.ts`, only the client
factory mocked).

### z3a
- `tests/rls/zoom-registrations.test.ts` (create) — for all four new tables:
  - bishop, counselor, ward clerk, executive secretary of ward A read ward A's rows; an org
    president of ward A reads **none**; ward B's bishop reads **none** of ward A's.
  - every role's INSERT/UPDATE/DELETE through its own client is refused (INSERT raises; UPDATE/
    DELETE re-read with the service client shows the row unchanged).
  - `select("*")` on `zoom_registrations` as the bishop is a 42501; naming columns without
    `status_token_hash` works.
  - **anon** cannot select any of the four tables.
  - With Zoom unreleased for the ward (a `ward_release_settings` row without `zoom`), the bishop
    reads nothing.
- `tests/rls/zoom-registration-functions.test.ts` (create) — through the **anon** client:
  `zoom_registration_form` answers for an active `zoom_registration` slug, returns nothing for a
  program slug, an inactive slug and an unknown one; returns `is_open = false` when closed **and**
  when Zoom is unreleased; never includes inactive questions. `zoom_registration_status` returns
  the row for the right token, nothing for a wrong one or a malformed one, `join_url` null while
  pending/declined and set once approved. `approve_zoom_registration` and
  `respond_to_zoom_registration` are **not** executable by anon or authenticated.
  `approve_zoom_registration` (service): creates exactly one invitee, gives a link, and a second
  call returns no row (idempotent); with an empty pool, status is approved and the invitee waits.
- `tests/lib/registrationLimits.test.ts` — every branch of `decideIntake`, including that busy beats
  everything and approvals-on beats same-phone.
- `tests/lib/registrationAnswers.test.ts` — `checkAnswers`: audience filtering, required missing,
  wrong type, the snapshot keeps the prompt, unknown question ids dropped.
- `tests/lib/registrationTokens.test.ts` — token length/alphabet, hash matches a known SHA-256,
  referral code alphabet, URL builders return null with no site URL.
- `tests/lib/registrationRow.test.ts` — wording for each state and flag; `declinedBefore` and
  `samePhoneAs` computed correctly.
- `tests/lib/zoomRegistrationValidation.test.ts` — empty optional → null; required phone; honeypot
  accepted by the schema (it is the route that refuses); bad `ref` treated as absent.
- `tests/routes/zoom-public-registration.test.ts` — **no session**: valid submit → 201 + a status
  URL that the anon status function resolves; closed page → 404 with the generic sentence; unknown
  slug → the **same** 404 body; over the ward cap → 429 (seed 40 rows directly, then submit a
  **fully valid** body); honeypot → 201-looking answer and **no row written**; auto-approve on →
  status approved and a link given; auto-approve on + same phone → pending `same_phone`; auto-approve
  on + 10 auto-approved in 24h → pending `daily_limit`; approvals on → pending `approvals_on`; empty
  pool + auto → approved, no link, a waiting to-do on each seeded bishopric member; `ref` of an
  existing registration → `referred_by_registration_id` set. The audit row has `user_id` null and
  its detail contains none of the name, phone, email, token or answers (scan the serialised detail
  for the fixture's strings, program-c's "strings that must not appear" test).
- `tests/routes/zoom-registration-settings.test.ts` — set up is idempotent (one settings row, one
  slug, one default question); a counselor can update; the clerk gets 403 on settings but 201 on
  adding a question; an org president gets 403 on both; a 9th active question → 400 with the
  sentence; `kind` cannot be patched.
- `tests/lib/zoomView.test.ts` (modify) — the new tab and its visibility.
- `tests/lib/permissions.test.ts` (modify) — the new permission's rows; non-overridable.
- `tests/db/module-release-policies.test.ts`, `tests/rls/ward-isolation.test.ts`,
  `tests/db/user-author-fks.test.ts`, `tests/lib/explicitTimeZone.test.ts`,
  `tests/lib/navigationRoutesExist.test.ts`, `tests/db/migrations.test.ts` — must stay green; the
  first two will need the new tables acknowledged the way they expect (read each before changing it).
- `tests/components/zoom/RegistrationForm.test.tsx` — audience switching shows the right questions;
  required question blocks submit with the sentence; the honeypot is not focusable/visible to AT.

### z3b
- `tests/routes/zoom-registration-approvals.test.ts` — with bishop + two counselors seeded:
  two approvals leave it pending with `waitingOn` = the third; the third approves → approved, link
  given, invitee created with `source = self_registration`; "talk first" then "approve" by the same
  person replaces the response; a decline by any one → declined, `decline_note` stored, audit has
  `hasNote` only; acting on a decided request → 409; clerk → 403 (and the row unchanged on re-read);
  release a counselor's calling while pending, then `finish` → approved; with only the bishop
  serving, one approval approves. Empty pool on approval → waiting to-dos on all serving bishopric
  members, and giving a link (ITER-053's route) closes them all.
- `tests/routes/zoom-registration-match.test.ts` — submit with `saysMember` → one match to-do per
  bishopric member; match → every copy closed with the line, `member_id` on registration and
  invitee; a moved-out member → 400 sentence (data otherwise valid); re-match allowed.
- `tests/lib/todos…` (modify the existing tick/delete refusal tests) — a match to-do cannot be
  ticked or deleted while open.
- `tests/lib/registrationApprovals.test.ts` — `waitingOnNames` pure cases.

### z3c
- `tests/lib/zoomRegistrationEmails.test.ts` — each builder: subject/body; the bishopric email
  contains **no** phone, email or answer (scan for the fixture strings); null site URL drops link
  lines; the approved email still has the join link.
- `tests/lib/sendTextEmails.test.ts` — not configured → nothing sent, `notConfigured` set; one
  failure does not stop the others; no address in any `console.error` call (spy).
- Route tests (extend) — with Resend mocked: the right messages go to the right people; an email
  failure leaves the write and its status code unchanged.

## Test Scenarios (Harness)

Follow the existing scenario layout (`testing/scenarios/zoom/scenario-095-zoom-link-pool/` is the
model). Run `npm run manifest` after adding each.

### Scenario 097: Zoom sign-ups — the public page and auto-approve
**Tags:** zoom, full, public, privacy
**Purpose:** The public form, status page and auto-approve are only meaningful signed out on a real
phone width; seeding a ward with sign-ups open, a part-filled pool and a few existing sign-ups makes
every state reachable in minutes.
**Seed data summary:**
- ward + bishop, two counselors, ward clerk, executive secretary, one org president
- `zoom_registration_settings` — open, auto-approve **on**, email switch on
- `public_pages` — one `zoom_registration` slug
- `zoom_registration_questions` — 3 (missionary question for non-members; a short-text "How did you
  hear about us?" for everyone; one turned off)
- `zoom_join_links` — 2 free
- `zoom_registrations` — 4: one approved with a link, one pending `same_phone`, one declined, one
  with a referrer
**Tester action:** Signed out (check `document.cookie` is empty), open the printed URL at 375px,
register as a non-member, land on the status page, use Share with a friend, register a friend
through that link, register a third time to empty the pool. Signed in as a counselor, open Zoom →
Sign-ups; open Settings and Questions; switch the page off and reload the public page.
**Verification checklist:**
- [ ] The form shows the ward name, the non-member question only after "No", and no other ward data
- [ ] Submitting lands on a status page with a Join the stream button and the "just for you" line
- [ ] Share with a friend shares the sign-up page with `?ref=`, never the status or join URL
- [ ] The friend's card reads "Referred by …"
- [ ] With the pool empty, the status page says the link is on its way and each bishopric member has "Give ___ a Zoom link"
- [ ] The same phone again is held, not auto-approved, and marked on the card
- [ ] Switching the page off shows the closed message on the public page within a reload
- [ ] The clerk can edit questions but has no Settings button; the org president has no Sign-ups tab
- [ ] No audit row for a sign-up contains a name, phone, email or answer
- [ ] 375px: no horizontal scroll; both themes readable

### Scenario 098: Zoom sign-ups — bishopric approval and roster matching
**Tags:** zoom, full, approvals, todos
**Purpose:** Unanimous approval across three accounts, "talk first", decline, a vacancy, and the
match to-dos need several users' states at once; seeding them avoids three manual logins' setup.
**Seed data summary:**
- ward + bishop, two counselors (one with an inactive calling variant for the vacancy step), clerk
- settings — open, auto-approve **off**
- `zoom_join_links` — 1 free
- `zoom_registrations` — 4 pending: one approved by the bishop already, one with a "talk first" from
  counselor 1, one saying "member" (with match to-dos on all three), one for the decline step
**Tester action:** As counselor 2, approve the first (→ waiting on counselor 1); as counselor 1,
approve it (→ approved, link on its status page). Decline one with a note and open its status page
signed out. Match the member registration. Release counselor 1's calling and press Finish approval
on a request only they were waiting on.
**Verification checklist:**
- [ ] The approval line names who approved, who wants to talk first, and who is still waited on
- [ ] The last approval puts the link on the status page; the pool count drops by one
- [ ] The declined status page shows the neutral sentence and no note
- [ ] Matching closes the match to-do on all three lists with "They were matched to the roster."
- [ ] A match to-do has no checkbox and cannot be deleted while open
- [ ] After the release, the card offers Finish approval and it approves
- [ ] The clerk sees every card with no buttons

## Validation Commands

Run per slice, in this order. **Stop any `npm run dev` before the full suite or the build**
(7.7 GB machine). The full suite takes ~50–75 minutes on the shared hosted DB; re-run any file
that hits the auth rate limit on its own.

```bash
# Migration (z3a only)
npx supabase db push --linked --dry-run
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests — the new and touched files first, then everything
npx vitest run tests/rls/zoom-registrations.test.ts tests/rls/zoom-registration-functions.test.ts tests/routes/zoom-public-registration.test.ts tests/routes/zoom-registration-settings.test.ts tests/lib/registrationLimits.test.ts tests/lib/registrationAnswers.test.ts tests/lib/registrationTokens.test.ts tests/lib/registrationRow.test.ts tests/lib/zoomView.test.ts tests/lib/permissions.test.ts tests/db/module-release-policies.test.ts tests/rls/ward-isolation.test.ts
npm test

# Production build
npm run build

# Harness
npm run manifest
```

## Integration Notes

- **ITER-053 is reused, not forked:** the pool, `assign_next_zoom_link()`, the waiting to-do and
  `closeWaitingLinkTodos()` are unchanged. Giving a waiting self-registered invitee a link from the
  Invitees tab works exactly as for a visit invitee, and closes the waiting to-dos.
- **ITER-054** (attendance) attaches to the invitee, so self-registered people are covered with no
  extra work.
- **ITER-039** (domain + email) turns z3c's emails on with no code change. Until then, say so on
  the settings window. Also: **a QR printed before the domain move points at the old address** —
  recommend printing the QR **after** ITER-039, and say so in the settings window's note only if
  `resolveSiteUrl()` still returns the `vercel.app` host (otherwise omit it).
- **Release:** Zoom is already released in Buffalo Ward. No new module key.
- **Breaking changes:** none to existing screens. `writeAuditLog`'s `userId` widens to nullable;
  every existing caller still passes a string.
- **Migration 096 is not held back** — the deployed build reads none of its objects and drops
  nothing.
- **Follow-ups to record in the retro (not built):** the missionary referral workflow (prototype
  `zoom-referral-requests`); adding the sign-up QR to the programme PDF; letting a registrant edit
  or withdraw; music emails delegating to `sendTextEmails`; a bell notification if pending sign-ups
  are missed.
