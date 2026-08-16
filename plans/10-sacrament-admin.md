# Phase 10 — Sacrament Administration

Monthly ordinance assignments — bread blessing, water blessing, setup and takedown, bread
provider — managed by a designated youth, with bishopric oversight and a public link.

**Depends on:** Phase 3 (calendar) and Phase 1 (youth PIN accounts).
Independent of Phases 4–9.
**Reference:** [FEATURES.md](../FEATURES.md) §Module 17; [SPEC.md](../SPEC.md) §API Routes → Sacrament Administration.

> The Young Men presidency is fulfilled by the bishopric in this ward. There is no YM
> organization. Rotation pools draw from youth members by category and gender, not from
> an org.

> **The primary user is a teenager on a phone.** Their entire experience is one screen:
> see the month, adjust a few names, tap send, tap "sent". Every design decision in the
> manager view should reduce steps.

---

## Goals

1. Bishopric configures rotation pools and order per assignment type
2. A month of assignments auto-generates from the pools
3. The designated youth manager reviews, adjusts, and sends via SMS
4. A public link always shows current assignments
5. A deadline reminder alerts bishopric if the message has not gone out

---

## Step 1 — Rotation Pools

`sacrament_rotation_pools` holds one row per assignment type, with `member_ids` as an
**ordered** array defining rotation order.

| Assignment type | Pool | Rule |
|---|---|---|
| `bread_blessing` | Priests | Always a different priest than water blessing |
| `water_blessing` | Priests | Always a different priest than bread blessing |
| `setup_takedown` | Teachers (configurable) | Assigned as a **pair** |
| `bread_provider` | Configurable youth pool | Rotated separately |

Bishopric builds each pool by filtering the youth roster and selecting members. Order can
be alphabetical, by age, or manually dragged.

| Route | Method | Auth |
|---|---|---|
| `/api/sacrament/pools` | GET | Bishopric |
| `/api/sacrament/pools/[type]` | PATCH | Bishopric — update members and order |

`components/sacrament/RotationPoolEditor.tsx` — filter the roster, select, reorder.
Use `MemberPicker` with `filter: { category: 'youth', gender: 'male' }` for the priest
and teacher pools; the bread provider pool is unfiltered youth.

The pool is an ordered array of member IDs, so a member who moves out leaves a dangling
ID. Filter against active members at generation time rather than assuming the array is
clean, and surface stale entries in the editor.

---

## Step 2 — Auto-Generation

`lib/sacrament/generateMonth.ts` — pure function. Given the pools, the month's Sundays,
and the last assignment of the previous month, produce a full month.

```ts
export function generateMonth(
  sundays: Sunday[], pools: RotationPools, lastAssigned: LastAssignedIndex
): SacramentAssignment[]
```

Rules:

- Walk each pool in order, continuing from where the previous month left off
- **Bread and water blessers must differ on the same Sunday.** If the rotation would
  collide, advance the water pointer one step
- `setup_takedown` assigns a pair — two consecutive pool members
- Skip Sundays where `type` is `stake_conference`, `general_conference`, or `holiday`
- Exclude members whose roster status is not `active`

`POST /api/sacrament/generate` runs it for a month. Re-running **must not clobber
overrides** — preserve any assignment with `is_override = true` and regenerate the rest.

This is a pure function with fiddly rules. Test it before building any UI.

---

## Step 3 — Assignment Manager Designation

One youth is the active manager at a time (`sacrament_assignment_managers`, with the
partial unique index from Phase 0 enforcing one active per ward).

- Bishop or counselor designates and can rotate the role at any time
- Designation is open-ended — it persists until manually changed
- Changing it deactivates the previous manager in the same transaction
- Emits `sacrament_manager_changed`

| Route | Method | Auth |
|---|---|---|
| `/api/sacrament/manager` | GET | Bishopric |
| `/api/sacrament/manager` | PATCH | Bishopric — set the active manager |

Bishopric can see who the active manager is and when they last signed in. Surface
last-login on the admin page — it is how they notice a manager who has gone quiet.

---

## Step 4 — Manager View

`/sacrament` — the youth manager's single screen, and the whole product for them.

Shows the current month as a grid: Sundays down, four assignment types across. At 375px
this becomes a stack of Sunday cards, each listing its four assignments.

Actions:

1. **Swap** — tap a name, pick another from the pool
2. **Override** — insert someone outside the rotation for one Sunday, with a reason.
   Sets `is_override = true` so regeneration preserves it. FEATURES.md's example is a
   newly baptized adult given an opportunity to bless — the override pool is therefore
   *not* restricted to the rotation pool
3. **Send message** — opens SMS with the youth group and a pre-filled body including the
   public assignments link
4. **Mark as sent** — logs to `sacrament_send_log`, emits `sacrament_assignments_sent`
   to bishopric: "Sacrament assignments message sent by [Name]"

| Route | Method | Auth |
|---|---|---|
| `/api/sacrament/assignments` | GET | Bishopric + active manager + (public via view) |
| `/api/sacrament/assignments/[id]` | PATCH | Bishopric + active manager |
| `/api/sacrament/send-log` | POST | Active manager |
| `/api/sacrament/send-log` | GET | Bishopric |

**Manager permissions are narrow:** read and update assignments, write the send log.
They cannot touch pools, cannot generate a month, cannot reach any other module. RLS
enforces this — Phase 0 wrote the policy; verify it here.

The SMS body should be short. Long bodies get truncated by the SMS app, and the public
link makes the detail unnecessary:

> Sacrament assignments for March are up: {link}

Include a copy-to-clipboard fallback, same as Phase 4.

---

## Step 5 — Deadline Reminder

Bishopric configures a send-by deadline in ward settings — e.g. "by Thursday, two weeks
before the first Sunday".

A scheduled Edge Function checks whether a `sacrament_send_log` row exists for the coming
month. If the deadline has passed with no confirmation, emit
`sacrament_assignments_overdue` to bishopric:

> Sacrament assignments have not been sent yet — follow up with [Manager Name]

**Emit once**, not daily. Track with a flag or check whether the notification already
exists for this month.

---

## Step 6 — Public Assignments Page

`/public/[slug]` with `page_type = 'sacrament_assignments'`. Uses the shell built in
Phase 6.

- Persistent URL per ward, no login
- **Always shows current assignments** — an edit in the app is reflected immediately.
  This is the feature's whole purpose: it eliminates the confusion of multiple texted
  versions. Set a short cache TTL and revalidate on write
- When assignments change, the manager sends a new text noting what changed; recipients
  tapping any link they have, old or new, see the latest

**Privacy.** Reads through the `public_sacrament_assignments` view from Phase 0. Exposes
first name and last initial only — never full names, phone numbers, or member IDs. These
are minors; the projection matters more here than anywhere else in the app.

Same clean mobile design as the public program page.

---

## Step 7 — Bishopric Oversight

`/sacrament/admin`:

- Configure rotation pools and order
- Generate or regenerate a month
- View all current and past assignments
- See the active manager and their last sign-in
- Edit any assignment directly, overriding the manager's view
- Configure the send-by deadline

Bishopric edits do not require approval. They are direct, and they are audited.

---

## Tests

| Test | Asserts |
|---|---|
| `generate-month.test.ts` | Rotation continues across month boundaries; bread ≠ water on every Sunday; pairs assigned for setup; conference and holiday Sundays skipped |
| `generate-preserves-overrides.test.ts` | Regeneration keeps `is_override` rows and rewrites the rest |
| `generate-inactive-members.test.ts` | Moved-out members in a pool are skipped, not assigned |
| `manager-permissions.test.ts` | The active manager can update assignments but not pools, cannot generate, and cannot reach any other module |
| `manager-inactive.test.ts` | A deactivated former manager can do nothing |
| `single-active-manager.test.ts` | Designating a new manager deactivates the previous one; two active managers are impossible |
| `public-minors-projection.test.ts` | The public view exposes first name + last initial only. **Highest priority** |
| `deadline-reminder.test.ts` | Fires once when the deadline passes with no send log; does not fire when one exists; does not repeat daily |

---

## Definition of Done

- [ ] Bishopric configures all four pools with member selection and ordering
- [ ] Month auto-generates with correct rotation and the bread ≠ water constraint
- [ ] Regeneration preserves overrides
- [ ] Manager designation works; exactly one active at a time; rotation notifies
- [ ] Manager view is genuinely usable on a phone: view, swap, override, send, confirm
- [ ] SMS handoff with a copy fallback
- [ ] Send confirmation notifies bishopric
- [ ] Deadline reminder fires once
- [ ] Public page always current, exposing first name + last initial only
- [ ] Bishopric can view, edit, and override everything
- [ ] All eight tests pass

---

## Pitfalls

- **Bread and water colliding.** The one hard constraint in the generator. Test it on
  every Sunday of a generated month, including the wrap-around at pool end.
- **Regeneration wiping overrides.** An override exists because someone made a deliberate
  pastoral decision. Losing it is worse than not regenerating at all.
- **Dangling member IDs in pools.** The array holds IDs, not references. Filter against
  active members at generation time.
- **Over-scoping the manager.** They are a teenager with a PIN. Any permission beyond
  read/update assignments and write send-log is a mistake. Verify with RLS tests, not
  just UI hiding.
- **Public page exposing minors' full names.** The most sensitive projection in the app.
  First name and last initial. Nothing else.
- **Long SMS bodies.** Truncated inconsistently across devices. Short message, public link.
- **Daily deadline nagging.** Once per month, when the deadline passes.
