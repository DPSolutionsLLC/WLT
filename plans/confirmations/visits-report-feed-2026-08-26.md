---
id: visits-c-report-feed-and-cross-org
status: best-yet
commit: 16b7c03
date: 2026-08-26
area: visits-report-feed
related_retros: [visits-c-report-feed-and-cross-org, visits-a-goals-logs-and-notes, visits-b-progress-dashboard, route-tests-and-realtime]
supersedes: null
---

## What was tested

Scenarios 041 (the feed, read state, and Next Unread) and 042 (cross-org visibility toggle),
walked end to end against the hosted project, plus the full automated suite and a production
build.

**Driven by an AGENT (Claude, via `/walk`) in a real browser through Playwright. The user
reviewed the screenshots and answered seven judgement questions.** This is not a person using
the app — it is agent-driven evidence plus a human screenshot review, and the two are different
kinds of evidence. Every write claimed below was re-read from the database with the
service-role client afterwards; nothing here was confirmed from the screen alone.

**`area: visits-report-feed`, deliberately NOT `visits`.** The existing `visits` best-yet
(842968d, visits-d) covers attempts, appointments and participants, and its open items — the D3
companion-picker decision above all — are untouched by this work. Filing this under `visits`
would have superseded that record and quietly discarded a live question. Two areas, two records.

### NOT verified

- **The deployed build has not been opened.** Everything below is localhost against the hosted
  database.
- **No real device.** 375 px was a resized desktop browser, not a phone in a hand.
- **Dark mode was reviewed only through screenshots**, never used.
- **Mark all as read under an active filter was not re-walked** after the cache-family fix
  landed. The route test covers the id set; the screen behaviour after that specific change is
  reasoned, not observed.
- **Load more / pagination was never exercised** — every fixture fits on one page. The cursor is
  covered by unit and route tests only.
- **`youth_activity` read-status** is proven by route test (a ward council member marking an
  activity read) and by nothing on a screen, because Phase 8 has no screen yet.
- The **audit viewer** does not exist yet, so the audit rows were read from `audit_log` directly.
- The **notification bell is an inert placeholder** until Phase 11, so the two notifications were
  read from the `notifications` table, not opened.

## Result

### Working — observed values, not ticks

**Per-user read state (the assertion the feature turns on).**
- EQ president opened on **8 unread**; EQ counselor on **5 unread**, from twelve seeded visits
  with the four Relief Society ones correctly absent (visibility off).
- Tapping the Calderon tile moved the count **8 → 7 immediately** and wrote
  `read_at=2026-08-26T16:37:20.116Z`.
- Mark all as read wrote **8 rows sharing ONE `read_at` timestamp** (`distinct = 1`), and the
  Doyle row **kept `flagged=true`** — the mark-all upsert did not clobber an existing bookmark.
- **After the president marked everything read, the counselor still opened on 5 unread**, with
  Brooks, Ellsworth and Grant read and the other five not. Doyle's bookmark did **not** appear
  for them.
- Bookmarking wrote `read_at=null, flagged=true` — bookmarked without claiming to be read — and
  the unread count stayed at 8.
- Declining the Mark all confirmation wrote **zero** rows.

**Next unread.** Walked Calderon → Doyle → Ellsworth → Fairbanks → Grant → Halvorsen → **wrapped
to Andersen** → Brooks. It resumes after the focused tile rather than restarting at the top, and
disables itself while a save is in flight, so a fast double press is a no-op.

**Privacy.** `PRIVATE-ALPHA`, `PRIVATE-BRAVO`, `PRIVATE-CHARLIE`, the multi-line note's second
line ("porch light"), and even the word "private" were **absent from the page text** for all
three accounts, in both visibility modes.

**Rendering.** Long note truncated at **118 characters** ending `…with her sister…`, cut at a
word boundary. Two notes read "No shared note". Ellsworth carried "Attempted"; the other seven
carried no outcome label. Halvorsen read "Nobody recorded as taking part" rather than the
recorder's name.

**Cross-org toggle.** Confirmation verbatim: *"Turn cross-organization visibility ON? / Every
organization's leaders can read every organization's visit reports. / Management stays inside
each organization either way… / Private notes are never shared, in either mode."*
- **The merge held twice.** After the bishop's toggle and the counselor's, `role_access`,
  `default_speaking_slots: 5` and `timezone` were **unchanged**. Confirmed on screen too: the
  ward secretary, who holds `visits.view` only through that seeded override, could still open
  `/visits` afterwards.
- 2 audit rows carrying `{crossOrgVisibility, previousCrossOrgVisibility}`, attributed to the
  bishop and to counselor-1 respectively.
- The bishop's change notified **counselor-1 and counselor-2 only**; counselor-1's change
  notified **the bishop and counselor-2**. Never the actor.
- A **counselor** toggled it exactly as the bishop did. An org president got "Not permitted" at
  `/admin` with no card and no nav link.

**Failure path.** With `/api/reports/read-status` forced to 500, the optimistic update **rolled
back**, the count returned to its previous value, the server's message appeared in a
`role="alert"`, and **no row was written**.

**Mobile.** `scrollWidth === clientWidth` at 375 px. Next unread 114×44, Mark all as read
138×44, tile bodies 214×172, stars 44×44.

### Three defects found and fixed, then re-verified

1. **`/visits` offered "Flag for ward council" on OTHER organizations' visits** once cross-org
   visibility went on. RLS refused the writes — `flagged_for_ward_council` stayed `false`,
   `flag_sent_at` stayed `null`, no notification — so nothing leaked, but a leader was invited
   through a locked door. Fixed with `canManageVisitLog()` mirroring `visit_logs_update`.
   Re-verified: 4 Elders Quorum visits keep the button, 4 Relief Society have none.
2. **The filter dropdown listed all seven ward organizations**, five of which had never logged a
   visit and answered with an empty feed. Now derived from organizations that have reports.
3. **A bookmark made under one filter was invisible under another** until reload — each filter is
   its own cache key. Mutations now patch every cached variant. Re-verified: Grant bookmarked
   under the Relief Society filter shows bookmarked in the "every organization" view, and the
   database agrees.

### Still needs attention

- **The realtime suite is flaky under load.** `tests/rls/realtime-isolation.test.ts` timed out
  its WebSocket during the 23-minute full run with a dev server and a browser competing for two
  cores; it passed alone in 12 seconds. Second time realtime tests have been fragile here after
  `route-tests-and-realtime`. Nothing in this work touches realtime — the feed deliberately has
  no subscription — but a suite that fails environmentally trains people to ignore it.
- **Two inline text links measure 20 px tall** ("Visit tracker" in the header, "visit tracker" in
  the closing sentence) against the 44 px every actual button clears. Matches the existing link
  convention on `/admin`; raise it if inline navigation links should be held to the same bar.
- **The floating ☰ navigation button overlaps a tile at 375 px.** Confirmed pre-existing — it
  does the same on `/visits` — so it belongs to the app shell, not this slice.

### Test counts at this commit

2435 of 2436 passing (the one failure is the realtime flake above). New suites:
`reportTiles` (17), `visitOwnership` (7), `report-read-status` (8), `reportReadStatus` (13),
`crossOrgVisibility` (24). `lint`, `typecheck`, `harness:typecheck` and `build` all clean.
