# Pending Confirmations

Items awaiting testing/confirmation. Oldest items should be tested first.

| Date | Area | Commit | Status | Notes |
|------|------|--------|--------|-------|
| 2026-08-21 | talks-planner | 0db037f | best-yet | Scenario 012 re-walked incl. the two-browser realtime check. Closed since: realtime, the Failure Behavior checks, and scenario-008 (walked 2026-08-22, now `confirmed` under roster-picker). Still open: deployed build unopened, `sms:` untested on a real device, scenario 013 not re-walked since trimming. Supersedes the 036698c record |
| 2026-08-26 | visits | 842968d | best-yet | Scenarios 043 and 044 walked by an AGENT on localhost; user reviewed screenshots. Four defects found that 2304 tests missed, three fixed and re-walked. Still open: **D3 is an open decision, not a fix** — the companion picker is org-scoped, so a member from another org has never been addable; the picker also reports an empty roster for a filtered-empty result. Also unverified: the deployed build, a real device, reschedule through the UI, and the bishopric path. Closed since: migration 049 applied 2026-08-26, and the missing year on appointment dates fixed in `visits-b` (d5695e7) |
