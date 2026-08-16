# Phase 9 — Meeting Agendas & Tithing Calculator

Two unrelated modules grouped because both are small, self-contained, and depend only on
auth. Build them in either order.

**Depends on:** Phase 1. Agenda flagged-items integration wants Phases 7–8, but degrades
gracefully without them. **Unlocks:** Milestone M6.
**Reference:** [FEATURES.md](../FEATURES.md) §Modules 12, 13; [SPEC.md](../SPEC.md) §Agenda PDF & Email, §Tithing Auto-Clear.

---

# Part A — Meeting Agenda Builder

## Goals

1. Bishopric and ward council agendas from configurable templates
2. Flagged items from visits and youth activities auto-populate
3. Action items carry forward until marked complete
4. Publish generates a PDF and schedules an email

## Step A1 — Templates & Structure

Two meeting types: `bishopric` (weekly, configurable) and `ward_council` (every other week,
configurable). Frequency lives in ward settings.

`agendas.sections` is a `jsonb` ordered array of `{ title, items[], carry_forward }`.
Standing sections, configurable per meeting type:

| Section | Populated by |
|---|---|
| Opening / Prayer | Template |
| Approval of previous minutes | Template |
| **Flagged ward council items** | **Auto** — from visit and activity flags |
| Org reports | Secretary |
| **Action items** | **Auto** — carried forward from the previous meeting |
| New business | Secretary |
| Closing / Prayer | Template |

Validate the `sections` shape with Zod on every write. A malformed blob breaks the PDF
renderer and is hard to diagnose after the fact.

## Step A2 — Flagged Items

Visit and activity flags (Phases 7–8) emit notifications to the executive secretary. On
agenda creation, query unresolved flags and pre-populate the section:

```
[Org] — [Family Name] — requested for ward council discussion
```

**One-liners only.** Never pull shared notes, let alone private ones, into the agenda.
The agenda goes to a PDF that gets emailed — anything in it leaves the app.

The executive secretary can remove an auto-populated item. Mark the source flag resolved
when the agenda is published so it does not reappear next time.

If Phases 7–8 are not built yet, the section renders empty. Do not block on them.

## Step A3 — Action Items

`action_items` rows attach to an agenda. Open items carry forward to the next agenda of
the same meeting type via `carried_from_agenda_id`.

- Carry forward happens on agenda **creation**, copying open items from the most recent
  published agenda of that type
- Marking complete sets `completed_at` and stops the carry
- Show the origin: "carried from Nov 12"

Carry-forward is a copy, not a move, so each agenda remains an accurate record of what was
discussed that day.

## Step A4 — Publishing & Email

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/agendas` | GET | Bishopric, secretaries | List |
| `/api/agendas` | POST | Secretary + bishopric | Create with carry-forward and flagged items |
| `/api/agendas/[id]` | PATCH | Secretary + bishopric | Update sections and items |
| `/api/agendas/[id]/publish` | POST | Secretary + bishopric | Render PDF, schedule email |

**Bishopric can build and publish without the secretary** — never gate on the secretary role.

Publishing:

1. Render the PDF (`lib/pdf/AgendaDocument.tsx` — simple, single-page, nothing like the
   bifold program)
2. Store in Supabase Storage
3. Set `status = 'published'`, `published_at`, `published_by`
4. Emit `agenda_published`
5. Queue the email for the configured send time

**Scheduled send.** A Supabase Edge Function on cron checks for published agendas whose
send time has arrived (`wards.settings.agenda_email_send_time`, the day/night before the
meeting) and sends via Resend. Emit `agenda_email_distributed` after sending.

Mark the agenda as sent so a cron re-run does not double-send. This is the classic cron
bug — make the send idempotent with a `email_sent_at` column.

**Subscriptions.** Everyone is opted in by default. Every email carries an unsubscribe link
hitting `PATCH /api/notification-prefs/agenda_email`, which sets a
`notification_user_prefs` row to disabled. Any bishopric member can re-enable it. Recipients
can always read the agenda in-app regardless of email preference.

---

# Part B — Tithing Calculator

## Goals

A counting worksheet for tithing settlement sessions. **Not a record-keeping tool** —
official records live in the Church's system. Session-based, auto-cleared at midnight.

## Step B1 — Absolute Constraints

These are not preferences:

1. **Bishopric only.** RLS restricts `tithing_sessions` and `tithing_entries` to
   `bishop` and `counselor`.
2. **No personal information. Ever.** No names, no member IDs, no FK to `members`, no
   free-text notes that could hold a name. The entry number written on a paper slip is
   the only link, and it lives on paper.
3. **Auto-clear at midnight.** A cron Edge Function deletes prior-day sessions and entries.
4. **No export, no reporting, no history view.** If someone asks for a monthly total
   across sessions, the answer is no — that is what MLS is for.

Enforce #2 structurally: the tables have no text columns beyond check numbers. Do not add
one.

## Step B2 — Session Flow

Per FEATURES.md: one person enters all submissions; a second verifies the summary totals.

- `GET /api/tithing/session` gets or creates today's session
- Each envelope is one entry with an auto-incremented `entry_number` scoped to the session
- The entry number is written on the paper slip for traceability

Increment `entry_number` inside the insert transaction (`SELECT max(...) + 1` with the
session row locked, or a per-session sequence). Two counters entering simultaneously must
not collide.

## Step B3 — Entry Form

Three sections, live subtotals, grand total at the bottom:

| Section | Input |
|---|---|
| **Checks** | Repeating rows: check number + amount. Add-row button |
| **Bills** | Quantity per denomination: 100, 50, 20, 10, 5, 2, 1 |
| **Coins** | Quantity per denomination: dollar, half, quarter, dime, nickel, penny |

**Use integer cents everywhere.** Never floating point for money — `0.1 + 0.2` problems in
a tithing count are unacceptable. Store amounts as integers, format for display only.

`lib/tithing/totals.ts` — pure functions for entry subtotals and session summary. These
are trivially testable and must be exactly right.

**This is a phone-in-hand, counting-cash interface.** Large tap targets, numeric keyboards,
no accidental navigation away, clearly visible running totals. Quantity steppers beat
free-text number entry for denominations.

## Step B4 — Summary & Controls

Session summary: count of every denomination, check total, cash total, coin total,
grand total.

Controls:

| Control | Confirmation |
|---|---|
| Save Entry | — |
| Edit Entry | — |
| Delete Entry | Confirm |
| Clear Current Entry | Confirm |
| Clear All Entries | Confirm **with a warning** — this is destructive and mid-count |

`DELETE /api/tithing/session` clears all entries.

## Step B5 — Auto-Clear

Supabase Edge Function on cron at midnight (see SPEC.md §Tithing Auto-Clear):

```sql
DELETE FROM tithing_entries WHERE session_id IN (
  SELECT id FROM tithing_sessions WHERE session_date < CURRENT_DATE
);
DELETE FROM tithing_sessions WHERE session_date < CURRENT_DATE;
```

**Run it in the ward's timezone, not UTC.** A UTC-midnight job wipes an in-progress
Sunday-evening count in the Americas. Read the ward timezone from settings and schedule
accordingly, or guard the delete on local date.

---

## Tests

| Test | Asserts |
|---|---|
| `tithing-totals.test.ts` | Every denomination combination totals exactly, in integer cents |
| `tithing-no-float.test.ts` | No floating-point arithmetic in the money path |
| `tithing-access.test.ts` | Secretary, org president, and youth accounts are refused |
| `tithing-entry-numbers.test.ts` | Concurrent inserts get distinct sequential numbers |
| `tithing-autoclear.test.ts` | Prior-day data deleted; today's untouched; runs on ward-local date |
| `agenda-carry-forward.test.ts` | Open items carry; completed do not; the origin agenda is recorded |
| `agenda-flagged-items.test.ts` | Flags populate as one-liners; no note text is included |
| `agenda-email-idempotent.test.ts` | A cron re-run does not double-send |
| `agenda-unsubscribe.test.ts` | Unsubscribe stops email but not in-app access; bishopric can re-enable |

---

## Definition of Done

**Agendas**

- [ ] Both meeting types with configurable standing sections
- [ ] Flagged items auto-populate as one-liners with no note text
- [ ] Action items carry forward with visible origin
- [ ] Publish renders and stores a PDF, emits notifications
- [ ] Scheduled email sends once, at the configured time, and is idempotent
- [ ] Unsubscribe works; bishopric can re-enable; in-app access is unaffected
- [ ] Bishopric can complete the whole flow without the secretary

**Tithing**

- [ ] Bishopric-only, verified by test
- [ ] No personal information stored anywhere
- [ ] Integer-cent arithmetic throughout; totals exactly correct
- [ ] Entry numbers sequential and collision-free
- [ ] All controls present with appropriate confirmations
- [ ] Auto-clear runs on ward-local midnight and does not wipe an in-progress session
- [ ] Usable one-handed on a phone while counting cash

---

## Pitfalls

- **Floating-point money.** Integer cents, always. This is a tithing count.
- **UTC midnight auto-clear.** It will delete a session mid-count. Use ward-local time.
- **Double-sending agenda emails.** Guard with `email_sent_at`; a cron retry must be safe.
- **Note text in agenda items.** Agendas become emailed PDFs. One-liners only, from both
  the visit and youth flag sources.
- **Gating publish on the secretary role.** The bishopric must be able to do it alone —
  this is explicit in FEATURES.md and comes up in practice.
- **Adding a name field to tithing "just for convenience".** The absence of personal data
  is the design. Refuse the request and explain why.
- **Entry-number races.** Two counters, one session. Lock or use a sequence.
