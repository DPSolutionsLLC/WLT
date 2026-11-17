# ITER-063: Fill in a past Sunday from the Planner's Meetings tab

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-15

## Summary
Extend **Report a change** on the Sacrament Planner's Meetings tab so that it can **fill in** what
was never entered on a past Sunday (prayers, an extra speaker, who conducted, and the hymns), not
only correct what is already there. Let the **executive secretary** do this for Sundays whose
meeting is over, and reach nothing else in the Planner.

## Context
Raised by the user (2nd counselor) on 2026-11-15 while using the Planner. Some Sundays in the
history are incomplete: one has speakers only, with no prayers or music recorded. The bishopric
wants its history to stay accurate. One case the user named is a bishopric member who plans a
Sunday outside the app. The executive secretary, who usually knows what happened from building the
program, would then record it for them after the meeting. In practice the information will often
already be there, but filling the gaps must be possible.

Music is in scope because the bishopric wants to **start recording music history now**. Later, once
the music coordinator works in the app (their own access level, recording assignments, hymns and
musical numbers), music will be recorded there automatically. Until then, hymn number and title are
enough.

## Current Behavior
- **Each Sunday card on Meetings shows four lines:** Conducting, Opening prayer, Speakers, Closing
  prayer. **Music is not on the card at all**, though Sundays planned in the Planner do carry hymn
  slots (number and title).
- **Report a change** opens an editor that lists **only the people already on that Sunday**:
  - for an imported Sunday, the rows read from the program file
  - for a Sunday planned in the Planner, the slots that have, or once had, a name

  For each row it can retype the name, mark it **Blank** ("didn't give it, don't know who did"), or
  **Undo**. It cannot add a row: an empty prayer or a missing speaker cannot be filled in, and
  conducting and hymns are not editable here.
- Corrections count toward each person's talk/prayer history, and the card shows an "N changed"
  marker with "Program had ___" or "Was ___" beside the corrected rows.
- **Access:** only the bishop and the two counselors can open the Planner (`planner.use` plus a
  bishopric calling, checked in the app and by RLS). The executive secretary cannot open it at all.
- Every Planner save already writes an audit row naming **who, when, which collection and which
  document** (for example, which Sunday). It does not record names before and after; names are
  kept out of audit rows on purpose.

## Desired Outcome
- **Report a change keeps working exactly as it does now** for correcting existing rows.
- In the same editor a person can also **fill in what is missing** on a past Sunday:
  - the opening and closing prayer, when no one is recorded
  - **an extra speaker** (add a speaker row)
  - **who conducted**
  - **the hymns** (opening, sacrament, rest when there is one, closing): **number and title only**
- People filled in this way are picked from the ward list, as corrections are now. Prayers and talks
  filled in **count toward each person's history**, the same as a correction.
- **Each Sunday card on Meetings shows the hymns** alongside the people, so recorded music is visible.
- **Who can do it:**
  - **The bishop and both counselors**, as today.
  - **The executive secretary**, but **only** to record or correct a Sunday **after its meeting is
    over**. They cannot plan future Sundays, see Pray About, or use any other part of the Planner.
- **No notifications.** Accountability comes from the existing audit row (who, when, which Sunday)
  plus the card's existing "changed" marker. The user confirmed that is enough.
- **Done looks like:** on a past Sunday with speakers only, a bishopric member or the executive
  secretary opens Report a change and adds both prayers, the conductor and four hymns. After saving,
  the card shows them, the prayer-givers' history shows the prayer on that date, and the audit log
  shows who saved that Sunday. The executive secretary cannot reach a future Sunday or any other
  Planner tab, and the server refuses such a save if they try.

## Scope Notes
- **The Planner is imported code** (`lib/sacramentPlanner/assets/`), edited only for deliberate,
  user-requested reasons, as GROUP-04 and GROUP-06 were. This is one of those.
- **The executive secretary's access is a security boundary, not just a hidden tab.**
  - Today the Planner's documents are bishopric-only at the database.
  - "Only past Sundays, only the meeting record" has to hold where the save is written (the save
    route and/or RLS), not just in the screen. Today's rule is "a bishopric calling".
  - A refused save should answer with a sentence, not a generic error.
- **"Meeting is over"** should be judged on the **ward's** clock (CLAUDE.md rule 12), not the
  device's or the server's. Planning decides exactly when on Sunday it counts as over.
- Imported Sundays and Sundays planned in the Planner are stored differently: rows read from a
  program file plus fixes, versus the Sunday's own slots. Filling in has to work for both. A Sunday
  imported from a program file with no prayers at all is the user's real example.
- **Practice mode:** the executive secretary has no reason to use it. Planning decides whether they
  see the practice layer at all.
- **Interaction with ITER-046** (module access by title): this item's executive-secretary access is
  narrower than "view or full on the Planner module". Planning should check whether ITER-046 has
  moved, so the two do not build two different access mechanisms.
- **Not in scope:**
  - the musical number, the chorister and the organist
  - compiling older music history
  - any connection from these records to To Do, the programme, speaking history outside the Planner,
    or the Music module (the Planner still has no pipelines, as recorded under ITER-045)

## Open Questions
- When exactly is a meeting "over" for the executive secretary: after the Sunday's date in the
  ward's zone, or after a set time that Sunday?
- Can the executive secretary **add** a speaker, or only fill in and correct? The user's answer
  covered the bishopric adding everything; confirm it applies equally to the executive secretary.
- Should the hymn slots offered for filling in follow the Sunday's type? For example, should a Fast
  Sunday or a Sunday with one speaker skip the rest hymn?
