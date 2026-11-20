# ITER-070: Invites by email, and a calling the sender chooses

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-11-19

## Summary
An invite always goes to an email the ward list knows, which is what matches the new account to the
right person. If the ward list has no email for them yet, the sender links the person by hand and
gets a to-do to add the email in LCR, and the next roster paste confirms it. The calling the sender
chooses on the invite **overrides** what the ward list says, because the list may be out of date.

## Context
Raised by the user on 2026-11-19 while reviewing the walk of scenario 105 (ITER-058 cr4). cr4 shipped
the opposite rule for callings: **an invite names a person and never a role**, and the calling is
re-derived from the ward list when the invite is made, opened and redeemed. The user's point is that
an invite is often sent *because* a calling just changed, before LCR has caught up, so the roster's
answer is the stale one.

Already true after cr4 and its walk follow-up:
- The account is created on the invited email; the registrant cannot change it.
- "No, this isn't me" cancels the link and tells the sender (migration 107).
- One live link per person; reopening the window shows the waiting link.

## Desired Outcome
**Email decides who it is**
- Sending an invite requires an email. If that email is on the ward list, the person is matched
  automatically.
- If the email is **not** on the ward list, the sender is warned before anything is sent, and must
  link the invite to a ward list person by hand.
- That hand link creates a **to-do for the sender**: add this person's email in LCR.
- The next **roster paste** that carries that email confirms the link and closes the to-do. A paste
  carrying a *different* email for them flags it for review.

**The sender's calling wins**
- The invite lets the sender choose the calling, prefilled from the ward list.
- A chosen calling that differs from the ward list is stored as an **override** and is shown as such
  on Admin → Users, until a later paste agrees with it.

**Done looks like:**
1. A bishop invites the new Elders Quorum president. The ward list still says "Elders Quorum First
   Counselor". The bishop picks Elders Quorum President, and the account lands with that calling,
   marked as set on the invite.
2. A bishop invites someone whose email is not on the ward list. They are warned, link the invite to
   the right person, and get "Add ___'s email in LCR" on To Do.
3. After the next paste carries the email, the to-do closes itself and the warning is gone.

## Scope Notes
- **Reverses cr4's core rule** ("an invite names a person, never a role"). CLAUDE.md §7's cr4
  paragraph, `createInviteSchema` (`.strict()`, no role) and `deriveMemberCalling()` at redemption
  all change. The `super_admin` refusal must survive: the chosen calling comes from an allowlist, never
  `super_admin` and never `sacrament_manager`.
- **`ward_role_assignments.source = 'override'` is today the super admin's alone** (cr2). Either a
  sender's choice uses it too, or a new source value is needed. Planning decides.
- **The calling review (`buildCallingReview()`)** currently puts every override back on each review.
  A sender's override needs a rule for when the roster catches up.
- **A to-do for the sender** is another person's work arriving through a SOURCE, so it needs a link
  column and a single writer, like `todos.zoom_invitee_id` (z2c).
- **The roster paste** (`buildRosterDiff()`, cr3) gains an email reconcile step.

## Open Questions
- Should the sender's override expire if the next paste still disagrees, or stay until someone acts?
- Can an org president invite their own counselors with a chosen calling, or is this still the
  bishopric's alone?
