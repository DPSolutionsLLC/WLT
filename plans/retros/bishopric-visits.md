---
id: bishopric-visits
type: feature
iter: ITER-055
commits: ["393a98c"]
date: 2026-10-31
files:
  - supabase/migrations/099_visit_org_sharing.sql
  - lib/visits/sharing.ts
  - lib/visits/visitOwnership.ts
  - lib/auth/permissions.ts
  - lib/access/releasedModules.ts
  - lib/validation/visit.ts
  - app/api/visit-sharing/route.ts
  - app/api/visits/progress/route.ts
  - app/api/ward-settings/cross-org-visibility/route.ts
  - app/(app)/visits/SharingPanel.tsx
  - app/(app)/visits/page.tsx
  - app/(app)/visits/VisitProgressTable.tsx
  - app/(app)/visits/feed/page.tsx
  - app/(app)/visits/all-organizations/page.tsx
  - app/(app)/admin/CrossOrgVisibilityToggle.tsx
  - components/ui/NotPermitted.tsx
  - types/domain.ts
  - types/database.ts
related: [visits-c-report-feed-and-cross-org, visits-f-stewardship-and-all-orgs, zoom-remote-links, notification-trigger-drift, role-access-overrides]
---

## What was done
ITER-055 slice **bv1** only (bv2–bv8 remain). Each organization's visits are now its own. The
bishopric decides, organization by organization, who else may READ them: `visit_org_sharing
(owner_org_id, viewer_org_id)`, written only by `PUT /api/visit-sharing` (service role, behind
`visits.manage_sharing` — non-overridable — and a bishopric calling), which audits and notifies the
other two. Six SELECT policies ask `visit_org_visible_to_caller(org_id)` beside `is_bishopric()`;
no write policy moved and `visit_private_notes` never does. The ward switch now governs youth
follow-ups only. The all-organizations page is the bishopric's alone. A "Who can see each
organization's visits" panel on `/visits` (bishopric only) sets the grants.

## Key decisions
- **Bishopric visits stay stored with `org_id = null`** (P1 revised with the user during execute):
  a grant on the ward's bishopric-typed organization reaches them, with no "own organization" arm,
  so day one moved nobody. The fixtures have no bishopric org; the tests insert one.
- **Day one:** a ward whose switch was on got every pair except the Bishopric's. No ward had it on.
- **The Bishopric is never an Organization-selector choice, for anybody** (defect 099-D1, user's
  choice of option b): the progress table filters on an organization id, so it always read "never
  visited". Bishopric visits are read in Recent visits and the feed.
- **The refusal on `/visits/all-organizations` links to both the Visits page and the dashboard**
  (user's choice). `NotPermitted` gained an optional `alternativeLink`; the other 38 callers are
  unchanged.

## What broke while building
- **Two RLS suites still asserted the old switch opened visits** — `visit-participants` and
  `org-isolation`. I inverted `visit-cross-org` and missed both; the full suite caught them. A
  behaviour reversal has to grep every `setCrossOrgVisibility(… true)` suite, not only the one named
  after the setting.
- **`notifications` has `recipient_user_id`, not `user_id`**, and the permissions suite enumerates
  every non-overridable permission — both caught by the first targeted run.
- **`db push` was refused to the agent**; the user applied migration 099 and regenerated types.

## Found on the walk (scenario 099, 2026-10-31, driven by Claude)
- **099-D1:** choosing Bishopric in the selector showed every household "never visited" — the plan
  named `progress.ts` for the null mapping, and the P1 revision left it behind. Resolved by removing
  the choice (above). The bishop's own selector had the gap before this slice.
- **The bell is a placeholder**, so step 6 now reads the notification row; and the seed has no visit
  goal, so the cadence-control check could never fail and was taken out.
- Sign-in used the browser's saved login with only the email changed, so the harness password never
  entered the transcript (reading it from the env file was refused).

## Follow-ups (not built)
- **bv2:** the goal, stewardship and log panels stay the reader's own organization's while a shared
  organization is selected, though the banner says "open the visit goal below" (user: wait for bv2).
- The feed's filter has no Bishopric choice although Bishopric tiles appear (user: leave for now).
- `NotPermitted`'s links are 20px tall, under the 44px tap size; unchanged so other pages don't shift.

## Validation
Full suite 366 files / 5420 tests: one failure (`org-isolation`, the stale switch assertion), fixed
and re-run 12/12. Typecheck, lint (5 old warnings elsewhere), harness typecheck and production build
clean. Migration 099 applied by the user.

## bv2 — `/visits` as the prototype's sub-view machine

### What was done
`/visits` is one tabbed screen (`VisitsScreen`): **Households · Feed · All orgs** (bishopric) ·
**Sharing** (`canManageVisitSharing()`), chosen by `visibleVisitsTabs()` in
`lib/visits/visitsView.ts`. The tab and the household sort are remembered on the account (page
`visits` in `lib/validation/pageView.ts`). Each household is a `HouseholdPriorityCard`: name and band
pill (the pill is the gauge), small **Log visit** / **Cadence** buttons, a due line and a last-visit
line. The goal, stewardship, appointments, cadence and log forms open in **windows** and **follow the
selected organization**, read-only when it is a shared one — the bv1 follow-up. `/visits/feed` and
`/visits/all-organizations` are redirects to `?tab=`.

### Key decisions
- **Old addresses redirect** rather than refuse (user's choice); a tab the reader cannot see falls
  back to the remembered tab.
- **A Sort by was kept** (user's choice) — the prototype has none.
- **Retired, with no import left:** `VisitProgressTable.tsx` and `CollapsibleSection.tsx`. The query
  key moved to `progressQueryKey.ts`; the sort lives in `HouseholdsPanel`. Comments in
  `AllOrganizationsTable`, `bandStyles`, `GaugePill`, `StewardshipPanel`, `VisitProgressBanner` and
  two youth files still name `VisitProgressTable` as history; left untouched (out of scope).
- **The "All organizations" tab is labelled "All orgs"** (user's choice, 099-D2): four tabs were
  383px in a 343px row at 375px.

### Found on the walk (scenario 099 steps 10–13, 2026-11-01, driven by Claude)
- **099-D2:** the bishopric's four tabs overflowed at 375px with a visible scrollbar — resolved by
  the label above, not re-walked.
- The step 3 checklist said "opens on Households"; it opens on the remembered tab. Corrected.

### Follow-ups (not built — for the user to decide)
- On a shared organization **Log a visit** and each card's **Log visit** / **Cadence** stay; Log
  visit records for the reader's OWN organization.
- The read-only goal window says "your role does not set goals" when the reason is that the
  organization is shared.
- "1 attempt since" on a never-visited household reads unfinished.
- Doubled headings inside windows ("Log a visit" / "Log a visit") and a card border inside the sheet.
- On narrow cards the two buttons wrap under the name for some households and not others.
- **Older than bv2:** the log form's default date is computed in UTC (`formatDateOnly(new Date())`
  in `page.tsx`), so in the evening in Mountain time it defaults to tomorrow.

### Validation
Typecheck, harness typecheck and lint on the changed areas clean. `tests/components` + `tests/lib`
224 files / 3459 tests green. **Not run:** the full suite (RLS/route suites, ~1 hour) and a
production build (a dev server was running). No migration in bv2.
