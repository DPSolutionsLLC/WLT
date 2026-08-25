---
name: Editing a program by describing the change
scope: program-b-builder-screen
part: 1
tags: [program, ai, full]
prerequisites: ANTHROPIC_API_KEY must be set in .env.local — this scenario makes a real Claude call
---

## Purpose

**The highest-risk AI surface in the app, exercised end to end.**

Every other AI feature in this app returns PROSE. A human skims a drafted text message, sees it is
wrong, and fixes it. This one returns a whole structured program, and a JSON draft that silently
dropped the benediction *looks completely fine on screen* — it is a field that is simply not
there any more — and then prints wrong on Sunday morning.

Three layers exist to stop that, and only the third can be walked: structured output makes the
response parseable, `programDraftSchema` makes it valid, and **the diff makes it visible**. This
scenario is the walk of that third layer. The judgement no test can make is whether a person
reading the diff can actually tell what would change — and whether "nothing is saved until you
press Apply" is *believable* rather than merely true.

The second judgement is continuity. A conversation is only a conversation if the second
instruction edits the result of the first. Whether that is obvious from the screen, or whether the
tester has to guess, is not something a route test reaches.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `leadership_contacts` populated with three names **and phone numbers** |
| Users | `bishop@…` (bishop, Mark Andersen), `counselor@…` (counselor, Peter Lindqvist), `secretary@…` (ward_secretary, Ruth Delgado) |
| Sunday | **2026-09-20**, `standard`, 3 speaking slots, conducted by Mark Andersen |
| Slot 1 | Sarah Whitfield, ward member, topic "Charity Never Faileth" |
| Slot 2 | **President Mark Andersen**, external speaker (ITER-004) |
| Slot 3 | Empty |
| Program | **Already built, stored at `draft`** — the walk starts at the editor, not at the build |
| `wardBusiness` | Holds real text: *"Sustaining Brother Alvarez as the new Elders Quorum secretary, and releasing Brother Whitfield."* |
| `specialNotes` | **Null** — so one diff row is an addition and the other is a change |
| Gaps | Sacrament hymn, benediction, announcements, organist, chorister, one open slot |

**Sign in with:** `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-030-editing-a-program-by-describing-the-change`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the ward secretary.
4. Open **Program** in the sidebar, then **20 September 2026**.
5. Read the ward business text and note it exactly. This is the "before".
6. In **Change it by describing it**, type:

   > *Add a note that the Primary children will sing during the sacrament, and change the ward
   > business to mention the new Elders Quorum secretary.*

7. Press **Ask for the change** and wait for the reply.
8. **Do not press Apply yet.** Navigate to `/program` and come back to this Sunday.
9. Repeat steps 6–7, then press **Apply**.
10. Type a second instruction — *"Make that note say the Primary will sing after the sacrament,
    not during it."* — and ask for the change.
11. Press **Apply**, then **Save the program**.

## Verification Checklist

### Machine-checkable

- [ ] The reply is a **diff** — the old text and the new text are both on screen, not just the new program
- [ ] Exactly **two** rows appear in the diff: "Ward business" and "Special notes". Nothing else moved
- [ ] The "Special notes" row's before value is a dash, not the word "None" or "Not set"
- [ ] The "Ward business" row shows the seeded sentence as its before value, in full
- [ ] No dotted machine path (`specialNotes`, `speakers.2.printedName`) appears anywhere on screen
- [ ] After step 8 — leaving without applying — the ward business on the form is the **seeded** text again
- [ ] After **Apply** in step 9, the form's Ward business and Special notes boxes show the **new** text (not the old values)
- [ ] The panel says the change is on the program and must be **saved to keep it** — it does not say "Saved"
- [ ] The conversation list shows the first instruction and what it changed
- [ ] The second instruction's diff shows the **already-updated** note as its before value, not the original null
- [ ] The missing panel still lists the same gaps — the AI edit did not quietly rewrite them
- [ ] After **Save the program**, reloading the page shows the edited text
- [ ] There is no horizontal overflow at 375px with the diff open, and tap targets are at least 44×44

### Needs a human eye

- [ ] Read the diff cold. Could you tell, in two seconds, exactly what would change if you pressed Apply?
- [ ] Before pressing Apply — is it **believable** that nothing has been saved? Or does the screen feel like it already did something?
- [ ] The Apply button is worded by consequence ("Apply these 2 changes"). Does that read better than "Confirm" would have?
- [ ] After Apply, is it clear that you still have to Save? Or would a secretary close the tab thinking they were done?
- [ ] The second instruction edits the first result. Is that obvious from the conversation on screen, or did you have to trust it?
- [ ] Does the panel read as a tool you would reach for, or as a novelty you would use once?

## Failure Behavior

- [ ] With `ANTHROPIC_API_KEY` unset, asking for a change reports that AI is not set up and names an administrator as the fix — the draft and the typed instruction are both **untouched**. Automated: `tests/routes/program-ai-edit.test.ts` asserts the 503 and the unchanged row.
- [ ] A response that does not match the program schema is refused with a sentence saying nothing was changed, rather than reaching the form. Automated: same suite, the 422.
- [ ] Asking for a change **never writes to `programs`**, including a change the user abandons. Automated: same suite re-reads `draft_data` with the service client either side of every call.
- [ ] The **music coordinator** cannot ask for a change. Automated: same suite asserts the 403.
- [ ] An **approved** program hides the panel entirely rather than disabling it, and the route refuses it with a 409 naming the way forward. Automated: same suite, plus `tests/components/program/ProgramBuilder.test.tsx`.
- [ ] An instruction that changes nothing reports that plainly and leaves the instruction in the box to reword.

## Walkthrough record

Not yet walked.

## Notes

- **This scenario spends money.** It makes at least three real Claude calls. It is tagged `full`
  rather than `smoke` for that reason.
- The model may word the note differently each run. The checklist is about **which fields moved**
  and **whether the diff is legible**, never about the exact sentence it wrote.
- Step 8 is the important one and is easy to skip. Navigating away without applying is the only
  way to see, from the outside, that the route stored nothing.
- The conversation is component state and is **not** persisted. Reloading the page empties it,
  which is correct: a conversation about a draft is working state, not a record (SPEC.md §Program
  AI Editor).
