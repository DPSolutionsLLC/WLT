---
name: Appointments and attempts
scope: visits
part: 1
tags: [visits, full, appointments]
prerequisites: none
---

## Purpose

Two things this slice added are only real on a screen.

**"Missed" is computed, never stored.** A missed appointment is one that was scheduled and whose
time has passed — nothing writes that down, because a stored status that time invalidates goes
stale the moment nobody refreshes it, and this project has no scheduler to refresh one. So the
state cannot be created by clicking: it only appears when a seeded past appointment is still
`scheduled`. What a person has to judge is whether the four states read as four different things
on one screen, and whether "missed" reads as a fact rather than as an error.

**An attempt is shown and never counted.** A leader who knocked and got no answer records that
with one control, in the same form. The pair seeded here — one attempt and one completed visit on
the *same* household — is what makes "shown but not counted" checkable at all.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility OFF |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), EQ secretary (Peter Nakamura) |
| Households | Brooks, Whitfield, Okonkwo, Halvorsen |
| Visit — Brooks, 10 Feb | **completed**, by appointment |
| Visit — Brooks, 14 Mar | **attempted**, dropped in — "no answer" |
| Appointment — Brooks, 10 Feb 2026 | `kept`, linked to the completed visit |
| Appointment — Whitfield, 3 Mar 2026 | **stored as `scheduled`, in the past — the MISSED one** |
| Appointment — Okonkwo, 24 Feb 2026 | `cancelled` — the row still exists |
| Appointment — Halvorsen, 2 Jun 2099 | upcoming |
| Goal | EQ: visit every household this year |

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-044-appointments-and-attempts`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the EQ president and go to **Visits**.
4. Read the **Appointments** panel before touching anything. Four rows, four states.
5. Book an appointment with the Okonkwo household for **a time that has already passed** — say
   yesterday evening. Confirm it is accepted, and read what state it comes back in.
6. On the upcoming Halvorsen appointment, press **Log this visit**. The visit form should open
   with the household already chosen.
7. Save that visit, then look at the Halvorsen appointment again.
8. In **Log a visit**, choose Brooks and switch **What happened** to **Attempted**. Write a
   shared note and save.
9. Find both Brooks rows in **Recent visits** and compare them.
10. Press **Cancel** on an appointment, confirm, and check the row is still there.

## Verification Checklist

### Machine-checkable

- [ ] The Whitfield appointment reads **Missed**
- [ ] Its stored status is still `scheduled`:
      `select status, scheduled_for from visit_appointments where status = 'scheduled'`
      returns it, and no row anywhere has `status = 'missed'`
- [ ] The four appointments read as **Scheduled**, **Kept**, **Cancelled** and **Missed** — four
      distinct words, not just four colours
- [ ] Booking an appointment for a time already past is **accepted**, not refused
- [ ] **Log this visit** opens the form with the household prefilled and **By appointment**
      already chosen
- [ ] Saving that visit sets the appointment to `kept` and fills its `visit_log_id`:
      `select status, visit_log_id from visit_appointments where household_id = ...`
- [ ] Choosing **Attempted** does not hide or rearrange any field — the notes section is exactly
      where it was
- [ ] The attempted Brooks visit appears in **Recent visits** labelled **Attempted**
- [ ] The completed Brooks visit appears labelled **Visited**
- [ ] Cancelling asks for confirmation and, after it, the row is **still on the panel** marked
      Cancelled — `select count(*) from visit_appointments` is unchanged
- [ ] No horizontal scrolling at 375px; every button ≥ 44×44

### Needs a human eye

- [ ] Does **Missed** read as a fact about the appointment, or does it read like an error the
      app is reporting about itself?
- [ ] Are the four states distinguishable **at a glance** on a phone, in both themes — and are
      they still distinguishable with colour ignored?
- [ ] Reading the two Brooks rows together, is it obvious that one counts towards the goal and
      the other does not? Or would a leader read the attempt as a visit?
- [ ] Is **What happened** in the right place — do you answer it before anything else, or do you
      find yourself scrolling back up to it after filling the form in?
- [ ] Does the cancel confirmation make clear the record is **kept** rather than deleted?
- [ ] After logging an attempt, does the confirmation message say something a leader would find
      reassuring, or does it read as though something went wrong?

## Failure Behavior

- [ ] Booking with no household chosen says "Choose which household this appointment is with."
- [ ] Booking with no day and time says "Give the day and time of the appointment."
- [ ] **Reschedule** with an unparseable answer says so and changes nothing
- [ ] Covered by automated tests rather than by hand
      (`tests/routes/visitAppointments.test.ts`): another organization's appointment answers
      **404 and not 403**, keeping an appointment with a visit to a *different* household is
      refused, and rescheduling into the past leaves the stored status `scheduled` while the
      read reports `missed`

## Walkthrough record

**2026-08-25 — driven by Claude in a real browser (Playwright), signed in as the EQ president.**
Screenshots reviewed by the user separately. This is agent-driven evidence, not a person using
the app.

### Observed

- The four seeded appointments rendered as four distinct words: **Kept** (Brooks, Feb 10),
  **Cancelled** (Okonkwo, Feb 24), **Missed** (Whitfield, Mar 3), **Scheduled** (Halvorsen).
- **The central claim holds.** Whitfield read `Missed` on screen while the database said
  `status=scheduled`. A service-client scan found **0 rows anywhere with `status = 'missed'`**
  across 4 appointment rows.
- **Booking a past appointment was accepted** — Okonkwo, 25 Aug 2026 19:30 local — and came back
  reading **Missed** immediately, with the notice *"Appointment booked."* No error.
- **Cancelling kept the row.** Before: 4 rows. After cancelling Halvorsen: still **4 rows**, with
  that row `status=cancelled`. The confirm read *"Cancel the appointment with Halvorsen? It stays
  on the record as cancelled rather than disappearing."* One `appointment_cancelled` audit row
  was written.
- **Choosing "Attempted" rearranged nothing.** Field order stayed
  `What happened → How it was arranged → Household → Visit date → Visit type → Who went → Notes
  (Shared, Private)`; both notes textareas remained. The helper became *"Nobody was home, or the
  visit did not happen. It stays on the household's record and counts towards no goal."* and the
  submit button became **Record attempt**.
- The attempt saved as `outcome=attempted`, and the confirmation read *"Attempt recorded. It stays
  on the household's record and counts towards no goal."*
- 375px: 0px horizontal overflow; no raw uuid on screen.

### Defects found

1. **"Log this visit" does not prefill anything — the flow is dead.** Pressing it sets the URL to
   `/visits?appointment=<id>` but the form opens with no household, `Dropped in` still selected,
   and no "Logging the visit arranged with …" line. It fails on a **full page load** of that URL
   too, so it is not React state preservation.

   Root cause, confirmed with a temporary server-side probe rather than inferred:
   `APPOINTMENT_QUERY_PARAM` is exported from `AppointmentPanel.tsx`, which is a `"use client"`
   module. Imported into the Server Component `page.tsx`, it arrives as a **client-reference
   proxy** — the probe logged `typeof APPOINTMENT_QUERY_PARAM === "function"`, not `"string"`.
   `searchParams` itself was correct (`{"appointment":"6600b4a9-…"}`); the *lookup key* was a
   function, so the lookup returned undefined and the prefill silently never happened.

2. **An attempted visit renders "Visited by <name>".** The Recent-visits row shows **Attempted**
   and then, immediately below, *"Visited by Miguel Cortez"*. A leader skimming reads
   "Visited by". The prefix is hardcoded in `page.tsx` and does not branch on `outcome`.

3. **Minor: no year on any appointment date.** The 2099 fixture rendered *"Tue, Jun 2, 1:00 PM"*
   and a 2026 one *"Tue, Aug 25, 7:30 PM"* — indistinguishable. `formatScheduledFor` omits the
   year, so an appointment missed last year reads like one missed last week.

### Checklist corrections

None. Every check describes a reachable state; two of them **fail**, which is a finding about the
app rather than about the checklist. The year-omission (Defect 3) is not covered by any existing
check — worth adding one once the behaviour is settled.

### Fixed and re-walked, same day

All three defects fixed and proven in the browser again.

- **D1 had TWO layers.** Moving the constant into `lib/visits/appointmentLink.ts` (a module that
  is neither server- nor client-only) fixed the server half — the "Logging the visit arranged
  with Halvorsen" line appeared. The form was *still* blank, because `VisitLogForm` seeds its
  draft in a `useState` initializer and React runs that **once per mount**; "Log this visit" is a
  client-side navigation, so the component never remounted. A hard reload of the same URL
  prefilled correctly, which is what isolated the second layer. Fixed with
  `key={appointmentPrefill?.id ?? "no-appointment"}` in `page.tsx`.
  **Re-walked:** clicking "Log this visit" now opens the form with Halvorsen selected and **By
  appointment** chosen; saving it set that appointment to `status=kept` with
  `visit_log_id=0a5ee8c6-…`.
- **D2 fixed.** The verb now follows the outcome via `VISIT_CONDUCTED_PREFIX` in
  `types/domain.ts`. The attempted Brooks row reads **"Attempted by Miguel Cortez"**; the
  completed rows still read "Visited by". The participants field's empty state follows the
  outcome too, so a form set to Attempted no longer says "Nobody recorded as visiting".
- **D4 fixed.** The chip remove control is `h-11 w-11`. A full sweep at 375 px found **zero**
  tap targets under 44×44, and still 0 px horizontal overflow.
- **Appointment states are now badges with a mark** (user's answer to Q4 — they did not stand
  out enough). Bordered pill following `components/assignments/StageBadge.tsx`, plus a glyph as
  a second, non-colour channel: `○ Scheduled`, `✓ Kept`, `✕ Cancelled`, `! Missed`. The glyph is
  `aria-hidden` because the word beside it already says the state. Text glyphs rather than
  emoji: an emoji renders in its own colour and would fight the state colour.

### Left unwalked

- **Reschedule** was not exercised: it uses `window.prompt`, and the two automated tests in
  `tests/routes/visitAppointments.test.ts` already cover reschedule and reschedule-into-the-past.
- Keeping an appointment **through the panel** could not be walked (Defect 1). The underlying
  API path *is* proven — `POST /api/visits` with an `appointmentId` sets `status=kept` and links
  the visit log (`tests/routes/visitAppointments.test.ts`).

## Notes

- **Reschedule** uses a browser `window.prompt` taking `YYYY-MM-DD HH:MM` in local time. It is
  deliberately plain: `visits-b` replaces this whole panel, so a date picker here would be built
  to be thrown away.
- Every seeded timestamp is pinned rather than computed from today, so "the past" in this
  scenario stays the past. The upcoming one is in 2099 for the same reason.
- The times render in **your browser's** timezone. An appointment seeded at 19:00 UTC will not
  read as 19:00 unless you are on UTC — that is correct, not a bug.
