---
name: Roster browse, edit, and the notes boundary
scope: roster-a-data-and-pages
part: 1
tags: [roster, full, rls]
prerequisites: none
---

## Purpose

The notes boundary is a refusal, and refusals are where this app's rules live. A unit test
proves the query returns nothing; only a walkthrough proves the panel is **absent from the
page** rather than rendered empty, and that a bishop and an org president see genuinely
different screens. The same walkthrough is the only place the status filter gets checked
end to end — a moved-out member reaching a browse page by default is the quiet bug 02-roster.md
opens with. Seeding a ward with households across all three statuses plus notes on specific
members is slow and error-prone by hand, and exact when seeded.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Sarah Brooks) |
| | `eqpres` (org_president, elders quorum, Tomas Ruiz) |
| | `secretary` (ward_secretary, David Nguyen) |
| Households | 6 — Andersen, Brooks, Smith (3 North Road), Smith (91 South Road), Nguyen, Ruiz (no address) |
| Members | 14 — 11 active, 2 `moved_out` (Carlos and Marta Ruiz), 1 `do_not_contact` (Helen Nguyen) |
| | 4 of them `youth` or `child` category; Jonah Whitfield has no household |
| Member notes | 2 notes on Mark Andersen, created by `bishop` |
| Notifications | all triggers, including `new_household_added` |

**Sign in with:** `bishop@`, then `eqpres@` — all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- roster/scenario-007-roster-browse-and-notes`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop` and open Roster from the sidebar.
4. Note which view loads first and how many households it lists. Expand a household.
5. Switch to the all-members view. Look for Jonah Whitfield.
6. Switch back to households, reload the page, and see which view you land on.
7. Search for `smit`. Then search for `ruiz`. Then search for `marta`.
8. Clear the search. Set Category to **Youth**, then back to All categories.
9. Set Status to **Moved Out**. Then set it back to **In the ward**.
10. Open the Andersen household, then open Mark Andersen from it.
11. Read the notes panel. Add a third note.
12. Edit Mark Andersen's phone number and save. Reload the page.
13. Open Carlos Ruiz (Status → Moved Out, then the Ruiz household) and change his status to
    Active, then back to Moved Out.
14. Back on `/roster`, add a household called **Petersen** at *14 Birch Way*.
15. Open `/roster/member/00000000-0000-4000-8000-0000000000ff` directly.
16. Sign out. Sign in as `eqpres` and open Roster. Browse both views.
17. As `eqpres`, open Mark Andersen's member page directly.
18. Narrow the browser to 375px and look at the household view in both light and dark mode.
19. In the Supabase dashboard, read `audit_log` and `notifications` filtered to the Harness
    Test Ward. The notification bell is a placeholder until Phase 11, so the table is the only
    place to see the notifications.

## Verification Checklist

- [ ] The default `/roster` view is the household view, and it lists all 6 households
- [ ] Expanding a household shows its members with a status badge on each
- [ ] The 2 `moved_out` members (Carlos and Marta Ruiz) are absent until "Moved Out" is
      selected in the Status filter
- [ ] The `do_not_contact` member (Helen Nguyen) **is** shown, with a visually distinct badge
      whose meaning does not depend on colour alone — the words "Do Not Contact" are on screen
- [ ] Jonah Whitfield appears in the all-members view and is not silently lost
- [ ] Both "Smith" households are listed separately and their addresses tell them apart
- [ ] Searching `smit` matches both Smith households; searching `marta` matches nothing until
      the Moved Out filter is on; searching `ruiz` matches the Ruiz household
- [ ] Filtering Category to Youth narrows the members shown inside each household, and the
      household count stays at 6
- [ ] As `bishop`, the member detail page shows the notes panel with both seeded notes
- [ ] A third note saves and appears at the top of the list
- [ ] Editing a phone number saves and the value survives a reload
- [ ] Changing Carlos Ruiz to Active makes him appear in the default view; changing him back to
      Moved Out removes him again, and the record is still reachable via the Moved Out filter
- [ ] Adding the Petersen household writes a `new_household_added` row to `notifications`
      addressed to the bishop, counselor, org president, and ward secretary
- [ ] As `eqpres`, the notes panel is **absent from the page**, not present and empty
- [ ] As `eqpres`, no edit control and no "Add household" / "Add member" section appears
      anywhere on `/roster`
- [ ] The view toggle choice survives a page reload
- [ ] `audit_log` has `household_created`, `member_updated`, and `member_note_created` rows
      with `module = 'roster'` and the acting user as `user_id`
- [ ] The `member_updated` row for the status change carries a `statusTransition` of
      `{ from: 'moved_out', to: 'active' }` (and the reverse on the way back)
- [ ] No `audit_log` `detail` field anywhere contains note text
- [ ] At 375px the household view is stacked cards with full-width controls, no sideways
      scrolling, correct in both light and dark mode

## Failure Behavior

- [ ] `eqpres` navigating directly to `/roster/member/<id>` sees the page without notes, not a
      500 and not a blank screen
- [ ] A POST to `/api/members` from an `eqpres` session returns 403 with a readable message,
      not 500. Run it from the browser console while signed in as `eqpres`:
      `await (await fetch('/api/members', { method: 'POST', headers: { 'Content-Type':
      'application/json' }, body: JSON.stringify({ firstName: 'A', lastName: 'B' }) })).json()`
- [ ] Submitting the member form with an empty last name shows the field error inline, wired to
      the field, and does not send the request
- [ ] Opening `/roster/member/00000000-0000-4000-8000-0000000000ff` renders the not-found page,
      not a 500
- [ ] Opening `/roster/import` 404s — roster-c has not been built yet, and that is the right
      answer for an unbuilt route

## Notes

Steps 12, 13 and 14 change data. Re-run the seed before using this ward for another scenario —
`createHousehold` and `createMember` use stable ids derived from the name, so re-seeding
restores the original values. The Petersen household added in step 14 is not in the seed and
survives; delete it by hand or run `npm run seed:clean` if it gets in the way.

**Why `eqpres` is the second seat.** An org president holds `roster.view` but not
`roster.manage`, which is exactly the pair the page branches on. `roster.manage` is what stops
an unauthorized write here, not RLS: migration 019 grants INSERT, UPDATE and DELETE on
`members` and `households` to every authenticated member of the ward
([plans/roster-a-data-and-pages.md](../../../../plans/roster-a-data-and-pages.md) Decision 3).
The 403 check in Failure Behavior is the one that proves it.

`member_notes` is different — there the database really does refuse, because the table is in
the bishopric-only policy loop in migration 019. `eqpres` would get an empty list even if the
page forgot to branch, which is why the checklist asks whether the panel is *absent* rather
than whether it is empty.
