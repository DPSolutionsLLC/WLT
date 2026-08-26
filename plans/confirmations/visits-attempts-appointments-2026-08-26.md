---
id: visits-attempts-appointments-participants
status: best-yet
commit: 842968d
date: 2026-08-26
area: visits
related_retros: [visits-d-attempts-appointments-and-participants, visits-a-goals-logs-and-notes]
supersedes: null
---

## What was tested

Scenarios 043 (who actually went) and 044 (appointments and attempts), walked end to end at
`/visits` as the Elders Quorum president, plus the full automated suite.

**Who drove it: an agent.** Claude drove Chromium via Playwright against the local dev server and
the hosted Supabase project; the user reviewed the screenshots and the findings and answered five
judgement questions. **This is not a person using the app.** No human has operated this feature.

**What was NOT verified:**

- **The deployed build has not been opened.** Everything below is `localhost:3000`. The push that
  triggers the Vercel deploy happened after the walk.
- **No real device.** 375 px was a resized desktop browser. Touch targets were measured in CSS
  pixels via `getBoundingClientRect`, not tapped with a thumb.
- **The member half of the participants picker was never exercised** — it is blocked by the open
  D3 decision (see Result). "Add a member" has therefore never been seen to work.
- **Reschedule was not exercised through the UI.** It uses `window.prompt`; only its two route
  tests cover it.
- **Migration 049 is not applied.** `visit_logs.visited_by` still exists in the database,
  unread by anything.
  _**Applied 2026-08-26**, after this walk, once the Vercel deploy of `visits-d` was live. The
  column is gone; `supabase/migrations-pending/README.md` records the checks made before dropping
  it, since a column drop is irreversible._
- **The bishopric path was not walked.** Only the EQ president and, via fixtures, the secretary.
- Dark mode was checked on the participants field and the appointments panel, not on every
  surface.

## Result

**Good — observed values, not ticks.**

- **The recorder/visitor split holds.** A visit logged with the recorder removed came back from
  the database as `recorded_by = Miguel Cortez` with participants
  `the missionaries, Tomas Reyes, Mark Andersen, Ana Delgado, Peter Nakamura` — five rows, none
  of them the recorder. Read with the service client, not from the screen.
- **The audit trail carries counts, not names.**
  `{"orgId":"…a2","outcome":"completed","visitDate":"2026-08-26","visitType":"in_home",
  "visitLogId":"231d2e5e-…","arrangement":"drop_in","householdId":"52d7a829-…",
  "appointmentId":null,"participantCount":5}`
- **"Missed" is genuinely computed.** The Whitfield appointment rendered `Missed` while the row
  said `status=scheduled`, and a ward-wide scan found **0 rows with `status = 'missed'`** across
  4 appointments. Booking one for a past time was accepted and read `Missed` immediately.
- **Cancelling does not delete.** 4 appointment rows before, 4 after, the target now
  `status=cancelled`, one `appointment_cancelled` audit row.
- **Keeping an appointment works end to end after the D1 fix.** "Log this visit" opened the form
  with Halvorsen selected and *By appointment* chosen; saving set that appointment to
  `status=kept` with `visit_log_id=0a5ee8c6-5477-4cfe-82c1-b11fae0787dd`.
- **Rendered strings, verbatim:** `Visited by Miguel Cortez and Ruth Brooks` /
  `Recorded by Peter Nakamura`; `Nobody recorded as visiting`;
  `Visited by Miguel Cortez and Bill from next door`; `Attempted by Miguel Cortez`.
- **The cap:** the sixth person accepted, the seventh refused with *"This visit already lists 6
  people, which is the most a visit can record — the person writing it up plus 5 companions.
  Remove somebody to add another."* Removing one restored the add controls.
- **Layout at 375 px:** `scrollWidth === clientWidth` (0 px overflow); **zero** tap targets under
  44×44 after the D4 fix; no raw uuid in the rendered text; no console errors from the app.
- **Automated:** 154 files, **2304 tests** passing. Lint, typecheck, harness typecheck and the
  production build all green.

**Four defects found by the walk that the 2304 tests had not caught. Three fixed and re-walked
the same day** (D1 the dead "Log this visit" flow, which had two layers; D2 an attempted visit
rendering "Visited by"; D4 a 32×32 tap target). Appointment states were also rebuilt as badges
carrying a mark as well as a colour, on the user's review.

**Still needing testing before this can be confirmed:**

1. **D3 is an open product decision, not a bug to fix.** `MemberPicker` scopes an org leader to
   their own organization, so a companion from another organization — a president's wife in
   Relief Society — cannot be recorded at all. Widening it means an opt-out prop on a frozen
   component, which `roster-b` says to raise rather than add quietly. Until this is settled, one
   of the three participant kinds has never been used.
2. **A separate small bug rides along with it:** the picker reports *"There are no members in the
   roster yet"* for a *filtered*-empty result while `GET /api/members?statuses=active` returns 6.
   `MemberPicker.tsx:463`'s own comment says this must never happen.
3. **The deployed build**, on a real phone, by a person.
4. ~~**Migration 049**, once the deploy is green.~~ **Done 2026-08-26** — applied after the
   deploy went green.
5. ~~**Minor:** appointment dates render without a year, so a 2099 fixture reads like a 2026
   one.~~ **Fixed in `visits-b` (d5695e7)** — both visit dates and appointment instants now
   render the year, from one module (`lib/visits/visitDates.ts`) so the two cannot drift apart
   again.

## Notes

`visit_overdue` still has nowhere to run, and `missed` now joins it — two computed-on-read states,
neither emitting a notification, with no `supabase/functions/` and no `pg_cron`. This is the
second slice in a row to record it. Raise the mechanism before `visits-c`.
