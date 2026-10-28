# ITER-051: Zoom tile with each leader's stream remote-control button

**Type:** Feature
**Status:** Backlogged
**Plan:** plans/zoom-remote-links.md
**Created:** 2026-10-27
**Group:** GROUP-05 — Zoom stream: remote controls and invitees

## Summary
Add the Zoom tile. Its first screen opens with a **Remote control** button that launches the
leader's own stream remote-control link. Bishopric admins paste and replace those links in one
place in Admin, one per leadership position.

## Context
Raised 2026-10-27 by the user. The ward streams sacrament meeting on Zoom. The user has built a
**separate app** that lets leaders control the live stream (transitions etc.) from their phones;
each leader gets a **unique link** into it. Today those links would have to be emailed and kept
on each phone. Storing them here puts the remote two or three taps from the dashboard.

The remote-control app itself is **out of scope** — this only stores and opens the link.

This is the first slice of the Zoom module. P10 (`plans/P10-message-and-zoom.md`) and
`plans/prototype/module-map.md` (Zoom row, verdict CONFLICT) describe a different, infra-heavy
Zoom design; this item does not depend on any of that infrastructure. The module-map row must
be updated before planning (CLAUDE.md §12).

## Desired Outcome
- A **Zoom** dashboard tile exists (new module; released-modules catalog entry needed).
- At the top of the Zoom page, a **Remote control** button. Pressing it opens the user's stored
  link. The link itself is **not displayed** on the page.
- The button belongs to five positions:
  **Bishop, 1st Counselor, 2nd Counselor, Ward Clerk (`ward_secretary`), Executive Secretary.**
  Each person sees **only their own** button and can never read another position's link.
- If a position has no active link, the button says so plainly (e.g. "No remote link set —
  ask the bishopric") rather than disappearing silently.
- **Admin screen** (somewhere in the Admin area; placement for planning): the five positions are
  pre-listed. Each row shows who currently holds that calling (from the ward's callings), their
  email, and a field to paste the link. Pasting a new link replaces the old one.
- **Who can edit:** the bishop and both counselors — ordinary bishopric admin authority, not
  super admin (§7: bishopric admin authority is shared).
- **When the holder of a position changes, the stored link is deactivated automatically.** The
  new holder sees "no link set" until an admin pastes a fresh one. This is how a released
  leader's link stops being reachable from this app; the user plans to make the remote app
  issue a new link and retire the old one at the same time.

## Scope Notes
- A remote link is a capability: whoever holds it can control the stream. Treat it as private
  to its holder plus the editing admins — enforced by RLS, not by hiding it in the UI.
- "Holder changed" must be defined against the callings model (`ward_role_assignments`), which
  allows a person to hold callings in several wards. Bishop/counselor positions use
  `counselor_position`.
- Two positions may be vacant; a vacant position shows "no one called".
- Audit every link set/replace/deactivation; never write the link itself into the audit detail.
- Access to the rest of the Zoom module (invitees) is decided in the invitee items of GROUP-05:
  bishopric full, ward clerk + executive secretary read-only. The Remote control button is
  independent of that.
- Not built: emailing the link, showing the link text, anything about the remote app.

## Open Questions
- Where in Admin the screen lives (its own Admin card vs. part of an existing page).
- Should a counselor being re-numbered (1st ↔ 2nd) count as a holder change? (Likely yes —
  the link belongs to the position.)
- Should a deactivation notify the bishopric so they remember to paste a fresh link?
