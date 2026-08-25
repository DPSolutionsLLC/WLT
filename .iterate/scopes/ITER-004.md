# ITER-004: Speakers Who Are Not Members of the Ward

**Type:** Feature
**Status:** Completed
**Completed:** 2026-08-25
**Commit:** be4ea6e

`talks-a` landed 2026-08-20, `talks-b` 2026-08-21, `program-a` and `program-c` 2026-08-24, and
`program-d` (the printed half) on 2026-08-25. An external speaker now reaches all three surfaces: the
pipeline with its contact stages waived, the public page in full, and the printed programme as
"President Mark Andersen" via `printedName` in `MeetingOrderPanel`.

Proven by `tests/lib/pdfRender.test.ts`, which renders the real PDF and extracts its text rather
than asserting on a component tree. **Scenario 034's human confirmation of the same fact is not yet
walked** — that walk is about the fold and the QR scan, which are Milestone M4's business, not this
scope's.
**Plan:** plans/talks-a-pipeline-core.md (schema + pipeline), plans/talks-b-month-planner.md (on-screen),
plans/program-a-draft-and-approval.md (the name reaches the draft),
plans/program-c-public-pages.md (public), plans/program-d-pdf-and-distribution.md (printed)
**Created:** 2026-08-19

## Summary

The talk pipeline and the program builder must be able to carry a speaker who is not on the ward
roster — a visiting stake leader, a missionary reporting, a former member of the ward.

## Context

Surfaced while scoping ward conference ([ITER-003](ITER-003.md)), where the stake presidency and
stake auxiliary leaders speak rather than ward members. But it is not a ward conference feature:
visiting high councilors, missionaries reporting home, and a returning bishop's family all hit
the same wall.

**This is recorded as a hard requirement, not a nice-to-have.** Phase 4 has not been built yet,
which is the whole reason it is worth writing down now — designing for an external speaker from
the start is cheap, and retrofitting one onto a members-only pipeline later is not. If Phase 4
ships assuming every speaker is a roster record, this becomes an expensive change.

## Desired Outcome

A bishopric can put a name on a Sunday that does not belong to anybody in the ward, and it flows
through to the printed program correctly.

The pipeline behaviour around such a speaker should degrade honestly rather than pretend:

- There is no household, no phone number, and no member record to link to.
- The invite / confirm / follow-up steps that assume a contactable ward member either do not
  apply or are explicitly marked not applicable — never silently skipped, and never left looking
  like an outstanding task nobody can complete.
- Speaker history and any "who has spoken recently" reporting should not be distorted by
  external speakers.

Done looks like: a ward conference program lists the stake president by name with the correct
title, and nothing in the talk pipeline is sitting in a stuck state waiting for a confirmation
that was never going to arrive.

## Scope Notes

- Lands in **Phase 4** (`plans/04-talks-pipeline.md`) and **Phase 6**
  (`plans/06-program-music.md`). Neither is built.
- `assignments` currently points at `members`. The shape of the fix — a nullable member link plus
  a free-text name, a separate external-speaker record, or something else — is a planning
  decision, not one to make here.
- A title or calling probably has to travel with the name ("President", "Sister", a stake
  calling), because a program that just says "Mark Andersen" for a visiting stake president reads
  wrong. Note that `users` records no gender, and `bishopricDisplayName()` deliberately refuses to
  guess an honorific for exactly that reason — an external speaker's title likely has to be typed
  rather than derived.
- The public program page (`/public/[slug]`) shows first name and last initial only for ward
  members. An external speaker is a different privacy case and needs its own decision — a
  visiting stake president is normally named in full on a printed program.

## Open Questions

All three were answered by `talks-a`. Kept here with their answers rather than deleted, because
the reasoning is what a later reader needs.

- ~~Do external speakers need to be reusable across Sundays (a saved list of stake leaders), or is
  typing the name each time acceptable?~~ **Typed each time.** `external_speaker_name` and
  `external_speaker_title` are inline columns on `assignments`. A saved list was considered and
  rejected as machinery nobody has asked for. Revisit only if a ward complains.
- ~~Should an external speaker appear in speaker-history reporting at all?~~ **No, and the schema
  enforces it.** `assignment_history.member_id` is `not null`, so `writeAssignmentHistory()`
  returns false rather than writing a row. "Speaker history is not distorted" is true by
  construction, not by a check somebody has to remember.
- ~~What does the appreciation / follow-up step do for someone with no phone number — skip
  silently, or surface as explicitly not applicable?~~ **Explicitly not applicable.** One column
  pair, `contact_waived_at` / `contact_waived_by`, settable only when `member_id is null`. A
  waiver is a recorded decision with a person and a timestamp on it, and it satisfies exactly four
  gates — never a speaker, a topic, an approval, or `sunday_confirmed_at`. Rendering it as "Not
  applicable" rather than as an outstanding task is `talks-b`'s job.

## Progress

- **2026-08-20 — `talks-a` (schema + pipeline), commit `a260ca6`.** Migration 025 adds the two speaker columns, the
  `assignments_speaker_exactly_one` CHECK, and the contact waiver with its two CHECKs.
  `lib/assignments/speaker.ts` is the single place that answers "who is speaking";
  `lib/assignments/pipeline.ts` holds the four gates a waiver opens and the ones it must not.
  Covered by `tests/lib/externalSpeaker.test.ts` and `tests/db/assignment-approvals.test.ts`.
- **2026-08-21 — `talks-b` (the on-screen half), commit `036698c`.** A waived assignment renders
  "Not applicable - invited outside the ward" with the name and date of whoever decided it, across
  all four waivable stages. No progress bar, no disabled controls, none of the shape of an
  outstanding task — a disabled button reads as "this is coming", and the point is that it is not.
  `SpeakerField` is the member / outside-the-ward switch, and switching sides clears the other so
  the state the CHECK forbids cannot be typed. Covered by
  `tests/components/assignments/ContactStagePanel.test.tsx`, which asserts the ABSENCE of
  outstanding-task wording as well as the presence of the right words, and walked as scenario 013.
- **Remaining — Phase 6. PLANNED 2026-08-24, not yet built.** The question was how an external
  speaker prints on the program, and how much of their name `/public/[slug]` shows.
  **Answered in `program-a` §Decision 3:** the draft carries **both** a `printedName` and a
  `publicName` for every person, computed once at assembly. A ward member is
  `"Sarah Whitfield"` printed and `"Sarah W."` public; an external speaker is
  `"President Mark Andersen"` in both — their name was typed by the bishopric *in order to be
  printed*, and there is no member record to protect.

  The reason for storing both rather than deciding at render time is that it makes
  `program-c`'s public projection safe **by construction**: `toPublicProgram()` reads only
  `publicName`, so a member's surname has no code path to the public page. The privacy rule is
  enforced by which field the projector selects, not by a SQL `CASE` a later migration could get
  wrong.

  Ships across three plans: `program-a` (the name reaches the draft), `program-d`
  (`MeetingOrderPanel` prints it), `program-c` (`publicProjection.ts` publishes it).
  **Close this scope when `program-c` and `program-d` have both merged** — not before.
