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
official records live in the Church's system. One shared worksheet per ward, persisted so a
count survives a refresh, and cleared 48 hours after its first entry (revised 2026-08-25 —
see Step B0).

## Step B0 — BUILT 2026-08-24 as an in-memory worksheet; REVISED 2026-08-25 to persist

The tithing calculator shipped early, as `/tithing`, before Phase 9 was started. **Read this
whole step before Steps B2 and B5 — both were skipped on 2026-08-24 and are back in scope.**

### What was built (commit `ae2ff1d`)

The module writes NOTHING. No database row, no localStorage, no sessionStorage, no server request
of any kind. A counting session lives in React state for as long as the tab is open and is gone
the moment it is not. **Steps B1, B3 and B4 apply in full and are built:** bishopric-only, no
personal information, integer cents throughout, three input sections with live subtotals, and
every control with its confirmation.

**Access is enforced in `app/(tithing)/layout.tsx`, not in middleware**, via
`can(user, "tithing.view", roleAccess)`. `middleware.ts` holds no role checks by design (edge
runtime, no cheap database access), and comparing role strings directly would go around the ward
`role_access` override that `plans/retros/role-access-overrides.md` exists to protect. **None of
this changes.** Persistence changes where entries live, not who may reach them.

**Files as built:** `lib/tithing/{denominations,money,totals}.ts` (pure, integer cents) ·
`app/(tithing)/layout.tsx` · `app/(tithing)/tithing/*` ·
`tests/lib/tithing{Money,Totals,NoFloat}.test.ts` · `tests/components/tithing/TithingCounter.test.tsx`.

### The decision that reverses

The in-memory design named its own cost: "a refresh, a phone sleeping and reloading its tab, or a
stray back-swipe destroys an in-progress count with nothing to recover from", and said that if a
real count were ever lost, this was the decision to revisit — with persistence behind the
migration 011 tables, never in browser storage.

**DECIDED 2026-08-25: it is revisited. Entries persist.** Not because a count was lost, but
because losing one is unacceptable and the only thing standing between a user and that loss was a
`beforeunload` prompt. The shape:

1. **Server-side only.** `tithing_sessions` and `tithing_entries` in migration 011, which already
   carry their RLS policies and `tests/rls/tithing-access.test.ts`. **Never browser storage** —
   that would put dollar amounts on a shared or borrowed phone, which is why it was refused
   before and is still why.
2. **One shared worksheet per ward, not per user.** Any bishopric member opening `/tithing` sees
   the same in-progress count. There is no per-user session and no ownership. The flow FEATURES.md
   describes — one person enters all submissions, a second verifies the totals — becomes possible
   on two phones for the first time.
3. **It survives a refresh, a logout, a different device, and a different person.**
4. **It clears exactly two ways:** the manual "Clear All Entries" control that already exists, or
   automatically **48 hours after the first entry was saved**.

### The 48-hour window, precisely

The clock starts when the **first** entry of a worksheet is saved, and is **not** reset by later
entries. A worksheet still being added to at hour 47 expires at hour 48 along with everything in
it. This is deliberate: a resetting window can be kept alive indefinitely, and an indefinitely
alive counting worksheet is the permanent record this module exists in order not to be.

48 hours is a **fixed constant**, not a ward setting. Every knob here is a way for the retention
promise to be weakened by accident, and no ward's settlement session needs longer.

**The ward-local-midnight trap is gone — not deferred, gone.** An elapsed-time window measured
from a `timestamptz` involves no local date and no timezone at all, so the UTC-midnight job that
would have wiped an in-progress Sunday-evening count cannot be written by mistake. §Pitfalls is
updated to match.

`tithing_sessions.auto_clear_at` already exists in migration 011 and **changes meaning**: it was
"midnight of `session_date`, ward-local" and becomes **the first entry's `created_at` plus 48
hours**. Its column comment states the old meaning and must be corrected in the same migration
that adds the constraint in Step B2.

### What this un-skips, and what it costs

- **Step B2 (session flow) applies again.** There is a `tithing_sessions` row, there is a
  `GET /api/tithing/session`, and the entry-number race is real once more.
- **Step B5 (auto-clear) applies again**, as an elapsed-time sweep rather than a midnight one.
- **The `beforeunload` guard becomes a lie and must be removed.** It currently warns that leaving
  destroys the count. Once entries persist, leaving costs nothing — and a warning that is not
  true teaches people to dismiss the warnings that are. Remove it and the confirm on the one link
  out. `TithingCounter.test.tsx` asserts both today and changes in the same commit.
- **`session_date` stops being the identity of a worksheet.** It was the natural key of a
  cleared-at-midnight design. A 48-hour worksheet can span two dates; do not filter or dedupe on
  it. The column stays for display, not for lookup.

---

## Step B1 — Absolute Constraints

These are not preferences:

1. **Bishopric only.** RLS restricts `tithing_sessions` and `tithing_entries` to
   `bishop` and `counselor`. — BUILT and tested
2. **No personal information. Ever.** No names, no member IDs, no FK to `members`, no
   free-text notes that could hold a name. The entry number written on a paper slip is
   the only link, and it lives on paper. — BUILT
3. **Auto-clear 48 hours after the first entry.** Revised 2026-08-25 from "at midnight" — see
   Step B0. A scheduled job deletes expired sessions and their entries; the read path refuses to
   show them regardless.
4. **No export, no reporting, no history view.** If someone asks for a monthly total
   across sessions, the answer is no — that is what MLS is for. **Persistence does not soften
   this.** A stored worksheet is still not a record, and the 48-hour window is what keeps that
   distinction true rather than merely stated.

Enforce #2 structurally: the tables have no text columns beyond check numbers. Do not add
one.

## Step B2 — Session Flow — shared, persisted, live-synced

Per FEATURES.md: one person enters all submissions; a second verifies the summary totals. With a
shared worksheet that is now literally two people on two phones.

- `GET /api/tithing/session` returns the ward's active worksheet, creating one if none exists
- Each envelope is one entry with an auto-incremented `entry_number` scoped to the session
- The entry number is written on the paper slip for traceability

**One active worksheet per ward is a constraint, not a convention.** Nothing in migration 011
prevents two active sessions from existing, and two would split one count in half silently. Add a
partial unique index on `ward_id` over unexpired sessions, so `get or create` is safe to call from
two phones in the same second and the second call loses.

**Increment `entry_number` inside the insert transaction** — `SELECT max(...) + 1` with the
session row locked, or a per-session sequence. Two counters saving simultaneously must not be
handed the same number: it goes on a paper slip, so a collision is not a cosmetic bug.

**Entries sync live via Supabase Realtime.** The publication already exists (migration 026), and
`plans/retros/route-tests-and-realtime.md` records exactly what went wrong the first time: a
shared channel topic leaked between wards, and a timeout-based privacy test passed while realtime
was dead. Read that retro before adding `tithing_entries` to the publication, and gate the
addition on a cross-ward leak test the way migration 026 was gated.

**The read path must not trust the sweep.** Filter the worksheet read on
`auto_clear_at IS NULL OR auto_clear_at > now()`, so an expired worksheet reads as empty even if
the Step B5 job is late or has failed. The sweep reclaims the rows; **the filter is what keeps the
48-hour promise.** Do not build one without the other.

## Step B3 — Entry Form — BUILT

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

**What persistence changes here:** nothing about the form itself. Saving an entry becomes a
request instead of a `setState`, so the form needs a pending state and a real failure path — a
save that quietly does nothing while the counter moves on to the next envelope is the worst
outcome this module has.

## Step B4 — Summary & Controls — BUILT

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

**What persistence changes here:** "Clear All Entries" stops being a local reset and becomes a
destructive write that discards someone else's work too — its warning should say so. And the
leave-the-page guard comes **off**, per Step B0.

## Step B5 — Auto-Clear at 48 Hours

A scheduled job — `pg_cron`, or a Supabase Edge Function on a schedule (see SPEC.md §Tithing
Auto-Clear) — running often enough that expired rows do not linger. Hourly is ample.

```sql
-- Entries cascade from the session via migration 011's FK, so one delete is enough.
DELETE FROM tithing_sessions
WHERE (auto_clear_at IS NOT NULL AND auto_clear_at <= now())
   OR (auto_clear_at IS NULL AND created_at <= now() - interval '48 hours');
```

**No timezone reasoning is involved, and that is the entire point.** `auto_clear_at` is a
`timestamptz` set to the first entry's `created_at` plus 48 hours; comparing it to `now()` is
correct in every ward on earth. Do not reintroduce `CURRENT_DATE`, `session_date`, or a ward
timezone lookup here — the previous version of this step did, and that was the bug it warned
about.

`auto_clear_at` is set **when the first entry is saved**, not when the session row is created, and
is never updated afterwards. A session with no entries has no window to start, so it stays `NULL`
and the second arm of the delete above collects it on age instead — otherwise an abandoned empty
worksheet holds the Step B2 unique index forever and nobody can start a count.

---

## Tests

| Test | Asserts |
|---|---|
| `tithingTotals.test.ts` | Every denomination combination totals exactly, in integer cents — BUILT |
| `tithingMoney.test.ts` | The fixed-decimal amount field parses and formats exactly — BUILT |
| `tithingNoFloat.test.ts` | No floating-point arithmetic in the money path, asserted by reading the source — BUILT |
| `TithingCounter.test.tsx` | Save, edit, delete, clear — BUILT, but its leave-the-page-guard assertions come OUT when the guard does (Step B0) |
| `tithing-access.test.ts` | Secretary, org president, and youth accounts are refused — already existed |
| `tithing-entry-numbers.test.ts` | Two concurrent saves get two different numbers. Back in scope — see Step B0 |
| `tithing-autoclear.test.ts` | A worksheet expires 48h after its FIRST entry and not before; later entries do not extend it; an empty session is collected on age |
| `tithing-expired-read.test.ts` | An expired worksheet reads as empty even when the sweep has not run — the promise must not depend on the cron |
| `tithing-shared-session.test.ts` | Two bishopric members reach the SAME worksheet; a concurrent get-or-create yields one session, not two |
| `tithing-realtime-isolation.test.ts` | Ward B never receives ward A's entry events — gates adding `tithing_entries` to the publication |
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

- [x] Bishopric-only, verified by test
- [x] Integer-cent arithmetic throughout; totals exactly correct
- [x] All controls present with appropriate confirmations
- [ ] No personal information stored anywhere — re-verify once rows are written; the columns
      allow none, and no migration in this phase may add one
- [ ] A count survives a refresh, a logout, and a move to another device
- [ ] Two bishopric members see one shared worksheet, and each other's entries, live
- [ ] Entry numbers sequential and collision-free under two concurrent saves
- [ ] Auto-clear fires 48h after the first entry, is not extended by later ones, and needs no
      timezone lookup to be correct
- [ ] An expired worksheet reads as empty even if the sweep has not run
- [ ] The `beforeunload` guard and its link-out confirm are GONE, along with their assertions
- [ ] Usable one-handed on a phone while counting cash — **needs a walk on a real phone**

---

## Pitfalls

- **Floating-point money.** Integer cents, always. This is a tithing count.
- **~~UTC midnight auto-clear.~~** Dissolved 2026-08-25: the window is 48 hours of elapsed
  `timestamptz`, so no local date and no ward timezone enter the comparison at all. The
  pitfall now is the opposite one — **reintroducing** `session_date` or `CURRENT_DATE` into the
  sweep and bringing the trap back with it (Step B5).
- **Trusting the cron to keep the retention promise.** If the sweep is late or dead, expired
  entries are still in the table. The read filter is what makes 48 hours true; ship both.
- **Browser storage as a shortcut to persistence.** Refused twice now. A counting worksheet on
  a shared or borrowed phone is dollar amounts left on someone else's device.
- **A `beforeunload` warning that is no longer true.** Once entries persist, it teaches people
  to dismiss the warnings that still matter.
- **Double-sending agenda emails.** Guard with `email_sent_at`; a cron retry must be safe.
- **Note text in agenda items.** Agendas become emailed PDFs. One-liners only, from both
  the visit and youth flag sources.
- **Gating publish on the secretary role.** The bishopric must be able to do it alone —
  this is explicit in FEATURES.md and comes up in practice.
- **Adding a name field to tithing "just for convenience".** The absence of personal data
  is the design. Refuse the request and explain why.
- **Entry-number races.** Two counters, one session. Lock or use a sequence.
