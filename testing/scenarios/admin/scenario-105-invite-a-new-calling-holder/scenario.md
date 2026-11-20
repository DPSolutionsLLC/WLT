---
name: Invite a new calling holder from the ward list
scope: admin
part: 1
tags: [callings, admin, invites, full, security, ITER-058]
prerequisites: Migrations 105, 106 and 107 applied; Admin released for the Harness Test Ward.
---

## Purpose

ITER-058 slice **cr4**. An invite now names a **person on the ward list**, never a role: the app works
out the calling from that person's ward list callings, when the invite is made and again when it is
redeemed. The person being invited confirms **"Yes, this is me"**, and their new account lands with
that calling and linked to their ward list record. Admin → Users lists everybody the ward list gives a
calling who has no linked account, with **Invite**, but not when an existing account looks like theirs.

Added walking this scenario (migration 107): each person has **one live link**. Reopening their window
shows the link still waiting, and **Create new invite link** replaces it. **No, this isn't me** asks
once, then cancels the link and tells whoever sent it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| bishop (Mark Andersen) | Linked; ward list says **Bishop** |
| counselor-1 (Aaron Pike) | Linked; ward list says **Bishopric First Counselor** |
| eq-president (Paul Grant) | An account, **not linked**; Elders Quorum President in the app |
| Nora Diaz | On the list as **Ward Clerk**, roster email `nora-diaz@harness.wardleadershiptools.test`, **no account** |
| Lena Ortiz | On the list as **Music Coordinator**, roster email `lena-ortiz@harness.wardleadershiptools.test`, **no account** |
| Paul Grant (member) | On the list as **Elders Quorum President**, roster email = the eq-president account's |
| Tom Reyes | On the list as **Primary Teacher** (not a calling the app recognises), no account |

**Sign in with:** `bishop@` and `counselor-1@`, both `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file. Nora's password is whatever you
choose in step 7 (at least 12 characters).

## Steps

1. `npm run seed -- admin/scenario-105-invite-a-new-calling-holder`
2. Sign in as the **bishop** and open **Admin → Users**. Open **Callings with no linked account**.
3. In the **Invite someone** card, press **Choose from the ward list** and pick **Tom Reyes**. Then pick
   **Paul Grant**.
4. In **Callings with no linked account**, press **Invite** on Nora Diaz. Check the email, press
   **Create invite link**, and copy the link (link A). Close the window. Press **Invite again** on Nora,
   then **Create new invite link**, and copy the new link (link B). Close the window.
5. Press **Invite** on Lena Ortiz, create her link and copy it (link L). Sign out.
6. Open link L. Press **No, this isn't me**, then **Go back**. Press it again, then **It isn't me, cancel
   this link**. Reload the page.
7. Open link A. Then open link B, tick **Yes, this is me**, fill in the form (any name) and press
   **Create account**.
8. Sign in as `nora-diaz@harness.wardleadershiptools.test` with the password from step 7.
9. Sign in as the bishop again and open **Admin → Users**.
10. Repeat steps 2–7 at **375px**, in light and dark (re-seed first). Reload the page after switching
    the theme: the app applies it when the page loads, so switching mid-page does nothing.

## Verification Checklist

- [ ] Step 2: the group reads *Callings with no linked account (3)*, collapsed until opened. **Nora
      Diaz · Ward Secretary** and **Lena Ortiz · Music Coordinator** each have **Invite**. **Paul Grant
      · Elders Quorum President** reads *Paul Grant may be this person — link them on their row below.*
      with no button. Tom Reyes is not listed
- [ ] Step 3: there is **no Role, Organization or Counselor position** field. Tom reads *Tom Reyes holds
      no calling the app recognises, so there is nothing to invite them to.* Paul reads *Paul Grant may
      be Paul Grant already. Link that account on its row instead of sending an invite.* **Create
      invite link** stays disabled for both
- [ ] Step 4: the window's email is filled with Nora's roster email. After creating, it says *Send this
      link to Nora Diaz, …* and the button reads **Create new invite link**. Read back: the `invites`
      row has `member_id` = Nora and `role` null. Nora's row now reads *Invited — not registered yet.*
      with **Invite again**
- [ ] Step 4: reopening shows *Link already made for Nora Diaz* with link A and *A new link cancels the
      one below.* After **Create new invite link**, link B shows. Read back: link A's `expires_at` is now
      in the past and link B is usable
- [ ] Step 4: each `invite_created` audit row holds `inviteId`, `memberId` and `role` and **no names and
      no token**. Aaron is notified
- [ ] Step 6: the page reads *You're invited as Lena Ortiz, Music Coordinator…*. **No, this isn't me**
      shows *This invite is for Lena Ortiz…* and **Create account** is disabled. **Go back** restores
      the form. Confirming shows *Thanks for letting us know*. After the reload the link reads as not
      valid. Read back: `declined_at` is set; audit `invite_declined` has a null user and only
      `inviteId` and `memberId`
- [ ] Step 7: link A reads as not valid. On link B, without the tick, **Create account** shows *Tick
      "Yes, this is me" to continue.* With it, the account is created and the page moves to sign in
- [ ] Step 8: Nora signs in with no "Is this you?" card on the dashboard. Read back: her calling is
      `ward_secretary`, `source = roster`; her `user_member_links` row is `active`, `method = invite`,
      `linked_by` = the bishop
- [ ] Step 9: Nora is listed as *Linked to Nora Diaz*, and is gone from **Callings with no linked
      account** (now 2). Lena's row reads *Said this invite wasn't them today. Check the email, then
      invite again.* with **Invite again**. Read back: one `invite_declined` notification, to the bishop
      only, naming Lena and her email. **There is no bell to see it in yet** (`NotificationBell` is a
      placeholder until P12), so this is a database check. The Calling review shows no row for Nora
- [ ] Step 10 (375px): no horizontal overflow; the checkbox, **No, this isn't me**, both confirm buttons,
      **Invite** and the summary row are each at least 44px tall

## Edge Cases

- A body still carrying `role: "super_admin"` is a 400 that creates nothing; an organization president
  is refused; a person already linked, or with no recognised calling, is refused with a sentence:
  `tests/routes/invite-from-roster.test.ts`.
- Redeeming without "Yes, this is me", or after the person's ward list calling changed to one the app
  does not recognise, is refused **before** an auth user exists, and the link stays usable:
  `tests/routes/invite-from-roster.test.ts`.
- Who appears in the list and in what state (including *declined*, and a fresh invite winning over an
  older "not me"), and the order: `tests/lib/callingReview.test.ts`.
- A new link cancels the old one; the waiting link is refused to an organization president; "not me"
  kills the link, notifies only the sender and audits ids only; a second press or an unknown token is a
  400: `tests/routes/invite-from-roster.test.ts`.
- An invite made before cr4 still carries its role and still redeems: `tests/lib/inviteLifecycle.test.ts`
  and `tests/lib/inviteEscalation.test.ts`.

## Walkthrough record

**Second walk, 2026-11-19 (after migration 107): driven by Claude (Playwright) against `next dev` on
:3000, every write read back with the service-role client.** Screenshots 21–28 in
`testing/walk-screenshots/105/`. Review page: https://claude.ai/artifact/3deaZHLo8fVAfoWnwA1qho (version 2).

- Step 2: *(3)*: Nora · Ward Secretary (Invite), Paul (may-be sentence, no button), Lena · Music
  Coordinator (Invite). Step 3 unchanged from the first walk (both refusals verbatim, Create disabled).
- Step 4: link A created 05:52:01Z; the window then read *A new link cancels the one below.* above **Create
  new invite link**. Reopened via Invite again: *Link already made for Nora Diaz* with link A. **Create new
  invite link** made link B at 05:52:23Z, and link A's `expires_at` became 05:52:23.459Z (cancelled). Three
  `invite_created` audit rows, ids and role only; Aaron notified three times.
- Step 5: Lena's email prefilled; link L created.
- Step 6: confirm text *This invite is for Lena Ortiz. If that isn't you…*; **Create account** disabled
  while asking; **Go back** restored both buttons with Create enabled. Confirming showed *Thanks for letting
  us know*; reloading read *Invite not valid*. `declined_at` 05:53:49Z; audit `invite_declined` with null
  user and `{inviteId, memberId}`; one notification, to the bishop only.
- Step 7: link A read *Invite not valid*. Link B: unticked gave the tick sentence; ticked → `used_at`
  05:54:12Z, `/login?registered=1`.
- Step 8: *Hello, Nora*, no "Is this you?" card. Calling `ward_secretary` `roster`; link `invite`, by the bishop.
- Step 9: *(2)*: Paul, and Lena reading *Said this invite wasn't them today. Check the email, then invite
  again.* with **Invite again**. Nora: *Linked to Nora Diaz* / *From the ward list*. No Calling review.
- Step 10 (partial): 375px light — the declined row, and Invite again on Lena offering **no** waiting link
  (a declined link is not offered), then a new link: no overflow, Create new and Copy link 44px. 375px dark —
  the new link's confirm step and thank-you page: no overflow; checkbox row, both confirm buttons and Create
  account 44px. **Not redone at 375px:** steps 3, 4's reopen, 7.
- **Corrected:** step 9 said "open the bell". The bell is a placeholder until P12, so the notification is
  now a database check, and step 9 no longer says to open it.
- **Answered by the user (2026-11-19):** all four questions accepted as built. That includes keeping *We've
  told the person who sent this invite*, though today it is true only in the database.

**First walk (before migration 107), kept for the record:**

**2026-11-19: driven by Claude (Playwright) against `next dev` on :3000. Every write was read back
with the service-role client. The user had not yet reviewed the four judgement questions.**
Screenshots are in `testing/walk-screenshots/105/` (git-excluded). The review page is
https://claude.ai/artifact/3deaZHLo8fVAfoWnwA1qho

- Step 2: collapsed, *Callings with no linked account (2)*. Nora Diaz · Ward Secretary has Invite. Paul
  Grant · Elders Quorum President reads *Paul Grant may be this person — link them on their row below.*
  with no button. Tom absent.
- Step 3: no Role, Organization or Counselor field. Tom and Paul are each refused with the checklist's
  exact sentence, and Create stays disabled for both.
- Step 4: the email is prefilled. `invites`: `member_id` = Nora, `role` null. Audit `invite_created`:
  `{role: ward_secretary, orgId: null, inviteId, memberId}`, with no names and no token. Aaron is
  notified (`admin_setting_changed`, "Mark Andersen created an invite for Ward Secretary (…)"). The row
  now reads *Invited — not registered yet.* with Invite again.
- Step 5: the page reads *You're invited as Nora Diaz, Ward Secretary for nora-diaz@…*. "No, this isn't
  me" shows the status sentence. The invite stays unused (`used_at` null).
- Step 6: unticked, Create shows the tick sentence, no account exists and the invite stays unused.
  Ticked, `used_at` is set and the page moves to `/login?registered=1`.
- Step 7: dashboard *Hello, Nora*, with no "Is this you?" card. Calling `ward_secretary`,
  `source = roster`. Link `active`, `method = invite`, `linked_by` = the bishop. Audit
  `user_registered` `{role, inviteId, memberId}`.
- Step 8: *4 accounts*. Nora reads *Linked to Nora Diaz* / *From the ward list*. The group shows (1).
  No Calling review rows.
- Step 9: re-seeded. At 375px the page is exactly the viewport's width. The summary row, Invite, the
  checkbox row, No, this isn't me and Create account all measure 44px. In light, steps 2, 4 and 6 were
  redone (6 completed and read back). In dark, step 5 and the tick refusal were redone, and the group
  and picker were captured after registering. **Step 3 at 375px was not redone separately.**
- Order: the link was first opened while still signed in as the bishop (for "No, this isn't me"). I
  signed out before registering.
- **Corrected:** step 9 now says to reload after switching the theme. My first "dark" shot rendered
  light.
- **Not a cr4 defect:** Admin → Users logs React's missing-key warning for `UserRow` on some loads. It
  is development-only, from props this change did not touch.
- **Open for the user (wording and flow, not defects):**
  - "Paul Grant may be Paul Grant already" when the names match.
  - The tick sentence shows beside the "don't set up this account" sentence.
  - Create invite link stays active once the link is shown.
  - Tom carries no note in the picker.
