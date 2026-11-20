---
id: roster-decides-callings
type: feature
iter: ITER-058
commits: ["642cc97", "6e49314", "28270c2"]
date: 2026-11-16
files:
  - supabase/migrations/105_user_member_links.sql
  - lib/callings/lcrCallingMap.ts
  - lib/callings/memberLinks.ts
  - lib/callings/linkAccess.ts
  - lib/callings/queries.ts
  - lib/validation/memberLink.ts
  - app/api/member-link/route.ts
  - app/api/admin/member-links/route.ts
  - app/api/admin/member-links/[id]/route.ts
  - components/callings/IsThisYouCard.tsx
  - app/(app)/dashboard/page.tsx
  - app/(app)/admin/users/page.tsx
  - app/(app)/admin/users/UserRow.tsx
  - app/(app)/admin/users/MemberLinkControls.tsx
  - types/domain.ts
  - testing/infrastructure/seedUtils.ts
  - lib/callings/callingReview.ts
  - lib/callings/applyCallingReview.ts
  - lib/callings/loadCallingReview.ts
  - lib/callings/writeCalling.ts
  - lib/validation/callingReview.ts
  - lib/validation/adminUser.ts
  - lib/auth/session.ts
  - app/api/callings/review/route.ts
  - app/api/callings/override/route.ts
  - app/(app)/admin/users/CallingReview.tsx
  - app/(app)/admin/users/OverrideControls.tsx
  - app/(auth)/no-calling/page.tsx
  - supabase/migrations/106_invite_member.sql
  - supabase/migrations/107_invite_declined.sql
  - lib/auth/invites.ts
  - lib/validation/invite.ts
  - app/api/auth/invite/route.ts
  - app/api/auth/invite/not-me/route.ts
  - app/api/auth/register/route.ts
  - app/(auth)/invite/[token]/page.tsx
  - app/(auth)/invite/[token]/RegisterForm.tsx
  - app/(app)/admin/users/InviteForm.tsx
  - app/(app)/admin/users/CallingsWithoutAccount.tsx
  - lib/notifications/triggerDefaults.ts
related: [ward-callings-model, zoom-remote-links, roster-paste-import, bishopric-visits, p2-admin-and-access]
---

## What was done

**cr1 (ITER-058, slice 1 of 4).** Each login can now be linked, once per ward, to its person on the
ward list (`user_member_links`, migration 105). There are three ways in: **Is this you?** on the
dashboard when exactly one person on the ward list carries the login email; **Ask the bishopric** for
everyone else; and a bishopric member linking someone on Admin → Users, where waiting requests sit at
the top. The one map from LCR title to app calling (`lib/callings/lcrCallingMap.ts`) was agreed with
the user against Buffalo's 89 real titles. `ward_role_assignments.source` now records where a calling
came from. **Linking changes nobody's calling yet**; cr2 adds the review that does.

## Key decisions

- **A link decides privileges, so it has no write policy and nobody links themselves.** The route and
  the library both refuse it, the super admin included. The only self-service path is confirming
  your own email match, which is re-checked on the server against Supabase Auth's login email. Two
  people sharing an address is no match: guessing between them could link someone to their spouse's
  calling.
- **Title map, agreed 2026-11-16 (Task 0):** no LCR title maps to `ward_council_member`, because
  every calling the user named as the ward council already maps to its own, higher-ranked role.
  `Resource Center Specialist` **is** mapped, which reverses P7's list. Assistant clerk, EQ ministering
  secretary, Young Men, youth classes and every stake title grant nothing.
- **The own-link route asks for no permission.** Gating it on `personal_tools.use` would tie linking
  to whether a ward has released To Do. It is account-level, like the dashboard, and the table carries
  no released-module policy for the same reason.
- **Departures from the plan:** link status is joined on the Admin → Users page rather than added to
  `listWardUsers()`, which keeps `updateWardUser()`'s re-read untouched. The controls live in a new
  `MemberLinkControls.tsx`, and the gate in a new `lib/callings/linkAccess.ts`
  (`canManageMemberLinks`, `needsRosterLink`).

## Gaps and follow-ups

- **Vitest must be run from PowerShell (or any shell whose cwd reads `C:\`), not Git Bash.** From
  Bash the cwd is `c:/…`, vitest loads two copies of itself, and EVERY file fails with `Cannot read
  properties of undefined (reading 'config')` at its first `describe` — including untouched files.
- **A bash heredoc turns `\\n` inside a Python string into a real line break.** It split a
  `seedUtils.ts` comment and broke the harness typecheck. Avoid backslash escapes in heredoc edits.
- **Buffalo runbook (before cr2 matters):** Admin is unreleased there, so only the super admin can
  open Admin → Users until it is released (ITER-041). "Is this you?" works regardless.

## cr2 — the Calling review (2026-11-17)

### What was done

**cr2 (ITER-058, slice 2 of 4).** Admin → Users now compares the ward list with the app for every
linked account and lists each difference as an unticked row. Nothing changes until a person ticks a
row and presses Apply. Admin → Users no longer sets roles: the one hand edit left is the super
admin's marked override, which goes back on every review. An account with no calling left lands on
`/no-calling` instead of a 500.

### Key decisions

- **The review is computed on read, and `buildCallingReview()` is the one comparison.** cr3's paste
  review must call it rather than write a second copy.
- **Apply takes only ticked ids and recomputes first.** A row id carries its target, so a tick the
  recompute no longer produces counts as stale and is never applied to something nobody saw.
- **`createCalling` and `updateCalling` and `endCalling` take a required `source`,** so every caller
  has to say where a calling came from.
- **Each guard refuses only its own row:** the last bishop, your own calling unless you are the super
  admin, and an organization that cannot be resolved.
- **A row with a waiting change says so** ("Change waiting in the Calling review"), decided by the
  user on walking scenario 103b. An override row keeps its own line, because an override always has
  a review row.

### Defects found walking scenario 103b, all fixed and re-walked

- **D1: a super admin saw every account as "Not linked".** Their `super_admin` calling is not admitted
  to the ward's links by policy, and the page read them through the caller's client. The links and the
  review now read through the service role, after `canManageMemberLinks()`.
- **D2: applying the last row removed its own result.** The refresh emptied the review and the page
  unmounted it. The review now stays mounted and hides itself when it has nothing to show.
- **D3: applied rows stayed on screen under "Applied …" until the refresh landed.** They are now
  hidden when the server answers, and the button reads "Updating…" until the refresh arrives.

**Pattern:** a page that gates on a permission and then reads through a policy can disagree with
itself for a role the policy does not name. Nothing errors; the rows are simply absent.

### Verification

Full suite 398 files and 5,783 tests passed, production build passed, and scenario 103b was walked and
re-walked by Claude in a browser. **The user has not walked it themselves** and chose to test later.

### Gaps and follow-ups

- **`endCalling()` stamps `ended_on` in UTC** (`lib/callings/writeCalling.ts:187`), so a release after
  5pm Mountain is dated the next day. Seen on the walk, not fixed.
- **React "missing key" warning pointing at `UserRow`.** Cause not confirmed.
- **Sending `role` in the user PATCH body is refused with "Say whether the account is active."** The
  refusal is right and the sentence does not explain it.
- **A released account logs a `console.error` on each request.**
- **The longer pending-review line was not re-checked at 375px.**

## cr3 — calling changes on a roster paste (2026-11-19)

### What was done

**cr3 (ITER-058, slice 3 of 4, no migration).** A pasted ward list now proposes calling changes on the
paste checklist, and never makes one by itself. The preview runs `buildCallingReview()` over the roster
as if the paste had landed (`diff.pastedRoster`: the pasted callings text, plus who the paste brings back
or leaves off). The apply writes the roster first, then `applyCallingReview()` recomputes from what was
stored and applies only the ticked calling ids. `members.callings` updates on every paste; the app
calling waits for a tick. An importer outside the bishopric is told changes exist and is sent none of
them, and any calling id from them is a 403 before anything is written.

### Key decisions

- **One comparison, again.** The paste calls `loadCallingReview(wardId, service, pasted)` with the
  pasted facts laid over the stored roster, so the checklist and Admin → Users cannot disagree.
- **Departure from the plan:** the plan had `runPastePipeline` load the links. A separate
  `loadPasteCallingReview()` on the service role runs after the `canManageMemberLinks()` gate instead,
  so `pasteRequest.ts` is unchanged and the gate sits beside the read it protects (cr2's D1 lesson).
- **Calling ids are not roster ids.** `isCallingReviewId()` keeps them out of the paste's own stale count.
- **A release for somebody the paste leaves off is part of their move-out (defect 104-D1, the user's
  call on walking scenario 104).** It first shipped as two linked rows, "No longer listed" and "Calling
  releases", ticking together; the user said it read as two separate things. It is now one row, *and ends
  their {calling} calling*, one checkbox, counted once by `countTickedChanges()`. A release is only
  tied to a move-out when the actor can apply it, so a person who pastes themselves off the list is
  never handed their own release through their move-out.
- **The audit row is the record of who changed a calling** (the user, question 5). The done card counts;
  `calling_changed_from_roster` carries `user_id` and `targetUserId`.

### Verification

Full suite 400 files and 5,815 tests passed after the 104-D1 fix, and the production build passed. Scenario
104 was walked by Claude and the user answered its five questions; 104-D1 was fixed and re-walked.

### Gaps and follow-ups

- **Rename `ROLE_LABELS.ward_secretary` to "Ward Clerk" app-wide** — the user's answer to question 1,
  deliberately a separate change after cr3 (one label, 33 reading files, tests that assert the wording).
- **`endCalling()` still stamps `ended_on` in UTC.** Seen again on the re-walk: a release at 01:13 UTC,
  the ward's evening of 11-19, was dated 2026-11-20.
- **The `UserRow` "missing key" warning** is still there on Admin → Users.

## cr4 — invites name a person on the ward list (2026-11-19)

### What was done

**cr4 (ITER-058, slice 4 of 4, migrations 106 and 107).** An invite now names a **person on the ward
list** and never a role. `POST /api/auth/invite` takes `{ email, memberId }` (`.strict()`), and the server
works the calling out from that person's ward list callings when the invite is made, when its page opens,
and again at redemption, before any auth user exists. The invitee must tick **Yes, this is me**.
Redemption creates the calling as `source: 'roster'` and the link with `method: 'invite'`, and any failure
undoes the whole account. Admin → Users gained **Callings with no linked account**, a collapsed group with
an Invite button on each row, and the Invite card picks a person instead of a role.

Walking scenario 105 added two more things (migration 107). **One live link per person:** a new invite
cancels the person's older waiting ones, and reopening the window fetches the waiting link back.
**"No, this isn't me" now does something:** it asks once, then a public token-only route stamps
`invites.declined_at` (the link is dead), audits with a null user and ids only, and notifies the sender.

### Key decisions

- **Departure from the plan:** the plan made "no account yet" a `noAccount` row kind inside the Calling
  review. It shipped as a separate pure function, `listUnlinkedHolders()`, in its own collapsed group
  (`CallingsWithoutAccount.tsx`). Nothing on it is applied, so as a review row it would have sat on Apply
  and on the paste checklist doing nothing.
- **An unlinked account with the person's roster email suppresses Invite** ("may be this person — link
  them on their row"), because inviting would make a second account for somebody who has one.
- **A new link cancels the old one after the insert, not before**, so a failure leaves two working links
  and a `warning` sentence rather than none.
- **The waiting link is fetched when the window opens** (`GET /api/auth/invite?memberId=`, through the
  caller's client under 019's bishopric policy), never written into the page HTML.
- **A declined invite is "dead", not deleted.** Claim and preview both refuse it, and it reads like any
  other invalid link, so a token's state is never disclosed.
- **No To Do item for the sender** on "not me": it would need a new link column and writer on `todos`.
  The flagged row plus the notification do the job. The user accepted this in the plan.

### Defects and findings from the walks

- **Invalid UTF-8 broke `next build`.** Python edits wrote `—` as cp1252 byte 0x97 in two files. Vitest
  accepted it and `next build` refused it. Fixed by re-encoding those lines. **Pattern:** a script that
  writes source must say `encoding="utf-8"`. Run the build, not only the tests, before calling a slice done.
- **The bell is a placeholder until P12**, so `invite_declined` (like every notification) is stored but
  shown nowhere. The scenario's "open the bell" step was corrected to a database check. The user kept the
  thank-you page's "We've told the person who sent this invite" as it is.
- **The first walk's dark screenshot came out light.** The app applies the theme when the page loads, so
  scenario 105 now says to reload after switching.

### Verification

Full suite 401 files and 5,831 tests passed before the walk follow-up. After it, typecheck, lint (0
errors), the harness typecheck, `next build`, and the 88 tests across the 9 files that touch the changed
code passed. Scenario 105 was walked twice by Claude in Playwright, every write read back with the service
role, and the user answered all eight judgement questions (all accepted as built).

### Gaps and follow-ups

- **ITER-070** (backlogged): an email the ward list must know, a hand link plus an LCR to-do when it does
  not, and a calling the sender chooses that overrides the roster. That reverses cr4's core rule.
- **A super admin acting under a `super_admin` calling still cannot invite**: `invites` inserts through
  019's bishopric-only policy (unchanged; an open gap).
- **The `UserRow` "missing key" warning** is still there. It predates cr4.
