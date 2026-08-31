# Backlog

_Last updated: 2026-08-30_

---

## In Progress
Items currently being planned or actively worked.

**Planned together as one scope, 2026-08-30** — Close and Remove are the same button.
ITER-028 ships the control; ITER-031 is what that control makes safe. One plan:
[plans/youth-h-season-close-and-safe-remove.md](plans/youth-h-season-close-and-safe-remove.md).

- [ ] ITER-028 — Closing out a season, and the history that outlives it → [scope](.iterate/scopes/ITER-028.md) | [plan](plans/youth-h-season-close-and-safe-remove.md)
  _Raised by the user 2026-08-29 reviewing the scenario 057 walk: "we need to be able to close out a
  season so the stats do not show anymore… it would still be very nice to be able to look at their
  history." **`youth-f`'s support percentage never forgets** — a basketball season that finished in
  February still ranks Ethan in October, and a ward two years in is ranking its youth on games
  nobody remembers. Three separable pieces: a `closed_at` on `youth_activity_profiles` (nullable, so
  a mistake is reopenable, and a **timestamp not a boolean** because the history page asks when);
  `/youth` reading running profiles only; a "see their history" link per card. A ward-wide historical
  overview is listed last and may be cut — nobody has said what question it answers yet.
  **This REVERSES CLAUDE.md §9's "no season boundary is introduced"**, whose test was "wait until a
  ward reuses a profile across years" — superseded by a direct request, which is a better reason
  than the one it was waiting for. Record the reversal rather than quietly contradicting it.
  **The one real design question** is whether a closed season's number is stored at close or
  recomputed with `closed_at` as the clock; recomputing keeps "nothing in this project refreshes
  anything" intact and is almost certainly right. **The trap:** a young person whose every season is
  closed must not vanish from the ward or read as somebody with no activities.
  **Blocks on nothing** — independent of ITER-024 → ITER-027. **Read with ITER-030 and ITER-031**
  (both added 2026-08-30): ITER-030 removes events from the same number by a different route, and
  ITER-031's destructive "Remove" may only need to become this item's "Close"._

- [ ] ITER-031 — Removing an activity destroys a cascade nobody was warned about → [scope](.iterate/scopes/ITER-031.md) | [plan](plans/youth-h-season-close-and-safe-remove.md)
  _Found 2026-08-30 walking scenario 050 (`050-D1`) — not a checklist line, the walk found it.
  `ActivityProfileList.tsx:317` is a bare `onClick={() => deleteMutation.mutate(profile.id)}`: no
  confirm, no undo, red danger button, fires on one click. Migration 009 cascades
  `youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
  activity_private_notes}`, so that click destroys a season of games, every sign-up, every pastoral
  follow-up **and the private notes rule 5 calls private forever**. Fired twice during the walk
  (3 → 2 events, then 3 → 0), and the audit row records `orgId`/`memberId`/`profileId` only — so
  nothing anywhere says what was lost. The codebase already has the missing pattern: twelve
  `window.confirm` sites, and `DocumentList.tsx:133` states the house rule ("Worded by CONSEQUENCE,
  not by action… naming the passage count and saying what is NOT affected") for the structurally
  identical case. **The user's rule is stronger than a confirm and is the substantial part: REFUSE
  the delete once anybody has written a follow-up**, with a sentence naming the alternative —
  `visits-f`'s empty-bulk-replace precedent. The check runs server-side against a count the reader
  is not shown, because `activity_logs` reads are org-scoped (057c). **Also a clarity defect, and
  the confusion is the finding:** the user could not tell whether Remove takes the event from the
  individual or globally. It is per-individual — `profile_id` is a single FK, and a `youth-g`
  occasion links rows without joining them — but the button gives the reader no way to know, and
  both readings are available from the same word. **Read with ITER-028:** if closing a season ships
  first, Remove may only need to become Close, and the destructive path narrows to "created by

---

## Grouped Work
Items in each group belong together and should be planned and worked in a single session.

_None. GROUP-01 (ITER-002 + ITER-003) shipped together on 2026-08-22 as one unified plan, which
is what the grouping asked for._

---

## Standalone Work
Each of these is large or complex enough to tackle on its own.

- [ ] ITER-030 — Nobody could have gone: recording that the young person missed it → [scope](.iterate/scopes/ITER-030.md)
  _Raised by the user 2026-08-30 reviewing the scenario 050 re-walk: "we probably should add an
  option to report that a youth did not go to a particular event… in that case, the event is removed
  from that youths statistics all together. shouldn't be counted as attented or missed."
  **A gap, not a new idea.** `youth-f`'s support percentage already excludes three kinds of event
  from the denominator — `away`, `cancelled`, and `tbd` — and all three are the same sentence: this
  game could not have been a chance to support them. "The young person was not there" belongs in
  that list and is missing from it, so a youth who misses six games with a broken ankle is measured
  all winter on games nobody could have attended them at. That is CLAUDE.md §9's own `visits-f`
  argument ("0% would put the one person nobody could possibly have supported at the top") arriving
  by a slower route. **The insertion point is one function** — `carriesCoverageExpectation()` in
  `lib/youth/profileNeed.ts`, whose header says a second copy is what would let somebody retune one
  of them — plus a check of `lib/youth/coverage.ts` in the same change. **A STORED column is right
  here**, and `cancelled` is the precedent by name: a fact a person knows and nothing else can
  express, so none of the computed-on-read reasoning applies against it. **The design question to
  settle first:** not a fourth `status` value — a missed game still happened, and other youth may
  have been at it — but a separate nullable column, three states, null meaning nobody has said.
  **Do not infer it** from an empty attendee list or anything else (`classifyLocation.ts`'s refusal,
  third sighting). Read alongside ITER-028, which removes events from the same number by a different
  route._


- [ ] ITER-025 — Should being there earn the right to comment? → [scope](.iterate/scopes/ITER-025.md)
  _Raised by the user 2026-08-29: "anyone should be able to click on the event and add their comment
  after they confirm that they were present." **A policy decision, not a bug** — ITER-021 was right
  to make the screen match the database; the question is whether the database rule should change.
  Two things were verified and are NOT the problem: several leaders can already commit to one event,
  and `activity_logs_one_per_author unique (event_id, logged_by)` already gives each of them their
  own follow-up. The only obstacle is the organization gate. Against changing it: migration 057c's
  reasoning that writing is where coordination becomes misrepresentation, and that attendance is
  **self-asserted**, so "anyone who says they were there may write" is "anyone may write" reached in
  two steps. **Sequence after ITER-024** — if an occasion can hold rows from two organizations, the
  young person a leader wants to write about may simply be a row their own organization owns, and
  the problem partly dissolves without widening anything. **DONE 2026-08-29:** `youth-g` shipped
  cross-organization occasions and an RLS test asserts one, so that dissolution is now true and
  testable — and no policy was widened to get it. Private notes do not move either way._

- [ ] ITER-026 — A leader's own page: what I committed to, what I owe → [scope](.iterate/scopes/ITER-026.md)
  _Raised by the user 2026-08-29. Every youth screen is organised around the youth or the event;
  nothing is organised around the leader reading it. `FollowUpPanel` is **half of this already** —
  it names what is waiting rather than counting it, and since ITER-021 counts only what that reader
  can act on — but it holds nothing about the FUTURE, which is the half that changes behaviour, and
  it lives below the activity list on `/youth`. **ITER-022 item 3 folds into this** and should be
  closed by it rather than worked separately; it was parked precisely because the page might move.
  **Open:** youth-only page or a personal dashboard, given `/dashboard` exists and visits raise the
  same need. If both this and `/youth` render the waiting list, both must read ONE computation._

- [ ] ITER-027 — Who else is in that gym → [scope](.iterate/scopes/ITER-027.md) — **UNBLOCKED 2026-08-29** by Phase 8 slice `youth-g`
  _Raised by the user 2026-08-29, and the most human idea in the batch. Two halves. **Before:** you
  committed to see Ethan on Friday; three other ward youth are at the same game, so tell you, to
  "help them feel seen and loved". **After:** you were there, you may well have spoken to them —
  offer to record it rather than lose it. Both need "which other young people share this occasion",
  which is exactly what ITER-024 decided — and slice `youth-g` shipped it, so the input now exists:
  `activity_events.occasion_id`, and `app/(app)/youth/events/[id]/` already composing the list.
  **It was deliberately NOT built there**; both halves are their own scope. **Two things
  to hold on to now that it is unblocked:** the "after" half must OFFER and never write on its own (a
  recorded pastoral contact that did not happen is rule 3 broken), and it must read as a prompt
  rather than a checklist of people you failed to greet — the module exists so a young person is
  seen, not so a leader is measured. The "before" half fires from the clock, which would make
  **seven** clock-driven things deferred to Phase 11; computing it on read avoids an eighth._

- [ ] ITER-029 — Browsing the activity list for your own → [scope](.iterate/scopes/ITER-029.md)
  _Raised by the user 2026-08-29 reviewing the scenario 049 walk: the ownership label "makes it
  obvious", but the list "could be more easily browsed for your own if the labels were colour
  coded", plus "maybe a filter to show only your own organization's youth". **Not a defect** — the
  page answers the question it was walked for; this is about browsing forty rows instead of four.
  **The colour half is NOT the small change it looks like.** `ORGANIZATION_TYPE_TONES` already
  exists and already colours the visits feed, but it shares the seven `CONTEXT_TONES` with
  `ACTIVITY_TYPE_TONES`, which is ALREADY on every card: `sport` and `young_men` are both **teal**,
  so *Varsity basketball* would carry two teal chips meaning different things. That map's own
  comment ("two contexts sharing a hue is a smaller cost than a seventh hue") was written assuming
  one tone map per card, and this would be the first screen rendering two. The cheapest option that
  answers the actual ask is to mark only the rows you own rather than colour all seven.
  **The filter half is cheap and has a shipped precedent** — `ReportFeed`'s organization filter with
  `allContextsLabel` — and `ActivityProfileList` has no search or filter at all today. Its one trap
  is the module-wide one: a ward-wide activity belongs to no organization and `ward_council_member`
  has none, so "only my organization" resolves to empty for the widest role in the app. Reading off
  `canManageActivityProfile()` instead — a filter labelled **"Only what I can change"** — is correct
  by construction for every account, and is probably the whole item._

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

- [ ] ITER-032 — The date input still reads the reader's clock → [scope](.iterate/scopes/ITER-032.md)
  _Found 2026-08-30 walking scenario 050 (`050-D2`), and **deferred by the user the same day, on a
  correct reading**: "another ward in another timezone is not going to be even interacting with a
  ward's data." `c24d52b` moved the DISPLAY half of a turn-up-at time to the ward's zone and left
  the INPUT half in the reader's. With the ward on `Pacific/Honolulu` and the browser on
  `America/Denver` the card read `Fri, Jan 15, 2027, 4:30 PM` while the edit field prefilled
  `19:30`; on the create path a leader typed 19:30 and the card came back 4:30 PM — the hour on the
  card is not the hour they typed. Cause: `lib/youth/eventInstant.ts` resolves the zone from ambient
  process state (`new Date()` + `getTimezoneOffset()`) and takes no zone parameter, which was
  correct under the rule `c24d52b` reversed. **A save left untouched is idempotent** (byte-identical
  across three writes, since prefill and submit share the same wrong zone), so it is a
  wrong-number-on-screen bug, not drift. **Unreachable today:** every ward is `America/Denver`,
  `FALLBACK_WARD_TIMEZONE` is `America/Denver`, and there is no UI to change it. **What makes it
  live — and both are on the roadmap:** a Phase 11 admin screen for `wards.settings.timezone`, or
  Phase 12 multi-ward. Whoever builds either must fix this in the same change or ship a control that
  makes another screen wrong. **Do not confuse this with the rule it came from** — `c24d52b` fixed a
  bug about the SERVER having no zone (Vercel is UTC; production served this ward's own 7:30pm game
  as 2:30 AM), which is not reopened. **One piece worth doing sooner and independently:**
  `tests/lib/explicitTimeZone.test.ts` matches `Intl.DateTimeFormat` and `.toLocale*` but not
  `getTimezoneOffset`, so it guards only the read half of the round trip; widening it is cheap and
  is the only thing that stops a third instance._

---

## Completed

- [x] ITER-024 — One event, one youth, or one occasion, many youth? _(completed 2026-08-29, 43a10c9 — Option A′: an explicit stored occasion, identity only, plus `/youth/events/[id]`. **Completes ITER-020's parked event-detail half**, unblocks ITER-027, answers ITER-025's sequencing question)_
- [x] ITER-020 — The youth module needs two views it does not have _(completed 2026-08-29, 5cb14a2 — the UNBLOCKED half; the **event-detail view shipped separately in ITER-024**, 43a10c9)_
- [x] ITER-021 — "Say how it went" is offered on another organization's event _(completed 2026-08-29, 17032a9)_
- [x] ITER-022 — The follow-up form communicates by appearance alone _(completed 2026-08-29, 17032a9 — items 1 and 2; **item 3 moved to ITER-026**, not built)_
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
