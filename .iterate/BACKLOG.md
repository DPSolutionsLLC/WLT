# Backlog

_Last updated: 2026-08-28_

---

## In Progress
Items currently being planned or actively worked.

_None. ITER-019 shipped 2026-08-27; the Phase 6 program plans are done through `program-d`, and `program-e` is BLOCKED on an authoritative hymn source._

---

## Grouped Work
Items in each group belong together and should be planned and worked in a single session.

_None. GROUP-01 (ITER-002 + ITER-003) shipped together on 2026-08-22 as one unified plan, which
is what the grouping asked for._

---

## Standalone Work
Each of these is large or complex enough to tackle on its own.

- [ ] ITER-020 — The youth module needs two views it does not have → [scope](.iterate/scopes/ITER-020.md)
  _Raised by the user 2026-08-28 reviewing the `youth-d` walkthrough. Phase 8 shipped four slices
  and the module's **front door is wrong**: the follow-up feed is a record, not a workspace, and
  the user could not say what it was for. What they want instead is a calendar of events you can
  commit yourself from, and **an overview by young person** ranked so that a youth with an event
  nobody has signed up for floats to the top. **Most of the first view already exists and was never
  shown during the walk** — `/youth/calendar` has the filters, the month grid, the coverage
  ranking, and a strip naming the events nobody is going to. Two real gaps: you cannot attend from
  the calendar (`AttendeeControls` is on `/youth` only, verified in the browser), and nothing lists
  all youth by need. **No schema change expected** — both views are presentation over data that
  already exists, so nothing built in slices A–D is wasted. Settled in conversation and not to be
  re-litigated: "commit to make contact with that youth" needs no new state (one event → one
  profile → one youth already), it is a copy change on the button; and the feed gets demoted, not
  deleted. **Open:** which view is the landing page, and a second more pastoral signal the user's
  sort does not capture — "which young person has quietly had nobody turn up all season"._

- [ ] ITER-021 — "Say how it went" is offered on another organization's event → [scope](.iterate/scopes/ITER-021.md)
  _Found 2026-08-28 walking scenario 056 for `youth-d`. As the Young Men president, `/youth` offers
  the follow-up control on a **Young Women** activity; typing a note and saving is refused with a
  sentence. Nothing is written and migration 057c's INSERT policy holds — but the control should
  never have been offered. **This is `youth-a` defect D1 / `visits-d` a THIRD time**, and both
  `08-youth-activities.md` and the `youth-d` plan quote it by name as "a locked door somebody was
  invited through". The cause is that `EventList` gates on `canLog` (the permission, which never
  says WHICH events) and `isFollowUpWritable()` (the clock), and neither knows the event's
  organization — `youth-d` applied the ownership mirror to the ward-council flag control and not
  to the follow-up control beside it, inside the very slice that quoted the lesson. Fix is a
  `canWriteFollowUpOn()` in `lib/youth/activityOwnership.ts` mirroring the INSERT policy, with the
  `org_id is null` arm kept. `canManageActivityLog` also shipped **untested** and wants covering in
  the same sitting. Scenario 056 already carries the failing checklist line._

- [ ] ITER-022 — The follow-up form communicates by appearance alone → [scope](.iterate/scopes/ITER-022.md)
  _Found 2026-08-28 walking `youth-d`. Three items in one file, one sitting. **(1)** "Did you go?"
  conveys its answer by **colour alone** — confirmed from the DOM, neither button carries
  `aria-pressed`, `aria-checked`, or a role, so a screen reader hears two identical buttons and
  cannot tell which answer is stored. This codebase forbids exactly that in three places
  (`CoverageBadge`, `ReportTile`, `VisitProgressTable` each say "colour is never the only signal")
  and `ReportTile`'s bookmark already uses `aria-pressed` for the same shape of control.
  **(2)** The private-note block wants to be harder to mistake for the shared one — the user's
  verdict was "i don't think so? but it wouldn't hurt to make it more clear somehow though". Keep
  `visits-a`'s emphasis, which correctly puts the caution on the SHARED field; strengthen the
  visual separation only. **(3)** "Waiting on your follow-up" sits third on `/youth`, ~770px down,
  below both activity cards — **overlaps ITER-020**, which may move the page entirely, so do not
  reposition it in isolation._

- [ ] ITER-017 — Token counts are redacted out of every AI audit row → [scope](.iterate/scopes/ITER-017.md)
  _Found 2026-08-24 walking scenario 027 for `ai-d`. Every AI route logs `outputTokens` so spend is
  traceable; the audit log stores the string `"[redacted]"` instead of the number, every time.
  `writeAuditLog`'s sensitive-key filter matches the substring `token` in the FIELD NAME
  `outputTokens` — unlike `\bkey\b`, that alternative has no word boundary. **Failing safe, not
  leaking**, but the one signal these rows exist to carry is silently gone. **Pre-existing and
  wider than the route that found it:** `ai-c`'s topic and message routes log the same field and
  have been redacting it since they shipped, so there is no usable record of AI spend anywhere in
  this app — and nobody noticed because the rows look populated. The over-broad pattern is
  deliberate and must NOT be weakened (it catches `note`, which CLAUDE.md rule 5 depends on); the
  narrow truth is that a token COUNT is not a token. Three options in the scope, leaning
  "never redact a number" since a key or hash is always a string and a count never is. **Open:**
  does usage belong in the audit log at all, or in its own table? That log records who did what;
  cost is a different question._

- [ ] ITER-015 — API routes redirect instead of answering 401 → [scope](.iterate/scopes/ITER-015.md)
  _Found 2026-08-24 probing the deployed app right after the `ai-b` push — a bare `curl` at
  `/api/knowledge/search` returned `307 → /login`, not `401`. `middleware.ts` deliberately refuses
  to redirect API routes ("a 401 the caller can handle" versus "an HTML login page it cannot"), and
  then `requireSessionUser()` does it anyway from inside the handler. **Pre-existing and systemic:**
  from `auth-a`, and **41 route files** call it identically. The visible symptom is a wrong message
  — an expired session makes `fetch` follow the redirect, receive the login page as 200 HTML, pass
  `response.ok`, and fail on `.json()`, so the reader is told to check their network connection.
  The fix is a sibling guard that throws for `respondToRouteError` to turn into a 401, leaving
  `requireSessionUser` redirecting for pages. **No test could have caught it:** route tests use an
  authenticated mocked client and `tests/routes/` contains no 401 assertion at all — the same
  fixture blind spot that hid the plural bug._

- [ ] ITER-016 — Citations the model invented → [scope](.iterate/scopes/ITER-016.md)
  _Found 2026-08-24 walking scenario 024 for `ai-c`. Two of fifteen suggested conference talk
  citations were wrong and confirmed so — a real speaker on a shifted date, and a real speaker on
  a title that is not theirs — while others in the same batch were correct. **That mixture is the
  problem:** an all-wrong batch gets noticed, a mostly-right one teaches the bishopric to trust the
  rest. **Uploading real talks does not fix it on its own,** and the reasons are all in shipped
  code: `CITATION_INSTRUCTION` never says "only cite what you were given", `preferKnowledgeBase`
  renders as *"Prefer talks… over ones you recall"* which is explicit permission to fall back, and
  `suggestedTalks` is free text the route inserts unchecked. CLAUDE.md §9 also keeps the conference
  corpus deliberately thin, so most topics will have no relevant talk in it at all. **Scripture is
  probably already fine** — the standard works are ingested in full; this is about talks. The cheap
  half is a deterministic verification pass against `knowledge_documents` before insert, which is
  also the only thing that makes this a testable property rather than a hope. **Sequence after
  ITER-011**, which adds the speaker and date fields such a pass would match on. **Open:** drop the
  unverifiable ones, or flag them and leave the judgement to a person?_
  _**Unblocked 2026-08-24 (d96b83d).** ITER-011 shipped `speaker`, `speaker_role` and
  `conference_date` on `knowledge_documents`, so the deterministic verification pass now has
  columns to match a citation against._

- [ ] ITER-014 — A global reference library, with a curator → [scope](.iterate/scopes/ITER-014.md)
  _Raised 2026-08-24 reviewing the scenario 022 walkthrough, thinking ahead to more than one ward.
  Standard works and conference talks shared by every ward; ward uploads staying private; a curator
  who promotes ward submissions into the shared library, where they become locked. **The UI is
  post-v1 but one decision is not:** whether `knowledge_documents.ward_id` is nullable. Deciding it
  now costs one migration and no interface; retrofitting it means a data migration plus re-scoping
  every RLS policy on that table, with live ward rows in it. It also breaks CLAUDE.md rule 1
  (`hymns` is currently the sole ward-less table) and needs the first **app-wide** role in a model
  where RLS resolves a ward from `users.ward_id`. **Open:** copyright posture on redistributing
  conference talks to every ward — freely readable is not the same as licensed to redistribute._

- [ ] ITER-013 — Retry the passages that failed to embed → [scope](.iterate/scopes/ITER-013.md)
  _Raised 2026-08-24 from Q2 of the scenario 022 walkthrough. `ai-b` reports a partial embedding
  failure honestly — "6 passages, 5 embedded — 1 not searchable" — and then offers no way to act on
  it; the document stays permanently incomplete with Delete as the only lever. **Cheaper than it
  looks:** the failed chunk's text is already in `document_chunks.content` and only the vector is
  missing, so a retry re-embeds existing rows rather than re-uploading, re-parsing or re-chunking.
  The failure is usually a rate limit, which is exactly what a retry fixes.
  `ingestStandardWorks.ts` has the same gap and shares the pipeline, so both close together.
  **Open:** how a chunk that fails twice is reported, so the control does not become a button that
  always fails._

- [ ] ITER-012 — Show how often a talk has been suggested → [scope](.iterate/scopes/ITER-012.md)
  _Raised 2026-08-23 alongside ITER-011. Last-suggested date, plus "appeared in 8 of your last 20
  generations" once it has come up more than once — a diagnostic that the corpus is too narrow, not
  decoration. Already an idiom here: the topic library orders by staleness and `lastPrayed` does the
  same for prayers, and `talks-c`'s render-nothing-rather-than-"Never" rule applies unchanged.
  **The logging half has now SHIPPED** (ITER-011, d96b83d) — `retrieval_suggestions` is written on
  every retrieval with a `run_id` per call, because suggestion history cannot be backfilled and
  every week without the write is permanently missing from the denominator. History accumulates
  from 2026-08-24. **This scope is the display only**, it is now unblocked, and it can still wait
  indefinitely — but every week it waits is a week of history it will have to show._

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

- [x] ITER-023 — A third hand-maintained copy of the notification trigger keys _(completed 2026-08-28, b2b8aab)_
- [x] ITER-019 — Stewardship: which households are even ours _(completed 2026-08-27, 10197b3)_
- [x] ITER-018 — Visit goals should be a cadence, not a dated period _(completed 2026-08-27, 8f71f90)_
- [x] ITER-004 — Speakers who are not members of the ward _(completed 2026-08-25, be4ea6e)_
- [x] ITER-011 — Choose which conference talks count as reference _(completed 2026-08-24, d96b83d)_
- [x] ITER-002 — No conductor on Sundays with no meeting, and skip them in the rotation _(completed 2026-08-22)_
- [x] ITER-003 — Ward conference Sunday type _(completed 2026-08-22)_
- [x] ITER-005 — Ward role-access overrides ignored by 25 of 62 permission checks _(completed 2026-08-22)_

---

## Cancelled

_None._
