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
3. Sign in and open **/youth/profiles**. Read the empty schedule before adding anything.
   (CORRECTED 2026-08-30: `youth-e` moved the schedule and the event form off `/youth`, which is
   now the ranked list of young people. Both live on `/youth/profiles`.)
4. Under **Add an event**, choose *Ethan Brooks — Varsity basketball*, title it
   `Game against Roosevelt`, set the date and time to **7:30pm on 15 January 2027**, location
   `Lincoln High School gym`, leave home/away as it comes.
5. Save, then **reload the page**.
6. Open the row in Supabase and look at `activity_events.event_date` directly.
7. Press **Edit** on the row. Without touching the time, press **Save event**. Reload again.
8. Now add a second event at **7:30pm on 4 July 2027** — the other side of the daylight-saving
   boundary from the first — and reload.
9. Press **Cancel** on one of the events.
10. **REPLACED 2026-08-30 — this step used to say "change your machine's time zone", and that no
    longer tests anything.** `c24d52b` reversed the rule: a turn-up-at `timestamptz` renders in the
    **ward's** zone, not the reader's, so changing the machine's zone leaves every card unmoved.
    Change **the ward's** zone instead — `wards.settings.timezone`, which has no editing UI (a
    Phase 11 admin screen), so set it with the service client:

    ```
    update wards set settings = jsonb_set(settings, '{timezone}', '"Pacific/Honolulu"')
    where id = '11111111-1111-4111-8111-111111111111';
    ```

    Reload and look at both rows. Restore `"America/Denver"` afterwards. Pick a zone that differs
    from the machine's, or this step proves nothing — that is the whole point of it.

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
      2026-08-27 during the walk, when it FAILED (`youth-a-D2`). **FIXED — verified passing
      2026-08-30.** This is the module's primary flow (create an activity, then add its first game).
- [ ] **After removing an activity, its cascade-deleted events leave the Schedule without a
      reload.** ADDED 2026-08-27; same root cause. **FIXED — verified passing 2026-08-30.**
- [ ] The home/away field defaults to **"Decide from the location"**, and the explicit
      "somebody looked and does not know" option is spelled **"Home or away not set"** — never
      `tbd`. (CORRECTED 2026-08-30: this line said the default was "Not yet known". `youth-c`
      removed `.default("tbd")` so that *left alone* stays distinguishable from *chosen*, and
      renamed the option, so no screen has said "Not yet known" since. The old line described a
      state the app cannot reach.)
- [ ] **The card's hour is the WARD's zone, not the reader's.** With the ward on
      `Pacific/Honolulu` and the machine on `America/Denver`, the January event reads
      **4:30 PM**, not 7:30 PM. (ADDED 2026-08-30 for the `c24d52b` reversal.)
- [ ] **The edit form's date field agrees with the card it sits under.** Open Edit while the two
      zones differ and compare the prefilled field with the date printed above it. (ADDED
      2026-08-30 — this FAILS, see `050-D2` in the Walkthrough record.)
- [ ] An `audit_log` row with action `youth_activity_event_created` exists for each event.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] Does the empty schedule ("Nothing coming up…") read as a deliberate state rather than as a
      list that failed to load?
- [ ] After changing **the ward's** zone in step 10, does the shift read as *correct* — this is the
      ward's clock, and the game is at the hour the ward would say aloud — or as the app losing the
      time? (See Notes: the ward's zone is the deliberate rule, and no zone marker is rendered.)
- [ ] Does a **cancelled** event read as *called off* rather than as *something went wrong*?
- [ ] Is "Home or away not set" clearly something a person is expected to come back and settle?
- [ ] Should **Remove** on an activity ask first? It deletes the activity, every event on it, every
      sign-up, every follow-up and every private note, on one click, with no confirm. (ADDED
      2026-08-30 — see `050-D1`.)
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

- **The WARD's zone is deliberate — and this note said the exact opposite until 2026-08-30.** It
  used to read: *"the house rule for a `timestamptz` is already written down in
  `lib/visits/visitDates.ts`: an appointment — or a game — is a time somebody has to turn up at, so
  it renders in the reader's own zone and locale."* That intent was right and the mechanism could
  not deliver it. A `"use client"` component is server-rendered before it is hydrated, and on a
  server there is no reader: `undefined` resolved to the server's zone, UTC on Vercel, and
  production served a 7:30pm Friday game as "Sat, Jan 16, 2027, 2:30 AM". `c24d52b` reversed it —
  a turn-up-at `timestamptz` now renders in **the ward's** zone, resolved once per page by
  `readWardTimezone` and handed down, and `tests/lib/explicitTimeZone.test.ts` refuses any
  formatter that names no zone at all. `wards.settings.timezone` therefore has real readers now;
  the old claim that "nothing in the app reads it" was true when written and stopped being true in
  `youth-b`. **No zone marker is rendered beside the time, and that was asked and answered**
  (2026-08-30): the ward's clock is the assumption, and labelling it would suggest the reader might
  be looking at some other zone.
- Nothing in this scenario touches the ICS import. That is slice B, and this is what it will be
  compared against.

---

**2026-08-30 — RE-WALKED by Claude in a real browser (Playwright), against the hosted project.**
Machine/browser zone `America/Denver` (verified in-page: Jan offset 420, Jul offset 360). The
harness password was never typed into the page — the session was minted server-side with
`@supabase/ssr` and handed to the browser over a short-lived loopback server. Every write was read
back with the service client; nothing was confirmed from the screen alone.

**Why re-walked:** the 2026-08-27 record predates `c24d52b`. This scenario's Notes asserted the
reader's-own-zone rule, which that commit reversed, so step 10 and one review question were
testing a rule the app no longer follows.

**Two defects found, both invisible to the 2026-08-27 walk and to the suite.**

- **`050-D1` — Remove on an activity destroys a cascade with no confirmation.**
  `ActivityProfileList.tsx:317` is `onClick={() => deleteMutation.mutate(profile.id)}`: no
  `window.confirm`, no undo. Migration 009 cascades `youth_activity_profiles` →
  `activity_events` → {`activity_attendees`, `activity_logs`} → `activity_private_notes`, so one
  click destroys a whole season plus another leader's private pastoral notes — the rows rule 5
  calls private forever. Observed twice: removing *Jazz band* took *Winter concert* with it
  (`activity_events` 3 → 2); removing *Varsity basketball* took all three remaining events
  (3 → 0). The audit row records `orgId`/`memberId`/`profileId` only, so nothing anywhere records
  what was destroyed. The codebase already has the pattern this is missing — twelve
  `window.confirm` sites, and `DocumentList.tsx:133` states the house rule in a comment ("Worded by
  CONSEQUENCE, not by action… naming the passage count and saying what is NOT affected"), for the
  structurally identical case of deleting a parent that cascades to children.

- **`050-D2` — the edit form's date field is still in the reader's zone while the card beside it
  is in the ward's.** With the ward set to `Pacific/Honolulu` and the browser on `America/Denver`:
  the card read **"Fri, Jan 15, 2027, 4:30 PM"** and the Edit field prefilled **`19:30`** — the
  same event, the same screen, three hours apart. On the create path a leader typed **19:30** and
  the card came back **"Fri, Mar 5, 2027, 4:30 PM"**, which is precisely the question this
  scenario exists to ask: *is the hour on the card the hour they typed?* It is not, whenever the
  reader's zone differs from the ward's. Cause: `lib/youth/eventInstant.ts` resolves the zone from
  ambient process state (`new Date(value)` + `getTimezoneOffset()`) and takes no zone parameter —
  correct under the old reader's-zone rule, not updated by `c24d52b`, which moved only the display
  half. `tests/lib/explicitTimeZone.test.ts` cannot catch it: its `CALL_PATTERN` matches
  `Intl.DateTimeFormat` and `.toLocale*`, not `getTimezoneOffset`. **A save left untouched is
  idempotent** (stored instant identical across three writes), so this is a wrong-number-on-screen
  bug, not silent drift — but a leader who types the hour the card shows moves the game.
  The ICS import path is unaffected: `resolveInstant.ts` takes an explicit ward zone.

Observed values (ward `America/Denver` unless stated):

- **Created** *Game against Roosevelt* at `2027-01-15T19:30` local. After a full reload the card
  read **"Fri, Jan 15, 2027, 7:30 PM"**. Stored `2027-01-16T02:30:00+00:00`; `event_type = tbd`,
  `status = upcoming`, `calendar_id = NULL`, `source_uid = NULL`.
- **No double conversion, over three writes.** Edit prefilled `2027-01-15T19:30` (the wall clock,
  not the stored `02:30`); saved untouched twice more. Stored value byte-identical after each:
  `2027-01-16T02:30:00+00:00`. This is the bug the scenario exists for and it is absent.
- **DST pair.** *Summer tournament* at `2027-07-04T19:30` stored `2027-07-05T01:30:00+00:00`. The
  two stored instants differ by exactly one hour while both render 7:30 PM — the offset taken at
  each event's own moment. Under `Pacific/Honolulu` (no DST) they correctly rendered 4:30 PM and
  3:30 PM, an hour apart, for the same reason read the other way.
- **Cancelling.** `status` → `cancelled`; the card stayed in the list marked **Cancelled** with the
  control reading **"Not cancelled after all"**; un-cancelling returned `status` to `upcoming` on
  the **same row id** (`4cf04e7d-94f0-44c7-8701-cbc9c7c5b32a` throughout), not a new one. A
  cancelled event stays inside "N upcoming events" — decided, not overlooked (`EventList.tsx:178`).
- **`youth-a-D2` is FIXED, both halves.** Adding *Jazz band* put it in the event form's select at
  0 ms with no reload (options went to 3); removing it dropped Activities 2 → 1, Schedule 3 → 2 and
  the select back to 2, again with no reload.
- **Audit.** 7 rows for the 7 mutations of the first pass — 2 × `youth_activity_event_created`,
  5 × `youth_activity_event_updated` — then `youth_activity_profile_created`,
  `youth_activity_event_created`, `youth_activity_profile_deleted` as they happened. Rule 6 holds
  for every mutation a person made; cascade-deleted rows write none of their own (see `050-D1`).
- **Failure paths.** No activity chosen → *"Choose which activity this event belongs to."*;
  activity and title but no date → *"Give the date and time of the event."* Neither posted
  anything (`activity_events` stayed at 3 across both). With zero activities the form is **absent**,
  not an empty select (`#event-profile` does not exist), replaced by *"Add an activity first. A game
  belongs to a season, and a season belongs to a young person, so there is nowhere to put one
  yet."*
- **375px.** No horizontal overflow (`scrollWidth` 360 = `clientWidth` 360), no element extending
  past the viewport. Every `<button>` clears 44×44; the six elements under 44px high are all inline
  text links inside prose. Light and dark both render.
- **No hydration mismatch.** Zero console errors and zero warnings for the whole session, including
  with ward zone ≠ browser zone — server and client agree because both name the ward's zone.

Checklist corrections made during this walk:

1. **Step 3 pointed at `/youth`.** `youth-e` moved the schedule and the event form to
   `/youth/profiles`. Corrected.
2. **Step 10 was untestable as written.** "Change your machine's time zone" changes nothing after
   `c24d52b`. Rewritten to change the ward's zone, with the SQL, since there is no editing UI.
3. **Two lines asserted `youth-a-D2` FAILS.** Both now pass; rewritten to record the fix rather
   than the failure, which would have scored a pass as a defect.
4. **"The home/away field defaults to *Not yet known*"** described a state the app cannot reach —
   `youth-c` removed the default and renamed the option. Corrected to "Decide from the location"
   and "Home or away not set".
5. **The Notes section asserted the reversed rule** and was rewritten, keeping the old text quoted
   so the reversal reads as a decision rather than as a silent edit.
6. **Two checks added** for the ward's-zone rule, one of which is `050-D2`.

Method note: an early cancel driven by a synthetic `element.click()` inside `page.evaluate` showed
no UI change for 1.2 s and looked like a stale-cache defect. It was not — a real Playwright click
updates the card at 0 ms. Recorded because the false positive is cheap to repeat.

Not walked: every "needs a human eye" line — those are the review questions. `050-D1` and `050-D2`
are reported, not fixed.
