# Phase 11 — Notification UI, Admin & Dashboards

The read side of notifications, the full admin surface, the audit log viewer, and the
role-based dashboards that become each user's home screen.

**Depends on:** all prior phases (dashboards aggregate every module).
**Unlocks:** Milestone M7 — feature complete.
**Reference:** [FEATURES.md](../FEATURES.md) §Modules 14, 15, 16; [SPEC.md](../SPEC.md) §Role-Based Dashboards.

> The notification **emit** path and the audit **write** path were built in Phase 0.
> This phase builds what people see: the bell, the feed, the settings pages, the log
> viewer, and the dashboards.

---

## Step 1 — Notification Center

`components/notifications/`:

| Component | Behaviour |
|---|---|
| `NotificationBell` | Unread count in the top nav. Subscribes to Realtime |
| `NotificationFeed` | Dropdown or drawer: recent notifications, newest first |
| `NotificationCenter` | Full page at `/notifications` with filters and history |

**Realtime subscription:**

```ts
supabase.channel('notifications')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `recipient_user_id=eq.${userId}` },
      handleNewNotification)
  .subscribe();
```

Handle the connection lifecycle properly: unsubscribe on unmount, reconnect on tab focus,
and fall back to a poll on interval if the socket drops. A stale unread count is a small
bug that erodes trust in the whole feature.

Tapping a notification marks it read and navigates to the relevant record. Store enough
in the notification body or trigger key to build that link — do not guess at the
destination from the title text.

| Route | Method | Does |
|---|---|---|
| `/api/notifications` | GET | Current user's notifications, paginated |
| `/api/notifications/[id]/read` | PATCH | Mark read |
| `/api/notifications/read-all` | PATCH | Mark all read |

**In-app only.** No email, no push. The two exceptions — agenda and program PDFs — go
through Resend and are not part of this system.

---

## Step 2 — Notification Management (Admin)

`/admin/notifications`. Any bishopric member.

Lists every trigger from `notification_settings` with its current configuration:

| Column | Editable |
|---|---|
| Trigger key and human description | No |
| Default recipient roles | Yes |
| Globally enabled | Yes — toggle |

| Route | Method | Auth |
|---|---|---|
| `/api/notification-settings` | GET | Bishopric |
| `/api/notification-settings/[trigger]` | PATCH | Bishopric — toggle or set roles |

Group the ~20 triggers by module in the UI, and write a plain-English description for
each — "plan_submitted" means nothing to a bishop. Store the descriptions in the seed data.

Changing a setting notifies the other two bishopric members and writes an audit row.

---

## Step 3 — User-Level Opt-Out

Every user can opt themselves out of any individual notification, from
`/settings/notifications`.

- Opt-out is **personal**. It never affects another user with the same role
- Any bishopric member can re-enable a user's subscription from the admin user page
- Writes to `notification_user_prefs`

`PATCH /api/notification-prefs/[trigger]` — the same route the agenda email unsubscribe
link hits (Phase 9).

Show users what each notification means before asking them to decide about it. The same
descriptions from Step 2.

---

## Step 4 — Admin Pages

`/admin` — hub. All admin capability is shared equally by bishop and both counselors.

**Every admin change notifies the other two** with a description of what changed and who
changed it. Use `notifyOtherBishopric()` from Phase 0. This is a product requirement, not
a nicety — it is how shared authority stays trustworthy.

| Page | Contents |
|---|---|
| `/admin/ward-settings` | Ward name, meeting times, template image, program layout, conducting rotation order, organization list, meeting frequencies, agenda email send time, cross-org visibility, sacrament deadline, ward timezone |
| `/admin/users` | All users with role and org; generate invites; deactivate; change roles; re-enable notification subscriptions; youth account creation and PIN reset |
| `/admin/roles` | Visual role × module access matrix, editable in-app |
| `/admin/notifications` | Step 2 |
| `/admin/audit-log` | Step 6 |
| `/admin/leadership-contacts` | Names and callings for the program panel |
| `/admin/missionaries` | Names and addresses for the program back panel |

**Ward settings is a large `jsonb` blob.** Validate it with a Zod schema on every write and
version the schema, or a typo silently breaks the program builder or a cron job. Never
`PATCH` the whole object from the client — accept a partial and merge server-side.

**Role access matrix.** The permission matrix from Phase 0 lives in code as the default and
in `wards.settings.role_access` as the ward's override. This page edits the override. Two
guards:

- Never allow a change that removes the last bishopric member's admin access
- Warn clearly that changes take effect on the user's next sign-in (JWT claims)

**Leadership contacts** — when a contact changes, prompt: "Leadership contacts in the
sacrament program may be affected. Update the program template now?" Confirm or dismiss;
never propagate silently (FEATURES.md §Module 15).

**The default speaker count already exists — reuse it, do not rebuild it.** Phase 3 shipped
`wards.settings.default_speaking_slots`, read by `lib/calendar/wardCalendarSettings.ts` and written
through `PATCH /api/ward-settings/calendar` under `admin.manage_ward`. `calendar-b` puts a control
on `/calendar` (`app/(app)/calendar/CalendarSettingsPanel.tsx`); `/admin/ward-settings` renders the
same setting through the **same route**. Do not add a second write path, and do not duplicate the
forward-only rule — the route already returns the sentence that states it, and both surfaces render
that sentence verbatim.

`apply_fast_sunday()` (migration 023) reads the same key in SQL, so a second writer that skipped
the route would put the TypeScript and plpgsql halves out of step.

**"May manage my own organization's data" already has a shape — follow it, do not invent a
second one.** `plans/retros/roster-b-picker-and-orgs.md` recorded that no permission expressed
this and handed the decision to this phase. `calendar-c` answered it for the calendar
(Decision 5) and the answer is now the established pattern:

1. A **narrow permission** naming the capability — `calendar.manage_org_conducting` — granted to
   `bishop`, `counselor`, `org_president` and `org_counselor`, and deliberately **not** to
   `org_secretary`. Never widen an existing ward-wide permission to reach an org case; widening
   `calendar.manage` would have handed an Elders Quorum president the whole sacrament calendar.
2. **RLS as the boundary**, with the predicate
   `ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())`
   (migration 024, Parts 5 and 6). Where a NULL `org_id` means something other than "no
   organization", the org branch must also require `org_id is not null` — otherwise every user
   whose own `org_id` is NULL matches it.
3. **A pure scope function as the second boundary** — `lib/calendar/orgRotationScope.ts` —
   importing types only, so a client component can render the right panels without dragging
   `next/headers` into the browser bundle. It returns the manageable ids; the route checks the
   permission **and** membership of that list, never either alone.

The roster gap `roster-b` deferred should be closed with this same three-part shape rather than a
second mechanism. `tests/rls/org-conducting.test.ts` is the suite to copy for proving it.

---

## Step 5 — Audit Log Viewer

`/admin/audit-log`. Visible to all three bishopric members. **Read-only** — no edit, no
delete, no exceptions. There is no route that mutates `audit_log`.

Filters: user, date range, module. Columns: timestamp, user, action, module, detail.

`GET /api/admin/audit-log` — paginated, filterable. Keyset pagination on
`(created_at, id)` rather than `OFFSET`; this table grows without bound and offset
pagination degrades badly.

Render `detail` (jsonb) readably — a formatted key/value list, not raw JSON.

Login and logout events are included (written in Phase 1).

> The audit log will become the largest table in the database. The
> `(ward_id, created_at DESC)` index from Phase 0 is required, not optional. Consider a
> retention policy before it becomes a problem — but do not delete rows without an
> explicit decision from the user.

---

## Step 6 — Role-Based Dashboards

`/dashboard` routes by role. Each is an aggregation over modules already built.

**Bishop / Counselor**
- Talk pipeline status this month, counts by stage
- Pending approvals requiring their action
- Visit progress summary across orgs (if cross-org enabled)
- Uncovered youth home events this week
- Flagged ward council items
- Away event awareness digest
- Goals nearing due date

**Ward Secretary**
- Upcoming Sundays needing program attention
- Approved messages ready to send
- Pending program approvals
- Next agenda due date and status
- Notifications

**Executive Secretary**
- Upcoming meetings and agenda status
- Flagged ward council items queue
- Action items from the last meeting

**Music Coordinator**
- Upcoming Sundays with missing hymn selections
- AI hymn suggestions ready for review
- Confirmed selections for next Sunday

**Org President / Counselor**
- Their org's visit progress
- Households overdue for a visit
- Return & report feed unread count
- Flagged items from their org
- Youth activity dashboard (YM/YW only)

**Org Secretary**
- Their org's scheduling tasks
- Visit log summary

**Ward Council Member**
- Youth activity calendar for their org
- Uncovered home events needing attention
- Post-activity follow-up prompts

**Youth (sacrament manager)** — no dashboard. Sign-in goes straight to `/sacrament`.

**Performance matters here.** A bishop's dashboard touches seven modules. Fetch the
widgets in parallel, not sequentially. Each widget is a Server Component with its own
suspense boundary so a slow one does not block the page. Cap every widget's query with a
`LIMIT` — a dashboard is a summary, not a report.

---

## Tests

| Test | Asserts |
|---|---|
| `notification-optout.test.ts` | A user's opt-out suppresses their notification and no one else's |
| `notification-global-toggle.test.ts` | A globally disabled trigger emits nothing |
| `notification-realtime.test.ts` | An insert for user A does not reach user B's subscription |
| `admin-shared-authority.test.ts` | Bishop and both counselors resolve identically for every admin permission |
| `admin-notifies-others.test.ts` | Every admin mutation notifies the other two bishopric members |
| `audit-immutable.test.ts` | No route can update or delete an audit row; RLS blocks it |
| `audit-pagination.test.ts` | Keyset pagination returns stable results across pages |
| `ward-settings-validation.test.ts` | A malformed settings patch is rejected, not merged |
| `dashboard-scoping.test.ts` | Each role's dashboard queries only data that role may see |

---

## Definition of Done

- [ ] Notification bell with live unread count, reconnect handling, and a poll fallback
- [ ] Notification feed and full page; tap marks read and navigates correctly
- [ ] Admin notification management with plain-English trigger descriptions
- [ ] Personal opt-out; bishopric re-enable; agenda unsubscribe uses the same route
- [ ] All seven admin pages built; every change notifies the other two bishopric members
- [ ] Ward settings validated with Zod; partial updates merged server-side
- [ ] Role access matrix editable, with lockout protection and a re-login warning
- [ ] Audit log viewer with filters and keyset pagination; provably immutable
- [ ] All seven dashboards, loading in parallel with suspense boundaries
- [ ] All nine tests pass

---

## Pitfalls

- **Realtime connection drift.** Unsubscribe on unmount, reconnect on focus, poll as a
  fallback. A silently dead socket looks like "no notifications".
- **Sequential dashboard queries.** Seven awaits in a row makes the bishop's home screen
  slow. Parallelize with per-widget suspense.
- **Offset pagination on the audit log.** It degrades as the table grows. Keyset.
- **A mutable audit log.** There must be no update or delete path. Enforce in RLS, and
  test that it is enforced.
- **Whole-object settings PATCH.** A client sending a stale full object silently reverts
  someone else's change. Accept partials, merge server-side.
- **Trigger keys shown to users.** "assignment_declined" is not a sentence. Ship
  descriptions.
- **Dashboards leaking cross-role data.** A widget written for the bishop's dashboard and
  reused on the org president's may query more than that role can see. RLS should stop it,
  but test each dashboard's scoping explicitly.
- **Role-matrix lockout.** Guard against removing the last admin. It is unrecoverable
  without direct database access.
