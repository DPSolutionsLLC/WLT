---
name: The calling review
scope: admin
part: 2
tags: [callings, admin, full, security, ITER-058]
prerequisites: Migration 105 applied; Admin released for the Harness Test Ward.
---

## Purpose

ITER-058 slice **cr2** (scenario 103, Part 2). For an account linked to its person on the ward list,
the app calling now **follows the ward list** — but only through the **Calling review** on Admin →
Users, where a person ticks each change. Nothing applies on its own, in either direction.

- Admin → Users **no longer sets roles** for anybody.
- The **super admin** alone may **override** a calling. It is marked *Overridden — differs from the
  ward list* and comes back on every review until it is cleared.
- Releasing somebody's only calling sends them to a plain page, not an error.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| bishop (Mark Andersen) | Linked; ward list says **Bishop** — agrees |
| counselor-1 (Aaron Pike) | App says **1st**, ward list says **2nd**. **Not linked**; ward list email is his login → *Is this you?* |
| counselor-2 (Lena Ortiz) | App says **2nd**, ward list says **1st**. Not linked; no email match → must ask |
| ward-clerk (Ruth Kim) | Linked; ward list says **Ward Clerk** — agrees |
| eq-president (Tom Reyes) | Linked; app says **Elders Quorum Counselor**, ward list says **Elders Quorum President** and **Ward Mission Leader** |
| music-coordinator (Paul Grant) | Linked to somebody who has **moved out** |
| exec-secretary (Sam Lee) | Linked; ward list says only **Ward Assistant Clerk**, which the app does not recognise |
| super-admin (Dana Whitlock) | Super admin, calling `super_admin` |
| Zoom | A stream remote link on the **1st Counselor** position, held by Aaron |

## Steps

1. Sign in as **counselor-1** (Aaron). Press **Yes, this is me**.
2. Sign in as **counselor-2** (Lena). Press **Ask the bishopric to link me**.
3. Sign in as the **bishop**. Open **Admin → Users**. Link Lena to **Lena Ortiz** (choose, then **Link**).
4. Look at the **Calling review** and at each user row.
5. Sign in as **counselor-1** (Aaron) and look at the review.
6. Sign in as the **bishop**. Tick the two counselor rows and Tom Reyes's row. Press **Apply ticked (3)**.
7. Open **Zoom → Remote links**.
8. Back on Admin → Users, look at the **Releases** group. Try **Tick all** there. Tick Paul Grant's
   release alone and apply it.
9. Sign in as **music-coordinator** (Paul).
10. Sign in as **super-admin**. On Admin → Users, press **Override calling** on Ruth Kim's row, choose
    **Executive Secretary**, and save. Look at her row and at the review.
11. Press **Clear override** on Ruth's row and look at the review again.
12. Repeat steps 4 and 10 at **375px**, in light and dark.

## Verification Checklist

- [ ] Step 1–3: Aaron links himself through *Is this you?*; Lena's card reads *Waiting…*; after the
      bishop links her, both are `active` links (read back). **No calling changed** (every
      `ward_role_assignments.source` still `manual`)
- [ ] Step 4: the review lists, all **unticked**: *Aaron Pike: from 1st Counselor to 2nd Counselor*;
      *Lena Ortiz: from 2nd Counselor to 1st Counselor*; *Tom Reyes: from Elders Quorum Counselor to
      Elders Quorum President*, naming *Calling not recognised: Ward Mission Leader*; under
      **Releases**, Paul Grant (*no longer on the ward list*) and Sam Lee (*holds no calling the app
      recognises*, naming *Ward Assistant Clerk*). Mark Andersen and Ruth Kim have **no** row
- [ ] Step 4: no user row has a role or organization dropdown. Each shows its calling and *From the
      ward list* / *Set by hand* / *Set by hand (not linked)*. The bishop's own row has no Deactivate
      that works (disabled), and a direct `PATCH /api/admin/users/{own id}` with `{"isActive": false}`
      answers 400 *You can't deactivate your own account…* (devtools fetch)
- [ ] Step 5: Aaron cannot tick his own row (it sits under *Can't apply here* with *This is your own
      calling…*); a direct `POST /api/callings/review` with his own row's id answers 200 with that
      row under `refused`, and his calling is still 1st Counselor (read back)
- [ ] Step 6: the result reads *Applied 3 calling changes*. Aaron is 2nd and Lena 1st, Tom is
      `org_president`, each with `source = roster` (read back). Three `calling_changed_from_roster`
      audit rows carrying ids and roles and **no names**. Aaron and Lena each get one
      `admin_setting_changed` notification naming the three changes (read back)
- [ ] Step 7: the 1st Counselor position reads **Needs a new link** — the old link was turned off
      (`deactivated_reason = holder_changed`, read back)
- [ ] Step 8: **Tick all** is disabled in Releases. Paul's release applies only when ticked; Sam's
      row is still there, unticked, and Sam's calling is still active (read back)
- [ ] Step 9: Paul sees *You no longer hold a calling in Harness Test Ward. If this is a mistake,
      contact your bishopric.* with **Sign out** — not an error page. Sign out works and lands on
      sign in
- [ ] Step 10: Ruth's row reads **Executive Secretary** and *Overridden — differs from the ward list*
      (in the warning colour). The row in `ward_role_assignments` has `source = override`,
      `override_by` = the super admin and `override_at` set. The review shows an **override** row for
      Ruth: *overridden by the super admin as Executive Secretary. The ward list says Ward
      Secretary…*, unticked. Audit `calling_override_set`
- [ ] Step 11: Ruth's row reads *From the ward list · Change waiting in the Calling review*
      (`source = roster`, override columns null — it read *Set by hand* before the override, because
      the seed's callings are `manual`) and the review shows an ordinary change back to Ward
      Secretary. Audit `calling_override_cleared`
- [ ] Step 4: Aaron's, Lena's, Tom's, Paul's and Sam's rows each end *· Change waiting in the Calling
      review*; Mark's and Ruth's do not
- [ ] A bishopric member (not the super admin) has **no** Override button, and a direct
      `POST /api/callings/override` answers 403
- [ ] Step 12 (375px): the review groups, the result card and the override window wrap without
      horizontal overflow; every button and checkbox row is at least 44px tall

## Edge Cases

- The last active bishop cannot be changed away; the other ticked rows still apply. A tick the review
  no longer produces is counted as out of date. An override by a non-super-admin is a 403:
  `tests/routes/calling-review.test.ts`.
- Every row kind, a counselor swap as two changes, precedence, unrecognised titles, an override that
  already matches (no row), a ward with no or two organizations of a type (cannot apply), and
  non-ward-list roles (`super_admin`, `sacrament_manager`) skipped: `tests/lib/callingReview.test.ts`.
- A body that sends a role to `PATCH /api/admin/users/[id]` is a 400: `tests/routes/admin-users.test.ts`.

## Walkthrough record

### 2026-11-17 — driven by Claude (Playwright, local dev server on :3000), screenshots awaiting the user's review

Not yet used by a person. Every write was read back with the service-role client
(`.walk103b/q.mjs`, excluded from git). Screenshots: `testing/walk-screenshots/scenario-103b/`.

Observed:
- Steps 1–3: Aaron's card read "Is this you? / Aaron Pike, born 1979 / Yes, this is me / No"; Yes linked
  him (`active` / `email_match` / `linked_by` null). Lena's card read "Waiting for the bishopric to link
  your account." before and after a reload. The bishop's pick showed "Link Lena Ortiz to Lena Ortiz?";
  Link made her `active` / `admin` / by Mark Andersen. All 8 callings still `manual`.
- Step 4: the review read "Calling review (5)": Calling changes (3) — the two counselor rows and Tom
  Reyes (with "Calling not recognised: Ward Mission Leader"); Releases (2) — Paul Grant (no longer on the
  ward list) and Sam Lee (no recognised calling, naming Ward Assistant Clerk). 0 boxes ticked. Mark and
  Ruth had no row. 0 `<select>`s in the user list; the bishop's own Deactivate disabled. Direct PATCH of
  the bishop's own id with `{isActive:false}` → 400 "You can't deactivate your own account. Ask another
  member of the bishopric." A PATCH with `{role:"bishop"}` → 400 (but reading "Say whether the account
  is active." — see below). A bishop's override POST → 403; no Override button for the bishop.
- Step 5: as Aaron, his row sat under "Can't apply here (1)" with "This is your own calling. Another
  member of the bishopric applies it." A direct POST of his row id → 200, `applied: []`, refused with
  "You can't apply a change to your own calling…"; he stayed 1st Counselor (read back).
- Step 6: "Apply ticked (3)" → "Applied 3 calling changes." Read back: Aaron 2, Lena 1, Tom
  `org_president` (Elders Quorum), all `source = roster`. Three `calling_changed_from_roster` rows with
  ids/roles/positions and no names. Aaron and Lena each got "Callings updated from the ward list —
  Mark Andersen applied 3 calling changes from the ward list: Aaron Pike: 2nd Counselor; Lena Ortiz: 1st
  Counselor; Tom Reyes: Elders Quorum President."
- Step 7: Remote links read "1st Counselor — Needs a new link — the last one was for Aaron Pike."
  `counselor_1` has no URL, `deactivated_reason = holder_changed`; audit `zoom_remote_link_turned_off`.
- Step 8: Releases' Tick all disabled. Paul's release alone → "Applied 1 calling change."; his calling
  `is_active = false`, `ended_on = 2026-11-17`; Sam still active and still listed.
- Step 9: Paul landed on "You no longer hold a calling in Harness Test Ward. If this is a mistake,
  contact your bishopric." with Sign out; `/dashboard` → `/no-calling`; Sign out → `/login`. Audit
  `login` and `logout` both written for him.
- Step 10: 6 Override buttons for the super admin. Ruth → Executive Secretary: row read "Executive
  Secretary / Overridden — differs from the ward list" in rgb(180, 83, 9) (the warning token). Read back
  `source = override`, `override_by` Dana Whitlock, `override_at` set; audit `calling_override_set`; the
  other three bishopric members notified. The review showed "Ruth Kim: overridden by the super admin as
  Executive Secretary. The ward list says Ward Secretary. Tick to clear the override and use the ward
  list." unticked.
- Step 11: Clear override → `source = roster`, override columns null; audit `calling_override_cleared`
  with `afterSource: roster`; the review shows "Ruth Kim: from Executive Secretary to Ward Secretary."
- Step 12: at 375px, light and dark — Admin → Users, the review and the override window: no horizontal
  overflow, nothing past the right edge, no visible button or select under 44px.

**Defects found (not fixed):**
- **103b-D1 — the super admin sees every account as "Not linked to the ward list".** As Dana (calling
  `super_admin`) all 7 rows read "Not linked…" and offer *Link to roster person*, though 6 are linked.
  `app/(app)/admin/users/page.tsx` reads `listOpenWardLinks()` through the caller's client, and
  migration 105a's policy admits only the account's own link or `is_bishopric()`. The Calling review is
  correct (it reads on the service role after the gate). Pre-dates cr2, but cr2 is what puts the super
  admin on this page.
- **103b-D2 — applying the review's LAST rows would hide its own result.** `CallingReview` renders only
  while it has rows, and Apply refreshes the page, so a review emptied by Apply unmounts with its
  "Applied …" card. Not reached in this walk (rows remained each time), read from the code.
- **103b-D3 — a short stale moment after Apply.** For a few seconds (dev server) "Applied 3 calling
  changes" sat beneath the same three, now-unticked rows, until the refresh landed.

Other observations:
- A body sending `role` is refused with "Say whether the account is active." — true (the schema wants
  `isActive`) but it does not say role changes have moved to the Calling review.
- React dev warning on Admin → Users: "Each child in a list should have a unique key… Check the render
  method of `UserRow`. It was passed a child from AdminUsersPage." Cause not confirmed.
- `session.ts` logs "A session resolved to a ward the user holds no active calling in" with
  `console.error` on every request from a released account — now an expected state.
- Pre-existing, not cr2: the browser autofilled the **Youth accounts** form (Username = the bishop's
  email, PIN = the first 6 characters of the password) on Admin → Users.

**Re-walked 2026-11-17 (evening) — driven by Claude, as super-admin, on the walk's leftover data**
(Ruth's change and Sam's release still waiting). Screenshots `rewalk-01..03`.
- D1: all six linked rows read *Linked to …*; Dana reads *Not linked* (true — `super_admin` needs no
  link). Ruth's row read *From the ward list · Change waiting in the Calling review*, Sam's *Set by
  hand · Change waiting…*; nobody else carried the note.
- D3: applying Ruth's row — on the response her row was already gone, the heading read (1) and the
  button *Updating…*, then *Apply ticked (0)*. Read back `ward_secretary`, `source = roster`; audit
  `calling_changed_from_roster`. Her note cleared after the refresh.
- D2: applying Sam's release emptied the review; after the refresh the section stayed with *Applied 1
  calling change.* and no rows; after a reload it was gone. Read back `is_active = false`.
- New observation: Sam's `ended_on` reads **2026-11-18** for a release at 7:43pm Mountain on the
  17th — `endCalling()` defaults it to the UTC date (`new Date().toISOString().slice(0, 10)`).
  Pre-dates cr2; not fixed.

**Fixed 2026-11-17:** D1 — `page.tsx` reads the links on the service role after
`canManageMemberLinks()`, as the review does. D2 — the review stays mounted with no rows and hides
itself only when it has no rows, no result and no error. D3 — applied rows are hidden as soon as the
response arrives, and Apply reads *Updating…* until the refresh lands
(`tests/components/admin/CallingReview.test.tsx`). Question 5 answered: a row with a waiting review
change now ends *· Change waiting in the Calling review*.

Checklist corrections: Step 11 said "From the ward list *again*"; Ruth's row read *Set by hand* before
the override (seeded callings are `manual`), so "again" was removed.
Not walked: the Edge Cases (Vitest suites).
