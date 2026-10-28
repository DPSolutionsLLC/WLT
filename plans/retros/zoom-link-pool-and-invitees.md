---
id: zoom-link-pool-and-invitees
type: feature
iter: ITER-053
commits: ["5f092ff", "a35db26"]
date: 2026-10-28
files:
  - supabase/migrations/095_zoom_link_pool_and_invitees.sql
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
  - lib/todos/zoomLinks.ts
  - lib/todos/queries.ts
  - lib/todos/logLines.ts
  - app/api/todos/[id]/route.ts
  - app/(app)/todos/TodoCard.tsx
related: [zoom-remote-links, sacrament-music-people, released-modules-per-ward]
---

## What was done
ITER-053 in three slices. **z2a (5f092ff)** added the Link pool: migration 095's
`zoom_join_links` and `zoom_invitees`, the paste-and-check flow, and the low-pool warning.
**z2b (a35db26)** added the Invitees tab. A bishopric member on a visit gives a person (a roster
member or a typed name) the next free link from a phone, then hands it over with **Text it**,
**Share** or **Show QR code**. A person can also be saved as waiting when the pool is empty, given
a link later, or edited. The ward clerk and executive secretary see the list without buttons.
**z2c (this change)** added the *Waiting for a link* to-do (D1). A hand-out with an empty pool
puts "Give ___ a Zoom link" on that leader's To Do. Giving the person a link closes every open
copy, whoever holds it, with the timeline line "A Zoom link was given." Like a music to-do, it has
no checkbox and cannot be deleted while open.

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

- **z2c reuses existing values, so it needed no migration** (095c had already added
  `todos.zoom_invitee_id` and its one-open-per-owner index). The to-do closes with `completed_at`,
  a null `closed_reason` and a `source_completed` line. The tick and delete refusals sit beside
  the music ones in `lib/todos/queries.ts` (`ZOOM_TODO_TICK`, `open_zoom`), not in a second
  mechanism.
- **The invitee is audited even when its to-do fails.** A `ZoomLinkWriteError` after the invitee
  insert (or after the link is given) still writes the audit row, with `waitingTodoId: null` or
  `closedTodoIds: []`, and then answers 500. This is z2b's own finding about rule 6, applied again.

## What the build found
- **A `source_completed` line always read "Marked complete on the agenda"**, whatever its body
  held. So a Zoom to-do's timeline would have named an agenda that does not exist. The plan
  assumed the body would show; it did not. `describeLogEntry()` now shows the body when one is
  written; an agenda item's line writes none and reads as before.
- **An audit row could go missing.** If `assign_next_zoom_link` failed after the invitee insert,
  the route returned a 500 without auditing the insert that did happen (rule 6).
  `ZoomLinkAssignError` now carries the new row's id, and the route audits it with `linkGiven:
  false` before answering. Caught by reviewing the route during the first suite run.
- **A typed index into the update patch did not type-check**
  (`patch[FIELD_COLUMNS[field]]`), so the patch is now built with one explicit line per field.
- **A Bash heredoc holding apostrophes failed to parse** and wrote nothing. Use Write/Edit for file
  content on this machine.

## Verification
z2b: full suite 347 files / 5118 tests passed and the production build succeeded. Its walk was
skipped.

z2c: full suite 347 files / 5123 tests passed (5 new: four route tests in
`tests/routes/zoom-invitees.test.ts`, one log-line test). The production build succeeded, lint
has 0 errors, and tsc plus the harness typecheck are clean. Scenario 095 now covers all three
slices and has not been walked yet.
