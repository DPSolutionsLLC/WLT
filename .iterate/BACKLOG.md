# Backlog

_Last updated: 2026-08-23_

---

## In Progress
Items currently being planned or actively worked.

- [ ] ITER-004 — Speakers who are not members of the ward → [scope](.iterate/scopes/ITER-004.md) | plans: [talks-a](plans/talks-a-pipeline-core.md), [talks-b](plans/talks-b-month-planner.md)
  _**The Phase 4 half is complete.** `talks-a` landed the schema and pipeline shape — a nullable
  member link, inline external name and title with a CHECK that a row holds one or the other, and
  an explicit contact waiver. `talks-b` landed the on-screen half: the waived contact stages read
  "Not applicable - invited outside the ward" with the name and date of whoever decided it, and
  nothing about them reads as an outstanding task. Scenario 013 walked.
  **What remains is the Phase 6 half** — how an external speaker prints on the program, and how
  much of their name `/public/[slug]` shows. A visiting stake president is normally named in full,
  which is a different privacy case from a ward member's first name and last initial. Still
  unplanned; belongs with `06-program-music.md`. **Do not close this scope until it ships.**_

---

## Grouped Work
Items in each group belong together and should be planned and worked in a single session.

_None. GROUP-01 (ITER-002 + ITER-003) shipped together on 2026-08-22 as one unified plan, which
is what the grouping asked for._

---

## Standalone Work
Each of these is large or complex enough to tackle on its own.

- [ ] ITER-011 — Choose which conference talks count as reference → [scope](.iterate/scopes/ITER-011.md) | plan: [ai-d](plans/ai-d-conference-corpus-scoping.md)
  _Raised 2026-08-23 deciding how General Conference gets into the corpus at all (CLAUDE.md §9,
  "Conference talk corpus scope"). Once there are a hundred and fifty talks, active/inactive one at
  a time is not a lever anybody will use. Wants a recency control, speaker-role checkboxes, and
  custom filters the user describes in words — resolved by the AI **once, at save time**, into a
  deterministic WHERE clause, shown before it is accepted, exactly like `topic_candidates`.
  **Nothing about this is possible today:** `match_document_chunks` filters on ward, status, and
  embedding-not-null, and `knowledge_documents` stores no speaker, no date, no calling. The bug it
  will ship if nobody watches for it is a recency filter that silently removes the standard works,
  because their `conference_date` is null. **Open:** does "talks by prophets" mean while-serving or
  ever-held; do saved filters AND or OR with recency._

- [ ] ITER-012 — Show how often a talk has been suggested → [scope](.iterate/scopes/ITER-012.md)
  _Raised 2026-08-23 alongside ITER-011. Last-suggested date, plus "appeared in 8 of your last 20
  generations" once it has come up more than once — a diagnostic that the corpus is too narrow, not
  decoration. Already an idiom here: the topic library orders by staleness and `lastPrayed` does the
  same for prayers, and `talks-c`'s render-nothing-rather-than-"Never" rule applies unchanged.
  **The logging half is not deferred** — `retrieval_suggestions` and its writes ship inside ITER-011,
  because suggestion history cannot be backfilled and every week without the write is permanently
  missing from the denominator. This scope is the display only, and can wait indefinitely._

- [ ] ITER-010 — Per-leader AI settings, applied when it is their turn → [scope](.iterate/scopes/ITER-010.md)
  _Raised 2026-08-23 walking scenario 020, alongside ITER-009. `ai-a` shipped ONE configuration per
  ward; the working pattern is that the bishop and both counselors rotate conducting and do not
  write alike, so drafts for a counselor's Sunday should sound like that counselor — with nothing
  to remember and nothing to press. Architectural rather than a settings-screen addition. Three
  things make it real work: "the ward's settings" becomes two layers and the merge rule is a
  product decision (`mergeRoleAccess` is the precedent for storing a delta rather than a
  replacement); the settings that apply belong to whoever conducts **the Sunday being planned**,
  not to whoever is logged in, so it must READ the conducting rotation rather than re-derive it;
  and it needs a new RLS shape — readable by the bishopric, writable only by its owner — which no
  table in this schema has yet. **Open:** can a counselor read the bishop's settings? Shared
  bishopric authority says yes, and a secretary drafting on the bishop's behalf needs it._

- [ ] ITER-009 — Name a settings version → [scope](.iterate/scopes/ITER-009.md)
  _Raised 2026-08-23 walking scenario 020. The history reads "Saved by Mark Andersen on 12 August
  2026" — a complete audit record and a poor recall tool. Six versions means six dates and no way
  to find the one that was right for thank-you notes. Wants a default name and a custom override.
  Small but not trivial: it needs a migration (`ai_settings` has no `label` column, and `ai-a`
  deliberately shipped without one), and the append-only rule means a rename is a NEW version
  rather than an UPDATE — `lib/ai/queries.ts` has no update function on purpose. **Open:** what is
  the default — a sequence, the date, or something derived from what changed? Worth doing before
  ITER-010, which will want to point at a named thing rather than a timestamp._

- [ ] ITER-008 — Sort the roster by what you are assigning → [scope](.iterate/scopes/ITER-008.md)
  _Raised 2026-08-22 reviewing the `talks-c` walkthrough. Picking somebody for a prayer should let
  you sort the roster by when they last prayed; picking a speaker, by when they last spoke — date
  first, then name, search intact. `talks-c` put the date **on screen** via the picker's new
  `annotations` prop, but the order is still household-then-name, so finding who is overdue means
  reading every row and comparing months in your head. Not prayer-specific: the same control
  belongs on speakers now and on Phase 7 visits and Phase 10 ordinances later, which is why it is
  its own item rather than a `talks-c` addendum. Three things make it real work — the annotation
  carries formatted words rather than a sortable date, `MemberPicker`'s interface is deliberately
  frozen and a sort control is a second raised addition, and "last spoke" is a new query over
  `assignment_history` with no existing equivalent to `listLastPrayed()`. The comparator itself is
  already solved: `compareTopicsByStaleness` does exactly this for topics. **Open:** does sorting
  collapse the household grouping while active?_

- [ ] ITER-007 — `calendar.manage_org_conducting` is unreachable by every role that holds it → [scope](.iterate/scopes/ITER-007.md)
  _Found walking scenario 015 step 13 on 2026-08-22. `org_president` and `org_counselor` hold the
  permission that lets a presidency set who conducts their own meeting, but not `calendar.view` —
  and the only UI exposing it sits behind `calendar.view`. Signing in as `eqpres` shows no Calendar
  nav link and "Not permitted" by direct URL, so the permission is dead in the app. Pre-existing
  since calendar-c; missed because scenario 011 was never walked and the route test calls the
  handler directly, bypassing the page gate. **The real question is narrower than "grant
  calendar.view": is `sundays.notes` bishopric-private?** If yes, the fix is an org-scoped view
  rather than a blanket grant. Three options weighed in the scope._

- [ ] ITER-006 — A rotation change does not apply to already-generated future months → [scope](.iterate/scopes/ITER-006.md)
  _Found during the scenario 015 walkthrough on 2026-08-22. Saving a rotation "effective from
  2027-11-01" leaves an already-generated November 2027 untouched — the form says saved and nothing
  moves. Not the forward-only rule working: that rule protects the PAST, and this is a failure to
  apply to the FUTURE. Pre-existing since calendar-c, but GROUP-01 sharpened it — a Sunday **type**
  change now re-resolves later Sundays behind a confirm dialog, while a **rotation** change still
  does not, and that inconsistency is not defensible to a user. Most of the machinery already
  exists (`seriesFor`, `applyConductingReshift`, the confirm gate); the real work is the larger
  blast radius, since a rotation change can rewrite many months at once and storage IS the
  override. Consider `conducting_source` as part of this rather than deferring it a third time._

- [ ] ITER-001 — Per-organization calendars and cross-organization sharing → [scope](.iterate/scopes/ITER-001.md)
  _**Refined 2026-08-22.** Every role gets a calendar view; role decides what is on it. Adds: the
  bishopric can filter organization layers off; the bishopric owns items too and some are
  bishopric-only (youth lesson planning); quorum Sunday meeting planning is a named consumer of the
  Sunday-shaped item; visit accountability is opt-in by the group and must never reach
  `visit_private_notes`. **Open:** does "only the bishopric sees sacrament meeting plans" mean view
  or manage? The music coordinator plans against the calendar and Phase 6 depends on it._
  _Reason: architectural. Adds a fourth date-bearing model to the schema, a new sharing/audience
  boundary enforced by RLS, and will realistically split into three or four plans of its own._

---

## Deferred
_Items that need testing or further exploration before scoping. Each entry should include enough context to restart the conversation in a future session._

_None._

---

## Completed

- [x] ITER-002 — No conductor on Sundays with no meeting, and skip them in the rotation _(completed 2026-08-22)_
- [x] ITER-003 — Ward conference Sunday type _(completed 2026-08-22)_
- [x] ITER-005 — Ward role-access overrides ignored by 25 of 62 permission checks _(completed 2026-08-22)_

---

## Cancelled

_None._
