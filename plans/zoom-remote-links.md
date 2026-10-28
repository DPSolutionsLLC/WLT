# Plan: Zoom tile and each leader's stream remote-control link

**Created:** 2026-10-27
**Type:** feature
**Scope refs:** ITER-051

## Overview

The ward streams sacrament meeting on Zoom. The user built a **separate app** that lets leaders
control the live stream from a phone, and each leader gets a **unique link** into it. This plan
adds a **Zoom** tile whose first screen is a **Remote control** button that opens the reader's
own link, plus a bishopric-only tab where those links are pasted, replaced and turned off. The
remote-control app itself is out of scope; this stores a link and opens it.

This is the first slice of the Zoom module (GROUP-05: 051 → 053 → 052 → 054). It needs none of
P10's Zoom infrastructure (OAuth, webhooks, OBS).

### Decisions settled with the user (2026-10-27)

| # | Question | Decision |
|---|---|---|
| D1 | Where the links are managed | A **"Remote links" tab on the Zoom page**, visible to the bishop and counselors only. Not Admin: Admin is unreleased in Buffalo Ward, so a bishop there could not reach it. It also matches the prototype's Zoom navigation shape (tabs, module-map §6). |
| D2 | Notify the bishopric when a link turns off on a holder change | **No.** The tab marks the row "Needs a new link". No notification trigger is added. |
| D3 | May the bishopric read a link back after pasting it | **Never.** Write-only. **Only the holder can read their own link**, and RLS enforces it — there is no bishopric arm on the SELECT policy. The tab shows status only ("Link set 27 Oct by Bishop Smith"). |
| D4 | A manual way to stop a link | **Yes — Turn off**, audited, for a lost phone or a leaked link. |
| D5 | Does a counselor re-number (1st ↔ 2nd) count as a holder change | **Yes** (the scope's own expectation). The link belongs to the POSITION, so a swap turns both links off. This falls out of the rule below with no special case. |

### The five positions

| Position key | Label | Calling (`ward_role_assignments`) |
|---|---|---|
| `bishop` | Bishop | `role = 'bishop'` |
| `counselor_1` | 1st Counselor | `role = 'counselor' and counselor_position = 1` |
| `counselor_2` | 2nd Counselor | `role = 'counselor' and counselor_position = 2` |
| `ward_clerk` | Ward Clerk | `role = 'ward_secretary'` |
| `executive_secretary` | Executive Secretary | `role = 'executive_secretary'` |

"Ward Clerk" is the label the user used. `ROLE_LABELS.ward_secretary` says "Ward Secretary" and
is **not** changed here (out of scope). The position labels are their own constant.

### The rule that makes "holder changed" work — read this before anything else

A link row is bound to **the calling it was pasted for** (`holder_calling_id`). It is **live**
only while all of these hold, checked **on every read, by RLS**:

1. the row is not turned off (`deactivated_at is null`, which also means `url is not null`);
2. the calling `holder_calling_id` is still active, belongs to `auth.uid()`, is in
   `current_ward_id()`, and its account is active;
3. that calling's role and counselor position **still match the row's position**.

Rule 3 is needed because a role or counselor-number change **updates the same calling row in
place** (`updateCalling()` in `lib/callings/writeCalling.ts`). Binding to the calling id alone
would let the old 1st counselor keep the 1st counselor's link after a swap.

**Computed on read is the security guarantee** — the project has no triggers and no scheduler, so
nothing could be relied on to clear a stored flag. **Stamping on write is what makes it permanent.**
Without a stamp, a swap that is later undone, or a released calling that is reinstated
(`PATCH /api/callings` with `isActive: true` calls `updateCalling`), would silently revive the old
link. So `updateCalling()` and `endCalling()` also call one shared function that turns off
every link bound to that calling whose position no longer matches. They are the **only two
functions in the codebase that change an existing calling** (verified 2026-10-27: their callers are
`lib/auth/adminUsers.ts` and `app/api/callings/route.ts`). A source-read test keeps it that way.

A deleted user cascades their callings away; `holder_calling_id` is `on delete set null`, which
fails rule 2. A **deactivated account** keeps its calling (CLAUDE.md §7: separate facts), so the
link is unreachable while the account is off and returns if the **same person** is reactivated.
That is correct: the person did not change.

### Success criteria

- A Zoom tile appears for the bishop, both counselors, the ward clerk and the executive secretary,
  in a ward that has released Zoom. The page opens on a Remote control button.
- Each of the five sees **only their own** button state. Pressing it opens their link in a new
  tab. The link text appears nowhere in the page's HTML.
- With no live link, the button area says "No remote link set — ask the bishopric."
- A person holding none of the five positions sees "Your calling has no stream remote."
- The bishop and counselors see a **Remote links** tab listing the five positions, each with the
  holder's name and email (or "No one called"), a status line, and small buttons: **Paste link** /
  **Replace link** (each opens a window) and **Turn off**.
- Releasing a calling, changing its role, or swapping counselor numbers turns the affected links off
  at once. The new holder sees "No remote link set" until a fresh link is pasted, and the tab says
  "Needs a new link".
- An RLS test proves: the holder reads their link; the bishop cannot read a counselor's link; the
  clerk cannot read the bishop's; no client can write the table at all; ward B cannot read ward A.
- Every set, replace and turn-off writes an audit row. **The URL never appears in an audit row.**

## Relevant Files

**Create**
- `supabase/migrations/094_zoom_remote_links.sql` — the table, its SELECT-only policy, the holder
  helper, the release policy.
- `lib/zoom/remoteLinkPositions.ts` — the five positions, labels, `positionForCalling()`.
- `lib/zoom/remoteLinks.ts` — reads and writes (holder's own state, admin rows, set, turn off,
  `retireRemoteLinksForCalling()`).
- `lib/zoom/remoteLinkRow.ts` — pure `describeRemoteLinkRow()` for the tab's status line.
- `lib/zoom/access.ts` — `canManageRemoteLinks(user, roleAccess)`.
- `lib/validation/zoom.ts` — Zod schemas.
- `app/(app)/zoom/page.tsx` — the Zoom page (Server Component).
- `app/(app)/zoom/ZoomTabs.tsx` — client tabs; remembers the tab through the page-view setting.
- `app/(app)/zoom/RemoteControlPanel.tsx` — the button and its "no link" states.
- `app/(app)/zoom/RemoteLinksPanel.tsx` — the bishopric tab (rows, windows, Turn off).
- `app/api/zoom/remote-control/route.ts` — `GET`: redirects to the reader's own live link.
- `app/api/zoom/remote-links/[position]/route.ts` — `PUT` (set/replace) and `DELETE` (turn off).
- `tests/lib/remoteLinkPositions.test.ts`
- `tests/lib/remoteLinkRow.test.ts`
- `tests/lib/remoteLinkRetireSites.test.ts` — source-read guard.
- `tests/rls/zoom-remote-links.test.ts`
- `tests/routes/zoom-remote-links.test.ts`
- `tests/components/zoom/RemoteControlPanel.test.tsx`
- `testing/scenarios/zoom/scenario-094-zoom-remote-links/` (scenario files per `_templates`).

**Modify**
- `types/domain.ts` — add `"zoom"` to `RELEASED_MODULE_KEYS`; add `RemoteLinkPosition` types.
- `types/database.ts` — regenerate (`npm run db:types`), never hand-edit.
- `lib/auth/permissions.ts` — add `zoom.view`, `zoom.manage_remote_links`; grant; lock the second.
- `lib/access/releasedModules.ts` — add the `zoom` module entry.
- `lib/auth/navigation.tsx` — add the Zoom row; update the stale "Message and Zoom have no rows
  yet" comment on the `tasks` section.
- `lib/access/accessModules.ts` — comment only: `zoom` is still deliberately not requestable, now
  because the invitee half (ITER-053) is not built. No module added.
- `lib/callings/writeCalling.ts` — `updateCalling()` and `endCalling()` call
  `retireRemoteLinksForCalling()`; both param types gain a required `actorUserId`.
- `lib/auth/adminUsers.ts` — `updateWardUser()` takes and passes `actorUserId`.
- The admin users route that calls `updateWardUser()` (find it: `grep -rn "updateWardUser(" app`)
  — pass `user.id`.
- `app/api/callings/route.ts` — pass `actorUserId: user.id` to `updateCalling` / `endCalling`.
- `lib/validation/pageView.ts` — add the `zoom` page view.
- `tests/lib/permissions.test.ts` (and any matrix snapshot that lists every permission) — expect
  the two new permissions.
- `SPEC.md`, `FEATURES.md`, `CLAUDE.md` §9, `plans/prototype/module-map.md` (Zoom row and §6),
  `plans/P10-message-and-zoom.md` — docs (Task 13).

## Dependencies

- **No new libraries.** `lucide-react`'s `Video` icon (import it by name).
- Existing: `requireSessionUser`, `resolveRoleAccess`, `can`/`assertCan`, `writeAuditLog`,
  `createServiceSupabaseClient`, `respondToRouteError`, `readJsonBody`, `Modal`, `Button`,
  `Card`, `StatusTag`, `readPageView`/`writePageView` (`lib/users/userSettings.ts`) and
  `POST /api/session/page-view`.
- **Configuration:** none. After deploy, Buffalo Ward has a release list, so **Zoom is hidden
  there until the super admin ticks it** on Stakes & Wards → Edit released modules (see
  Integration Notes).

## Known Pitfalls (from retro context)

- **sacrament-music-people** — a table with **a SELECT policy and no write policy** means every
  write goes through the service role behind a route, so **the route's gate is the boundary for
  writes**. It can never be skipped. Check any member or user id the request names through the
  caller's ward, never trust the body.
- **ward-callings-model** — "who holds this role in this ward" **reads callings**
  (`ward_role_assignments` joined to `users.is_active`), never `users.role` (dropped in 071). A
  person may hold callings in several wards: always filter on the ward being acted in.
- **sacrament-planner-adapter** — **the tile follows the calling, not the super admin flag.**
  The bishopric-only tab gates on `can()` **and** a bishopric calling (`canUsePlanner()`'s shape
  in `lib/sacramentPlanner/access.ts`), so a super admin whose calling here is not bishopric
  cannot manage links. They still see the Zoom tile (can() bypass) and get "Your calling has no
  stream remote" — harmless, and it matches every module except the Planner.
- **released-modules-per-ward** — a new module must add its **prefix, routes and tables to the
  catalog AND a restrictive policy in a migration**. `tests/db/module-release-policies.test.ts`,
  `tests/lib/releasedRoutesCovered.test.ts` and the import-time `assertPermissionsArePlaced()` fail
  otherwise. Also: **line endings** — edit with the Edit tool; a Python rewrite to CRLF broke a
  source-reading test once.
- **060-D2 (CLAUDE.md §9)** — WITH CHECK raises, USING returns zero rows. This table has no
  client write policies, so it does not arise. Do not add an UPDATE policy "for convenience".
- **`writeAuditLog()` redacts any detail key matching `token|note|key|…`.** Name keys
  `position`, `holderUserId`, `previousHolderUserId`, `reason`. **Never put the URL in `detail`
  under any key.**
- **Rule 12** — every date formatter names its zone. A "when was this set" stamp shown as a date
  renders in **UTC** (CLAUDE.md rule 12's second case); `tests/lib/explicitTimeZone.test.ts`
  enforces the explicit `timeZone`.
- **Memory is tight (7.7 GB).** Do not run the build and the dev server together; stop the dev
  server before the full suite.

## Tasks

### Task 1: The migration
**File:** `supabase/migrations/094_zoom_remote_links.sql` (create)
**Action:** Create the table, one helper function, one SELECT policy, the release policy.
**Details:**
- Header comment in the style of 089/093: what it is, why SELECT-only, why holder-only reads (D3),
  why computed-on-read plus stamp-on-write (the rule above).
- Table:
  ```sql
  create table zoom_remote_links (
    id                 uuid        primary key default gen_random_uuid(),
    ward_id            uuid        not null references wards (id) on delete cascade,
    position           text        not null check (position in
                         ('bishop', 'counselor_1', 'counselor_2', 'ward_clerk', 'executive_secretary')),
    url                text        check (url is null or (url ~ '^https://' and char_length(url) <= 2000)),
    holder_calling_id  uuid        references ward_role_assignments (id) on delete set null,
    set_by             uuid        references users (id) on delete set null,
    set_at             timestamptz not null default now(),
    deactivated_at     timestamptz,
    deactivated_reason text        check (deactivated_reason in ('holder_changed', 'turned_off')),
    deactivated_by     uuid        references users (id) on delete set null,
    constraint zoom_remote_links_one_per_position unique (ward_id, position),
    constraint zoom_remote_links_off_has_no_url
      check ((deactivated_at is null) = (url is not null)),
    constraint zoom_remote_links_off_has_reason
      check ((deactivated_at is null) = (deactivated_reason is null))
  );
  ```
  **A turned-off row holds no URL.** The capability is not kept once it is off; reviving it needs a
  fresh paste. Every user FK is single-column `on delete set null` (never composite —
  ward-callings-model / migration 069).
- `remote_link_position_matches(p_role text, p_counselor_position integer, p_position text)
  returns boolean language sql immutable` — the position table above as a `case`.
- `holds_remote_link(p_calling_id uuid, p_position text) returns boolean language sql stable
  security definer set search_path = public, pg_temp`:
  `exists (select 1 from ward_role_assignments c join users u on u.id = c.user_id where c.id =
  p_calling_id and c.user_id = auth.uid() and c.ward_id = current_ward_id() and c.is_active and
  u.is_active and remote_link_position_matches(c.role, c.counselor_position, p_position))`.
  `revoke all … from public; grant execute … to authenticated, service_role;` (091's shape).
- RLS on. **One** policy:
  ```sql
  create policy zoom_remote_links_select on zoom_remote_links
    for select to authenticated
    using (ward_id = current_ward_id()
           and deactivated_at is null
           and holds_remote_link(holder_calling_id, position));
  ```
  **No insert, update or delete policy.** No bishopric arm (D3).
- Release policy in 091's exact shape:
  `create policy zoom_remote_links_module_released on zoom_remote_links as restrictive for all to
  authenticated using ((select ward_module_released('zoom'))) with check ((select
  ward_module_released('zoom')));`
- Not added to the realtime publication (nothing subscribes).
- Apply: `npx supabase db push --dry-run`, then `npx supabase db push` (retry on a connection
  timeout). Then `npm run db:types`.

### Task 2: Domain types and the position mapping
**Files:** `types/domain.ts` (modify), `lib/zoom/remoteLinkPositions.ts` (create)
**Action:** Add the module key and the position vocabulary.
**Details:**
- `types/domain.ts`: append `"zoom"` to `RELEASED_MODULE_KEYS`. Add
  `export const REMOTE_LINK_POSITIONS = ["bishop", "counselor_1", "counselor_2", "ward_clerk",
  "executive_secretary"] as const;` and `export type RemoteLinkPosition`. Keep the order: it is
  the order the tab lists them.
- `lib/zoom/remoteLinkPositions.ts`:
  - `REMOTE_LINK_POSITION_LABELS: Record<RemoteLinkPosition, string>` — the labels table above.
  - `positionForCalling(role: Role, counselorPosition: 1 | 2 | null): RemoteLinkPosition | null` —
    the TypeScript mirror of `remote_link_position_matches`. A counselor with a null position
    maps to **null** (no remote), never to a guess.
  - `callingMatchesPosition(role, counselorPosition, position): boolean` —
    `positionForCalling(...) === position`.

### Task 3: Permissions
**File:** `lib/auth/permissions.ts` (modify)
**Action:** Add two permissions and grant them.
**Details:**
- Add `"zoom.view"` and `"zoom.manage_remote_links"` to `PERMISSIONS`.
- Grant `zoom.view` to the bishopric list (bishop and counselor resolve identically — CLAUDE.md
  rule 10), `ward_secretary` and `executive_secretary`. Grant `zoom.manage_remote_links` to the
  bishopric only. Follow how existing grants are written in the per-role lists.
- Add `permission === "zoom.manage_remote_links"` to `NON_OVERRIDABLE_PERMISSIONS`, with a
  one-line *why* comment beside the others: a ward must not be able to hand the stream's remote
  controls to another calling.
  `zoom.view` stays overridable. It is **not** offered as an access module (Task 4b).
- `super_admin` holds every permission already (`SUPER_ADMIN_PERMISSIONS is PERMISSIONS`). Nothing
  to do.
- Update `tests/lib/permissions.test.ts` and any table there that lists each role's exact
  permissions. Assert: those four roles hold `zoom.view`; only bishop and counselor hold
  `zoom.manage_remote_links`; it is in `NON_OVERRIDABLE_PERMISSIONS`; a ward delta adding it to
  `org_president` has no effect after `mergeRoleAccess`.

### Task 4: The released-modules catalog and navigation
**Files:** `lib/access/releasedModules.ts`, `lib/auth/navigation.tsx`, `lib/access/accessModules.ts` (modify)
**Details:**
- (a) `RELEASED_MODULES` — add:
  ```ts
  {
    key: "zoom",
    label: "Zoom",
    description: "Each leader's stream remote control.",
    built: true,
    permissionPrefixes: ["zoom."],
    routePrefixes: ["/zoom"],
    tables: ["zoom_remote_links"],
  },
  ```
  `/api/zoom/*` is not a page route, so nothing else is needed for `releasedRoutesCovered`.
- `NAVIGATION_ITEMS` — add, in the `tasks` group after My Appointments:
  `{ label: "Zoom", href: "/zoom", permission: "zoom.view", section: "tasks", blurb: "Your remote
  control for the sacrament meeting stream.", icon: <Video />, accent: "gold", built: true }`.
  Update the `tasks` section comment that says Message and Zoom have no rows yet (Message still
  has none).
- (b) `accessModules.ts` — change only the "deliberately absent" comment: `zoom` now has a
  module, but its remote links are locked and its invitee half is unbuilt, so it is still not
  requestable. Revisit with ITER-053.

### Task 5: Validation
**File:** `lib/validation/zoom.ts` (create)
**Details:**
- `remoteLinkPositionSchema = z.enum(REMOTE_LINK_POSITIONS)`.
- `setRemoteLinkSchema = z.object({ url: … })` — trim, 1–2000 characters, must parse as a URL and
  use `https:`. Zod 4: `z.string().trim().max(2000).pipe(z.url({ protocol: /^https$/ }))` — check
  the installed Zod's API before relying on it, and give the refusal a sentence: "Paste the full
  link, starting with https://."
- No body for DELETE.

### Task 6: Data access
**Files:** `lib/zoom/remoteLinks.ts`, `lib/zoom/access.ts` (create)
**Details:**
- `lib/zoom/access.ts`: `canManageRemoteLinks(user, roleAccess)` =
  `can(user, "zoom.manage_remote_links", roleAccess) && BISHOPRIC_ROLES.includes(user.role)`.
  Copy `canUsePlanner()`'s shape and comment why the role check exists (super admin bypass).
- `lib/zoom/remoteLinks.ts` (snake → camel mapped once here):
  - `readOwnRemoteLinkState(supabase, user): Promise<"live" | "none" | "no_position">` — the
    **caller's** client. `positionForCalling(user.role, user.counselorPosition)`; if null →
    `"no_position"`. Otherwise `select id` (never `url`) where `position = …`; RLS decides. A row
    → `"live"`, else `"none"`.
  - `readOwnRemoteLinkUrl(supabase, user): Promise<string | null>` — the caller's client, selects
    `url`. Used by the redirect route **only**.
  - `listPositionHolders(wardId, service)` — active callings in that ward joined to active users,
    with role in `bishop | counselor | ward_secretary | executive_secretary`, returning
    `{ callingId, userId, firstName, lastName, email, position }` grouped by position via
    `positionForCalling`. Service role, because it runs after the gate and the tab must see
    everyone's status. **Select no `url` anywhere in this function.**
  - `listRemoteLinkRows(wardId, service)` — selects every column **except `url`**, plus
    `url is not null` as a boolean if needed (status comes from `deactivated_at`). Resolve
    `set_by`, `deactivated_by` and the bound calling's user to display names.
  - `setRemoteLink({ wardId, position, url, actorUserId }, service)` — reads the current holders;
    **refuses** with an `InvalidInputError` (409 at the route) when there are 0 ("No one holds
    this calling, so there is nobody to give a link to.") or more than 1 ("More than one person
    holds this calling. Fix the callings first, then paste the link."). Otherwise **upserts** on
    `(ward_id, position)`: `url`, `holder_calling_id`, `set_by`, `set_at = now()`, and nulls all
    three `deactivated_*`. Returns `{ replaced: boolean, holderUserId, previousHolderUserId }`
    (from the row before the write) for the audit row.
  - `turnOffRemoteLink({ wardId, position, actorUserId }, service)` — update where `deactivated_at
    is null`: `url = null`, `deactivated_at = now()`, `deactivated_reason = 'turned_off'`,
    `deactivated_by`. Returns null when nothing was live (the route's 404).
  - `retireRemoteLinksForCalling({ calling, actorUserId }, service)` — **the one shared
    function for holder changes.** Finds live rows with `holder_calling_id = calling.id`. For each,
    if `!calling.isActive || !callingMatchesPosition(calling.role, calling.counselorPosition,
    row.position)`, sets `url = null`, `deactivated_at = now()`, `deactivated_reason =
    'holder_changed'`, `deactivated_by = actorUserId`, and writes an audit row
    `zoom_remote_link_turned_off` (module `zoom`, detail `{ position, reason: "holder_changed",
    previousHolderUserId: calling.userId }`) with the service client. Returns the positions
    retired. **Errors are logged and thrown, never swallowed** (rule 7): a calling change that
    could not retire a link must fail loudly. The SELECT policy still protects the link in that
    case; say so in the comment.

### Task 7: Turn links off when a calling changes
**Files:** `lib/callings/writeCalling.ts`, `lib/auth/adminUsers.ts`, the admin users route,
`app/api/callings/route.ts` (modify)
**Details:**
- `UpdateCallingParams` and `EndCallingParams` gain **required** `actorUserId: string`. Required
  on purpose: a missing one is a compile error (ITER-005's lesson: a default is how a check comes
  to be skipped).
- After a successful update in `updateCalling()` and `endCalling()`, when a calling came back,
  call `retireRemoteLinksForCalling({ calling, actorUserId }, service)`.
- Add a short note under the file's "NO AUDIT ROW IS WRITTEN HERE" header: the calling change is
  still audited by the route; the link retirement is a **different** mutation and is audited by
  `retireRemoteLinksForCalling()`.
- `updateWardUser()` gains `actorUserId` in its params and passes it on. Find its route
  (`grep -rn "updateWardUser(" app`) and pass `user.id`.
- `app/api/callings/route.ts`: pass `actorUserId: user.id` to both calls.
- `createCalling()` is **not** changed. A new calling creates no link and cannot strand one. If a
  second bishop is called while the first still holds the calling, the first keeps the link and
  the tab shows "More than one person holds this calling".

### Task 8: The status line (pure)
**File:** `lib/zoom/remoteLinkRow.ts` (create)
**Details:**
- `describeRemoteLinkRow({ holders, link, timeZone: "UTC" })` returns
  `{ state, holderLine, statusLine, canPaste, canTurnOff }`, where `state` is one of:
  - `vacant` — no holder. holderLine "No one called". `canPaste: false`.
  - `multiple_holders` — more than one. statusLine "More than one person holds this calling."
    `canPaste: false`.
  - `no_link` — one holder, no row or a row that was never set. statusLine "No link set."
  - `live` — one holder, row live, `holder_calling_id === holder.callingId`. statusLine
    "Link set 27 Oct 2026 by Bishop Smith." `canTurnOff: true`.
  - `needs_new_link` — row deactivated with reason `holder_changed`, **or** live but bound to a
    different calling than the current holder (the computed case, e.g. a writer that bypassed
    Task 7). statusLine "Needs a new link — the last one was for Peter Nakamura." Use "someone no
    longer in this calling" when the name is gone.
  - `turned_off` — reason `turned_off`. statusLine "Turned off 27 Oct 2026 by Bishop Smith."
- Dates are formatted with `Intl.DateTimeFormat("en-US", { day, month: "short", year, timeZone:
  "UTC" })` — a date-only "when did this happen" stamp is UTC (rule 12).
- Holder line: "Peter Nakamura · peter@example.org" (email omitted when null; never "undefined").
- Never use he/she; names only.

### Task 9: Routes
**Files:** `app/api/zoom/remote-control/route.ts`, `app/api/zoom/remote-links/[position]/route.ts` (create)
**Details:** follow the existing route shape (`app/api/callings/route.ts`: `requireSessionUser`,
try/catch, `respondToRouteError`, `readJsonBody`, Zod parse). `params` is a Promise (Next 16).
- `GET /api/zoom/remote-control`:
  - `requireSessionUser()`, `resolveRoleAccess(...)`, `assertCan(user, "zoom.view", roleAccess)`.
  - `readOwnRemoteLinkUrl(supabase, user)` through the **caller's** client.
  - Live → `NextResponse.redirect(url, 303)` with headers `Cache-Control: no-store` and
    `Referrer-Policy: no-referrer`. None → redirect to `/zoom?remote=none` (same headers).
  - No audit row: opening is a read, not a mutation.
- `PUT /api/zoom/remote-links/[position]`:
  - Parse the position with `remoteLinkPositionSchema` (400 with a sentence) and the body with
    `setRemoteLinkSchema`.
  - Gate: `canManageRemoteLinks(user, roleAccess)`, else 403. **This is the write boundary.**
  - `setRemoteLink({ wardId: user.wardId, … }, createServiceSupabaseClient())`. Map the two refusals
    to **409** with their sentences.
  - Audit: action `zoom_remote_link_replaced` when `replaced`, else `zoom_remote_link_set`; module
    `zoom`; detail `{ position, holderUserId, previousHolderUserId }`. **No URL.**
  - Respond `{ row }` shaped like the tab's row (no URL), so the client can update without a
    refetch.
- `DELETE /api/zoom/remote-links/[position]`:
  - Same gate. `turnOffRemoteLink(...)`. Null → **404** "There is no live link for that position."
  - Audit `zoom_remote_link_turned_off`, detail `{ position, reason: "turned_off",
    previousHolderUserId }`.

### Task 10: The page
**Files:** `app/(app)/zoom/page.tsx`, `ZoomTabs.tsx`, `RemoteControlPanel.tsx`,
`RemoteLinksPanel.tsx` (create); `lib/validation/pageView.ts` (modify)
**Details:**
- `page.tsx` (Server Component): `requireSessionUser`, `resolveRoleAccess`; `can(user,
  "zoom.view")`, else render `NotPermitted` (can(), not assertCan — a thrown ForbiddenError in a
  Server Component is a stripped 500). Read `readOwnRemoteLinkState`. If
  `canManageRemoteLinks`, read holders and rows with the **service** client and map each through
  `describeRemoteLinkRow`. Read the remembered tab with `readPageView(user.id, "zoom")`, parsed by
  its schema, defaulting to `remote`. Pass `searchParams.remote === "none"` down so the panel can
  say the link was not found.
- `pageView.ts`: add `z.object({ page: z.literal("zoom"), view: z.object({ tab:
  z.enum(["remote", "links"]) }) })`. A reader without the bishopric role who has `links` stored
  falls back to `remote`.
- `ZoomTabs.tsx` (client): a tablist **only when the reader can manage links**. Otherwise render
  the Remote control panel alone, with no tab bar. On change, `POST /api/session/page-view` (look
  at `app/(app)/appointments` for how it is called) and surface a failure in a `FormError`, never
  silently. Accessible tabs: `role="tablist"`, `role="tab"`, `aria-selected`, arrow-key movement
  (see `app/(tithing)/tithing/TithingCounter.tsx`).
- `RemoteControlPanel.tsx`: at the top of the page, one large button **"Remote control"**
  rendered as `<a href="/api/zoom/remote-control" target="_blank" rel="noopener noreferrer">`
  styled with the `Button` primitive's classes. **The URL is never passed to this component.**
  States: `live` → the button; `none` → a disabled-looking line "No remote link set — ask the
  bishopric." (no button); `no_position` → "Your calling has no stream remote."; and when
  `remote=none` came back from the redirect → "That link is no longer set. Ask the bishopric for a
  new one."
- `RemoteLinksPanel.tsx`: one compact row per position, in `REMOTE_LINK_POSITIONS` order (user's
  standing UI preference: results-only rows, small grouped per-item buttons opening windows,
  popups fit content). Each row shows the position label, holder line and status line (a
  `StatusTag` for `live` / `needs_new_link` / `turned_off`), and buttons **Paste link** (`no_link`,
  `needs_new_link`, `turned_off`) or **Replace link** (`live`) plus **Turn off** (`live`). Paste and
  Replace open a `Modal` with one `Input` (type `url`, autocomplete off, **empty** — never
  prefilled) and Save. Turn off asks for confirmation inline ("Turn off Bishop Smith's remote
  link? They lose access straight away."). Errors from the route show in the modal or row with the
  route's sentence. Use the new response row to update in place.
- 375px width, light and dark mode, tokens only (no raw colours). No `timeZone`-less formatter
  anywhere.

### Task 11: Tests
See Testing Strategy. Write them alongside Tasks 1–10, RLS first (CLAUDE.md §8 priority).

### Task 12: Harness scenario
See Test Scenarios. Then `npm run manifest`. A new `testing/scenarios/zoom/` folder is needed.
Check `testing/infrastructure/manifestGenerator.ts` picks up a new area folder. If it lists areas
by hand, add `zoom` there.

### Task 13: Docs
- `plans/prototype/module-map.md` — **do this first, before any code** (CLAUDE.md §12: no slice
  before its row). Zoom row: verdict **NEW (slice 1, ITER-051)** for the remote links, noting the
  remaining CONFLICT half (OAuth/webhook/OBS) is unchanged and GROUP-05 builds the rest without
  the Zoom API. §6: the tabs shape, and that the "Remote links" tab is bishopric-only.
- `plans/P10-message-and-zoom.md` — a short "Built: ITER-051 remote links" note under Zoom.
- `SPEC.md` — the table, the two routes plus the redirect route, the two permissions in the
  matrix, the `zoom` released module.
- `FEATURES.md` — a Zoom section: the Remote control button, who has it, the Remote links tab,
  turning off on a holder change.
- `CLAUDE.md` §9 — one entry, in the house style: **A STREAM REMOTE LINK BELONGS TO A POSITION AND
  ONLY ITS HOLDER CAN READ IT — DECIDED 2026-10-27 (ITER-051, migration 094).** Cover: SELECT-only
  and holder-only (no bishopric arm, D3); computed-on-read plus stamp-on-write and why both;
  `updateCalling`/`endCalling` are the only calling-change writers and the guard test holds them;
  a turned-off row holds no URL; managed on the Zoom tab not Admin (D1); no notification (D2);
  the URL never enters an audit row.
- Retro and `plans/retros/INDEX.md` — written by `/execute`.

## Testing Strategy

**`tests/rls/zoom-remote-links.test.ts`** (highest value; seed with the service client using
`seedFixtures`, assert through each fixture's own client, `fixtures.cleanup()` in `afterAll`).
Insert rows with the service client bound to each fixture's calling id.
- The bishop reads the bishop row (and its `url`).
- **The bishop cannot read `counselor_1`'s row** (D3 — no bishopric arm).
- The ward clerk (`wardSecretary`) reads `ward_clerk`; cannot read `bishop`.
- `counselor1` and `counselor2` each read only their own.
- A ward-B fixture reads nothing from ward A.
- After the service client sets `counselor_position` of `counselor1`'s calling to 2 (the swap,
  **without** going through `updateCalling`, to prove the computed half alone), `counselor1` can no
  longer read `counselor_1`'s row.
- After the service client sets `is_active = false` on the bishop's calling, the bishop reads
  nothing.
- A row with `deactivated_at` set (and `url` null) is not returned to its holder.
- **No client can write:** an INSERT as the bishop raises (RLS refuses inserts loudly). An UPDATE
  and a DELETE as the bishop are zero-row; re-read with the service client and assert unchanged.
- Constraint checks (service client): a `url` of `http://…` is refused; `deactivated_at` set with
  a non-null `url` is refused. **Negative-path data must pass every earlier check**: give these
  rows a valid position and ward so they fail on the constraint under test.
- Unreleased: put ward A on a release list without `zoom` (service client, restore after). The
  holder then reads nothing.

**`tests/routes/zoom-remote-links.test.ts`** (`routeClient` helper; mock only
`@/lib/supabase/server`):
- PUT as bishop for `counselor_1` → 200. Row bound to `counselor1`'s calling. Audit row
  `zoom_remote_link_set` with `position`. **Assert the audit detail serialised as JSON contains
  no part of the URL.**
- PUT again → `zoom_remote_link_replaced`, `deactivated_*` cleared.
- PUT as `wardSecretary` → 403 (holds `zoom.view`, not manage). PUT as the music coordinator → 403.
- PUT with `http://` → 400 with the sentence. PUT with a bad position → 400.
- PUT for a vacant position → 409. Make one vacant by releasing the executive secretary's
  calling through the service client inside the test; re-activate it in cleanup.
- DELETE as counselor → 200, row has `url` null and reason `turned_off`; DELETE again → 404.
- GET `/api/zoom/remote-control` as the holder → 303 with `Location` equal to the URL and
  `Cache-Control: no-store`. As a holder with no live link → 303 to `/zoom?remote=none`. As
  `org_president` (no `zoom.view`) → 403.
- **Holder change through the real writer:** call `updateCalling({ …counselor1, changes: {
  counselorPosition: 2 }, actorUserId })` (service). Assert the `counselor_1` row is now
  `holder_changed` with `url` null, and an audit row `zoom_remote_link_turned_off` exists. Then
  set it back to 1 and **assert the link did not revive** (the stamp's whole purpose). Restore the
  fixture in `finally`.
- `endCalling` then `updateCalling({ isActive: true })` on the bishop: link stays off.

**`tests/lib/remoteLinkPositions.test.ts`** — table-driven over every `Role` × counselor
position: the five match, everything else (including `counselor` with null) is null.

**`tests/lib/remoteLinkRow.test.ts`** — one case per state; `needs_new_link` from both the stamp
and the computed mismatch; the email-null holder line; a set date late on the 26th UTC renders
26 Oct (UTC), not the 27th.

**`tests/lib/remoteLinkRetireSites.test.ts`** — reads source (the `explicitTimeZone` /
`musicReopenSites` precedent):
- `lib/callings/writeCalling.ts`'s `updateCalling` and `endCalling` bodies each call
  `retireRemoteLinksForCalling(`.
- No file under `lib/`, `app/` or `supabase/scripts/` other than `lib/callings/writeCalling.ts`
  calls `.from("ward_role_assignments")` followed by `.update(`. Anchor the test: it must find the
  two calls in `writeCalling.ts`, or it would pass on an empty search.
- No file other than `lib/zoom/remoteLinks.ts` selects or writes `zoom_remote_links`' `url`
  (search `zoom_remote_links` across `app/` and `lib/` and allow only that file).

**`tests/components/zoom/RemoteControlPanel.test.tsx`** — the four states render their sentences.
The `live` state renders a link to `/api/zoom/remote-control` with `target="_blank"` and
`rel` containing `noopener`. **No `https://` string from props appears in the DOM** (the component
takes no URL).

**Existing guards that must stay green:** `permissions`, `accessModules`,
`module-release-policies`, `releasedRoutesCovered`, `released-modules` (RLS),
`navigationRoutesExist`, `navigation`, `explicitTimeZone`, `ward-isolation` (the new table has
`ward_id`, so the exception list is unchanged), `user-author-fks` (all new user FKs are
single-column), `migrations.test.ts`, `ward-callings-write`.

## Test Scenarios (Harness)

### Scenario 094: Zoom remote links
**Tags:** zoom, smoke, permissions
**Purpose:** Prove each leader sees only their own remote button, the bishopric manages the five
links without ever seeing them, and a calling change turns a link off. Seeding helps because the
state needs five callings, links bound to specific callings, and a vacant position. That takes
many steps to set up by hand.
**Seed data summary:**
- Ward with Zoom released (no release list, or one including `zoom`).
- Callings: bishop, 1st counselor, 2nd counselor, ward clerk (`ward_secretary`); **executive
  secretary vacant**; plus an org president.
- `zoom_remote_links`: bishop **live** (link to a harmless test page, e.g.
  `https://example.org/?remote=bishop`); 1st counselor **live**; 2nd counselor **needs a new link**
  (`holder_changed`, bound to a released calling for a seeded former counselor); ward clerk **none**.
**Tester action:**
1. As the bishop: open Zoom → press Remote control → a new tab opens on the bishop's test page.
2. Open the Remote links tab → check the five rows.
3. Replace the 1st counselor's link; Turn off the bishop's link; try to paste for the vacant
   executive secretary.
4. As the 1st counselor: Remote control opens the **new** link.
5. As the ward clerk: no Remote links tab; the button area says "No remote link set — ask the
   bishopric."
6. As the bishop, Admin → Users: change the 1st counselor to 2nd and the 2nd to 1st (or use
   whatever screen changes counselor position). Reopen Remote links.
7. As the org president: no Zoom tile.
**Verification checklist:**
- [ ] The Remote control button opens the reader's own link in a new tab; the page source contains
      no `https://example.org` string.
- [ ] Remote links lists Bishop, 1st Counselor, 2nd Counselor, Ward Clerk, Executive Secretary, in
      that order, each with the holder's name and email; Executive Secretary reads "No one
      called" with no Paste button.
- [ ] 2nd Counselor reads "Needs a new link — the last one was for …".
- [ ] The Paste/Replace window opens empty; an `http://` link is refused with a sentence.
- [ ] After Turn off, the bishop's own button area says "No remote link set — ask the bishopric."
- [ ] The ward clerk sees no tab bar at all, only the remote area.
- [ ] After the counselor swap, both counselor rows read "Needs a new link", and each counselor's
      button area says "No remote link set".
- [ ] The audit log rows for each change carry the position and no link text.
- [ ] Works at 375px, light and dark.
- [ ] The org president has no Zoom tile.

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Focused tests first (each runs against the hosted DB)
npx vitest run tests/rls/zoom-remote-links.test.ts tests/routes/zoom-remote-links.test.ts tests/lib/remoteLinkPositions.test.ts tests/lib/remoteLinkRow.test.ts tests/lib/remoteLinkRetireSites.test.ts tests/components/zoom
npx vitest run tests/lib/permissions.test.ts tests/lib/accessModules.test.ts tests/lib/releasedRoutesCovered.test.ts tests/db/module-release-policies.test.ts tests/lib/navigationRoutesExist.test.ts tests/lib/explicitTimeZone.test.ts tests/rls/ward-isolation.test.ts tests/db/user-author-fks.test.ts tests/db/migrations.test.ts tests/rls/ward-callings-write.test.ts

# Full suite (~50–75 min; stop the dev server first; rerun any timed-out file alone)
npm test

# Production build (never while `npm run dev` is running — 7.7 GB machine)
npm run build
```

## Integration Notes

- **Order:** module-map row (Task 13, first bullet) → migration → types → permissions/catalog →
  data layer → calling hook → routes → page → tests → scenario → docs.
- **The migration is additive** and safe to apply before the deploy. The running build never reads
  the new table. Not a `HELD_BACK_UNTIL_DEPLOYED` case.
- **Breaking-ish change:** `updateCalling` / `endCalling` / `updateWardUser` gain a required
  `actorUserId`. Every caller is listed above. Any test helper calling them directly must pass one
  too (`grep -rn "updateCalling(\|endCalling(\|updateWardUser(" tests testing`).
- **After deploy (runbook, no code):** Buffalo Ward has a release list, so the super admin opens
  Stakes & Wards → Buffalo Ward → Edit released modules → tick **Zoom**. Then, as the bishop or a
  counselor, open Zoom → Remote links and paste each leader's link from the remote app.
- **Open for later GROUP-05 items:** ITER-053 adds the invitee tabs and decides `zoom.view`'s
  reach (bishopric full, clerk and executive secretary read-only), and whether Zoom becomes a
  requestable access module.
- **Not built:** emailing the link, showing the link, notifying on turn-off (D2), anything about the
  remote app, assistant clerks (a second `ward_secretary` calling makes the Ward Clerk row read
  "More than one person holds this calling" — if assistant clerks are common, that is a follow-up
  decision).
