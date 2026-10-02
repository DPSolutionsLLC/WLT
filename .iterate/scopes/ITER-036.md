# ITER-036: Finalize hands speakers and prayers to To Do

**Type:** Modification
**Status:** Completed
**Completed:** 2026-10-02
**Commit:** 3f4c835 (fa), 17daa9d (fb)
**Plan:** plans/sacrament-finalize-hands-off-asks.md
**Created:** 2026-09-30
**Group:** GROUP-02 — Sacrament planning flow (2 of 4)

## Summary
Finalizing becomes the single act that means "I've prayed about it and decided", per kind —
topics, references, speakers, prayers — and finalizing speakers or prayers is what puts one ask
to-do per chosen person on the conductor's To Do list.

## Context
The user tested the live site and nothing reached To Do. They expected Finalize to be the trigger.
In the build, Finalize does not send anything: speaker asks come only from a separate, small
"Send asks (N)" button on the hub's Sunday card, which appears only after References is finalized
or skipped and a conductor is set, and it sends to the CONDUCTOR'S list — so a leader who was not
conducting that Sunday would never see the asks.

## Current Behavior
- Topics and References each have a finalize checkmark; finalizing records the decision (and
  un-dims the Sunday on Music) and triggers nothing else.
- Speakers have no finalize. "Send asks" (slice f1) creates one "Ask ___ to speak" to-do per
  speaker on the conductor's list, gated on References being decided. The ask card carries the
  topic, contact details and references, and offers Accepted / Declined; Schedule puts it on My
  Appointments.
- Prayers have no asks at all.

## Desired Outcome
- **Four separate finalizes**, each meaning "decided": topics, references, speakers, prayers.
- **Finalizing speakers** creates one To Do item per chosen speaker on the conductor's list: make
  an appointment from it (lands in My Appointments) or record Accepted / Declined directly. It
  carries the speaker's paired topic and that topic's references.
- **Finalizing prayers** does the same for each chosen prayer-giver (both prayers).
- The separate "Send asks" button is no longer how this happens.
- Done when: finalizing speakers on a Sunday puts exactly one ask per chosen speaker on the
  conductor's To Do, and the same for prayers, with nobody asked twice.

## Scope Notes
- Builds on f1/f2/f2b/f2c (asks, handover, talk-off, cancellation) — those rules still hold.
- Pairing stays changeable after finalizing (ITER-035); a changed pairing must update what the
  ask to-do shows (it already reads the topic live from the talk).
- The References gate on asking may no longer make sense once each kind finalizes on its own —
  revisit, don't assume.
- The paused f3b (assistant, conductor window) sits on top of this; plan this first.

## Open Questions
- If a finalized speaker is later un-chosen, what happens to their open ask?
- Does un-finalizing exist, and what does it undo?
