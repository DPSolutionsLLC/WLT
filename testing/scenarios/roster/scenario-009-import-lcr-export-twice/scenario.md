---
name: Import an LCR export, twice
scope: roster-c-csv-import
part: 1
tags: [roster, full, import, destructive]
prerequisites: none
---

## Purpose

Import is destructive-adjacent, and the guarantee that matters — running it twice changes nothing
and loses no notes — can only be observed by actually running it twice against a roster that
already has data and notes. A unit test proves the counts; only a second real run proves the
second run is safe.

The mapping step is also the one screen in this phase whose failure mode is silent. A
`Family Name`/household mix-up produces a plausible-looking import that is entirely wrong — 40
households named after individuals instead of 14 named after families — and only a human
comparing the preview against the file catches it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds `roster.import` |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `roster.view`, **not** `roster.import` |
| | `eqpres` (org_president, elders quorum, Tomas Ruiz) |
| Households | 3 — Andersen (`12 Oak Street, Apt 4`), Brooks (`48 Willow Lane`), Nguyen (`7 Cedar Court`) |
| | All three match rows in `lcr-export.csv` exactly, on family name plus address |
| Members | 7 — Mark, Julia and Carlos Andersen; Sarah and Grace Brooks; David and Helen Nguyen |
| | Carlos is `moved_out` and **is** in the CSV; Helen is `do_not_contact` and is **not** |
| | Mark has phone `555-0101`, and his CSV row has a blank phone column |
| Member notes | 2, both on Sarah Brooks, who also appears in the CSV |
| Notification triggers | all, including `new_household_added` |

**Sign in with:** `bishop@`, then `secretary@` — all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

### Fixtures

In `fixtures/` beside this file:

| File | Contents |
|---|---|
| `lcr-export.csv` | 40 rows, 14 households, LCR headers in a non-obvious order, three quoted addresses containing commas, accented names, one blank trailing line |
| `lcr-export-messy.csv` | The same 40 rows plus 2 missing a last name, 1 with `Age Category: Senior`, 1 short row, 1 with an unterminated quote, and a duplicate `Individual Phone` header |
| `not-a-roster.csv` | Two columns of unrelated data, so no required field can be mapped |

**The header row is deliberately awkward.** `lcr-export.csv` carries `Family Name` and no
household column at all. `Family Name` means the surname in some real exports and the household
in others, so it is auto-mapped to **Last name** and **Household name is left blank on purpose**
— you have to choose it. Choosing `Family Name` for both is the right answer for this file.

## Steps

1. `npm run seed -- roster/scenario-009-import-lcr-export-twice`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open Roster, then Import — or go straight to `/roster/import`.
4. Choose `fixtures/lcr-export.csv`. Read the mapping step without changing anything yet.
5. Press Continue while Household name is still unmapped.
6. Set Household name to `Family Name` and press Continue.
7. Read the whole preview screen. Do **not** confirm yet.
8. In the Supabase dashboard, note the row counts for `households` and `members` in the Harness
   Test Ward.
9. Navigate away to `/roster` without confirming, then re-check those two row counts.
10. Return to `/roster/import`, walk the file through again, and this time press the confirm
    button. Read the result summary.
11. Open `/roster` and look at the imported households and their addresses.
12. Set the Status filter to **Moved Out** and find Carlos Andersen.
13. Open Mark Andersen and check his phone number.
14. In the dashboard, read `audit_log`, `notifications`, and `member_notes` for this ward.
15. **Run the whole import again with the same file.** Read the result summary.
16. Re-check `households`, `members`, `member_notes`, `audit_log` and `notifications`.
17. Start the wizard with `lcr-export.csv`, reach the preview, then edit and save the file on
    disk before pressing confirm.
18. Walk `fixtures/lcr-export-messy.csv` through to the preview and read the problems list.
19. Walk `fixtures/not-a-roster.csv` as far as it will go.
20. Rename any `.png` to `.csv` and try to import it.
21. Narrow the browser to 375px and repeat steps 4–7 in both light and dark mode.
22. Sign out. Sign in as `secretary` and open `/roster/import`.

## Verification Checklist

- [ ] The mapping step prefills First name, Last name, Gender, Category, Address and Phone
      correctly despite the shuffled column order
- [ ] A sample value from the first data row is shown beside each select
- [ ] `Family Name` is **not** silently mapped to Household name — that select starts empty
- [ ] Continue is blocked while Household name is unmapped, with a message naming it, not a
      silently greyed button
- [ ] Setting Household name to `Family Name` unblocks Continue
- [ ] The preview reports 40 rows read
- [ ] The preview reports 11 new households and 3 already in the roster
- [ ] The preview lists the new households by name, so a mis-mapped household column would show
      as 40 households named after individuals
- [ ] The preview reports 34 members to create and 6 to update
- [ ] The preview states that 1 member is in the roster and not in this file, and will not be
      changed, moved out, or removed
- [ ] Nothing on the preview screen is written in the past tense
- [ ] **Leaving the preview without confirming writes nothing** — `households` and `members` row
      counts are identical before and after step 9
- [ ] Nothing appears in `audit_log` or `notifications` for the previewed-only run
- [ ] The confirm button is labelled with what it will do — "Import 40 members" — not "Confirm"
- [ ] Confirming imports the file and the result summary counts match the preview
- [ ] `/roster` shows the imported households grouped correctly
- [ ] Addresses containing commas are intact — Andersen is `12 Oak Street, Apt 4`, not
      `12 Oak Street`
- [ ] `Sørensen` imported with the ø intact, not as `S?rensen`
- [ ] Carlos Andersen was matched and updated, **not** duplicated, and is still `moved_out`
- [ ] Mark Andersen still has phone `555-0101` — the blank column in the file did not blank it
- [ ] Helen Nguyen is unchanged: still `do_not_contact`, still in the Nguyen household
- [ ] `audit_log` has exactly one `roster_imported` row for this import, with `module = 'roster'`
      and a `detail` carrying `totalRows`, the four counts, and `problemCount`
- [ ] `notifications` has **one** summarising `new_household_added` row titled "11 new households
      added" — not one row per household
- [ ] **Running the identical import a second time reports 0 created and 0 updated**
- [ ] **After the second import, `households` and `members` row counts are unchanged**
- [ ] **After the second import, both `member_notes` rows on Sarah Brooks are still present,
      with the same body and the same `updated_at`**
- [ ] The second import adds a second `roster_imported` audit row and **no** second notification
- [ ] `lcr-export-messy.csv` previews with a problem per bad row, each showing the row number as
      it appears in a spreadsheet
- [ ] The two rows missing a last name (file rows 42 and 43) are reported and excluded; the good
      rows still import. Each is reported **twice** — once for Last name and once for Household
      name — because both are mapped to the same `Family Name` column. That is accurate, not a bug
- [ ] The short row (file row 45, `Rhys Ashford`) imports with no address and no problem
- [ ] The `Senior` category row is reported and **still imports**, with no category
- [ ] The duplicate header appears in the mapping selects as `Individual Phone` and
      `Individual Phone (2)`
- [ ] The unterminated-quote row (file row 46) is reported as a problem, not as a server error.
      It still imports, with the rest of the line swallowed into the surname — the message says
      so, and that is the documented behaviour rather than a silent drop
- [ ] At 375px each wizard step is full-width and one at a time, with the mapping labels above
      their selects and no horizontal scrolling
- [ ] Every select and button is at least 44px tall
- [ ] Correct in both light and dark mode

## Failure Behavior

- [ ] `not-a-roster.csv` is refused at the mapping step, naming First name, Last name and
      Household name — not with a 500 and not with an empty preview
- [ ] A `.png` renamed to `.csv` is refused with a readable message, not a stack trace
- [ ] Editing the file between preview and confirm produces **"The file changed since you
      previewed it. Preview again."**, not a silent import of different data
- [ ] A file over 5MB is refused before it uploads. Bypass the client check with the console
      call below and confirm the server refuses it too
- [ ] `secretary` opening `/roster/import` sees "Not permitted" with a link back to the
      dashboard — not a blank page and not a 500
- [ ] A `POST` to `/api/roster/import` from a `secretary` session returns **403**, not 500. Run
      it from the browser console while signed in as `secretary`:
      `const b = new FormData(); b.set('file', new File(['a,b\n1,2'], 'x.csv', { type: 'text/csv' }));
      await (await fetch('/api/roster/import', { method: 'POST', body: b })).json()`
- [ ] A `POST` to `/api/roster/import/preview` from a `secretary` session returns 403 the same
      way — the preview endpoint is bishopric-only too
- [ ] A `POST` to `/api/roster/import` with no `fileHash` returns 400 telling the user to preview
      first, rather than importing
- [ ] Nothing appears in `audit_log` or `notifications` for any refused run

## Notes

**Steps 10, 15 and 17 change data.** Re-run the seed before using this ward for another
scenario. `createHousehold` and `createMember` use stable ids derived from the name, so
re-seeding restores the seven seeded members — **but the 34 imported members and 11 imported
households are not in the seed and survive**. Run `npm run seed:clean` to clear the ward
entirely, then re-seed.

**Why `secretary` is the second seat.** A ward secretary holds `roster.view` but not
`roster.import`, which is exactly the pair this phase turns on. `assertCan(user,
'roster.import')` in both routes is the real boundary here, not RLS: migration 019's ward-scoped
policy loop grants INSERT on `households` and `members` to every authenticated member of the ward
([plans/roster-a-data-and-pages.md](../../../../plans/roster-a-data-and-pages.md) Decision 3), so
a route that forgot the check would let a secretary rewrite the roster.

**Record for the retro.** `columnMapping.ts`'s alias table is a guess until a real LCR export has
been through it. If you have a genuine export, run it through step 4 and write down which headers
it failed to recognise — the next person to touch that table needs to know which parts are
verified and which are still guesses.
