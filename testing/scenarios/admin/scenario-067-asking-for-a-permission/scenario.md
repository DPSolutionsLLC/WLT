---
name: Asking for a permission
scope: P2
part: 1
tags: [admin, auth, full]
prerequisites: none
---

## Purpose

**A ward asks for something it does not have, and somebody else answers.**

`wards.settings.role_access` has been able to widen a role since ITER-005. What has never existed
is a way for a ward to **ask**, and the one rule the whole flow turns on: **a ward admin cannot
approve their own request**. If the asker could approve it, the ward would simply be granting
itself the permission with paperwork around it.

Two halves are worth walking rather than unit-testing:

1. **The requester can see the outcome.** The prototype shipped this flow *without* outcome
   visibility and caught the gap itself. A denial nobody can read teaches leaders that asking does
   nothing — and that is a judgement about wording on a screen, not an assertion about a row.
2. **An approval lands as an ordinary delta** in one ward's settings, and **no other ward moves**.
   That second half is what a wholesale settings write would break, and it is invisible from
   inside the ward that asked.

Seeding gives a **pending request** and a **super admin to decide it** — a state with no UI path
until this slice, because there is no screen anywhere that creates a super admin.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 2 — "Harness Test Ward", "Harness Second Ward" |
| Users | 3 — ward 1's bishop, ward 1's EQ president, and a super admin |
| Requests | 2 — one **pending** from ward 1, one already **denied** with a note |
| Ward 2 | seeded with an unrelated `role_access` override, so the fan-out assertions have something that must survive |

**The super admin:** `super-admin@harness.wardleadershiptools.test`
**The ward admin:** `bishop@harness.wardleadershiptools.test`

⚠️ **Ward 2 carries a deliberate unrelated override** — `music_coordinator` with
`remove: ["music.manage"]`. Nothing in this scenario should change it. It is the canary for a
wholesale settings write.

## Steps

1. Sign in as the **bishop**. Open **Administration → Access requests**.
2. Confirm the pending request and the denied one both appear, and that the **denied one shows its
   note**.
3. Submit a new request: a calling, a permission, and a reason.
4. Confirm there is **no approve control anywhere** on the bishop's view.
5. Sign out. Sign in as the **super admin**. Open the same page.
6. Confirm **both wards'** requests are visible.
7. Decline one with a note. Approve another **for this ward**.
8. Sign back in as the bishop and read the outcome of both.

## Verification checklist (machine-checkable)

- [ ] A ward admin submits a request with a reason and sees it as **pending**
- [ ] The same admin **cannot** approve it — no control on the page, and
      `PATCH /api/access-requests/[id]` answers **403**
- [ ] The database refuses it too: an authenticated UPDATE on `access_requests` as the bishop
      leaves `status` as `pending` (a zero-row success, not an error)
- [ ] After a super admin denies with a note, **the requester can read the note**
- [ ] A denial with **no note** is refused with a sentence (`400`), because the requester would
      have nothing to read
- [ ] After a ward-scoped approval, that ward's `role_access` gains an **add-delta**
- [ ] **No other ward's settings changed** — ward 2's `music_coordinator` override is byte-identical
- [ ] Ward 2's `timezone` and any other settings keys are unchanged
- [ ] An audit row exists for the **submission** and for the **decision**
- [ ] The decision audit row is filed under the ward that **asked**, not the decider's ward
- [ ] Deciding the same request twice answers **409** "already been answered", and `decided_by`
      does not move to the second presser
- [ ] A request naming an `admin.*` or `sacrament.*` permission is refused at the boundary (**400**)
- [ ] A notification reaches the ward on a decision, and the super admins on a submission

## Needs a human eye

- [ ] **Does a denial read as a decision somebody made, or as the app refusing?** This is the
      question the whole screen turns on. A denial that reads as a system error teaches leaders
      that asking does nothing.
- [ ] Is it obvious, as the bishop, that somebody else has to answer — rather than looking like a
      control that failed to load?
- [ ] Does the "Approve for every ward" confirmation make clear that **nothing turns on today**?
- [ ] At 375px, does the request list stay readable and the reason text wrap cleanly?

## Walkthrough record

**Not yet walked.**
