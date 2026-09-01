---
id: deployed-build-youth-j
status: confirmed
commit: df25b40
date: 2026-08-31
area: deployed-build
related_retros: [youth-j-team-and-roster, youth-h-season-close-and-safe-remove]
supersedes: deployed-build-2026-08-30
---

## What was tested

**The deployed build at `https://wlt-iota.vercel.app`, third look**, driven by an AGENT (Claude,
via Playwright) against the production deployment of `df25b40` — minutes after the youth-j push.
The user asked for this check and reviewed the result; they did not drive the browser.

The purpose was narrow and specific: **youth-j shipped a page that had never been server-rendered
on a UTC box.** `/youth/history/[member_id]` is a pure server component that formats
`timestamptz` values, and the two previous production records exist because exactly that shape
shipped a wrong-day bug that localhost structurally cannot show — in dev the server and the
browser share `America/Denver`, on Vercel they do not.

**Method.** Every expected rendering was computed **independently in Node** from the stored
instants, before the browser was opened, so the screen was compared against an expectation rather
than allowed to explain itself. The server's own HTML was then fetched with `fetch()` from inside
the page and the date strings read out of the raw markup — that is what the server emitted, before
React touched anything — and compared with the hydrated DOM.

### Deviation from the 2026-08-30 method, stated rather than buried

That walk minted a session server-side and handed it to the browser over loopback, so no
credential was typed into the page. **This walk signed in through the production login form
instead.** The scripted route needs `context.addCookies()`, which is only reachable through
Playwright's `run_code_unsafe` tool, and the permission classifier blocked it; routing around that
would have been the wrong move. The harness password is a test-only credential for accounts in an
isolated ward, and it already appeared in this session's transcript from the localhost walk.

**The cost is one `login` audit row**, where the previous walk proved zero. It is accounted for
below rather than left looking like an unexplained write, and it was deleted with the ward.

### NOT verified

- **No real device.** 375px was a resized desktop viewport.
- **The visits module's formatter is STILL unproven**, unchanged from both previous records: the
  harness ward has no appointments, logs or goals, so `/visits` renders no dates at all. Closing it
  needs a write to production, which this walk would not make.
- **`/youth/events/[id]` was not re-checked** — it was proved on 2026-08-30 and youth-j did not
  change its formatter.
- **The 375px nav-button overlap from the 2026-08-30 record was not re-measured.** The user has
  already ruled it acceptable, so it was not re-litigated; it is presumed still present.
- **The three dead sidebar links were not re-checked.** Expected until Phases 9/10/11 land, by the
  user's own instruction.
- **Migration 063 was applied shortly AFTER this walk**, which is the correct order: this walk is
  the evidence the deploy was healthy first. The columns `youth_activity_profiles.member_id` and
  `activity_events.youth_attended` are now confirmed absent, and `visit_goals.goal_period_start`
  with them, so ITER-018's migration 051 is applied too. Nothing in this walk was affected — every
  page above was read while both columns still existed, and the running build stopped selecting
  them at deploy.
- **Only `ym-president` was walked.** No bishopric, no `org_secretary`, no PIN account.

## Confirmed by the user 2026-08-31

Marked **confirmed** on the user's instruction, closing Phase 8's youth work out. The
"NOT verified" list above is kept deliberately and is part of the baseline: this record is what a
future regression gets diffed against, so what was never checked has to stay visible.

## Result — the youth-j pages are correct on production

### Every date matches a value computed outside the app

The stored instants and the Node-computed expectations, against what production served:

| Event | Stored | Computed in Node (America/Denver) | Production |
|---|---|---|---|
| Basketball G01 | `2026-07-25T01:30:00+00:00` | Fri, Jul 24, 2026, 7:30 PM | identical |
| Basketball G02 | `2026-07-29T01:30:00+00:00` | Tue, Jul 28, 2026, 7:30 PM | identical |
| Basketball G03 | `2026-08-01T01:30:00+00:00` | Fri, Jul 31, 2026, 7:30 PM | identical |
| Basketball G04 | `2026-08-04T01:30:00+00:00` | Mon, Aug 3, 2026, 7:30 PM | identical |
| **Basketball G05** | `2026-08-08T01:30:00+00:00` | **Fri, Aug 7, 2026, 7:30 PM** | **identical** |
| Basketball G06B | `2026-08-15T01:30:00+00:00` | Fri, Aug 14, 2026, 7:30 PM | identical |
| Basketball G09 | `2026-09-04T01:30:00+00:00` | Thu, Sep 3, 2026, 7:30 PM | identical |
| Basketball G12 | `2026-09-24T01:30:00+00:00` | Wed, Sep 23, 2026, 7:30 PM | identical |

**G05 is the one that matters most.** It is stored at `01:30Z` on 8 August — the *following* day
in UTC — and production renders it *Fri, Aug 7, 7:30 PM*. A server leaking its own zone would have
said "Sat, Aug 8, 1:30 AM", which is precisely the shape of the bug the 2026-08-29 record failed
on.

**Server HTML string-identical to the hydrated DOM** on `/youth/history/[member_id]`: five date
strings, matched as sets, `identical: true`. On `/youth/profiles` and `/youth/calendar` the raw
markup from Vercel carries the four upcoming events at 7:30 PM with **zero** matches for any early
morning hour. **No React #418, and zero console messages of any level on production.**

### The 062-D1 fix holds on production, in both places

Fixed on localhost hours earlier; this is the first time either has been server-rendered.

- **`/youth`, Maya's expanded card:** `Maya Alvarez (5 events)` listing G01–G05 — her window
  exactly. Before the fix this was `(12 events)`.
- **`/youth/history/[member_id]`, the second site, which scenario 062 could not reach** because it
  seeds no closed season: Maya renders **5 events (G01–G05), 75%, "3 of 4 home games played"**;
  Tyler renders **5 events (G05–G08), 50%, "2 of 4 home games played"**. Two different five-event
  lists out of one thirteen-game season is what says the window is per person rather than
  accidentally right, and it now says it on production.

### Other youth-j surfaces, first time on production

- The **roster panel** renders: four names under "Who is on this", `Left 7 Aug 2026` and
  `Joined 7 Aug 2026` as **days with no time**, plus `Change the date` / `Still on the team` /
  `Remove from this activity`.
- The four support percentages carry the roster windows: **60 / 63 / 71 / 75**, with Maya's
  tooltip correctly lacking a next-game clause because she has no next game.
- **`youth-h`'s closed-season rendering is confirmed on production too**, incidentally: with the
  season closed, all four young people stay on `/youth` carrying a `Varsity basketball · Finished`
  pill and `No activity running just now.` — the 060-D1 fix, with no count beside a list that
  duplicates it. Nobody vanished from the ward.
- No horizontal overflow at 375 or 1280 (`scrollWidth` 360 = `clientWidth` 360). No raw uuid on
  screen. Both themes render.

### The write accounting

**Nine of ten table counts identical before and after** — `youth_activity_profiles` 1,
`activity_events` 13, `activity_attendees` 6, `activity_logs` 0, `activity_occasions` 0,
`activity_roster` 4, `activity_event_participation` 1, `households` 4, `members` 4.

**`audit_log` went 0 → 1**, and the row is the expected one:
`login · auth · {"role":"org_president"}` at `2026-09-01T01:02:03Z`. **No content was created,
changed or deleted through the production app.**

**Two setup writes were made outside the app, and counts alone would not reveal the second, so it
is stated rather than implied:** the harness ward was seeded before the walk, and
`youth_activity_profiles.closed_at` was set with the service client to make the history page
reachable at all. That second one changes a field, not a row count, so the identical counts above
do **not** cover it. Both were confined to the Harness Test Ward, and **the entire ward and all
four auth users were deleted at the end** — `seed:clean` reported "Nothing outside the test ward
was touched."

## What would move this to confirmed

A real device, and the visits formatter — the one thing all three production records have failed
to close, because proving it needs an appointment in the database and nobody has been willing to
write one to production. That is now the oldest open question about the deployed build, and it
will not close by itself.
