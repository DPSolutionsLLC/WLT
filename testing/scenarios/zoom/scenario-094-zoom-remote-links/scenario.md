---
name: Zoom remote links — each leader's own stream remote
scope: ITER-051
part: 1
tags: [zoom, smoke, permissions]
prerequisites: none
---

## Purpose

Proves each leader sees only their own Remote control button, the bishopric manages the five
links without ever seeing one, and a calling change turns a link off. The RLS and route tests
prove the rules; this proves the screens say them. Seeding helps because the state needs five
callings, links bound to specific callings, a released former counselor and a vacant position.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, no release list (Zoom is released) |
| Bishop | Mark Andersen — `bishop@` — link **live** (`https://example.org/?remote=bishop`) |
| 1st Counselor | Dana Whitmore — `counselor1@` — link **live** (`…?remote=counselor_1`) |
| 2nd Counselor | Owen Pryce — `counselor2@` — **needs a new link** (the last one was for Ruth Hallam, whose calling was released) |
| Ward Clerk | Sarah Brooks — `clerk@` — **no link** |
| Executive Secretary | **vacant** |
| Elders Quorum President | Miguel Cortez — `eqpresident@` |

Every address ends `@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- zoom/scenario-094-zoom-remote-links`
2. `npm run dev`, then open http://localhost:3000
3. As the **bishop**: open the **Zoom** tile. Press **Remote control** — a new tab opens on
   `example.org/?remote=bishop`.
4. Open the **Remote links** tab and read the five rows.
5. On **1st Counselor**, press **Replace link**, paste `https://example.org/?remote=new-first`,
   Save. On **Bishop**, press **Turn off** and confirm. On **Executive Secretary**, look for a
   Paste button.
6. Try pasting `http://example.org/x` on **Ward Clerk**.
7. Sign in as the **1st counselor**: Zoom → Remote control opens `?remote=new-first`.
8. Sign in as the **ward clerk**: open Zoom.
9. As the **bishop**, swap the counselors: Dana Whitmore to 2nd, Owen Pryce to 1st. **No screen
   can change a counselor's number** (Admin → Users shows it as text only), so send it through the
   real route from the browser console, signed in as the bishop:
   `fetch('/api/admin/users/<id>', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ counselorPosition: 2 }) })`
   for Dana, then `1` for Owen. Reopen Zoom → Remote links. Then sign in as each counselor and
   open Zoom.
10. Sign in as the **Elders Quorum president**: look for a Zoom tile.

## Verification Checklist

### Machine-checkable

- [ ] Remote control opens the reader's own link in a new tab, and the Zoom page's HTML contains no `example.org` text.
- [ ] Remote links lists Bishop, 1st Counselor, 2nd Counselor, Ward Clerk, Executive Secretary, in that order, each with the holder's name and email.
- [ ] Executive Secretary reads "No one called" and has no Paste button.
- [ ] 2nd Counselor reads "Needs a new link — the last one was for Ruth Hallam."
- [ ] The Paste/Replace window opens with an empty field.
- [ ] An `http://` link is refused with "Paste the full link, starting with https://."
- [ ] After Turn off, the bishop's Remote control tab says "No remote link set — ask the bishopric."
- [ ] The ward clerk sees no tab bar, and the remote area says "No remote link set — ask the bishopric."
- [ ] After the counselor swap, both counselor rows read "Needs a new link", and each counselor's remote area says "No remote link set — ask the bishopric."
- [ ] Each change wrote a `zoom_remote_link_set`, `zoom_remote_link_replaced` or `zoom_remote_link_turned_off` audit row carrying the position and no link text.
- [ ] The Elders Quorum president has no Zoom tile, and `/zoom` shows Not permitted.
- [ ] No horizontal overflow at 375px; every button is at least 44×44.

### Needs a human eye

- [ ] The Remote control button reads as the one obvious thing to press on the page.
- [ ] Each row's status line says plainly what state the link is in and what to do next.
- [ ] The Turn off confirmation makes it clear the leader loses access straight away.
- [ ] The page is legible one-handed at 375px, in light and dark.

## Failure Behavior

- Pasting for a vacant position is not offered; if forced through the API, it answers 409 "No one
  holds this calling, so there is nobody to give a link to."
- A second person holding the same calling makes the row read "More than one person holds this
  calling." with no Paste button.
- Pressing Remote control after the link was turned off in another tab returns to Zoom with "That
  link is no longer set. Ask the bishopric for a new one."
- The ward clerk calling PUT /api/zoom/remote-links/bishop directly gets a 403.

## Walkthrough record

**2026-10-28 (evening of 27 Oct, ward time) — driven by Claude in Playwright at 375×812, read back
with the service-role client. The user reviewed the five judgement items from screenshots and
accepted all of them (button prominence, status lines, UTC date stamps kept, third-person turn-off
wording kept, the clerk's single sentence, dark mode).**

Observed:
- Seeded rows: bishop and counselor_1 live, counselor_2 `holder_changed` bound to Ruth Hallam's
  released calling, no ward_clerk row, executive secretary vacant.
- Bishop's Remote control: `GET /api/zoom/remote-control 303`, new tab at
  `https://example.org/?remote=bishop`. Neither the live DOM nor a fresh fetch of `/zoom` contained
  `example.org`. Button 310×56, `target=_blank`, `rel="noopener noreferrer"`.
- Remote links rows, in order: Bishop (Live) · 1st Counselor (Live) · 2nd Counselor (Needs a new
  link — the last one was for Ruth Hallam.) · Ward Clerk (No link set.) · Executive Secretary (No
  one called / Nobody to give a link to., no buttons). Status stamps read "28 Oct 2026" — UTC, by
  rule 12, though it was still 27 Oct in the ward's zone.
- Replace on 1st Counselor: window opened with an empty `type=url` field; saved; DB
  `url=https://example.org/?remote=new-first`; audit `zoom_remote_link_replaced` with position and
  ids only.
- Turn off on Bishop: confirm read "Turn off Mark Andersen's remote link? They lose access
  straight away."; DB `url=null, reason=turned_off`; audit `zoom_remote_link_turned_off`. The
  bishop's own Remote control tab then read "No remote link set — ask the bishopric." with no
  reload.
- `http://example.org/x` on Ward Clerk: 400, "Paste the full link, starting with https://."; no row
  written.
- 1st counselor (Dana): Remote control opened `?remote=new-first`.
- Ward clerk: no tablist; "No remote link set — ask the bishopric."; `PUT
  /api/zoom/remote-links/bishop` from the clerk's session → 403.
- Counselor swap through `PATCH /api/admin/users/[id]`: both 200. DB counselor_1 →
  `url=null, reason=holder_changed`; audit `zoom_remote_link_turned_off`
  `{reason: holder_changed, position: counselor_1}`. Both counselor rows read "Needs a new link"
  (1st: "…was for Dana Whitmore."; 2nd: "…was for Ruth Hallam."). Dana and Owen each saw "No
  remote link set — ask the bishopric."
- Org president: no Zoom tile; `/zoom` shows Not permitted.
- No audit row contained any part of a link. No horizontal overflow; no tap target under 44px; no
  raw uuid on screen. The tab reopened as last left (Remote control).

Corrections: step 9 rewritten — Admin → Users cannot change a counselor's number (pre-existing
gap; the route accepts it, no control sends it).

Not covered: dark mode was checked on the bishop's Remote links tab only; the clerk's "dark"
screenshot rendered light because the account's saved theme wins over the device setting.
