---
id: visits-c-report-feed-and-cross-org
type: feature
iter: null
commits: []
date: 2026-08-26
files:
  - lib/reports/types.ts
  - lib/reports/readStatus.ts
  - lib/visits/reportTiles.ts
  - lib/visits/reportFeed.ts
  - lib/visits/visitOwnership.ts
  - lib/visits/queries.ts
  - lib/ward/crossOrgVisibility.ts
  - lib/youth/queries.ts
  - lib/validation/report.ts
  - lib/validation/visit.ts
  - app/api/reports/read-status/route.ts
  - app/api/visits/feed/route.ts
  - app/api/ward-settings/cross-org-visibility/route.ts
  - components/visits/ReportFeed.tsx
  - components/visits/ReportTile.tsx
  - app/(app)/visits/feed/page.tsx
  - app/(app)/visits/feed/VisitReportFeed.tsx
  - app/(app)/visits/page.tsx
  - app/(app)/admin/page.tsx
  - app/(app)/admin/CrossOrgVisibilityToggle.tsx
  - app/globals.css
  - types/domain.ts
related:
  - visits-a-goals-logs-and-notes
  - visits-b-progress-dashboard
  - visits-d-attempts-appointments-and-participants
  - route-tests-and-realtime
  - roster-b-picker-and-orgs
  - talks-d-reliability-goals
  - auth-b-invites-admin
---

## What was done

The return-and-report feed at `/visits/feed` and the cross-org visibility switch on `/admin`,
closing Phase 7. **No migration** — `report_read_status`, its four own-rows-only policies, the
`report_type` CHECK that already allowed `'youth_activity'`, and
`ward_allows_cross_org_visibility()` had all existed since Phases 0 and 1. This slice built the
screens and the routes around them.

`ReportFeed` is generic from the first line: it takes a normalized `ReportTile[]` and knows
nothing about visits. Each module supplies a mapper (`lib/visits/reportTiles.ts` here) and a
fetcher, so Phase 8 renders the same component with `reportType="youth_activity"`. The
read-status route is module-agnostic for the same reason and lives at `/api/reports/read-status`
rather than under `/api/visits`.

Walking scenarios 041 and 042 in a browser found one defect and answered seven judgement
questions, two of which asked for work; a second bug surfaced while building that work. All
three are fixed and pinned.

## Key decisions

- **`authorLabel` is who WENT, and is null rather than falling back to the recorder.** `visits-d`
  split `visit_logs.visited_by` into `recorded_by` plus a participants table, and a tile that
  filled an empty "who went" with "who typed it in" would put that ambiguity straight back. The
  tile carries both fields and the empty case is a sentence — "Nobody recorded as taking part" —
  not a blank.

- **`outcomeLabel` is set for `attempted` and null for `completed`.** A label on every tile
  reading "Visited" is noise; the one reading "Attempted" is the point, because an attempt counts
  towards no goal (`visits-b`).

- **No audit row on read-status, deliberately.** CLAUDE.md rule 6 asks for one on every mutation.
  This writes one person's own reading state — not ward data, not anything anybody else can see —
  and a row per tap would bury the log under a feed's worth of noise. The audit trail is
  bishopric-readable, so "who read what and when" would also record one leader's attention in a
  log they cannot themselves read. Raised in the plan, agreed, implemented as specified.

- **The read-status route parses the body BEFORE checking the permission**, which is the reverse
  of every other route here. It has to: *which* permission applies is a function of `reportType`.
  The cost is that a caller who lacks the permission and sends a malformed body is told about the
  body first.

- **`report_id` carries no foreign key**, so both handlers resolve the report through its owning
  module's query first, with the caller's session client. Without that a caller could probe for
  the existence of another organization's logs by watching which ids were accepted — a leak the
  read-status policies cannot close, because they are about the reader's rows rather than the
  report. "Not found" and "not yours" return the identical message.

- **Writes take a `userId`; reads do not.** The plan said no function should accept one, but an
  INSERT has to put a value in the column, and `lib/visits/privateNotes.ts` had already solved
  this exact problem the same way. The INSERT policy checks `user_id = auth.uid()`, so passing
  anybody else's is refused by the database rather than trusted.

- **The feed filter is server-side.** A feed is paginated, so filtering loaded tiles in the
  browser would answer "3 reports" while twenty more sat below the fold — the silently-ignored
  filter `roster-b` recorded, in a new costume. The unread count and Mark all as read follow the
  filter, so the number always describes what is on screen.

- **Organization tones are named per organization TYPE, not hashed.** Organizations are a fixed
  enum, so the Relief Society is violet on every screen forever; a hash-to-palette scheme would
  re-colour an organization whenever the set on screen changed. Seven tones measured against both
  surfaces in both themes (4.94–10.21, AA needs 4.5), recorded in `globals.css` beside the stage
  palette that set the precedent. The chip always carries the organization's NAME — seven hues
  separate seven things only for somebody who can see all seven.

## What the walk found

**A control the policy refuses.** With cross-org visibility on, the Recent visits panel on
`/visits` offered "Flag for ward council" on every organization's visits. RLS refused the writes
correctly — nothing was written, nobody was notified — but a leader was shown a
consequential-sounding action, confirmed it, and got a generic failure. `visits.create` says who
may LOG visits; it says nothing about WHICH visits may be edited, and until this slice shipped the
switch, the difference could not show.

Fixed with `canManageVisitLog()` in `lib/visits/visitOwnership.ts`, mirroring
`visit_logs_update`'s org clause. **The null guard in it is the part worth remembering: JavaScript
and SQL disagree.** A bishopric-authored visit has `org_id = null`; SQL's `null = null` is NULL,
JavaScript's is `true`. A naive port would have handed edit controls on every bishopric visit to
any leader with no organization.

**Two staleness bugs, both the screen showing state the server does not have.** The dropdown first
listed all seven ward organizations, five of which had never logged a visit and answered with an
empty feed — now derived from organizations that actually have reports, which also removed a
query. And each filter being its own cache key meant bookmarking under one filter left the others'
cached pages stale until a reload; mutations now patch every cached variant. That is the same
class as `talks-d`'s flash, arriving from the other direction.

**Three checklist lines described states the app cannot reach** — an account the seed never
creates, a notification bell that is an inert placeholder until Phase 11, and a check that did not
say which screen to look at. Corrected in the scenario files with the reason, rather than ticked.

## Handed forward

- **`components/visits/ReportFeed.tsx` is generic but lives under `components/visits/`**, which is
  the path `07-visits.md` specifies. Phase 8 imports it from there. If that reads as confusing when
  youth activities arrive, moving it to `components/reports/` is a rename that slice can own.

- **`visit_overdue` fires from nothing.** No `supabase/functions/`, `pg_cron` not enabled —
  `talks-d` recorded the same for `refresh_goal_status()`. `visits-b` made overdue computable and
  nothing emits it. Deciding the mechanism has hosting consequences and belongs with Phase 11.

- **`visit_goals_select` has no cross-org branch** while `visit_logs_select` does, so with
  visibility on a leader reads another organization's logs but not the goal behind them. A
  cross-org "X of Y" is therefore not computable. The feed does not need one — tiles carry no
  denominator — which is why this slice did not add the policy branch. **Do not add it
  speculatively.**

- **`lib/youth/queries.ts` holds one function**, `getActivityLog()`, written here because the
  read-status route is generic and "may this caller see this activity?" had to be answerable on the
  day it shipped or the genericity would be a claim rather than a fact. Phase 8 owns and extends
  that file.

- **The realtime suite is flaky under load.** `tests/rls/realtime-isolation.test.ts` timed out its
  WebSocket during a 23-minute full run with a dev server and a browser competing for two cores,
  and passed alone in 12 seconds. Second time realtime tests have proven fragile here after
  `route-tests-and-realtime`. Nothing in this slice touches realtime — the feed deliberately has
  no subscription — but a suite that fails for environmental reasons trains people to ignore it.

- **The map view stays unbuilt**, still blocked on a geocoding provider (CLAUDE.md §9).
  `households.latitude` / `longitude` exist and are null. Phase 7 closes without it, deliberately.

- **Run ITER-018 before Phase 8.** The visit goal becomes a rolling cadence rather than a dated
  period, and Phase 8's coverage is documented to reuse `householdVisitStatus`. Nothing in this
  slice is affected — the feed is over logs, not goals.
