---
name: Paste the ward list, then paste it again with changes
scope: ITER-040
part: 1
tags: [roster, full, import, destructive]
prerequisites: none
---

## Purpose

The paste import's whole value is a checklist that matches reality across repeated pastes: the
first paste fills a roster that was built by hand, the same paste again changes nothing, and a later
paste shows exactly what changed in LCR. That needs a roster in a specific prior state (members
with no full name yet, a moved-out member, a do-not-contact member) and three real pastes copied
from a text editor, which unit tests cannot do. The pastes are **fake people**, in the exact shape
LCR's copy produces: headers one per line, and rows whose callings cells break across lines.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) holds `roster.import` |
| | `secretary` (ward_secretary, Ruth Kaufman) holds `roster.view`, **not** `roster.import` |
| Households | 3, named the old way: Andersen (12 Oak Street), Brooks (48 Willow Lane), Nguyen (7 Cedar Court) |
| Members | 8, none with a full name or birth date |
| | Mark Andersen, phone `555-0101` (paste 1 says `555-0111`) |
| | Julia Andersen; Sarah Brooks (`555-0201`); Grace Brooks (youth); David Nguyen (`555-0301`) |
| | Carlos Andersen is **moved out** and **is** in paste 1 |
| | Helen Nguyen is **do not contact** and is **not** in paste 1 |
| | Leo Nguyen (child) is active and is **not** in paste 1 |

### Fixtures

In `fixtures/`, opened in Notepad and copied with Ctrl+A, Ctrl+C:

| File | What it is |
|---|---|
| `paste-1.txt` | 25 people in 10 households. Julia Andersen's and James Okafor's callings cells span lines |
| `paste-2.txt` | Paste 1, with Sarah Brooks's phone changed to `555-0299`, Fiona Walsh removed, Anna Zimmer added, Sam Young moved to a new household "Young, Sam", Julia Andersen's email blanked, and James Okafor's callings changed |
| `paste-partial.txt` | Only the first 5 people of paste 2 |

**Sign in with:** `bishop@`, then `secretary@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- roster/scenario-089-paste-ward-list`
2. `npm run dev`, then open http://localhost:3000 and sign in as `bishop@`.
3. Open `/roster/import`. Open `fixtures/paste-1.txt` in Notepad, select all, copy, paste into the
   box, then press **Review changes**.
4. Read the checklist. Tick **Helen Nguyen** and **Leo Nguyen** under *No longer listed*, then
   press **Apply**.
5. Open Mark Andersen's member page.
6. Back on `/roster/import`, choose **Paste again**, paste `paste-1.txt` again and review.
7. Paste `paste-2.txt`, review, tick **Fiona Walsh** under *No longer listed*, and apply.
8. Paste `paste-partial.txt` and review. **Do not apply.**
9. Sign out, sign in as `secretary@` and open `/roster/import`.

## Verification Checklist

### Machine-checkable

- [ ] Paste 1's summary reads 25 rows read · 19 new · 6 changed · 0 addresses · 2 no longer
      listed · 0 unchanged, and the problems card says every row could be read.
- [ ] *Changed* lists Carlos, Julia and Mark Andersen, Grace and Sarah Brooks, and David Nguyen.
      Each shows "Full name: Added …", "Birth date: Added …" and a Household line. Mark also shows
      "Phone: 555-0101 → 555-0111".
- [ ] Carlos Andersen's item has the line "Moved out → back in the ward".
- [ ] *No longer listed* lists Helen Nguyen and Leo Nguyen, both **unticked** when the checklist
      opens. Every other item starts ticked.
- [ ] After applying paste 1, the result card says 19 new people added, 6 changed (including 1 back
      in the ward), 10 households created and 2 marked moved out.
- [ ] Mark Andersen's member page shows Full name "Andersen, Mark Thomas", Birth date "4 Mar 1980"
      (no day shift) and Email "mark.andersen@example.com".
- [ ] Re-pasting paste 1 shows 0 new · 0 changed · 0 addresses · 0 no longer listed · 25 unchanged.
- [ ] Paste 2 shows exactly 1 new (Anna Zimmer), 3 changed and 1 no longer listed (Fiona Walsh):
      Julia "Email: Removed (was julia.andersen@example.com)", Sarah "Phone: 555-0201 → 555-0299",
      and Sam "Household: Young, Tom & Beth → Young, Sam". **No** callings change is listed.
- [ ] After applying paste 2, Fiona Walsh's member page still opens and shows Moved Out. Nobody was
      deleted, and the roster's moved-out filter lists her.
- [ ] The partial paste shows the warning "This paste would mark 20 of 25 people as moved out".
      *Tick all* on *No longer listed* is disabled until "I checked. These people really are gone."
      is ticked.
- [ ] The secretary sees the not-permitted message, not the paste box.
- [ ] No horizontal overflow at 375px width on the paste, review and result screens.
- [ ] Every checklist control (Tick all, Untick all, each item's tappable row) is at least 44px
      tall at 375px.

### Needs a human eye

- [ ] The checklist reads as a list of decisions a bishop can make one by one, and the
      "No longer listed" group clearly reads as "ticking this marks them moved out".
- [ ] The partial-paste warning is hard to miss, in both light and dark mode.
- [ ] The "Changed" lines (before → after, Added, Removed) are legible one-handed at 375px.

## Failure Behavior

- [ ] Pasting text with no ward list in it (a sentence) says "Nothing that looks like the ward list
      report was pasted" and posts nothing.
- [ ] Deleting the "Birth Date (1 Jan 1990)" header line from the paste names the missing column
      and says how to add it in LCR, before anything is posted.
- [ ] Editing the paste between review and apply is refused with "The pasted list changed since you
      reviewed it." Covered by `tests/routes/roster-paste-import.test.ts`.
- [ ] A ward B session cannot apply into ward A. Covered by `tests/db/roster-paste-import.test.ts`.

## Walkthrough record

**2026-10-14, driven by an agent (Claude) through Playwright at 375px, against `npm run dev` on
port 3000; a human has not yet reviewed the screenshots.** Review page:
https://claude.ai/artifact/FqhhnxN5NyDfjekVaD7QME. Screenshots in `review-shots/089-*.png`
(excluded from git).

Every write was read back with the service client, not from the screen.

| Step | Observed |
|---|---|
| Paste 1 review | 25 rows read · 19 new · 6 changed · 0 addresses · 2 no longer listed · 0 unchanged; "Every row in this paste could be read." Only Helen and Leo unticked (25 of 27 ticked); button "Apply 25 changes", "Apply 27 changes" after ticking both |
| Paste 1 apply | Card: 19 added / 6 updated, including 1 back in the ward / 10 households created, 0 addresses / 2 marked moved out / silent details for 6. DB: 27 members (25 active, 2 `moved_out`), 13 households; 1 `roster_imported` audit row of counts only; 1 `new_household_added` event to 2 recipients (bishop, secretary) |
| Mark Andersen | `full_name` "Andersen, Mark Thomas", `birth_date` `1980-03-04`, phone `555-0111`; page shows "4 Mar 1980" and the email |
| Julia Andersen | `callings` stored as `Primary Teacher\nWard Activities Committee Member` |
| Paste 1 again | 0 new · 0 changed · 0 addresses · 0 no longer listed · 25 unchanged; Apply disabled |
| Paste 2 | 1 new · 3 changed · 0 addresses · 1 no longer listed · 21 unchanged, with exactly the three lines the checklist names and no callings line. DB after apply: 28 members (25 active, 3 moved out), 14 households; Julia `email` null, Sarah `555-0299`, Sam in "Young, Sam", Fiona `moved_out`, James's callings silently "Elders Quorum President\nWard Mission Leader" |
| Moved Out filter | Helen Nguyen, Leo Nguyen, Fiona Walsh; Fiona's page opens with Moved Out |
| Partial paste | 5 rows read · 20 no longer listed; "This paste would mark 20 of 25 people as moved out"; Tick all disabled → enabled when acknowledged → disabled again when unticked; not applied |
| Secretary | "Not permitted", no paste box |
| Failure behaviour | A sentence and a paste missing "Birth Date (1 Jan 1990)" both refused with their sentences; 0 requests to `/api/roster/import*` |
| Layout | No horizontal overflow at 375px (360 = 360). Console: 0 errors |

**Reviewed by the user 2026-10-14:** "tests pass", and both defects below approved for fixing.
**Both FIXED the same day:** the two buttons and every row label are now `min-h-11` (44px, the
class `Button` uses), and the notification body separates names with semicolons
(`tests/lib/rosterDiff.test.ts` → `buildNotificationBody`). The tap-target line has not been
re-measured in a browser since the fix; re-walk it at 375px.

**Defects found:**
1. Tick all / Untick all are 36px tall, and a checklist row with one detail line has a 36px label.
   Below the app's 44px minimum. The tap-target check above was added by this walk and fails today.
2. The `new_household_added` body joins LCR household names with commas, which those names contain:
   "Andersen, Mark & Julia, Brooks, Sarah, Nguyen, David, …" is hard to read.

**Checklist corrections:** added the tap-target line. No existing line described an unreachable
state.

**Left unwalked:** a real clipboard paste (the text went in through Playwright, identical to the
fixture, CRLF included); dark mode on any screen but the partial warning (the theme is read once at page
load, see Notes); a real phone. The five "Needs a human eye" items are on the
review page, awaiting an answer.

## Notes

- Steps 7 and 8 assume step 4 ticked Helen and Leo. Without that, both still appear under *No
  longer listed* in every later paste, and paste 2 shows 3 there instead of 1.
- The old households (Andersen, Brooks, Nguyen) are left behind empty. That is intended: nothing is
  ever deleted, and visit history may hang off a household.
- Git stores the fixtures with LF line endings (`.gitattributes`), not LCR's CRLF. The parser
  strips carriage returns, so both read the same.
- This scenario changes the harness ward's roster. `npm run seed:clean` resets it.
- Dark mode follows the theme choice saved in the browser by the theme toggle (`localStorage.theme`),
  and the system setting only when nothing is saved. Both are read once, at page load, so switching
  the OS to dark mid-page changes nothing until a reload.
