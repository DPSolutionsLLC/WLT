# Plan: A cleaner Zoom link hand-out — "Email it" and the link in its own text

## Overview

When a bishopric member hands somebody their own Zoom join link (Zoom tab → Invitees, or the
hand-out window after "Give them a link"), the message carries Zoom's long `…/j/…?tk=…` address in
the middle of a sentence. The user wants a cleaner message.

- **Email** can hide the link behind words. A new **Email it** button sends the person an email
  from the app whose button reads **"Watch sacrament meeting"**, with their Zoom link behind it.
- **A text** cannot hide a link (SMS is plain text). **Text it** becomes two short texts: a
  greeting with no link, then the link **alone**. A text holding nothing but a link shows as a
  tidy preview card on iPhones and most Android phones.

The links point straight at zoom.us, so **the custom domain change does not touch this**. The only
thing that changes then is the email's sender, which comes from `RESEND_FROM_ADDRESS` like every
other app email.

**No migration. No new table. No change to who can do what.**

### Decisions (settled with the user 2026-11-07)

| # | Decision |
|---|---|
| D1 | No short link, no app-owned redirect. Every message points straight at Zoom. |
| D2 | Email hides the link behind words; text sends the link on its own. |
| D3 | The email is sent by the app (Resend), never by the leader's mail app. |

### Planning decisions made here

| # | Decision |
|---|---|
| P1 | **Text it shows two steps**, each with its own `SmsHandoff` (open-in-Messages + Copy): "1. The greeting" and "2. The link". An `sms:` link can hold one message, so two taps is the honest shape. |
| P2 | **Share** passes `{ text: greeting, url: joinUrl }`, so a share into Messages gets the preview card in one go. Phones that ignore `url` still get the greeting; the fallback is Text it. Checked on real devices (Testing). |
| P3 | **Email it is a route**, `POST /api/zoom/invitees/[id]/email`, behind `canManageInvitees()`, the same guard as `GET …/link`. The URL is read with the service role there, and **never** sent from the browser to the server. |
| P4 | **The address is the invitee's stored `email`.** No email on file → the button is off with "No email address on file. Add one with Edit." No typing an address into the hand-out window, because that would be a second way to change an invitee. |
| P5 | **Not configured is said, not hidden**: `emailConfiguration()` is asked first; if email is not set up the route answers 409 with a sentence and nothing is sent (the programme's pattern). |
| P6 | The email is **HTML plus a plain-text copy** (Resend `html` + `text`). The text copy carries the full link, because some mail apps show only plain text. The name and ward name are **HTML-escaped**. |
| P7 | The email ends with **"Replies to this email aren't read. Text a member of the bishopric with any questions."**, because the sender is a no-reply address. |
| P8 | **Audit**: `zoom_invitee_link_emailed` (the module's existing underscore style) with `{ inviteeId }` only, never the URL and never the address. No new column records the send; pressing again sends again, deliberately (a lost email is re-sent this way). The button is disabled while a send is in flight, so a double tap is one email. |
| P9 | The **registrant's status page** (`/public/[slug]/status/[token]`) is unchanged. It shows the link with a Copy button already, which is fine there. |

## Relevant Files

- `lib/zoom/joinLinkMessage.ts`: **modify.** Add `buildJoinLinkGreeting()` (no URL in it) and
  `buildJoinLinkEmail()` → `{ subject, html, text }`. Keep `buildJoinLinkMessage()` for Copy.
- `lib/zoom/joinLinkEmail.ts`: **create.** Server-only sender over `lib/email/resend.ts`, the
  `musicEmails.ts` shape: returns `sent | not_configured | failed`, never throws a vendor refusal,
  never logs the address.
- `app/api/zoom/invitees/[id]/email/route.ts`: **create.** Guard, read invitee + URL (service role),
  refuse with a sentence (no link yet 404, no email 409, not configured 409), send, audit.
- `app/(app)/zoom/LinkHandoff.tsx`: **modify.** Two-step Text it, Share with `url`, Email it button.
  New props `inviteeId`, `email` (null when none).
- `app/(app)/zoom/HandOutModal.tsx`, `app/(app)/zoom/InviteesPanel.tsx`: **modify.** Pass the two new
  props.
- Tests: `tests/lib/joinLinkMessage.test.ts` (extend), `tests/components/zoom/LinkHandoff.test.tsx`
  (extend), `tests/routes/zoom-invitee-email.test.ts` (create).
- Docs: `SPEC.md` (the route), `FEATURES.md` (Zoom hand-out), CLAUDE.md §9 ITER-053 entry (one
  sentence), retro.

## Known Pitfalls

- **The join link never enters an audit row, a log line or a response** (ITER-053, P2 there). The
  email route's response is `{ sent: true }` only.
- `writeAuditLog()` blanks detail keys containing "note" or "token"; the detail has neither.
- `select("*")` on `zoom_join_links` through a user's client is a 42501 (column grant). Read the URL
  with the existing `readJoinUrl()` and the service role, as `GET …/link` does.
- `lib/email/resend.ts` throws in a browser, so `joinLinkEmail.ts` must never be imported by a
  client component; the message builders stay import-free.
- Resend's test sender delivers only to the account owner; `emailConfiguration()` already treats it
  as "not configured".
- A sr-only label needs an explicit `{" "}` before it.

## Tasks

1. **Message builders**: `buildJoinLinkGreeting()` and `buildJoinLinkEmail()` with escaping, plus
   tests (the greeting has no URL; the email's HTML holds the link only inside `href`; a name like
   `<b>Ann</b>` is escaped; the text copy holds the full link).
2. **Sender** `lib/zoom/joinLinkEmail.ts`.
3. **Route** + route test: bishopric sends (Resend mocked at `lib/email/resend.ts`, every query real);
   ward clerk (can view, cannot manage) gets 403; no link → 404; no email → 409; not configured →
   409 and nothing sent; audit row holds `inviteeId` and no URL. Each refusal's fixture passes every
   earlier check, so it is refused for the reason under test.
4. **UI**: two-step Text it, Share with `url`, Email it (disabled while sending; "Emailed to
   them." on success; the route's sentence on failure). Component tests for both steps, the email
   button's three states, and that no step-1 text contains the URL.
5. **Callers** pass `inviteeId` and `email`.
6. Lint, typecheck, the Zoom test files, then the full suite; build; docs; retro.

## Testing (by hand, on real phones)

- iPhone and Android: Text it → step 1 opens Messages with the greeting; step 2 opens it with only
  the link, and the sent bubble shows a preview card.
- Share → Messages on both phones: does the preview card appear? If a phone drops the link, note it
  (Text it is the fallback).
- Email it to your own address: the button reads "Watch sacrament meeting" and opens Zoom; the
  long address appears nowhere in the body; Gmail's "show original" plain-text part carries it.
- An invitee with no email: the button is off and says why.
