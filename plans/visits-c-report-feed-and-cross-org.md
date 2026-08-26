# Plan: Visits C — Return-and-Report Feed and Cross-Org Visibility

**Created:** 2026-08-25
**Type:** feature
**Structure:** Sequential — plan 3 of 3 for Phase 7 ([07-visits.md](07-visits.md))
**Depends on:** `visits-a` (the logs and the notes boundary) and `visits-b` (the dashboard
`/visits` shell this adds a tab to). **Do not start before both are committed.**

> **Phase 8 reuses `ReportFeed` unchanged.** Build it generic from the first line. Retrofitting
> genericity after a visit-specific component ships is the pitfall the phase file names, and
> `activity_logs` already exists in migration 009 to check the design against.

---

## Overview

Two things, both small, both finishing Phase 7.

**Step 5 — the return-and-report feed** at `/visits/feed`: tile-based, per-user read/unread
and flag state, Next Unread, Mark All as Read.

**Step 6 — the cross-org visibility toggle**: a single boolean in `wards.settings`, edited by
bishopric admin. The RLS that enforces it **already exists and is already correct**; this
slice builds only the switch and the confirmation around it.

### Success criteria

- One leader reading a report leaves it unread for everyone else, proven by test.
- `ReportFeed` is parameterized by `reportType` and a fetcher, with **no `visit` vocabulary in
  its props**, so Phase 8 passes `'youth_activity'` and reuses it unchanged.
- Toggling cross-org visibility notifies the other two bishopric members, writes an audit row,
  and does not clobber the rest of `wards.settings`.
- `npm run lint`, `typecheck`, `test` and `build` all pass.

---

## What already exists (do not rebuild)

| Thing | Where | State |
|---|---|---|
| `report_read_status` with `unique (user_id, report_type, report_id)` | [008_visits.sql](../supabase/migrations/008_visits.sql) | Complete — the unique index is what makes the mark-read upsert safe under concurrent taps |
| `report_type` CHECK already allows `'youth_activity'` | 008_visits.sql | Complete |
| Own-rows-only RLS on `report_read_status` (4 policies) | [019_rls.sql](../supabase/migrations/019_rls.sql) L327 | Complete |
| `ward_allows_cross_org_visibility()` reading `settings ->> 'cross_org_visibility'` | 019_rls.sql L90 | Complete |
| The cross-org read branch in `visit_logs_select` | 019_rls.sql L379 | Complete |
| Cross-org read/write RLS proof | `tests/rls/visit-cross-org.test.ts` (from `visits-a`) | Complete |
| A ward-settings toggle route to copy exactly | [app/api/ward-settings/calendar/route.ts](../app/api/ward-settings/calendar/route.ts) | Complete |
| A jsonb-merge settings helper to copy exactly | [lib/calendar/wardCalendarSettings.ts](../lib/calendar/wardCalendarSettings.ts) | Complete |
| `notifyOtherBishopric()` | [lib/notifications/notifyOtherBishopric.ts](../lib/notifications/notifyOtherBishopric.ts) | Complete |

**There is no migration in this slice.** If you find yourself writing one, stop and re-read
this table.

---

## Designing for Phase 8 — check the design against `activity_logs`

Phase 8's table already exists. Compare:

| `visit_logs` | `activity_logs` | Generic tile field |
|---|---|---|
| `org_id` | *(absent)* | `contextLabel` — org name, or the activity name |
| `household_id` → family name | `event_id` → event title | `subjectLabel` |
| `visit_date` (date) | `created_at` (timestamptz), event has `event_date` | `occurredOn` (date-only string) |
| `visited_by` | `logged_by` | `authorLabel` |
| `shared_notes` | `shared_notes` | `previewText` |
| `flagged_for_ward_council` | `flagged_for_ward_council` | *(not a tile field — see below)* |

The shapes are close but **not identical**: `activity_logs` has no `org_id` and no date
column of its own. So the component must not take rows — it takes an already-normalized
`ReportTile[]`, and each module maps into it. That mapping is the seam, and it is what makes
Phase 8 a new mapper rather than a new component.

**Two different flags, do not conflate them.** `visit_logs.flagged_for_ward_council` is a
ward-council agenda request (`visits-a`, notifies the executive secretary).
`report_read_status.flagged` is a private per-user bookmark. Same word, unrelated meanings,
and one leaking into the other would either spam the executive secretary or expose a personal
bookmark. Name them `flaggedForWardCouncil` and `bookmarked` in TypeScript throughout, even
though the column is `flagged`.

---

## Relevant Files

### Create

- `lib/reports/readStatus.ts` — per-user read and bookmark state. Module-agnostic.
- `lib/reports/types.ts` — `ReportType`, `ReportTile`, `ReportFeedPage`.
- `lib/visits/reportTiles.ts` — maps visit logs into `ReportTile[]`. **The visit-specific
  half**, deliberately outside `components/`.
- `app/api/reports/read-status/route.ts` — `POST` (mark one read / toggle bookmark),
  `PATCH` (mark all read).
- `app/api/visits/feed/route.ts` — `GET`, returns `ReportTile[]` for visits.
- `app/api/ward-settings/cross-org-visibility/route.ts` — `GET`, `PATCH`.
- `lib/ward/crossOrgVisibility.ts` — read/write the boolean, merging into `wards.settings`.
- `components/visits/ReportFeed.tsx` — `"use client"`. Generic. **No visit vocabulary.**
- `components/visits/ReportTile.tsx` — `"use client"`.
- `app/(app)/visits/feed/page.tsx` — the visits entry point.
- `app/(app)/admin/CrossOrgVisibilityToggle.tsx` — `"use client"`.
- `tests/lib/reportTiles.test.ts`
- `tests/rls/report-read-status.test.ts` — `read-state-per-user`
- `tests/routes/reportReadStatus.test.ts`
- `tests/routes/crossOrgVisibility.test.ts`
- `testing/scenarios/scenario-041-*`, `scenario-042-*`

### Modify

- `app/(app)/admin/page.tsx` — mount the toggle.
- `types/domain.ts` — re-export `ReportType` if the app types live there by convention.
- `app/(app)/visits/page.tsx` — a link/tab across to the feed.

> `components/visits/ReportFeed.tsx` is the path the phase file specifies, and it stays there
> even though the component is generic. Phase 8 imports it from `components/visits/`; moving
> it to `components/reports/` is a rename this slice does not own. Note it in the retro as a
> candidate if Phase 8 finds the path confusing.

---

## Known Pitfalls (from retro context)

- **[route-tests-and-realtime]** — **A realtime channel topic must be unique per subscriber,
  and the browser client is shared.** `createBrowserClient()` memoises, so two components
  asking for the same topic get the same channel and the second `.on()` **throws**. This
  broke the comment threads. **If** the feed subscribes to new reports, its topic must include
  a `useId()`. Prefer not subscribing at all — see §Task 5.
- **[route-tests-and-realtime]** — **Realtime authenticates separately from PostgREST.**
  `client.realtime.setAuth(accessToken)` before subscribing, or the socket is anonymous and
  every policy refuses it — which looks exactly like working isolation.
- **[route-tests-and-realtime]** — **Unsubscribe every channel in `afterAll`**, or the run
  hangs after the last assertion passes.
- **[route-tests-and-realtime]** — **Assert a refused write by RE-READING the row.** An
  RLS-denied UPDATE is a zero-row success. Both the read-state isolation assertions depend on
  this.
- **[route-tests-and-realtime]** — **Order any query you then index into.**
- **[talks-d]** — **Client-only state the server renders around is a flash.** Measured at
  268 ms unthrottled, 3.8 s at 20x CPU. Unread state comes from the **server** on first
  render; do not paint every tile as unread and correct it on hydration.
- **[visits-a]** — **no private note may appear in a tile.** `previewText` is built from
  `shared_notes` only, and `lib/visits/reportTiles.ts` must not import
  `lib/visits/privateNotes.ts`. The `private-notes-not-in-list` assertion extends to this
  feed's route.
- **[auth-b]** — `can()` not `assertCan()` in a Server Component; a `ForbiddenError` escaping
  one becomes a 500 whose message Next strips in production.
- **[roster-b]** — a query param the handler does not read is a silently ignored filter.

---

## Tasks

### Task 1: `lib/reports/types.ts` and `lib/reports/readStatus.ts`

**Files:** create

**Details:**

```ts
export type ReportType = "visit_log" | "youth_activity";

export type ReportTile = {
  reportType: ReportType;
  reportId: string;
  contextLabel: string;      // "Elders Quorum"
  subjectLabel: string;      // "The Andersen Family"
  occurredOn: string;        // date-only
  authorLabel: string;       // "Brother Hale"
  previewText: string | null;// one line from SHARED notes only
  isRead: boolean;
  bookmarked: boolean;
};
```

`readStatus.ts`:

- `listReadStatus(reportType, reportIds, client)` — the caller's own rows only.
- `markRead(reportType, reportId, client)` — `.upsert(..., { onConflict:
  "user_id,report_type,report_id" })` against the Phase 0 unique index. **That index is what
  makes a double tap safe**; say so in a comment.
- `setBookmarked(reportType, reportId, bookmarked, client)`.
- `markAllRead(reportType, reportIds, client)` — one upsert of many rows.
- **Session client only.** `user_id` is always `auth.uid()`; no function here accepts a
  `userId`, so "mark it read for someone else" is not expressible.
- `read_at` is a timestamp, not a boolean: `isRead` is `read_at !== null`. A row can exist
  with `read_at` null because it was bookmarked before it was read.

### Task 2: `lib/visits/reportTiles.ts`

**File:** create

**Details:**

- `toReportTiles(logs, readStatus)` — pure, so `tests/lib/reportTiles.test.ts` needs no
  database.
- `previewText`: first line of `shared_notes`, trimmed, truncated at a word boundary to ~120
  chars with an ellipsis. **Null when there is no shared note** — render "No shared note"
  rather than an empty tile.
- `occurredOn` ← `visit_date`. `contextLabel` ← organization name.
  `subjectLabel` ← household family name. `authorLabel` ← the visitor's display name.
- **This file must not import `lib/visits/privateNotes.ts`.** State it in the header, as
  `lib/visits/queries.ts` does.

### Task 3: `GET /api/visits/feed`

**File:** `app/api/visits/feed/route.ts` (create)

**Details:**

- `assertCan(user, "visits.view", roleAccess)`.
- Reads logs through `lib/visits/queries.ts` — **RLS decides the scope**, which is exactly
  where cross-org visibility takes effect for free. Do not re-implement the cross-org rule
  here; the policy already ORs it in.
- Fetches the caller's read status for the returned ids, maps to tiles, returns
  `{ tiles, unreadCount }`.
- Ordered `visit_date desc, created_at desc` — deterministic, and it is a list the UI indexes
  into.
- Paginate with a `limit` / `before` cursor. A feed is unbounded by nature; a ward with three
  years of logs should not ship them all in one payload.

### Task 4: `POST` / `PATCH /api/reports/read-status`

**File:** `app/api/reports/read-status/route.ts` (create)

**Details:**

- **Deliberately module-agnostic**, nested under `/api/reports` rather than `/api/visits`, so
  Phase 8 posts `reportType: 'youth_activity'` to the same route. This is the API counterpart
  of the generic component.
- `POST` — body `{ reportType, reportId, read?, bookmarked? }`. Zod-validated;
  `reportType` is an enum, so an unknown value is a 400 rather than a row the CHECK
  constraint rejects at the database.
- `PATCH` — body `{ reportType, reportIds }` for Mark All as Read.
- Permission: the caller must hold the **owning module's** view permission — `visits.view`
  for `visit_log`, `youth_activities.view` for `youth_activity`. Map it explicitly; do not
  let a `visits.view` holder mark youth reports read.
- **`report_id` carries no foreign key** — it is polymorphic, and migration 008's comment says
  integrity is the application's job. Verify the report exists **and is visible to this
  caller** through the module's own query before writing a row. Otherwise a caller can probe
  for the existence of another org's logs by watching which ids succeed.
- **No audit row.** Reading a report is not a mutation of ward data, and an audit row per tap
  would bury the log. Note the deliberate exception in the retro — CLAUDE.md rule 6 says every
  mutation writes one, and this is a considered departure, not an oversight. **Raise it if you
  disagree rather than silently skipping it.**

### Task 5: `ReportFeed` and `ReportTile`

**Files:** `components/visits/ReportFeed.tsx`, `components/visits/ReportTile.tsx` (create)

**Details:**

Props — **this is the interface Phase 8 inherits, so get it right now**:

```tsx
type ReportFeedProps = {
  reportType: ReportType;
  initialTiles: ReportTile[];
  initialUnreadCount: number;
  fetchPage: (cursor: string | null) => Promise<ReportFeedPage>;
  emptyMessage: string;
  onOpen?: (tile: ReportTile) => void;
};
```

- **No prop named `visit`, `household`, or `org`.** Grep the finished file for those words;
  a hit means Phase 8 will have to fork it.
- Behaviors: unread tiles visually distinct (not by colour alone — a weight or a marker too);
  tapping opens the full report and marks it read; **Next Unread** walks the queue in feed
  order and scrolls the tile into view; a bookmark icon toggles `bookmarked`; **Mark All as
  Read** confirms first, since it is not individually undoable.
- TanStack Query with an optimistic update on mark-read, rolling back on error, and a
  **visible** error message — never a silent revert (CLAUDE.md rule 7).
- `initialTiles` comes from the server, so read state is correct on first paint (§Known
  Pitfalls: the flash).
- **Do not add a realtime subscription.** A feed of visit reports is not time-critical, and
  the memoised-client topic collision is a real trap. If it is ever wanted, the topic must
  carry a `useId()`.

### Task 6: The feed page

**File:** `app/(app)/visits/feed/page.tsx` (create)

**Details:** Server Component. `can(user, "visits.view", roleAccess)` → `NotPermitted`.
Fetches the first page server-side, passes `reportType="visit_log"` and a `fetchPage` bound to
`/api/visits/feed`. A tab or link back to `/visits`.

### Task 7: `lib/ward/crossOrgVisibility.ts`

**File:** create

**Action:** Read and write the boolean. **Copy
[lib/calendar/wardCalendarSettings.ts](../lib/calendar/wardCalendarSettings.ts) almost
literally** — it solves this exact problem for a different key.

**Details:**

- `parseCrossOrgVisibility(settings)` — a missing or malformed value **warns and returns
  `false`**, matching `mergeRoleAccess()` and `parseDefaultSpeakingSlots()`. Failing closed is
  right here: a bad setting must narrow visibility, never widen it.
- `readCrossOrgVisibility(wardId, client)`, `writeCrossOrgVisibility(wardId, enabled, client)`.
- **`writeCrossOrgVisibility` MERGES into the existing settings object.** `wards.settings`
  also holds `role_access`, `timezone` and `default_speaking_slots`, and a wholesale write
  **would silently delete the ward's permission overrides**. The calendar helper carries this
  warning verbatim; carry it here too.
- **Store a JSON boolean `true`/`false`.** The SQL side is
  `(settings ->> 'cross_org_visibility') = 'true'`, and `->>` renders a JSON boolean as the
  text `'true'`, so a boolean works and the string `"true"` also works. **Write the boolean**
  — and do not "fix" the SQL function to cast instead; its header explains that comparing
  against the literal string is deliberate, so a malformed value reads as off rather than
  raising inside a policy and breaking every query.
- A denied UPDATE is a zero-row success (`wards_update` is bishopric-only), so `!data` must
  throw a clear message — the calendar helper's last block, copied.

### Task 8: The toggle route and control

**Files:** `app/api/ward-settings/cross-org-visibility/route.ts`,
`app/(app)/admin/CrossOrgVisibilityToggle.tsx` (create), `app/(app)/admin/page.tsx` (modify)

**Details:**

- Route copies `app/api/ward-settings/calendar/route.ts` structure exactly:
  - `GET` — gated on `visits.view`, so the dashboard can tell a leader what mode they are in.
  - `PATCH` — gated on **`admin.manage_ward`**, which only bishop and counselor hold.
  - `writeAuditLog` with the before and after values.
  - `notifyOtherBishopric()` **only when the value actually changed** — the calendar route
    guards on `before !== after` and so must this. §Step 6 requires the other two be told.
  - Session resolved outside the `try`.
- The control is a switch with **an explicit confirmation naming the consequence**: §Step 6
  calls it "a significant setting" because it changes what several dozen people can see. The
  confirm text states, in words, what turning it on and off does — and that **management stays
  within the org either way**.
- Show the current state as text, not only as a switch position.

---

## Testing Strategy

### `tests/lib/reportTiles.test.ts`
Pure. Preview truncates at a word boundary; a null `shared_notes` yields a null preview, not
`""`; a multi-line note previews the first line only; `isRead` is false when no read-status
row exists; a row with `read_at` null but `flagged` true yields `isRead: false,
bookmarked: true`.

### `tests/rls/report-read-status.test.ts` — `read-state-per-user`
The phase file's named test.

- User A marks a report read → **user B still reads zero rows** for it. This is the assertion
  the whole feature turns on.
- User B's own row for the same `report_id` is independent: A read + B unread coexist, which
  the `unique (user_id, report_type, report_id)` index permits and a `unique (report_type,
  report_id)` would not.
- User B cannot UPDATE user A's row — **re-read with the service client** to prove it, since a
  denied UPDATE is a zero-row success.
- User B cannot INSERT a row with A's `user_id` (this one raises).
- Cross-ward: a user in ward B reads none of ward A's rows.

### `tests/routes/reportReadStatus.test.ts`
- Marking the same report read twice is idempotent — one row, and the second call is not an
  error.
- `reportType: "visit_log"` with an id the caller cannot see → refused, and the response does
  not distinguish "not found" from "not yours".
- A `visits.view` holder cannot mark a `youth_activity` report read.
- An unknown `reportType` → 400 from Zod, not a database error.

### `tests/routes/crossOrgVisibility.test.ts`
- `PATCH` as bishop → 200; as counselor → 200 (**shared bishopric authority**, CLAUDE.md §7 —
  never build a check granting the bishop something a counselor lacks).
- As `org_president` → 403.
- **The merge assertion:** seed `wards.settings` with a `role_access` override, toggle
  visibility, then re-read and assert `role_access` **survives unchanged**. This is the test
  that catches the wholesale-write bug.
- Toggling to the same value writes no notification.
- Toggling to a new value writes an audit row and notifies the other two bishopric members.
- **End-to-end:** with visibility off an EQ user's feed excludes RS tiles; with it on the
  same call includes them — and **contains no private-note text in either mode**.

---

## Test Scenarios (Harness)

Numbering assumes `visits-a` took 038–039 and `visits-b` took 040. **Verify against
`testing/scenarios/manifest.json` before writing.**

### Scenario 041: The feed, read state, and Next Unread
**Tags:** `visits`, `smoke`, `feed`
**Purpose:** Per-user read state is invisible until two people have looked at the same feed,
and Next Unread needs a queue with gaps in it. Both are tedious to arrange by hand.
**Seed data summary:**
- `organizations` — 2 — Elders Quorum, Relief Society
- `users` — 4 — bishop, EQ president, EQ counselor, RS president
- `visit_logs` — 12 — 8 EQ, 4 RS, varied dates, two with no shared note, one with a very long
  shared note
- `visit_private_notes` — 2 — authored by the EQ president, distinctive text
- `report_read_status` — 3 — EQ **counselor** has read three of the EQ reports; the EQ
  president has read none
- `wards.settings.cross_org_visibility` — `false`

**Tester action:** Log in as the EQ president, open `/visits/feed`, use Next Unread through
several tiles, bookmark one, then Mark All as Read. Log in as the EQ counselor and open the
same feed.
**Verification checklist:**
- [ ] The EQ president starts with 8 unread; the counselor starts with 5
- [ ] Unread tiles are distinguishable without relying on colour alone
- [ ] Next Unread visits each unread tile in feed order and skips read ones
- [ ] Opening a tile marks it read and the count decrements immediately
- [ ] Mark All as Read asks for confirmation first
- [ ] After the president marks all read, **the counselor still has 5 unread**
- [ ] The bookmark survives a page reload and does not appear for the counselor
- [ ] Neither private note's text appears anywhere in the feed, in any tile, at any width
- [ ] Tiles with no shared note read "No shared note" rather than rendering empty
- [ ] The very long shared note is truncated on the tile, not overflowing
- [ ] RS tiles are absent (visibility is off)
- [ ] Dark mode and 375 px width both hold

### Scenario 042: Cross-org visibility toggle
**Tags:** `visits`, `full`, `admin`, `privacy`
**Purpose:** The setting changes what several dozen people see, and the merge bug it can cause
is silent. Seeding a ward that already has a `role_access` override is the only way to see
the overwrite happen.
**Seed data summary:**
- Everything from 041, plus:
- `wards.settings` — carries a **non-default `role_access` override** and a non-default
  `default_speaking_slots`, both set before the toggle is touched

**Tester action:** As the bishop, open `/admin` and turn cross-org visibility on. Log in as
the EQ president and open both `/visits/feed` and `/visits`. Return as a **counselor** and
turn it back off.
**Verification checklist:**
- [ ] Turning it on asks for confirmation, and the confirm text says management stays
      org-confined
- [ ] The other two bishopric members receive a notification; the acting user does not
- [ ] An audit row records the before and after values
- [ ] With it on, the EQ president's feed shows RS tiles **and still no private notes**
- [ ] With it on, the EQ president can still not edit or create an RS log or goal — the
      controls are absent, and a direct attempt fails
- [ ] **After toggling, the ward's `role_access` override and speaking-slot setting are
      unchanged** — check the admin screens that read them
- [ ] A counselor can toggle it, exactly as the bishop can
- [ ] An org president sees no toggle at all
- [ ] Turning it back off removes the RS tiles again

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run harness:typecheck

# Do NOT run `npm run seed` while the suite runs — same hosted ward
npm run test

npm run build
```

No migration in this slice, so no `db:push` / `db:types`.

---

## Integration Notes

- **This closes Phase 7.** Walk the Definition of Done in
  [07-visits.md](07-visits.md) and tick it, including the eight named tests — five landed in
  `visits-a`, two in `visits-b`, one here.
- **Phase 8 inherits `ReportFeed` and `/api/reports/read-status`.** Its work is a
  `lib/youth/reportTiles.ts` mapper and a page, not a new component or a new route. If it
  turns out otherwise, the genericity failed and the retro should say where.
- **Update `plans/INDEX.md`** to mark Phase 7 complete.
- **Two items remain open at the end of Phase 7.** Neither blocks the Definition of Done, and
  both should be written into the retro rather than left in a plan file nobody reopens:
  1. **`visit_overdue` fires from nothing.** No `supabase/functions/`, `pg_cron` not enabled
     (`talks-d` recorded the same for `refresh_goal_status()`). `visits-b` makes overdue
     computable; nothing emits it. Deciding the mechanism — Vercel Cron against an
     authenticated route, an Edge Function, or enabling `pg_cron` — has hosting consequences
     and belongs with Phase 11's notification work if it is not taken sooner.
  2. **`visit_goals_select` has no cross-org branch** while `visit_logs_select` does. With
     visibility on, a leader reads another org's logs but not the goal behind them, so a
     cross-org "X of Y" is not computable. The feed does not need it — tiles carry no
     denominator — which is why this slice does not add the policy branch. **Do not add it
     speculatively.**
- **The `map view` toggle is still unbuilt** and still blocked on a geocoding provider
  (CLAUDE.md §9). `households.latitude` / `longitude` exist and are null. FEATURES.md marks it
  optional; Phase 7 closes without it, deliberately.
