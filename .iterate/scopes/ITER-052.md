# ITER-052: Public Zoom self-registration with bishopric approval

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-10-27
**Group:** GROUP-05 — Zoom stream: remote controls and invitees

## Summary
A public page, reached from a QR code in the sacrament program, where anyone can register to
watch the stream. They answer a short questionnaire and — once approved, automatically or by the
bishopric — receive a personal Zoom join link taken from the pre-registered link pool.

## Context
Raised 2026-10-27 by the user. The ward wants people (members, friends, people a member shared
it with) to be able to get a stream link without a bishopric member present, and without
registering twice (once in the app, once in Zoom). There is **no Zoom API access**, so Zoom
itself cannot be registered from the app.

The answer chosen in discovery: **the same placeholder link pool** the bishopric uses on visits
(see the link-pool item in GROUP-05 — this item depends on it). Generic registrants ("Guest 01",
"Guest 02", … with plus-addressed emails on a ward-controlled Gmail) are registered in Zoom in
bulk ahead of time and their join links stored in the app. A self-registration takes the next
free link. The person only ever fills in the app's form.

When API access arrives, this page registers the person in Zoom directly instead of drawing from
the pool; to the person it should look the same.

## Desired Outcome

**The public page**
- Unauthenticated, reached from a QR code printable in the program.
- Form: **name**, **phone**, **email (optional)**.
- **"Are you already a member of Buffalo Ward?"**
  - **Yes** → a task for the bishopric to match them to the right roster record. The registrant
    never picks their own name from a list; a bishopric member confirms the match.
  - **No** → follow-up questions, e.g. "Would you welcome a visit from the missionaries?"
- **Custom questions** beyond the fixed ones, added / edited / removed in the Zoom module
  without code changes (the ward council will shape these over time). Kept brief.
- A **"share with a friend"** button that shares the *registration page* (never the person's own
  link), tagged with who shared it, so **referred by** is recorded automatically.
- Once approved, the person sees their link with copy, "add to home screen", and (if they gave an
  email) an email of it. No automatic SMS — the app cannot send texts.

**Approval settings** (in the Zoom module)
- **Auto-approve ON** → link handed out immediately. A second switch: **email the bishopric about
  each new registration** (on/off).
- **Auto-approve OFF** → request sits as **Pending**; the bishopric is emailed and sees it in the
  app. Link is handed out only once approved.
  - Requires approval from **every occupied** primary-bishopric position (Bishop, 1st Counselor,
    2nd Counselor). A vacant position is simply not counted.
  - Not approving yet = holding. Any of the three can press **"Let's talk first"**, marking that
    they've seen it and want to discuss — so the other two know it is not being ignored. Visible
    to the other two.
  - Denial path needed (wording for planning).

**Who can do what**

| | Approve / flag / approval settings | Edit questions | Everything else in Zoom |
|---|---|---|---|
| Bishop, 1st & 2nd Counselor | ✓ | ✓ | Full |
| Ward clerk, executive secretary | — | ✓ | Read-only |

## Scope Notes
- Depends on the **link pool** (GROUP-05 item still to be shelved). Plan that first.
- The public page draws from a finite pool, so: low-pool warning to the bishopric; a way to
  switch the page off; behaviour when the pool is **empty** (registration still recorded as
  waiting for a link?).
- Inside Zoom every pool user appears under the placeholder name ("Guest 07"); the host won't see
  real names. Accepted as a known consequence of the no-API approach.
- This is the **first collection of non-member personal data** through a public form. Every field
  is a privacy decision (CLAUDE.md §9 "Public pages leak surface"); the page should say what the
  information is used for. Unauthenticated, so it needs abuse protection (rate limits etc.).
- No AI involvement; nothing sent without a human or the ward's own setting choosing it.
- Bishopric admin equality (§7): all three approvers are equal; no bishop-only power.
- The prototype's Zoom module (`plans/prototype/module-map.md`, build notes `zoom`,
  `zoom-referral-requests`) has an opt-out link and a missionary-referral flow that overlap the
  "missionary visit?" question — reconcile during planning.
- Out of scope: pausing/blocking a link (deferred pending a Zoom test), the Zoom API, app-wide
  email on/off (deferred, separate).

## Open Questions
- Does "Let's talk first" notify the other two, or only show on the request?
- What happens to a denied registrant — told anything? Can they re-apply?
- Who receives the member-match task — any primary-bishopric member, or a specific one?
- Does a self-registered person who gave a real email get a pool link anyway, or (pre-API) is
  that the moment to register them in Zoom by hand with their real details instead?
- Where the referral `?ref=` identifies a sharer who is themselves only an invitee (not an app
  user) — fine, but confirm that's the intent.
