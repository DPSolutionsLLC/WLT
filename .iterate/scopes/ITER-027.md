# ITER-027: Who Else Is In That Gym

**Type:** Feature
**Status:** Backlog — **blocked by ITER-024**
**Plan:** _none yet_
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29
**Blocked by:** ITER-024 — both halves need to know which young people share one occasion, which
the schema cannot express today

## Summary

Two related ideas, both about the young people a leader did not plan for. In the user's words:

> it could be nice to give them an alert as to what other youth might potentially be at an event
> you have committed to go to for an individual. helping you keep them in mind while you are there
> and helping you remember to make contact with them if possible and help them feel seen and loved.

and

> could be nice if the app tracked when there was a potential that they may have made contact with
> another youth at the event that they hadn't previously committed to.

**Before:** you committed to go and see Ethan on Friday. Three other ward youth will be at the same
game. Tell you, so you keep them in mind.

**After:** you were at that game. You may well have spoken to those three. Offer to let you say so,
rather than losing it.

## Why it is blocked

Both halves need the answer to *"which other young people are at this occasion?"*, and today an
event belongs to exactly one youth (ITER-024). There is no join to ask. This is not a small gap to
work around — it is the whole input.

Under ITER-024's recommended Option A′ both become straightforward: the other rows sharing the
occasion **are** the other youth, and the "after" half is the same set intersected with what the
leader has already written up.

## What to be careful about, when it is unblocked

- **The "after" half must never write on its own.** It offers; a person confirms. Anything else is
  the app recording a pastoral contact that may not have happened, and it would put a write outside
  a human confirm (CLAUDE.md rule 3). *"Potential"* is doing real work in the user's sentence and
  should survive into the interface.
- **It is a prompt, not a duty.** A leader who went to a game and spoke to nobody else has done
  nothing wrong. If this reads as a checklist of people you failed to greet it is worse than absent
  — and the module's stated purpose is that a young person is seen, not that a leader is measured.
- **The "before" half fires from the clock**, which nothing in this project does. It joins the six
  clock-driven things CLAUDE.md already defers to Phase 11 (`youth_followup_prompt`,
  `youth_event_uncovered`, the Monday away-digest, `visit_overdue`, `refresh_goal_status()`, ICS
  re-sync) — that would make **seven**, and Phase 11 is meant to settle the mechanism once for all
  of them. Computing it on read, as `lib/youth/followUp.ts` does, is the pattern that avoids adding
  an eighth.
- **Cross-organization by nature.** The other youth at a game are quite likely another
  organization's, so this interacts with ITER-025 directly: being told about a young person you may
  not then write about would be a strange place to leave somebody.
