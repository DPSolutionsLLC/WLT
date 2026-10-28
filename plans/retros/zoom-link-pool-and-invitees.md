---
id: zoom-link-pool-and-invitees
type: feature
iter: ITER-053
commits: ["5f092ff", "a35db26"]
date: 2026-10-28
files:
  - supabase/migrations/095_zoom_join_links_and_invitees.sql
  - lib/zoom/invitees.ts
  - lib/zoom/inviteeRow.ts
  - lib/zoom/joinLinkMessage.ts
  - lib/zoom/joinLinkQr.ts
  - lib/zoom/access.ts
  - lib/zoom/zoomView.ts
  - lib/validation/zoom.ts
  - app/api/zoom/invitees/route.ts
  - app/api/zoom/invitees/[id]/route.ts
  - app/api/zoom/invitees/[id]/link/route.ts
  - app/(app)/zoom/page.tsx
  - app/(app)/zoom/ZoomTabs.tsx
  - app/(app)/zoom/InviteesPanel.tsx
  - app/(app)/zoom/InviteeFields.tsx
  - app/(app)/zoom/HandOutModal.tsx
  - app/(app)/zoom/EditInviteeModal.tsx
  - app/(app)/zoom/LinkHandoff.tsx
  - components/assignments/SmsHandoff.tsx
related: [zoom-remote-links, sacrament-music-people, released-modules-per-ward]
---

## What was done
ITER-053 in two of three slices. **z2a (5f092ff)** added the Link pool: migration 095's
`zoom_join_links` and `zoom_invitees`, the paste-and-check flow, and the low-pool warning.
**z2b (this change)** added the Invitees tab. A bishopric member on a visit gives a person (a roster
member or a typed name) the next free link from a phone, then hands it over with **Text it**,
**Share** or **Show QR code**. A person can also be saved as waiting when the pool is empty, given
a link later, or edited. The ward clerk and executive secretary see the list without buttons.
**z2c** (the "Waiting for a link" to-do) is not built, so ITER-053 stays In Progress.

## Key decisions
- **The join URL leaves the server in exactly two places:** the POST that gives a link, and
  `GET|POST /api/zoom/invitees/[id]/link`, all behind `canManageInvitees()`. It is never written to
  an audit row, and `zoom_invitee_updated` names the changed FIELDS only (D3).
- **The tab follows the RLS reader set, not `zoom.view` alone.** `canViewInvitees()` requires a
  bishopric, ward clerk or executive secretary calling as well. Otherwise a ward that granted
  `zoom.view` to another role would show that role an empty list that looks broken.
- **The picker's interface stayed frozen.** `MemberPicker` returns only an id, so `InviteeFields`
  reads the name and phone from the same react-query cache entry the picker filled, using the same
  key.
- **`SmsHandoff` gained an optional `subject` prop** (defaults to "speaker"), so the no-phone
  sentence reads "this person" here. Every existing caller is unchanged.
- **A waiting row opens a window with Give a link**, rather than putting a button on the row. This
  keeps one row shape for both sections, matching the compact-list preference.

## What the build found
- **An audit row could go missing.** If `assign_next_zoom_link` failed after the invitee insert,
  the route returned a 500 without auditing the insert that did happen (rule 6).
  `ZoomLinkAssignError` now carries the new row's id, and the route audits it with `linkGiven:
  false` before answering. Caught by reviewing the route during the first suite run.
- **A typed index into the update patch did not type-check**
  (`patch[FIELD_COLUMNS[field]]`), so the patch is now built with one explicit line per field.
- **A Bash heredoc holding apostrophes failed to parse** and wrote nothing. Use Write/Edit for file
  content on this machine.

## Verification
Full suite 347 files / 5118 tests passed; the production build succeeded; lint has 0 errors, and
tsc plus the harness typecheck are clean. Scenario 095 seeds, but **the user skipped the walk**, so
its "needs a human eye" items (one-handed use, the message wording, QR size) are unconfirmed. Walk
it alongside z2c.
