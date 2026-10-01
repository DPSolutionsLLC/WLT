# ITER-035: Sacrament candidates and Prayer Items

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-09-30
**Group:** GROUP-02 — Sacrament planning flow (1 of 4)

## Summary
Planning a Sunday becomes picking CANDIDATES — as many topics, speakers, references and prayers
as the conductor is weighing up — and every candidate lands automatically on the conductor's
**Prayer Items** list ("pray about it") until they finalize.

## Context
Raised 2026-09-30 after the user tested the live site expecting picked topics, references and
speakers to reach a list and found nothing anywhere. The user's model: picking is tentative and
prayerful — five people considered for three slots — and the app should hold that thinking for
them in the prototype's **Prayer Items** module (the "pray about it" module; NOT To Do, and NOT
Prayer Roll). Prayer Items will also be fed later by Callings and Agendas.

Terminology, as the user uses it:
- **Prayer Items** — specific things the leader needs to pray about. This item feeds it.
- **Prayer Roll** — a separate module: two rolls (bishopric, ward council) tied to their meeting
  agendas. Not part of this flow.
- **To Do** — remembering to ask a chosen person (ITER-036).

## Current Behavior
A Sunday has fixed speaking slots and each slot holds one speaker, one topic (free text since
t1) and its references; prayers likewise hold one person per prayer. There is no notion of a
candidate who is being considered but not chosen. Nothing is created anywhere when a topic,
reference, speaker or prayer is picked. Prayer Items (P7) is not built.

## Desired Outcome
- On a Sunday, the conductor can pick **any number** of candidate topics, speakers, references and
  prayer-givers (both prayers), in any order, at the same time.
- **References always belong to a topic** — picking one attaches it to that topic.
- **Pairing a speaker with a topic can change at any time**, before or after finalizing.
- Every candidate appears on the conductor's **Prayer Items** list, grouped so it is clear which
  Sunday they are for, without the conductor having to add it by hand.
- Finalizing (ITER-036) resolves those Prayer Items; nothing has to be ticked off separately.
- Done when: a leader can weigh five people for three slots on the hub, see them on Prayer Items,
  and the list empties itself as they finalize.

## Scope Notes
- **Depends on Prayer Items (P7, `plans/P7-prayer.md`), not yet built** — at least its "linked
  item" half: an item created from something elsewhere that resolves when that thing is decided,
  with no resolve button of its own (the prototype's own rule for linked items).
- Recipient is **the conductor for that Sunday** (normally it is their month). Taking a Sunday
  over is the paused f3b work (`plans/sacrament-talk-asks-conductor-and-assistant.md`).
- The user has **further refinements to topic and speaker picking** they deliberately did not
  raise yet — ask before planning the picking UI.
- Prayers were missing from the flow as first described; they follow the same path as speakers.

## Open Questions
- Is the candidate pool shared by the whole bishopric (one pool per ward), or per conductor?
- One Prayer Item per Sunday, or one per candidate?
- How does a candidate list sit with today's fixed slots and slot-count stepper on the Topics
  screen (t3)?
