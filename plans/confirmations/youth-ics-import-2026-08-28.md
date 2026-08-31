---
id: youth-ics-import
status: best-yet
commit: 45dd928
date: 2026-08-28
area: youth-ics-import
related_retros: [youth-b-ics-import, youth-a-profiles-and-events]
supersedes: null
---

## What was tested

**Scenarios 051 and 052 walked by an AGENT (Claude, via Playwright) against the hosted project,
on localhost:3000. The user reviewed the walk report and answered five judgement questions.** No
human drove the app.

**Record written 2026-08-30, from the walkthrough records in the two scenario files and the
screenshots in `walk-youth-b/`.** The walk itself happened on 2026-08-28; only this confirmation
record is late. It was written because `youth-b`, `youth-c` and `youth-d` were the only walked
slices in the project with no confirmation record — the evidence existed as scenario walkthrough
records and screenshots but had never been gathered into the form PENDING.md indexes. That gap is
itself worth recording: `plans/INDEX.md` still described all three slices as unwalked until the
same day, and that stale line sent a later session off to re-walk work that was already done.

**Every value was read back with the SERVICE CLIENT**, never trusted from the screen. Row ids in
scenario 052 were captured *before* the re-import so "updated, not replaced" could be proved
rather than assumed.

### What was NOT verified

- **The deployed build was not opened during this walk.** It has since been walked twice
  (`deployed-build-2026-08-29.md`, `deployed-build-2026-08-30.md`), and the second of those found
  and then confirmed the fix for a timezone bug that touches this slice's output directly — see
  "What changed underneath this record" below.
- **Step 10 of scenario 051 — changing the time zone — was not walked.** An OS-level action
  outside the browser, and the MCP browser tool cannot override a context's zone either. The
  machine-checkable half was proven instead by rendering the four stored instants through
  `EventList`'s exact options in `UTC`, `Pacific/Kiritimati` and `Europe/London`.
- **The browser zone equalled the ward zone** (`America/Denver`) throughout, so any disagreement
  between two zone rules would have been invisible. This is the limitation that later mattered.
- **No real device.** 375px was a resized desktop viewport.
- **Dark mode was read from screenshots and computed styles**, not viewed by a person.
- **The "same file against a different activity" check could not be performed with the seed as
  written** — the ward has one activity. It was walked by creating a second profile with the
  service client and removing it afterwards.
- **Judgement question J6 was never answered** — *"can you tell at a glance which rows came from
  the feed and which the ward typed in?"* The *From a schedule feed* chip is machine-verified as
  present, but nobody has said whether it reads.

## Result

**Scenario 051 — the first import. All seven code paths land at the hour the fixture's own
`DESCRIPTION` says.**

| Entry | Preview said | Stored instant | Denver local |
|---|---|---|---|
| vs Roosevelt (`TZID`) | Fri, 15 Jan 2027, 19:30 | `2027-01-16T02:30:00+00:00` | 15 Jan 19:30 |
| at Jefferson (`Z` UTC) | Fri, 22 Jan 2027, 19:30 | `2027-01-23T02:30:00+00:00` | 22 Jan 19:30 |
| vs Madison (floating) | Fri, 29 Jan 2027, 18:00 | `2027-01-30T01:00:00+00:00` | 29 Jan 18:00 |
| District Tournament | Fri, 5 Feb 2027, all day | `2027-02-05T07:00:00+00:00` | `all_day = true` |
| practice x 7 | Tue 16:00, 5/12/26 Jan + 2/9/16/23 Feb | — | 19 Jan absent (`EXDATE`) |
| Team photo (no UID) | Tue, 12 Jan 2027, 15:30 | `2027-01-12T22:30:00+00:00` | `source_uid = wlt-synth-a8e014f0…` |
| Season awards night | under problems | not created | *"This entry has no start date…"* |

- **The preview wrote nothing** — `activity_events` 0, `activity_calendars` 0, `audit_log` only
  `login`, `notifications` 0, re-read with the service client while the preview was on screen.
- **Counts agreed end to end:** preview 12/0/0/0, result screen 12/0/0/0, same four labels. The
  `roster-c` "two correct numbers that disagree" defect is absent.
- **`activity_calendars`: exactly one row**, `source_type = ics_upload`, `source_url = null`,
  `last_synced_at = 2026-08-28T04:29:52.018+00:00`.
- **Audit:** one `youth_calendar_imported` carrying `{created:12, updated:0, unchanged:0,
  notInFile:0, problems:1}` and **no event titles**. **Notifications: 0.**
- **`youth-a-D2` is fixed, and the proof is strong.** `/youth` was first loaded while the schedule
  was empty, so TanStack held a 0-event cache entry; after confirming, *Go to the schedule*
  rendered **"Schedule (12 upcoming events)"** with no reload.

**Scenario 052 — the re-import. All three guarantees hold: duplicate, revive and destroy are all
prevented.**

| Check | Observed |
|---|---|
| Preview | 2 to create, 1 to update, 9 already correct, 1 not in this file |
| "Not in this file" | *vs Madison* alone — the hand-entered team dinner correctly absent |
| After confirm | 12 → 14 rows, +2 and nothing else |
| Updated in place | `10ab84dc-…` still `10ab84dc-…`, instant moved by a week |
| **Hand correction survived** | still `upcoming/away` on the row this import wrote |
| Cancelled not revived | Roosevelt still `cancelled` |
| Absent not destroyed | Madison same id, same instant, still `upcoming` |
| Hand-entered untouched | `source_uid` and `calendar_id` still null |
| Third identical import | 0/0/12/1, confirm reads **"Nothing to import"**, disabled |
| No reload anywhere | `window.__walkSentinel` survived the whole round trip |

**Migration 055's unique index was proved directly rather than assumed**, because the two
concurrent confirms serialised and never exercised it:

| Insert attempted | Result |
|---|---|
| duplicate `source_uid`, **NULL** `source_recurrence_id` | **REFUSED** `23505` — `nulls not distinct` is load-bearing |
| duplicate `source_uid` + same `source_recurrence_id` | **REFUSED** `23505` |
| same `source_uid`, **new** `source_recurrence_id` | allowed — a series does not collapse |
| **two** hand-entered rows (both keys null) | **both allowed** — the partial `WHERE` works |

**Failure paths, all walked:** `.csv` refused client-side; prose in a `.ics` → **400**; no
`VEVENT` → **400**; 1.1MB → **413**; no activity chosen → button disabled; **the file edited on
disk between preview and confirm** → *"The file changed since you previewed it. Preview again."*
(`roster-c`'s `ERR_UPLOAD_FILE_CHANGED` reproduced live — the request never reached the server, so
`describeRequestFailure()` is the only thing that produced the right sentence).

**The permission gate, both directions.** `org_secretary` (`.view` and `.log`, not `.manage`): no
*Import a schedule* link, no *Add an event* form, **but all 12 events readable** — reads ward-wide,
writes gated. `/youth/import` renders *Not permitted*; both API routes return **403**.

**Three copy defects were found that a green suite could not see. All three fixed and
re-verified.**

1. **`youth-b-D1` — the all-day entry was told it carried no time zone.** An entry with no time
   has no zone to assume. Fixed at the boundary (`toPreviewEvent` sets `usedWardZone: false`)
   rather than at the render site, so a second reader of the field cannot bring the sentence back.
   Re-verified: exactly one flag on the page, on the floating 6:00pm game alone.
2. **`youth-b-D2` — `1/2/2027` on the one screen whose entire job is unambiguous dates.** A bare
   client-side `toLocaleDateString()` beside a dozen dates reading `Sat, 2 Jan 2027`; an en-GB
   reader takes it for 1 February. Fixed by formatting on the server through the same function
   every other date uses.
3. **`youth-b-D3` — "1 events updated".** The preview and the confirm button both pluralised; the
   result screen, which a leader reads last, did not.

**The fixes changed words only** — re-running scenario 052 end to end afterwards produced an
identical database.

**Judgement questions answered by the user:** the preview reads as *a description of what is about
to happen* (not a table dump); a leader who has never seen an `.ics` **can** tell what will be
created; a leader **can** tell nothing done by hand is at risk; "not in this file" reads as *a
statement*, not a warning; "All day" reads as *deliberate*.

## What changed underneath this record

**`c24d52b` (2026-08-30) reversed a rule this walk was conducted under.** At the time, the preview
formatted in the ward's zone and `/youth` in the reader's, and the walk explicitly recorded that
the browser zone equalled the ward zone so the difference was invisible. That difference has since
been removed: a turn-up-at `timestamptz` renders in the **ward's** zone everywhere, because a
`"use client"` component is server-rendered before hydration and on a server there is no reader —
`undefined` took the server's zone, UTC on Vercel, and production served a 7:30pm Friday game as
"Sat, Jan 16, 2027, 2:30 AM".

**None of the observed values above are invalidated** — they are stored instants and the walk read
them from the database, so they are zone-independent. What changed is the rendering rule, and
scenario 051's step 10, checklist line, Purpose and Notes were corrected on 2026-08-30 to match.
The production fix was independently confirmed to hold, including a DST case, in
`deployed-build-2026-08-30.md`.

## What would move this to confirmed

Working an import by hand on the deployed build: upload a real school feed, read the preview,
confirm, and check the hours on a real phone in both themes. J6 — whether the *From a schedule
feed* chip actually reads at a glance — needs a person's eye and has never had one.
