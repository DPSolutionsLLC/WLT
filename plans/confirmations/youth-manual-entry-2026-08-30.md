---
id: youth-manual-entry-scenario-050-rewalk
status: best-yet
commit: c24d52b
date: 2026-08-30
area: youth-manual-entry
related_retros: [youth-a-profiles-and-events, youth-c-coverage-and-calendar, youth-e-overview-and-cross-navigation, youth-f-support-percentage-and-youth-cards]
supersedes: none — first record for this area
---

## What was tested

**Harness scenario 050, "A game added by hand, at the right time of day" — a RE-walk.** Manual
event entry on `/youth/profiles`: creating a game, re-saving it, the daylight-saving pair,
cancelling and un-cancelling, the activity cascade, the three failure paths, and 375px in both
themes.

**Driven by an AGENT — Claude, via Playwright, against localhost:3000 backed by the hosted
project.** The user did not use the app. They reviewed a published walk report with five
screenshots and answered four judgement questions, all four the same day. That is agent-driven
evidence plus a screenshot review, not a person using the software.

**Why re-walked rather than walked.** The 2026-08-27 record predates `c24d52b`. This scenario's own
Notes asserted the reader's-own-zone rule that commit reversed, so step 10 and one review question
were testing a rule the app no longer follows.

**Every write was read back with the service client.** Nothing was confirmed from the screen alone.
The harness password was never typed into the page — the session was minted server-side with
`@supabase/ssr` and handed to the browser over a short-lived loopback server, and the cookie was
cleared at the end.

### What was NOT verified

- **The deployed build.** This walk was localhost only. `050-D2` was found by setting the ward's
  zone away from the machine's; production has not been re-checked since `deployed-build-2026-08-30`.
- **A real device.** 375px was a resized desktop viewport, not a phone.
- **Dark mode** was judged from one screenshot, not by using the app in it.
- **The automated suite was not run this session.** `npm test` was not executed. Both defects are
  precisely the kind it cannot see.
- **Step 10's human half** — whether the ward's-zone shift *reads* as correct to a leader — was
  answered as a product question rather than observed in use.
- **The bishopric path.** Everything was walked as `org_president` (Young Men). Scenario 049 covers
  ownership across four accounts; this one did not re-walk it.
- **`050-D1`'s full blast radius was read from the schema, not reproduced.** The profile → events
  cascade was observed twice; the events → logs → private notes hops were confirmed from migration
  009's `on delete cascade` clauses, not by seeding a follow-up and watching it disappear.

## Result

**The closest this area has been. 19 machine checks walked, 18 passed, 2 defects found, 2 older
defects confirmed fixed, 0 console errors or warnings.**

### What is working — observed values

| Check | Observed |
|---|---|
| Card after a full reload | `Fri, Jan 15, 2027, 7:30 PM` |
| Stored instant | `2027-01-16T02:30:00+00:00` |
| **Double conversion, three writes** | byte-identical each time — the bug this scenario exists for is absent |
| Edit prefill | `2027-01-15T19:30` — the wall clock, not the stored `02:30` |
| DST pair | `02:30Z` / `01:30Z` stored an hour apart, both rendering 7:30 PM |
| Ward's-zone rendering | `4:30 PM` under `Pacific/Honolulu` with the browser on `America/Denver` |
| Cancel / un-cancel | `status` cancelled → upcoming on the same row id `4cf04e7d-94f0-44c7-8701-cbc9c7c5b32a` |
| `calendar_id` on hand-entered rows | `null` / `null` |
| Audit | 7 rows for 7 mutations — 2 × `youth_activity_event_created`, 5 × `..._updated` |
| Refused with no activity | *"Choose which activity this event belongs to."*, events stayed at 3 |
| Refused with no date | *"Give the date and time of the event."*, events stayed at 3 |
| Zero activities | `#event-profile` absent entirely, replaced by *"Add an activity first…"* |
| 375px | `scrollWidth` 360 = `clientWidth` 360; every `<button>` ≥ 44×44 |
| Hydration | 0 errors, 0 warnings, including with ward zone ≠ browser zone |

**`youth-a-D2` is FIXED, both halves** — the two checklist lines that recorded it as failing were
rewritten. A new activity reaches the event form at 0 ms with no reload (options 2 → 3), and
removing one drops the schedule 3 → 2 and the select back to 2, also with no reload.

### What still needs work — both open, neither fixed

- **`050-D1` → ITER-031.** `ActivityProfileList.tsx:317` deletes an activity on one click with no
  confirm and no undo. Migration 009 cascades to events, attendees, follow-ups and the private
  notes rule 5 calls private forever. Fired twice during the walk (3 → 2 events, then 3 → 0). The
  audit row records `orgId`/`memberId`/`profileId` only, so nothing records what was lost. **Live in
  the app today**, which is why this record is not `confirmed`.
- **`050-D2` → ITER-032, deferred.** The date input still resolves its zone from ambient process
  state while the card beside it uses the ward's. Card `4:30 PM` vs field `19:30` under mismatched
  zones; on create, a leader typed 19:30 and the card returned 4:30 PM. **Unreachable today** —
  every ward is `America/Denver` and so is the fallback — and deferred by the user on that basis.
  Becomes live with a Phase 11 ward-timezone admin screen or Phase 12 multi-ward.

### User judgements, 2026-08-30 — two closed clean, two became work

- **Cancelled reads as called off** — *"i would assume that cancelled and called off are the same
  things."* No action; the checklist line passes.
- **The empty schedule reads deliberate** — confirmed. No action.
- **The timezone question was pushed back on, correctly** — *"another ward in another timezone is
  not going to be even interacting with a wards data."* That is why `050-D2` is deferred rather
  than scheduled. Recorded in ITER-032 alongside the distinction that matters: `c24d52b` fixed a
  bug about the *server* having no zone, which is not reopened.
- **Remove's ambiguity became two items.** The user asked whether Remove takes an event from the
  individual or globally — it is per-individual, and the button gives no way to know that, so the
  confusion is itself recorded as the finding. Their rule *"removal should not be allowed once
  follow up info has been input by any user"* is stronger than the confirm originally proposed and
  is now ITER-031's substantial part. Their further idea — **recording that a young person missed
  an event, so it leaves their statistics entirely** — became **ITER-030**, and is a genuine gap:
  the support percentage already excludes `away`, `cancelled` and `tbd` for the same underlying
  reason.

### Six corrections made to the scenario file itself

Five were the app moving on and the checklist not: step 3 pointed at `/youth` (moved to
`/youth/profiles` in `youth-e`); step 10's "change your machine's time zone" tests nothing after
`c24d52b` and was rewritten to change the ward's zone, with the SQL, since there is no editing UI;
two lines asserted `youth-a-D2` *fails*, which would have scored a working app as two defects; and
"the home/away field defaults to *Not yet known*" describes a string no screen has shown since
`youth-c`. The Notes section, which asserted the reversed rule in full, was rewritten with its old
text quoted inside so the reversal reads as a decision rather than a silent edit. Two checks were
added for the ward's-zone rule, one of which is how `050-D2` was found.

### Method note

An early cancel driven by a synthetic `element.click()` inside `page.evaluate` showed no UI change
for 1.2 s and looked like a stale-cache defect. It was not — a real Playwright click updates the
card at 0 ms. Recorded because the false positive is cheap to repeat and was nearly reported as a
third defect.

**Evidence:** five screenshots in `walk-050/` (git-excluded); walk report published as an Artifact.
**State left behind:** ward timezone restored to `America/Denver`, harness re-seeded to the state
the scenario specifies, no application code changed.
