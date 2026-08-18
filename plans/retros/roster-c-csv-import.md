---
id: roster-c-csv-import
type: feature
iter: null
commits: ["6d405a6", "aa284c2"]
date: 2026-08-18
files:
  - lib/roster/csv/limits.ts
  - lib/roster/csv/parseCsv.ts
  - lib/roster/csv/columnMapping.ts
  - lib/roster/csv/normalizeRow.ts
  - lib/roster/csv/buildImportPreview.ts
  - lib/roster/csv/applyImport.ts
  - lib/roster/csv/importRequest.ts
  - lib/validation/rosterImport.ts
  - app/api/roster/import/preview/route.ts
  - app/api/roster/import/route.ts
  - app/(app)/roster/import/page.tsx
  - app/(app)/roster/import/ImportWizard.tsx
  - app/(app)/roster/import/ColumnMappingStep.tsx
  - app/(app)/roster/import/PreviewStep.tsx
  - components/roster/ImportProblemList.tsx
  - app/(app)/roster/page.tsx
  - tests/db/roster-import.test.ts
  - testing/scenarios/roster/scenario-009-import-lcr-export-twice/
related: [roster-a-data-and-pages, roster-b-picker-and-orgs, foundation-c-services, foundation-b-schema]
---

## What was done

Part 3 of Phase 2, and the last of it: LCR CSV import as a three-step wizard — choose a file,
match the columns, read a preview and confirm. A hand-written RFC 4180 parser with no dependency,
a two-pass header matcher, a diff that performs no writes, and `apply_roster_import` (migration
022) doing the apply in one transaction. The file is uploaded twice and the confirm re-derives
everything from it, guarded by a SHA-256 the preview returned.

**This entry covers the browser walkthrough, which happened a day after the code landed.** The
code was committed at `6d405a6` with 452 tests green and *nothing exercised through a browser*.
Harness scenario 009 was then walked end to end: 45 checks, 43 passed, 2 real reporting bugs
found and fixed. `6d405a6` is the feature; `aa284c2` is the walkthrough's two fixes and this
entry.

Every guarantee the scenario exists to prove held on the first run. A second identical import
created nothing, updated nothing, left both `member_notes` rows byte-identical with the same
`updated_at`, wrote a second all-zero `roster_imported` audit row and emitted **no** second
notification. Comma addresses, `Sørensen`, the two Smith households at different addresses, the
moved-out member matched rather than duplicated, and the blank phone column that did not blank
`555-0101` all behaved as designed.

## Did the alias table match a real LCR export?

**Unknown — no genuine export was available, and this is the honest answer rather than a silent
omission.** `columnMapping.ts`'s alias table was exercised only against the synthetic fixtures in
`scenario-009`, which were written from the same assumptions as the table itself. That makes the
test circular: it proves the matcher is self-consistent, not that it knows what LCR actually
emits.

What *is* verified: the two-pass ambiguity rule, position independence, the duplicate-header
suffix (`Individual Phone (2)`), and the refusal to guess Household name from `Family Name`.
Those are structural and hold for any header set. What is **not** verified is the vocabulary —
every alias string in that table is still a guess.

**The first person with a real export should run it through the mapping step and record which
headers came back unmapped.** That is a five-minute task and it is the only thing standing
between this table and a ward whose whole import lands in the wrong columns.

## Key decisions

- **A disagreement between the preview and the result screen is a bug even when the database is
  right.** The preview counted members *matched*; migration 022 counts members whose values
  actually *changed*, because it only writes when `(category, gender, phone)` differs. First
  import read "6 to update" then "3 updated"; the re-import read **"40 to update" then "0
  updated"** — the precise reassurance the scenario exists to deliver, inverted into what looks
  like a silent skip of the entire ward. Both numbers were correct and the pairing was not.
- **Fixed by relabelling and reporting both, not by mirroring the SQL in TypeScript.** The
  preview now says "Members already in the roster" and states that only columns with a value
  overwrite; the result says "40 already in the roster, 0 changed". The rejected alternative —
  reimplementing the `coalesce` + `is distinct from` rule in `buildImportPreview` so it could
  predict 3 — would have put the update semantics in two languages, which is the exact drift
  `buildImportPreview.ts`'s own header comment exists to prevent.
- **`membersMatched` is derived, not queried.** Every deduped payload row either created somebody
  or matched somebody, so `members.length - membersCreated` is the match count with no second
  round trip, computed from the same map the function was handed.
- **A fetch that throws in this wizard is more likely a changed file than a dead network.** The
  browser refuses to upload a file that changed on disk since it was chosen — Chrome aborts with
  `ERR_UPLOAD_FILE_CHANGED`, surfaced as a bare `TypeError` — so the request never reaches the
  server and the `fileHash` check never gets to answer. Both `catch` blocks now re-read one byte
  of the file to tell the two apart, and the client's wording is copied from the server's 400 so
  the user reads one sentence whichever side caught it.

## Pitfalls for next time

- **The server-side `fileHash` check is a second line of defence, not the first one a user
  meets.** It is correct and it returns the right 400 — verified directly by posting a mismatched
  hash — but in a normal browser the upload is aborted before the request is sent. Anything that
  relies on a server error reaching the UI after a `FormData` file upload should be tested by
  actually editing the file, not by trusting the route's unit behaviour.
- **A `catch` that maps every thrown error to one message will eventually be wrong about the
  common case.** `NETWORK_ERROR` was a reasonable default until the most likely real-world cause
  of a throw turned out to be something else entirely.
- **Unit tests asserted the RPC's counts and nothing asserted the two screens agreed.**
  `tests/db/roster-import.test.ts` already proved `membersUpdated` was 0 on a re-import — the
  number was never wrong. The bug lived in the gap between two correct numbers, which is a shape
  no single-layer test catches. `membersMatched` now has assertions in both import tests.
- **Trailing rows dropped during normalization are not counted in "Rows read from the file".**
  The messy fixture has 45 data rows and the preview reports 43, because `totalRows` is
  `normalized.length` and the two rows missing a last name were excluded. Internally consistent
  (3 to create + 40 matched = 43) but the label overstates what it means. Not worth changing
  alone; worth knowing before someone reconciles it against a spreadsheet.
- **A `.png` renamed to `.csv` is blocked, but by the "choose a column" message rather than by
  anything naming the real problem.** `limits.ts` documents this as intended — "the real guard is
  that the parse produces no mappable header" — and it is safe, with no crash and no import. It
  still leaves a user who picked the wrong file staring at a mojibake column called `<?>PNG`.
- **The Continue button is both disabled *and* labelled with the reason.** The scenario asked for
  "a message naming it, not a silently greyed button" and the message is present in a `role=
  "status"` region, so this passes — but the button carries no `aria-describedby` tying the two
  together, so a screen-reader user meets a disabled control and a separate announcement.

## Environment note — not an application bug

Midway through the walkthrough `/roster/member/[id]` and `/roster/household/[id]` began returning
500 with `Jest worker encountered 2 child process exceptions`. **This was the dev server, not the
code.** The machine had 0.6 GB of 7.7 GB free (CLAUDE.md §9) and Next could not spawn a render
worker to compile a route it had not served yet; already-compiled routes kept working, which is
what made it look route-specific. Restarting a dev server that had been up 19 hours fixed it
completely.

**Next 16 writes its dev log to `.next/dev/logs/next-development.log`** — that is where to look
first, and it is worth knowing because the browser only ever shows the worker-crash wrapper with
no underlying stack. A second `next dev` refuses to start and prints the running server's PID and
log path, which is a fast way to find both.

## Known gaps handed to later phases

- **The alias table is unverified against real LCR output.** See above. This is the single
  highest-value follow-up in this phase and it needs a file nobody had.
- **`scenario-008` (roster-b) is still unwalked.** `roster-b`'s retro handed it forward to be run
  before Phase 4; `roster-c` touched none of that code and did not run it either.
- **Route handlers remain unit-untested**, for the fifth phase running — there is no local
  server. Both import routes are now driven by hand through the harness instead, including the
  403, 400 and 413 paths.
- **The messy fixture's problems list has never been seen with more than 6 entries.**
  `MAX_REPORTED_PROBLEMS` is 200 and `capProblems` reports what it dropped, but no fixture comes
  close to the cap, so the truncation copy is unexercised in a browser.
- **`assertCan(user, "roster.import")` is still the only thing standing between a ward secretary
  and the roster** — migration 019 grants INSERT on `households` and `members` to every
  authenticated member of the ward. Verified from a real secretary session: both routes return
  403, and permission is checked *before* payload validation. The same asymmetry `roster-a` and
  `roster-b` recorded.
