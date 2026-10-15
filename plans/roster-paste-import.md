# Plan: Roster paste import (LCR ward list report)

**Created:** 2026-10-14
**Type:** feature
**Scope refs:** ITER-040

## Overview

Replace the roster's CSV **file** import with a **paste** import. A leader opens their custom ward
list report in LCR (the church's Leader and Clerk Resources), selects the whole table, copies it and
pastes it into a box on `/roster/import`. The app:

1. Rebuilds the table from the pasted text. LCR's copy puts headers one per line, and splits any
   row whose cell holds a line break across several lines with **no quoting**.
2. Matches columns **by header text, in any order**. It names any missing required column and says
   how to add it in LCR, and it lists extra columns as "ignored".
3. Builds a **checklist of differences** against the current roster: new people, changed people
   (with each field's before → after), changed household addresses, and **no longer listed**.
4. Applies **only the ticked items**, in one database transaction. No longer listed means status
   `moved_out`; nothing is ever deleted.

### Decisions settled with the user (2026-10-14) — do not re-litigate

- **Paste is the only way in.** The file upload, its column-mapping step and the old preview are
  **deleted** (the user approved the deletions listed below).
- **Untick only.** Every checklist item has a checkbox and nothing can be edited inside the
  checklist. To fix a value, fix it in LCR and paste again, or edit the member afterwards.
- **Defaults:** new people, changed people and household address changes start **ticked**. No
  longer listed starts **unticked**, so every move-out is a deliberate act. Each group has
  "Tick all" and "Untick all".
- **Reviewed fields**, which appear in the checklist when they differ: first name, last name,
  preferred name, full name, birth date, gender, phone, email, household, and (at household level)
  address. A value going to blank shows as **Removed** in the checklist.
- **Silent fields**, which are stored and overwritten by every import with no checklist entry:
  class assignment, callings, callings with date sustained, callings with date sustained and set
  apart, ministering brothers, ministering sisters, has ministering brothers, has ministering
  sisters. The user wants them in place for future modules but not reviewed yet. **Category**
  (adult/youth/child) is also written silently, derived from birth date on the import date.
- **Deferred, do not build:** three-way conflict detection ("changed in the app since the last
  report"), which needs a stored snapshot of the previous report. It arrives with the Callings and
  Ministering modules. Record it in the retro's known gaps.
- **Names:** first and last name come from **Preferred Name** ("Last, First"), split at the
  **first comma**. This deliberately reverses `columnMapping.ts`'s "never split a name" rule for
  this one known LCR format, by the user's explicit decision. Full Name is stored and, with birth
  date, is the match key.
- **"No longer listed" means `moved_out`**, never "inactive", which means something specific in
  the Church. A moved-out person who reappears matches back to their old record and returns to
  `active`.
- **Fix in this plan:** `updateMemberSchema` silently sets `status: "active"` on any PATCH that
  omits `status`. It is `createMemberSchema.partial()` and Zod 4 keeps `.default("active")` through
  `.partial()`, which was verified by running it. That would undo a move-out.

### Facts verified against the user's real paste (`C:\Users\Owner\Documents\lcr-paste.txt`)

**That file is real member data. Never copy it into the repo, never print its rows, never commit
it.** Tests use a **synthetic** fixture with the same shape and fake names. Profiled 2026-10-14
using counts only:

- CRLF line endings, no quote characters anywhere.
- **Header block:** a blank line, then each of the 17 headers on its own line, each followed by a
  blank line (lines 1–34). The data rows start at the first line containing a tab.
- **Data:** 17 tab-separated cells per row. **21 rows are split across 4 lines** because the three
  callings cells hold line breaks (for example, line splits of 11 + 2 + 2 + 5 fields). Gathering
  lines until a record holds exactly 16 tabs, joining them with `\n`, gives **353 records, 0
  left over**. That equals the user's CSV export row count.
- Every Preferred Name and Full Name has exactly one comma. Every birth date matches
  `D Mon YYYY` (for example `13 Jun 1986`). Gender is only `M`/`F`. The "has ministering" columns
  are only `Yes`/`No`. No cell has leading or trailing spaces. The longest cell is 132 characters.
- Full Name + Birth Date has no duplicates, and neither does Full Name alone. There are 204
  distinct "Head of House and Spouse" values, and every household has exactly one address.

Headers, in LCR order: `Preferred Name`, `Full Name`, `Age`, `Individual Phone`,
`Individual E-mail`, `Address - Street 1`, `Birth Date (1 Jan 1990)`, `Gender`,
`Class Assignment`, `Head of House and Spouse`, `Callings`, `Callings with Date Sustained`,
`Callings with Date Sustained and Set Apart`, `Ministering Brothers`, `Ministering Sisters`,
`Has Ministering Sisters`, `Has Ministering Brothers`.

### Context: where this sits

This is the first of GROUP-03 (ITER-040, then ITER-041, then ITER-042). After it ships, the user
creates a **real ward** with the existing Stakes & Wards screen, takes a calling there (a super
admin can already grant one: `POST /api/callings`), switches into it, and pastes the report. **That
first paste is the real ward's baseline.** The user's current ward becomes the **test ward**. Its
members get made-up values for the new fields from a one-off script (Task 13), so the two wards
have the same shape.

### Success criteria

- Pasting the real report into an empty ward produces a checklist of 353 new people in 204
  households and no problems, and confirming creates exactly that.
- Pasting the same report again shows **nothing to change**.
- A second paste with a few edits (one phone changed, one person removed, one added, one moved
  between households) shows exactly those items, and nothing else.
- A paste missing most of the ward raises the loud partial-paste warning.
- No member row is ever deleted by an import.

## Relevant Files

**Create**
- `supabase/migrations/090_roster_paste_import.sql`: new member columns, a match index,
  `apply_roster_paste()`, and dropping `apply_roster_import()`.
- `lib/roster/paste/parsePastedReport.ts`: pasted text → headers + rows. Pure, browser-safe.
- `lib/roster/paste/reportColumns.ts`: the known LCR columns, header matching, and the
  missing/ignored column messages.
- `lib/roster/paste/normalizeReportRow.ts`: row → `ReportPerson` (name split, date parse and so
  on) plus row problems.
- `lib/roster/ageGroup.ts`: `ageGroupOn(birthDate, asOfDate)` following the Church's January rule.
  Reused by ITER-042.
- `lib/roster/paste/buildRosterDiff.ts`: pure diff (current roster + report people → checklist).
- `lib/roster/paste/loadRosterForDiff.ts`: server-only read of every member and household (all
  statuses) for the diff.
- `lib/roster/paste/applyRosterPaste.ts`: server-only. Selected item ids → rpc payload → rpc →
  audit → notification.
- `lib/roster/paste/pasteRequest.ts`: server-only. Body parsing, the paste hash, and the
  parse + normalize + diff pipeline shared by both routes.
- `lib/validation/rosterPaste.ts`: Zod schemas for the two request bodies.
- `app/(app)/roster/import/PasteImport.tsx`: client component. Paste step → review step → done.
- `app/(app)/roster/import/ReviewChecklist.tsx`: client component. The four groups with ticks.
- `supabase/scripts/fillTestRosterFields.ts`: one-off script giving the test ward's members
  made-up values for the new fields.
- `tests/lib/rosterPasteParse.test.ts`
- `tests/lib/rosterReportColumns.test.ts`
- `tests/lib/rosterReportRow.test.ts`
- `tests/lib/ageGroup.test.ts`
- `tests/lib/rosterDiff.test.ts`
- `tests/lib/rosterValidation.test.ts`
- `tests/db/roster-paste-import.test.ts`
- `tests/routes/roster-paste-import.test.ts`
- `tests/fixtures/roster/lcr-paste-synthetic.ts`: synthetic paste text exported as string
  constants, with fake names and LCR's exact shape.
- `testing/scenarios/roster/scenario-089-paste-ward-list/` (`scenario.md`, `seed.ts`,
  `fixtures/paste-1.txt`, `fixtures/paste-2.txt`, `fixtures/paste-partial.txt`)

**Modify**
- `app/api/roster/import/preview/route.ts`: rewritten for a JSON paste body. Same path and
  permission.
- `app/api/roster/import/route.ts`: rewritten for a JSON paste body plus selected ids. Same path
  and permission.
- `app/(app)/roster/import/page.tsx`: render `<PasteImport />` with short how-to text.
- `components/roster/ImportProblemList.tsx`: take a local `ImportProblem` type
  (`{rowNumber, message}`) instead of importing `RowProblem` from the deleted `normalizeRow.ts`.
- `lib/roster/queries.ts`: `Member`/`MemberRow`/`MEMBER_COLUMNS`/`mapMemberRow` gain the new
  columns (rule 9).
- `lib/validation/roster.ts`: the `updateMemberSchema` status fix.
- `app/(app)/roster/member/[id]/page.tsx`: show Full name, Birth date and Email in the `<dl>`.
- `testing/infrastructure/seedUtils.ts`: `createMember` accepts the new optional fields.
- `types/database.ts`: regenerate (`npm run db:types`). Do not hand-edit.
- `package.json`: add the script `"roster:fill-test-fields"` (same `node … --import
  ./supabase/scripts/register.mjs` shape as `hymns:*`). **No new dependencies.**
- `testing/scenarios/manifest.json`: regenerate (`npm run manifest`).
- Docs: `SPEC.md` (members columns and the import), `FEATURES.md` (roster import),
  `plans/P4-module-reskins.md` or the roster row of `plans/prototype/module-map.md` (whichever
  names the roster import; grep for "import"), and `CLAUDE.md` §9 (a short entry, see Integration
  Notes).

**Delete** (approved by the user 2026-10-14)
- `app/(app)/roster/import/ImportWizard.tsx`
- `app/(app)/roster/import/ColumnMappingStep.tsx`
- `app/(app)/roster/import/PreviewStep.tsx`
- `lib/roster/csv/columnMapping.ts`
- `lib/roster/csv/normalizeRow.ts`
- `lib/roster/csv/buildImportPreview.ts`
- `lib/roster/csv/applyImport.ts`
- `lib/roster/csv/importRequest.ts`
- `lib/roster/csv/limits.ts`. First check that `lib/youth/ics/limits.ts` only *mentions* it in a
  comment (it does: "A DELIBERATE TWIN OF … NOT AN IMPORT FROM IT"). Reword that comment so it no
  longer points at a deleted file.
- `lib/validation/rosterImport.ts`. First grep for any other importer; `lib/validation/youthImport.ts`
  matched the grep only on the word.
- `tests/lib/csvMapping.test.ts`, `tests/lib/csvNormalizeRow.test.ts`,
  `tests/lib/csvPreview.test.ts`, `tests/db/roster-import.test.ts`
- `testing/scenarios/roster/scenario-009-import-lcr-export-twice/` (the whole folder)

**Keep:** `lib/roster/csv/parseCsv.ts` and `tests/lib/csvParse.test.ts`.
`lib/music/hymnSource.ts` imports `parseCsvText`.

## Dependencies

- No new libraries. `node:crypto` (already used) for the paste hash.
- Existing helpers to use: `requireSessionUser`, `resolveRoleAccess`, `assertCan`/`can`,
  `respondToRouteError` (`lib/auth/routeErrors.ts`), `readJsonBody`, `writeAuditLog`,
  `emitNotification` (trigger `new_household_added`, already seeded),
  `createServerSupabaseClient`, `createServiceSupabaseClient` + `loadEnvironment` (script only),
  `capProblems` logic (re-create a tiny local version in `pasteRequest.ts`, since `limits.ts` is
  deleted), and `lib/calendar/dates.ts` (`isValidDateOnly`, date-only helpers).
- Migration must be applied to the hosted DB: `npx supabase db push --linked --dry-run`, then
  push, then `npm run db:types`.

## Known Pitfalls (from retro context)

- **roster-c-csv-import:**
  - The preview and apply must use **one** definition of "the same person". Both routes call the
    same `buildRosterDiff()`, and the apply recomputes rather than trusting client-sent data.
  - Its result screen once contradicted its preview ("to update" versus matched). The result
    screen here must report **what was applied**, in the same group names the checklist used.
  - The server-side hash check is a second line of defence; test the stale path for real (edit the
    paste after preview).
- **roster-c (gap):** `members`/`households` RLS lets *any* ward member insert or update.
  `assertCan(user, "roster.import")` is the real role boundary. Check the permission **before**
  parsing the body, as today.
- **roster-c:** `totalRows` counted only normalized rows and overstated what it meant. Here, show
  "rows read" and "rows with problems" separately.
- **ITER-005 / role-access-overrides:** go through `can()`/`assertCan()` with `resolveRoleAccess`.
  Never compare role strings.
- **CLAUDE.md rule 12:** birth date is a `date`. Render it with an explicit `timeZone: "UTC"`
  (`explicitTimeZone.test.ts` reads source and will fail otherwise). Parse `D Mon YYYY` by hand
  into `YYYY-MM-DD`. **Never** `new Date("13 Jun 1986")`, which parses in the process's zone.
- **sacrament-music-people / roster-a:** a bare `set null` on a composite FK fails at delete time.
  Nothing here deletes members, but don't add new FKs to members.
- **routes-a (CLAUDE.md §8):** a route test needs no server. Mock only `@/lib/supabase/server` via
  `tests/helpers/routeClient.ts`; assert refused writes by **re-reading** rows with the service
  client.
- **CLAUDE.md §7 "A SUBJECT is not an AUTHOR":** this import writes no user ids, so no
  `findUsersOutsideWard()` is needed. Do not add one.

## Tasks

### Task 1: Migration 090
**File:** `supabase/migrations/090_roster_paste_import.sql` (create)
**Action:** Add the columns, the index and the apply function, and drop the old function.
**Details:**
- `alter table members add column` (all nullable):
  - `full_name text check (char_length(full_name) <= 200)`
  - `preferred_name text check (… <= 200)`
  - `birth_date date`
  - `email text check (… <= 320)`
  - `class_assignment text check (… <= 1000)`
  - `callings text check (… <= 4000)`
  - `callings_sustained text check (… <= 4000)`
  - `callings_set_apart text check (… <= 4000)`
  - `ministering_brothers text check (… <= 1000)`
  - `ministering_sisters text check (… <= 1000)`
  - `has_ministering_brothers boolean`
  - `has_ministering_sisters boolean`
- Header comment explains:
  - The callings and ministering columns are **leader-only roster data**, never published (cite
    `lib/program/publicProjection.ts`).
  - They are written silently by the paste import, and three-way review is deferred to the
    Callings/Ministering modules.
  - Callings cells hold one calling per line (`\n`).
- `create index members_ward_full_name_birth_idx on members (ward_id, lower(full_name), birth_date);`
  Deliberately **not unique**, the same reasoning as 022's indexes. The diff decides identity in
  TypeScript and the function trusts ids.
- `create or replace function apply_roster_paste(p_ward_id uuid, p_plan jsonb) returns jsonb`,
  plpgsql, **SECURITY INVOKER**, `set search_path = public, pg_temp`. Steps:
  1. `if p_ward_id is distinct from current_ward_id() then raise exception 'roster import is for
     the ward you are acting in' using errcode = '42501'; end if;` This is an explicit check
     because 022 had none.
  2. `p_plan.households`: `[{key, family_name, address}]` for households to **create**. Insert each
     and build a jsonb map `key → id`. Count `households_created`. Return the new ids.
  3. `p_plan.household_addresses`: `[{household_id, address}]`. Update address where
     `ward_id = p_ward_id and id = …`. Count `households_updated`.
  4. `p_plan.creates`: `[{household_key | household_id, fields…}]`. Insert members with
     `status 'active'`. Resolve `household_id` from the map when `household_key` is given.
     Count `members_created`.
  5. `p_plan.updates`: `[{member_id, household_key?, household_id?, set: {column: value}}]`.
     Update only these whitelisted columns when present as keys in `set`: `first_name`,
     `last_name`, `preferred_name`, `full_name`, `birth_date`, `gender`, `phone`, `email`,
     `category`, `status` (`active` only, for "returning"), and all the silent columns.
     `household_id` comes from the key or id. Use `set col = case when s ? 'col' then
     (s->>'col')::type else col end` per column; a JSON null means set null. Count
     `members_updated` per row actually changed (`is distinct from`, as 022 does).
  6. `p_plan.move_outs`: `[member_id]`. `update members set status = 'moved_out' where ward_id =
     p_ward_id and id = any(…) and status <> 'moved_out'`. Count `members_moved_out`.
  7. Return `{households_created, households_updated, members_created, members_updated,
     members_moved_out, new_household_ids}`.
- **Never delete** anything. Empty households left behind by moves stay; their visit history
  hangs off them.
- `revoke all on function apply_roster_paste(uuid, jsonb) from public; grant execute … to
  authenticated, service_role;`
- `drop function if exists apply_roster_import(uuid, jsonb, jsonb);`. Grep first: only comments
  reference it (023, 085, `app/api/agendas/route.ts`, `lib/youth/ics/applyImport.ts`,
  `testing/infrastructure/seedUtils.ts`, scenario 009). Reword any comment that names it as a
  live function.
- Check `tests/db/migrations.test.ts`: the new file must be applied before the suite runs
  (`HELD_BACK_UNTIL_DEPLOYED` stays empty; this migration is additive plus one drop of an
  unused function).

### Task 2: Age group (pure)
**File:** `lib/roster/ageGroup.ts` (create)
**Action:** `export function ageGroupOn(birthDate: DateOnly, asOf: DateOnly): MemberCategory`.
**Details:**
- `youthFrom` = January 1 of (birth year + 12). `adultFrom` = the 18th birthday (Feb 29 →
  Mar 1 in non-leap years).
- `asOf < youthFrom` → `"child"`; `< adultFrom` → `"youth"`; else `"adult"`.
- Work on date-only strings and UTC parts only (`parseDateOnly` from `lib/calendar/dates.ts`).
  No local time.
- Header comment: this is the Church's rule (the user decided it in ITER-042 discovery), and
  ITER-042 imports it for "age group on that Sunday".

### Task 3: Report columns
**File:** `lib/roster/paste/reportColumns.ts` (create)
**Action:** Define the known columns and header matching.
**Details:**
- `REPORT_COLUMNS: readonly ReportColumn[]` with `{ key, lcrHeader, required, kind: "reviewed" |
  "silent" | "derived" }`:

  | Key | LCR header | Required | Kind |
  |---|---|---|---|
  | `preferredName` | Preferred Name | yes | reviewed |
  | `fullName` | Full Name | yes | reviewed |
  | `birthDate` | Birth Date | yes | reviewed |
  | `household` | Head of House and Spouse | yes | reviewed |
  | `gender` | Gender | no | reviewed |
  | `phone` | Individual Phone | no | reviewed |
  | `email` | Individual E-mail | no | reviewed |
  | `address` | Address - Street 1 | no | reviewed |
  | `classAssignment` | Class Assignment | no | silent |
  | `callings` | Callings | no | silent |
  | `callingsSustained` | Callings with Date Sustained | no | silent |
  | `callingsSetApart` | Callings with Date Sustained and Set Apart | no | silent |
  | `ministeringBrothers` | Ministering Brothers | no | silent |
  | `ministeringSisters` | Ministering Sisters | no | silent |
  | `hasMinisteringBrothers` | Has Ministering Brothers | no | silent |
  | `hasMinisteringSisters` | Has Ministering Sisters | no | silent |
  | `age` | Age | no | derived (recognised, never read; age comes from birth date) |

- `normalizeHeader(h)`: drop any `(…)` parenthetical, lowercase, strip non-alphanumerics. That
  makes `Birth Date (1 Jan 1990)` → `birthdate` and `Individual E-mail` → `individualemail`.
- `matchReportColumns(headers): { columnIndex: Partial<Record<ReportColumnKey, number>>, missing:
  ReportColumn[], ignored: string[], duplicates: string[] }`. Matching is exact on the normalized
  header. "Callings" must not swallow "Callings with Date Sustained", so match whole strings only.
- `describeMissingColumns(missing)`: one sentence per column, for example *"The paste has no
  "Birth Date" column. In LCR, open your custom report, add Birth Date to its columns, run it, and
  copy the whole table again."*
- Missing **optional** columns are not an error. The diff must treat them as "not supplied", so a
  missing column **never clears** a stored value (Task 6). Surface them as a quiet note: "Not in
  this paste, left unchanged: Email".

### Task 4: Parse pasted text (pure, browser-safe)
**File:** `lib/roster/paste/parsePastedReport.ts` (create)
**Action:** `parsePastedReport(text: string): ParsedReport`.
**Details:**
- `ParsedReport = { headers: string[]; rows: { rowNumber: number; cells: string[] }[];
  problems: { rowNumber: number; message: string }[] }`. `rowNumber` is the 1-based count of
  records after the header, which is what a person can find in LCR.
- Strip a BOM and every `\r`. Split on `\n`.
- **Header detection, two accepted shapes:**
  - **(a) LCR copy:** leading lines with no tab. Each non-blank one is a header, and the block ends
    at the first line containing a tab.
  - **(b) Spreadsheet copy:** the first non-blank line contains tabs. Split it on `\t` and it is
    the header row.
  - If neither yields at least one header → `headers: []` with a problem: "Nothing that looks like
    the ward list report was pasted."
- **Record rebuild:** with `expectedTabs = headers.length - 1`:
  - Skip blank lines between records.
  - Accumulate lines, joining with `\n`, until the accumulated tab count `=== expectedTabs`. Then
    split on `\t`; that is one record.
  - If the count **exceeds** `expectedTabs`, record a problem ("Row N could not be read. Copy the
    whole table from LCR again.") and resynchronize by starting a new record at the current line.
  - At end of input, a non-empty partial buffer becomes the same problem.
- **Spreadsheet quoting:** a cell that starts and ends with `"` and contains `\n` or `""` is
  unquoted (strip outer quotes, `""` → `"`). LCR copies have no quotes, so this only serves pastes
  that went through Google Sheets or Excel.
- Trim every cell. Cap the input at `MAX_PASTE_CHARACTERS = 1_000_000` and `MAX_PASTE_ROWS =
  2000` (exported constants). Over the cap is a parse problem with a clear sentence, not a throw.
- No imports from server modules. The client calls it for a header check before posting.

### Task 5: Normalize a row
**File:** `lib/roster/paste/normalizeReportRow.ts` (create)
**Action:** `normalizeReportRows(parsed, columnIndex, asOf: DateOnly) → { people: ReportPerson[];
problems: ImportProblem[] }`.
**Details:**
- `ReportPerson`:
  - `rowNumber`, `preferredName`, `fullName`, `firstName`, `lastName`
  - `birthDate: DateOnly`
  - `gender: MemberGender | null`
  - `phone`, `email`, `address: string | null`
  - `householdName: string`
  - `category: MemberCategory` (from `ageGroupOn(birthDate, asOf)`)
  - `silent: { classAssignment, callings, callingsSustained, callingsSetApart,
    ministeringBrothers, ministeringSisters: string | null; hasMinisteringBrothers,
    hasMinisteringSisters: boolean | null }`
  - `supplied: ReadonlySet<ReportColumnKey>`, the optional columns present in this paste
- **Name split:** `const index = preferredName.indexOf(",")`; `lastName = before.trim()`,
  `firstName = after.trim()`. If there is no comma or either side is empty, the row is excluded
  with a problem: *"Row N: the Preferred Name "…" is not in "Last, First" form."*
- **Birth date:** strict `^(\d{1,2}) (Jan|Feb|…|Dec) (\d{4})$` (case-insensitive month), mapped to
  `YYYY-MM-DD` and validated with `isValidDateOnly`. Invalid or blank → row excluded with a
  problem. It is half the match key.
- **Required blanks** (full name, household) → row excluded with a problem naming the column.
- `M`/`Male` → `male`, `F`/`Female` → `female`. Anything else → `null` plus a non-excluding
  problem.
- `Yes` → `true`, `No` → `false`, blank → `null`.
- Blank optional cell → `null`.
- Within-file duplicates (same lowercased full name + birth date): the second is excluded with a
  problem.
- `ImportProblem = { rowNumber: number; message: string }`, exported from here and used by
  `ImportProblemList`.

### Task 6: The diff (pure)
**File:** `lib/roster/paste/buildRosterDiff.ts` (create)
**Action:** `buildRosterDiff(current: RosterSnapshot, people: readonly ReportPerson[]): RosterDiff`.
**Details:**
- `RosterSnapshot = { members: SnapshotMember[]; households: { id, familyName, address }[] }`.
  `SnapshotMember` holds the id, every reviewed field, every silent field, `category`, `status`
  and `householdId`.
- **Household identity:** `lower(trim(familyName))`.
  - An incoming `householdName` matching an existing household → that id.
  - Otherwise it is a **new household**: `key = "household:" + lowercased name`, `address` =
    first member's address.
  - Existing households with the old `"Smith"`-style names (test ward) simply won't match the LCR
    names. Their members show as "household changed" into new households, which is correct and
    visible.
- **Member matching**, in order. Each existing member is matched at most once; remove it from the
  pools when matched.
  1. Members with `fullName` set: equal `lower(fullName)` **and** equal `birthDate`.
  2. **Legacy fallback** (members with `fullName` null, which is the test ward's first paste):
     equal `lower(firstName)` and `lower(lastName)` against the split Preferred Name. Exactly one
     candidate → match. Several → no match, and a problem: *"Row N: more than one person named
     "First Last" is already in the roster, so this row was treated as new. Merge them by hand if
     needed."*
  3. `fullName` equal (case-insensitive) with exactly one candidate whose birth date differs →
     match. It shows as a birth date change.
  4. Otherwise → new person.
- **Item kinds and ids** (stable, recomputable from the same inputs):
  - `NewPersonItem { id: "new:" + lower(fullName) + "|" + birthDate, person, householdLabel,
    isNewHousehold, defaultSelected: true }`
  - `ChangedPersonItem { id: "member:" + memberId, memberId, name, changes: FieldChange[],
    returning: boolean, defaultSelected: true }`. `FieldChange = { field: ReviewedField; label;
    before: string | null; after: string | null; kind: "changed" | "added" | "removed" }`. Only
    reviewed fields; **skip optional fields not in `person.supplied`**. `returning` is true when
    the matched member's status is `moved_out` (its own line: "Moved out → back in the ward").
    Household change shows the before/after **household names**.
  - `HouseholdAddressItem { id: "household:" + householdId, householdId, name, before, after,
    defaultSelected: true }`. Only when the `address` column is supplied and differs.
  - `MovedOutItem { id: "moveout:" + memberId, memberId, name, householdName, defaultSelected:
    false }` for every existing member with status `active` or `do_not_contact` that matched no
    row. `moved_out` members are already gone.
- **Silent updates:** for every matched member, the silent fields plus `category` that differ
  (only supplied columns) go into `silentUpdates: { memberId, set }[]`. They are applied on
  confirm whether or not that member's reviewed item is ticked. Silent fields are not shown, but
  the result screen reports a count.
- **Partial-paste guard:** `activeCount` = members with status `active`/`do_not_contact`.
  `guard = { movedOutCount, activeCount, suspicious: movedOutCount >= 10 && movedOutCount >
  activeCount * 0.25 }`.
- `RosterDiff = { newPeople, changedPeople, householdAddresses, movedOut, silentUpdates,
  unchangedCount, newHouseholds: { key, familyName, address }[], guard }`. Lists are sorted by
  last name, then first name, so the checklist reads alphabetically.
- **No writes, no I/O.** It takes data and returns data, which is what makes preview = apply
  provable.

### Task 7: Loading the snapshot
**File:** `lib/roster/paste/loadRosterForDiff.ts` (create)
**Action:** `loadRosterForDiff(wardId, client) → RosterSnapshot`.
**Details:**
- Every status, deliberately: a moved-out member must match rather than be created again (the
  same reasoning as the deleted `buildImportPreview.ts`).
- Select `MEMBER_COLUMNS` (extended in Task 9) and `HOUSEHOLD_COLUMNS` through the caller's
  client. Map with the existing mappers. Throw on a Supabase error (rule 7).

### Task 8: Request pipeline, apply, and the routes
**Files:** `lib/validation/rosterPaste.ts`, `lib/roster/paste/pasteRequest.ts`,
`lib/roster/paste/applyRosterPaste.ts` (create); `app/api/roster/import/preview/route.ts`,
`app/api/roster/import/route.ts` (modify, full rewrite)
**Details:**
- **Zod:**
  - `pastePreviewSchema = z.object({ text: z.string().min(1).max(MAX_PASTE_CHARACTERS) }).strict()`
  - `pasteApplySchema = z.object({ text, pasteHash: /^[0-9a-f]{64}$/, selectedIds:
    z.array(z.string().max(500)).max(5000) }).strict()`
  - Messages are named sentences, not Zod defaults (retro auth-b).
- **`pasteRequest.ts`:**
  - `hashPaste(text)` = sha256 hex of the text after `\r` removal.
  - `runPastePipeline(text, wardId, client, asOf)` → `{ parsed headers info (missing, ignored,
    notSupplied), diff, problems, rowsRead }`.
  - A missing required column → throw `PasteRequestError(400, describeMissingColumns(...))`.
  - `asOf` = today's date in **UTC** (`formatDateOnly(new Date())`). This only decides the
    category snapshot.
- **Preview route** (`POST`):
  - `requireSessionUser` → `resolveRoleAccess` → `assertCan(user, "roster.import", roleAccess)`
    **before** reading the body → parse → pipeline.
  - Return `{ pasteHash, diff (problems capped at 200 with a truncated count), ignoredColumns,
    notSuppliedColumns, rowsRead, rowsWithProblems }`.
  - No writes, no audit (as today).
- **Apply route** (`POST`):
  - Same gate, then parse.
  - `hashPaste(text) !== pasteHash` → 400 *"The pasted list changed since you reviewed it. Review
    it again."*
  - Re-run the pipeline against the **current** roster.
  - Call `applyRosterPaste(...)` with `diff` + `new Set(selectedIds)`.
  - Respond `{ result }`.
  - Errors through `respondToRouteError`, plus `PasteRequestError` → its status.
- **`applyRosterPaste(wardId, userId, diff, selectedIds, client)`:**
  - Build `p_plan`:
    - Selected new people → `creates`, plus the `newHouseholds` they need.
    - Selected changed people → `updates` with the reviewed `set`, including `status: "active"`
      when `returning`, and the household key or id if it changed.
    - All `silentUpdates` merged into the same member's update (or their own update entry).
    - Selected address items → `household_addresses`.
    - Selected move-outs → `move_outs`.
  - **Ids that were selected but no longer exist** in the recomputed diff (someone edited the
    roster in between) are counted as `staleSelections` and reported, never guessed at.
  - Create only the households a selected new person (or a selected household change) actually
    needs.
  - `supabase.rpc("apply_roster_paste", { p_ward_id: wardId, p_plan })`. Throw on error.
  - `writeAuditLog({ action: "roster_imported", module: "roster", detail: { rowsRead,
    householdsCreated, householdsUpdated, membersCreated, membersUpdated, membersMovedOut,
    silentFieldUpdates, staleSelections, problemCount } })`. Counts only: **no names, no ids**.
    No key may contain "note" or "token" (`writeAuditLog` redacts those).
  - If `householdsCreated > 0`, emit `new_household_added`, keeping the deleted
    `applyImport.ts`'s body format (up to 4 names, then "and N more").
  - Return `ApplyResult = { householdsCreated, householdsUpdated, membersCreated,
    membersUpdated, membersMovedOut, membersReturned, silentFieldUpdates, staleSelections }`.

### Task 9: Domain types and the member page
**Files:** `lib/roster/queries.ts`, `app/(app)/roster/member/[id]/page.tsx`,
`testing/infrastructure/seedUtils.ts`, `types/database.ts` (regen) (modify)
**Details:**
- `Member` gains:
  - `fullName`, `preferredName`
  - `birthDate: DateOnly | null`
  - `email`, `classAssignment`, `callings`, `callingsSustained`, `callingsSetApart`,
    `ministeringBrothers`, `ministeringSisters: string | null`
  - `hasMinisteringBrothers`, `hasMinisteringSisters: boolean | null`
- Extend `MemberRow`, `MEMBER_COLUMNS` and `mapMemberRow` to match. Add every field
  explicitly; the mapper builds an explicit object.
- Run `npm run db:types` after the migration is applied, and fix every construction site the
  type checker flags. A required new field is how rule 9 gets enforced.
- **Member page:**
  - Add `<dt>Full name</dt>` (when present), `Birth date`, and `Email` (`mailto:` link) to the
    existing `<dl>`.
  - Birth date is formatted with `Intl.DateTimeFormat("en-US", { day: "numeric", month: "short",
    year: "numeric", timeZone: "UTC" })` from the date-only value. Check `lib/calendar/dates.ts`
    for an existing formatter first and reuse it if one exists.
  - Callings, class and ministering are **not shown** (silent, per the user).
- `seedUtils.createMember` accepts optional `fullName`, `preferredName`, `birthDate`, `email`
  and passes them through.

### Task 10: The paste UI
**Files:** `app/(app)/roster/import/page.tsx` (modify), `app/(app)/roster/import/PasteImport.tsx`,
`app/(app)/roster/import/ReviewChecklist.tsx` (create), `components/roster/ImportProblemList.tsx`
(modify)
**Details:**
- **`page.tsx`:** keep the gate exactly. Render a heading, a 3-step how-to (*"In LCR, open your
  ward list report. Select the whole table, from the first header to the last row, and copy it.
  Paste it below."*) and `<PasteImport />`.
- **`PasteImport`** has steps `"paste" | "review" | "done"`.
  - **Paste step:**
    - A `<textarea>` (monospace, ~10 rows, `aria-label`) and a **Review changes** button.
    - On click, run `parsePastedReport` + `matchReportColumns` **client-side** first. With
      missing required columns, show the sentences and stop. Otherwise `POST
      /api/roster/import/preview` with `{ text }`.
    - Show the server's error sentence on failure (never a generic one). Disable while busy.
  - **Review step:**
    - A summary line: *"353 rows read · 12 new · 3 changed · 1 address · 2 no longer listed ·
      340 unchanged"*.
    - The ignored and not-supplied column notes.
    - The **guard banner** when `guard.suspicious`, in `--warning` tone: *"This paste would mark
      X of Y people as moved out. If part of the table didn't get copied, go back and paste it
      again."* While it shows, "Tick all" on the no-longer-listed group is **disabled** until the
      reader ticks *"I checked. These people really are gone."*
    - `<ReviewChecklist>`, `<ImportProblemList>`, and **Back** / **Apply N changes** (N = ticked
      count; disabled at 0 unless silent updates exist, in which case the label reads *"Apply"*).
    - Confirm posts `{ text, pasteHash, selectedIds }`.
  - **Done step:** result counts using the **same group names** as the checklist. Report
    `staleSelections` in a sentence when > 0 ("2 items changed while you were reviewing and were
    skipped. Paste again to see them."), then `router.refresh()` and a link back to `/roster`.
- **`ReviewChecklist`:** four collapsible groups (New people · Changed · Household addresses · No
  longer listed), each with a count and **Tick all / Untick all**.
  - Each item is one compact row: a checkbox plus a name, with the detail below in small muted
    text.
  - New person: household (marked *new household* when so), age group, birth date.
  - Changed: one line per `FieldChange` as `Label: before → after`, with `Removed` / `Added`
    wording.
  - Returning: its own line.
  - Groups with zero items render one muted line ("No new people").
  - Follow the compact-UI preference (results-only lists, small grouped buttons).
- **`ImportProblemList`:** replace the `RowProblem` import with `ImportProblem` from
  `normalizeReportRow.ts`. Same props otherwise.
- All date text rendered here comes from date-only strings via the UTC formatter (rule 12).

### Task 11: The status bug
**File:** `lib/validation/roster.ts` (modify)
**Action:** Stop `updateMemberSchema` from defaulting `status`.
**Details:**
- Define a base object without the default, then `createMemberSchema = memberBaseSchema.extend({
  status: z.enum(MEMBER_STATUSES).default("active") })` and `updateMemberSchema =
  memberBaseSchema.partial()` (status optional with **no** default).
- Confirm `MemberForm` and `POST /api/members` still type-check and behave the same.

### Task 12: Delete the file import
**Action:** Delete the files listed under **Delete** in Relevant Files.
**Details:**
- Grep afterwards for every deleted module name. The only survivors allowed are comments, which
  must be reworded so they don't point at a missing file.
- Delete the four old test files and the scenario-009 folder.
- `npm run typecheck` must be clean before moving on.

### Task 13: Test-ward fill script
**Files:** `supabase/scripts/fillTestRosterFields.ts` (create), `package.json` (modify)
**Action:** Give the **test ward's** existing members made-up values for the new fields so it
matches the real ward's shape.
**Details:**
- Usage: `npm run roster:fill-test-fields -- --ward <uuid> [--apply]`. Without `--apply` it is a
  **dry run** that prints the ward's name, the member count and a sample of five planned values.
- **Refuses** if:
  - no `--ward` is given;
  - the ward has **any** member whose `full_name` is already set (which means a real import
    happened there; protects the real ward);
  - the ward has no members.
- Uses `loadEnvironment()` + `createServiceSupabaseClient()` exactly like `hymns.ts`.
- **Deterministic values** (seeded from the member id, so re-runs are stable):
  - `full_name = preferred_name = "Last, First"` from existing names.
  - `birth_date` consistent with the existing `category` (child 4–11, youth 12–17, adult 18–85
    as of today, UTC), and `category` left as-is.
  - `email = first.last@example.com` (lowercase, spaces stripped).
  - `class_assignment` / `callings` drawn from small sample lists ("Elders Quorum", "Relief
    Society", "Primary Teacher\nWard Activities Committee Member" …), with ~30% blank.
  - Ministering fields blank, has-flags `false`.
- Prints the count written. It writes through `update` only and never inserts or deletes.

### Task 14: Docs
- `SPEC.md`: the `members` new columns, `apply_roster_paste`, and the import now being paste-only.
- `FEATURES.md`: the roster import paragraph rewritten for paste and the checklist.
- The roster row in `plans/prototype/module-map.md` (if it mentions CSV import), updated.
- `CLAUDE.md` §9: a short entry, **"THE ROSTER IMPORT IS A PASTE OF THE LCR REPORT, REVIEWED AS A
  CHECKLIST — DECIDED 2026-10-14 (ITER-040, migration 090)."** It records:
  - the LCR copy shape and the tab-count rebuild;
  - Preferred Name split at the first comma (the user's decision, reversing never-split);
  - full name + birth date as the key, with the legacy first+last fallback;
  - move-outs unticked by default and the partial-paste guard;
  - silent fields;
  - deferred three-way conflict review;
  - "never deletes".

## Testing Strategy

**Synthetic fixture** (`tests/fixtures/roster/lcr-paste-synthetic.ts`): export
`LCR_HEADERS_BLOCK` (blank line, then each header on its own line followed by a blank line, CRLF)
and a `buildPaste(rows: string[][])` helper that writes rows tab-joined, CRLF, with multi-line
cells embedded **raw** (no quotes) exactly as LCR does. Fake names only (`Example, Ann`, `Sample,
Bo` …). **Never** paste lines from the user's real file.

- **`tests/lib/rosterPasteParse.test.ts`:**
  - LCR header block recognised (17 headers).
  - A record split across 4 lines by two multi-line cells rebuilds into one 17-cell record with
    `\n` inside the callings cells.
  - Spreadsheet header row shape.
  - Google-Sheets quoted multi-line cell.
  - Blank lines between records skipped.
  - Overflow line → problem and resync, so the next good record still parses.
  - Trailing partial record → problem.
  - Empty / garbage paste → "nothing that looks like the report".
  - Character and row caps.
  - CRLF and BOM stripped.
- **`tests/lib/rosterReportColumns.test.ts`:**
  - Every LCR header matches its key, including `Birth Date (1 Jan 1990)`.
  - Order-independent.
  - "Callings" does not match the dated callings columns.
  - Unknown header → `ignored`.
  - Missing required → sentence names the column and LCR.
  - Duplicate header detected.
- **`tests/lib/rosterReportRow.test.ts`:**
  - `"Van De Voorde, Marsha"` → last `Van De Voorde`, first `Marsha`.
  - `"Furnival, Robert David Jr."` → first `Robert David Jr.`.
  - No comma → excluded with problem.
  - `13 Jun 1986` → `1986-06-13`; `31 Feb 2000` → excluded; blank → excluded.
  - `M`/`F` and an unknown gender (kept, with a problem).
  - `Yes`/`No`/blank.
  - Blank optional → null.
  - Within-file duplicate excluded.
  - Category from `ageGroupOn`.
- **`tests/lib/ageGroup.test.ts`:**
  - Born Oct 2014: child on 2025-12-31, youth on 2026-01-01.
  - 18th birthday boundary (day before = youth).
  - Feb 29 birthday in a non-leap year.
  - Adult at 18 exactly.
- **`tests/lib/rosterDiff.test.ts`** (pure, no DB):
  - Match on full name + birth date.
  - Legacy fallback match (null full name) fills `fullName` / `birthDate` as **added** changes.
  - Legacy ambiguity → new + problem.
  - Full-name-only match → birth date change.
  - Moved-out member reappears → `returning`.
  - `do_not_contact` unmatched → in `movedOut`; `moved_out` unmatched → not listed.
  - Household change shows names.
  - New household created once for several members.
  - Address change → household item, only when the address column is supplied.
  - **Missing optional column never produces a "removed" change.**
  - Silent fields differ → in `silentUpdates`, **not** in `changes`.
  - Defaults: new/changed/address `true`, moveOut `false`.
  - Guard thresholds (9 = not suspicious; 10 of 30 = suspicious; 10 of 100 = not).
  - Same input twice → identical ids (stability).
  - Identical roster → everything empty, `unchangedCount` = all.
- **`tests/lib/rosterValidation.test.ts`:** `updateMemberSchema.parse({ phone: "1" })` has **no**
  `status` key; `createMemberSchema.parse({...})` still defaults to `active`.
- **`tests/db/roster-paste-import.test.ts`** (hosted DB, `@vitest-environment node`,
  `seedFixtures(["bishop", "wardBBishop"], { notificationTriggers: […"new_household_added"] })`,
  cleanup in `afterAll`):
  - Apply a plan as the bishop through RLS → households and members created.
  - Re-run the same paste → diff empty.
  - Update + returning + move-out applied.
  - **No member row deleted** (count before ≥ after across all statuses).
  - Unselected items untouched (re-read).
  - `rpc` with ward B's id → refused (42501), and ward B rows unchanged on re-read.
  - Exactly one `roster_imported` audit row per apply, whose detail has no names.
  - One `new_household_added` notification.
- **`tests/routes/roster-paste-import.test.ts`** (`tests/helpers/routeClient.ts` pattern; JSON
  bodies via `jsonRequest`):
  - Preview as bishop → 200 with a diff.
  - Preview as `ward_secretary` → 403 (check the fixture's real permissions first, §8).
  - Missing required column → 400 with the column named.
  - Apply with a mismatched hash → 400, nothing written (re-read).
  - Apply with a subset of `selectedIds` → only those applied.
  - An unknown selected id → counted in `staleSelections`.
- **Guards that must stay green:** `explicitTimeZone`, `navigationRoutesExist`, `ward-isolation`,
  `user-author-fks`, `migrations`, `cancelledReaders`, `csvParse` (kept).

## Test Scenarios (Harness)

### Scenario 089: Paste the ward list, then paste it again with changes
**Tags:** roster, full, import, destructive
**Purpose:** The import's whole value is the checklist matching reality across repeated pastes.
That needs a roster in a specific prior state (legacy members with no full name, a moved-out
member, a do-not-contact member), which is slow to build by hand.
**Seed data summary:**
- Test ward users:
  - a bishop (holds `roster.import`)
  - a `ward_secretary` (does not)
- Households (old `"Family"` naming): **3**
- Members, **8**, no `full_name`:
  - 1 `moved_out` who appears in paste 1 (should return);
  - 1 `do_not_contact` not in paste 1 (should be offered as no longer listed, unticked);
  - 1 whose phone differs from paste 1.
- `fixtures/paste-1.txt`: synthetic LCR-shaped paste, about 25 fake people in 10 households,
  including 2 people whose callings cells span lines, matching 6 of the 8 seeded members by
  first + last name.
- `fixtures/paste-2.txt`: paste 1 with:
  - one phone changed;
  - one person removed;
  - one person added;
  - one person moved to another household;
  - one email blanked;
  - one calling changed (silent).
- `fixtures/paste-partial.txt`: the first 5 people of paste 2 only.

**Tester action:**
1. As the bishop, open `/roster/import`, open `paste-1.txt` in Notepad, select all, copy, paste,
   then Review.
2. Inspect the checklist and apply.
3. Paste `paste-1.txt` again (expect nothing to change).
4. Paste `paste-2.txt`, review, and apply with the move-out ticked.
5. Paste `paste-partial.txt` (expect the warning; do not apply).
6. Sign in as the secretary and open `/roster/import`.

**Verification checklist:**
- [ ] Paste 1: the summary counts match the fixture (about 19 new, 6 changed with "Full name /
      Birth date added", the moved-out member shown as "back in the ward").
- [ ] The do-not-contact member is listed under "No longer listed" and is **unticked**.
- [ ] The callings that span lines are not reported as broken rows; problems list empty.
- [ ] After apply, the member page shows Full name, Birth date (as written in LCR, no day
      shift) and Email.
- [ ] Re-pasting paste 1 shows nothing to change.
- [ ] Paste 2 shows exactly the phone, household and email ("Removed") changes, 1 new and 1 no
      longer listed. **No** callings change is listed.
- [ ] After applying paste 2 with the move-out ticked, that member shows "Moved Out" and still
      opens (nothing deleted).
- [ ] The partial paste shows the moved-out warning, and Tick all on that group stays disabled
      until the acknowledgement is ticked.
- [ ] The secretary sees the not-permitted message, not the paste box.
- [ ] Every screen is usable at 375px width and in dark mode.

## Validation Commands

```bash
# Migration (hosted DB — dry run first)
npx supabase db push --linked --dry-run
npx supabase db push --linked
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests: new and directly affected files first, then the full suite (stop the dev server first;
# ~50–75 min on the shared hosted DB; rerun a timed-out file alone)
npx vitest run tests/lib/rosterPasteParse.test.ts tests/lib/rosterReportColumns.test.ts tests/lib/rosterReportRow.test.ts tests/lib/ageGroup.test.ts tests/lib/rosterDiff.test.ts tests/lib/rosterValidation.test.ts tests/lib/csvParse.test.ts tests/lib/explicitTimeZone.test.ts
npx vitest run tests/db/roster-paste-import.test.ts tests/routes/roster-paste-import.test.ts tests/db/migrations.test.ts
npm test

# Harness manifest
npm run manifest

# Production build (never while `npm run dev` is running — 7.7 GB RAM)
npm run build
```

**Real-data check (by the executor, read-only, before handing off):** write a throwaway script in
the session scratchpad (never in the repo) that runs `parsePastedReport` +
`matchReportColumns` + `normalizeReportRows` over `C:\Users\Owner\Documents\lcr-paste.txt`.
Assert and print **counts only**: 353 people, 0 problems, 204 distinct households, 0 missing
columns, 0 ignored columns (Age is recognised). Do not print any name, date, phone, email or
address.

## Integration Notes

- **After deploy, the user does (walk them through it, one step at a time):**
  1. In the test ward, dry-run then apply `npm run roster:fill-test-fields -- --ward <test ward
     id>`.
  2. Create the real ward on Stakes & Wards.
  3. Give themselves a calling there.
  4. Switch into it.
  5. Paste the LCR report.
  6. Review and apply. That is the baseline.

  Module release and onboarding the bishopric are ITER-041.
- **Breaking:** the CSV upload is gone. `POST /api/roster/import[/preview]` now take JSON
  `{ text … }`, not multipart. Nothing else calls them.
- **Household naming changes** in the real ward: households are named by LCR's "Head of House and
  Spouse" (for example "Baker, Travis & Bridgette Jean"), not by a family surname. Existing pages
  display `familyName` as-is, so expect that text on household and visit screens.
- `category` becomes a snapshot taken at each import, so a youth who crosses January 1 updates on
  the next paste. ITER-042 computes age group on each Sunday's date from `birth_date` instead and
  must not read `category`.
- **Privacy:** email, callings and ministering are now in `members`, readable by any ward member
  under the existing `members_ward_select` policy (same as phone and address today). None of it
  may be added to `lib/program/publicProjection.ts`.
- `mrn` stays unread and unwritten (migration 065's instruction).
- **Retro known gaps to record:**
  - three-way conflict review (deferred);
  - silent fields never reviewed;
  - empty households left behind by moves accumulate;
  - the HTML clipboard flavor was not needed (verified on the real paste), so the text/plain
    rebuild is the only path;
  - **after ITER-041**, import permission in the real ward is the super admin's only.
