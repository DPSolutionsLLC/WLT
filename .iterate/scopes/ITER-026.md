# ITER-026: A Leader's Own Page — What I Committed To, What I Owe

**Type:** Feature
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29: *"we should also make sure to have a user summary page that
shows an easy overview of things like what they have committed to and easily see what they need to
follow up on"*
**Related:** ITER-020 (the two base views), `app/(app)/youth/FollowUpPanel.tsx`

## Summary

Every youth screen is organised around the **youth** or the **event**. Nothing is organised around
**the leader looking at it**: there is no one place answering *what have I said I would go to, and
what have I not yet written up?*

## What already exists, and how far it gets

`FollowUpPanel` on `/youth` is **half of this page already** — it lists past events the reader was
down for and has written nothing about, names them rather than counting them, and (since ITER-021)
counts only what that reader can actually act on.

What it does not do:

- **Nothing about the future.** It lists only what has been played. A leader cannot see what they
  have committed to and is coming up, which is the half that changes behaviour.
- **It lives inside `/youth`,** below the activity list, so it is found only by somebody already on
  that page. ITER-022 item 3 raised its position and was deliberately parked pending ITER-020.
- **It is one ward's youth module only.** A leader's commitments across visits and activities are
  the same person's week; whether this page is youth-only or genuinely personal is open.

## Shape

A page that answers, in order:

1. **Coming up, that I said I would attend** — with the young person named, because the commitment
   was to them, not to a fixture.
2. **Waiting on my follow-up** — the existing panel, moved rather than rebuilt.
3. Possibly: **what I have written recently**, so a leader can find and amend their own account.

## Open

- **Is this a youth-module page or a personal dashboard?** The same argument applies to visits, and
  `/dashboard` already exists and may be the right home. Deciding "youth-only" is easy to reverse;
  deciding "personal" and building it thinly is not.
- **Does it replace the panel on `/youth` or duplicate it?** Duplicating one list in two places is
  how a count and a list drift apart — the exact failure `describeHouseholdForVisits()` exists to
  prevent. If both render it, both must read one computation.
- **ITER-022 item 3 folds into this.** That scope should be closed by this one rather than worked
  separately; it was parked precisely because the page might move.
