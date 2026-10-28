---
id: zoom-remote-links
type: feature
iter: ITER-051
commits: []
date: 2026-10-27
files:
  - supabase/migrations/094_zoom_remote_links.sql
  - lib/zoom/remoteLinks.ts
  - lib/zoom/remoteLinkPositions.ts
  - lib/zoom/remoteLinkRow.ts
  - lib/zoom/access.ts
  - lib/zoom/zoomView.ts
  - lib/validation/zoom.ts
  - lib/callings/writeCalling.ts
  - lib/auth/adminUsers.ts
  - lib/auth/permissions.ts
  - lib/access/releasedModules.ts
  - lib/auth/navigation.tsx
  - app/api/zoom/remote-control/route.ts
  - app/api/zoom/remote-links/[position]/route.ts
  - app/api/callings/route.ts
  - app/api/admin/users/[id]/route.ts
  - app/(app)/zoom/page.tsx
  - app/(app)/zoom/ZoomTabs.tsx
  - app/(app)/zoom/RemoteControlPanel.tsx
  - app/(app)/zoom/RemoteLinksPanel.tsx
related: [sacrament-planner-adapter, released-modules-per-ward, ward-callings-model, sacrament-music-people]
---

## What was done
The first Zoom slice: a Zoom tile whose first screen is a Remote control button opening the reader's
own stream-remote link, and a bishopric-only Remote links tab where the five positions' links
(bishop, both counselors, ward clerk, executive secretary) are pasted, replaced and turned off.
Migration 094 adds `zoom_remote_links`, readable only by its holder, plus a new `zoom` released
module and two permissions. A calling change turns stale links off.

## Key decisions
- **The link is a capability, so only its holder can read it.** The SELECT policy has no bishopric
  arm, there is no write policy (the routes write with the service role behind
  `canManageRemoteLinks()`), and the button points at a 303 redirect route so the URL never reaches
  the page's HTML, an audit row or a response.
- **Computed on read AND stamped on write.** `holds_remote_link()` re-checks the bound calling on
  every read, including that its role and counselor number still match the position, because a
  role change updates the calling in place. `updateCalling()`/`endCalling()` — the only two writers
  of an existing calling, held by a source-read test — call `retireRemoteLinksForCalling()` so an
  undone change never revives a link. Both now take a required `actorUserId`.
- **Refresh after every tab change.** `RemoteLinksPanel` calls `router.refresh()` after a save: the
  bishop's own Remote control state may have changed, and the panel remounts from `initialRows` on
  each tab switch. Found by reviewing the code during the suite run, before the walk.

## What the walk found
- No defects in the feature. The user accepted all five judgement items, including UTC date stamps
  (an evening change reads tomorrow's date) and third-person wording when a bishop turns off his own
  link.
- **No screen can change a counselor's number** (Admin → Users shows it as text; the route accepts
  it). Pre-existing. Scenario step 9 now sends the change through the route.
- **Pre-existing:** `PATCH /api/callings` with `isActive: true` cannot reinstate a released calling,
  because `updateCalling()` only matches active rows.
- `tests/routes/released-modules.test.ts` had used `"zoom"` as its example of a non-existent module
  key; it now uses `"speakers"`. Adding a module key can break a test that borrowed the name.
- Background shells were killed in this session, so the full suite was run in foreground chunks of
  under 10 minutes. Three route files hit the hosted auth rate limit and passed when re-run alone.
