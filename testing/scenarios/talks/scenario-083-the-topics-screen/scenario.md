---
name: The Topics screen
scope: sacrament-topics-screen-rebuild
part: 1
tags: [sacrament, talks, full]
prerequisites: none
---

## Purpose

Topics rebuild `t3` (plans/sacrament-topics-screen-rebuild.md) replaced the per-Sunday talk page
with the prototype's **"What still needs to happen"** screen: a compact row per talk whose speaker
and topic lines each open their own window and carry their own tag, a **Speakers this week**
stepper, **Details** in a window, **Delete** that cancels a talk and moves the rest up, and Finalize
at the bottom. The states that matter — an accepted speaker, an open ask, a decline, approvals to
lose, a middle talk to delete — take many clicks to reach by hand, so they are seeded.

**Already automated:**
- `tests/lib/talkRowStatus.test.ts` — every speaker and topic tag, declined before "no speaker"
- `tests/components/sacrament/TalkRow.test.tsx` — who is offered what, the approvals warning before
  a Clear, the Delete confirm's sentence
- `tests/components/sacrament/SpeakerCountStepper.test.tsx` — the 1–6 bounds, − stopping at a
  speaker, the warn-then-confirm protocol, the default offer
- `tests/routes/assignment-remove.test.ts` — Delete's cancel, shift, count, un-finalize, history,
  ask marked off and audit row, and every refusal (all proved able to fail)

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor), `music` (Hannah Price, music coordinator) |
| Calendar | **Every Sunday** from the first of this month through the end of the month after next, each month's first Sunday a pinned Fast Sunday |
| Sunday **A** | The first ordinary Sunday at least three weeks out. **4 slots**, `counselor1` conducting, topics **finalized**, References skipped |
| Talk 1 | **Maria Lopez**, accepted, topic *Faith in Jesus Christ*, approved by the bishop and `counselor1` (2 of 3) |
| Talk 2 | **Ana Silva**, asked (`counselor1` holds the open ask), no topic |
| Talk 3 | Nobody — **Tomas Reyes declined**; topic *Gratitude* |
| Talk 4 | Open |
| Members | Maria Lopez, Ana Silva, Tomas Reyes, Luis Ortega |

**Sign in with:** `counselor1@`, `music@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-083-the-topics-screen`, and note A's date.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. Open **Sacrament**, go to A's month, and press A's **Topics** pill.
4. Read the page.
5. Press **Clear** on talk 1's topic. Read what appears, then reload the page without confirming.
6. Press **Details** on talk 1 and read the window, at 1280px and at 375px. Close it.
7. Press **Delete** on talk 2, read the confirm, and press **Remove talk**. Read the page.
8. Open **To Do** and find the ask for Ana Silva.
9. Back on A's page, press the stepper's **−** until it stops. Then press **+** until it reads **4** and press **Save**.
10. Press **View the full program for this date →**.
11. Sign out, sign in as `music`, and open A's page the same way.

## Verification Checklist

### Machine-checkable

- [ ] Step 4: **← Back to calendar**, the eyebrow **Topics · {A's date}** and the heading **What still needs to happen** are shown
- [ ] Step 4: the rows read — talk 1 *Maria Lopez* **Accepted** / *Faith in Jesus Christ* **Topic selected**; talk 2 *Ana Silva* **Ask sent** / *No topic yet* **Needs topic**; talk 3 *Nobody yet* **Declined** / *Gratitude* **Topic selected**; talk 4 *Nobody yet* **Needs speaker** / *No topic yet* **Needs topic**
- [ ] Step 4: talk 4 (open) has no Details, Delete or Clear; talks 1–3 each have **Details** and **Delete**
- [ ] Step 4: the stepper reads **Speakers this week 4**, and the finalize panel at the bottom reads **✓ Finalized**
- [ ] Step 4: **← Back to calendar** returns to the hub showing A's month
- [ ] Step 5: nothing is saved at the first press — the row says *Mark Andersen and Peter Nakamura have approved this plan. Clearing this resets their approvals and asks them again.* and the button reads **Clear and reset approvals**; after the reload the topic is still there
- [ ] Step 6: the window is titled **Talk 1 — details** and holds **Slot length**, **Approvals**, **Contacting the speaker** and **Comments**, in that order
- [ ] Step 7: the confirm reads **Remove talk 2? You will be asked to let Ana Silva know. Later talks move up.** (`counselor1` holds Ana's ask) and is in the row, not a second window
- [ ] Step 7: after Remove there are **3** rows — the declined talk is now **Talk 2** and the open one **Talk 3**; the stepper reads **3** with **Save** disabled; the panel reads **Not finalized yet**
- [ ] Step 7: `assignments` — Ana's talk has `cancelled_reason = slot_removed` and still exists; `sundays.speaking_slots` for A is 3
- [ ] Step 8: Ana's ask is still on `counselor1`'s list, marked **Talk Cancelled** — *"Let them know they're not needed."* — with **Told them**
- [ ] Step 9: **−** stops at **1** — slot 1 is Maria's — and the hint **Clear one speaker slot to go lower.** appears; nothing is saved by the stepper alone
- [ ] Step 9: saving **4** succeeds with no warning (adding a slot cancels nothing), the stepper reads **4**, and **Make 4 the default for Sundays added from now on?** is offered with **Yes** / **No** (`counselor1` holds `admin.manage_ward`); press **No**
- [ ] Step 10: the link opens `/program/{A's id}`
- [ ] Step 11: as `music` the page reads the same rows, with **no** speaker or topic windows, no Clear, no Delete, no stepper and no Finalize control — the count as text, "Speakers this week: N" (N is what step 9 left, 4). **Details** stays: it opens read-only
- [ ] `audit_log`: one `assignment_removed` row naming the Sunday and slot 2, with no name or topic in it
- [ ] 375px: no horizontal scroll; every button is at least 44px tall

### Needs a human eye

- [ ] The screen reads as the prototype's "what still needs to happen" — compact, each line obviously tappable, tags readable at a glance
- [ ] The Details window fits its content on a phone and does not feel like a second page
- [ ] Light and dark both read well

## Failure Behavior

- Removing the Sunday's only talk is refused with *"This is the Sunday's only talk, so it cannot be removed. Clear its speaker and topic instead."* (the button is not offered, so this is the route's answer — covered by `assignment-remove.test.ts`)

## Walkthrough record

**2026-09-29, by the agent (Playwright driving local Chrome, dev server, 1280px and 375px), plus a
database read-back with the service client.** Sunday A was 2026-10-18. Evidence in `.walk083/`
(excluded from git): `walk-log.json`, `db-before.json`, `db-after.json`, screenshots 01–20.

**One defect found — D1, the stepper does not follow the page after Delete.** After removing
talk 2 the page showed 3 rows and the database held `speaking_slots = 3`, but the stepper still read
**4** with **Save enabled** (`05-after-delete.png`). `SpeakerCountStepper` keeps its own `pending`
count, initialised once from the `count` prop, and nothing resets it when a refresh brings a new
count. Pressing Save there would have sent 4 — putting back the slot Delete had just removed.
Not fixed during the walk (the /walk rule); fix proposed to the user.

**One wording slip — D2.** The approvals warning under **Clear** says "*Saving* clears those
approvals…" — `describeInvalidation()`'s sentence was written for the modal's Save button.

Observed, every other machine-checkable line passed:
- Step 3: A's card links to `/assignments/{A}` twice (Topics and Talks pills). Step 4: eyebrow
  "TOPICS · SUNDAY, OCTOBER 18", heading "What still needs to happen", back link
  `/sacrament?month=2026-10`; rows exactly as seeded — Accepted / Topic selected; Ask sent / Needs
  topic; *Nobody yet* **Declined** / Gratitude Topic selected; Needs speaker / Needs topic. 3 Details,
  3 Delete (none on the open slot); stepper "Speakers this week" 4; "✓ Finalized".
- Step 5: first Clear press made **no** write request; the warning named Mark Andersen and Peter
  Nakamura; after reload the topic and both approvals were still there (read back).
- Step 6: "Talk 1 — details" with Slot length, Approvals, Contacting the speaker, Comments, in order.
- Step 7: confirm "Remove talk 2? Ana Silva will be told it's cancelled. Later talks move up.", no
  dialog opened; one `PATCH /api/assignments/{talk 2}`. Read back: talk 2 `cancelled_reason =
  slot_removed`, still present; the declined talk moved from slot 3 to 2; `speaking_slots` 3;
  `topics_finalized_at` null; history `cancelled` for Ana; her ask open with `talk_off_at` set;
  `assignment_removed` audit `{slotNumber: 2, shiftedCount: 1, historyWritten: [talk 2]}` — no name
  or topic. Panel "Not finalized yet".
- Step 8: To Do shows "Ask Ana Silva to speak … Talk Cancelled — Let them know they're not needed",
  with Told them.
- Step 9: − stopped at 1 with the hint; saving 4 sent one `PATCH /api/sundays/{A}` with no warning;
  "Make 4 the default for Sundays added from now on?" offered; No left `default_speaking_slots`
  unset (read back).
- Step 10: `/program/{A}` opened. Step 11 (`music`): 0 line buttons, 0 Clear, 0 Delete, no stepper,
  no Finalize control, "Speakers this week: 4".
- 375px: no horizontal scroll (375/375), no button or link in the page under 44px tall.

**Checklist corrected by the walk:** step 7 now also requires Save disabled (the line could not
catch D1 before); step 8 names the marker the app actually shows; step 11 no longer claims the count
is 3 (step 9 leaves 4) and says Details stays for a read-only reader.

**Not walked:** the "Make 4 the default" **Yes** path (route-tested; pressing it would change the
harness ward's default for later scenarios).

**The user's review, 2026-09-29:** the lines read as tappable, 375px reads well in both themes, and
Details reads as a window. Asked to fix D1 ("the stepper should always refresh to the current
amount of speakers when something is updated"), D2, and the Delete sentence.

**Re-walked after the fixes, same day, same way (fresh seed):**
- D1 fixed: after Delete the stepper reads **3 (default)** with Save disabled (`05-after-delete.png`);
  after its own save the "Make 4 the default…" offer still appears (`SpeakerCountStepper` follows
  the page's count during render, and keeps its own offer).
- D2 fixed: "…have approved this plan. Clearing this resets their approvals and asks them again."
- The Delete confirm names who will let the speaker know, by f2c's rules: "Remove talk 2? You will
  be asked to let Ana Silva know. Later talks move up." (`counselor1` holds Ana's ask).
- Every other observation repeated the first walk.
