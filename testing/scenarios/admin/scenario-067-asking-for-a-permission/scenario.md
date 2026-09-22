---
name: Asking for a permission
scope: P2
part: 1
tags: [admin, auth, full]
prerequisites: none
---

## Purpose

**A ward asks for something it does not have, and somebody else answers.**

`wards.settings.role_access` has been able to widen a role since ITER-005. What has never existed
is a way for a ward to **ask**, and the one rule the whole flow turns on: **a ward admin cannot
approve their own request**. If the asker could approve it, the ward would simply be granting
itself the permission with paperwork around it.

Two halves are worth walking rather than unit-testing:

1. **The requester can see the outcome.** The prototype shipped this flow *without* outcome
   visibility and caught the gap itself. A denial nobody can read teaches leaders that asking does
   nothing — and that is a judgement about wording on a screen, not an assertion about a row.
2. **An approval lands as an ordinary delta** in one ward's settings, and **no other ward moves**.
   That second half is what a wholesale settings write would break, and it is invisible from
   inside the ward that asked.

Seeding gives a **pending request** and a **super admin to decide it** — a state with no UI path
until this slice, because there is no screen anywhere that creates a super admin.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 2 — "Harness Test Ward", "Harness Second Ward" |
| Users | 3 — ward 1's bishop, ward 1's EQ president, and a super admin |
| Requests | 2 — one **pending** from ward 1, one already **denied** with a note |
| Ward 2 | seeded with an unrelated `role_access` override, so the fan-out assertions have something that must survive |

**The super admin:** `super-admin@harness.wardleadershiptools.test`
**The ward admin:** `bishop@harness.wardleadershiptools.test`

⚠️ **Ward 2 carries a deliberate unrelated override** — `music_coordinator` with
`remove: ["music.manage"]`. Nothing in this scenario should change it. It is the canary for a
wholesale settings write.

## Steps

1. Sign in as the **bishop**. Open **Administration → Access requests**.
2. Confirm the pending request and the denied one both appear, and that the **denied one shows its
   note**.
3. Submit a new request: a calling, a **module**, how much, and a reason.
4. Confirm there is **no approve control anywhere** on the bishop's view.
5. Sign out. Sign in as the **super admin**. Open the same page.
6. Confirm **both wards'** requests are visible.
7. Decline one with a note. Approve another **for this ward**.
8. Sign back in as the bishop and read the outcome of both.

## Verification checklist (machine-checkable)

- [ ] A ward admin submits a request with a reason and sees it as **pending**
- [ ] The same admin **cannot** approve it — no control on the page, and
      `PATCH /api/access-requests/[id]` answers **403**
- [ ] The database refuses it too: an authenticated UPDATE on `access_requests` as the bishop
      leaves `status` as `pending` (a zero-row success, not an error)
- [ ] After a super admin denies with a note, **the requester can read the note**
- [ ] A denial with **no note** is refused with a sentence (`400`), because the requester would
      have nothing to read
- [ ] After a ward-scoped approval, that ward's `role_access` gains an **add-delta**
- [ ] **No other ward's settings changed** — ward 2's `music_coordinator` override is byte-identical
- [ ] Ward 2's `timezone` and any other settings keys are unchanged
- [ ] An audit row exists for the **submission** and for the **decision**
- [ ] The decision audit row is filed under the ward that **asked**, not the decider's ward
- [ ] Deciding the same request twice answers **409** "already been answered", and `decided_by`
      does not move to the second presser
- [ ] A request naming a module the app does not know is refused at the boundary (**400**) — and
      no module offers an `admin.*` or `sacrament.*` permission, which
      `lib/access/accessModules.ts` asserts at import time and `tests/lib/accessModules.test.ts`
      proves
- [ ] An approved module grants its WHOLE set, `read` included, so the grant is never inert
- [ ] A notification reaches the ward on a decision
- [ ] A notification reaches the SUPER ADMINS on a submission — they are addressed explicitly by
      `listActiveSuperAdminIds()`, because a super admin is not a ward role and the role-based
      resolution inside `emitNotification` cannot reach them from the ward that asked

## Needs a human eye

- [ ] **Does a denial read as a decision somebody made, or as the app refusing?** This is the
      question the whole screen turns on. A denial that reads as a system error teaches leaders
      that asking does nothing.
- [ ] Is it obvious, as the bishop, that somebody else has to answer — rather than looking like a
      control that failed to load?
- [ ] Does the "Approve for every ward" confirmation make clear that **nothing turns on today**?
- [ ] At 375px, does the request list stay readable and the reason text wrap cleanly?
- [ ] Do the module descriptors say enough on their own, or does the picker still need its
      one-line description under it?

## Walkthrough record

### First walk — 2026-09-22, against `568b7c8`

**Driven by Claude (agent) in a real browser (Chrome via Playwright) at `localhost:3000`, signed in
through the real login form as all three accounts. Every write was read back from the database with
the service-role client rather than trusted from the screen. Review page with screenshots:
https://claude.ai/artifact/LRcpvKYSY2fL9EPJJLNKij**

**THE DATA BEHAVIOUR IS SOUND. REACHING THE SCREEN IS NOT.** Thirteen checks settled automatically,
three defects found, three judgements left for the user.

| Check | Observed |
|---|---|
| Request filed by the bishop | `79456e4c…` `status=pending`, audit `access_requested` written |
| No approve control on the bishop's page | zero decision buttons in the DOM |
| Bishop `PATCH` on a request | **403** "You do not have permission to do that."; row unmoved (`status=pending`, `decided_by=null`) |
| Denial with no note | **400** "Say why it was declined. The ward that asked will read this." |
| Requester reads the note | both notes rendered in full on the bishop's page |
| Ward-scoped approval | `role_access` → `{"org_president":{"add":["topics.manage"]}}` |
| **Ward B canary** | **byte-identical to baseline**, all three keys intact |
| Ward A's other settings | `timezone` and `cross_org_visibility` survived the merge |
| Audit | `access_requested` ×1, `access_request_decided` ×2, all `module=admin`, all filed under the ASKING ward |
| Refused writes | no audit row for any of the four refusals |
| Deciding twice | **409** "That request has already been answered."; `decided_by` did not move |
| `admin.*` / `sacrament.*` at the API | **400** ×2; the picker omits all ten |
| 375px | `scrollWidth 360 == clientWidth 360`, no element past the viewport |
| Console | 0 unexpected errors (7 are deliberate probe fetches) |

**THREE DEFECTS, none of them in the request logic itself:**

1. **A SUPER ADMIN CANNOT OPEN EITHER NEW SCREEN — BLOCKING.** `/admin/access-requests` and
   `/admin/stakes` both answer *Not permitted*. `app/(app)/admin/layout.tsx` gates the section on
   `admin.view`, which comes from the WARD CALLING, while a super admin's authority is a
   `unit_assignments` row. It is incoherent one layer down: `GET /api/access-requests` also asserts
   `admin.view` (**403**) while `PATCH …/[id]` gates on `isSuperAdmin` (**200**) — during this walk
   the super admin **decided two requests they could not list**. No test caught it because route
   tests call handlers directly and never render the layout. Needs a product decision: either a
   super admin must also hold a `super_admin` ward calling (as `tests/helpers/seed.ts` builds one,
   making this seed at fault), or the structural row alone should open the admin section.
2. **THE SUBMISSION NOTIFICATION NEVER ARRIVES — SILENT.** `unit_assignments` has two foreign keys to
   `users` (`user_id`, `created_by`), so `users!inner(…)` is ambiguous and PostgREST errors:
   *"more than one relationship was found"*. `listActiveSuperAdminIds()`
   (`lib/access/requests.ts:316`) logs it and returns `[]`, so `emitNotification` is handed nobody.
   **0 notification rows** after a filing; 2 after the decisions. `users!user_id!inner` resolves
   correctly — every `ward_role_assignments` query in `lib/notifications/` already does this.
   **The same bug is PRE-EXISTING in `countActiveSuperAdmins()` (`lib/auth/adminUsers.ts:234`, from
   `2bd7f4e`)**, where it THROWS instead — so deactivating a super admin 500s and the last-admin
   guard never runs.
3. **AN APPROVED PERMISSION CAN BE INERT WHILE THE APP SAYS IT IS ON — DESIGN GAP.**
   `topics.manage` was granted and the delta landed, but `/talks/topics` gates on `topics.view`,
   which `org_president` does not hold — verified end to end: the EQ president still gets *Not
   permitted*. The card meanwhile reads *"This is now turned on for your ward."* One request grants
   one permission, and `*.manage` without `*.view` is unreachable.

**CHECKLIST CORRECTED (STEP 4).** The single line *"A notification reaches the ward on a decision,
and the super admins on a submission"* was two different checks sharing one tick — and the half that
failed is the half a single tick would have hidden. It is now two lines, and the second names the
mechanism so a later reader knows what to look at.

**STEPS 5–7 COULD NOT BE COMPLETED AS WRITTEN, and that is Finding 1.** They say to sign in as the
super admin and use the page. The decisions were driven through the API instead — the same handlers,
but **the decision controls have never been rendered or clicked by anybody**, and neither has the
"Approve for every ward" confirmation. Not ticked.

**NOT PERFORMED HERE:** the table-level write refusal is cited from
`tests/rls/access-requests.test.ts` (11 ✓ in the full run 40 minutes earlier) rather than driven —
the app exposes no raw table client to a browser, so there is nothing for a walk to drive.

### Judgements answered, and all three defects fixed — same day

**The user answered the three judgement questions and both follow-up decisions, and the walk was
re-driven to prove each fix.**

| Judgement | Answer |
|---|---|
| Does a denial read as a decision somebody made? | **Yes — "decision a person made".** No change needed. |
| Readable at 375px, and obvious somebody else must answer? | **Yes and yes.** No change needed. |
| Should a bishop read raw permission keys? | **No** — *"the descriptor used in the role access management page"* |

That third answer turned out to be larger than a labels map, and **it is what fixed defect 3.**
The prototype's role-access page does not label permissions; it works in MODULES with descriptors
and a LEVEL (`role × module × level`), and its request rows read *"Relief Society President —
Sacrament — Talks (Full)"*. Adopting that shape (migration 075, `lib/access/accessModules.ts`)
means a request expands to a coherent set whose `full` always contains its own `read` — so a grant
can no longer arrive inert.

**RE-WALKED 2026-09-22, all three proven fixed:**

| Was | Now |
|---|---|
| Super admin → *Not permitted* on both screens | **Reaches the queue**, with the three decision controls and the note field. The `/admin` layout now admits a structural super admin, and `GET /api/access-requests` no longer requires `admin.view` |
| `access_request_submitted` → **0 rows** | **1 row.** `users!user_id!inner` disambiguates the embed |
| `topics.manage` granted → `/talks/topics` still refused | **Music granted → `/music` opens.** `role_access` reads `{"org_president":{"add":["music.view","music.manage"]}}` — both halves |
| Picker offered 39 raw keys | **15 modules with descriptors**, a one-line explanation, and Full / Read only |

Ward B's canary stayed byte-identical through the re-walk. The audit detail now carries
`module` and `level` rather than a permission. **The same ambiguous-embed bug was fixed in
`countActiveSuperAdmins()` (`lib/auth/adminUsers.ts`), where it was pre-existing from `2bd7f4e`
and threw rather than failing silent.**

**STILL NOT WALKED:** the app-wide grant and its fan-out. The controls are now reachable, but
"Approve for every ward" was not pressed — its confirmation wording remains unread by a human, and
`tests/lib/appWideGrant.test.ts` is still the only thing standing behind it.
