---
name: A game added by hand, at the right time of day
scope: youth
part: 1
tags: [youth, smoke, timezones]
prerequisites: none
---

## Purpose

Manual entry is the path that must work before any import exists — 08-youth-activities.md asks for
it first for exactly that reason: *"Manual entry — always available, always works."* A feed goes
down, a school changes its calendar software, and a leader still has to be able to type in Friday's
game.

The hour a game shows at is the thing slice B (ICS import) is most likely to break, and the phase
plan is blunt about the cost: *"A game showing at the wrong hour makes the whole feature useless."*
Establishing the correct instant **now, by hand**, gives slice B something to be compared against.

The specific bug this scenario exists to catch is the **double conversion**, and it is worth stating
because it is invisible otherwise: `<input type="datetime-local">` yields a floating time, and the
obvious fix converts it to UTC. Fill the field back in from that UTC string without converting back,
save again, and 7:30pm walks by the offset. **A single save looks perfect.** It only ever appears on
the second write, which is how it ships.

`tests/lib/youthValidation.test.ts` round-trips this three times and `tests/routes/youthEvents.test.ts`
saves the same instant twice across the wire. What neither can answer is whether the hour a leader
reads on the card is the hour they typed.

## Seed Data

Deliberately the smallest seed in the harness. **No events at all** — anything pre-created is a row
the tester did not type, and a pre-seeded event would let this checklist pass while the entry path
was broken.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `ym-president@harness.wardleadershiptools.test` (Young Men president) |
| Households | Brooks (2201 Canyon Road) |
| Members | 1 youth — Ethan Brooks, `active`, in Young Men |
| Activity profiles | 1 — *Varsity basketball*, Lincoln High School, owned by Young Men |
| Events | **none** |

**Sign in with:** `ym-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-050-a-game-added-by-hand`
2. `npm run dev`, then open http://localhost:3000
3. Sign in and open **/youth**. Read the empty schedule before adding anything.
4. Under **Add an event**, choose *Ethan Brooks — Varsity basketball*, title it
   `Game against Roosevelt`, set the date and time to **7:30pm on 15 January 2027**, location
   `Lincoln High School gym`, leave home/away as it comes.
5. Save, then **reload the page**.
6. Open the row in Supabase and look at `activity_events.event_date` directly.
7. Press **Edit** on the row. Without touching the time, press **Save event**. Reload again.
8. Now add a second event at **7:30pm on 4 July 2027** — the other side of the daylight-saving
   boundary from the first — and reload.
9. Press **Cancel** on one of the events.
10. Change your machine's time zone (System Settings → Date & Time), reload, and look at both rows.

## Verification Checklist

### Machine-checkable

- [ ] After the reload in step 5, the event lists at **7:30pm** — not 12:30pm, not 2:30am, not
      shifted by an hour.
- [ ] The stored `event_date` is an instant carrying an offset (e.g. `2027-01-15 19:30:00-07`), not
      a bare local string and not a date with no time.
- [ ] Converting that stored instant back to your own zone gives 7:30pm.
- [ ] **After the re-save in step 7 the time is still 7:30pm.** This is the double-conversion check
      and it is the single most important line here — a first save that is right proves nothing.
- [ ] The July event also reads 7:30pm, and its stored offset differs from January's by one hour.
- [ ] The cancelled event **stays in the list**, marked *Cancelled*, rather than disappearing.
- [ ] Pressing the control again un-cancels it, and it is the same row (same `id` in Supabase), not
      a new one.
- [ ] `activity_events.calendar_id` is **null** on every row entered here.
- [ ] **After adding an activity, the "Add an event" form offers it without a reload.** ADDED
      2026-08-27 during the walk, and it FAILS — see `youth-a-D2` in the Walkthrough record. This
      is the module's primary flow (create an activity, then add its first game) and it dead-ends.
- [ ] **After removing an activity, its cascade-deleted events leave the Schedule without a
      reload.** ADDED 2026-08-27; same root cause, same failure.
- [ ] The home/away field defaults to **"Not yet known"**, spelled out — not `tbd`.
- [ ] An `audit_log` row with action `youth_activity_event_created` exists for each event.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] Does the empty schedule ("Nothing coming up…") read as a deliberate state rather than as a
      list that failed to load?
- [ ] After changing your machine's zone in step 10, does the shift read as *correct* — you have
      moved, so the game is at a different local hour — or as the app losing the time? (See Notes:
      the reader's own zone is the deliberate rule here, not a bug.)
- [ ] Does a **cancelled** event read as *called off* rather than as *something went wrong*?
- [ ] Is "Not yet known" clearly something a person is expected to come back and settle?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Saving with the date field empty shows *"Give the date and time of the event"* and posts
      nothing.
- [ ] A request carrying a floating time (no offset, no `Z`) is refused by the server with a
      sentence naming the problem — the form never sends one, so this is the API's backstop.
  Automated: `tests/routes/youthEvents.test.ts` → *"refuses a floating eventDate with the sentence,
  and stores nothing"*.
- [ ] Choosing no activity shows *"Choose which activity this event belongs to"*.
- [ ] With no activity profiles at all, the form is replaced by a sentence explaining that an
      activity has to exist first — not an empty select.

## Walkthrough record

**2026-08-27 — driven by Claude in a real browser (Playwright), against the hosted project.**
Machine zone was **America/Denver**, which is what makes the DST pair below meaningful: January is
MST (−07:00) and July is MDT (−06:00). Every instant was verified by reading
`activity_events.event_date` with the service client, never from the screen.

**The timezone behaviour is correct, including the double conversion.** One defect found that is
not about time: `youth-a-D2`, the "Add an event" form is server-rendered and goes stale.

Observed values:

- **Created** *Game against Roosevelt* at `2027-01-15T19:30` local. After a full page reload the
  card read **"Fri, Jan 15, 2027, 7:30 PM"**. Stored: `2027-01-16T02:30:00+00:00` — an instant, and
  converting it back to America/Denver gives `Jan 15, 2027, 7:30 PM`. `event_type = tbd`,
  `status = upcoming`, `calendar_id = NULL`. Audit row `youth_activity_event_created`.
- **The double conversion does not happen.** Pressed Edit: the `datetime-local` field prefilled
  `2027-01-15T19:30` — the local wall clock, NOT the stored `02:30` UTC. Saved without touching it.
  Stored value after the second write: `2027-01-16T02:30:00+00:00`, byte-identical. Opened and
  saved a **third** time; prefill was again `2027-01-15T19:30` and the instant did not move. This
  is the bug the scenario exists for and it is absent.
- **DST pair.** *Summer tournament* at `2027-07-04T19:30` local stored as
  `2027-07-05T01:30:00+00:00` and read back **"Sun, Jul 4, 2027, 7:30 PM"**. The two stored UTC
  values differ by exactly one hour (02:30 vs 01:30) while both render 7:30 PM — which is the
  offset being taken at the event's own moment rather than today's.
- **Cancelling.** Pressed Cancel on *Summer tournament*: `status` became `cancelled`, audit row
  `youth_activity_event_updated` written, and the card STAYED in the list marked **"Cancelled"** in
  the warning tone, with the control now reading **"Not cancelled after all"**. Same row id
  throughout.
- **Failure paths.** Submitting with no activity chosen → *"Choose which activity this event
  belongs to."* Submitting with an activity and a title but no date → *"Give the date and time of
  the event."* Neither posted anything.
- **Cascade.** Removing *Varsity basketball* deleted the profile and BOTH its events
  (`youth_activity_profiles` 0, `activity_events` 0) with a `youth_activity_profile_deleted` audit
  row.
- **Empty states.** With zero activities, on a fresh load the event form is correctly replaced by
  *"Add an activity first. A game belongs to a season, and a season belongs to a young person, so
  there is nowhere to put one yet."* With zero events, the schedule reads *"Nothing coming up. Add
  a game or a concert below, or show past events."*

Checklist corrections made during the walk:

1. **Step 10 cannot be performed by an agent.** Changing the machine's time zone is an OS-level
   action outside the browser. The machine-checkable half is proven above — the stored value is an
   instant, so it is zone-independent by construction — but whether the shifted rendering *reads*
   as correct to a travelling leader is left for a person. Recorded as not walked rather than
   ticked.
2. **Added the two staleness lines** under Machine-checkable, both failing, for `youth-a-D2`.

Not walked: step 10, and every "needs a human eye" line — those are the review questions.

## Notes

- **The reader's own zone is deliberate.** The original plan for this scenario said to change *the
  ward's* timezone setting. Nothing in the app reads `wards.settings.timezone` today, and the
  house rule for a `timestamptz` is already written down in `lib/visits/visitDates.ts`: an
  appointment — or a game — is a time somebody has to **turn up at**, so it renders in the reader's
  own zone and locale. Step 10 changes the machine's zone instead, which is what actually drives
  the rendering. If a ward-level zone is ever wanted, it is one decision applied to both modules,
  not a second rule invented here.
- Nothing in this scenario touches the ICS import. That is slice B, and this is what it will be
  compared against.
