---
id: talks-planner-month-planner-and-contact-stages
status: best-yet
commit: 036698c
date: 2026-08-21
area: talks-planner
related_retros: [talks-b-month-planner, talks-a-pipeline-core]
supersedes: null
---

## What was tested

Scenarios 012 (the three-approval gate) and 013 (a visiting speaker with no phone number), walked
locally against the hosted `WLT` project. **Most** of the 70 checklist items across the two
scenarios, not all — which items were skipped was not recorded at the time.

Everything walked behaved correctly. No defects found, and no code changed as a result of the
walkthrough.

`HEAD` at the time of recording was `56be4af`, a docs-only commit; `036698c` is the commit
carrying the feature.

## Result

**What's working.** Both scenarios passed as far as they were walked. The 2-of-3 approval
indicator, the invalidation warning arriving before the edit rather than after, the explicit
**Approve plan** action, the waived contact stages reading "Not applicable - invited outside the
ward", and the member-vs-external speaker switch all behaved as designed. Automated coverage is
solid underneath: 887 tests pass, 40 of them new, with lint, typecheck and build clean.

**What still needs testing — and why this is best-yet rather than confirmed:**

1. **The deployed build has not been opened.** `036698c` was pushed on 2026-08-21 and everything
   above was walked locally. Vercel has not been checked at all.
2. **Realtime comment updates do not work, and this is known rather than untested.**
   `assignment_comments` is not in the `supabase_realtime` publication, so a second browser will
   not see a comment appear without a reload. Posting and reading are plain HTTP and work
   correctly; the channel logs a console error rather than failing silently. Fixing it is a
   one-line migration nobody has written. This alone is enough to keep the area off `confirmed`.
3. **The `sms:` handoff has not been tested on a real device.** CLAUDE.md §9 records that iOS and
   Android differ in how they parse `sms:` and where they truncate a long body, and that no
   desktop browser can stand in for it. The Copy fallback is the mitigation and *was* exercised
   locally, but the link itself is unverified on hardware.
4. **An unrecorded subset of the checklists was skipped.** Most likely candidates are the
   **Failure Behavior** console checks in both scenarios — the 403/409/400 assertions and the
   "audit_log untouched" verifications — since they sit at the bottom of both lists and are the
   most tedious to run by hand. These are exactly the checks the approved route-handler test slice
   would automate, after which they stop depending on anybody's patience.
5. **`scenario-008` (roster-b's member picker) is still unwalked**, now handed forward five times.
   `SpeakerField` is its first real consumer and `MemberPicker`'s interface is frozen, so a gap
   there would surface here first.

**To reach confirmed:** open the deployed build, add `assignment_comments` to the
`supabase_realtime` publication and re-check the comment thread in two browsers, walk the `sms:`
handoff on a phone, and complete the Failure Behavior sections of both scenarios (or land the
route-handler tests that replace them).
