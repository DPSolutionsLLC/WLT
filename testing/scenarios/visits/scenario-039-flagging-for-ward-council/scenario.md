---
name: Flagging for ward council
scope: visits-a-goals-logs-and-notes
part: 1
tags: [visits, full, notifications]
prerequisites: none
---

## Purpose

Flagging a visit is the one action on the Visits page that sends something to somebody who cannot
open the visit. The executive secretary holds **no `visits.view` permission** — that is deliberate,
and it is what makes "the notification carries the one-liner only" structurally true rather than a
rule to remember. So the contents of that notification is the entire interface between the two
people, and it has to be exactly right.

Two things here are invisible in the UI and are why this needs a seed rather than a unit test:

1. **`flag_sent_at` makes a re-flag idempotent.** Raising a visit that has already been raised
   must send nothing. Reaching that state from an empty database means flagging, unflagging and
   re-flagging first — the very sequence being tested. So the Halvorsen visit arrives already
   flagged with a timestamp on it.
2. **The body's emptiness.** `tests/routes/visits.test.ts` asserts the body equals the one-liner,
   but only a person can judge whether that one line is enough for the executive secretary to act
   on and still tells them nothing they should not know — and whether the confirm dialog warns
   the leader before they send it rather than after.

## Seed Data

Everything scenario 038 seeds, plus an executive secretary and a visit that arrives already
flagged. It repeats 038's fixture rather than chaining with `--no-clean`, so either scenario can
be walked on its own.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility` **off**, notification triggers seeded |
| Users | `bishop@`, **`exec-secretary@` (executive_secretary)**, `eq-president@`, `eq-secretary@`, `rs-president@` |
| Households | 6 — five active, Ferreira all moved out |
| Visit goals | 2 — one per organization |
| Visit logs | 5 — Brooks 2026-02-08 **unflagged, long shared note**; Whitfield 2026-02-15; Okonkwo 2026-03-01; **Halvorsen 2026-03-22 flagged with `flag_sent_at` = 2026-03-23T18:00Z**; Tuiasosopo 2026-03-08 (Relief Society) |
| Private notes | 1 — on the Brooks visit, authored by the EQ president, containing `PRIVATE-NOTE-CANARY-039` |

The Brooks shared note contains `SHARED-NOTE-CANARY-039` and the private note contains
`PRIVATE-NOTE-CANARY-039`. **Neither string may ever appear in a notification.**

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-039-flagging-for-ward-council`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **EQ president** and open **Visits**.
4. Press **Flag for ward council** on the **Brooks** visit. Read the confirm dialog before
   accepting it. Accept.
5. Look at the **Halvorsen** visit — the one that arrived already flagged. Note that its
   control reads **"Remove ward council flag"**, so the flag cannot be re-asserted from the UI.
   **Do not press it yet.** (See the correction note below: the idempotent re-flag is not
   reachable through the interface, and is covered by `tests/routes/visits.test.ts` instead.)
6. Read the notification **out of the database**, not out of the app — there is no notification
   bell UI yet (Phase 11 owns it; the 🔔 in the header is a static emoji):
   `select recipient_user_id, title, body from notifications where trigger_key =
   'visit_flagged_for_ward_council'`
7. Read that body word for word.
8. Sign out. Sign in as **`exec-secretary@`** and try to open **Visits**.
9. Confirm no notification row exists for the bishop's user id.
10. Sign back in as the EQ president. On the **Brooks** visit: **unflag** it, then **flag it
    again**.
11. Count the notification rows again.

## Verification Checklist

### Machine-checkable

- [ ] The Brooks visit shows no flag before step 4; the Halvorsen visit shows **Flagged for ward council** on arrival
- [ ] After step 4, `select flagged_for_ward_council, flag_sent_at from visit_logs where household_id = <Brooks>` shows `true` and a **non-null** timestamp
- [ ] After step 4, exactly **one** `notifications` row exists with `trigger_key = 'visit_flagged_for_ward_council'`, and its `recipient_user_id` is the **executive secretary**
- [ ] That notification's body is exactly `Elders Quorum — Brooks — requested for ward council discussion`
- [ ] The body contains **no** `SHARED-NOTE-CANARY-039`
- [ ] The body contains **no** `PRIVATE-NOTE-CANARY-039`
- [ ] **No notification row exists for the bishop's user id** — the trigger's recipients are the executive secretary alone (migration 045). Checked in the database, not the bell: there is no bell UI yet
- [ ] The Halvorsen visit's control reads **"Remove ward council flag"**, not "Flag for ward council" — an already-flagged visit offers no way to re-flag it
- [ ] `PATCH /api/visits/<Halvorsen> {"flaggedForWardCouncil": true}` creates **no** new notification and leaves `flag_sent_at` at `2026-03-23T18:00:00Z`. **This is an API-level check** — the UI cannot reach this state (see the correction note)
- [ ] After step 10's unflag, the Brooks visit's `flag_sent_at` is null
- [ ] After step 10's re-flag, a **second** notification exists for the executive secretary
- [ ] The executive secretary opening `/visits` sees **Not permitted**, not the page
- [ ] An audit row exists with action `visit_flagged`, and another with `visit_unflagged`, both module `visits`
- [ ] No audit detail anywhere contains either canary string
- [ ] No horizontal overflow at 375px on the visits list
- [ ] Every flag control is at least 44×44

### Needs a human eye

- [ ] **The confirm dialog names who will be told, before the flag is set** — a leader deciding
      whether to raise a family in ward council should learn that here, not afterwards
- [ ] The confirm also makes clear that the notes are NOT being sent
- [ ] The notification body, read with no other context, is enough to find the visit at ward
      council and tells the reader nothing they should not know. **Judge the text itself** — it
      cannot yet be read in the app, only in the database
- [ ] "Flagged for ward council" on the visit row reads as a state, not as a warning or an error
- [ ] Unflagging does not feel destructive — it is an ordinary correction, and the wording should
      say so
- [ ] Unflag-then-reflag DOES send a second notification, and that is the right behaviour: a
      genuine re-raise should reach somebody. Judge whether the confirm dialog on the second raise
      makes that clear rather than implying a duplicate
- [ ] Dark mode: the flagged state is still visible at a glance in the list

## Failure Behavior

- [ ] With the notification insert failing (e.g. temporarily rename the trigger key in
      `notification_settings`), the **flag still saves** and the leader is not shown an error —
      `notifyWardCouncilFlag` never throws, and the edit has already committed
- [ ] In a ward with **no** executive secretary, flagging still saves and notifies nobody, rather
      than falling back to the bishopric. Widening the audience is a product decision, and it is
      not taken quietly
- [ ] The EQ president cannot flag the Relief Society's Tuiasosopo visit — with cross-org
      visibility off they cannot even see it

## Walkthrough record

**Walked 2026-08-25 by Claude**, driven through a real browser (Playwright MCP) against the hosted
project on `localhost:3000`, with every write read back through the service-role client. The
judgement items were NOT walked by a person — they are pending the user's review.

**No app defect found. Two corrections were made to THIS SCENARIO — see below.**

**Observed:**

- The harness ward's `notification_settings` row for `visit_flagged_for_ward_council` read
  `default_roles: ["executive_secretary"]`, `is_globally_enabled: true` — confirming both
  migration 045 and the matching correction in `testing/infrastructure/seedUtils.ts`.
- Seed state verified: Halvorsen `2026-03-22` arrived `flagged_for_ward_council: true` with
  `flag_sent_at: 2026-03-23T18:00:00+00:00`; the other four visits unflagged with a null stamp.
- The visit list matched: Halvorsen's control read **"Remove ward council flag"** and carried the
  "Flagged for ward council" line; the other three EQ visits read "Flag for ward council".
- **The confirm dialog on raising read, verbatim:** *"Flag Brooks for ward council? The executive
  secretary will be notified — they will see the household name and nothing else, not your
  notes."*
- After accepting: exactly **one** notification row, `recipient_user_id` = `92332f5f…` = the
  executive secretary, title "Visit flagged for ward council", body **exactly**
  `Elders Quorum — Brooks — requested for ward council discussion`. Brooks' `flag_sent_at` was
  stamped `2026-08-26T01:54:24.262Z`.
- **`PATCH {"flaggedForWardCouncil": true}` on the already-flagged Halvorsen visit** returned 200,
  left `flagSentAt` at `2026-03-23T18:00:00+00:00`, and the notification count stayed at **1**.
  Idempotence holds.
- Unflagging Brooks through the UI set `flag_sent_at` to **null**. Its confirm read
  *"Remove the ward council flag from Brooks?"*
- Re-flagging Brooks produced a **second** notification, again to the executive secretary alone,
  again the identical one-liner. Count: 2.
- **No canary string appeared in any notification body** — searched for `CANARY`,
  `difficult month` and `confidence that was asked`: zero matches across all rows.
- Audit rows, in order: `visit_flagged` (`notified: true`), `visit_updated` (`notified: false` —
  the idempotent re-assert, correctly NOT recorded as a flagging), `visit_unflagged`
  (`notified: false`), `visit_flagged` (`notified: true`). Every detail carried only
  `orgId`, `changed: ["flaggedForWardCouncil"]`, `notified`, `visitLogId`. No note text.
- **As the executive secretary:** the sidebar held Dashboard, Roster, Calendar, Talks, Prayers,
  Agendas and **no Visits link**. `/visits` rendered "Not permitted — The visit tracker is limited
  to ward and organization leadership." `GET /api/visits` returned **403**. They are notified about
  a visit they genuinely cannot open, which is the design.
- No notification row existed for the bishop's user id.
- **No spontaneous console errors.**

**TWO CORRECTIONS MADE TO THIS SCENARIO. Both were checks written from the plan rather than from
the running app.**

1. **The idempotent re-flag is not reachable through the UI.** Step 5 told the tester to press
   "Flag for ward council" on the already-flagged Halvorsen visit, but an already-flagged visit's
   button reads "Remove ward council flag" — the UI offers no way to re-assert a flag. Its
   parenthetical then said to unflag and re-flag, which is a DIFFERENT path that correctly DOES
   notify, contradicting the checklist item beneath it. Step 5 and that item were rewritten: the
   UI check is now that the control reads "Remove", and the idempotence check is labelled
   API-level, where `tests/routes/visits.test.ts` already covers it.
2. **There is no notification bell UI.** Steps 6, 9 and 11 and two checklist items told the tester
   to open the bell and count notifications there. The 🔔 in the header is a static emoji, not a
   button — the notification UI is Phase 11's work
   (`plans/11-notifications-admin.md`). Those steps now read the `notifications` table directly,
   and the judgement item now asks the user to judge the body text itself rather than its
   presentation.

**Not walked:** both Failure Behavior items that need an induced failure — a broken notification
insert, and a ward with no executive secretary. Neither was arranged. The never-throws contract is
covered by reading `lib/visits/flagNotification.ts`; the empty-recipient path logs a warning and
returns, and is not covered by a test.

## Notes

- **Migration 045 corrected the recipients on the hosted rows**, not only in
  `supabase/seed/notification_triggers.sql`. If the bishop DOES get a notification here, check
  `select default_roles from notification_settings where trigger_key =
  'visit_flagged_for_ward_council'` — a stale row is the likely cause, and
  `testing/infrastructure/seedUtils.ts` carries its own copy of the same list that must agree.
- `visit_overdue` is seeded as a trigger and **fires from nothing**: there is no
  `supabase/functions/` directory and `pg_cron` is not enabled. That is a known open decision
  handed to `visits-c`, not a bug in this scenario. Do not expect an overdue notification.
