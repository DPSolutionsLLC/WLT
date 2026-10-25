---
id: sacrament-planner-import
type: feature
iter: ITER-045
commits: ["6283a6a", "7346f4b"]
date: 2026-10-24
files:
  - supabase/scripts/plannerWardListCheck.ts
  - supabase/scripts/plannerImport.ts
  - lib/sacramentPlanner/importPlan.ts
  - lib/sacramentPlanner/wardList.ts
  - package.json
related: [sacrament-planner-adapter, roster-paste-import]
---

## What was done
Slices B and C of ITER-045, which closes it. Slice B (6283a6a) added `npm run planner:check`, a
read-only comparison of the member list the Planner is now served with the one it was built on,
plus every name its records use; on Buffalo Ward all 353 names and every record name matched.
Slice C added `npm run planner:import`, which brought the bishopric's 273 records and 922 agenda
history lines into `planner_documents` and `planner_history`, then re-read them and confirmed each
one matched the export exactly.

## Key decisions
- **History lines are checked by the person they resolve to** (row fix, then name fix, then the
  automatic match), the way the Planner decides, not by `key`, which is only the printed agenda text.
- **A household phone goes to a man before the oldest adult.** All eleven differing households had
  the husband or father on the old list; the user chose to match it.
- **The import's rules are a pure module** (`importPlan.ts`, tested): skip `t_`, refuse unknown
  collections, add the bishopric and rotation settings only if the export lacks them, and refuse
  the whole import if any document fails the save route's own checks. It never deletes, so a fresh
  export can be imported on top.

## Pitfalls met
- **Plain Node cannot load anything that imports the server client** (`lib/roster/queries.ts`,
  `lib/ward/wardTimezone.ts`, `lib/audit/writeAuditLog.ts`). Both scripts repeat those reads and the
  audit insert; the mapping that decides what the Planner sees still goes through `toPlannerWardList`.
- **The wrong calling shows the wrong person.** After the import the user appeared as the bishop,
  because his own calling was "bishop". The admin screen refuses a change to one's own role, and
  Admin is unreleased in Buffalo, so nobody could fix it there; it was corrected by script at the
  user's request, with an audit row. The Planner's own bishopric list also had the two counselors
  swapped and was corrected the same way.

## Known gaps
- A super admin cannot change their own calling anywhere in the app (to be scoped).
- The old Planner page was shared; if another bishopric member used it after the 2026-10-23
  export, a fresh export must be imported on top.
- The conducting rotation came from the old Planner's built-in list and is not yet confirmed.
- The bishop and the 2nd counselor have no app login yet; the user's test account still holds a
  bishop calling until the real bishop has accepted his invite.
