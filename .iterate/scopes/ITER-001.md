# ITER-001: Per-Organization Calendars and Cross-Organization Sharing

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-19

## Summary

Every organization with a presidency gets a calendar it owns and runs itself — its own items,
its own events, and its own decision about which other organizations can see them. The bishopric
can reach into any of them, but the normal path is each organization managing its own.

## Context

Today the calendar is the bishopric's. `sundays` is one row per Sunday for the whole ward, and the
only thing an organization holds is who conducts its own meeting (calendar-c). Everything else an
organization might want to put on a calendar has nowhere to live.

The ask came out of walking scenario 011: setting an Elders Quorum conducting rotation should
never have been a bishopric task, and the same reasoning extends to everything else a presidency
schedules. Requiring the bishopric to enter another organization's activity night makes the
feature pointless in the same way.

calendar-c already built the *permission* shape this needs — a narrow org-scoped permission, RLS
with `ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())`, and a pure
scope function for the UI. What is missing is that organizations have no calendar items of their
own beyond conducting.

## Desired Outcome

**One layered calendar, not one calendar per organization.** Ward-wide items always show. The
viewer's own organization's items layer on top. So do items other organizations have shared with
them. Default view is ward-wide plus own organization. A stake conference still appears on the
Elders Quorum calendar, because it still affects them.

**Two shapes of organization item, both required:**

1. **Sunday-shaped** — one per Sunday per organization, sitting alongside who conducts. The first
   example is which conference talk is that organization's lesson. This extends the
   `sunday_org_conducting` pattern.
2. **Free-standing events** — their own date, unattached to any Sunday. Service projects,
   presidency meetings, activity nights. Some fall on Saturdays or weeknights.

**Exactly one owning organization per item.** Combined Young Men / Young Women activities work by
one organization hosting and sharing with the other — organizations take turns being in charge.
There is deliberately no co-ownership and no shared edit rights.

**Sharing is one outbound switch with an audience.** The organization that owns the item decides
whether to publish it and which other organizations may see it. Once shared, it appears on their
calendars — there is no second switch on the receiving side. Ward council agreement is a
conversation that happens before anyone touches a setting; the system does not record it.

**Two permission bars inside an organization:**

- **Presidency** (president + counselors) — sets the conducting rotation, and controls what the
  organization publishes and to whom.
- **Secretary** — ordinary upkeep: adding a service project, editing an event.
- **Bishopric** — sees everything and can control any organization's calendar and sharing
  settings, but normally does not need to.

Done looks like: an Elders Quorum president plans a service project, sets this month's lesson
talk, publishes visit progress to Relief Society, and never asks the bishopric for anything —
while a Relief Society president sees the shared item appear without doing anything, and sees
nothing the Elders Quorum did not publish.

## Refinements from the 2026-08-22 conversation

Captured while walking scenario 015, when ITER-007 surfaced that an organization president cannot
open the calendar at all. The vision below was stated by the user and **confirms the layered
design above**; these are the parts it did not already say.

- **Every role gets a calendar view.** What differs is what is *on* it, not whether they have one.
  The current all-or-nothing `calendar.view` gate is the thing that has to go.
- **The bishopric can filter organization layers off.** They see everything by default but must be
  able to turn a layer off when planning their own work. This is the concrete answer to the noise
  risk recorded under Open Questions — a bishopric-side view control, not an inbound sharing
  switch.
- **The bishopric owns items too, and some are bishopric-only.** Youth lesson planning is the
  named example: visible to the bishopric, not to any quorum. The ownership model already handles
  this (owned by the bishopric, shared with nobody), but it makes the open question "does the
  `bishopric` org type get a calendar" a **yes**, and it means the bishopric is an owning
  organization rather than only an admin over other people's.
- **Quorum Sunday meeting planning** is a named future consumer of the Sunday-shaped item, beyond
  the lesson talk — for example planning what an Elders Quorum does in its own Sunday block.
  Controlled by the presidency directly.
- **Visit accountability is opt-in by the group.** When a set of people agree to hold each other
  accountable, they opt in to show *progress* to everyone involved.

  > **This must never reach `visit_private_notes`.** CLAUDE.md rule 5 makes those readable only by
  > `user_id = auth.uid()` — not by the bishopric, not by an admin, not by a support query.
  > "Sharing progress" means completion and status only. If a design ever needs the note text to
  > make accountability meaningful, that is a rule change to raise explicitly, not to slide in.

### The question this refinement opens

**"Only the bishopric sees the sacrament meeting plans" — does that mean view, or manage?**

Today `calendar.view` is held by `ward_secretary`, `executive_secretary` and `music_coordinator`
as well as the bishopric, and `calendar-c` states plainly that "who conducts is not sensitive, and
the music coordinator plans against it." Phase 6's program builder depends on the music
coordinator reading the calendar. So the likely reading is that **managing** the sacrament meeting
is bishopric-only while **viewing** stays wider — but this needs an explicit answer before the
layering is designed, because it decides whether the sacrament layer is one audience or two.

A related sub-question: `sundays.notes` is bishopric-written free text that currently renders on
the month grid and the Sunday detail page. RLS already makes `sundays` ward-readable (migration
019), so notes are not protected data today — the only thing hiding them is the application-level
`calendar.view` check. If org leaders gain a calendar view, notes need a deliberate decision.

## Scope Notes

- **This is three or four plans, not one.** Provisional seam: the event model and per-organization
  layering first, then sharing and audiences on top. Sharing is meaningless until there is
  something to share. Confirm the split at planning time.
- **Do NOT generalize `activity_events` (migration 009) into this.** Youth outside-activity
  tracking — knowing a youth has a football game Thursday so a leader can show up — is a
  different problem that happens to wear a similar shape. Organization activity nights are the
  organization planning something for its own people. Both stay, separately. This decision was
  made explicitly during discovery; do not relitigate it without new information.
- The schema already carries three date-bearing models — `sundays` (Phase 3), `activity_events`
  (Phase 8), `agendas` (Phase 9). This adds a fourth. That is accepted, but the boundaries
  between them should be written down when it lands.
- calendar-c's org-scoped permission shape is the precedent to follow, and
  `plans/11-notifications-admin.md` already records it as the established pattern for "may manage
  my own organization's data". Extend it rather than inventing a second mechanism.
- The line between presidency and secretary matches calendar-c's existing split for conducting —
  `ORG_LEADERSHIP_PERMISSIONS` vs `ORG_SECRETARY_PERMISSIONS`.
- RLS for shared items needs a predicate that reaches a sharing/audience table. That is a
  subquery per row; it needs an index and a look at the query plan before it ships.

## Open Questions

- **Noise risk, and the most likely thing to need revisiting.** One layered calendar plus a
  growing list of shared item types means a presidency could eventually open the calendar and see
  six organizations' worth of items. No inbound switch was chosen deliberately, and it is right
  for how little is shared today. Revisit once this is in real use rather than designing around a
  problem that does not exist yet.
- Does the lesson-talk item connect to the topics / talks pipeline (Phase 4), or is it a plain
  reference to a conference talk with no pipeline behaviour?
- Should a shared item be visually distinguishable from your own on the layered calendar, so a
  reader can tell whose event it is?
- How does the existing ward setting `cross_org_visibility` interact with calendar sharing —
  does it govern this too, override it, or stay unrelated?
- What happens to an item already visible to another organization when its audience is revoked —
  does it disappear silently?
- Do organizations of type `other` (no presidency) get a calendar at all? `ROTATION_ELIGIBLE_ORG_TYPES`
  currently excludes them and `bishopric`.
- What do roles with no organization see — ward_secretary, executive_secretary, music_coordinator,
  ward_council_member? Every layer, or ward-wide only?
- Does the month grid need to show organization items at all, or do they live on the Sunday detail
  page and an events list? `SundayCell` and `SundayCard`'s three reserved regions belong to
  Phase 4 and are contract-tested.
