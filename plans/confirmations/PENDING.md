# Pending Confirmations

Items awaiting testing/confirmation. Oldest items should be tested first.

| Date | Area | Commit | Status | Notes |
|------|------|--------|--------|-------|
| 2026-08-21 | talks-planner | 0db037f | best-yet | Scenario 012 re-walked incl. the two-browser realtime check. Closed since: realtime, the Failure Behavior checks, and scenario-008 (walked 2026-08-22, now `confirmed` under roster-picker). Still open: deployed build unopened, `sms:` untested on a real device, scenario 013 not re-walked since trimming. Supersedes the 036698c record |
| 2026-08-22 | role-access | 310a708 | best-yet | Scenario 014 walked end to end and all 8 checklist items passed, but by the agent via Playwright — no human has looked at the screens, which is what blocks `confirmed`. 1003 tests green. Still open: deployed build unopened, nothing in the app writes `role_access` so the delta shape has never round-tripped through a real form |
