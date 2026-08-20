# ITER-004: Speakers Who Are Not Members of the Ward

**Type:** Feature
**Status:** Backlogged
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

- Do external speakers need to be reusable across Sundays (a saved list of stake leaders), or is
  typing the name each time acceptable?
- Should an external speaker appear in speaker-history reporting at all?
- What does the appreciation / follow-up step do for someone with no phone number — skip
  silently, or surface as explicitly not applicable?
