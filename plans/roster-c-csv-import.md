# Plan: Roster C — CSV Import

**Created:** 2026-08-17
**Type:** feature
**Phase:** 2 of 13 — see [02-roster.md](02-roster.md), part 3 of 3
**Depends on:** [roster-a-data-and-pages.md](roster-a-data-and-pages.md) — must be complete
**Sibling:** [roster-b-picker-and-orgs.md](roster-b-picker-and-orgs.md) — independent of this part

---

## Overview

Load the ward from an LCR export. Three steps the user walks through — **map**, then
**preview**, then **confirm** — and nothing is written until the third.

02-roster.md is unusually emphatic here, and for good reason: "Import is
destructive-adjacent; treat it with the same caution as a delete." The two failure modes
that matter are writing something the user did not agree to, and overwriting the
bishopric's hand-entered notes, which the LCR export does not contain and which cannot be
recovered.

### Key requirements

1. Map by **header name**, never by column position; auto-suggest, let the user correct
2. Preview shows counts and per-row problems and writes **nothing**
3. Apply is one transaction, idempotent, and never touches `member_notes`
4. Guard the file: size cap, row cap, MIME check, streamed parse

### Success criteria

- Importing the same file twice produces no duplicates and no lost notes, proven by a test
  against the real database function
- A malformed file produces row-numbered errors, not a 500, proven by a test
- The preview endpoint writes nothing, proven by a test
- `npm run lint`, `npm run typecheck`, and `npm test` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `lib/roster/csv/parseCsv.ts` | create | RFC 4180 parser, streaming, no dependency |
| `lib/roster/csv/columnMapping.ts` | create | Header auto-mapping against known LCR names |
| `lib/roster/csv/normalizeRow.ts` | create | Row → member/household draft, with row-level errors |
| `lib/roster/csv/buildImportPreview.ts` | create | The diff, computed from the file and the mapping |
| `lib/roster/csv/applyImport.ts` | create | Calls `apply_roster_import`, then audits and notifies |
| `lib/roster/csv/limits.ts` | create | The caps, in one place, shared by route and UI |
| `lib/validation/rosterImport.ts` | create | Zod schemas for the mapping and the request |
| `app/api/roster/import/preview/route.ts` | create | `POST` — parse, map, diff. Writes nothing |
| `app/api/roster/import/route.ts` | create | `POST` — re-parse, re-diff, apply |
| `app/(app)/roster/import/page.tsx` | create | The three-step page, bishopric only |
| `app/(app)/roster/import/ImportWizard.tsx` | create | Client — holds the file and the step |
| `app/(app)/roster/import/ColumnMappingStep.tsx` | create | Client — our field ← their column |
| `app/(app)/roster/import/PreviewStep.tsx` | create | Client — counts, diff, per-row problems |
| `tests/lib/csvParse.test.ts` | create | Quoting, escapes, CRLF, caps |
| `tests/lib/csvMapping.test.ts` | create | Header variants, missing required field |
| `tests/lib/csvNormalizeRow.test.ts` | create | Row-level errors, never a throw |
| `tests/lib/csvPreview.test.ts` | create | Diff counts; nothing written |
| `tests/db/roster-import.test.ts` | create | Idempotency and notes preservation, against the real function |
| `testing/scenarios/roster/scenario-009-*` | create | Harness scenario |
| `testing/scenarios/roster/scenario-009-*/fixtures/` | create | Three CSV fixtures |

---

## Dependencies

**No new libraries.** The parser is hand-written per the decision recorded below. Requires
from roster-a:

- `apply_roster_import(p_ward_id, p_households, p_members)` — migration 022
- The `households_ward_family_name_idx` and `members_ward_household_name_idx` lookup indexes
- `lib/roster/queries.ts` for the existing-roster read the diff compares against
- `roster.import` permission — bishopric only, already in `PERMISSIONS`

**No migration in this part.** If `apply_roster_import` turns out to need a different
signature, that is migration **023**, not an edit to 022 — 022 is already applied to the
hosted project.

---

## Decisions Made Before Writing This Plan

### 1. The parser is hand-written, ~120 lines, no dependency

Chosen over `papaparse` and `csv-parse` deliberately. The input is one well-understood
file format from one source; the escape rules are RFC 4180 and fit on a page; and a
dependency added here is a dependency in the bundle and the audit surface forever. It is
also the easiest part of this plan to test exhaustively.

The trade-off is real and worth stating: exotic encodings are on us. Decision 4 handles it.

### 2. The file is uploaded twice, and apply re-derives everything from it

Preview posts the file and gets back a diff. Confirm posts **the same file and the same
mapping again**, and the server re-parses, re-diffs, and applies from what it just
computed.

The alternative — returning the parsed rows to the client and posting them back — makes a
client-supplied diff the thing that gets written. At ≤5MB, uploading twice is cheap; a
tampered confirm payload is not. It also makes "preview writes nothing" trivially true,
because the preview endpoint has no write path to audit at all.

The cost: a file edited between the two steps produces a different result than the preview
showed. Mitigate by returning a content hash (SHA-256 of the decoded text, via
`crypto.subtle.digest`) with the preview and requiring it on confirm — a mismatch is a
400 telling the user to preview again.

### 3. Matching is decided by the database function, not by the client

`apply_roster_import` (migration 022) resolves every match itself, inside the transaction.
The preview computes the *same* matches for display, but the display is advisory. A
household created by someone else between preview and confirm is matched, not duplicated,
because the function looks again.

Match keys, restated so this file is self-contained:

- **Household:** `ward_id` + `lower(family_name)` + `coalesce(lower(address), '')`
- **Member:** `ward_id` + `household_id` + `lower(first_name)` + `lower(last_name)`

On a match, update only the incoming non-null fields. Never overwrite with a blank.

### 4. Encoding: decode as UTF-8, strip the BOM, refuse mojibake rather than importing it

LCR exports have appeared as UTF-8, UTF-8-with-BOM, and Windows-1252. Decoding
Windows-1252 as UTF-8 does not throw — it yields U+FFFD replacement characters, and
"Sørensen" imports as "S<?>rensen" with no error anywhere.

So: strip a leading BOM, decode with `new TextDecoder("utf-8")` (non-fatal), then count
U+FFFD. More than 5 in the whole file, or any in a mapped name column, is a **file-level
error** telling the user to re-save the export as UTF-8. Importing a corrupted name is
worse than refusing the file, because the corruption is then in the roster every other
module reads from.

### 5. Members absent from the file are not touched, and there is no delete

02-roster.md and FEATURES.md both say marking someone moved-out is a manual decision.
The function must not mark, deactivate, or remove anything. State this in the preview UI
too — "N members in your roster are not in this file and will not be changed" — so the
user is not left wondering.

---

## Known Pitfalls (from retro context)

- **[foundation-b-schema](retros/foundation-b-schema.md)** — `member_notes` exists as a
  separate table precisely so notes cannot leak or be clobbered by a column-blind write.
  `apply_roster_import` must not reference it. **Test this explicitly**, do not assume it.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — `readJsonBody()` for JSON
  bodies. These routes take `multipart/form-data`, so they use `request.formData()`
  instead; wrap that in the same kind of typed error so a malformed upload is a 400 rather
  than a 500 that reads as the server's fault.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — error text in the message
  string, not the payload object, or the dev log records `{}`.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — `requireSessionUser()`
  outside the try block.
- **[auth-b-invites-admin](retros/auth-b-invites-admin.md)** — Zod failures return a
  message with no field name. For a mapping error that is genuinely unhelpful, so build
  the mapping errors as explicit named messages rather than relying on Zod's default text.
- **[foundation-c-services](retros/foundation-c-services.md)** — a write refused by policy
  is a zero-row success. Report the counts the function *returns*, never the counts that
  were submitted.
- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — a flow that writes twice must be
  exercised twice. This one literally is: the idempotency requirement is the second run.
  Run every manual check twice.
- **[auth-c-youth-pin](retros/auth-c-youth-pin.md)** — the harness cannot import anything
  using the `@/` path alias. If a scenario seed needs a value from `lib/roster/csv/`, that
  value belongs in an import-free leaf module, re-exported for app code.
- **roster-a Decision 3** — `assertCan(user, "roster.import")` is the real boundary. The
  ward-scoped policy loop would happily let an org secretary insert members.

---

## Tasks

### Task 1: Limits

**File:** `lib/roster/csv/limits.ts` (create)

```ts
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_REPLACEMENT_CHARACTERS = 5;
export const ACCEPTED_MIME_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"] as const;
```

One module so the route enforcement and the UI's "up to 2000 rows" copy cannot drift.
`application/vnd.ms-excel` is included because Windows reports `.csv` that way and
rejecting it would refuse a perfectly good file; `text/plain` because some browsers send
that. The extension is checked as well — MIME alone is not trustworthy — and the real
guard is that the parse fails on anything that is not delimited text.

---

### Task 2: The parser

**File:** `lib/roster/csv/parseCsv.ts` (create)

```ts
export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  rowCount: number;
  replacementCharacterCount: number;
};

export async function parseCsvStream(
  stream: ReadableStream<Uint8Array>,
  options?: { maxRows?: number; maxBytes?: number },
): Promise<ParsedCsv>;

export function parseCsvText(text: string, options?): ParsedCsv;
```

`parseCsvStream` reads the stream chunk by chunk through a `TextDecoder` with
`{ stream: true }`, feeding a stateful row assembler. It **stops and throws a typed
`CsvLimitError` the moment** `maxBytes` or `maxRows` is exceeded — that is what 02-roster.md
means by "a malformed one claiming 2 million rows should be rejected, not loaded". A parser
that reads the whole file and then checks the count has already done the damage.

`parseCsvText` is the same assembler over a complete string, exported for the tests.

Rules to implement:

- Fields separated by `,`; records by `\n`, with a preceding `\r` discarded
- A field beginning with `"` is quoted: everything until the closing `"` is literal,
  including commas and newlines, and `""` is a literal `"`
- A quoted field followed by anything other than `,` or end-of-record is a **row-level
  error**, not a throw
- Leading BOM (`﻿`) stripped from the first field of the first row only
- Trailing blank lines ignored; a row of entirely empty fields is skipped and counted, not
  reported as an error — LCR exports end with them
- Headers are trimmed; duplicate headers get a suffix (`Phone`, `Phone (2)`) so the mapping
  UI can distinguish them
- A row with a different field count from the header is **not** an exception. Pad short
  rows with empty strings, keep the extras on long rows, and let `normalizeRow` decide
  whether that matters. A short row missing only an optional column is fine

Count U+FFFD occurrences as it goes and return the total (Decision 4).

---

### Task 3: Column mapping

**File:** `lib/roster/csv/columnMapping.ts` (create)

```ts
export const IMPORT_FIELDS = [
  "firstName", "lastName", "familyName", "address",
  "category", "gender", "phone",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["firstName", "lastName", "familyName"];

export type ColumnMapping = Partial<Record<ImportField, number>>;

export function suggestMapping(headers: readonly string[]): ColumnMapping;
export function missingRequiredFields(mapping: ColumnMapping): ImportField[];
```

`suggestMapping` matches by **normalized header text** — lowercased, punctuation and
whitespace stripped — against a table of known aliases. Never by position (02-roster.md
§Pitfalls: LCR column order changes between exports).

Aliases to seed the table with, from real LCR export headers:

| Field | Aliases |
|---|---|
| `firstName` | `preferred name`, `first name`, `given name`, `firstname` |
| `lastName` | `last name`, `surname`, `family name (last)`, `lastname` |
| `familyName` | `household name`, `family name`, `head of household`, `household` |
| `address` | `address`, `street address`, `home address`, `mailing address` |
| `category` | `age category`, `category`, `member type` |
| `gender` | `gender`, `sex` |
| `phone` | `phone`, `phone number`, `individual phone`, `household phone`, `mobile phone` |

`familyName` and `lastName` overlap by design — `"Family Name"` is ambiguous in real
exports. When a header matches both, assign it to `lastName` and leave `familyName`
unmapped so the user has to make the call. A wrong silent guess here mis-groups the entire
ward.

`suggestMapping` never returns a mapping using the same column index for two fields.

**Full name in one column.** Some exports carry `Name` as `"Andersen, Mark"`. Do not try to
split it. Leave `firstName`/`lastName` unmapped, and let the required-field check block the
import with a message naming what to do: *"This export has names in a single column. Split
Name into First Name and Last Name before importing."* Guessing at name splitting is how a
roster ends up with people called "Van".

---

### Task 4: Row normalization

**File:** `lib/roster/csv/normalizeRow.ts` (create)

```ts
export type RowProblem = { rowNumber: number; field?: ImportField; message: string };

export type NormalizedRow = {
  rowNumber: number;
  familyName: string;
  address: string | null;
  firstName: string;
  lastName: string;
  category: MemberCategory | null;
  gender: MemberGender | null;
  phone: string | null;
};

export function normalizeRows(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
): { rows: NormalizedRow[]; problems: RowProblem[] };
```

**`rowNumber` is the line number in the user's file**, header included — so row 1 is the
header and the first data row is 2. That is the number they see in a spreadsheet, and a
number they cannot locate is worse than no number. Comment it; an off-by-one here is
invisible in tests written against the same helper.

- A row missing a required field is a problem and is **excluded** from the import, not
  guessed at. The rest of the file still imports; this is per-row, not all-or-nothing
- `category`: accept `adult`/`youth`/`child` case-insensitively, plus common LCR spellings
  (`Adult`, `Young Men`/`Young Women` → `youth`, `Child`/`Primary` → `child`). An
  unrecognized value is a problem naming the value and the accepted set, and the member
  still imports with `category: null` — a missing category is recoverable, a dropped person
  is not
- `gender`: `m`/`male`/`f`/`female`, case-insensitively. Same treatment
- `phone`: kept as written. Do not reformat. A phone number is handed to the OS `sms:` link
  later and reformatting is how you break a number that worked
- Every string trimmed; empty becomes `null` for optional fields
- **Never throws.** Every failure is a `RowProblem`. This is what `csv-malformed` tests

---

### Task 5: The preview

**File:** `lib/roster/csv/buildImportPreview.ts` (create)

```ts
export type ImportPreview = {
  fileHash: string;
  totalRows: number;
  newHouseholds: { familyName: string; address: string | null; memberCount: number }[];
  matchedHouseholdCount: number;
  newMemberCount: number;
  matchedMemberCount: number;
  untouchedMemberCount: number;
  problems: RowProblem[];
};

export async function buildImportPreview(
  wardId: string, normalized: readonly NormalizedRow[], fileHash: string, client?,
): Promise<ImportPreview>;
```

Reads the existing roster through `lib/roster/queries.ts` with **all three statuses** —
a `moved_out` member must match rather than being re-created as a duplicate. This is the
one place in the codebase that deliberately overrides the default from roster-a Decision 2;
comment why.

Match in memory using the same keys the database function uses (Decision 3). Building the
key normalization as a shared exported helper — `householdKey()`, `memberKey()` — and
using it in both places is the cheapest defence against the preview and the apply
disagreeing.

`untouchedMemberCount` is Decision 5's number: members in the roster and absent from the
file.

**This module performs no writes.** No insert, no update, no `writeAuditLog`. `csv-preview`
asserts that.

---

### Task 6: The apply

**File:** `lib/roster/csv/applyImport.ts` (create)

```ts
export type ImportResult = {
  householdsCreated: number; householdsUpdated: number;
  membersCreated: number; membersUpdated: number;
  newHouseholdNames: string[];
  problems: RowProblem[];
};

export async function applyRosterImport(
  wardId: string, userId: string, normalized: readonly NormalizedRow[], client?,
): Promise<ImportResult>;
```

- Builds the two `jsonb` payloads and calls
  `supabase.rpc("apply_roster_import", { p_ward_id, p_households, p_members })`. One
  statement, one transaction.
- Counts come from the function's return value, never from the input length
  (foundation-c pitfall).
- **One audit row** for the whole import, per 02-roster.md:
  `action: "roster_imported"`, `module: "roster"`, `detail: { totalRows, householdsCreated,
  householdsUpdated, membersCreated, membersUpdated, problemCount }`. Not one row per
  member — 2000 audit rows for one user action is an audit log nobody can read.
- `emitNotification({ triggerKey: "new_household_added", … })` for genuinely new households
  only. **Emit one notification summarising them**, not one per household: an import of a
  new ward would otherwise fire 150 notifications at four roles each. Title:
  "12 new households added". Body names the first few and counts the rest. Record this as a
  deliberate reading of the trigger — the trigger key is per-event, the import is one event.
- Both helpers never throw by contract, so an audit or notification failure cannot fail the
  import. That is the sanctioned exception, not an accident.

---

### Task 7: Routes

**Files:** `app/api/roster/import/preview/route.ts`, `app/api/roster/import/route.ts` (create)

Both are `POST`, both take `multipart/form-data` with `file` and (for the second) `mapping`
and `fileHash`.

Order of operations, identical in both:

1. `requireSessionUser()` — outside the try
2. `assertCan(user, "roster.import")` — bishopric only
3. Read `formData()` inside the try, translating a failure to a 400
4. Check MIME and extension against `ACCEPTED_MIME_TYPES`; check `file.size` against
   `MAX_IMPORT_FILE_BYTES` **before reading a byte**
5. `parseCsvStream(file.stream(), { maxRows, maxBytes })`; a `CsvLimitError` becomes a 413
   with a message naming the actual limit
6. Check the replacement-character count (Decision 4) → 400 with the re-save instruction
7. `suggestMapping` / validate the supplied mapping; missing required fields → 400 naming
   each one
8. `normalizeRows`, then `buildImportPreview`

**Preview** returns the preview and stops. **No audit row** — a preview is not a mutation,
and adding one here would make the "preview writes nothing" guarantee harder to verify,
not easier.

**Import** additionally:

9. Compare the recomputed hash against the submitted `fileHash` → 400 "The file changed
   since you previewed it. Preview again." (Decision 2)
10. `applyRosterImport(…)`, which audits and notifies
11. Return the counts and the problems

Cap the number of problems returned at, say, 200, with a `problemsTruncated` count — a file
where every row fails should not return a 40,000-entry array. State the truncation in the
response; a silent cap reads as "only 200 things were wrong".

---

### Task 8: The import page

**Files:** `app/(app)/roster/import/page.tsx`, `ImportWizard.tsx`,
`ColumnMappingStep.tsx`, `PreviewStep.tsx` (create)

Server Component page: gate with `can(user, "roster.import")`, render `NotPermitted`
otherwise (never throw from a Server Component — auth-b pitfall). Everything below it is
one client wizard holding the `File` object across steps.

**Step 1 — choose a file.** `<input type="file" accept=".csv,text/csv">`. Show the size and
row caps up front, from `limits.ts`. Reject an oversized file client-side too — the server
check is the boundary, the client check is the courtesy.

**Step 2 — map columns.** A row per `ImportField`: our label on the left, a select of their
headers on the right, prefilled from `suggestMapping`. Show a **preview cell from the first
data row** beside each select — 02-roster.md asks for this, and it is what catches a
`familyName`/`lastName` mix-up in one glance. Required fields marked; the Continue button
disabled with a message naming what is unmapped, not silently greyed.

**Step 3 — preview and confirm.** In this order:

1. The counts — new households, new members, matched members, untouched members
2. The problems list, each with **its row number** and what is wrong, scrollable
3. The new-household list, so a mis-mapped `familyName` shows up as 400 new households
   named after individuals rather than 40 named after families
4. The confirm button, labelled with what it will do — "Import 138 members" — not "Confirm"

Nothing on this screen may look like it has already happened. Copy in the past tense on a
preview screen is how a user confirms twice.

After confirm: a result summary with the counts the server returned, a link to `/roster`,
and the problems list again — the rows that did not import are the whole reason to still be
reading.

**Mobile:** a wizard at 375px is a stack of full-width steps, one visible at a time. The
mapping step's select rows stack label-above-control. Do not build a table.

---

## Testing Strategy

`tests/lib/` files are camelCase, `tests/db/` and `tests/rls/` are kebab-case. The phase
plan's kebab-case names are mapped onto that convention below.

### `tests/lib/csvParse.test.ts`

Pure, exhaustive, cheap. Use `parseCsvText` except where noted.

- Plain rows; `\r\n` and `\n` line endings; a file with no trailing newline
- Quoted field containing a comma, a newline, and a `""` escape
- A quoted field at the start, middle and end of a row
- Leading BOM stripped from the first header, not from later fields
- Trailing blank lines ignored; a fully-empty row skipped, not counted as data
- Short and long rows padded/kept, no exception
- Duplicate headers suffixed
- A stray `"` mid-field reported as a row problem, not thrown
- **Limits, via `parseCsvStream`:** `maxRows` exceeded throws `CsvLimitError` and — assert
  this — the returned/partial row count never exceeds the cap, proving it stopped early
  rather than checking afterwards
- U+FFFD counted correctly on a Windows-1252 byte sequence decoded as UTF-8

### `tests/lib/csvMapping.test.ts` (the phase plan's `csv-mapping`)

- Each alias in the table maps to its field, in any case and with punctuation
- `"Family Name"` maps to `lastName` and leaves `familyName` unmapped (the ambiguity rule)
- Headers in a different order map identically — the position-independence guarantee
- `missingRequiredFields` returns each unmapped required field
- No two fields share a column index
- An export with only a single `Name` column leaves both name fields unmapped

### `tests/lib/csvNormalizeRow.test.ts` (the phase plan's `csv-malformed`)

- Missing required field → a problem with the right `rowNumber`, row excluded
- **`rowNumber` is the file line number**: the first data row is 2
- Unrecognized `category` → a problem, and the row still imports with `category: null`
- `Young Women` → `youth`; `Primary` → `child`
- Whitespace trimmed; empty optional fields become `null`
- Phone preserved verbatim, including formatting and a leading `+`
- Fuzz it: 200 rows of random garbage produce problems and **never throw**

### `tests/lib/csvPreview.test.ts` (the phase plan's `csv-preview`)

Uses an injected fake Supabase client, so it needs no network.

- Counts are right for a mix of new and matching households and members
- A `moved_out` member with a matching name **matches** rather than being counted as new
- `untouchedMemberCount` counts roster members absent from the file
- Case and whitespace differences in a family name still match
- **Nothing is written:** assert the injected client received no `insert`, `update`,
  `upsert`, `delete`, or `rpc` call. Assert on the client, not on the result — an assertion
  about the return value would pass even if the module wrote

### `tests/db/roster-import.test.ts` (the phase plan's `csv-idempotent`)

Against the hosted database, because the transaction and the matching live in
`apply_roster_import` and a mock would test the mock. Seed with the service client via
`seedFixtures`, assert with a bishop client, clean up in `afterAll`, and never assume an
empty table (foundation-b pitfall).

- Import a 10-row payload: correct create counts; the rows exist
- **Import the identical payload again: zero created, and the total household and member
  counts are unchanged.** The core assertion
- Seed a `member_notes` row, re-import, and assert the note is **still there, unmodified**.
  This is the irreplaceable-data guarantee and the one test that must never be deleted
- A member in the database and absent from the payload is untouched — same `status`, same
  `updated` fields (Decision 5)
- An incoming `null` field does not blank an existing value
- An incoming non-null field updates an existing value
- Two households with the same family name and different addresses stay two households
- The function refuses a `p_ward_id` that is not the caller's ward — proving
  `SECURITY INVOKER` and RLS are both in force

---

## Test Scenarios (Harness)

### Scenario 009: Import an LCR export, twice

**Tags:** `[roster, full, import, destructive]`
**Purpose:** Import is destructive-adjacent, and the guarantee that matters — running it
twice changes nothing and loses no notes — can only be observed by actually running it
twice against a roster that already has data and notes. The mapping step is also the one
screen in this phase whose failure mode is silent: a `familyName`/`lastName` mix-up
produces a plausible-looking import that is entirely wrong, and only a human comparing the
preview against the file catches it.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `bishop`, `secretary` (ward_secretary — holds `roster.view` but **not**
  `roster.import`), `eqpres`
- Households — 3 pre-existing, matching three rows of `lcr-export.csv` exactly
- Members — 7 pre-existing; one of them `moved_out`, one with a phone already set
- Member notes — 2 notes on a member who also appears in the CSV
- Notification triggers — all, including `new_household_added`

**Fixtures** in the scenario directory:

| File | Contents |
|---|---|
| `lcr-export.csv` | 40 rows, realistic LCR headers in a non-obvious order, quoted addresses containing commas, one blank trailing line |
| `lcr-export-messy.csv` | The same 40 rows plus: 2 rows missing a last name, 1 with `category: "Senior"`, 1 short row, 1 with an unterminated quote, and a duplicate header |
| `not-a-roster.csv` | Two columns of unrelated data, so no required field can be mapped |

**Tester action:** Sign in as `bishop`, walk `/roster/import` with each fixture, then import
`lcr-export.csv` a second time. Check `/roster`, `audit_log`, `notifications`, and
`member_notes` in the Supabase dashboard between runs. Then try to reach the page as
`secretary`.

**Verification checklist:**
- [ ] The mapping step prefills correctly despite the shuffled column order, and shows a
      sample value beside each select
- [ ] `Family Name` is **not** silently mapped to the household field — the user is required
      to choose
- [ ] Continue is blocked while a required field is unmapped, with a message naming it
- [ ] The preview shows new-household and new-member counts that match the file
- [ ] The preview lists the 3 pre-existing households as matched, not new
- [ ] The preview states how many existing members are absent from the file and will not
      be changed
- [ ] Leaving the preview without confirming writes **nothing** — `households` and `members`
      row counts in the dashboard are unchanged
- [ ] Confirming imports the file and the result summary counts match the preview
- [ ] `/roster` shows the imported households grouped correctly, with addresses intact
      including the ones containing commas
- [ ] The `moved_out` member was matched and updated, **not** duplicated, and is still
      `moved_out`
- [ ] The pre-existing phone number was not blanked by an empty column in the file
- [ ] **Running the identical import a second time reports 0 created and creates no
      duplicate rows**
- [ ] **After the second import, both `member_notes` rows are still present and unchanged**
- [ ] `notifications` has one summarising `new_household_added` row, not one per household
- [ ] `audit_log` has exactly one `roster_imported` row per confirmed import, carrying the
      counts, with `module = 'roster'`
- [ ] `lcr-export-messy.csv` previews with a problem per bad row, each showing the row
      number as it appears in a spreadsheet, and the good rows still import
- [ ] The `"Senior"` category row imports with no category rather than being dropped
- [ ] At 375px each wizard step is full-width and one at a time, in light and dark mode

**Failure behavior:**
- [ ] `not-a-roster.csv` is refused at the mapping step naming the unmapped required
      fields, not with a 500 and not with an empty preview
- [ ] A `.png` renamed to `.csv` is refused with a readable message
- [ ] A file over 5MB is refused before it uploads, and the server refuses it too if the
      client check is bypassed
- [ ] Editing the file between preview and confirm produces "The file changed since you
      previewed it", not a silent import of different data
- [ ] `secretary` opening `/roster/import` sees "Not permitted" with a way back, not a
      blank page and not a 500
- [ ] A `POST` to `/api/roster/import` from a `secretary` session returns 403
- [ ] Nothing in `audit_log` or `notifications` for any refused or previewed-only run

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm test
npm run harness:typecheck
```

No migration in this part. If `apply_roster_import` needed changing, that is migration 023
and `npx supabase db push && npm run db:types` go first.

---

## Integration Notes

- **`/roster` links here.** Roster-a's empty state already points at `/roster/import`; that
  link starts resolving with this part.
- **`apply_roster_import` is the contract with migration 022.** Its parameter names and
  return shape are fixed by a migration already applied to the hosted project.
- **The parser is roster-scoped for now.** If a later phase needs CSV — none is planned —
  `lib/roster/csv/parseCsv.ts` moves to a shared location rather than being copied.
- **Record in the retro:** whether the alias table in `columnMapping.ts` actually matched a
  real LCR export, and which headers it missed. That table is a guess until a real file has
  been through it, and the next person to touch it needs to know which parts are verified.
- **Phase 2 Definition of Done** ([02-roster.md](02-roster.md)) is complete once this part
  lands. Check every box, including the ones roster-a and roster-b own, before writing the
  retro.
