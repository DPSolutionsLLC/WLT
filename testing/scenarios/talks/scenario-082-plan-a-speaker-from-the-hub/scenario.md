---
name: Plan a speaker from the hub
scope: sacrament-speaker-planning
part: 1
tags: [sacrament, talks, calendar, P4]
prerequisites: none
---

> **PARTLY RETIRED 2026-09-29.** The Sunday page's "Slot N — open" + **Plan** and full cards with **Edit** were replaced by the Topics screen (plans/sacrament-topics-screen-rebuild.md `t3`); scenario 083 walks it. The hub-creates-Sundays checks still stand.

## Purpose

Two dead ends on the way to planning a speaker, fixed together on 2026-09-28:

1. **A Sunday's page could not plan a speaker.** The hub's Talks pill opens
   `/assignments/[sunday_id]`, which listed only existing talks and said "Plan a slot from the
   month view." with no link. It now lists **every slot**: a filled one keeps its full card and
   **Edit**, an open one reads **"Slot N — open"** with **Plan**.
2. **The hub showed no upcoming Sundays** until somebody opened `/calendar`. It now creates them
   exactly as `/calendar` does — the rolling year plus the viewed month — and only for somebody
   holding `calendar.manage`. This reverses the hub's earlier "reads only" rule (CLAUDE.md §9).

**Already automated:**
- `tests/components/assignments/SundaySlotList.test.tsx`: every slot listed, open ones with Plan
  for a planner and without it for anybody else, a talk outside the slots still listed (proved able
  to fail)

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor), `music` (Hannah Price, music coordinator) |
| Calendar | **Every Sunday** from the first of this month through the end of **next** month, each month's first Sunday a pinned Fast Sunday. **The month after next has no Sundays** |
| Sunday **A** | The first ordinary Sunday at least a week out, 3 slots. Slot 1 **Maria Lopez**; slots 2 and 3 open |
| Members | Maria Lopez, Ana Silva |
| Topics | Faith in Jesus Christ, The Power of Covenants |

**Sign in with:** `music@`, `counselor1@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-082-plan-a-speaker-from-the-hub`, and note A's date and the
   empty month.
2. `npm run dev`, open http://localhost:3000, and sign in as `music`.
3. Open `/sacrament?month=<empty month>` and read the page.
4. Sign out, sign in as `counselor1`, and open the same URL. Wait for it to load (the first visit
   can take ~15s — defect 072-D3).
5. Open `/sacrament` at A's month and press A's **Talks** pill.
6. Read the page. Press **Plan** on slot 2, choose **Ana Silva** and **The Power of Covenants**,
   and save.
7. Read the page again.
8. Sign out, sign in as `music`, open A's page the same way, and read it.

## Verification Checklist

The hub creates Sundays

- [ ] Step 3: the empty month shows **no Sunday cards** for `music` — opening it created nothing
- [ ] Step 4: the same month now shows **every Sunday** for `counselor1`, the first one a Fast Sunday
- [ ] Step 4: the months between also have Sundays (the rolling year was created)

A Sunday's page plans a speaker

- [ ] Step 6: the page shows **Slot 1 — Maria Lopez** with **Edit**, then **Slot 2 — open** and
      **Slot 3 — open**, each with **Plan**
- [ ] Step 6: the sentence "Plan a slot from the month view." is **gone**
- [ ] Step 6: **Plan** opens the planning window for **slot 2**
- [ ] Step 7: slot 2 is now a full card — **Ana Silva**, **The Power of Covenants**, with Approvals,
      Contacting the speaker and Comments — and slot 3 is still open
- [ ] Step 8: `music` sees the same three slots, **slot 3 open with no Plan button**, and no Edit

The record

- [ ] `audit_log`: one insert for Ana Silva's assignment, slot 2

## Failure Behavior

| Check | Test |
|---|---|
| Every slot listed; Plan only for a planner; nothing dropped | `tests/components/assignments/SundaySlotList.test.tsx` |
| Month generation is idempotent | `tests/db/fast-sunday-collision.test.ts`, calendar generation suites |

## Walkthrough record

**2026-09-28, by the agent, dev server, 1280px.** Seeded, walked as `music` and `counselor1`.
Every check passed.

- `music` on November 2026: "0 Sundays … This month is not on the calendar yet." Nothing created.
- `counselor1` on the same URL: 5 Sundays, November 1 a Fast Sunday, in 8.6s. June 2027 then had
  4 Sundays; the ward held 52 Sundays from 2026-09-06 to 2027-08-29.
- A (October 11) via its Talks pill: "Slot 1 — Maria Lopez … Edit", "Slot 2 — open  Plan",
  "Slot 3 — open  Plan"; the "Plan a slot from the month view." sentence was gone.
- Plan on slot 2 opened "Slot 2 — Sunday, October 11". Saved Ana Silva / The Power of Covenants:
  `POST /api/assignments 201`, then the page refreshed itself (~3s) to "Slot 2 — Ana Silva … Edit"
  with Approvals, Contacting the speaker and Comments. Slot 3 stayed open.
- `music` on A: all three slots, no buttons anywhere on the page.
- `audit_log`: `assignment_created`, slot 2, `speakerKind: member`.
