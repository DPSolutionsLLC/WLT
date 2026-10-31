---
name: Zoom sign-ups — bishopric approval and roster matching
scope: ITER-052
part: 2
tags: [zoom, full, approvals, todos]
prerequisites: none
---

## Purpose

Proves that with approvals on, a public sign-up waits until **every serving member of the
bishopric** approves; that "Let's talk first" and "Not this time" behave as decided (D1, D2); that a
released calling stops blocking a request; and that "I'm a member" puts a match to-do on all three
bishopric lists which the first match closes everywhere. These need several users' answers at once,
so the seed puts four requests in four different states.

**Slice.** Built in z3b. Emails arrive in z3c, so nothing is emailed yet.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, no release list (Zoom is released) |
| Bishop | Mark Andersen — `bishop@` |
| 1st Counselor | Dana Whitmore — `counselor1@` |
| 2nd Counselor | Owen Pryce — `counselor2@` |
| Ward Clerk | Sarah Brooks — `clerk@` |
| Roster | Sam Fielding and Samantha Fielding (active members) |
| Sign-up page | `/public/zoom-harness098signup` — **open**, **approvals on** |
| Link pool | Guest 01 — free (the only one) |
| Sign-ups (all waiting) | **Alex Turner** — approved by the bishop · **Jordan Blake** — approved by the bishop and the 2nd counselor; the 1st counselor wants to talk first · **Sam Fielding** — says "member", a "Match Sam Fielding to the roster" to-do on all three bishopric lists · **Casey Morrow** — nobody has answered |

The seed prints each person's status page (`/public/zoom-harness098signup/status/<token>`).

Every address ends `@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- zoom/scenario-098-zoom-registration-approvals`
2. `npm run dev`. Sign in as the **2nd counselor**: Zoom → **Sign-ups**. Read each card's approval line.
3. On **Alex Turner**, press **Approve**.
4. Sign in as the **1st counselor**. On Alex Turner, press **Approve**. Open Alex's status page in a
   private window (signed out).
5. On **Casey Morrow**, press **Not this time**, write a private note, and **Decline**. Open Casey's
   status page signed out.
6. On **Sam Fielding**, press **Match to roster**, pick Sam Fielding, **Match**. Open To Do as each of
   the three bishopric members.
7. Before step 6, as any counselor, open To Do and try to remove "Match Sam Fielding to the roster"
   (there is no checkbox to tick — the tick is checked by calling the route directly).
8. As the **bishop**, open Admin → Users and **Deactivate** Dana Whitmore (the 1st counselor, who
   wants to talk first on Jordan Blake). Back on Zoom → Sign-ups, press **Finish approval** on Jordan
   Blake. Reactivate Dana afterwards.
9. Sign in as the **ward clerk** and open Zoom → Sign-ups.

## Verification Checklist

### Machine-checkable

- [ ] Before step 3, as the 2nd counselor: Alex reads "Approved by Mark Andersen · Waiting on: Dana Whitmore, you"; Jordan reads "Approved by Mark Andersen, you · Wants to talk first: Dana Whitmore", with **Approve** shown pressed.
- [ ] After step 3, Alex reads "Waiting on: Dana Whitmore" and stays under Waiting.
- [ ] After step 4, Alex moves to Recent as "Approved · Guest 01"; Alex's status page shows **Join the stream**; the Link pool has no free links.
- [ ] Casey's status page shows only "We weren't able to give you a stream link right now. Please speak with the bishop." — no note.
- [ ] Casey's card reads Declined and, for the bishopric only, "Private note: …". The clerk's view of the same card has no note, and `decline_note` is refused to the clerk's own client (42501).
- [ ] The `zoom_registration_declined` audit row says `declinedWithMessage: true` and holds no note text.
- [ ] "Match Sam Fielding to the roster" has **no checkbox**; its ✕ → Remove? is refused with "This closes itself once they're matched on Zoom → Sign-ups." shown under the card; a direct `PATCH /api/todos/[id] { complete: true }` is refused (400) with the same sentence.
- [ ] After the match, the to-do is closed on all three lists with the timeline line "They were matched to the roster."; Sam's card reads "Matched to Sam Fielding"; the audit row holds ids and `previousMemberId: false`, no name.
- [ ] After the deactivation, Jordan's card offers **Finish approval** and explains it: "Dana Whitmore wanted to talk first and is no longer in the bishopric. Everyone serving now has approved."; pressing it approves Jordan. With the pool empty, Jordan reads "Approved · waiting for a link" and the bishop and 2nd counselor each have "Give Jordan Blake a Zoom link".
- [ ] The clerk sees every card, with no buttons at all.
- [ ] 375px: no horizontal scroll on the Sign-ups tab or either window; every button at least 44×44.

### Needs a human eye

- [ ] The approval line is easy to read at a glance: who has approved, who wants to talk first, who is still waited on.
- [ ] The "Not this time" window makes plain what the person will see and that the note is private.
- [ ] The buttons on a card do not crowd the details at phone width.
- [ ] Legible in light and dark.

## Failure Behavior

- Answering a sign-up somebody else already decided: 409 "This sign-up was already decided."
- The clerk calling `PATCH /api/zoom/registrations/[id]` or `POST …/match` directly: 403, nothing
  changes.
- Matching a moved-out member: 400 "Pick the person again — that roster record isn't available."
- Matching a declined sign-up: 409 "This sign-up was declined, so there is nobody to match."

## Walkthrough record

**2026-10-31 — driven by Claude (Playwright against `npm run dev`, every write read back with the
service role).** The human-eye items await the user's review of the screenshots in
`testing/walk-screenshots/098/`.

Observed:
- Before step 3, as Owen: Alex "Approved by Mark Andersen · Waiting on: Dana Whitmore, you"; Jordan
  "Approved by Mark Andersen, you · Wants to talk first: Dana Whitmore", Approve `aria-pressed=true`.
- Step 3: Alex "Approved by Mark Andersen, you · Waiting on: Dana Whitmore", still Waiting; audit
  `zoom_registration_responded {response: approve}`.
- Step 4: Alex in Recent as "Approved · Guest 01"; invitee holds Guest 01; audit
  `zoom_registration_approved {linkGiven: true, waitingTodoIds: []}`; banner "No Zoom links are
  left."; signed-out status page "You're all set, Alex Turner" with Join the stream.
- Step 5: `status=declined`, `decline_note` stored, `decided_by` = Dana; status page shows only the
  decline sentence and its HTML holds no note; audit `{declinedWithMessage: true, closedTodoIds: []}`
  with no note text; the clerk's own client gets 42501 on `decline_note`.
- Step 7: no checkbox; ✕ → Remove? answered 409 and showed the sentence under the card; a direct
  `PATCH {complete: true}` answered 400 with the same sentence.
- Step 6: "Matched to Sam Fielding"; all three to-dos closed at the same instant with "They were
  matched to the roster."; audit ids only, `previousMemberId: false`. Dana and the bishop have
  nothing open; Owen has it under Done.
- Step 8: after deactivating Dana, Jordan read "Approved by you, Owen Pryce" with Finish approval;
  pressing it approved Jordan with no link; "Give Jordan Blake a Zoom link" went to the bishop and
  Owen only; no responded audit row for finish. Dana reactivated.
- Step 9: the clerk sees all cards, the only button is Questions; PATCH and match answer 403 and
  nothing changed. Approving a decided sign-up 409; matching a declined one 409.
- 375px: overflow 0 on the tab and both windows; every control ≥ 44×44. Dark theme applied.

**Checklist correction:** step 7 asked to *tick* the match to-do, which has no checkbox. The step
and its check now say remove from the card, tick through the route.

**Not walked:** matching a moved-out member (400) — covered by `tests/routes/zoom-registration-match.test.ts`.

**User review, 2026-10-31:** the approval line, the decline window, phone width and dark mode were
judged good. The Finish approval card was judged **unexplained** — it read only "Approved by you,
Owen Pryce" beside the button. Fixed in the same slice: the card now adds "Dana Whitmore wanted to
talk first and is no longer in the bishopric. Everyone serving now has approved." (or "The bishopric
has changed since this came in. …" when the released member never answered). Re-walked on a fresh
seed as the bishop at 375px with Dana deactivated: the sentence renders, overflow 0
(`17-jordan-finish-explained-375.png`). Dana reactivated afterwards.
