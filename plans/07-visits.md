# Phase 7 — Visit Tracker & Return-and-Report Feed

Per-organization visit goals, household visit logs with a hard public/private note split,
a progress dashboard, and the tile-based report feed.

**Depends on:** Phase 2. **Independent of Phases 3–6** — can be built in parallel.
**Unlocks:** Phase 8, which reuses the report feed.
**Reference:** [FEATURES.md](../FEATURES.md) §Module 9; [SPEC.md](../SPEC.md) §API Routes → Visit Tracker.

> **The private-notes boundary is the most sensitive rule in this codebase.** A private
> note is visible to its author and to no one else — not the bishop, not an admin, not a
> support query. Read the RLS section before writing any code here.

---

## Goals

1. Each organization sets and tracks its own visit goals independently
2. Visit logs with separate shared and private notes
3. Flagging a visit for ward council notifies the executive secretary
4. Progress dashboard with per-household status
5. Return-and-report feed with per-user read/unread and flag state
6. Cross-org visibility toggle, admin-controlled

---

## Step 1 — Visit Goals

Each org configures its own. Bishopric can configure any; an org president or counselor
configures their own only.

| Field | Notes |
|---|---|
| `target_type` | `all_households` / `specific_households` / `custom` |
| `cadence` | `annual` / `biannual` / `custom` + `cadence_months` |
| `goal_period_start` / `_end` | The window this goal covers |

| Route | Method | Auth |
|---|---|---|
| `/api/visit-goals` | GET | Bishopric (all orgs) or own org |
| `/api/visit-goals` | POST | Bishopric or org president/counselor |
| `/api/visit-goals/[id]` | PATCH | Same |

**Org secretaries can view but not configure.** Check `role` explicitly — `org_secretary`
is not `org_counselor`.

Goals reset on their cadence. When a period ends, create the next period's goal rather than
mutating the old one, so history survives.

---

## Step 2 — Visit Logs & The Notes Split

This is the crux of the phase.

`visit_logs` holds `shared_notes` — visible per the cross-org visibility setting.
`visit_private_notes` is a **separate table** with its own RLS: `user_id = auth.uid()`,
all operations, no exceptions and no bishopric override.

The separate table is not incidental; it is the mechanism. A `private_notes` column on
`visit_logs` could be leaked by any `select *`. A separate table with its own policy
cannot be.

**In code:**

- Never join `visit_private_notes` into a general visit query
- Fetch private notes in a separate, explicit call that returns only the caller's own
- Never include them in a list response, an export, a report tile, or a notification body
- The UI must label the two fields unmistakably. A leader writing a pastoral observation
  needs to know, at a glance, which box is which. Use distinct colours and explicit
  helper text: "Shared with other leaders" vs "Only you can ever see this"

| Route | Method | Does |
|---|---|---|
| `/api/visits` | GET | List, org-scoped. **Never includes private notes** |
| `/api/visits` | POST | Create a log |
| `/api/visits/[id]` | PATCH | Update shared notes, flag |
| `/api/visits/[id]/private-note` | POST | Upsert the caller's own private note |
| `/api/visits/progress` | GET | Dashboard summary |

Visit record fields: date, type (`In-Home Visit`), conducted by, shared notes, private
notes, flagged-for-ward-council.

---

## Step 3 — Ward Council Flagging

Any visit entry can be flagged for ward council discussion.

Flagging emits `visit_flagged_for_ward_council` to the executive secretary with a one-line
agenda item:

```
[Org] — [Family Name] — requested for ward council discussion
```

**The notification carries the one-liner only.** No shared notes, no private notes, no
detail. The executive secretary adds it to the next agenda (Phase 9 consumes these).

Set `flag_sent_at` so a re-flag does not re-notify. Unflagging is allowed and clears it.

---

## Step 4 — Progress Dashboard

`/visits` — sortable list per organization.

Columns: household name, last visited, visit count this period, status, logged by.

`lib/visits/householdStatus.ts` — pure function:

| Status | Condition |
|---|---|
| `Visited` | Visited within the current goal period |
| `Due Soon` | 80% of the cadence interval elapsed since last visit |
| `Overdue` | Past the cadence interval |
| `Not Yet Visited` | No visit in this goal period |

Progress banner: "X of Y households visited — Z remaining". **Y excludes moved-out and
do-not-contact households** — getting the denominator wrong makes the number meaningless.

Emit `visit_overdue` when a household crosses into overdue, from the nightly Edge Function.
Emit once per household per period, not nightly — track with a flag or check the last
notification date.

**Map view is optional and ships second.** It needs `households.latitude/longitude`, and
no geocoding provider is chosen yet (see CLAUDE.md §9). Build the list view first; put the
map behind a toggle that hides itself when coordinates are absent.

---

## Step 5 — Return-and-Report Feed

`/visits/feed`. Tile-based. Phase 8 reuses this component for youth activities, so build
it generically from the start.

Each tile: org, household, date, who visited, one-line preview of the shared note.

Per-user state in `report_read_status` (`report_type` + `report_id`):

- Unread tiles visually distinct
- Tapping a tile opens the full report and marks it read
- **Next Unread** button walks the queue
- Flag icon bookmarks for later
- Mark All as Read

Read and flag state are **per user** — one leader reading a report does not mark it read
for anyone else. The `UNIQUE (user_id, report_type, report_id)` index from Phase 0 makes
the mark-read upsert safe under concurrent taps.

Component: `components/visits/ReportFeed.tsx` with `ReportTile`. Parameterize by
`reportType` and a fetcher so Phase 8 passes `'youth_activity'` and reuses everything.

---

## Step 6 — Cross-Org Visibility

A single boolean in `wards.settings.cross_org_visibility`, toggled by bishopric admin.

| Setting | Effect |
|---|---|
| **On** | All org participants can view other orgs' visit summaries and shared-note reports |
| **Off** | Each org sees only its own data |

**Management always stays within the org.** Cross-org visibility affects *reading* only —
an EQ president can never create or edit a Relief Society goal or log, in either mode.
Enforce this in RLS, not just in the UI.

The bishopric sees everything regardless.

Toggling notifies the other two bishopric members and writes an audit row. It changes what
several dozen people can see; treat it as a significant setting and confirm before applying.

---

## Tests

| Test | Asserts |
|---|---|
| `private-notes-absolute.test.ts` | The bishop cannot read a counselor's private note via the API, a direct query, or a list endpoint. **Highest priority test in the entire project** |
| `private-notes-not-in-list.test.ts` | No list or feed response contains a private-note field for anyone |
| `cross-org-read.test.ts` | Off: an EQ user sees only EQ logs. On: they see RS shared notes but still no private notes |
| `cross-org-write.test.ts` | Even with visibility on, an EQ user cannot write an RS log or goal |
| `household-status.test.ts` | Each of the four statuses at its boundary |
| `progress-denominator.test.ts` | Moved-out and do-not-contact households excluded from the total |
| `flag-notification.test.ts` | Flagging notifies the exec secretary with the one-liner only, and re-flagging does not re-notify |
| `read-state-per-user.test.ts` | User A reading a report leaves it unread for user B |

---

## Definition of Done

- [ ] Each org sets and manages its own goals; org secretaries can view but not configure
- [ ] Visit logs with visually unmistakable shared/private note separation
- [ ] Private notes are unreachable by anyone but their author — proven by test
- [ ] Flagging notifies the exec secretary with the one-liner only
- [ ] Dashboard with correct statuses and a correct denominator
- [ ] Report feed with per-user read/unread, next-unread, flag, mark-all
- [ ] `ReportFeed` is generic enough for Phase 8 to reuse unchanged
- [ ] Cross-org visibility toggles reads only; writes stay org-confined in both modes
- [ ] All eight tests pass

---

## Pitfalls

- **`select *` on a joined query.** The reason private notes live in their own table.
  Never join them into a general query, even "just for the detail view".
- **Private notes in a notification body.** A flag notification, an email, or a digest
  that includes note text defeats the whole design. One-liners only.
- **Ambiguous note fields in the UI.** If a leader cannot tell which box is private, they
  will eventually put the wrong thing in the wrong one. Make it visually obvious.
- **Wrong progress denominator.** Counting moved-out households makes every org look
  behind and erodes trust in the number.
- **Nightly overdue spam.** Emit once per household per period, not every night.
- **Building the feed visit-specific.** Phase 8 needs the same component. Parameterize now.
- **Enforcing cross-org visibility in the UI only.** It must be an RLS predicate.
  A hidden tab is not access control.
