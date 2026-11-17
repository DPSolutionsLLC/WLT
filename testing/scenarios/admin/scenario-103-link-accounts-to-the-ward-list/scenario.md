---
name: Link accounts to the ward list
scope: admin
part: 1
tags: [callings, admin, full, security, ITER-058]
prerequisites: Migration 105 applied; Admin released for the Harness Test Ward.
---

## Purpose

ITER-058 slice **cr1**. Each login is linked, once per ward, to its person on the ward list. Linking
on its own **changes nobody's calling or access**. From cr2 on, a linked account's calling follows
the ward list, after a review.

There are three ways to be linked:

- **Is this you?** — when exactly one person on the ward list has the account's login email, the
  dashboard offers that person; **Yes, this is me** links them.
- **Ask the bishopric** — anyone else asks, and never browses or picks from the ward list.
- **A bishopric member links them** on Admin → Users, choosing the person. **Nobody can link their
  own account** this way, the super admin included.

A link decides privileges from cr2 on, so `user_member_links` has no write policy at all: only the
server writes it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| bishop (Mark Andersen) | **Already linked**, to Mark Andersen on the ward list (linked by Aaron Pike) |
| counselor-1 (Aaron Pike) | Ward list email **is** their login email → offered *Is this you?* |
| counselor-2 (Lena Ortiz) | Ward list email is a family address → must ask |
| ward-clerk (Ruth Kim) | Shares a ward list email with Daniel Kim → no single match → must ask |
| eq-president (Tom Reyes) | **Has already asked**; waiting |
| Ward list | The five above plus Daniel Kim and Hannah Baker, each with real LCR calling wording (read in cr2) |

## Steps

1. Sign in as **counselor-1**. Look at the dashboard.
2. Press **No**. Then reload the page.
3. Press **Yes, this is me**.
4. Sign in as **counselor-2**. Press **Ask the bishopric to link me**. Reload.
5. Sign in as **ward-clerk** and look at the dashboard.
6. Sign in as the **bishop**. Open **Admin → Users**.
7. On Tom Reyes's request press **Link to roster person**, search *Reyes*, choose **Tom Reyes**,
   then press **Link**.
8. On Lena Ortiz's row press **Link to roster person**, choose **Hannah Baker** and press **Link**.
   Then press **Unlink** twice on that row, and link Lena to **Lena Ortiz** (choose, then **Link**).
8b. On Ruth Kim's row press **Link to roster person** and look at Mark Andersen. Choose **Tom
   Reyes** and press **Link**.
9. Look at your own row (Mark Andersen).
10. Sign in as **counselor-2** and look at the dashboard.
11. Repeat steps 1, 6 and 7 at **375px**, in light and dark.

## Verification Checklist

- [ ] Step 1: a small card titled **Is this you?** reads *Aaron Pike, born 1979*, with **Yes, this is
      me** and **No**. It sits **above the module tiles**, under the greeting
- [ ] Step 2: **No** swaps the card to *Your account isn't linked to the ward list yet…* with **Ask the
      bishopric to link me**; after a reload *Is this you?* is back (No records nothing)
- [ ] Step 3: the card disappears. `user_member_links` has an `active` row for Aaron with
      `method = email_match` and `linked_by` null (read back). Audit `member_link_created` carries
      ids and the method only. Aaron's calling is unchanged (still 1st counselor)
- [ ] Step 4: the card reads *Waiting for the bishopric to link your account.*, before and after the
      reload. A `pending` row with no member (read back). The bishop and Aaron each get an
      `admin_setting_changed` notification row (read back)
- [ ] Step 5: Ruth gets the **ask** card, not *Is this you?* — two people share her email
- [ ] Step 6: **Waiting to be linked to the ward list** sits above the invite form, listing Tom Reyes
      and Lena Ortiz, each with **Link to roster person** and **Decline**. Every row reads *Linked to
      Mark Andersen* / *Linked to Aaron Pike* / *Waiting to be linked* / *Not linked to the ward list*
- [ ] Step 7: choosing Tom Reyes saves nothing yet — the request shows *Link Tom Reyes to Tom
      Reyes?* with **Link** and **Cancel**, and there is still one pending row (read back). After
      **Link**, Tom leaves the waiting list and his row reads **Linked to Tom Reyes**. The same row id
      moved from `pending` to `active`, with `method = admin` and `linked_by` = the bishop (read back).
      Audit `member_link_approved`
- [ ] Step 8: the first press of **Unlink** only changes its label to *Unlink? Tap again* (the link
      is still `active`, read back); the second ends it. Unlink leaves the Hannah Baker row as `ended` with `ended_by` = the bishop — never
      deleted (read back) — and the second link is a new `active` row
- [ ] Step 8b: in the picker Mark Andersen reads *Linked to Mark Andersen's account*. Linking Ruth to
      Tom Reyes is refused with *Tom Reyes is already linked to another account. Unlink them first.*
      — not "Ask your bishopric" — and Ruth is still `pending` (read back)
- [ ] Step 9: the bishop's own row has **no** link controls. A direct
      `POST /api/admin/member-links` with the bishop's own user id answers **403** *You can't link your
      own account…* (devtools fetch)
- [ ] Step 10: Lena's card is gone
- [ ] Every step: nobody's role, organization or counselor position changed (read back
      `ward_role_assignments` — every `source` is still `manual`)
- [ ] Step 11 (375px): the card's buttons wrap without overflow; the waiting list and the row controls
      wrap cleanly; every button is at least 44px tall

## Edge Cases

- No authenticated client can insert, update or delete a link, the bishop included; a second active
  link to one person and a link across wards are refused by the database:
  `tests/rls/user-member-links.test.ts`.
- Confirming someone else's email match (403), a body that tries to choose a record while asking
  (400), an account from another ward (400), a record already linked to another account (409),
  somebody outside the bishopric (403), and ending your own link (403):
  `tests/routes/member-link.test.ts`.
- The match ignores case, and refuses when two people share the email: `tests/routes/member-link.test.ts`
  and step 5.

## Walkthrough record

### 2026-11-16 — driven by Claude (Playwright, local dev server on :3000), screenshots awaiting the user's review

Not yet used by a person. Every write was read back with the service-role client. Screenshots are in
`testing/walk-screenshots/scenario-103/` (excluded from git). Review page:
https://claude.ai/artifact/FwJoTsxBex79iJTWeTP3GP

Observed:
- Step 1: card text was `Is this you? / Aaron Pike, born 1979 / Yes, this is me / No`, with both buttons 44px
  tall. **The card is the last block on the dashboard**: y≈1150px on desktop, and y≈2309 of a 2482px
  page at 375px. Placement is with the user.
- Step 2: No wrote nothing (still 2 link rows), and *Is this you?* came back after a reload.
- Step 3: row `cae450a0` was `active` / `email_match` / `linked_by` null. Audit `member_link_created`
  held `{linkId, method, memberId}`. Mark and Lena each got `admin_setting_changed` ("Aaron Pike
  confirmed which person on the ward list they are.").
- Step 4: `pending` row `d16d73f3` with `member_id` null, and audit `member_link_requested`. Mark and
  Aaron each got `admin_setting_changed`. The card read "Waiting for the bishopric to link your account."
  before and after a reload.
- Step 5: Ruth got the ask card, and *Is this you?* appeared nowhere on her page.
- Step 6: the waiting list (Lena, Tom) sat above "Invite someone", and all four status strings appeared.
- Step 7: the same row `97388de2` went from `pending` to `active`, with `admin`, `linked_by` = Mark
  Andersen, and audit `member_link_approved` with `targetUserId`.
- Step 8: `d16d73f3` (Hannah Baker) ended up `ended`, `ended_by` Mark Andersen, not deleted. The new
  active row is `c14c076e` (Lena Ortiz). Audit: `member_link_approved`, `member_link_ended`,
  `member_link_approved`.
- Step 9: the bishop's own row had no link controls. A direct POST with his own user id and Hannah
  Baker (a valid, unlinked member, so self-linking is the only reason it can fail) answered 403
  "You can't link your own account. Another member of the bishopric needs to do it.", and wrote nothing.
- Step 10: Lena's dashboard had no card and no ward-list text.
- Every step: all 5 `ward_role_assignments` stayed `source = manual`, with role, organization and
  position unchanged.
- Step 11: run after a reseed. At 375px in light and dark there was no horizontal overflow, no element
  past the right edge, and no visible button under 44px on the dashboard card, Admin → Users or the
  picker (a bottom sheet). Step 7 repeated at 375px: row `cf8ce51f` went pending → active, admin, by
  the bishop.

**Defect found (not fixed):** on Admin → Users, picking a person who is already linked is refused
correctly (nothing is written), but the bishop is shown "This roster record is already linked to
another account. **Ask your bishopric.**" One constant, `MEMBER_ALREADY_LINKED_MESSAGE`
(`lib/callings/memberLinks.ts:38`), serves both the member's confirm and the admin link.
Reproduce: Admin → Users → Link to roster person on a waiting request → choose someone already linked.

Other observations for the user:
- The picker lists already-linked people without marking them.
- A pick links on one tap, and Unlink ends a link on one tap. Neither asks to confirm.
- For about a second after a pick or an Unlink, the row shows its previous status.
- The ask card says "and then your calling here follows the ward list", which is true only from cr2.

Checklist corrections: none. Every line describes a reachable state and can fail.
Not walked: the Edge Cases (they live in Vitest suites).

**The user's answers (2026-11-16):** (1) fix the defect — the Admin path now says "{Name} is already
linked to another account. Unlink them first."; (2) the card moves above the tiles until answered;
(3) the ask card's cr2 wording stays; (4) the picker marks already-linked people, a pick asks
Link / Cancel before saving, and Unlink takes a second tap; (5) the phone layout is fine. Steps 1,
7, 8 and the new 8b were changed to match.

### 2026-11-16 (later) — re-walk of the fixes, driven by Claude (Playwright, :3000)

- Step 1: the card's top is at y=214 on desktop, above the first tile (y=383), and at y=270 at 375px
  with no horizontal overflow.
- Step 7: choosing Tom Reyes showed "Link Tom Reyes to Tom Reyes?" with Link / Cancel, and the row was
  still `pending` (read back). Link then moved it to `active` / `admin` / by Mark Andersen.
- Step 8: Lena → Hannah Baker. The first Unlink tap showed "Unlink? Tap again" and the link was still
  `active` (read back). The arm cleared itself after 4 seconds, as designed. Two taps ended it
  (`ended`, `ended_by` Mark Andersen), and Lena → Lena Ortiz is a new `active` row.
- Step 8b: the picker read "Mark Andersen — Linked to Mark Andersen's account", "Hannah Baker — Linked
  to Lena Ortiz's account" and "Tom Reyes — Linked to Tom Reyes's account". Linking Ruth to Tom Reyes
  answered 409 "Tom Reyes is already linked to another account. Unlink them first.", and Ruth gained no
  row.
- All five callings were still `manual`.

Seen, not changed: every MemberPicker on a page shares the search input id `member-picker-search`, so on
Admin → Users the "Search" label points at the first picker's input. This was already the case before
this change. After a pick, the trigger reads "Choose someone else · 1 selected".
