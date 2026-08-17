# Phase 2 — Ward Roster

Households, members, organization membership, and the CSV import that loads the ward from
LCR. This is the single source of truth every other module reads from.

**Depends on:** Phase 1. **Unlocks:** Phases 3, 4, 7, 8, 10.
**Reference:** [FEATURES.md](../FEATURES.md) §Module 1; [SPEC.md](../SPEC.md) §API Routes → Roster.

---

## Goals

1. Household and member CRUD, browsable as a flat list or grouped by household
2. CSV import from an LCR export, with a preview-and-confirm step
3. A reusable `MemberPicker` that every other module uses to select people
4. Organization membership so org leaders see a filtered roster

---

## Step 1 — Data Access Layer

`lib/roster/`:

```ts
export async function listHouseholds(opts?: { search?: string }): Promise<HouseholdWithMembers[]>
export async function listMembers(opts?: {
  category?: MemberCategory; status?: MemberStatus;
  orgId?: string; search?: string;
}): Promise<Member[]>
export async function getMember(id: string): Promise<MemberDetail>
export async function upsertHousehold(input: HouseholdInput): Promise<Household>
export async function upsertMember(input: MemberInput): Promise<Member>
```

**Default filter is `status = 'active'`.** Moved-out members are retained for history and
must not appear in pickers, counts, or goal calculations unless explicitly requested.
Getting this default wrong quietly corrupts every downstream number.

**Non-bishopric callers get a filtered list.** RLS handles the hard boundary; the data
layer applies the org filter so an EQ president's picker shows EQ members by default
without them having to filter manually.

**Member notes are bishopric-visible only, and they are not a column.** An earlier draft of
this plan said `members.notes` was a column to leave out of the general select. There is no
such column and there must not be one: migration 003 put notes in their own `member_notes`
table precisely because **RLS grants or denies a row, never a column**, so a bishopric-only
column on `members` could not have been protected by the security boundary CLAUDE.md rule 2
requires ([foundation-b-schema retro](retros/foundation-b-schema.md)).

The intent survives and is stronger: `select('*')` on `members` cannot leak notes because
there is nothing to leak. Reads and writes of `member_notes` go through
`lib/roster/memberNotes.ts`, kept separate from `lib/roster/queries.ts` so that "did this
response include notes?" is answerable from an import list. Corrected during roster-a
([roster-a-data-and-pages.md](roster-a-data-and-pages.md) Decision 1).

---

## Step 2 — Roster Pages

| Route | Shows |
|---|---|
| `/roster` | Household view (default) and flat list view, toggle persisted per user |
| `/roster/household/[id]` | Household detail: address, members, edit |
| `/roster/member/[id]` | Member detail. Assignment-history tab is bishopric-only (Phase 4 fills it) |

**Household view is the default** — FEATURES.md is explicit that assignment and activity
modules browse through households. Build it first and treat the flat list as secondary.

Filters: category (Adult/Youth/Child), status, organization, free-text search across
first name, last name, and family name.

Mobile-first. At 375px the household list is a stack of cards; at desktop it becomes a
two-column layout with detail beside the list.

---

## Step 3 — Components

`components/roster/`:

| Component | Notes |
|---|---|
| `HouseholdList` | Virtualized if over ~200 households. Search, filter, expand-to-members |
| `MemberPicker` | **The most reused component in the app.** Modal or inline. Props: `filter` (category, org, status), `multiple`, `excludeIds`, `onSelect`. Browses by household per FEATURES.md. Shows `ReliabilityFlag` when the caller passes `showFlags` |
| `MemberStatusBadge` | Active / Moved Out / Do Not Contact |
| `ReliabilityFlag` | Renders pattern flags. Bishopric-only. Implemented in Phase 4; stub the interface here |
| `HouseholdForm` / `MemberForm` | Zod-validated, shared schema with the API |

Design `MemberPicker`'s props carefully now — Phases 4, 7, 8, and 10 all consume it, and
changing its signature later means touching every module.

**`Do Not Contact` members** must be visually distinct everywhere and excluded from
assignment and visit pickers by default. Allow an explicit override with a confirmation,
because occasionally a bishop legitimately needs to.

---

## Step 4 — CSV Import

`/api/roster/import` and `/roster/import`. Bishopric-only.

Import is **two-step**: upload and preview, then confirm. Never write on upload.

**Step A — parse and map.** LCR exports vary. Do not hardcode column positions:

1. Parse headers, attempt auto-mapping against known LCR names
2. Show the user a mapping UI: our field ← their column, with a preview row
3. Required mappings: first name, last name, household/family name. Everything else optional

**Step B — preview.** Show counts and a diff before anything is written:

- N new households, N new members
- N existing members matched (by name + household)
- N rows with problems, each with the row number and what is wrong
- **Nothing is written until the user confirms.** Import is destructive-adjacent; treat
  it with the same caution as a delete.

**Step C — apply.** One transaction. Match strategy:

- Household: exact match on `family_name` + `address` within the ward
- Member: exact match on `first_name` + `last_name` + `household_id`
- On match, update non-null incoming fields. **Never overwrite `notes`** — those are
  hand-entered by the bishopric and are not in the LCR export
- Members present in the database but absent from the import are **not** touched. Marking
  people moved-out is a manual decision, per FEATURES.md

Write one audit row for the import with counts in `detail`. Emit `new_household_added`
for genuinely new households.

**Guard the file:** cap size (~5MB), cap row count (~2000), reject non-CSV MIME types,
and stream the parse rather than buffering the whole file.

---

## Step 5 — Organization Membership

`member_organizations` links members to orgs and drives filtered roster views.

- Editable from the member detail page (bishopric and the relevant org leader)
- A member can belong to multiple orgs
- Bulk-assign from the roster list: select members → assign to org

Bishopric fulfils the Young Men presidency in this ward, so there is no separate YM
organization. Do not create one; the sacrament module (Phase 10) draws from youth members
by category and gender, not from a YM org.

---

## Tests

| Test | Asserts |
|---|---|
| `member-status-filter.test.ts` | Default queries exclude `moved_out`; explicit opt-in includes them |
| `notes-visibility.test.ts` | A non-bishopric user's member query never returns `notes` |
| `csv-mapping.test.ts` | Auto-mapping handles LCR header variants; unmapped required field blocks import |
| `csv-preview.test.ts` | Preview writes nothing to the database |
| `csv-idempotent.test.ts` | Importing the same file twice produces no duplicates and no overwritten notes |
| `csv-malformed.test.ts` | Missing columns, bad encoding, and empty rows produce row-level errors, not a 500 |
| `org-filter.test.ts` | An EQ president's roster query returns only EQ members |

---

## Definition of Done

- [ ] Household and flat roster views work, with search and filters, at 375px and desktop
- [ ] Member and household create/edit work with Zod validation on both sides
- [ ] CSV import: map → preview → confirm, idempotent, transactional
- [ ] Import errors are reported per row with a row number and a clear reason
- [ ] `MemberPicker` works standalone and its props cover the needs of Phases 4, 7, 8, 10
- [ ] `notes` never appears in a non-bishopric response
- [ ] Organization membership editable individually and in bulk
- [ ] All seven tests pass

---

## Pitfalls

- **Forgetting the status filter.** A moved-out member appearing in the speaker rotation
  or the visit-goal denominator is a real, quiet bug. Default to active everywhere.
- **Overwriting notes on re-import.** The bishopric's notes are irreplaceable; the LCR
  export does not contain them. Explicitly exclude the column from import updates.
- **Trusting LCR column order.** It changes between exports and church updates. Map by
  header name, with a user-facing mapping step.
- **Buffering large CSVs.** Stream the parse. A 2000-row file is fine; a malformed one
  claiming 2 million rows should be rejected, not loaded.
- **`MemberPicker` API churn.** Four later phases depend on it. Decide the props now.
- **Deleting members.** There is no delete. Departing members are marked `moved_out` so
  their assignment and visit history survives. Do not build a delete button.
