# ITER-010: Per-Leader AI Settings, Applied When It Is Their Turn

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-23

## Summary

Let each leader save **their own** AI settings, and have those settings apply automatically when
it is their turn to conduct and plan sacrament meeting — without anybody remembering to restore
them.

## Context

Raised on 2026-08-23 walking scenario 020, alongside ITER-009. The user's words:

> *"I want every leader to be able to save their own settings to be recalled when it is their turn
> to conduct and plan sacrament. With the option to have those settings restored every time it is
> their turn to plan and conduct without having to remember to restore."*

`ai-a` shipped **one** configuration per ward, versioned. That is the right shape for "how this
ward sounds", and the wrong shape for the actual working pattern: the bishop and both counselors
rotate conducting, they do not write the same way, and the drafts a counselor gets should sound
like that counselor.

This is the larger half of the pair. It is architectural, not a settings-screen addition.

## Desired Outcome

When a leader opens the planner for a Sunday **they** are conducting, the drafts come out in their
voice, with no step they can forget. When it is somebody else's Sunday, they see that person's.

## Why this is bigger than it looks

**1. It changes what "the ward's AI settings" means.** Today `getActiveAiSettings(wardId)` returns
one row and `buildSystemPrompt` takes it. With per-leader settings there are two layers — the
ward's voice and the leader's — and the resolution rule has to be decided, not defaulted:

- Does a leader's setting **replace** the ward's, or **layer on top of** it?
- Layering is almost certainly right (a ward's doctrinal emphasis should not vanish because a
  counselor set a tone), and it means `renderSettingsProse` grows a merge step and
  `buildSystemPrompt` grows a block — with the same care about where the cache breakpoint sits.
- The precedent in this codebase is `mergeRoleAccess`: a ward stores what it CHANGED, not the
  whole list, so a field added later reaches everyone. The same argument applies here and the
  same shape probably should.

**2. "Whose turn is it" is already solved, and the answer lives elsewhere.** The conducting
rotation (`lib/calendar/`, `calendar-a`/`calendar-c`) already resolves who conducts a given
Sunday, including the monthly cadence, the Fast Sunday shift, cancelled-Sunday skips, and
per-organization conducting. This feature must READ that, never re-derive it. That is the single
biggest risk in the item: a second implementation of "whose turn is it" that drifts from the first.

**3. It is per-Sunday, not per-session.** The settings that apply are the settings of the person
conducting **the Sunday being planned** — not the person logged in. A ward secretary drafting a
message for the bishop's Sunday should get the bishop's voice. That is the honest reading of the
request and it is also what makes the feature useful; it is NOT "settings follow the current user".

**4. Where does it apply, exactly?** "Plan and conduct" needs pinning down. Confirmation messages
and thank-you notes are clearly in. Topic suggestions probably. The program builder (Phase 6) and
agendas (Phase 9) are unbuilt and would inherit whatever is decided here.

## Scope Notes

**This needs a migration.** Either a `user_id` column on `ai_settings` (nullable = the ward's
row) or a separate `user_ai_settings` table. The single-table option keeps one query and one
mapper and makes "latest wins" work unchanged; the separate table keeps the ward's history clean
and avoids a nullable discriminator. Weigh both.

**RLS is the interesting part, and it is not obvious.** `ai_settings` is bishopric-only today
(migration 019's loop). Per-leader rows raise a question that has a product answer, not a
technical one: **can a counselor read the bishop's settings?** Arguments both ways —

- They are not private notes. CLAUDE.md rule 5 covers `visit_private_notes` and
  `activity_private_notes` and deliberately nothing else.
- But they are somebody's voice, and CLAUDE.md §7 says bishopric authority is *shared*, which
  argues for readable.
- Readable is also the only way a secretary can draft on the bishop's behalf, which point 3 above
  says is the point of the feature.

Probably: readable by the bishopric, writable only by their owner. That is a **new policy shape**
in this schema — every existing table is either ward-scoped, org-scoped, or author-only — so it
deserves its own RLS suite rather than an addition to `tests/rls/ai-settings-access.test.ts`.

**The "without having to remember" part is the requirement.** An opt-in toggle that a leader must
set once is fine; a restore they must press each time is exactly what this replaces. Whatever the
design, the test is: can a counselor who has set their preferences once forget this feature exists
and still get their own voice?

**Rule 3 is unaffected and must stay that way.** Whose settings drafted it changes nothing about
approval: every generated message is still a draft a person accepts, edits, or rejects. Nothing
here auto-sends, and per-leader settings must not become a reason to skip a review step.

## Open Questions

1. **Replace or layer?** Layering, almost certainly — but which fields layer and which override?
   A tone probably overrides; a ward context probably does not.
2. **Can a counselor read the bishop's settings?** See above. Product decision.
3. **One table or two?** `ai_settings.user_id` nullable, or `user_ai_settings`.
4. **What happens on a Sunday with no conductor?** `sunday-types-meeting-split` made
   conductor-without-a-meeting unrepresentable, so this state is real and reachable. Falling back
   to the ward's settings is the obvious answer and should be explicit.
5. **What does the settings screen look like with two layers on it?** Seven cards is already a
   long page. Two tabs, two pages, or a per-field "ward / mine" control are all plausible.
6. **Does an org president get one?** They plan their own meetings under ITER-001. Probably yes
   eventually, which argues for not hard-coding "bishopric" into the design.

## Related

- **`ai-a-client-and-settings`** — built the single ward-level configuration this generalises.
  See `plans/retros/ai-a-client-and-settings.md`.
- **ITER-009** — named versions. Raised together; a per-leader setting will likely want to point
  at a named version rather than a timestamp.
- **`calendar-a` / `calendar-c`** — own the conducting rotation this must read rather than
  re-derive. `lib/calendar/`, and `plans/retros/calendar-c-rotation-cadence.md`.
- **`role-access-overrides`** — `mergeRoleAccess` is the working precedent for storing a DELTA
  against a base rather than a replacement. `lib/auth/permissions.ts`.
- **`plans/05-ai-platform.md`**, and **`ai-c-feature-routes.md`**, which is where the message
  drafting routes that would consume this actually land.
- **ITER-001** — per-organization calendars; the same "whose meeting is this" question.
