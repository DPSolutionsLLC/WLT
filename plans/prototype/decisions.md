# Prototype Decisions — the durable rules

Harvested 2026-09-20 from the 82 build notes in [build-notes-raw.md](build-notes-raw.md),
which is the verbatim source. This file is the curated layer: the rules that should outlive
the prototype, the places they **conflict** with WLT, and the requirements the prototype
flagged for the real build.

**How to read this.** The prototype is a client-only React app with no database, no auth and
no RLS. When a note says something "is enforced", it means enforced in client state. Every
rule below is repeated here only if it is a **product or architecture decision** that survives
that difference — the build-log half of each note stays in the raw file.

**Status of each section:**

| § | Section | What to do with it |
|---|---|---|
| 1 | Cross-cutting conventions | Adopt. Most already match WLT; the rest are cheap. |
| 2 | **Conflicts with WLT** | **Resolve deliberately before porting anything.** |
| 3 | Refinements WLT should adopt | Small, real improvements found in the port. |
| 4 | Real-build requirements | Direct input to Phases C–F. |
| 5 | The unit/multi-ward plan | Phase C's specification. |
| 6 | Open questions | Not decided. Do not guess. |

---

## 1. Cross-cutting conventions

These are the prototype's own standing rules, each one arrived at more than once. They are
the same species as CLAUDE.md §4's non-negotiables and most of them WLT already follows.

**1.1 Never destroy what somebody wrote.** Unlinking, unassigning, unmarking and deleting a
parent all *orphan* the dependent record rather than cascading. Unassigning a todo deletes it
only if it is untouched (no steps, no log entries); with real progress on it, it is unlinked
and kept. Unmarking a Prayer Focus item deletes it only if nobody has added a private note.
Deleting a calendar event leaves its linked agenda items behind. This is WLT's `youth-h`
`Remove`-gate and `visits-f`'s refusal, reached independently and applied about eight times.

**1.2 Soft-off over hard delete, with a visible timestamp.** A Zoom recipient who opts out is
never deleted; a roster member missing from an import becomes `inactive`, never removed, and a
later import that matches them again surfaces in a **Reactivate** bucket.

**1.3 Refuse, and name the alternative.** Removing a team with any event or follow-up against
it is refused with a sentence pointing at Close — **without disclosing counts or content**.
Saving an empty stewardship is refused because "narrowed to nothing" and "not narrowed" are
the same zero rows. Merging two occasions is refused by not being offered.

**1.4 Confirm, don't silently act.** An app-wide access grant never turns on for an existing
ward: it writes an explicit *off*-override plus a notification carrying a one-tap opt-in. A
role conflict (two active holders of one role) names who and offers "deactivate them and
save". An LCR import that contradicts an app record surfaces it for a human decision.

**1.5 Two clicks to delete, and never `window.confirm`.** One shared `ConfirmDeleteButton`
across all 16 trash-can buttons; the first click arms with a visible label change
("Confirm?"), the second deletes, and arming self-clears after a few seconds. `window.confirm`
is **blocked in sandboxed preview contexts** — this was found the hard way during the tithing
pass. *WLT note:* `2809aef` added exactly such a dialog for youth Remove, and `youth-h`
concluded "a dialog that can be clicked through is not protection". Both are true: the gate
belongs on the server, the two-click affordance belongs on the button.

**1.6 Computed, never stored.** Todo progress is always steps-done/total, never typed.
`isPrayerFocusResolved()` reads the parent agenda item's status live — no shadow flag.
Coverage and follow-up state are pure functions of their inputs. This is WLT's own rule,
reached the same way and for the same reason.

**1.7 One mechanism, not two.** Agenda section sharing is a **link table**, not a copy, so a
shared section is genuinely the same rows seen from two agendas and needs no sync code. Both
routing paths share one `createRoutedItem`. The return-and-report feed is generalized, not
forked. `StewardshipPanel` is generic over `subjects`/`subjectNoun` and used by two modules.
`TalkAskActions` is reused verbatim for prayers. A generalized `GoalForm` serves create and
edit.

**1.8 Conflict checks are soft, never blocking.** Same-space-same-day room conflicts, duplicate
prayer-roll names, and meeting-invite clashes all surface as an informational notice. Nothing
blocks. Deliberately same-day rather than exact-overlap — knowing *something else is happening
that day* is already useful.

**1.9 Group membership is roles, never people.** Message groups and meeting invites hold role
ids, so a calling changing hands needs nothing re-created. **But** a message's `authorName` is
**snapshotted at send time**, never resolved live — old messages keep who actually said them.
The calling label stays on every message as the historical record of which role they were
speaking as.

**1.10 Unauthenticated single-purpose URL tokens for every guest surface.** Established six
times: receipts reconciliation join, Zoom opt-out, Zoom referral, the public program, the
agenda guest view, and the recurring-series public link. Each swaps the **entire app shell**
for one minimal page with no navigation and no access to anything else. *Implementation note
that bit them:* do it as a ternary on the return statement, never an early return, or you skip
hooks.

**1.11 Never fabricate a name for an unfilled role.** `bishopricByRole()` returns each of
Bishop/1st/2nd Counselor independently correct or explicitly null, and the UI reads "Not set".
An invented "Ward Organist" calling was added in one pass and **correctly called out and
reverted** in the next — the real roster says *Accompanist*, which is also the better word.

**1.12 Never invent a restriction that was not specified.** Modules absent from the uploaded
access matrix (Receipts, Ministering, Handbook, Scriptures, Conference Talks, My Appointments,
Ward Calendar's general view) were left **open** rather than gated on a guess. The two
exceptions were both explicit asks.

**1.13 Rename the display, not the identifier.** "Organist" → "Accompanist" changed five
user-facing strings and **zero** internal identifiers (`defaultOrganistFor`, the `organist`
field). Renaming those risked a real bug for zero visible benefit.

**1.14 A default change never rewrites what is already planned.** Changing the ward speaker
count never truncates a Sunday that already has more speakers; past dates freeze at their
current count the moment a default changes. Changing the prayer-roll duration applies to new
entries and renewals only.

**1.15 An explicit finalize, never an inferred one.** "Topics finalized" is a conductor's
deliberate click, **not** derived from every slot happening to have a topic — someone filling
slots while still deciding must not accidentally read as done. Any real edit underneath
auto-unfinalizes via one shared `unfinalizeIfNeeded()`.

**1.16 Two pills, not one conflated status.** Music shows a *completion* pill ("3/5 picked")
beside the *workflow* pill (Draft/Pending/Approved), because "do I have work left" and "where
is this in the process" are different questions — and conflating them let "Approved" show
while two hymns sat empty.

---

## 2. Conflicts with WLT — resolve these deliberately

### 2.1 🔴 THE TIMEZONE RULE IS REVERSED IN THE PROTOTYPE. DO NOT PORT IT.

This is the single most dangerous thing in the prototype and it must be settled before any
date code moves.

The prototype's **tenth youth pass deliberately removed** its ward-timezone machinery:
`WARD_TIMEZONE`, `wardDayParts()` and `wardMidnightUTC()` were deleted, replaced with a plain
`localMidnight(y,m,d)`, and **every `toLocaleDateString`/`toLocaleString`/`toLocaleTimeString`
call dropped its explicit `timeZone` option**. The stated reasoning:

> "for INSTANTS a leader's device already resolves DST correctly with zero extra code… every
> leader's device already IS the ward's zone. So the whole Intl bisection was solving a problem
> that isn't real for this deployment."

**That reasoning is sound for the prototype and wrong for WLT.** The prototype is a pure
client app — there is no server to format a date on. WLT is Next.js with Server Components,
every one of these screens is server-rendered before it hydrates, and **on Vercel the server's
zone is UTC**. CLAUDE.md records what that already cost once: a 7:30pm Friday game served as
*"Sat, Jan 16, 2027, 2:30 AM"* — wrong day, seven hours out, surfacing as React error #418,
invisible in dev because both sides are `America/Denver`, and found only by opening the
deployed build.

WLT's rule stands, and [tests/lib/explicitTimeZone.test.ts](../../tests/lib/explicitTimeZone.test.ts)
mechanically enforces it: **no `Intl.DateTimeFormat` or `toLocale*` call in `app/`,
`components/` or `lib/` may omit an explicit `timeZone`.** A port that copies the prototype's
date code verbatim reintroduces the exact bug that test exists to prevent, and the test will
go red — which is the mechanism working. Do not "fix" it by relaxing the test.

**What to actually take from the prototype's tenth pass:** nothing on the formatting side. The
one durable observation is that the *bisection* (`wardMidnightUTC`) was more machinery than a
day-boundary calculation needs. WLT's `wallClockToInstant` already does that job.

### 2.2 "Single ward, single timezone, correct and final" is now superseded

The same pass recorded, confirmed with the user:

> "this tool is single-ward, single-timezone, with no cross-ward reporting ever, so there is no
> multi-zone feature to build."

That was true of the prototype and is **no longer the direction** — the hierarchy is being
built (Phase C). A hardcoded `America/Denver` cannot serve multiple wards, and
`wards.settings.timezone` already exists in WLT with `lib/ward/wardTimezone.ts` reading it.
Keep WLT's per-ward zone. This conflict is *caused by* §2.1 and disappears once §2.1 is
settled the WLT way.

### 2.3 The access model is shaped differently on each side

| | Prototype | WLT |
|---|---|---|
| Unit of grant | role × module, 3 levels (**F**ull / **R**ead / **Q**uorum) | boolean permissions (`visits.view`, `visits.manage`) + `org_id` scoping |
| Ward override | narrow a default off, or unlock via an approved request | `wards.settings.role_access` add/remove deltas |
| Roles | 33 explicit `(org, calling)` ids | 10 role values × `org_id` × `counselor_position` |

They are largely **inter-expressible** — `F`/`R` map onto `manage`/`view`, `Q` maps onto WLT's
existing org scoping, and 26 of the 33 roles are already reachable (see
[module-map.md](module-map.md) §4). What does **not** map is the request/approve flow and the
super-admin tier. Phase C owns this; do not build a parallel permission model beside
`lib/auth/permissions.ts`.

**Verified in the seed data: `R` is never actually used.** Every grant in all 33 roles is `F` or
`Q` (plus the two corrupted entries). The prototype kept `R` deliberately — "all three real
tiers even though nothing in the seed data uses Read yet, per the explicit call to keep it
available rather than drop unused machinery" — but nothing exercises it, so the read-only tier
is **unproven design, not a settled rule**. WLT's `view`/`manage` split already covers it if it
turns out to be wanted.

### 2.4 Agenda conducting/presiding is hardcoded to the bishopric

Flagged in the prototype's own code at the exact spot that needs to change. Correct today for
both Bishopric and Ward Council agendas; **wrong the moment a quorum agenda exists**, where the
options must derive from whichever org owns the agenda (its President and Counselors,
defaulting to the President). WLT's Phase 9A agendas should take the generic shape from the
start rather than inheriting the hardcode.

### 2.5 The prototype's Visits carries three things WLT's does not

Appointments with **pending invites and accept/decline**, a **schedule/log-contact panel** with
tap-to-call and attempt outcomes (no answer / left a message / couldn't leave one), and
`wardVisitSettings` as a real JSON blob with a **partial-merge setter**. WLT has
`visit_appointments` and `visit_appointment_attendees` tables but no invite-response flow. These
are **new features**, not re-skin — see [module-map.md](module-map.md).

### 2.6 Youth: WLT is ahead, the prototype is ahead in two spots

The prototype's youth module is a faithful port of WLT's and agrees with it almost everywhere —
including the load-bearing branch orders (cancelled before the clock, season-closed before
empty-roster, a written log outranking a later not-taking-part read) and the null-vs-0
discipline. Two genuine divergences, both worth taking:

- **`authorLabel` on a youth feed tile.** WLT deliberately passes `null` because
  `activity_logs` has no participants table. The prototype uses `confirmedAttendance` — a real
  "who went" answer — and explicitly still refuses `loggedBy`. **WLT's data supports this**
  (`activity_attendees.confirmed_attendance` exists), so `lib/reports/types.ts`'s note that a
  youth tile's label is always null can be revisited.
- **Youth stewardships.** The prototype built `youthStewardships` mirroring
  `household_stewardships`, and filters the ranking through `isInScope()` **imported verbatim**
  from the shared module. WLT's `lib/visits/stewardshipScope.ts` was deliberately written
  subject-agnostic for exactly this and it was never wired up. The prototype proves the
  abstraction holds.

---

## 3. Refinements WLT should adopt

Small, concrete, each already proven in the port.

- **`noticeIgnored` on the priority return.** `householdVisitPriority()` in the prototype
  returns `noticeIgnored` alongside the band, so the clamp can be reported **once at goal
  level** rather than recomputed or re-derived per row. WLT computes the clamp and drops it.
- **A deterministic log id.** `log-{eventId}-{userId}` instead of a timestamp, so a private
  note attaches to its log with no save-then-read round trip.
- **Auto-detect tab vs comma in the CSV parser.** One line, and it is most of what "Google
  Sheets support" actually means — pasted spreadsheet cells are always tab-separated. WLT's
  `lib/roster/csv/parseCsv.ts` assumes comma.
- **A paste-rows textarea feeding the same parser.** No export step at all; the easiest way in.
- **Separate `do-date` and `due-date`.** Not one field. (Todo model.)
- **A `revertsCorrection` flag on import review.** If an incoming batch's value exactly matches
  the `oldValue` of a past manual correction, flag it in gold, quote the original note, and
  **do not pre-check it**. This is the "remember this next time" behaviour, built without AI.

---

## 4. Real-build requirements the prototype flagged

Each was explicitly captured as *not buildable in a client-only prototype*. These are direct
input to WLT phases.

**4.1 Concurrency.** Needed once the app is genuinely shared (Ward Council mid-meeting is the
clearest case). **Never block or make one person wait** — no pessimistic locking, because a
lock held by someone who stepped away is exactly the hang being avoided. Simple shared toggles
(section-covered, item status) can be last-write-wins. **Destructive actions must be idempotent
by id** so a double-fire no-ops rather than erroring. Field-level granularity: different people
editing different fields should not conflict at all.

**4.2 Auto-expiry: hide from the active view, never delete** — and the three surfaces need
*different* treatment, not one blanket sweep:
- A **conducting-sheet** item linked to a past event → hide on date. (Built.)
- An **agenda** item linked to a past event → depends on its **discussion status**, not the
  date; a still-pending item silently vanishing buries something nobody resolved. (Deliberately
  not built.)
- The **calendar event itself** → never auto-drops. Past events are the historical record.

**4.3 Tithing auto-clear is a schedule, not a rolling timer.** Usage is always tied to Sunday,
so a Sunday-night job that clears the week's entries fits the real pattern better than 24 hours
from last touch. *WLT note:* this is a **different rule** from CLAUDE.md §4.11's "48 hours
elapsed on a `timestamptz`, never a local midnight". Both cannot hold. Settle it before
touching the tithing worksheet; the WLT rule was written against a real defect.

**4.4 LCR import must cross-check access control.** A calling changing in a fresh extraction
means someone's app role may be stale. Surface for a human decision — never auto-change access
in either direction.

**4.5 Real auth.** Email + role invite, confirmation email, user sets their own password before
first login. *WLT already has this* (`auth-b`), which is one of the clearest cases of the
codebase being ahead of the prototype.

**4.6 Minimum-two-super-admin.** Never allow the last active super admin to be deactivated or
removed. And assigning super admin deserves **more friction** than an ordinary role, since it
bypasses the entire access matrix.

**4.7 Person identity that survives a ward transfer.** So a new ward can see "spoke 3 times in
the last 4 months at their old ward". Needs real MRNs; explicitly impossible in a single-ward
model.

**4.8 Ward-member prayer-roll submissions need a hand-entered name.** Leadership attribution
works because the app knows the active role. A ward member submitting a name has no account, so
`submittedByRole` has nothing to derive from. A genuinely distinct mechanism, not an extension.

**4.9 Real LCR/database integration, if it ever comes.** Pilot on manual data now; if
integration lands, existing wards get real unit + stake ids, real data is pulled and checked
**name-matched first but with mandatory person-by-person review**, never blind auto-merge.
Nothing already entered is lost. The real difficulty is **not** name matching — it is that
every module references a person by an app-generated id, so reconciliation means **re-pointing
every one of those references**. A review needs **three** outcomes per person, not two:
confident match, no match in real data, and someone in the real roster with no app record at
all.

---

## 5. The unit / multi-ward plan — Phase C's specification

Held as a plan in the prototype and never implemented. Reproduced here because Phase C builds
it. Full text in [build-notes-raw.md](build-notes-raw.md) § `multi-ward-plan`.

**Three layers.** (1) Super Admin manages the units themselves and users across all of them —
ward-agnostic, the one role that spans everything. (2) A specific ward — everything built so
far, scoped to one ward rather than assumed to be the only one. (3) The switch between them: a
ward selector above the role selector, for Super Admin specifically. **Anyone who belongs to one
ward never sees the ward layer at all**, the same logic already applied to roles.

**Model a generic `unit`, not two fixed levels.** A `type` (area / stake / ward — real church
structure also has missions and districts as the stake-equivalent), a `parent` reference, and a
**real church-assigned unit number**, not an app-invented id. Multi-stake is a real possibility
and areas/districts above that are uncertain — which is *itself* the reason to design
generically now. **Do not build area- or district-level admin screens**; only the data shape
anticipates them.

**The role assignment carries the ward, not the role.** Roles stay reusable templates, never
duplicated per ward. A users entry says "this person holds this role *in this specific ward*",
which is also what lets someone hold different callings in different wards. *WLT note:*
`users.ward_id` + `users.role` already has this shape; what it lacks is more than one row per
person.

**Roster import stays ward-level, owned by the ward** — not something Super Admin manages
centrally. And explicitly temporary: treat **"get the current roster for this ward" as a
boundary the rest of the app consumes**, never caring whether the answer came from a CSV or a
live API, so real integration later replaces what is behind one boundary rather than something
scattered through every module.

**What the plan does not cover:** real auth, area/district UI, the LCR integration itself, and
any screens for creating or switching wards.

---

## 6. Open questions — do not guess

- **Quick-links persistence:** per-user or per-device? Never settled.
- **Message group renaming:** the user was actively deciding and had not landed. A two-tier
  personal-nickname version was built; whether the canonical name is renameable is open.
- **A conducting script is a richer object than the line-item model.** Reading a real Church
  conducting script revealed spoken lines with blanks ("Our opening hymn is number ___"),
  procedural director's notes, and conditional sections — none of which a label-or-value line
  item represents. **A real design fork** (does a line stay a plain value, or become scripted
  text with a blank the value fills?) that was deliberately not decided.
- **Ministering Sandbox vs Visits** — the Visits tile blurb says "Ministering & check-ins" while
  the sandbox plans assignments. Confirmed separate (the formal ministering program is not a
  quorum's own visit goal), but the naming still collides.
- **Known unfixed:** the message thread's scroll-direction header reveal still stutters on a
  fast scroll after two fix attempts. Deferred deliberately. Re-verify in the real environment
  before assuming it is fine; a transform-based slide rather than `max-height` is the likely
  clean rebuild.
