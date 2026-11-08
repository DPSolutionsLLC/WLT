---
id: zoom-link-email-and-text
type: feature
iter: ITER-053
commits: []
date: 2026-11-07
files:
  - lib/zoom/joinLinkMessage.ts
  - lib/zoom/joinLinkEmail.ts
  - app/api/zoom/invitees/[id]/email/route.ts
  - app/(app)/zoom/LinkHandoff.tsx
  - app/(app)/zoom/HandOutModal.tsx
  - app/(app)/zoom/InviteesPanel.tsx
related: [zoom-link-pool-and-invitees, zoom-self-registration]
---

## What was done
A cleaner Zoom link hand-out. **Text it** is now two texts when there is a number to open: a
greeting with no link, then the link alone, which most phones show as a preview card. **Share**
passes the link as `url` beside the greeting. A new **Email it** button
(`POST /api/zoom/invitees/[id]/email`) emails the invitee an HTML message whose "Watch sacrament
meeting" button carries the link, with a plain-text copy holding it in full. No migration.

## Key decisions
- **No short link.** The user asked for a hidden link; SMS is plain text and cannot hide one, and an
  app-owned redirect would break when the app is down and would have to move with the domain. Every
  message points straight at zoom.us.
- **The browser sends only the invitee id** to Email it; the server reads the link with the service
  role. The link never reaches the response, an audit row or a log line, and the address is never
  logged.
- **Not set up is said, not hidden:** with `RESEND_FROM_ADDRESS` unset the route answers 409 with a
  sentence and the button shows it. A Resend refusal is a 502 and writes no audit row.
- **No phone on file keeps one combined message** for Copy, link last on its own line, rather than
  two steps with nothing to open.
- The name, ward name and URL are HTML-escaped in the email.

## Before this slice
The user asked to start the pool fresh. Migration 100 had already converted every stored link to
`/j/` and `normalizeZoomJoinUrl()` converts each paste, so no code was needed for that. A one-time
service-role cleanup deleted Buffalo Ward's 2 invitees and 2 pool links (no sign-ups, no linked
to-dos) and wrote a `zoom.reset` audit row.

## Not verified yet
- Real-device preview cards for a link-only text and for Share with `url`.
- Whether `RESEND_FROM_ADDRESS` is set in Vercel; it is absent from `.env.local`, so Email it says
  "isn't set up" locally.
