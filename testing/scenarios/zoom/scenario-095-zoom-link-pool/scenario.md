---
name: Zoom link pool, hand-out and invitees
scope: ITER-053
part: 2
tags: [zoom, full, permissions, mobile]
prerequisites: none
---

## Purpose

Proves the bishopric can hand out Zoom join links from a phone (a roster member or a typed name,
then Text it / Share / Show QR), that an empty pool saves the person as waiting, and that the clerk
and executive secretary see the list without any way to read a link. The RLS and route tests prove
the rules; this proves the screens say them at phone width. Seeding helps because it needs a
nearly empty pool, a given link, a moved-out member and six callings.

**Slices.** Built across z2a (pool), z2b (invitees and hand-out) and z2c (the waiting to-do). The
checks marked **(z2c)** cannot pass until z2c is built — skip them when walking z2b.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, no release list (Zoom is released) |
| Bishop | Mark Andersen — `bishop@` |
| 1st Counselor | Dana Whitmore — `counselor1@` |
| 2nd Counselor | Owen Pryce — `counselor2@` |
| Ward Clerk | Sarah Brooks — `clerk@` |
| Executive Secretary | Paul Nguyen — `execsec@` |
| Elders Quorum President | Miguel Cortez — `eqpresident@` |
| Members | Grace Holt (active), Thomas Reed (active, phone 555-201-7788), **Lena Ortiz (moved out)** |
| Link pool | Guest 01 — **given to Grace Holt by the bishop**; Guest 02 and Guest 03 — free. URLs `https://example.org/j/guest0N` |

Every address ends `@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- zoom/scenario-095-zoom-link-pool`
2. `npm run dev`, then open http://localhost:3000 at **375px wide**.
3. As the **1st counselor**: Zoom → **Invitees** → **Give a Zoom link**. Search the picker for
   "Ortiz", then pick **Thomas Reed** → **Give link**. Try **Text it**, **Share** (phone only) and
   **Show QR code**. Press **Done**.
4. **Give a Zoom link** again → **Not on the roster? Type their name** → "Lena Ortiz", phone
   `555 010 2020` → **Give link**. Read the sentence under the hand-off.
5. **Give a Zoom link** a third time → type "Sam Visitor" → **Give link**. Read the sentence. Open
   To Do **(z2c)**.
6. **Link pool** → **Paste links**: paste three lines, one with no email. Fix it, add. Read the
   result sentence.
7. **Invitees** → tap **Sam Visitor** under *Waiting for a link* → **Give a link**. Open To Do
   again **(z2c)**.
8. Tap **Lena Ortiz** → **Edit** → change the phone → **Save**. Then tap Grace Holt → **Show link**.
9. **Link pool**: remove a free link with ✕; look for ✕ on a given one.
10. Sign in as the **ward clerk**, then the **executive secretary**: open Zoom and read the tabs and
    the list.
11. Sign in as the **Elders Quorum president**: look for the Zoom tile, then open `/zoom` directly.

## Verification Checklist

### Machine-checkable

- [ ] Lena Ortiz does not appear in the picker; typing her name as a non-member works.
- [ ] Picking Thomas Reed fills his phone (555-201-7788).
- [ ] The hand-outs get the next free placeholder in order: Thomas → Guest 02, Lena → Guest 03.
- [ ] Text it shows Open in Messages on a phone (Copy plus an explanation on desktop), and the message contains `example.org/j/guest02`.
- [ ] Show QR code draws a code that scans to `https://example.org/j/guest02`.
- [ ] After the second hand-out the window and the banner above the tabs say no links are left.
- [ ] Sam Visitor is listed under *Waiting for a link*, and the window said "Sam Visitor is saved, but there are no free links."
- [ ] **(z2c)** A "Give Sam Visitor a Zoom link" to-do is on the 1st counselor's list, with no checkbox and no working delete.
- [ ] The paste preview names the bad line by number, and Add stays disabled until it is fixed.
- [ ] After pasting, the result says 1 person is waiting; Give a link on Sam's row gives the oldest new link.
- [ ] **(z2c)** The to-do closes with a timeline line.
- [ ] The edit wrote a `zoom_invitee_updated` audit row whose detail is `{ inviteeId, changedFields: ["phone"] }`, with no phone number in it.
- [ ] Show link on Grace Holt opens the hand-off for `example.org/j/guest01`.
- [ ] ✕ removes a free link; a given link has no ✕.
- [ ] The clerk and the executive secretary see **Remote control** and **Invitees** only, with names and placeholders and no buttons, and rows that are not tappable.
- [ ] The Elders Quorum president has no Zoom tile, and `/zoom` shows Not permitted.
- [ ] No page's HTML contains `example.org/j/` except inside an open hand-off window.
- [ ] No audit row contains `https://`, a phone number, an email or notes.
- [ ] No horizontal overflow at 375px; every button is at least 44×44.

### Needs a human eye

- [ ] The hand-out window is quick to do one-handed on a visit, and Give link is the obvious next press.
- [ ] Text it / Share / Show QR code read as three equal choices, and the QR is large enough to scan from across a table.
- [ ] The text message reads warmly and makes clear the link is just for them.
- [ ] The waiting sentence tells the leader plainly what happened and what comes next.
- [ ] The invitee rows are easy to scan, and the "Last watched — · Sundays watched —" line does not read as broken.
- [ ] Legible in light and dark.

## Failure Behavior

- A moved-out or another ward's member forced through the API answers 400 "Pick the person again —
  that roster record isn't available." and writes nothing.
- Give a link with an empty pool answers 409 "There are no free links. Paste more on the Link pool
  tab."; a second Give a link for the same person answers 409 "They already have a link."
- The clerk calling `POST /api/zoom/invitees`, `PATCH /api/zoom/invitees/[id]` or
  `GET /api/zoom/invitees/[id]/link` directly gets a 403.

## Walkthrough record

Not yet walked.
