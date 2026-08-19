---
name: Move Fast Sunday with a conference
scope: calendar-b-month-view
part: 1
tags: [calendar, full, fast-sunday, destructive]
prerequisites: none
---

## Purpose

The Fast Sunday rule is this phase's highest-risk logic and its failure mode is quiet: a calendar
that looks right and has silently orphaned three speakers. The unit tests prove the rule; only a
walkthrough proves the **warning reaches a human in words they can act on**, and that confirming it
moves the assignments rather than deleting them.

The reverse direction — clearing a conference and watching Fast Sunday move back **earlier** — is
the case 03-calendar.md names as the easiest to forget, and it is invisible in a single-direction
test.

March 2026 is chosen deliberately: it contains the 2026-03-08 US daylight-saving transition, so a
timezone bug in the grid shows up as a visibly wrong date rather than as a subtle off-by-one
somewhere else.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds `calendar.manage` **and** `admin.manage_ward` |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `calendar.manage`, **not** `admin.manage_ward` |
| | `music` (music_coordinator, Elena Vasquez) — holds `calendar.view` only |
| | `eqpres` (org_president, Tomas Ruiz) — holds **no** calendar permission |
| | `counselor1` (counselor, position 1, Peter Nakamura) and `counselor2` (counselor, position 2, Daniel Okafor) — rotation targets and notification recipients |
| Sundays | One month: 2026-03-01, 03-08, 03-15, 03-22, 03-29 |
| | 03-01 is `fast_sunday`, `speaking_slots = 0`; the rest `standard`, `speaking_slots = 3` |
| | 03-08 carries a long note, so the grid's two-line clamp is observable |
| Members | 3 active adults, in one household |
| Assignments | 3 on **2026-03-08**, `pipeline_stage = 'approve'` — the collision |
| Conducting rotation | Three positions effective 2026-01-04: bishop, counselor1, counselor2 |
| | Every March Sunday carries the `conducting_user_id` that cycle produces |
| Notification triggers | all, including `admin_setting_changed` |

**Sign in with:** `bishop@`, then `secretary@`, `music@`, `eqpres@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- calendar/scenario-010-fast-sunday-shift`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/calendar?month=2026-03`.
4. Read the whole month at desktop width, then narrow the browser to 375px and read it again.
   Toggle dark mode and read it a third time.
5. Open March 1. Change its Type to **Stake Conference** and press Save. Read the dialog.
6. Press **Cancel**. Reload the page and check what March 1 and March 8 actually are.
7. Repeat step 5 and this time press **Apply the change**. Read the message under the form.
8. Go back to the calendar and look at March 1 and March 8.
9. In the Supabase dashboard, read the three `assignments` rows on the March 8 Sunday.
10. Open March 1 again, set its Type back to **Standard**, and save.
11. Check the calendar and the three assignment rows again.
12. Open March 15, tick **Pin as Fast Sunday**, and save.
13. Open March 1, set it to **Stake Conference**, and save. Then set it back to **Standard**.
14. Open March 15 and clear the pin.
15. Back on `/calendar`, open **Conducting rotation**. Read it before touching a control.
16. Reorder the three positions, set Effective from to **2026-03-15**, and save.
17. Look at March, then open `/calendar?month=2026-04`.
18. In the dashboard, read `notifications` and `audit_log` for this ward.
19. Open **Calendar settings**, change the default speaker count, and read what it says.
20. Sign out. Repeat step 3 as `secretary`, then as `music`, then as `eqpres`.

## Verification Checklist

Reading the month

- [ ] Grid renders at desktop width with March 1, 8, 15, 22, 29 in the correct week rows
- [ ] March 2026 opens on a Sunday, so there are **no** leading blank cells before the 1st
- [ ] At 375px the grid is replaced by a card list — no horizontal scrolling anywhere
- [ ] **March 8 reads "March 8", not "March 7"** — the DST check
- [ ] The heading reads "March 2026"
- [ ] March 1 shows a "Fast Sunday" badge; the other four show **no badge at all**
- [ ] March 8's note is clamped to two lines in the grid and shown in full on its detail page
- [ ] Conducting shows a name on every Sunday, cycling counselor2 → bishop → counselor1 →
      counselor2 → bishop across March 1 to 29
- [ ] No cell anywhere shows a raw uuid
- [ ] Dark mode: every badge and token is legible against the surface

The collision warning

- [ ] Marking March 1 as Stake Conference opens a warning dialog, not a generic error
- [ ] The dialog is titled **"Fast Sunday is moving"** — not a generic "Are you sure?"
- [ ] The warning names March 8, names Fast Sunday, and says **3** speaking assignments
- [ ] The warning says nothing is deleted and that the assignments will not count as talks given
- [ ] Cancelling leaves March 1 as Stake Conference **unapplied** — reload and confirm March 1 is
      still `fast_sunday` and March 8 still has 3 slots
- [ ] Nothing appears in `audit_log` for the cancelled attempt
- [ ] Confirming moves Fast Sunday to March 8 and sets its speaking slots to 0
- [ ] The success message says **3 speakers moved back to the planning stage** — not "removed",
      not "cancelled", and not silence
- [ ] **The three assignments still exist**, at `pipeline_stage = 'plan'` — check the database, not
      just the screen. Deletion is the failure this scenario exists to catch
- [ ] March 1 shows a "Stake Conference" badge and March 8 shows "Fast Sunday"
- [ ] The month grid behind the dialog is up to date without a manual reload

The reverse direction

- [ ] Clearing March 1 back to Standard moves Fast Sunday **back to March 1**
- [ ] March 8's speaking slots return to 3
- [ ] The three assignments are **still** at `plan` — moving Fast Sunday back does not undo the
      revert, and should not pretend to

The pin

- [ ] The pin checkbox has a line of help text under it explaining what it does
- [ ] Pinning March 15 as Fast Sunday clears the fast marker from March 1
- [ ] Marking March 1 as Stake Conference now changes nothing about March 15
- [ ] Clearing the pin lets the rule take over again

Rotation

- [ ] The rotation panel is collapsed until opened, and shows the forward-only sentence **above**
      any control
- [ ] Saving a new order with Effective from 2026-03-15 succeeds
- [ ] March 1 and March 8 are unchanged
- [ ] **March 15, 22 and 29 are also unchanged.** Every Sunday in March already has a stored
      conductor, and a rotation change never rewrites one — that is exactly what the forward-only
      sentence promises. See the note at the bottom
- [ ] Opening `/calendar?month=2026-04` generates April, and its four Sundays follow the **new**
      order starting from April 5
- [ ] April 5 is pre-marked General Conference and April 12 is Fast Sunday
- [ ] Saving a second rotation on the same effective date shows the server's message — "A rotation
      already takes effect on 2026-03-15" — not a 500
- [ ] After a successful save, the panel says the other bishopric members have been notified
- [ ] `counselor1` and `counselor2` each receive an `admin_setting_changed` notification; the
      bishop who made the change does **not**
- [ ] An `audit_log` row exists for `conducting_rotation_updated` and for each `sunday_updated`

Calendar settings

- [ ] Changing the default speaker count shows the server's sentence verbatim: it applies to
      Sundays generated from now on and does not rewrite the calendar on screen
- [ ] The March Sundays' speaking slots are genuinely unchanged afterwards
- [ ] The number input refuses 0 and refuses 16

Permissions

- [ ] `secretary` sees the calendar and can edit a Sunday, but the rotation panel is **absent**
      rather than disabled
- [ ] `secretary` sees the default speaker count as a read-only sentence, with no input
- [ ] `music` sees the calendar read-only — no editor on a Sunday detail page, no rotation panel
- [ ] `music` sees no "Speakers" section on a Sunday detail page (it is gated on `talks.view`)
- [ ] `eqpres` sees no Calendar link in the sidebar, and `/calendar` shows "Not permitted" with a
      link back to the dashboard — not a blank page and not a 500

## Failure Behavior

- [ ] `/calendar?month=2026-13` shows the current month rather than an error
- [ ] `/calendar?month=banana` does the same
- [ ] `/calendar/sunday/<a uuid that does not exist>` renders the 404 page, not a 500
- [ ] `eqpres` PATCHing a Sunday directly gets **403**, not 500 — this is the check that matters,
      because migration 019 grants the underlying UPDATE to every ward member. Run it from the
      browser console while signed in as `eqpres`, with a real Sunday id from the dashboard:
      `await (await fetch('/api/sundays/<id>', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'holiday' }) })).json()`
- [ ] `secretary` PATCHing `/api/conducting-rotation` the same way gets **403** — `calendar.manage`
      is not `admin.manage_ward`
- [ ] `secretary` PATCHing `/api/ward-settings/calendar` gets **403**
- [ ] Nothing appears in `audit_log` for any refused request

## Notes

**Steps 5 onwards change data.** Re-run the seed before using this ward for another scenario.
`createSunday` and `createAssignment` use stable ids, so re-seeding restores March — but April, if
you generated it in step 17, is **not** in the seed and survives. Run `npm run seed:clean` to clear
the ward entirely, then re-seed.

**Correction to the plan's rotation check.** `plans/calendar-b-month-view.md` expects March 15, 22
and 29 to follow a new rotation effective 2026-03-15. They do not, and should not. `calendar-a`
stores `conducting_user_id` on every Sunday (03-calendar.md Step 3 requires it — a computed value
would rewrite history), and `populateConducting()` only ever fills rows that are still **null**. A
rotation change therefore reaches Sundays that have no conductor yet, which in practice means
months generated after the change. That is precisely what the forward-only sentence says: *"Sundays
already assigned keep their current conductor."* April is the observable check, and it is a better
one — it exercises generation and the new anchor together.

**Why `secretary` and `music` are separate seats.** `calendar.manage` and `admin.manage_ward` are
two different gates in this phase, and `calendar.view` is a third. Collapsing them into one test
account would hide the two most likely wiring mistakes: a rotation panel a secretary can open, and
a settings input a music coordinator can type into.
