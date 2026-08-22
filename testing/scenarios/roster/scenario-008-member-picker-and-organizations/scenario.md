---
name: The member picker across every consumer shape
scope: roster-b-picker-and-orgs
part: 1
tags: [roster, full, picker]
prerequisites: none
---

## Purpose

`MemberPicker`'s props are frozen after this phase — Phases 4, 7, 8 and 10 all consume it, and
changing the signature later means touching every module. So the walkthrough has to exercise
every shape a later phase will use while there is still time to change the interface.

A unit test proves the filter resolves. Only a walkthrough proves the modal is usable one-handed
on a 375px screen during a meeting, which is its actual job. Seeding a roster with the right
spread of categories, genders and statuses is fiddly by hand and exact when seeded.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `eqpres` (org_president, elders quorum, Tomas Ruiz) |
| | `rspres` (org_president, relief society, Sarah Brooks) |
| Organizations | Bishopric, Elders Quorum, Relief Society, Young Women, Primary, Sunday School (`TEST_ORG_IDS`) |
| Households | 8 — Andersen, Brooks, Smith (3 North Road), Smith (91 South Road), Nguyen, Ruiz (no address), Okafor, Whitfield |
| Members | 24 — 12 adult, 8 youth, 4 child; both genders throughout |
| | 20 `active`, 2 `moved_out` (Carlos and Marta Ruiz), 2 `do_not_contact` (Helen Nguyen, Zara Okafor) |
| | Jonah Whitfield has no household |
| Member organizations | 6 in Elders Quorum, 5 in Relief Society, 2 of those also in Primary; 13 members in none |

**Sign in with:** `bishop@`, then `eqpres@` — all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

There is deliberately **no `/roster/picker-demo` page**. The picker is driven through the
organizations panel and the bulk-assign flow, which are its real first consumers — a scratch
page would prove the component renders, not that it works where it is used.

## Steps

1. `npm run seed -- roster/scenario-008-member-picker-and-organizations`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop` and open Roster from the sidebar. Note the Organization filter.
4. Switch to the all-members view. Tick 9 members and read the bar that appears.
5. Choose **Primary** in the bar and press Assign. Read the message.
6. Select the same 9 members again and assign them to Primary a second time. Read the message.
7. Press Assign with no organization chosen and see where the refusal comes from.
8. Set the Organization filter to **Primary** and confirm those 9 members are what you get.
9. Set it back to **All organizations**.
10. Open Sarah Brooks. Read the Organizations panel — she should be in Relief Society and
    Primary. Untick both, save, and read the confirmation.
11. Tick Relief Society again and save.
12. Set the Status filter to **Moved Out** and open Carlos Ruiz. Check the Organizations panel.
13. Sign out. Sign in as `eqpres` and open Roster. Look at the address bar before touching
    anything.
14. As `eqpres`, clear the Organization filter to **All organizations**.
15. As `eqpres`, open any member and look at the Organizations panel. Switch to the all-members
    view and look for the checkboxes.
16. Narrow the browser to 375px and repeat steps 4 and 10 in both light and dark mode.
17. In the Supabase dashboard, read `audit_log` filtered to the Harness Test Ward.

## Verification Checklist

- [ ] As `bishop`, `/roster` loads with the Organization filter set to **All organizations**
      and no `organizationId` in the URL
- [ ] Selecting members in the all-members view reveals a bar naming the count; deselecting them
      all removes it
- [ ] The bar does **not** appear in the household view — selection is offered in the flat list
      only
- [ ] Bulk-assigning 9 members reports the number actually assigned
- [ ] Re-running the same assign reports 0 assigned and 9 already members, and is not an error
- [ ] Assigning a member who is already in the organization does not create a duplicate row in
      `member_organizations` (check the row count in the dashboard)
- [ ] Pressing Assign with no organization chosen is refused by the form, without a request
      being sent (check the Network tab)
- [ ] Filtering by Primary returns exactly the members just assigned plus the 2 seeded ones
- [ ] Sarah Brooks's Organizations panel shows Relief Society and Primary ticked
- [ ] Unticking every organization saves, and the panel shows none afterwards
- [ ] The confirmation names what changed — "2 removed", not a bare "Saved"
- [ ] Carlos Ruiz (moved out) still has a member page and a working Organizations panel
- [ ] As `eqpres`, `/roster` redirects to `?organizationId=<elders quorum>` and the filter shows
      that selection — the default is visible in the URL, not hidden in a query
- [ ] As `eqpres`, clearing the Organization filter shows the whole ward roster. **This is
      intended, not a leak** — every ward leader has roster visibility, and the filter is a
      convenience
- [ ] As `eqpres`, the Organizations panel on a member is read-only text with no checkboxes and
      no save button
- [ ] As `eqpres`, no selection checkboxes and no bulk-assign bar appear anywhere
- [ ] `audit_log` has a `members_bulk_assigned` row whose `detail` carries `requested`,
      `assigned`, and `alreadyMember` — all three
- [ ] `audit_log` has a `member_organizations_updated` row whose `detail` carries `added` and
      `removed` lists reflecting what actually changed, not what was submitted
- [ ] At 375px the bulk-assign bar is fixed to the bottom of the viewport and reachable with one
      thumb; the list scrolls behind it
- [ ] Every row, checkbox and control is at least 44px tall
- [ ] Correct in both light and dark mode

### The picker itself

The picker is reached through the organizations panel and bulk-assign flow above. Wherever it
appears as a modal:

- [ ] It opens as a modal, groups members under their household name, and lists Jonah Whitfield
      under "No household" rather than dropping him
- [ ] `Escape` closes it and focus returns to the button that opened it
- [ ] The page behind does not scroll while it is open
- [ ] Neither `moved_out` member (Carlos, Marta) appears under **any** filter setting
- [ ] Both `do_not_contact` members (Helen, Zara) are hidden until the override control is used,
      and revealing them requires confirming a message that names the consequence
- [ ] Selecting in single mode replaces the previous choice rather than adding to it
- [ ] Selected members appear as removable chips, and removing one updates the list
- [ ] Typing in the search flattens the household grouping to matching members; clearing it
      restores the grouping
- [ ] Searching a family name (`smith`) matches everyone in both Smith households

## Failure Behavior

**Automated — nothing to do by hand.** This section used to ask the tester to paste `fetch` calls
into the browser console. Every check is now a test that runs on `npm test`:

| Retired check | Replaced by |
|---|---|
| `PUT /api/members/<id>/organizations` as `eqpres` → 403 | `tests/routes/roster-organizations.test.ts` — "refuses a role without roster.manage, and writes nothing" (PUT) |
| `POST /api/roster/bulk-assign` as `eqpres` → 403 | the same test under POST |
| An organization id from another ward → "That organization is not in your ward." | "refuses an organization from another ward by name, not by constraint" — asserted on both routes |
| An unknown member id → a message, not a constraint | "refuses an unknown member by name, not by constraint", plus "refuses members from another ward…" for the ward-scoped case |
| The picker against a filter matching nobody → a stated message | `tests/components/roster/MemberPicker.test.tsx` — "distinguishes an empty roster from an empty filter result" and "says nobody matches when the filter empties a non-empty roster" |

The last one was already covered when this scenario was written; the other four were not.

**Why those two 403s carry more weight than a usual permission check.** Migration 019's
ward-scoped policy loop grants INSERT, UPDATE and DELETE on `member_organizations` to *every*
authenticated member of the ward (see the note below). RLS will not stop an org president writing
these rows — `assertCan(user, "roster.manage")` is the only thing that does. So both tests
**re-read the table afterwards** rather than trusting the status code: a 403 with the row quietly
changed would be the worst possible pass.

## Notes

Steps 5, 6, 10 and 11 change data. Re-run the seed before using this ward for another scenario —
`createMember` and `createHousehold` use stable ids derived from the name, so re-seeding restores
the members, **but the Primary memberships added in step 5 are not in the seed and survive**.
Remove them by hand or run `npm run seed:clean` if they get in the way.

**Why `eqpres` is the second seat.** An org president holds `roster.view` but not
`roster.manage`, which is the pair every branch in this phase turns on. `roster.manage` is what
stops an unauthorized write here, not RLS: migration 019's ward-scoped policy loop grants INSERT,
UPDATE and DELETE on `member_organizations` to every authenticated member of the ward
([plans/roster-a-data-and-pages.md](../../../../plans/roster-a-data-and-pages.md) Decision 3).
The two 403 checks in Failure Behavior are what prove the route is doing that work.

**Known gap, deliberate.** An org president cannot edit their own organization's membership,
even though 02-roster.md §Step 5 allows it. No permission expresses "may edit membership of my
own organization" and inventing one belonged in neither this phase nor this file; Phase 11 owns
the role access matrix. The read-only panel in step 15 is that gap, not a bug.
