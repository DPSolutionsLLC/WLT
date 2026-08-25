---
name: The snapshot holds
scope: program-a-draft-and-approval
part: 1
tags: [program, full]
prerequisites: program-b-builder-screen must ship first — see Blocked below
---

> ## ⛔ NOT WALKABLE YET — the refresh diff has no screen
>
> `program-a` ships the refresh route and the diff function; `program-b` builds the panel that
> shows them. Until it merges there is no dialog to dismiss and no button to apply.
>
> The checklist below is written against the screen `program-b` will build. Its items are
> **predictions, not observations**. Leave the Walkthrough record reading "Not yet walked".
>
> **The rule itself is already proven without a browser**, against the hosted project:
> `tests/db/program-snapshot.test.ts` stores a draft, changes the assignment's speaker in the
> database, re-reads the stored draft and finds it unchanged, then computes the diff and confirms
> the change appears in it while the stored row still does not move.
>
> What that test cannot judge is the half this scenario exists for: whether a **person** trusts it.

## Purpose

The central rule of the whole phase, checked in the app rather than in a test.

`draft_data` is a snapshot. Once written it stops tracking the calendar, the assignments and the
prayers it came from, because an approved program that silently changed after the bishop approved
it is a trust problem rather than a bug.

The consequence is a screen that is deliberately **out of date**, and that is a strange thing to
show somebody. A bishop who changed a speaker ten seconds ago and then sees the old name on the
program will conclude one of two things: *the app is holding what I approved* or *the app is
broken*. Which one it reads as is the entire judgement here, and no automated test can make it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, three leadership contacts with phone numbers |
| Users | `bishop@…` (bishop, Mark Andersen), `secretary@…` (ward_secretary, Ruth Delgado) |
| Sunday | **2026-09-20**, `standard`, 3 speaking slots |
| Assignments | Slot 1 Sarah Whitfield (`notify`), slot 2 President Mark Andersen (external, `notify`), slot 3 absent |
| Members | Sarah Whitfield, David Brooks, **Ruth Okonkwo** — Ruth is seeded to be switched to |
| Program | Already stored, status **`pending_approval`**, its draft naming **Sarah Whitfield** in slot 1 |

The stored `draft_data` is written out literally rather than assembled, so that an app which
re-derived the draft on every read would **fail** this scenario instead of quietly agreeing with
itself.

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-029-the-snapshot-holds`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the bishop.
4. Open the program for **20 September 2026** and read slot 1. It says Sarah Whitfield.
5. Go to the assignment for that Sunday and change slot 1's speaker to **Ruth Okonkwo**.
6. Return to the program.
7. Start a refresh, read the diff, and **dismiss** it without applying.
8. Start the refresh again and **apply** it.

## Verification Checklist

### Machine-checkable

- [ ] At step 6, before any refresh, the program still shows **Sarah Whitfield** — not Ruth
- [ ] The refresh diff names **both** sides: "Sarah Whitfield" before, "Ruth Okonkwo" after
- [ ] The diff row is labelled **"First speaker"** — not `speakers.1.printedName`
- [ ] Dismissing the diff at step 7 leaves the program showing Sarah Whitfield
- [ ] Applying at step 8 changes it to Ruth Okonkwo, and only then
- [ ] The diff shows nothing about `publicName` — one row per person, not two
- [ ] Refreshing again immediately reports that nothing has moved, rather than showing an empty panel
- [ ] An audit row exists for the applied refresh naming the fields that changed
- [ ] No raw uuid appears in the diff

### Needs a human eye

- [ ] At step 6 the program is knowingly out of date. Does that read as **the app holding what was approved**, or as a stale page that failed to reload?
- [ ] Does the diff make it obvious which side is the program and which side is current data?
- [ ] Is it clear at step 7 that dismissing changed nothing — or does it leave doubt about whether something was saved?
- [ ] "Nothing has moved" after a second refresh: does it read as reassurance, or as a failure?
- [ ] Is the refresh discoverable at all? A snapshot nobody knows how to update is worse than a live view.

## Failure Behavior

- [ ] A refresh on an **approved** program is refused with a sentence saying to reopen it as a draft first — the diff is not even shown, because offering a change that cannot be taken is an invitation with no door. Automated: `tests/routes/program-approval.test.ts`.
- [ ] `apply: false` writes nothing at all. Automated: `tests/db/program-snapshot.test.ts` and the route suite both re-read the stored row to prove it.
- [ ] A ward secretary can refresh; a music coordinator gets a 403. Automated: route suite.

## Walkthrough record

Not yet walked. Blocked on `program-b`, which builds the refresh panel this scenario describes.

## Notes

- The program is seeded at `pending_approval` rather than `draft` on purpose: it is the status a
  program spends the least time in and the one where a silent change would matter most.
- Step 5 changes an assignment the bishop owns. A **ward secretary** could not make that change —
  migration 038 grants them reading of the talk pipeline, not writing — which is why this scenario
  is walked as the bishop while 028 is walked as the secretary.
