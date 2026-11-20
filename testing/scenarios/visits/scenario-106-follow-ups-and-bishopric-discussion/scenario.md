---
name: Follow-ups and bishopric discussion
scope: visits
part: 1
tags: [visits, agendas, todos, full, ITER-055]
prerequisites: Migration 108 applied; Visits and Agendas released for the Harness Test Ward.
---

## Purpose

ITER-055 slice **bv7**. Two ways the bishopric sends a recorded visit onward, both on the visit's
card under **Recent visits** on the Visits **Households** tab:

- **Add a follow-up** puts a to-do on a bishopric member's **To Do**, yourself by default, with an
  optional due date. The card reads **From a visit to the ___ family**. It is an ordinary to-do once
  given: it can be ticked and deleted.
- **Discuss in bishopric meeting** puts one line, **Visit — ___ family — to discuss**, under
  **Visits to discuss** on the next **bishopric** agenda. Never a ward council agenda, and never the
  report or the private note. **No agenda is ever created to hold it:** with a draft bishopric agenda
  dated today or later, the line goes on it at once; otherwise the visit waits, and the next
  bishopric agenda somebody creates gathers it. Publishing that agenda marks the visit
  **discussed**, so the line doesn't come back.

Both buttons are the bishopric's alone (the same check as dividing the households).

Decided with the user at bv7 start: the line has its **own tag**, `visit_discussion`, not the
ward-council `flag`. Publishing stamps every `flag` line's visit as sent to the ward council, so
sharing that tag would silently clear a ward-council flag on the same visit.

## Seed Data

Dates are relative to the day the scenario is seeded.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | bishop (Mark Andersen), 1st counselor (Aaron Pike), 2nd counselor (Lena Ortiz), executive secretary (Sam Lee), Elders Quorum president (Tom Reyes) |
| Ellis | Bishopric visit 3 days ago, shared report *"Brother Ellis is between jobs…"*; nothing asked |
| Foster | **Elders Quorum** visit 2 days ago; nothing asked |
| Garcia | Bishopric visit 14 days ago, **already discussed** (stamped 10 days ago) |
| Agendas | Two **drafts dated 6 days from now**: a bishopric meeting and a ward council, both from the standard template |

## Steps

1. Sign in as the **bishop**, open **Visits**, **Households** tab, and scroll to **Recent visits**.
2. On **Ellis** press **Add a follow-up**. Type *Ask about the temple trip*, choose **Aaron Pike
   (1st Counselor)**, pick a due date, press **Add to To Do**, then **Done**.
3. On **Ellis** press **Discuss in bishopric meeting**.
4. Open **Agendas** and open the **bishopric** draft, then the **ward council** draft.
5. Back on **Visits**, on **Ellis** press **Don't discuss**. Open the bishopric draft again.
6. On **Ellis** press **Discuss in bishopric meeting** again. Open the bishopric draft and
   **Publish** it.
7. Back on **Visits**, read the **Ellis** and **Garcia** cards. On **Foster** press **Discuss in
   bishopric meeting**.
8. Sign in as the **executive secretary**. Open **Agendas** and create a **bishopric** agenda for
   next week.
9. Sign in as the **1st counselor**. Open **To Do** and expand the follow-up.
10. Sign in as the **Elders Quorum president** and open **Visits**.
11. Repeat steps 1–3 and 9 at **375px** wide, in light and dark.

## Verification Checklist

- [ ] Step 1: each visit card under Recent visits has **Add a follow-up** and **Discuss in bishopric
      meeting**; **Garcia** reads **Discussed in bishopric meeting** with **Discuss again**
- [ ] Step 2: the window says **Added to Aaron Pike's To Do.** A `todos` row owned by Aaron with
      `visit_log_id` = the Ellis visit, `assigned_by` = Mark, `tag` Visits and the due date chosen
      (read back). The audit row `visit_follow_up_created` carries ids only, not the title
- [ ] Step 3: Ellis reads **On the bishopric agenda for {the draft's date}**; the button now reads
      **Don't discuss**
- [ ] Step 4: the bishopric draft has a **Visits to discuss** section right after *Flagged ward
      council items*, holding exactly **Visit — Ellis family — to discuss**, marked *Asked for from
      Visits*. **Nothing from the report** is on it. The ward council draft has **no** such line
- [ ] Step 5: the line is gone from the bishopric draft; the section heading stays; Ellis shows no
      status line and its button reads **Discuss in bishopric meeting**
- [ ] Step 6: after publishing, `visit_logs.bishopric_discussed_at` is set for Ellis and
      `flag_sent_at` is unchanged (read back)
- [ ] Step 7: Ellis reads **Discussed in bishopric meeting** with **Discuss again**. Foster reads
      **Waiting for the next bishopric agenda**: there is no bishopric draft now (the ward council
      draft doesn't count), and none was created
- [ ] Step 8: the new bishopric agenda carries **Visit — Foster family — to discuss**, and **not**
      Ellis or Garcia. The executive secretary can't open the Bishopric's visits, but the line still
      arrives
- [ ] Step 9: the card reads **From a visit to the Ellis family**, has its ordinary checkbox, and the
      opened card has **Open Visits**, which opens the **Households** tab scrolled to the **Ellis**
      visit card, outlined. Ticking it works
- [ ] Step 10: no **Add a follow-up** or **Discuss** buttons anywhere
- [ ] Step 11: at 375px the two buttons wrap cleanly, every control is at least 44px, and the
      follow-up window fits the screen

## Edge Cases

- A follow-up for someone outside the bishopric or in another ward is a 400 with a sentence; an
  organization leader is refused with 403; a visit in another ward is a 404. A follow-up can be
  deleted by its owner. Covered by `tests/routes/visitFollowUps.test.ts`.
- A ward council agenda never carries the line; a second draft doesn't take a line already on
  another; publishing stamps the visit and leaves its ward-council flag alone (this assertion was
  proved able to fail); "Discuss again" clears the stamp. Covered by
  `tests/routes/visitDiscussion.test.ts`.
- Only `lib/todos/visitLinks.ts` writes `todos.visit_log_id`, and only `lib/visits/queries.ts` and
  the publish stamp write the discussion columns: `tests/lib/visitTodoSites.test.ts`.

## Walkthrough record

**2026-11-20 — driven by Claude (Playwright, agent-driven), screenshots for the user's review.**
Every step was walked as written, at 1280px, and step 11 at 375px in light and dark. Every write
was read back with the service role. Evidence is in `.walk106/` (excluded from git). Review page:
https://claude.ai/artifact/D3uf624XH8APdKiQFXXXoH

| Step | Observed |
|---|---|
| 1 | All three cards had both buttons; Garcia read "Discussed in bishopric meeting" with "Discuss again" |
| 2 | "Added to Aaron Pike's To Do."; `todos`: owner Aaron, `assigned_by` Mark, tag `Visits`, due `2026-11-29`, `visit_log_id` = the Ellis visit; audit `visit_follow_up_created` `{visitLogId, todoId, ownerUserId, forSelf: false, hasDueDate: true}` (no title) |
| 3 | "On the bishopric agenda for Thursday, November 26, 2026"; button "Don't discuss"; audit `placedOn: 2026-11-26, draftsChanged: 1` |
| 4 | Bishopric draft sections: … / Flagged ward council items / **Visits to discuss** / Organization reports / …; one line "Visit — Ellis family — to discuss", "Asked for from Visits"; no report text. Ward council draft: no line |
| 5 | Line gone, heading kept ("Nothing recorded."); Ellis showed no status and "Discuss in bishopric meeting" |
| 6 | Published (200, 26s on a cold compile). `bishopric_discussed_at` = 2026-11-20T10:46:25Z; `flag_sent_at` null; audit `visitDiscussionsResolved: 1, flagsResolved: 0` |
| 7 | Ellis and Garcia: "Discussed in bishopric meeting" + "Discuss again". Foster: "Waiting for the next bishopric agenda"; still only the two seeded agendas; audit `placedOn: null, draftsChanged: 0` |
| 8 | Executive secretary created a bishopric agenda for 2026-11-27 (201); it carried only "Visit — Foster family — to discuss". Their Visits page lists no visits and no bishopric buttons |
| 9 | Card: "From a visit to the Ellis family", checkbox, "Open Visits" → `/visits?from=todos`; ticking set `completed_at` 10:56:00Z |
| 10 | Elders Quorum president: no buttons, no status line, even on their own Foster visit |
| 11 | 375px light and dark: no horizontal overflow; no new control under 44px; follow-up window 375 × 392 |

**Checklist correction:** step 7 used to say "there is no draft now". That is true only of the
*bishopric* drafts. The ward council draft is still a draft, so the check now says "no bishopric
draft".

**Put to the user (judgements, not defects):** how the buttons sit under "Flag for ward council" at
phone width; "(me)" in the owner picker; the to-do naming neither its sender nor the exact visit;
the Agendas intro not mentioning visits; and an emptied "Visits to discuss" heading staying on the
draft.

**The user's answers (2026-11-20):** Q1, Q2, Q4 and Q5 are fine as built. **Q3 changed the app:** a
follow-up's **Open Visits** now lands on that visit, not on the page. The link is
`/visits?tab=households&from=todos#visit-<id>`, and each Recent visits card carries `id="visit-<id>"`
and an outline while it is the target. The tab is named because Visits reopens on the last tab used.
Held by `tests/components/todos/TodoCard.test.tsx`. **Not re-walked in the browser:** the dev server
had stopped and the drive was at 0.45 GB, so the scroll and the outline still need one look by hand.
The step 9 check above now says so.

**Raised during the review, not built:** the user described agendas as one living document per meeting
type that the ward council can add to and only the bishopric can remove from, with meetings *marked as
held* rather than published per date. That is its own `/iterate` item; it would turn this slice's
"next bishopric agenda" into "the bishopric agenda" and "publishing" into "marking a meeting held".

**Environment:** the C: drive reached 0.1 GB free mid-walk (Turbopack cache writes failed);
`.next/cache` was deleted to recover 0.76 GB. Not related to the app.
