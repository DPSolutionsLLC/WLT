# Plan: Zoom link pool, visit hand-out, and invitee list

**Created:** 2026-10-28
**Type:** feature
**Scope refs:** ITER-053

## Overview

The second Zoom slice (GROUP-05: 051 → **053** → 052 → 054). The church's Zoom account has no API
access, so the bishopric pre-registers placeholder registrants by hand in Zoom ("Guest 01",
`sacrament+guest01@gmail.com`, …) and pastes each one's personal join link into the app. This item:

1. **Link pool** — paste many placeholder links at once; see how many are free and how many are
   given out; a low-pool warning.
2. **Visit hand-out** — on a phone, a bishopric member types a name (roster member or not), adds a
   phone / email / notes, and the app gives that person the next free link, then offers **Text
   it**, **Share**, or **Show QR code**.
3. **Invitee list** — everyone holding a link (or waiting for one): who they are, the placeholder
   they hold, who gave it, and empty "Last watched" / "Sundays watched" columns that ITER-054 fills.

### Decisions settled with the user (2026-10-28, answering the scope's open questions)

| # | Decision |
|---|---|
| D1 | **Empty pool → save the person, link later.** The invitee is saved as *Waiting for a link*; the leader is told so in a sentence; a to-do "Give ___ a Zoom link" lands on **the leader who did the hand-out** and closes itself when a link is given. The same waiting state serves ITER-052's public page later. |
| D2 | **No take-back in this slice.** A given link stays with its person. Reusing a link needs the deferred Zoom test (the old holder may still get in). No release, no retire. |
| D3 | **The bishopric edits invitees, audited.** Bishop and both counselors may edit name, phone, email, notes and the roster match. The audit row names which fields changed, never their values. Clerk and executive secretary are read-only. |
| D4 | **The roster picker shows active members only** — `MemberPicker`'s default; a moved-out person is entered as a typed name. |

### Decisions made in planning (report these to the user at the end of execution)

| # | Decision | Why |
|---|---|---|
| P1 | **The low-pool warning is a banner computed on read**, shown on the Zoom page to the bishopric and in the hand-out result ("4 links left"). **No notification is sent.** | "Computed, never stored" — and a new notification trigger means a fourth copy of the trigger list, a migration of every ward's settings, and a mechanism nothing else in Zoom uses yet. Every bishopric member who hands out a link sees the count at that moment. Revisit if the walk shows nobody notices. |
| P2 | **The join URL is hidden at the COLUMN level.** The clerk and executive secretary may read the pool's placeholder names (the invitee list shows them) but never a `join_url`. Postgres column privileges do this: `authenticated` gets `select` on every column **except** `join_url`; the bishopric reads a URL only through a route behind `canManageInvitees()` using the service role. | A join link is a capability — whoever holds it can join as that guest. ITER-051's rule (only the holder reads a remote link) applied as narrowly as this data allows. |
| P3 | **"Next free link" is one SQL function, `assign_next_zoom_link()`**, using `for update skip locked`. | supabase-js has no transactions; two leaders on two visits at the same moment must never receive the same link. Precedent: migration 087's `remove_talk()`. |
| P4 | **An unassigned pool link may be removed** (a typo in a paste). An assigned one may not (D2). | Removing a link nobody holds destroys nothing anybody wrote. |
| P5 | **Attendance is not stored here.** The two columns render "—" until ITER-054 adds attendance rows and computes them on read. | The scope says attendance attaches to the PERSON; this slice's job is only to make the invitee row the thing it attaches to. |
| P6 | **New permission `zoom.manage_invitees`, non-overridable, plus a bishopric calling** (`canManageInvitees()`, the shape of `canManageRemoteLinks()`). Reading uses the existing `zoom.view`, which the bishopric, ward clerk and executive secretary already hold. | Matches the scope's access table exactly, and a ward must not hand non-member personal data to another calling. |

### Success criteria

- A bishop pastes 10 placeholder lines; 10 links appear as free; a bad line is reported, not added.
- On a phone, a counselor gives a link to a roster member and to a typed non-member; each gets the
  next free link; Text it / Share / QR each work; the result says how many links are left.
- With the pool empty, a hand-out saves the person as *Waiting for a link* and puts a to-do on that
  leader's list; pasting more links and pressing **Give a link** on the waiting row gives one and
  closes the to-do.
- The clerk sees the invitee list (names, placeholder, who gave it) and no button that writes, and
  cannot read a join URL even by querying the table directly.
- A ward-B leader reads nothing of ward A's pool or invitees.

### Slices — three commits, in this order

| Slice | Contents | Tasks |
|---|---|---|
| **z2a** | Migration 095, types, permission, catalog, the **Link pool** tab | 1–9 |
| **z2b** | The **Invitees** tab, the hand-out flow (picker, Text / Share / QR), editing | 10–17 |
| **z2c** | The *Waiting for a link* to-do (D1) | 18–22 |

Each slice ends with the validation commands and is committed by the user (`/commit`) before the
next begins. The migration is applied once, in z2a, and carries z2c's to-do columns too, so z2c
needs no migration of its own.

## Relevant Files

**z2a**
- `supabase/migrations/095_zoom_link_pool_and_invitees.sql` — create — both tables, column grants, policies, `assign_next_zoom_link()`, `remove_unassigned_zoom_link()`, the to-do link columns and check values for z2c
- `types/database.ts` — regenerate (`npm run db:types`) — never hand-edit
- `types/domain.ts` — modify — `TODO_CLOSED_REASONS` / `TODO_LOG_KINDS` unchanged (see Task 1); add `ZOOM_INVITEE_SOURCES`
- `lib/auth/permissions.ts` — modify — `zoom.manage_invitees` in `PERMISSIONS` and `NON_OVERRIDABLE_PERMISSIONS`
- `lib/access/releasedModules.ts` — modify — Zoom's `tables` gains the two new tables; description widened
- `lib/zoom/access.ts` — modify — add `canManageInvitees()`
- `lib/zoom/joinLinkPaste.ts` — create — pure paste parser
- `lib/zoom/joinLinkPool.ts` — create — pool reads/writes and the low-pool rule
- `lib/validation/zoom.ts` — modify — paste body schema, invitee schemas (z2b)
- `lib/zoom/zoomView.ts` — modify — tabs `remote | invitees | pool | links`
- `app/api/zoom/join-links/route.ts` — create — `GET` (pool summary), `POST` (preview or add pasted lines)
- `app/api/zoom/join-links/[id]/route.ts` — create — `DELETE` an unassigned link
- `app/(app)/zoom/page.tsx` — modify — read pool + invitees, pass to tabs
- `app/(app)/zoom/ZoomTabs.tsx` — modify — four tabs, visibility per reader
- `app/(app)/zoom/LinkPoolPanel.tsx` — create — paste, preview, add; free/given counts; remove ✕
- `app/(app)/zoom/PoolLowBanner.tsx` — create — the computed low/empty banner
- `plans/prototype/module-map.md` — modify — Zoom row and §6 Zoom navigation row

**z2b**
- `lib/zoom/invitees.ts` — create — list, create-and-assign, give-link, update, read one URL
- `lib/zoom/joinLinkMessage.ts` — create — pure: the text message body
- `lib/zoom/joinLinkQr.ts` — create — pure: QR data URI for a join URL (browser-safe)
- `app/api/zoom/invitees/route.ts` — create — `POST` hand-out
- `app/api/zoom/invitees/[id]/route.ts` — create — `PATCH` edit
- `app/api/zoom/invitees/[id]/link/route.ts` — create — `GET` the URL (bishopric) and `POST` give a waiting person a link
- `app/(app)/zoom/InviteesPanel.tsx` — create — the list, Give a Zoom link button, waiting rows
- `app/(app)/zoom/HandOutModal.tsx` — create — the phone-first form
- `app/(app)/zoom/LinkHandoff.tsx` — create — Text it / Share / Show QR
- `app/(app)/zoom/EditInviteeModal.tsx` — create

**z2c**
- `lib/todos/zoomLinks.ts` — create — create/close the waiting to-do (service role), sibling of `musicLinks.ts`
- `lib/todos/queries.ts` — modify — select `zoom_invitee_id`, map `zoomLink`
- `app/(app)/todos/TodoCard.tsx` — modify — a Zoom-linked to-do has no checkbox and links to Zoom
- whichever route/lib refuses deleting an open music to-do (find with `grep -rn "musicLink" app/api/todos lib/todos`) — modify — same refusal for an open Zoom to-do
- `app/api/zoom/invitees/route.ts`, `app/api/zoom/invitees/[id]/link/route.ts` — modify — create / close the to-do

**Tests and harness** (all slices) — see Testing Strategy.

## Dependencies

- **No new libraries.** `qrcode` is already a dependency (`lib/pdf/qrCode.ts`); it runs in the browser too.
- Reuse: `MemberPicker` (`components/roster/MemberPicker.tsx` — its interface is FROZEN; use it as is),
  `SmsHandoff` (`components/assignments/SmsHandoff.tsx`) and `normalizePhone` /
  `buildSmsLink` (`lib/assignments/smsLink.ts`), `Modal`, `Button`, `Pill`, `StatusTag`,
  `ConfirmDeleteButton`, `FormError`, `writeAuditLog`, `respondToRouteError` / `readJsonBody`,
  `readPageView`, `createServiceSupabaseClient`.
- Pattern files to read before writing: `lib/zoom/remoteLinks.ts`, `app/api/zoom/remote-links/[position]/route.ts`,
  `app/(app)/zoom/RemoteLinksPanel.tsx`, `lib/todos/musicLinks.ts`, `lib/roster/paste/parsePastedReport.ts`
  (preview-then-apply, server re-parses).
- **Configuration:** apply migration 095 to the hosted project (`npx supabase db push`), then `npm run db:types`.

## Known Pitfalls (from retro context)

- **zoom-remote-links** — `RemoteLinksPanel` remounts from its initial props on every tab switch, so
  every panel here must call `router.refresh()` after a successful write or switching tabs shows
  stale rows. And: adding to a module's catalog can break a test that borrowed a name — run
  `tests/routes/released-modules.test.ts` and `tests/db/module-release-policies.test.ts` early.
- **released-modules-per-ward** — every table a module owns must be in the catalog's `tables` AND
  carry the restrictive `ward_module_released('zoom')` policy, or
  `tests/db/module-release-policies.test.ts` fails.
- **060-D2 / migration 094 header** — no write policy "for convenience". Every write is the service
  role behind `canManageInvitees()`; every service-role write sets and filters `ward_id` (rule 1).
- **ward-callings-model (069)** — every user FK is single-column `on delete set null`, never
  composite with `ward_id`. A **member** FK, by contrast, IS composite (`(member_id, ward_id) →
  members (id, ward_id)`, `on delete set null (member_id)` column-list form — see `todos` in
  migration 081 for the exact shape).
- **roster-b** — a `"use client"` component must not import a module that pulls in `next/headers`.
  `joinLinkMessage.ts`, `joinLinkQr.ts` and `joinLinkPaste.ts` import nothing server-side.
- **sacrament-music-handoff (089)** — a to-do written onto a list by the system has no checkbox and
  cannot be deleted while open; creation is idempotent through a partial unique index (23505 = "already
  there"); the lib never writes the audit row, the route does.
- **writeAuditLog redaction** — any detail key matching `note|token|key|…` becomes `[redacted]`.
  Never put a phone, email, notes, display name or URL in an audit detail; use ids, booleans and
  `changedFields: ["phone", …]` — **and the field name `notes` inside that array is a VALUE, not a
  key, so it is safe**; do not name a detail KEY `notes` or `inviteeNotes`.

## Tasks

---

### SLICE z2a — schema, permission, Link pool tab

### Task 1: Migration 095
**File:** `supabase/migrations/095_zoom_link_pool_and_invitees.sql` (create)
**Action:** One migration with a long header comment in the style of 094 explaining D1–D4 and P2–P4.
**Details:**

```sql
-- 095a. zoom_join_links — the pool
create table zoom_join_links (
  id                uuid primary key default gen_random_uuid(),
  ward_id           uuid not null references wards (id) on delete cascade,
  placeholder_name  text not null check (length(btrim(placeholder_name)) between 1 and 120),
  placeholder_email text not null check (placeholder_email = lower(placeholder_email)
                                         and placeholder_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                         and char_length(placeholder_email) <= 254),
  join_url          text not null check (join_url ~ '^https://' and char_length(join_url) <= 2000),
  created_by        uuid references users (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (id, ward_id),
  constraint zoom_join_links_one_url   unique (ward_id, join_url),
  constraint zoom_join_links_one_email unique (ward_id, placeholder_email)
);

-- 095b. zoom_invitees — a person holding (or waiting for) a link
create table zoom_invitees (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  display_name   text not null check (length(btrim(display_name)) between 1 and 120),
  member_id      uuid,
  phone          text check (phone is null or char_length(phone) between 7 and 40),
  email          text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254)),
  notes          text check (notes is null or length(notes) <= 1000),
  source         text not null default 'visit' check (source in ('visit')),
  assigned_by    uuid references users (id) on delete set null,
  join_link_id   uuid unique,
  link_given_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint zoom_invitees_link_pair check ((join_link_id is null) = (link_given_at is null)),
  foreign key (member_id, ward_id) references members (id, ward_id) on delete set null (member_id),
  foreign key (join_link_id, ward_id) references zoom_join_links (id, ward_id)
);
```

- `source` lists only `'visit'`; ITER-052 widens it to `'self_registration'`. Say so in a comment.
- `join_link_id unique` is what makes "one link, one person" a database fact (D2).
- `display_name` is a snapshot kept even when `member_id` is set, so a member record changing or
  being deleted never loses the person (scope note). `on delete set null (member_id)` keeps the row.
- Indexes: `zoom_invitees (ward_id, created_at desc)`, `zoom_invitees (member_id)`.

**Grants and policies (P2):**
```sql
alter table zoom_join_links enable row level security;
alter table zoom_invitees   enable row level security;

revoke select on zoom_join_links from authenticated;
grant select (id, ward_id, placeholder_name, placeholder_email, created_by, created_at)
  on zoom_join_links to authenticated;
```
- Check what else `authenticated` holds on a new table in this project (Supabase's default
  privileges grant insert/update/delete too). RLS with no write policy already refuses writes;
  leave those grants alone so this table behaves like `zoom_remote_links`.
- A shared viewer predicate, inline in both SELECT policies:
  `ward_id = current_ward_id() and (is_bishopric() or current_user_role() in ('ward_secretary','executive_secretary'))`.
  Confirm `current_user_role()` returns `text` comparable this way (migration 070).
- `zoom_join_links_select` and `zoom_invitees_select` — `for select to authenticated using (<predicate>)`.
- **No insert/update/delete policies on either table.**
- Restrictive `…_module_released` policies on both, copied from 094.

**`assign_next_zoom_link(p_ward_id uuid, p_invitee_id uuid) returns uuid`** — `language plpgsql`,
`security definer`, `set search_path = public, pg_temp`, execute granted to `service_role` ONLY
(revoke from public). Body:
```sql
select l.id into v_link_id
  from zoom_join_links l
 where l.ward_id = p_ward_id
   and not exists (select 1 from zoom_invitees i where i.join_link_id = l.id)
 order by l.created_at, l.placeholder_name
 limit 1
 for update of l skip locked;
if v_link_id is null then return null; end if;
update zoom_invitees
   set join_link_id = v_link_id, link_given_at = now(), updated_at = now()
 where id = p_invitee_id and ward_id = p_ward_id and join_link_id is null;
if not found then return null; end if;
return v_link_id;
```
Comment that a null return means "no free link OR the invitee already has one / is not in this ward";
the caller re-reads the invitee to tell which.

**`remove_unassigned_zoom_link(p_ward_id uuid, p_link_id uuid) returns boolean`** — same grants;
`delete from zoom_join_links l where id = p_link_id and ward_id = p_ward_id and not exists (select 1
from zoom_invitees i where i.join_link_id = l.id)`; returns `found`. One statement so a hand-out
cannot slip in between a check and the delete.

**095c — z2c's to-do link (applied now so z2c needs no migration):**
```sql
alter table todos add column zoom_invitee_id uuid references zoom_invitees (id) on delete set null;
create unique index todos_one_open_zoom_link_todo_per_owner
  on todos (zoom_invitee_id, user_id)
  where zoom_invitee_id is not null and completed_at is null;
create index todos_zoom_invitee_idx on todos (zoom_invitee_id) where zoom_invitee_id is not null;
```
The to-do closes with `completed_at` set, `closed_reason` null, and a `source_completed` timeline
line — **both existing values**, so neither check constraint changes. Confirm by reading how a
`source_completed` line is written today (`lib/todos/sourceLinks.ts`) before relying on it.

Apply with `npx supabase db push`, then `npm run db:types`.

### Task 2: Domain types
**File:** `types/domain.ts` (modify)
- `export const ZOOM_INVITEE_SOURCES = ["visit"] as const;` + type, with a one-line comment that
  ITER-052 adds `self_registration` and migration 095b's CHECK must move with it.

### Task 3: Permission
**File:** `lib/auth/permissions.ts` (modify)
- Add `"zoom.manage_invitees"` to `PERMISSIONS` beside the other two zoom entries.
- Add it to `NON_OVERRIDABLE_PERMISSIONS` and extend the comment block above it (one sentence: a ward
  must not hand non-member personal data and join links to another calling).
- The bishopric gets it automatically (`BISHOPRIC_PERMISSIONS = PERMISSIONS`). Do **not** add it to
  the clerk or executive secretary lists.
- Run `tests/lib/permissions.test.ts`; update any snapshot of the permission list deliberately.

### Task 4: Catalog
**File:** `lib/access/releasedModules.ts` (modify)
- Zoom: `description: "Each leader's stream remote control, the link pool and who holds a link."`,
  `tables: ["zoom_remote_links", "zoom_join_links", "zoom_invitees"]`.

### Task 5: Access helper
**File:** `lib/zoom/access.ts` (modify)
- `export function canManageInvitees(user, roleAccess): boolean` — `can(user, "zoom.manage_invitees",
  roleAccess) && BISHOPRIC_ROLES.includes(user.role)`. Same comment shape as `canManageRemoteLinks`.

### Task 6: Paste parser (pure)
**File:** `lib/zoom/joinLinkPaste.ts` (create)
- `parseJoinLinkPaste(text: string): { lines: ParsedJoinLink[]; problems: JoinLinkPasteProblem[] }`.
- One line = one link. Split each non-blank line on tabs and commas; trim cells. The cell starting
  `https://` is the URL; the cell containing `@` is the email (lower-cased); the remaining non-empty
  cells joined by a space are the placeholder name. This accepts "Guest 01, guest01@x.com, https://…",
  a tab-separated copy from a spreadsheet, and any column order.
- A problem (with its 1-based line number and a plain sentence) when: no URL; URL not `https://`
  or over 2000 chars; no email or an invalid one; no name; name over 120; the same URL or email
  twice **within the paste**.
- Return types: `ParsedJoinLink = { lineNumber, placeholderName, placeholderEmail, joinUrl }`,
  `JoinLinkPasteProblem = { lineNumber, message }`.
- Imports nothing but types — it runs in the browser for the preview and on the server for the add.

### Task 7: Pool lib
**File:** `lib/zoom/joinLinkPool.ts` (create)
- `export const LOW_POOL_THRESHOLD = 5;`
- `describePoolLevel(freeCount: number): { tone: "ok" | "low" | "empty"; sentence: string | null }`
  — pure. `0` → "No Zoom links are left. Paste more on the Link pool tab." `1..5` → "Only 4 Zoom
  links are left." (singular for 1). Above → `ok`, null.
- `listPool(supabase)` — through the CALLER's client; selects only the granted columns
  (`id, placeholder_name, placeholder_email, created_at`) plus an embedded
  `zoom_invitees(id, display_name)` to know which are given. **Never `select("*")`** — the column
  grant makes it an error (comment this).
- `addJoinLinks({ wardId, actorUserId, links }, service)` — insert; a 23505 on either unique
  constraint means the link is already in the pool: insert row-by-row (pastes are tens of lines, not
  thousands) and return `{ addedIds, alreadyInPool: lineNumber[] }`. Any other error throws.
- `removeJoinLink({ wardId, linkId }, service)` — calls `remove_unassigned_zoom_link`; returns boolean.
- `countWaitingInvitees(supabase)` — `join_link_id is null` count (for the paste result sentence).

### Task 8: Pool routes
**Files:** `app/api/zoom/join-links/route.ts`, `app/api/zoom/join-links/[id]/route.ts` (create)
- Gate both with `requireSessionUser` → `resolveRoleAccess` → `canManageInvitees` else
  `ForbiddenError("zoom.manage_invitees")`, exactly as the remote-links route does.
- `POST /api/zoom/join-links` body `{ text: string, apply: boolean }` (Zod, text ≤ 200 000 chars).
  Re-parse on the server always. `apply: false` → `{ lines, problems }` (preview; nothing written).
  `apply: true` → refuse with 400 and a sentence if `problems` is non-empty; else `addJoinLinks`,
  audit `zoom_join_links_added` with `{ addedCount, alreadyInPoolCount }`, respond
  `{ addedCount, alreadyInPool, waitingCount }`.
- `DELETE /api/zoom/join-links/[id]` — uuid param; `removeJoinLink`; false → 409 "That link has
  been given to someone, so it can't be removed."; audit `zoom_join_link_removed` with `{ joinLinkId }`.
- No URL in any response or audit row.

### Task 9: Zoom page, tabs, Link pool panel
**Files:** `lib/zoom/zoomView.ts`, `app/(app)/zoom/page.tsx`, `ZoomTabs.tsx`, `LinkPoolPanel.tsx`,
`PoolLowBanner.tsx`, `plans/prototype/module-map.md`
- **Before UI work, open the Zoom component in `prototype/WLT.jsx`** (gitignored, local only — never
  copy roster data from it) and read its recipients tab, per CLAUDE.md §12 step 1b. Match its look
  with this app's primitives; follow the user's compact-UI preference (results-only lists, small
  grouped buttons opening windows, ✕ to remove, popups that fit their content).
- `ZOOM_TABS = ["remote", "invitees", "pool", "links"]`; labels Remote control / Invitees / Link pool
  / Remote links. In z2a the `invitees` tab renders a placeholder-free empty list (it is filled in
  z2b) — or simply leave `invitees` out of `TAB_ORDER` until z2b; either is fine, say which.
- Visibility: `remote` everyone with `zoom.view`; `invitees` everyone with `zoom.view`; `pool` and
  `links` only `canManageInvitees` / `canManageRemoteLinks`. A reader with one visible tab still
  gets no tab bar. A stored tab the reader cannot see falls back to `remote` (page decides).
- `page.tsx`: read the pool with the user's client when the reader can see `pool`; pass
  `freeCount` to `PoolLowBanner` above the tabs for the bishopric only.
- `LinkPoolPanel`: a "Paste links" button opens a `Modal` with a textarea and a one-line format
  hint ("One link per line: name, email, link — in any order"). Typing → client-side preview via
  `parseJoinLinkPaste` (instant); **Add N links** posts `apply: true`. After success: a sentence
  ("Added 10 links. 2 were already in the pool. 3 people are waiting for a link — give them one on
  the Invitees tab.") and `router.refresh()`. Below: counts "12 free · 30 given", then a compact
  list of free links (placeholder name + email, ✕ to remove with `ConfirmDeleteButton`) and given
  links (placeholder → person's name). No URL anywhere on the page.
- `module-map.md`: update the Zoom row (slice 2 built: pool, hand-out, invitees; migration 095) and
  the §6 Zoom navigation row (four tabs, who sees which).

**Validate (z2a):** lint, typecheck, the tests listed under z2a, build. Stop for the user to commit.

---

### SLICE z2b — Invitees and the hand-out

### Task 10: Validation schemas
**File:** `lib/validation/zoom.ts` (modify)
- `createInviteeSchema`: `{ memberId: uuid | null, displayName: string trimmed 1–120, phone:
  string | null (trim; empty → null; must pass `normalizePhone` when present — message "That phone
  number looks too short."), email: string | null (trim, lower, empty → null, z.email), notes:
  string | null (≤1000, empty → null) }`. **Empty becomes null, never ""** (global rule).
- `updateInviteeSchema` = the same fields, all optional, at least one present.
- When `memberId` is set, `displayName` is still sent (the client fills it from the picked member).

### Task 11: Invitees lib
**File:** `lib/zoom/invitees.ts` (create)
- `ZoomInvitee` type: `{ id, displayName, memberId, phone, email, notes, assignedByName,
  placeholderName | null, linkGivenAt | null, createdAt, lastWatchedOn: null, sundaysWatched: null }`
  — the last two are always `null` until ITER-054 (P5), typed `string | null` / `number | null` so
  ITER-054 fills them without a type change.
- `listInvitees(supabase)` — caller's client; embeds `zoom_join_links(placeholder_name)` (granted
  column) and the assigner's name. Waiting first, then newest given first.
- `createInvitee({ wardId, actorUserId, input }, service)` → insert the row, then
  `rpc("assign_next_zoom_link")`. Returns `{ inviteeId, joinLinkId | null, freeCountAfter }`.
- `giveWaitingInviteeALink({ wardId, inviteeId }, service)` → rpc; on null re-read the invitee:
  already has a link → `{ status: "already_has_link" }`; else `{ status: "pool_empty" }`.
- `readJoinUrl({ wardId, inviteeId }, service)` → the URL through the invitee's link, or null.
- `updateInvitee({ wardId, inviteeId, input }, service)` → returns `changedFields: string[]` by
  comparing to the row read first; sets `updated_at`.
- Every service-role call filters `ward_id`.
- Before writing a `memberId`, the ROUTE reads that member through the caller's own client
  (`members` RLS) with `status = 'active'` (D4); missing → 400 "Pick the person again — that roster
  record isn't available." The composite FK already stops another ward's member; this makes the
  refusal a sentence rather than a 500.

### Task 12: Message and QR helpers (pure, browser-safe)
**Files:** `lib/zoom/joinLinkMessage.ts`, `lib/zoom/joinLinkQr.ts` (create)
- `buildJoinLinkMessage({ firstName, wardName, joinUrl })` → "Hi Ann — here is your own link to
  watch Buffalo Ward sacrament meeting on Zoom: <url> It's just for you, so please don't share it.
  To share with a friend, ask a member of the bishopric for a link of their own." Keep it under
  `SMS_TRUNCATION_THRESHOLD`; first name = first word of the display name. Find how the ward's name
  reaches the client elsewhere (`grep -rn "wardName" types/domain.ts lib/auth`) and pass it from
  `page.tsx`.
- `joinLinkQrDataUri(url)` → `QRCode.toDataURL` with error correction `M`, margin 4, width 320,
  black on white — the reasoning in `lib/pdf/qrCode.ts` applies; do not import that file (it is
  print-specific). Refuse a blank URL with an Error.

### Task 13: Invitee routes
**Files:** `app/api/zoom/invitees/route.ts`, `app/api/zoom/invitees/[id]/route.ts`,
`app/api/zoom/invitees/[id]/link/route.ts` (create)
- All gated on `canManageInvitees` (403 via `ForbiddenError`).
- `POST /api/zoom/invitees` → validate, check member (Task 11), `createInvitee`; audit
  `zoom_invitee_created` `{ inviteeId, memberId, linkGiven: boolean, joinLinkId }`; respond 201
  `{ invitee, joinUrl | null, pool: describePoolLevel(freeCountAfter) }`. The URL is in this
  response because the leader is about to text / show it; never in the audit row.
- `PATCH /api/zoom/invitees/[id]` → `updateInvitee`; 404 when not in ward; audit
  `zoom_invitee_updated` `{ inviteeId, changedFields }` (D3); respond `{ invitee }`.
- `GET /api/zoom/invitees/[id]/link` → `{ joinUrl }` for re-showing a hand-out later; 404 when the
  person has no link. Audit nothing (a read).
- `POST /api/zoom/invitees/[id]/link` → `giveWaitingInviteeALink`; `pool_empty` → 409 "There are no
  free links. Paste more on the Link pool tab."; `already_has_link` → 409 "They already have a link.";
  success → audit `zoom_invitee_link_given` `{ inviteeId, joinLinkId }`, respond as POST above.

### Task 14: Invitees panel
**File:** `app/(app)/zoom/InviteesPanel.tsx` (create)
- Top: **Give a Zoom link** (bishopric only) opens `HandOutModal`.
- A **Waiting for a link** group first (if any), each row with **Give a link**.
- Then the list, compact rows: name (with a small "Member" chip when `memberId`), placeholder name,
  "Given by Dana · Oct 28", "Last watched —", "Sundays watched —". Dates render with an explicit
  `timeZone` (rule 12): `link_given_at` is a "when did this happen" stamp → UTC date, as ITER-051's
  tab does.
- Bishopric: tapping a row opens a small window with **Show link** (fetches `GET …/link`, then
  `LinkHandoff`) and **Edit**. Clerk / executive secretary: no buttons at all.
- A `SearchBox` filtering by name when there are more than ~10 rows.
- Remember nothing new beyond the tab (search is not remembered).

### Task 15: Hand-out modal (phone-first)
**File:** `app/(app)/zoom/HandOutModal.tsx` (create)
- Step 1, the person: `MemberPicker` (single, default active filter) with a "Not on the roster?
  Type their name" switch to a plain `Input`. Picking a member fills the name and, if the member has
  a phone on file, pre-fills the phone (editable).
- Phone (`inputMode="tel"`), Email (optional, `inputMode="email"`), Notes (optional). "Given by"
  shows the signed-in leader's name, read-only.
- **Give link** posts. On success the modal switches to step 2: the `LinkHandoff` for the new link,
  plus the pool sentence if low. On `joinUrl: null` (pool empty, D1) step 2 says: "Ann is saved,
  but there are no free links. They're on the Invitees list as waiting, and there's a to-do on your
  list to give them one." (the to-do sentence is added in z2c; in z2b omit its last clause).
- 44×44 tap targets, fits 375px, no horizontal scroll.

### Task 16: Link hand-off (Text it / Share / Show QR)
**File:** `app/(app)/zoom/LinkHandoff.tsx` (create)
- Three equal buttons. **Text it** renders `SmsHandoff` with the invitee's phone and
  `buildJoinLinkMessage` (it already handles no phone, desktop, Copy and truncation). **Share** uses
  `navigator.share({ text })` when available; otherwise it is not rendered and Copy (inside
  SmsHandoff) covers it — an `AbortError` from the share sheet is the person cancelling, not an
  error; any other error shows a `FormError`. **Show QR code** renders `joinLinkQrDataUri(url)` large
  and centred with the caption "Have them scan this with their phone camera."
- Holds the URL only in component state; never logs it.

### Task 17: Edit modal
**File:** `app/(app)/zoom/EditInviteeModal.tsx` (create)
- Same fields as step 1, pre-filled, including changing or clearing the roster match. Save →
  `PATCH`, `router.refresh()`.

**Validate (z2b):** lint, typecheck, z2b tests, build. Stop for the user to commit.

---

### SLICE z2c — the *Waiting for a link* to-do (D1)

### Task 18: Zoom to-do link lib
**File:** `lib/todos/zoomLinks.ts` (create)
- Header comment in the style of `musicLinks.ts`: service role, what stands in for RLS (the route's
  `canManageInvitees` and the invitee row it just wrote), idempotent, no audit row here.
- `createWaitingLinkTodo({ wardId, ownerUserId, inviteeId, displayName }, service)` → insert
  `{ user_id: owner, assigned_by: null, title: "Give " + displayName + " a Zoom link", tag: "Zoom",
  notes: null, zoom_invitee_id }`. 23505 → already there, return the existing id. The title holds a
  name, which is fine — the to-do is the owner's own; it never enters an audit row.
  `assigned_by: null` because the owner made the hand-out themselves (the talks-d rule: null means
  self).
- `closeWaitingLinkTodos({ wardId, inviteeId }, service)` → set `completed_at = now()` on every open
  to-do with that `zoom_invitee_id` and write one `source_completed` line ("A Zoom link was given.")
  per closed to-do; conditional on still open. Returns closed ids.
- A `ZoomLinkWriteError` like `MusicLinkWriteError`: the invitee change happened, the to-do did not.

### Task 19: Wire into the routes
**Files:** `app/api/zoom/invitees/route.ts`, `app/api/zoom/invitees/[id]/link/route.ts` (modify)
- POST hand-out with no link → `createWaitingLinkTodo` for `user.id`; include `waitingTodoId` in the
  audit detail. With a link → nothing.
- POST give-link success → `closeWaitingLinkTodos`; include `closedTodoIds` in the audit detail.
  Note the to-do may belong to a different bishopric member than the one giving the link — closing
  it is correct either way, because the job it asked for is done.
- On `ZoomLinkWriteError` respond 500 with its sentence (the link was still given).

### Task 20: To-do read model
**File:** `lib/todos/queries.ts` (modify)
- Add `zoom_invitee_id` to both column lists and map `zoomLink: { inviteeId } | null` on the to-do
  type (rule 9). Update every construction site the type checker flags.

### Task 21: To-do card and delete refusal
**Files:** `app/(app)/todos/TodoCard.tsx`, the delete route/lib (modify)
- Mirror exactly what is done for `musicLink`: no checkbox while open; a link "Open Zoom" to
  `/zoom?from=todos` (the page remembers the last tab; that is acceptable); the delete control
  refused while open with a sentence ("This closes itself once they're given a link.").
- Find the music refusal with `grep -rn "musicLink\|music_sunday_id" app/api/todos lib/todos` and add
  the Zoom condition beside it, not a second mechanism.

### Task 22: Hand-out sentence
**File:** `app/(app)/zoom/HandOutModal.tsx` (modify) — restore the to-do clause from Task 15.

**Validate (z2c):** lint, typecheck, z2c tests, build. Stop for the user to commit.

## Testing Strategy

Follow CLAUDE.md §8: RLS first, then pure functions, then routes. Seed with `seedFixtures`, clean up
in `afterAll`, assert refused writes by **re-reading** with the service client. Negative-path data
must pass every earlier check (a valid uuid, a valid body) so it is refused for the reason under
test.

**z2a**
- `tests/rls/zoom-link-pool.test.ts` (create)
  - Bishop, counselor1, counselor2, wardSecretary, executiveSecretary each read ward A's pool rows'
    granted columns; `org_president` and a ward-B bishop read zero rows.
  - **Every authenticated role, the bishop included, gets an error selecting `join_url`** (expect
    a permission error, SQLSTATE 42501) — and the control: the same query without `join_url` succeeds.
  - No authenticated client can insert, update or delete a pool row or an invitee row (re-read).
  - `assign_next_zoom_link` and `remove_unassigned_zoom_link` cannot be executed by `authenticated`.
  - `assign_next_zoom_link` via service: two invitees, one free link → exactly one gets it; calling
    it twice for one invitee does not take a second link; a link is never given to a ward-B invitee.
  - `remove_unassigned_zoom_link` removes a free link and refuses a given one.
- `tests/lib/joinLinkPaste.test.ts` (create) — comma, tab and mixed column orders; uppercase email
  lower-cased; each problem kind with its line number; duplicates within one paste; blank lines
  skipped.
- `tests/lib/joinLinkPool.test.ts` (create) — `describePoolLevel` at 0, 1, 5, 6 (boundary), wording.
- `tests/routes/zoom-join-links.test.ts` (create) — preview writes nothing; apply adds; re-applying
  reports `alreadyInPool`; apply with problems is 400 and writes nothing; clerk gets 403 on POST and
  DELETE; DELETE of a given link is 409 and the row survives; no response body contains `https://`.
- Update: `tests/lib/permissions.test.ts`, `tests/db/module-release-policies.test.ts` (should pass
  unchanged once the catalog and policies agree — run it), any `ZoomTabs` / zoomView test.

**z2b**
- `tests/rls/zoom-invitees.test.ts` (create) — the viewer set reads ward A invitees; org president
  and ward B read none; nobody writes.
- `tests/lib/joinLinkMessage.test.ts` — first-name extraction, under the SMS threshold with a
  2000-char URL? (assert the threshold flag rather than a hard limit), contains the URL once.
- `tests/routes/zoom-invitees.test.ts` — hand-out to a member and to a typed name each take the
  next free link; an inactive member id → 400 and nothing written; another ward's member id → 400;
  empty pool → 201 with `joinUrl: null` and the invitee waiting; PATCH writes `changedFields` names
  only (read the audit row: no phone/email/notes values); clerk 403 on every write and on `GET …/link`;
  give-link with an empty pool → 409; audit rows never contain `https://`.
- `tests/components/zoom/LinkHandoff.test.tsx` — Share absent without `navigator.share`; QR renders
  an `<img>` with a `data:image/png` source; AbortError shows no error.

**z2c**
- `tests/routes/zoom-invitees.test.ts` (extend) — empty-pool hand-out creates exactly one open to-do
  on the actor's list with `zoom_invitee_id`; repeating the give-link after links are pasted closes
  it with a `source_completed` line; a to-do owned by counselor1 is closed when counselor2 gives the
  link.
- `tests/routes/todos-*.test.ts` (whichever covers delete refusal for music) — an open Zoom to-do
  refuses delete; a completed one deletes.
- A source-read test is NOT needed: there are exactly two writers and both are in this plan.

## Test Scenarios (Harness)

### Scenario 095: Zoom link pool, hand-out and invitees
**Location:** `testing/scenarios/zoom/scenario-095-zoom-link-pool/` (`scenario.md`, `seed.ts`) — copy
the shape of `scenario-094-zoom-remote-links`.
**Tags:** zoom, full, permissions, mobile
**Purpose:** Proves the bishopric can stock the pool and hand out links on a phone, that an empty
pool saves the person as waiting with a to-do, and that the clerk sees the list without any way to
read a link. Seeding helps because it needs a nearly-empty pool, given and waiting invitees, and
five callings.
**Seed data summary:**
- Callings — bishop, counselor1, counselor2, ward clerk, executive secretary, EQ president (as 094)
- Members — the harness roster, including one **moved-out** member "Lena Ortiz" (must not appear in the picker)
- `zoom_join_links` — 3 rows: "Guest 01" given, "Guest 02" free, "Guest 03" free (URLs `https://example.org/j/guest0N`)
- `zoom_invitees` — 1 given (a roster member, Guest 01, given by the bishop), 0 waiting
**Tester action:**
1. As counselor1 on a phone-width window (375px): Zoom → Invitees → Give a Zoom link → pick a roster
   member → Give link. Try Text it, Share, Show QR.
2. Give a link to a typed non-member. Read the low-pool sentence.
3. Give a link to a third person with the pool now empty. Read the waiting sentence; open To Do.
4. Link pool → Paste links: paste 3 lines, one with no email. Fix it, add. Read the "waiting" sentence.
5. Invitees → the waiting row → Give a link. Open To Do again.
6. Edit an invitee's phone. Remove a free link with ✕; look for ✕ on a given link.
7. Sign in as the clerk: open Zoom, read the tabs and the list.
8. Sign in as the EQ president: open the Zoom tile, or `/zoom` directly.
**Verification checklist:**
- [ ] Lena Ortiz does not appear in the picker; typing her name as a non-member works
- [ ] Each hand-out gets the next free placeholder (Guest 02, then Guest 03)
- [ ] Text it opens Messages with the URL in the body on a phone; on desktop it shows Copy and the explanation
- [ ] The QR code scans to the right `example.org/j/…` link
- [ ] After the second hand-out the page says no links are left
- [ ] The third person is listed under Waiting for a link and a "Give ___ a Zoom link" to-do is on counselor1's list, with no checkbox and no working delete
- [ ] The paste preview names the bad line by number and Add is blocked until it is fixed
- [ ] After pasting, the result says 1 person is waiting; Give a link gives them one and the to-do closes with a timeline line
- [ ] ✕ removes a free link; a given link has no ✕
- [ ] The clerk sees Remote control and Invitees only, with names and placeholders and no buttons
- [ ] The EQ president sees no Zoom tile and `/zoom` refuses them
- [ ] No page shows a join URL except inside the hand-off window
- [ ] Nothing overflows sideways at 375px

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests — the new and touched files first, then the full suite in foreground chunks
npx vitest run tests/rls/zoom-link-pool.test.ts tests/rls/zoom-invitees.test.ts tests/lib/joinLinkPaste.test.ts tests/lib/joinLinkPool.test.ts tests/lib/joinLinkMessage.test.ts tests/routes/zoom-join-links.test.ts tests/routes/zoom-invitees.test.ts tests/components/zoom tests/lib/permissions.test.ts tests/db/module-release-policies.test.ts tests/rls/ward-isolation.test.ts tests/lib/explicitTimeZone.test.ts tests/lib/navigationRoutesExist.test.ts
npm test

# Production build
npm run build
```

Run the full suite in foreground chunks under 10 minutes if background shells are unavailable (the
zoom-remote-links retro). A route file that fails on the hosted auth rate limit should be re-run alone
before it is believed.

## Integration Notes

- **Migration 095 applies before any code that reads it is deployed**, which is safe: it only adds
  tables and a nullable `todos` column. Nothing is held back.
- **Column grants are new to this codebase.** Any future query on `zoom_join_links` must name its
  columns; `select("*")` or a PostgREST embed requesting `join_url` through the user's client errors.
  Say this in the table's comment and in CLAUDE.md.
- **ITER-052** will widen `zoom_invitees.source`, add a referred-by column, and call
  `assign_next_zoom_link()` from the public page's approval — the waiting state (D1) is already
  shaped for it.
- **ITER-054** adds attendance rows keyed on `zoom_invitees.id` (never the link) and fills
  `lastWatchedOn` / `sundaysWatched` on read.
- **Documentation:** add a CLAUDE.md §9 entry after the ITER-051 one, in its style: the pool and
  invitees (migration 095), D1–D4, P1–P6, and the column-grant warning. Update the Zoom row and §6 in
  `plans/prototype/module-map.md` (Task 9). `/execute` writes the retro.
- **Not built, and say so in the CLAUDE.md entry:** taking a link back (D2), pausing a link, a
  low-pool notification (P1), deleting an invitee, Zoom API registration.
