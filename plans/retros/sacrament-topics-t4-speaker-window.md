---
id: sacrament-topics-t4-speaker-window
type: feature
iter: null
commits: ["856a2cf"]
date: 2026-09-29
files:
  - lib/assignments/speakerOrder.ts
  - components/sacrament/SpeakerWindow.tsx
  - components/sacrament/PersonHistoryWindow.tsx
  - components/sacrament/TalkRow.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
related: [sacrament-topics-t3-the-screen, talks-b-month-planner]
---

## What was done
Sub-slice `t4` of the Topics screen rebuild: the speaker window becomes the prototype's
AssignSpeakerModal. It lists who to ask next, never-spoken members first and then whoever spoke
longest ago, each with "last spoke …" and the reliability flags; youth are listed for a youth speaker.
A **History** button (bishopric only) shows a person's past talks and declines in place of the list.
**"Use … as typed"** turns a name the roster lacks into an outside speaker with an optional title.
The window no longer uses `SpeakerField`, which stays for the month planner's modal.

## Key decisions
- **Only a completed talk counts as speaking** in `lastSpokeOn()`, the same test
  `reliabilityFlags` uses for "not spoken". A cancelled talk (f2c) or a decline never pushes
  somebody down the list.
- **History is loaded once per page, and only for the bishopric** (talks-d); anybody else gets
  `null`, which makes the list alphabetical with no "last spoke" line and no History button, so
  nothing claims "Never spoken" for people whose history the reader cannot see.
- **The window gets slim members**: id, name and category, and only active ones (the picker's
  status rule). No phone or address goes to the browser for a list of names. `narrowPickerMembers()`
  takes full member rows, so its category rule is applied on the slim records instead.
- **History replaces the list inside the same window**, with "← Back to the list", because Modal
  does not stack. `TalkRow` lost its `user` prop, which only the old picker needed.
- The History button read "Historyfor Tomas Reyes" to a screen reader, the same sr-only spacing
  bug t3 hit; the component test caught it. Ordering and the "only completed" rule were each proved
  able to fail. The prototype's household grouping is left to slice `d`.
