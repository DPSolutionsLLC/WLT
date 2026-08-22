---
id: talks-planner-realtime-and-route-tests
status: best-yet
commit: 0db037f
date: 2026-08-21
area: talks-planner
related_retros: [route-tests-and-realtime, talks-b-month-planner, talks-a-pipeline-core]
supersedes: talks-planner-month-planner-and-contact-stages
---

## What was tested

Scenario 012 (the three-approval gate) re-walked locally after `0db037f`, including the check it
could not previously make: 03-08 open in two browser sessions, a comment posted in one, appearing
in the other without a reload. Reported as passing.

Alongside it, the automated suite that replaced both scenarios' Failure Behavior sections: 959
tests across 66 files, with `npm run lint`, `npm run typecheck`, `npm run harness:typecheck` and
`npm run build` all clean. Migration 026 is applied to the linked `WLT` project.

## Result

**What's working.** Two of the five items blocking the previous record are closed.

1. **Realtime comment threads work.** `assignment_comments` is in the `supabase_realtime`
   publication as of migration 026, and a comment posted in one browser now appears in another
   without a reload. `tests/rls/realtime-isolation.test.ts` proves the boundary rather than
   assuming it: a ward B subscriber receives nothing from ward A, an *unfiltered* ward A
   subscriber receives nothing from ward B, and a non-bishopric role inside the ward receives
   nothing at all.
2. **The Failure Behavior checks no longer depend on anybody's patience.** Both scenarios' console
   sections are now 65 route tests over the four assignment routes, each retired check naming the
   test that replaced it. Two of those checks were also *wrong* as written — see below.

**What this round additionally found**, none of which was visible before realtime worked:

- **A second defect was hiding behind the first.** The previous record blamed the missing
  publication for the comment threads, which was true and complete-sounding. Adding the
  publication revealed that `CommentThread` used one channel topic for every thread on a Sunday,
  so the second thread's `.on()` threw and took the page down with a runtime error. Fixed, with a
  component test. **This was found by opening the page, not by any automated check.**
- **Scenario 012's "editing as `secretary` returns 403" was wrong** — it returns 404, because the
  route reads the row before checking the permission and RLS hides it first. It had been ticked by
  hand during the previous walkthrough.
- **Two existing tests were passing on luck.** The realtime negatives asserted an absence against a
  wall clock and passed while realtime was entirely dead; `roster-import` indexed into an unordered
  query and flipped when this slice added rows to `audit_log`. Both now assert against a positive
  signal.

**What still needs testing — and why this is best-yet rather than confirmed:**

1. **The deployed build still has not been opened.** Carried forward unchanged from the previous
   record, and now more interesting than it was: `0db037f` is the first deploy where the comment
   threads actually update live, and realtime behind Vercel's edge is not exercised by anything
   local. Migration 026 is already applied to the hosted database, so the schema and the code are
   in step — there is no ordering risk in checking it.
2. **The `sms:` handoff has not been tested on a real device.** Unchanged. CLAUDE.md §9 records
   that iOS and Android differ in how they parse `sms:` and where they truncate a long body, and
   that no desktop browser can stand in for it. The Copy fallback is the mitigation and was
   exercised locally; the link itself is still unverified on hardware.
3. **`scenario-008` (roster-b's member picker) is still unwalked** — now handed forward a sixth
   time. `SpeakerField` is its first real consumer and `MemberPicker`'s interface is frozen, so a
   gap there would surface in the talks planner first.
4. **Scenario 013 has not been re-walked since it was trimmed.** Its Failure Behavior section was
   replaced by tests in the same change, but the walkthrough itself was not repeated. Nothing in
   `0db037f` touches the waiver or the external-speaker path, so the risk is low — but the record
   should say it was not re-run rather than imply it was.
5. **The realtime check was walked once, by one person, on one machine.** It is a genuine pass and
   it is the first time that check has ever been possible. It is not yet evidence about a ward
   council meeting with four people on the same Sunday.

**To reach confirmed:** open the deployed build and re-check the comment thread in two browsers
against it, walk the `sms:` handoff on a phone, and re-walk scenario 013 and scenario 008.
