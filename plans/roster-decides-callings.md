# Plan: The ward roster decides who holds which calling

**Created:** 2026-11-11
**Type:** feature
**Scope refs:** ITER-058
**Structure:** One plan, **four slices, four commits** (`cr1` … `cr4`). Each slice ships on its own and
leaves the app working.

| Slice | What it delivers | Ends with |
|---|---|---|
| **cr1** | The LCR calling map, the login ↔ roster link, "Is this you?", and linking on Admin → Users | A user can be linked; nobody's access changes yet |
| **cr2** | The **Calling review** on Admin → Users: roster vs app, ticked items apply. Role editing retired; a super-admin override with a marker | **The done criterion:** the user shows as 2nd Counselor and Chris Haskell as 1st |
| **cr3** | Calling changes on the **roster paste** review checklist | A paste swapping two counselors applies only when ticked |
| **cr4** | Invites tied to a roster person ("Yes, this is me"), and "no account yet" with an Invite button | A new ward clerk is invited from the review |

**Status (2026-11-16):** Task 0 done (title map agreed, below). **cr1 built**: migration **105**
(applied), scenario **103** Part 1. cr2's scenario work extends scenario 103 with a Part 2; cr3/cr4 take
the next free numbers (bishopric-visits bv7 now expects migration 106 and scenario 104 — re-check).
Run vitest from **PowerShell**, not Git Bash (see the retro).

---

## Overview

Today a person's app calling (`ward_role_assignments`) is typed in by hand at invite time and on
Admin → Users. Separately, the roster (`members`) stores everyone's real LCR callings as text,
which nothing reads. The two drift apart: the user is the **2nd** Counselor and the app says **1st**.

After this plan:
- Each login is linked **once per ward** to its roster person (`user_member_links`).
- For a linked account, the app calling **follows the roster calling** (through an exact map of
  LCR calling titles). It changes only when a person ticks the change on a review, never automatically.
- Admin → Users no longer sets roles. The super admin alone can **override** a roster-derived
  calling, and the override is marked and comes up again on every review.

### Decisions settled with the user (2026-11-11, during `/planning`)

| # | Decision |
|---|---|
| D1 | **Rollout: existing accounts keep their current calling until they are linked.** Linking alone changes nothing; the difference then shows on the Calling review to be ticked. Day one moves nobody. |
| D2 | **A linked person who moves out or vanishes from the roster is reviewed like a release** — an unticked row ("… is no longer on the roster — release their Ward Clerk calling?"). Nothing ends automatically. |
| D3 | **Override: super admin only, and marked.** Admin → Users stops setting roles for everybody. The super admin may set an override; it shows "Overridden — differs from the roster" and appears on every review as a row (default: keep the override). |
| D4 | **Two mapped callings: the higher-ranked one wins, and the review shows it.** Order: `bishop` > `counselor` > `ward_secretary` > `executive_secretary` > `org_president` > `org_counselor` > `org_secretary` > `music_coordinator` > `ward_council_member`. The row names the calling chosen and the one set aside. |
| D5 | **Matching LCR text is exact, against a known list** (decided by Claude, stated to the user, not objected to). A title not on the list grants nothing and shows as "Calling not recognised" on the review. A change in LCR wording can never grant access by accident. |

From the scope (already settled in discovery):
- **New accounts:** the bishopric member sending the invite chooses the roster person. The invitee
  confirms "Yes, this is me" and never picks a record.
- **Existing accounts:** a one-time "Is this you?". If a roster email matches the login email, the
  link is made when they say yes. Anything else waits for an admin's approval.
- **Calling changes from a paste are reviewed, never automatic.**
- **New holder without an account:** "Sister X is now Ward Clerk — no account yet" plus **Invite**.

### Planning decisions made here (P1–P12). The executor follows these.

- **P1 — The link is its own table with a SELECT policy and NO write policy.** Every write goes
  through `lib/callings/memberLinks.ts` with the service role, behind route checks. This is the
  same shape as `visit_assignments` and `zoom_remote_links`.
  - **Why:** a link decides privileges. `users` already has column grants only for
    `theme_preference`, `active_ward_id` and `settings` (migrations 022, 066, 077), so a
    `users.member_id` column would need yet another grant. A user-writable link is a privilege
    escalation.
- **P2 — A link is per (user, ward)**, because each ward's roster governs only that ward
  (multi-ward model). There is one active link per (user, ward) and one active link per member,
  both enforced by partial unique indexes.
- **P3 — Nobody links their OWN account except through the email match.** Both the route and the
  library refuse it (403, with a sentence), and that includes the super admin. Linking yourself to
  the Bishop's roster record is exactly the escalation this guards against. The email match is
  safe because the roster email comes from the LCR paste (an admin act) and the login email is
  verified by Supabase Auth.
- **P4 — "Ask the bishopric to link me" creates a pending request. It does NOT let the user
  pick a record.** The user never browses the roster (many roles lack `roster.view`). A bishopric
  member then picks the person on Admin → Users. One table holds both states: `status pending | active | declined | ended`.
- **P5 — The Calling review is computed when read, never stored.** It is one pure function,
  `buildCallingReview()`, comparing each linked account's derived roster calling with its app
  calling. Admin → Users (cr2) and the paste review (cr3) both call it, so the two screens cannot
  disagree. A paste preview passes the *pasted* callings in place of the stored ones.
- **P6 — Applying a review row goes through `createCalling` / `updateCalling` / `endCalling`
  only.** Those remain the only writers of a calling, and the update and end paths still retire
  stale Zoom remote links (`tests/lib/remoteLinkRetireSites.test.ts` must stay green).
- **P7 — `ward_role_assignments` gains `source` (`manual | roster | override`).** Existing rows
  are backfilled as `manual` (D1). A review apply writes `roster`. The super-admin override writes
  `override` plus `override_by` and `override_at`. Roles that are not LCR callings (`super_admin`,
  `sacrament_manager`, the stake roles, `resource_center_specialist`) are **never** put on a
  review. Their callings stay `manual`.
- **P8 — The organization comes from the ward's organizations by TYPE.** "Elders Quorum President"
  maps to `org_president` plus the ward's one active `elders_quorum` organization. If a ward has
  zero or several of that type, the row reads "Can't apply: this ward has no Elders Quorum
  organization" and cannot be ticked. **Never guess.** Young Men titles map to nothing, because the
  bishopric is the Young Men presidency (p2-admin-and-access retro).
- **P9 — Default ticks.** Every calling row starts **unticked** on both review surfaces, because a
  calling change moves access in one direction or the other (decisions.md §4.4: "never auto-change
  access in either direction"). Tick all is offered, except on releases. Releases follow the
  move-out guard's pattern: one tick at a time.
- **P10 — Guards on apply** (each one refuses only that row, with a sentence, and the rest
  still apply):
  - the last active bishop cannot be released or changed away (`countActiveBishops()`);
  - no row may apply to the acting user's **own** calling unless the actor is the super admin;
  - a review id the recompute no longer produces is counted as stale, never guessed. This mirrors
    `staleSelections` in the paste import.
- **P11 — A released account must not crash.** `lib/auth/session.ts:158-166` throws when the
  session's ward has no active calling. Before cr2 ships a release path, confirm what that throw
  renders. If it renders a 500 or error page, change it to a plain page: "You no longer hold a
  calling in {ward}. If this is a mistake, contact your bishopric." Add a sign-out button. **This
  is in scope** because cr2 is the first ordinary flow that can produce that state.
- **P12 — Audit and notify:**
  - **Link:** `member_link_created` / `_requested` / `_approved` / `_declined` / `_ended`, with
    ids and the method only.
  - **Calling change:** `calling_changed_from_roster` / `calling_override_set` /
    `calling_override_cleared`. Detail holds ids, `beforeRole`/`afterRole` and positions. **No
    names, and no key containing "note" or "token"** (`writeAuditLog()` redacts those).
  - Every applied calling change and every approved link calls `notifyOtherBishopric` (CLAUDE.md
    §7: any admin change notifies the other two).

### Success criteria

- [ ] After the user and Chris Haskell are linked and their review rows are ticked, Zoom Remote
      links shows the user as **2nd Counselor** and Chris Haskell as **1st**. The Planner's "You
      are" identity follows.
- [ ] An unlinked account's access is unchanged after deploy (D1).
- [ ] No route lets a user link themselves except through the email match. Asserted by a route test.
- [ ] A paste that swaps two counselors changes nothing until ticked. Once ticked, both callings swap.
- [ ] A linked member who moves out appears as an unticked release (D2).
- [ ] An override shows its marker and reappears on the next review (D3).
- [ ] A person with two mapped callings gets the higher one, and the row names both (D4).
- [ ] An unrecognised LCR title grants nothing and is listed as "not recognised" (D5).
- [ ] The invite body no longer carries a role, so the server cannot be asked for `super_admin` (cr4).

---

## Relevant Files

### cr1 — Map, link, "Is this you?"
- `supabase/migrations/NNN_user_member_links.sql`: **create**. `NNN` is the next free number at
  execution time (**104 if bishopric-visits `bv6` has not taken it**; see Integration Notes).
- `lib/callings/lcrCallingMap.ts`: **create**. The exact title → app calling map, plus
  `parseLcrCallings()` and `deriveCalling()` (D4/D5/P8).
- `lib/callings/memberLinks.ts`: **create**. The service-role writer and reader for links (P1–P4).
- `lib/validation/memberLink.ts`: **create**. Zod schemas.
- `app/api/member-link/route.ts`: **create**. GET my link state and candidate; POST confirm
  (email match) or ask.
- `app/api/admin/member-links/route.ts`: **create**. POST link a user to a member (admin).
- `app/api/admin/member-links/[id]/route.ts`: **create**. PATCH approve / decline / end.
- `components/callings/IsThisYouCard.tsx`: **create**. A dashboard card for an unlinked account.
- `app/(app)/dashboard/page.tsx`: **modify**. Render the card when unlinked in this ward.
- `app/(app)/admin/users/page.tsx`, `UserRow.tsx`: **modify**. Link status, "Link to roster
  person" (member picker in a window, refused for self), and pending requests with Approve /
  Decline.
- `lib/auth/adminUsers.ts`: **modify**. `listWardUsers` carries link status.
- `types/domain.ts`: **modify**. Add `MemberLink`, `MemberLinkStatus` and `CallingSource`; add
  `source` to `Calling`.
- `lib/callings/queries.ts`: **modify**. `CALLING_COLUMNS` and `toCalling` read `source` and the
  override columns.
- `types/database.ts`: **regenerate** (`npm run db:types`).

### cr2 — Calling review
- `lib/callings/callingReview.ts`: **create**. The pure `buildCallingReview()` (P5).
- `lib/callings/applyCallingReview.ts`: **create**. Recompute, apply the ticked rows through the
  three writers, apply the guards (P10), audit and notify.
- `lib/callings/loadCallingReview.ts`: **create**. Reads links, members, callings and
  organizations for one ward.
- `app/api/callings/review/route.ts`: **create**. GET review, POST apply.
- `app/api/callings/override/route.ts`: **create**. POST set / DELETE clear (super admin only).
- `app/(app)/admin/users/CallingReview.tsx`: **create**. A checklist reusing the
  `ChecklistGroup` shape from `app/(app)/roster/import/ReviewChecklist.tsx`. **If** it can be
  reused unchanged, move it to `components/ui/ChecklistGroup.tsx`. That counts as a file move:
  **ask the user first** (global CLAUDE.md §7). Otherwise import it from its current path.
- `app/(app)/admin/users/UserRow.tsx`: **modify**. Remove the role and org selects. Show "From
  roster: …" / "Set by hand (not linked)" / "Overridden — differs from the roster". Add an
  **Override** button for the super admin only.
- `app/api/admin/users/[id]/route.ts`, `lib/validation/adminUser.ts`, `lib/auth/adminUsers.ts`:
  **modify**. `updateUserSchema` loses `role`, `orgId` and `counselorPosition`, keeping
  `isActive`. Add a server-side refusal for deactivating oneself.
- `lib/auth/session.ts` (+ the page it surfaces): **modify only if needed** (P11).

### cr3 — Paste review
- `lib/roster/paste/buildRosterDiff.ts`, `pasteRequest.ts`, `applyRosterPaste.ts`: **modify**.
  The diff gains `callingChanges` from `buildCallingReview()`, fed the pasted callings. The apply
  writes the member RPC first, then the ticked calling rows through `applyCallingReview`.
- `app/(app)/roster/import/ReviewChecklist.tsx`, `PasteImport.tsx`: **modify**. Add a "Callings"
  group, unticked. The result card says how many calling changes were applied and how many were
  refused.
- `lib/validation/rosterPaste.ts`: **modify** only if calling ids need a new prefix check.

### cr4 — Invites tied to a roster person
- Invites migration (`NNN+1_invite_member.sql`): **create**. Adds `invites.member_id` (composite
  FK to members by ward). `role` becomes nullable for roster invites.
- `lib/validation/invite.ts`, `lib/auth/invites.ts`, `app/api/auth/invite/route.ts`: **modify**.
  The body is `{ email, memberId }`; the role is derived on the server. `redeemInvite` re-derives
  the calling from the CURRENT roster, creates the calling (`source: 'roster'`) and the link
  (`method: 'invite'`).
- `app/(app)/admin/users/InviteForm.tsx`: **modify**. A member picker replaces the role, org and
  position selects. It shows the derived calling, or "This person holds no calling the app
  recognises" and refuses.
- `app/(auth)/invite/[token]/page.tsx`, `RegisterForm.tsx`: **modify**. "You're invited as
  {name}, {calling}" with a required "Yes, this is me" checkbox. "No, this isn't me" shows a
  sentence: ask the person who invited you.
- `app/(app)/admin/users/CallingReview.tsx`: **modify**. Add a "Callings with no account" group,
  each row with **Invite** (opens InviteForm preset to that member and their roster email).

### Every slice
- Tests (see Testing Strategy).
- `SPEC.md`, `FEATURES.md`, `CLAUDE.md` §7 (one new subsection: "The roster decides the calling").
- `plans/prototype/module-map.md` §2.13: note that the calling-text integrity flag (decisions.md
  §4.4) is delivered.
- A harness scenario, `npm run manifest`, a retro, and `plans/retros/INDEX.md`.

---

## Dependencies

- **No new libraries.**
- Reuse:
  - `createServiceSupabaseClient`, `writeAuditLog`, `notifyOtherBishopric`, `assertCan`,
    `readJsonBody`, `respondToRouteError`, `InvalidInputError`
  - `MemberPicker` (whole-ward mode)
  - `Modal` (windows per the compact-UI memory)
  - `countActiveBishops`, `countActiveSuperAdmins`, `isSuperAdmin`
  - `listBishopricUsers`
  - the paste pipeline (`runPastePipeline`)
- Permissions: link and review actions gate on **`admin.manage_users` (non-overridable, held by
  bishop and counselors) AND a bishopric calling or super admin**, which is the
  `canManageInvitees()` shape. The override gates on `isSuperAdmin` alone.
- Migrations apply with `npm run db:push -- --dry-run` first, then `npm run db:push`, then
  `npm run db:types`.

---

## Known Pitfalls (from retro context)

- **ward-callings-model:**
  - `ward_role_assignments` has a partial unique index (one active calling per user per ward).
    **A swap of two counselors is not a problem**: only `counselor_position` moves, and both rows
    stay active. A change of role for one person is an UPDATE in place, not end-plus-create, so
    `issue_reports.calling_id` and `zoom_remote_links.holder_calling_id` stay valid.
  - "Every 'who holds this role' query reads callings": nothing new may read roles from
    `members.callings` directly. Only the review reads that text.
- **ward-callings-model / sacrament-planner-import:** an account with no active calling in its
  home ward fails in `session.ts` (P11). The Planner showed the wrong person when the calling was
  wrong, so after cr2 is applied in Buffalo, check the Planner's `settings/bishopric` names (it
  had the counselors swapped once before). That check is a runbook step in the retro, not code.
- **auth-b-invites-admin:**
  - `invites` mirrors composite FKs, so a test that makes the second write fail needs an injected
    client.
  - Bodies go through `readJsonBody()`.
  - `console.error("msg", { error })` logs `{}` in dev, so log `error.message`.
- **p2-admin-and-access:**
  - Ambiguous `users!inner` embeds on a table with two FKs to `users`: `user_member_links` has
    `user_id`, `linked_by` and `decided_by`, so **name the FK in every embed**.
  - A screen gated on a structural role (super admin) must not sit behind a layout gated on a
    ward permission. The `/admin` layout already admits super admins; keep it that way.
- **p3-shell-and-tile-dashboard:** `.insert().select()` applies the SELECT policy to RETURNING.
  All writes here are service role, so this is moot, but **never write a link through the
  caller's client**.
- **roster-paste-import:**
  - Callings cells are `\n`-separated and stored raw.
  - Silent updates are applied whatever the ticks say. **cr3 must not change that for the member
    columns.** The `members.callings` text still updates on every paste; only the APP calling
    waits for a tick.
  - The snapshot pages past 1000 rows.
- **Global rule:** negative-path test data must pass every check before the one under test.
  - A "can't link yourself" test must use a member and a user in the same ward, with the actor
    holding `admin.manage_users`. Otherwise it is refused for the wrong reason.
  - A "last bishop" test must use a linked bishop whose roster row truly says something else.

---

## Tasks

### Task 0 (before cr1): Confirm the title map with the user — read only
**Action:** Write a throwaway script in the scratchpad (not in the repo). It reads with the service
role and prints every **distinct calling title** across Buffalo Ward's `members.callings`, with a
count. **Titles only: never names, ids or any other column.** Show the list to the user, then
agree with them:
- each title that maps, and to what. Expected (confirm the exact LCR spelling):
  - `Bishop`
  - `Bishopric First Counselor` / `Bishopric Second Counselor`
  - `Ward Clerk`
  - `Ward Executive Secretary`
  - `{Elders Quorum | Relief Society | Primary | Young Women | Sunday School}` + `President` /
    `First Counselor` / `Second Counselor` / `Secretary`
  - the music coordinator title
- which titles (if any) make a person a `ward_council_member`. That role is not an LCR calling.
  Candidates such as `Ward Mission Leader` or `Ward Temple and Family History Leader` are **the
  user's call**. If none, nothing maps to it, and existing `ward_council_member` callings stay
  `manual`.
- that assistant clerks map to nothing (not modelled; ITER-051 note).

Record the agreed table in this plan under "Agreed title map" before writing code. If the user is
not available, **stop**. Do not guess the map.

### Task 1 (cr1): Migration — links and calling source
**File:** `supabase/migrations/NNN_user_member_links.sql`
- `user_member_links`:
  - `id` uuid PK
  - `user_id` → users on delete cascade
  - `ward_id` → wards on delete cascade
  - `member_id` uuid **null** (null only while `pending` without a chosen member), with a
    composite FK `(member_id, ward_id) → members(id, ward_id)`. **Check `members` has
    `unique (id, ward_id)`**; if not, add it in this migration and say so.
  - `status` text check in (`pending`, `active`, `declined`, `ended`)
  - `method` text check in (`email_match`, `admin`, `invite`) null while pending
  - `requested_at`
  - `linked_by` → users (null for email_match), `decided_by` → users, `decided_at`
  - `ended_at`, `ended_by`
  - `created_at`
  - CHECK `status <> 'active' or member_id is not null`
- Partial unique indexes:
  - `(user_id, ward_id) where status in ('pending','active')`
  - `(member_id) where status = 'active'`
- RLS: enable. One SELECT policy: `ward_id = current_ward_id() and (user_id = auth.uid() or
  is_bishopric())`. **No write policy.** The header comment says why (P1). The super admin's reads
  go through the service role after `isSuperAdmin`.
- `ward_role_assignments`:
  - add `source text not null default 'manual' check in ('manual','roster','override')`
  - add `override_by uuid references users on delete set null`, `override_at timestamptz`
  - backfill: nothing (the default is `manual`)
  - comment: `override_by` must never appear in a policy predicate (the `talks-d` hole)
- `tests/db/migrations.test.ts`: follow whatever it asserts about new files.
  `tests/rls/ward-isolation.test.ts`: the new table HAS `ward_id`, so no exception is added.

### Task 2 (cr1): The title map
**File:** `lib/callings/lcrCallingMap.ts`
- `LCR_CALLING_MAP: ReadonlyMap<string, MappedCalling>`, keyed by the exact title. Compare after
  trimming and collapsing inner whitespace, and **case-sensitive**, so a wording change shows up
  rather than half-matching. `MappedCalling = { role: Role; orgType: OrganizationType | null;
  counselorPosition: 1 | 2 | null }`.
- `parseLcrCallings(text: string | null): string[]`: split on `\n`, trim, drop blanks, and strip a
  trailing ` (…)` date group so it also works on the dated columns.
- `ROLE_PRECEDENCE` (D4). `deriveCalling(titles, organizations)` returns:
  `{ kind: 'calling', role, orgId, counselorPosition, title, setAside: { title, role }[] }`
  | `{ kind: 'none', unrecognised: string[] }`
  | `{ kind: 'unresolvable', title, reason: 'no_organization' | 'several_organizations', orgType }`.
  Unrecognised titles are always returned alongside the result, so the review can list them (D5).
- Pure, no I/O.

### Task 3 (cr1): Link writer and reader
**File:** `lib/callings/memberLinks.ts` (service role; header comment as in `writeCalling.ts`)
- `readMyLinkState(userId, wardId)` returns `{ link | null, emailCandidate: { memberId,
  displayName, birthYear } | null }`. The candidate is the one **active** roster member whose
  `lower(email)` equals the login's `auth.users.email`. If there are several, there is no
  candidate (and asking is the only path).
- `confirmEmailMatch({ userId, wardId, memberId })`: re-checks the match server-side, then inserts
  `active` with `method 'email_match'`. Refuses if the member is already linked: "This roster
  record is already linked to another account. Ask your bishopric."
- `requestLink({ userId, wardId })`: inserts `pending`. It is idempotent (an existing pending
  request is returned).
- `linkByAdmin({ actorUserId, userId, wardId, memberId })`: **refuses actor = user** (P3). It
  approves a pending request in place or inserts `active` with `method 'admin'`.
  Refuses a member already linked elsewhere with its own sentence, "{Name} is already linked to
  another account. Unlink them first." — the reader is the bishopric, so "Ask your bishopric" is
  wrong here (found walking scenario 103).
- `declineLink`, `endLink`: both take a required `actorUserId`.
- Every function returns a typed result. 23505 maps to a sentence via `InvalidInputError`, never
  a 500.

### Task 4 (cr1): Routes
- `GET /api/member-link` (any signed-in adult; `personal_tools.use` is held by all adult roles)
  and `POST /api/member-link` `{ action: 'confirm', memberId } | { action: 'ask' }`.
- `POST /api/admin/member-links` `{ userId, memberId }` and `PATCH /api/admin/member-links/[id]`
  `{ action: 'decline' | 'end' }`.
  - Gate: `admin.manage_users` AND (a bishopric calling OR super admin).
  - The target user must hold a calling in the session's ward (`filterUsersInWard`).
  - Audit + `notifyOtherBishopric` (P12).
- Shape: follow `app/api/visits/assignments/*` (the latest service-role-writer routes).

### Task 5 (cr1): UI
- `IsThisYouCard`: shown on `/dashboard` when the session's ward has no active or pending link
  for the user. Three states:
  - **email candidate**: "Is this you? {Name}, born {year}" with **Yes, this is me** / **No**.
    "No" falls through to the ask state.
  - **ask**: "Your account isn't linked to the ward list yet. [Ask the bishopric to link me]".
  - **pending**: "Waiting for the bishopric to link your account."

  It is not dismissible, but small. **Do not show it to a super admin acting in a ward where
  their calling role is `super_admin`, or to `sacrament_manager`** (no LCR calling).
- Admin → Users:
  - each row shows Linked to {name} / Waiting to be linked / Not linked;
  - **Link to roster person** opens a window with `MemberPicker` (active members, whole ward);
  - the control is absent on your own row, and the server refuses anyway;
  - pending requests sit at the top with Link… / Decline.

  44px targets; walk at 375px light and dark.

### Task 6 (cr1): Tests, scenario, docs, retro → commit `cr1`

### Task 7 (cr2): `buildCallingReview()`
**File:** `lib/callings/callingReview.ts` (pure)
- Input: `{ links (active), members: { id, status, callings }[], callings (active, this ward),
  organizations, accountsByMember }`.
- Output rows. Each row has a stable `id`, a `kind`, `defaultSelected: false` (P9), `canApply` and
  `refusal?`:
  - `change` (`calling:{callingId}`): derived differs from current in role, org or position.
    Shows "From {current label} to {derived label}" plus any `setAside` and `unrecognised`.
  - `call` (`call:{userId}`): linked account with no active calling here, derived a calling.
  - `release` (`release:{callingId}`): derived `none`, or the member is moved out or missing (D2).
    "{Name} is no longer on the roster" vs "{Name} holds no calling the app recognises".
  - `override` (`override:{callingId}`): `source = 'override'` and it differs. Shown as "Overridden
    by the super admin. Roster says {derived}". Ticking it **clears the override and applies the
    roster**.
  - `unresolvable`: `canApply: false` with P8's sentence.
  - `noAccount` (cr4 only): a mapped calling held by a member with no linked account.
- **Skip** every calling whose role is one of P7's non-LCR roles, and every unlinked account.
- Labels use `describeCalling()`.

### Task 8 (cr2): Apply and the session check
- `applyCallingReview({ actor, wardId, selectedIds, client })`:
  - recompute;
  - for each ticked row, run its guard (P10) and then the writer:
    - change → `updateCalling` + `source:'roster'`, override columns nulled;
    - call → `createCalling` + `source:'roster'`;
    - release → `endCalling`;
  - writes are sequential; one failing row does not stop the others, and is never swallowed;
  - return `{ applied, refused: { id, sentence }[], stale }`;
  - one audit row per applied change, and one `notifyOtherBishopric`.
- **`updateCalling` / `createCalling` need a `source` parameter.** Add it as a **required** field
  so every existing caller (invites, admin, units, youth accounts) states `manual` explicitly
  (the ITER-005 lesson). Override columns are written only by the override path.
- **P11:** check what `session.ts` renders for an account whose calling was just ended. Fix it if
  needed and test it.

### Task 9 (cr2): Override
- `POST /api/callings/override { userId, role, orgId, counselorPosition }` (super admin only; self
  allowed, since super admin already bypasses the matrix and this closes the
  sacrament-planner-import gap) writes `source 'override'` via `updateCalling`.
  `DELETE /api/callings/override { userId }` sets the source back to `roster` and leaves the
  review to propose the roster value.
- The `role` enum excludes `super_admin` (it is assigned through `unit_assignments`, not a calling).

### Task 10 (cr2): Admin → Users
- Remove the role, org and position selects. Keep the active toggle, and refuse self-deactivation
  **on the server** too.
- Add the **Calling review** section above the user list. It shows only when it has rows, with a
  count and Apply ticked; the result names applied, refused and stale.
- Show the `source` marker per row.
- **Run against Buffalo once deployed:** link the user and Chris Haskell, tick their two rows,
  then confirm Remote links and the Planner. This is a runbook step for the user, not a script.

### Task 11 (cr2): Tests, scenario, docs, retro → commit `cr2`

### Task 12 (cr3): Paste review
- `runPastePipeline` also loads active links, active callings and organizations, and calls
  `buildCallingReview()` with the **pasted** callings text in place of the stored text, for
  matched members only. Move-outs in this paste count as missing (D2).
- `RosterReview` gains `callingChanges` (the browser shape: labels and ids only).
- Ids keep their `calling:` / `call:` / `release:` / `override:` prefixes; they never collide with
  the existing `new:` / `member:` / `household:` / `moveout:` ids.
- Apply:
  1. run the `apply_roster_paste` RPC exactly as today (member silent fields still always update);
  2. then `applyCallingReview` with the ticked calling ids, which **recomputes from the now-stored
     roster**.

  Report both in `ApplyResult` (`callingsApplied`, `callingsRefused`). If step 2 fails, step 1
  stays, and the result says "Calling changes were not applied — finish them on Admin → Users",
  which works because the review recomputes there.
- Permission: the paste needs `roster.import`. **The calling group is shown and applied only if
  the actor ALSO passes cr2's gate.** Otherwise the group reads "Calling changes are reviewed by
  the bishopric on Admin → Users" with no checkboxes.
- UI: a "Callings" group after "No longer listed". It starts unticked; Tick all is disabled for
  releases.

### Task 13 (cr3): Tests, scenario, docs, retro → commit `cr3`

### Task 14 (cr4): Invites tied to a roster person
- Migration: `invites.member_id` (composite FK) and `role` made nullable. CHECK: `member_id is not
  null or role is not null`, so old unused invites stay valid.
- `createInviteSchema` becomes `{ email, memberId }`. **The role leaves the body** (this closes
  "the server accepts `super_admin`"). The server derives the calling: `kind:'calling'` and
  resolvable, or a 400 sentence. It refuses a member who already has an active link.
- `redeemInvite`: re-derive from the current roster. If the result is no longer a calling, refuse
  with "Your calling has changed since this invite was sent. Ask for a new invite." **before**
  creating the auth user. Then create the calling (`source 'roster'`) and the link (`method
  'invite'`, `linked_by = invited_by`). On failure, compensate the same way it does today, and
  undo the link too.
- `RegisterForm`: a required "Yes, this is me" checkbox. The schema refuses `false`.
- `noAccount` rows on the Calling review each get an **Invite** button (presets member and roster
  email; the email stays editable).

### Task 15 (cr4): Tests, scenario, docs, retro → commit `cr4`

---

## Agreed title map
_Agreed with the user 2026-11-16 (Task 0). Buffalo Ward's roster held 89 distinct titles, none with a
trailing date group. Every title not listed here grants nothing._

| LCR title (exact) | role | org type | position |
|---|---|---|---|
| Bishop | `bishop` | — | — |
| Bishopric First Counselor | `counselor` | — | 1 |
| Bishopric Second Counselor | `counselor` | — | 2 |
| Ward Clerk | `ward_secretary` | — | — |
| Ward Executive Secretary | `executive_secretary` | — | — |
| Elders Quorum President | `org_president` | `elders_quorum` | — |
| Elders Quorum First Counselor / Second Counselor | `org_counselor` | `elders_quorum` | — |
| Elders Quorum Secretary | `org_secretary` | `elders_quorum` | — |
| Relief Society President | `org_president` | `relief_society` | — |
| Relief Society First Counselor / Second Counselor | `org_counselor` | `relief_society` | — |
| Relief Society Secretary | `org_secretary` | `relief_society` | — |
| Primary President | `org_president` | `primary` | — |
| Primary First Counselor / Second Counselor | `org_counselor` | `primary` | — |
| Primary Secretary | `org_secretary` | `primary` | — |
| Young Women President | `org_president` | `young_women` | — |
| Young Women First Counselor / Second Counselor | `org_counselor` | `young_women` | — |
| Young Women Secretary | `org_secretary` | `young_women` | — |
| Sunday School President | `org_president` | `sunday_school` | — |
| Sunday School First Counselor / Second Counselor | `org_counselor` | `sunday_school` | — |
| Sunday School Secretary | `org_secretary` | `sunday_school` | — |
| Music Coordinator | `music_coordinator` | — | — |
| Resource Center Specialist | `resource_center_specialist` | — | — |

Settled with it:
- **No LCR title maps to `ward_council_member`.** The user named the ward council as the bishopric,
  the clerk, the executive secretary and the five presidencies — every one already maps to its own
  role, which outranks `ward_council_member`. Whether those roles should all carry ward-council
  ACCESS is what a role grants, i.e. ITER-046, and is not changed here.
- **`resource_center_specialist` IS mapped** (reverses P7's listing of it as a non-LCR role). It
  ranks last in D4's precedence, after `ward_council_member`. P7's non-LCR list is now
  `super_admin`, `sacrament_manager` and the stake roles.
- Grants nothing: `Elders Quorum Ministering Secretary`, `Ward Assistant Clerk`, every Young Men,
  youth class/quorum, stake, temple, teacher and specialist title.

---

## Testing Strategy

**Pure (cr1 and cr2):**
- `tests/lib/lcrCallingMap.test.ts`:
  - exact match; case and inner whitespace;
  - an unrecognised title grants nothing and is listed;
  - date-group stripping;
  - precedence across every pair in D4;
  - a Young Men title maps to nothing;
  - P8 with zero and with two organizations of the type.
- `tests/lib/callingReview.test.ts`:
  - each row kind;
  - a counselor swap produces two `change` rows and no release;
  - moved-out → release;
  - an override that differs → override row; one that matches → no row;
  - non-LCR roles are skipped; unlinked accounts are skipped;
  - every row defaults unticked;
  - ids are stable across two runs.

**RLS:**
- `tests/rls/user-member-links.test.ts`:
  - a user reads their own link; the bishopric reads the ward's; an org president reads only their own;
  - ward B reads nothing of ward A;
  - **INSERT, UPDATE and DELETE through any authenticated client are refused.** Assert insert
    raises, and re-read the row after update and delete.

**Routes (with `tests/helpers/routeClient.ts`):**
- `tests/routes/member-link.test.ts`:
  - email match → active;
  - mismatch → refused, and ask → pending;
  - confirming someone else's email → refused;
  - an already-linked member → 400 sentence;
  - an admin linking themselves → 403, **with an actor who otherwise passes every check**;
  - a non-bishopric admin attempt → 403;
  - approve and decline;
  - an audit row exists.
- `tests/routes/calling-review.test.ts`:
  - only ticked rows apply;
  - the last bishop is refused and the others still apply;
  - own calling refused for a non-super-admin;
  - a stale id is counted;
  - a swap swaps;
  - a `holder_changed` Zoom link is retired on the change (re-read `zoom_remote_links`);
  - override set, then cleared;
  - an override by a non-super-admin → 403.
- `tests/routes/admin-users.test.ts` (extend or create): the role fields are refused by the schema;
  self-deactivation → 400.
- cr3: extend `tests/lib/rosterDiff.test.ts` (calling ids don't collide; silent member fields
  still apply unticked) and `tests/routes/roster-paste-import.test.ts` (a calling change applies
  only when ticked; a roster-only importer sees no checkboxes and applies none).
- cr4: extend the invite and register route tests:
  - the body with `role: "super_admin"` is refused (it is no longer a field; `.strict()`);
  - redemption creates both the calling and the link;
  - a changed calling refuses before the auth user is created;
  - `false` on "this is me" is refused.

**Source guards:**
- `tests/lib/callingWriteSites.test.ts` (create, or extend an existing equivalent): only
  `lib/callings/writeCalling.ts` writes `ward_role_assignments`, and only
  `lib/callings/memberLinks.ts` writes `user_member_links`.
- Keep green: `remoteLinkRetireSites`, `explicitTimeZone`, `navigationRoutesExist`,
  `user-author-fks`, `ward-isolation`, `migrations`, `permissions` (the three role-list copies:
  this plan adds no role).

---

## Test Scenarios (Harness)

Numbers: the next free at execution time (103 if `bv6` has not taken it).

### Scenario NNN: Linking accounts and the calling review (cr1 + cr2)
**Tags:** callings, admin, full, security
**Purpose:** reaching "linked, and the roster disagrees with the app" by hand needs a pasted
roster, several accounts and wrong callings. Seeding makes it one command.
**Seed data summary:**
- A ward with the seven organizations.
- Roster members (synthetic names) whose `callings` text says:
  - Bishop;
  - Bishopric First Counselor;
  - Bishopric Second Counselor;
  - Ward Clerk;
  - Elders Quorum President + Ward Mission Leader (precedence);
  - one unrecognised title;
  - one member `moved_out` who holds an app calling.
- Accounts:
  - bishop (linked, matches);
  - counselor A: app says position 1, roster says 2, **unlinked, with an email that matches their
    roster email**;
  - counselor B: app says 2, roster says 1, unlinked, no email match;
  - ward clerk (linked, matches);
  - EQ president (linked, app says `org_counselor`);
  - the moved-out member's account (linked);
  - one super admin.
- One Zoom remote link on counselor A's position.

**Tester action:**
1. Sign in as counselor A and answer **Yes, this is me**.
2. Sign in as counselor B and **Ask the bishopric**.
3. As the bishop, link B.
4. Open the Calling review, tick the two counselor rows and the EQ row, and apply.
5. Try to tick the release.
6. As super admin, override the ward clerk and see the marker.

**Verification checklist:**
- [ ] A's card offers their own name and links on Yes; B's card shows "Waiting…" after asking.
- [ ] The bishop cannot link their own account (no control; a direct POST gets a 403 sentence).
- [ ] The review lists two counselor `change` rows, the EQ `change` (naming Ward Mission Leader as
      set aside), one release (moved out) and the unrecognised title, all unticked.
- [ ] After applying, Zoom Remote links shows A as 2nd and B as 1st, and A's old link reads
      "Needs a new link".
- [ ] The release applies only when ticked. The released account then sees the plain "no longer
      hold a calling" page, not an error (P11).
- [ ] The override shows "Overridden — differs from the roster" and appears on the review as a
      keep-or-clear row.
- [ ] Audit rows exist for each link and change, and contain no names. The other two bishopric
      members are notified.
- [ ] 375px, light and dark: no overflow; every control is 44px.

### Scenario NNN+1: A paste that changes callings, and inviting a new holder (cr3 + cr4)
**Tags:** callings, roster, import, full, destructive
**Purpose:** a two-paste sequence with linked accounts is slow to set up by hand.
**Seed data summary:** scenario NNN's ward after review. Two fixture pastes: one swapping the two
counselors and naming a new Ward Clerk who has no account; one partial paste.
**Tester action:**
1. Paste 1 and look at the Callings group.
2. Apply with only the swap ticked.
3. On Admin → Users, use **Invite** on the new clerk and open the invite link.
4. Register with "Yes, this is me".

**Verification checklist:**
- [ ] The Callings group starts unticked. Applying with nothing ticked changes no calling but
      still updates `members.callings`.
- [ ] Ticking the swap swaps both callings.
- [ ] A roster-only importer (if a ward grants `roster.import` outside the bishopric) sees the
      sentence and no checkboxes.
- [ ] "No account yet" lists the new clerk with Invite. The invite form shows "Ward Clerk"
      derived, with no role picker.
- [ ] The registration page names the person and calling and requires "Yes, this is me". The new
      account lands as Ward Clerk, linked.

---

## Validation Commands

Run after each slice, in order. **Stop the dev server before the full suite and the build**
(7.7 GB RAM).
```bash
npm run lint
npm run typecheck
npm run harness:typecheck
npx vitest run tests/lib/lcrCallingMap.test.ts tests/lib/callingReview.test.ts tests/rls/user-member-links.test.ts tests/routes/member-link.test.ts tests/routes/calling-review.test.ts
npm test
npm run build
```

---

## Integration Notes

- **Migration and scenario numbers collide with the bishopric-visits plan**, which reserved 104
  (bv6), 105 (bv7) and scenarios 102–103. Take the next free numbers at execution time
  (`ls supabase/migrations | tail -3`). If this plan takes 104 first, update the "Status" note at
  the top of `plans/bishopric-visits.md` so its executor shifts too.
- **No column is dropped**, so migrations can apply before the deploy.
  - cr1's migration only adds columns; `source` has a default.
  - cr4 makes `invites.role` nullable. The old build still sends a role, which stays valid under
    the CHECK.
- **Breaking UI change in cr2:** Admin → Users loses role editing. Until accounts are linked and
  reviewed, the only way to change a calling is the super-admin override. That is intended (D3);
  say so in the commit and the retro.
- **`POST/PATCH /api/callings`** (P2's two-calling route, no UI) also writes callings. Leave it,
  but make it pass `source: 'manual'`, and note in the retro that it bypasses the review. Also
  record the pre-existing bug found in research: **reinstating a released calling cannot work**,
  because `updateCalling` filters `is_active = true`. That is a separate item, not fixed here.
- **After cr2 is live in Buffalo (runbook, in the retro):**
  1. Release Admin for Buffalo if the bishopric should use Admin → Users (ITER-041 released modules).
  2. Link the user and Chris Haskell, then tick their rows.
  3. Confirm Remote links and the Planner's bishopric names in `settings/bishopric`.
  4. Then the bishop.
- **Long-term (scope note, 2026-11-11):** the app may later record callings **ahead** of LCR
  (Deferred "Carry out a sandbox calling plan"). Nothing here rules it out. A future `source` value
  (e.g. `app_ahead`) would show on the review as "the app is ahead of the roster" rather than as a
  change to apply. Do not build it.
- **ITER-060 (Callings sandbox)** must import `parseLcrCallings` and `LCR_CALLING_MAP` from
  `lib/callings/lcrCallingMap.ts`, so there is one mapping and not two.
- **ITER-046 (access by title)** changes what a role GRANTS. This plan changes where the role
  COMES FROM. They are independent, but ITER-046's "titles are individual callings" will want the
  LCR title. `deriveCalling()` already returns `title` for that reason.
- **Docs:**
  - CLAUDE.md §7 gets a new subsection: "THE ROSTER DECIDES THE CALLING". It covers the link
    table (SELECT-only), no self-link except email match, review computed on read, `source`, the
    super-admin override, and precedence.
  - SPEC.md: the tables and routes.
  - FEATURES.md: Admin → Users and the paste.
  - module-map §2.13: the integrity flag is delivered.
