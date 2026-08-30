---
id: deployed-build-timezone-fix
status: best-yet
commit: c24d52b
date: 2026-08-30
area: deployed-build
related_retros: [youth-b-ics-import, youth-a-profiles-and-events, youth-c-coverage-and-calendar]
supersedes: deployed-build-first-look
---

## What was tested

**The deployed build at `https://wlt-iota.vercel.app`, second look**, driven by an AGENT (Claude,
via Playwright) against the production deployment of `c24d52b`. The purpose was narrow: the
2026-08-29 record failed on server-side date rendering, and this walk asks whether the fix holds
in the only environment that can show the bug.

**No writes were made to production, and this was proved rather than asserted:** zero rows in
`audit_log` for the harness ward across the 90 minutes of the walk, and all seven relevant table
counts identical before and after (`activity_events` 4, `activity_attendees` 0, `activity_logs` 0,
`activity_occasions` 0, `youth_activity_profiles` 4, `households` 2, `members` 3).

**The harness password was never typed into the page.** The session was minted server-side in Node
with `@supabase/ssr` and handed to the browser as a cookie over a short-lived loopback server, so
no credential appears in the browser, the transcript, or this record. The cookie file was deleted
at the end of the walk.

## What was proved — the timezone fix holds

The harness ward still held the exact row from the bug report, so the original repro was available
rather than reconstructed. Each event's stored instant was converted to `America/Denver`
**independently in Node**, then compared with what Vercel served and what the browser showed after
hydration.

| Event | Stored | Computed independently | Server HTML | Hydrated DOM |
|---|---|---|---|---|
| Game against Roosevelt | `2027-01-16T02:30:00Z` | Fri, Jan 15, 2027, 7:30 PM | identical | identical |
| Winter concert | `2027-02-07T01:00:00Z` | Sat, Feb 6, 2027, 6:00 PM | identical | identical |
| Spring performance | `2027-03-20T21:00:00Z` | Sat, Mar 20, 2027, 3:00 PM | identical | identical |
| Game against Jefferson (past) | `2025-12-03T02:30:00Z` | Tue, Dec 2, 2025, 7:30 PM | identical | (event page) |

Four things had to line up, and the walk was arranged so any one failing would have shown it:

1. **The two zones genuinely differ.** Vercel runs UTC; the driving browser reported
   `America/Denver`. That asymmetry is precisely what the dev machine cannot produce.
2. **Server HTML and hydrated DOM are string-identical**, not merely both plausible. A missed
   formatter would make them disagree — which is what produced React #418 and the flash.
3. **The arithmetic was done outside the app**, so the app was not asked to mark its own work.
4. **A DST case is included.** The March event resolves at UTC−6 while the other three are UTC−7,
   so a fixed-offset fix would pass three rows and fail that one.

Also clean: zero occurrences of `Jan 16, 2027` across five pages, no React #418 or hydration
warning, no horizontal overflow at 375px or 1280px, and both themes rendering. **15 of the 18
sidebar destinations answer 200** — see below for the three that do not.

**The pre-hydration flash needs no separate test** — it was a symptom of the two sides disagreeing,
and they no longer do.

## User review — all three judgement items answered 2026-08-30, all "no action"

The three items below were put to the user on the review page. **None becomes work.** They are kept
here with their answers rather than deleted, so a later reader finds the decision instead of
rediscovering the observation.

1. **The 375px button overlap — ACCEPTABLE.** The user's word. Recorded as a known and accepted
   behaviour, not a defect to fix. If it is ever revisited, the reason to revisit would have to be
   new (a real device, or a leader actually missing a tap), because the desktop-viewport evidence
   below has already been weighed and accepted.
2. **The three unreachable sidebar links — LEAVE THEM. Expected.** Phases 9, 10 and 11 are not
   built yet. This is *not* a decision that the permission-gated nav is correct in general; it is
   that nothing is wrong while the phases are pending. The console-error side effect on every page
   load is accepted along with it.
3. **No time-zone marker on rendered times.** "It is to be assumed that it is according to that
   ward's time zone." This CONFIRMS the `visits-b`/`youth-a`/`youth-c` reversal recorded in
   CLAUDE.md §9 and closes the question of whether a marker is owed — it is not. Do not add one.

## Observation — NEW, not previously recorded (accepted, see item 1 above)

**The fixed navigation button overlays interactive controls at 375px.** Sampling `/youth`,
`/youth/calendar` and `/youth/profiles` at 200px scroll intervals, the button (fixed, 56×56, bottom
left) sat over an interactive control at **12 positions**, including `I'll go` — the control a
leader taps to commit to attending a game — plus `Edit`, `Show past events` and a `<select>`.

Not a screenshot artifact: proved with `elementFromPoint` after hiding the button, in a real
viewport, not a full-page composite. **It was NOT confirmed by clicking**, because pressing
`I'll go` would have written a row to production.

Mitigating and already checked: the button is a valid 56×56 tap target, it is hidden entirely at
desktop width, the page reserves space so nothing is covered at the very bottom of the scroll, and
a small scroll moves it. It is mobile-only — which for a mobile-first app is the primary target,
so that narrows the blast radius without reducing the severity.

## Re-confirmed

- **`/agendas` and `/admin/audit-log` return 404 while authenticated**, and Next.js prefetches
  both, so they put two console errors on **every** page a bishop opens. Phases 9 and 11 are not
  built; the links are.

  **Wider than the previous record stated, and the shape is the point.** Sweeping all 18 sidebar
  destinations found a **third** unreachable entry: **`/sacrament` answers 307 and silently
  returns the bishop to `/dashboard`** — no error, no explanation, the click simply does nothing.
  Phase 10 is not started.

  The cause is one line of design, not three oversights: `lib/auth/navigation.ts` gates each entry
  on a **permission the reader holds**, never on whether the page exists. A bishop holds
  `agendas.view`, `sacrament.view_assignments` and `audit.view`, so all three render and all three
  fail. Any future phase that ships a permission before its page will do this again. Two fail
  loudly (404) and one fails silently, which is arguably the worse of the two.
- **ITER-015 is wider than recorded.** Previously seen on one route, now confirmed on **four**:
  `/api/visits/progress`, `/api/youth/profiles`, `/api/assignments` and `/api/members` all answer
  `307 → /login` unauthenticated. (`/api/knowledge/search` answers 405 for a GET — the method check
  precedes the auth check, so that route is not evidence either way.)

## Still open

- **The visits module date formatting remains unproven, unchanged from the previous record.**
  `/visits` and `/visits/feed` return 200 but the harness ward holds zero appointments, zero visit
  logs and zero goals, so the pages render no dates at all and `formatAppointmentInstant` was never
  exercised. Closing it needs seeded appointment data, i.e. a write to the shared project — out of
  scope for a read-only walk, and a decision rather than an oversight.
- **No real device.** 375px was a resized desktop viewport.
- **Only the `bishop` account.** Org-president, ward-council and `sacrament_manager` (PIN) paths on
  production remain unwalked.
- **Dark mode was reviewed on screen, not by a person on a device.**

All three judgement items are answered and closed — see **User review** above. Nothing from this
walk is waiting on the user.

## Evidence

Screenshots in `walk-prod/` (excluded from version control). Review page published as an Artifact
on 2026-08-30.
