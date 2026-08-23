# ITER-008: Sort the Roster by What You Are Assigning

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-22

## Summary

When picking somebody for a **prayer**, the roster should be sortable by when they last prayed.
When picking a **speaker**, by when they last spoke. Date first, then name — and the existing
search must keep working alongside it.

## Context

Raised on 2026-08-22 while reviewing the `talks-c` walkthrough screenshots.

`talks-c` added a `annotations` prop to `MemberPicker` so the prayer picker can render
"Last prayed March 2025" beside a name, with **nothing** beside somebody who has no history. That
half works and was walked. The gap the review surfaced:

> The picker shows the date but always orders by household and then by name, so finding who is
> overdue means reading every one of twelve rows and comparing months in your head.

The information is on screen; it just is not doing any work. Sorting turns it from a fact you have
to interpret into an answer.

## Desired Outcome

In any assignment picker, the user can order the roster by the recency the assignment cares about,
with never-assigned people first — the same "unused first" rule the topic library already uses.

## Why this is bigger than the prayer picker

Three reasons it should be designed once rather than bolted on:

1. **It is not prayer-specific.** The identical control belongs on speaking assignments
   (`SpeakerField`), and later on Phase 7 visits ("last visited") and Phase 10 sacrament
   ordinances ("last blessed"). Four consumers, one behaviour.
2. **`MemberPicker`'s interface is deliberately frozen.** `annotations` was added in `talks-c` and
   RAISED rather than added quietly, per the rule in that component's header. A sort control is a
   second addition and deserves the same treatment.
3. **The prayer half and the speaker half are not the same work.** `listLastPrayed()` already
   exists in `lib/prayers/queries.ts`. There is no equivalent "last spoke" read — it would come
   from `assignment_history` filtered to `outcome = 'completed'`, which is a new query, and
   external speakers deliberately never enter that table at all (ITER-004).

## Scope Notes

**The annotation currently carries formatted words, not a sortable value.** `annotations` is a
`Record<string, string>` holding "Last prayed March 2025". Sorting on that string sorts
alphabetically by month name, which is wrong. The shape has to carry the underlying date as well
as the label — something like `{ label: string; sortValue: DateOnly | null }` — or a parallel prop
supplies the keys.

**Never-assigned sorts FIRST, not last.** `compareTopicsByStaleness` in
`lib/topics/topicRotation.ts` already solved exactly this for topics and is the precedent: a null
date sorts to the top, then oldest to newest, ties broken by name. That comparator is pure and its
logic transfers directly; the picker version differs only in what it reads.

**Search must survive the sort.** `narrowPickerMembers` filters in memory today and the sort has to
compose with it, not replace it.

**The household grouping is the open design question.** The picker currently browses *by
household*, with names nested under a family name. A date sort cuts across households entirely, so
either the grouping collapses into a flat list while a sort is active, or the sort applies within
each household — which would not answer the question being asked. Flat-while-sorted is probably
right, but it is a real UI decision, not a detail.

## Open Questions

1. **Does sorting replace the household grouping while active?** See above. Probably yes, but it
   changes how the picker reads.
2. **Is the sort a control the user presses, or is it implied by the context?** A prayer picker
   could simply default to last-prayed order. Defaulting is fewer taps and the roster-b precedent
   warns against invisible defaults; a visible control the user can see and clear is more in
   keeping with how the organization filter was handled.
3. **What does "last spoke" count?** Almost certainly `assignment_history` at
   `outcome = 'completed'`, matching `COMPLETED_STAGE` — an assignment that was planned and
   abandoned must not suppress somebody. Worth stating explicitly, since it is the same failure
   mode the prayer side guards with `PRAYER_COMPLETED_STAGE`.
4. **Does `showFlags` / `ReliabilityFlag` interact with this?** `talks-d` owns reliability and it
   is a no-op today. If both land near each other, the picker gains two annotations at once.

## Related

- **`talks-c`** — added `annotations` and `listLastPrayed()`; this is the direct follow-on.
  See `plans/retros/talks-c-prayers-topics.md`.
- **`roster-b`** — froze the `MemberPicker` interface and recorded the rule for extending it.
  `components/roster/MemberPicker.tsx` carries the props table and the reasoning.
- **`lib/topics/topicRotation.ts`** — `compareTopicsByStaleness` is the working precedent for
  "unused first, then oldest, ties by name".
- **`scenario-008`** (the member picker) is still unwalked and would need updating.
- **Phase 7 and Phase 10** are the other consumers; neither is built.
