---
name: Zoom sign-ups — the public page and auto-approve
scope: ITER-052
part: 1
tags: [zoom, full, public, privacy]
prerequisites: none
---

## Purpose

Proves a member of the public can scan a QR code, ask for a stream link on a phone, and land on
their own status page — with the link at once when auto-approve is on — and that the bishopric's
Sign-ups tab shows the requests, settings and questions. The public form, the status page and
auto-approve only mean anything signed out at phone width; seeding a ward with sign-ups open, a
part-filled pool and four existing requests makes every state reachable in minutes.

**Slice.** Built in z3a. Approve / Let's talk first / Not this time / Match arrive in z3b (scenario
098) and emails in z3c, so the cards have no buttons yet.

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
| Sign-up page | `/public/zoom-harness097signup` — **open**, **approve automatically**, email switch on |
| Questions | 1. "Would you welcome a visit from the missionaries?" (yes/no, non-members) with its **follow-up** "What's your address?" (short answer, must answer, only after Yes); 2. "How did you hear about us?" (short answer, everyone); 3. "Would you like a printed programme posted to you?" (**turned off**) |
| Link pool | Guest 01 — given to Riley Approved; Guest 02, Guest 03 — free |
| Sign-ups | **Riley Approved** (approved, Guest 01, said Yes to the missionaries and gave "48 Orchard Lane") · **Riley Again** (waiting, same phone as Riley) · **Dana Declined** (declined, private note) · **Kim Referred** (waiting, held for the daily limit, referred by Riley) |

Status pages of the seeded people (the seed also prints these):

| Person | Status page |
|---|---|
| Riley Approved | `/public/zoom-harness097signup/status/TVkn0BQ4r5Jq4dRdvdpFLEG7d8BgTYQMkBlNL6J-KJQ` |
| Riley Again | `/public/zoom-harness097signup/status/Y2kuRf5FYuF1IghsLTmnOxSiyPW9CRSvMF5qUzVJ9qw` |
| Dana Declined | `/public/zoom-harness097signup/status/7L0tgVbqM93TVL2kCMdJ7kCimxWjfOkhnDM1ZCxd0YY` |
| Kim Referred | `/public/zoom-harness097signup/status/dUL0ZMojruiCNk0RRRO6WYP20E-9muW6YUfdyoubaKM` |

Every address ends `@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- zoom/scenario-097-zoom-self-registration`
2. `npm run dev`. In a **private window** (signed out — check `document.cookie` is empty), open
   http://localhost:3000/public/zoom-harness097signup at **375px wide**.
3. Read the form. Press **No** for the member question, then **Yes**, and watch the questions change.
   Fill it in as a non-member (name "Taylor Newcomer", any new phone). Press **Yes** to the
   missionaries, then **Ask for a link** without an address; then give an address and send.
   (Morgan Friend and Casey Third in steps 4–5 answer **No** to the missionaries.)
4. On the status page: try **Copy link**, then **Share with a friend**. Open the shared link (it ends
   `?ref=…`) and sign up as "Morgan Friend" with another new phone.
5. Sign up a third time ("Casey Third", another new phone) — the pool is now empty.
6. Sign up again with Taylor Newcomer's phone.
7. Open Riley Approved's, Dana Declined's and Kim Referred's status pages from the table above.
8. Sign in as the **1st counselor**: Zoom → **Sign-ups**. Read the cards. Open **Settings** — copy the
   link, download the QR. (Locally the link and QR show only when `NEXT_PUBLIC_SITE_URL` is set in
   `.env.local`, e.g. `http://localhost:3000`; without it Settings says the site's web address isn't
   set up yet. On the deployed site Vercel supplies the address.) Open **Questions** — edit one, move one, turn one off and on.
9. In Settings, switch **Sign-up page open** off. Reload the public page in the private window.
   Switch it back on.
10. Open To Do as the bishop, then as each counselor.
11. Sign in as the **ward clerk**, then the **executive secretary**, then the **Elders Quorum
    president**, and open Zoom.

## Verification Checklist

### Machine-checkable

- [ ] The form shows the ward name, the missionary question only after **No**, "How did you hear about us?" for both answers, never the turned-off question, and no other ward data.
- [ ] "What's your address?" appears, set in under the missionary question, only after **Yes** to it, and disappears again on **No**.
- [ ] Sending with Yes and no address shows "Please answer: What's your address?" and writes nothing.
- [ ] Taylor Newcomer's stored answers hold the address after the missionary answer; a sign-up that said No has no address stored, even if one was typed before switching to No.
- [ ] Taylor Newcomer lands on a status page with **Join the stream** (Guest 02) and the "just for you" line.
- [ ] Share with a friend shares the sign-up page with `?ref=`, never the status or join URL.
- [ ] Morgan Friend gets Guest 03; their card reads "Referred by Taylor Newcomer".
- [ ] Casey Third's status page says "Your link is on its way", and the bishop and both counselors each have "Give Casey Third a Zoom link".
- [ ] The repeat of Taylor's phone is held (Waiting), not approved, and its card reads "Same phone as an earlier request".
- [ ] Taylor Newcomer's own card (the earlier request) and Riley Approved's card do **not** read "Same phone as an earlier request" — only the later request carries it.
- [ ] Riley Approved's page shows Guest 01's link; Dana Declined's shows only "We weren't able to give you a stream link right now. Please speak with the bishop." — no note, no share button; Kim Referred's says the request is with the bishopric.
- [ ] A wrong token on a status page (change one character) shows Page not found.
- [ ] The tab reads "Sign-ups · N" with N the waiting count; Waiting is oldest first, Recent newest first, grouped by day with alternating shading.
- [ ] Riley Approved's card shows all three answers, the address included; Kim Referred's shows "Held: lots of sign-ups today" and "Referred by Riley Approved".
- [ ] Switching the page off shows "Sign-ups are closed" on the public page within a reload; switching it on brings the form back.
- [ ] In Questions, the address sits indented under the missionary question, reads "Only after Yes above", and has no ↑ ↓ of its own. Turning the missionary question off marks it "Not asked while its question is off", and the public form shows neither.
- [ ] Settings and Questions changes wrote `zoom_registration_settings_changed` / `zoom_registration_question_changed` audit rows naming fields only.
- [ ] The clerk and the executive secretary see the Sign-ups tab with a **Questions** button and no **Settings** button; the Elders Quorum president has no Zoom tile.
- [ ] No `zoom_registration_submitted` audit row has a `user_id`, a name, a phone, an email, an answer or a token.
- [ ] The status page's HTML has `<meta name="referrer" content="no-referrer">`.
- [ ] 375px: no horizontal scroll on the form, the status page or the Sign-ups tab; every button at least 44×44.

### Needs a human eye

- [ ] The form reads as friendly and trustworthy to somebody who is not a member, and says plainly what the details are for.
- [ ] The status page makes the Join button the obvious thing, and the "just for you" line is clear without being alarming.
- [ ] The declined page is kind and neutral.
- [ ] The sign-up cards are easy to scan; the flags stand out without shouting.
- [ ] The QR prints and scans from a printed programme.
- [ ] Legible in light and dark.

## Failure Behavior

- Over 40 sign-ups in 24 hours: the form shows "Lots of people are signing up right now. Please try
  again tomorrow." (429) and nothing is written.
- A closed page, an inactive slug and an unknown slug all answer the API with the same 404 "This
  sign-up page isn't available."
- A missing required answer answers 400 "Please answer: <the question>".
- A filled hidden field answers like a success and writes nothing.
- The clerk calling `PUT /api/zoom/registration-settings` directly gets a 403.

## Walkthrough record

### 2026-10-30 — driven by Claude (Playwright), screenshots for human review

Agent-driven walk against the local dev server on port 3000 and the hosted database. Every write was
read back with the service-role client. Screenshots are in `testing/walk-screenshots/097/` (excluded
from git). The human-eye questions went to the user as a review page; their answers are **not yet
recorded here**.

**Observed values**

- Public form, signed out (`document.cookie` empty), 375px: page overflow 0; no control under 44px.
  The missionary question appears only after **No**; "How did you hear about us?" shows for both; the
  turned-off question never shows. The only ward data on the page is its name.
- Taylor Newcomer (non-member, both answers): `approved`, invitee `source = self_registration`,
  `link_given_at` set, Guest 02 (`https://example.org/j/guest02`). Both answers stored as snapshots
  with their prompts. Copy link put that URL on the clipboard and the button read "Link copied".
  Share passed `http://localhost:3000/public/zoom-harness097signup?ref=v4ytLU33jY`.
  The status page carries `<meta name="referrer" content="no-referrer">`.
- Morgan Friend via the `?ref=` link: `approved`, Guest 03, `referred_by_registration_id` = Taylor's
  request; card reads "Referred by Taylor Newcomer".
- Casey Third with the pool empty: `approved`, invitee with no link; page reads "Your link is on its
  way — check back here." Three to-dos "Give Casey Third a Zoom link" (Mark Andersen, Dana Whitmore,
  Owen Pryce), each seen on that person's To Do page.
- Repeat of Taylor's phone (entered as "Taylor Again"): `pending`, `held_reason = same_phone`.
- Riley Approved's page shows Guest 01; Dana Declined's shows only the neutral sentence, no share
  button; Kim Referred's says the request is with the bishopric. One character changed in Riley's
  token → HTTP 404 "Page not found".
- Sign-ups tab (1st counselor): "Sign-ups · 3". Waiting: Riley Again, Kim Referred (29 Oct), Taylor
  Again (30 Oct, shaded). Recent: Casey, Morgan, Taylor (30 Oct), Dana, Riley (28 Oct, shaded). Kim:
  "Referred by Riley Approved", "Held: lots of sign-ups today". No raw ids on screen.
- Settings: page off → public page "Sign-ups are closed"; API 404 "This sign-up page isn't
  available." (the same for `zoom-doesnotexist00`); back on → form returns. Audit rows
  `zoom_registration_settings_changed` with `changedFields: ["isOpen"]` only.
- Questions: edit prompt, move up, turn off, turn on — four `zoom_registration_question_changed` rows
  naming `prompt`, `position`, `isActive`; never the text. Saves take ~4 s against the hosted DB.
- `zoom_registration_submitted`: 4 rows, all `user_id` null; detail holds `registrationId`, booleans,
  `heldReason` and to-do ids only.
- Clerk and executive secretary: tabs Remote control / Invitees / Sign-ups · 3, only **Questions**;
  `PUT /api/zoom/registration-settings` → 403. Elders Quorum president: no Zoom tile; `/zoom` →
  "Not permitted".
- Honeypot (`website` filled): 201 `{"statusUrl":null}`; 0 rows written, audit count unchanged.

**Defect found — not fixed**

- **"Same phone as an earlier request" also marks the EARLIER request.** Taylor Newcomer's and Riley
  Approved's cards carry it. `describeRegistrationFlags()` compares with every other request on that
  phone rather than only earlier ones; "Declined before" has the same flaw. Plan D2/P7 put the mark
  on the newer request only.

**Checklist corrections**

- Added a check that the earlier request does **not** carry the same-phone flag. The original line
  passed while the defect was on screen, because it only looked at the later card.
- Step 8 now says the Settings link and QR need `NEXT_PUBLIC_SITE_URL` locally.

**Not walked**

- Copy link / Download QR in Settings — no site address configured on this machine.
- The QR printing and scanning from a programme — needs a printer and a phone.
- Human-eye items — sent to the user as questions, answers pending.

**Noticed, not in the checklist:** a wrong-token page's browser tab reads "Your stream link"; at
375px the Zoom tab row scrolls inside itself and "Link pool" is cut off for the bishopric.

### 2026-10-30 — the user's review, and what it changed

The user reviewed the four screenshot questions. The form, status page, declined page and sign-up
cards were accepted. **One change asked for:** after Yes to the missionaries, ask for an address —
"we don't need it unless they want to meet with the missionaries". Built as a **follow-up question**
(migration 097), required while shown. The same-phone defect above was fixed in the same round.

Re-checked by Claude in the browser after re-seeding:

- The address box appears only after Yes to the missionaries. Sending without it shows "Please
  answer: What's your address?" and writes nothing. Sending with "9 Birch Road, Buffalo" stored one
  row (Addie Address), answers in order: missionaries Yes, then the address.
- Riley Approved no longer reads "Same phone as an earlier request"; Riley Again still does.
- In Questions the address sits indented under the missionary question with no ↑ ↓, and editing it
  offers "Ask it: Always / Only after Yes to: …".
- **Found and fixed on the way:** at 375px the Questions window squeezed each question's text to
  one word per line beside its four buttons. The text now keeps a minimum width and the buttons
  wrap beneath it. (The first walk checked only for sideways page scroll, which this did not cause.)

The address checks added to this checklist have not been walked end to end by a person yet.

2026-10-31 — the user confirmed "tests pass" after reviewing the walk and the address follow-up.
