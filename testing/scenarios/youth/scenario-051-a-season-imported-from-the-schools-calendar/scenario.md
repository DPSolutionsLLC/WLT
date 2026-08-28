---
name: A season imported from the school's calendar
scope: youth
part: 2
tags: [youth, import, timezones, smoke]
prerequisites: none
---

## Purpose

The hour is the thing this slice most likely gets wrong, and no unit test can answer whether the
hour a leader **reads on the card** is the hour the school published. There are four conversions
between the file and the screen — the ICS wall clock resolved against a zone, the instant stored as
a `timestamptz`, the instant read back, and the instant rendered in the reader's own zone — and
`tests/lib/icsTimezone.test.ts` only proves the first two.

08-youth-activities.md is blunt about the cost: *"A game showing at the wrong hour makes the whole
feature useless."* The failure mode worth fearing is the one that **passes on the dev machine and
ships wrong** — `ICAL.Time.toJSDate()` resolves a floating time against the process's own zone,
which is `America/Denver` here and UTC on Vercel.

Seeding matters because the fixture needs a genuine multi-timezone `.ics` file that takes twenty
minutes to build by hand and that a tester would quietly build half of.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `ym-president@harness.wardleadershiptools.test` (Young Men president) |
| Households | Brooks (2201 Canyon Road) |
| Members | 1 youth — Ethan Brooks, `active`, in Young Men |
| Activity profiles | 1 — *Varsity basketball*, Lincoln High School, owned by Young Men |
| Events | **none** |
| Calendars | **none** |

**Fixture file:** `lincoln-basketball.ics`, committed in this directory. Seven `VEVENT`s covering
seven distinct code paths, and **each one states its own expected local time in its
`DESCRIPTION`** so the checklist can be answered by reading the file beside the screen:

| Entry | Shape | Expected in the app |
|---|---|---|
| vs Roosevelt | `TZID=America/Denver`, `VTIMEZONE` present | Fri 15 Jan 2027, **7:30pm** |
| at Jefferson | `Z`-suffixed UTC (`20270123T023000Z`) | Fri 22 Jan 2027, **7:30pm** |
| vs Madison | **floating** — no zone at all | Fri 29 Jan 2027, **6:00pm**, marked as assumed |
| District Tournament | `VALUE=DATE`, all day | Fri 5 Feb 2027, **All day** — never 12:00am |
| practice | `RRULE:FREQ=WEEKLY;COUNT=8` + one `EXDATE` | **7 rows** at 4:00pm |
| Team photo | **no `UID`** | Tue 12 Jan 2027, 3:30pm, `source_uid` starts `wlt-synth-` |
| Season awards night | **no `DTSTART`** | **Not created**, listed under problems |

**Total: 12 events created, 1 problem reported.**

**Sign in with:** `ym-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-051-a-season-imported-from-the-schools-calendar`
2. `npm run dev`, then open http://localhost:3000
3. Sign in and open **/youth**. Note the empty schedule.
4. Follow **Import a schedule**, beside *Add an event*.
5. Choose *Ethan Brooks — Varsity basketball* and the file `lincoln-basketball.ics` from this
   scenario's directory.
6. Press **See what this will do** and read the preview *without confirming yet*. Compare each row
   against the `DESCRIPTION` of the matching `VEVENT` in the file.
7. Confirm.
8. Follow **Go to the schedule** back to `/youth` — **do not reload the page.**
9. Reload, and check the rows in Supabase: `activity_events`, `activity_calendars`, `audit_log`,
   `notifications`.
10. Change your machine's time zone (System Settings → Date & Time), reload, and read the hours
    again.

## Verification Checklist

### Machine-checkable

- [ ] The preview names every event **with the day, date and hour** it will be created at — not a
      raw ISO string, and not a count alone.
- [ ] The `TZID` game, the UTC game and the floating game each show the hour the fixture's own
      `DESCRIPTION` says: **7:30pm, 7:30pm, 6:00pm**.
- [ ] The floating game is marked on the preview as having carried no time zone. The `TZID` game
      and the UTC game are **not** marked.
- [ ] **The all-day tournament is not marked as "carried no time zone" either.** An entry with no
      time cannot meaningfully be in a zone, so the note is noise beside the words "all day".
      ADDED 2026-08-28 during the walk, where it FAILED as defect `youth-b-D1`; **fixed the same
      day** and re-verified in the browser. Regression test:
      `tests/lib/icsIdempotent.test.ts` → *"does not claim an all-day entry carried no time
      zone"*, paired with *"still says so for a TIMED entry that carried no zone"* so the fix
      cannot become "delete the feature".
- [ ] The all-day tournament reads **"All day"**, not `12:00am`, on the preview *and* on `/youth`.
- [ ] The recurring practice appears **7 times** — eight weekly minus the one `EXDATE`.
- [ ] The entry with no `DTSTART` is listed under problems with a sentence, and is **not** created.
- [ ] The preview says **12 to create, 0 to update, 0 already correct, 0 not in this file**.
- [ ] Confirming creates exactly the events the preview named, and the result screen shows the
      **same four numbers under the same labels**.
- [ ] **After confirming, `/youth` shows the imported games without a reload.** This is the
      `youth-a-D2` shape and is the checklist line most likely to fail.
- [ ] `activity_calendars` has exactly **one** row for this profile, `source_type = 'ics_upload'`,
      `source_url` null, `last_synced_at` set.
- [ ] Every created row has a non-null `source_uid` and `calendar_id`, `status = 'upcoming'` and
      `event_type = 'tbd'`.
- [ ] The team-photo row's `source_uid` starts `wlt-synth-`.
- [ ] The seven practice rows share **one** `source_uid` and have **seven distinct**
      `source_recurrence_id` values.
- [ ] An `audit_log` row with action `youth_calendar_imported` exists, carrying the counts and
      **not** the event titles.
- [ ] **No notification was emitted** — `notifications` for this ward is unchanged.
- [ ] Imported rows carry a *From a schedule feed* marker on `/youth`; nothing entered by hand does.
- [ ] Change the machine's time zone, reload, and every game still reads at the hour the school
      published it **in the new zone** — i.e. the instants did not move, only their rendering.
- [ ] No horizontal overflow at 375px, and every **button and form control** at least 44×44.
      CORRECTED 2026-08-28: this line said "every control", which no page in this app can satisfy
      — `/roster` and `/roster/import` both surface their import as a ~20px inline text link, and
      `/youth` follows that same convention. Inline text links in prose are exempt here (WCAG
      2.5.8 exempts them too); whether that app-wide convention is right is a separate question
      raised in the Walkthrough record.

### Needs a human eye

- [ ] Does the preview read as a **description of what will happen**, or as a table dump?
- [ ] Could a leader who has never seen an ICS file tell from the screen what is about to be
      created?
- [ ] Does "This entry carried no time zone, so it is shown in the ward's" read as information
      rather than as an error?
- [ ] Is it obvious that **nothing has been written yet** while the preview is on screen?

## Failure Behavior

- [ ] Choosing a `.csv` or a `.png` is refused before any upload, with a sentence naming `.ics`.
  Automated: `tests/routes/youthCalendarImport.test.ts` → *"refuses a file that is not a .ics"*.
- [ ] A `.ics` file containing prose rather than a calendar is refused with a sentence naming the
      likely cause — **a 400, never a 500**.
  Automated: same suite → *"refuses a file of prose"*.
- [ ] A calendar with no `VEVENT` at all is refused with *"That file has no events in it…"*.
- [ ] Choosing no activity leaves **See what this will do** disabled.
- [ ] **Edit the .ics file on disk while the preview is open**, then confirm. The message is
      *"The file changed since you previewed it. Preview again."* — never *"check your
      connection"*. This is the `ERR_UPLOAD_FILE_CHANGED` path and it must be tested by actually
      editing the file, not by trusting the route.
- [ ] Signed in as an account with `youth_activities.view` but not `.manage` (an org secretary),
      `/youth` shows no **Import a schedule** link and `/youth/import` shows *Not permitted*.

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Machine and browser zone was **America/Denver**, which happens to equal the ward zone — see the
limitation at the end. Every instant below was read from `activity_events.event_date` with the
service client, never from the screen.

**The hours are all correct, and the preview writes nothing.** One copy defect found
(`youth-b-D1`), plus two more found while walking scenario 052 that apply here too.

Observed values, preview screen (formatted in the ward zone, en-GB):

| Entry | Preview said | Stored instant | Denver local |
|---|---|---|---|
| vs Roosevelt (`TZID`) | Fri, 15 Jan 2027, 19:30 | `2027-01-16T02:30:00+00:00` | 15 Jan 19:30 |
| at Jefferson (`Z` UTC) | Fri, 22 Jan 2027, 19:30 | `2027-01-23T02:30:00+00:00` | 22 Jan 19:30 |
| vs Madison (floating) | Fri, 29 Jan 2027, 18:00 | `2027-01-30T01:00:00+00:00` | 29 Jan 18:00 |
| District Tournament | Fri, 5 Feb 2027, all day | `2027-02-05T07:00:00+00:00` | 5 Feb 00:00, `all_day = true` |
| practice × 7 | Tue 16:00, 5/12/26 Jan + 2/9/16/23 Feb | — | 19 Jan correctly absent (`EXDATE`) |
| Team photo (no UID) | Tue, 12 Jan 2027, 15:30 | `2027-01-12T22:30:00+00:00` | `source_uid = wlt-synth-a8e014f0265aade9c93d…` |
| Season awards night | listed under problems | not created | *"This entry has no start date…"* |

Every one matches the intended local time written into that `VEVENT`'s own `DESCRIPTION`.

- **The preview wrote nothing.** `activity_events` 0, `activity_calendars` 0, `audit_log` only
  `login`, `notifications` 0 — re-read with the service client immediately after the preview
  rendered, not inferred from the screen.
- **Preview counts: 12 / 0 / 0 / 0. Result screen: 12 / 0 / 0 / 0**, same four labels. The
  `roster-c` "two correct numbers that disagree" defect is absent.
- **After confirming: 12 rows**, every one with `calendar_id` set, non-null `source_uid`,
  `status = upcoming`, `event_type = tbd`. The seven practices share one `source_uid` and carry
  seven distinct `source_recurrence_id`s (`20270105T160000` … `20270223T160000`).
- **`activity_calendars`: exactly one row**, `source_type = ics_upload`, `source_url = null`,
  `last_synced_at = 2026-08-28T04:29:52.018+00:00`.
- **Audit:** one `youth_calendar_imported` carrying
  `{created:12, updated:0, unchanged:0, notInFile:0, problems:1}` and **no event titles**.
- **Notifications: 0**, as Decision 7 requires.
- **`youth-a-D2` IS FIXED, and the proof is strong.** `/youth` was first loaded while the schedule
  was EMPTY, so TanStack held a 0-event cache entry. After confirming, *Go to the schedule*
  (a client-side `<Link>`, no reload) rendered **"Schedule (12 upcoming events)"**. A wizard that
  failed to invalidate would have served the stale 0. Re-proved in scenario 052 with a
  `window.__walkSentinel` that survived the navigation, confirming no reload occurred.
- **`/youth` rendering:** all-day reads **"Fri, Feb 5, 2027 · All day"** — never `12:00am`. Every
  imported row carries a *From a schedule feed* chip; nothing hand-entered does.

Failure paths, all walked:

- `.csv` → refused client-side before any upload, *"That file is not a .ics…"*, button stays disabled.
- Prose in a `.ics` → **400** *"That calendar file could not be read…"* (status read off the
  response, not inferred — a 500 would have given the generic fallback instead).
- `VCALENDAR` with no `VEVENT` → **400** *"That file has no events in it…"*.
- 1.1MB file → **413** *"That file is larger than 1MB…"*.
- No activity chosen → *See what this will do* disabled.
- **The file edited on disk between preview and confirm** → *"The file changed since you previewed
  it. Preview again."* The console shows `net::ERR_UPLOAD_FILE_CHANGED` surfaced as a bare
  `TypeError: Failed to fetch` — **the request never reached the server**, so the `fileHash` check
  never got to answer and `describeRequestFailure()` is the only thing that produced the right
  sentence. This is the `roster-c` retro reproduced exactly, and the defence works. Nothing was
  written.
- **`org_secretary`** (`ym-secretary@…`, holds `.view` and `.log`, not `.manage`): no *Import a
  schedule* link, no *Add an event* form, **but all 12 events readable** — reads ward-wide, writes
  gated. `/youth/import` renders *Not permitted*; both API routes return **403** when called
  directly.

Checklist corrections made during the walk:

1. **Added a line for the all-day entry's zone note**, which currently FAILS (`youth-b-D1`). The
   original line said only "the other two are not marked" and did not describe the all-day entry.
2. **Reworded the 44×44 line** to "every button and form control". As written it could not pass on
   any page in this app: `/roster`, `/roster/import` and `/youth` all use ~20px inline text links
   for their import entry points. Measured: no horizontal overflow at 375px in either theme; the
   only sub-44px controls anywhere were those inline links.

Not walked:

- **Step 10, changing the machine's time zone.** An OS-level action outside the browser, and the
  MCP browser tool cannot override a context's zone either. The machine-checkable half IS proven:
  the stored values are instants, so they are zone-independent by construction, and rendering the
  four stored instants through `EventList`'s exact `toLocaleString` options in `UTC`,
  `Pacific/Kiritimati` and `Europe/London` gives the correct local hour in each. What is NOT
  proven is the full reload path under a different OS zone, and whether the shift *reads* as
  correct to a travelling leader. Left for a person.
- Every "needs a human eye" line — those are the review questions, gathered on the review page.

**Limitation worth recording:** the browser zone equalled the ward zone (`America/Denver`), so the
deliberate difference between the preview (ward zone) and `/youth` (reader zone) was invisible in
this walk. A tester in a different zone would see them disagree, which is correct but surprising.

### Addendum — 2026-08-28, the review answered and the defects fixed

The five judgement questions raised from this scenario were answered by the user:

| | Question | Answer |
|---|---|---|
| J1 | Does the preview read as a description or a table dump? | **A description of what is about to happen** |
| J2 | Could a leader who has never seen an `.ics` tell what will be created? | **Yes** |
| J3 | Can a leader tell nothing done by hand is at risk? | **Yes** |
| J4 | Does "not in this file" read as a statement or a warning? | **A statement** |
| J5 | Does "All day" read as deliberate? | **Yes** |

**J6 was not answered** — *"can you tell at a glance which rows came from the feed and which the
ward typed in?"* It is left open rather than assumed; the *From a schedule feed* chip is in place
and machine-verified, but nobody has said whether it reads.

**`youth-b-D1` is fixed** (`lib/youth/ics/buildImportPreview.ts`, `toPreviewEvent`). `PreviewEvent`
now carries `usedWardZone: false` for an all-day entry. The occurrence's own flag stays true —
ward midnight genuinely is the ward's zone — but this field exists only to decide whether to TELL
the reader a zone was assumed, and an entry with no time has nothing to assume. Corrected at the
boundary rather than at the render site, so a second reader of the field cannot bring the sentence
back somewhere else.

Re-verified in the browser against this fixture, and the fix is precise rather than blunt:

| Row | Flagged "carried no time zone"? |
|---|---|
| District Tournament (all day) | **no** — was yes, this was the defect |
| vs Madison (floating 6:00pm) | **yes** — still flagged, correctly |
| vs Roosevelt (`TZID`) | no |
| at Jefferson (`Z` UTC) | no |

Exactly one flag on the page, on the one entry that earns it.

## Notes

- **The fixture's dates are in early 2027.** If this scenario is walked after February 2027 the
  imported games are in the past, so `/youth` needs **Show past events** to display them — the
  checklist lines still hold, they are just one click further away. Re-dating the fixture would
  invalidate the expected local times written into every `DESCRIPTION`, so the dates are left
  alone deliberately.
- **The preview formats in the WARD's zone; `/youth` formats in the READER's.** Both are right and
  the difference is deliberate. On the preview the question is *"will this show at the hour the
  school published"* — the school and the ward are in the same place. On the schedule the question
  is *"when do I have to turn up"*, which is the rule `lib/visits/visitDates.ts` already states for
  a `timestamptz`. If the tester's machine is in `America/Denver` the two agree and this
  distinction is invisible; step 10 is what makes it visible.
- Nothing here tests re-importing. That is scenario 052.
