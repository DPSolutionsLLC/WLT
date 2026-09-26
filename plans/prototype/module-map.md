# Module Map — prototype ↔ WLT

Built 2026-09-20 from the prototype's 23 dashboard tiles and its sub-pages, against WLT's
shipped routes.

**This file is the gate.** Nothing gets built until its module has a row here, because the
single largest risk in this effort is a "re-skin" quietly becoming a feature build.

> ⚠️ **READ §6 (NAVIGATION SHAPE) TOO, NOT ONLY YOUR MODULE'S ROW.** §1 and §2 answer *what a
> module does*. Until 2026-09-23 nothing here answered *how it is worked* — and a row can be
> complete and correct about the feature while the screen still gets built with the wrong
> interaction. That is not hypothetical: `/music` shipped as a flat list of expanded cards with
> month navigation, where the prototype opens it as a **collapsed list of dates you click into**.
> Every behaviour in §2.2 was honoured. The navigation was not in this file at all. The
prototype's Visits page carries appointment invites with accept/decline that WLT has no route
for; its Agendas page carries section sharing, routing rules and meeting instances that WLT's
Phase 9A does not. Re-skinning either one without naming that first produces an estimate that
means nothing.

**Verdicts:**

| Verdict | Meaning |
|---|---|
| **RESKIN** | Same feature, different clothes. Routes, RLS and tests stay. |
| **RESKIN+** | Re-skin **plus** named new behaviours. The behaviours are listed and each is its own slice. |
| **NEW** | No WLT counterpart. A new phase. |
| **STUB** | A tile in the prototype that was never built. Nothing to take. |
| **CONFLICT** | Overlaps a WLT v1 scope guardrail. Needs a decision, not a build. |

---

## 1. The map

### Meetings & Programs

| Prototype | WLT counterpart | Verdict | Notes |
|---|---|---|---|
| Sacrament | `/sacrament` hub over `/assignments`, `/prayers`, `/music`, `/program` | **RESKIN+** | 8 new behaviours — §2.1 |
| Music | `/music` | **RESKIN+** | 4 new behaviours — §2.2. **Navigation — §6.2** |
| Conducting + Conducting Template | — | **NEW** | The run-of-show sheet — §2.3 |
| Program + Program Template | `/program`, `/public/[slug]` | **RESKIN+** | 3 new behaviours — §2.4. **Navigation — §6.2** |
| Agendas (Ward Council, Bishopric) | `/agendas` *(Phase 9A, uncommitted)* | **RESKIN+** | 10 new behaviours — §2.5 |
| Ward Calendar | `/calendar` is a **different thing** | **NEW** | §2.6 — the name collides, the feature does not |

### People & Care

| Prototype | WLT counterpart | Verdict | Notes |
|---|---|---|---|
| Prayer Roll | — | **NEW** | Three tiers, expiry, attribution — §2.7 |
| Prayer Items (Prayer Focus) | — | **NEW** | Council-scoped, tied to agenda item status |
| Youth Support | `/youth` + 6 sub-routes | **RESKIN** | WLT is ahead; 2 small adoptions — §2.8 |
| Visits | `/visits` + 2 sub-routes | **RESKIN+** | 3 new behaviours — §2.9 |
| Callings (sandbox) | — | **NEW** | Scenario engine with branching |
| Ministering Sandbox | — | **NEW** | Compiles a graph from LCR free-text |
| Calling Requests | — | **NEW** | Fill/release pipeline |

### Tasks & Communication

| Prototype | WLT counterpart | Verdict | Notes |
|---|---|---|---|
| To Do | — | **NEW** | The spine several other modules hang off — §2.10 |
| My Appointments | — | **NEW** | Aggregates visits + todos + youth, role-scoped |
| Orphaned Actions | — | **STUB** | Tile only, never built |
| Message | — | **CONFLICT** | In-app messaging is on WLT's v1 out-of-scope list |
| Zoom | — | **CONFLICT** | Needs real infra; also out of v1 scope |

### Finance & Admin

| Prototype | WLT counterpart | Verdict | Notes |
|---|---|---|---|
| Receipts | — | **NEW** | Submit → enter → reconcile |
| Reports | — | **STUB** | Tile only, never built |
| Tithing Calc | `/tithing` | **RESKIN** | ⚠️ keeps its own navy/gold palette — §2.11 |
| Admin → Access Control | `/admin`, `/admin/users` | **RESKIN+** | The request/approve flow is new — §2.12 |
| Admin → Sources → Ward List | `/roster/import` | **RESKIN+** | Corrections log + revert detection — §2.13 |
| Admin → Sources → Speaking History | — | **NEW** | Bulk backfill, CSV/TSV/XLSX/paste |
| Admin → Sources → Scriptures | `/knowledge` | **RESKIN** | WLT is far ahead (pgvector) |
| Admin → Sources → Conference Talks | `/knowledge` | **RESKIN** | WLT is far ahead |
| Hymn Database | `hymns` table + `/music` | **RESKIN** | WLT seeds hymns already |
| Handbook | `/knowledge` | **RESKIN** | WLT has real retrieval; prototype has a chat shell |
| Super Admin → Stakes & Wards | — | **NEW** | Phase C |
| Account | — | **NEW** | Photo + email; password is a deliberate shell |

---

## 2. Per-module detail

Each numbered item below is a candidate slice. "New" means no WLT route, table or logic exists.

### 2.1 Sacrament — RESKIN+ (8 new)

> **Corrected 2026-09-22 while planning `p4-sacrament-a`, all three verified against the code.**
>
> **(a) It was nine; it is eight.** Behaviour 9 — conducting rotation with weekly *and* monthly
> cadence and separate anchor shapes — **is already built**.
> `supabase/migrations/024_rotation_cadence.sql` Part 1 adds `conducting_rotation.cadence text not
> null default 'weekly' check (cadence in ('weekly', 'monthly'))`, and its header explains the
> anchor difference in the same terms the prototype does. Shipped in `calendar-c-rotation-cadence`.
> It is struck through below rather than deleted, so the count cannot quietly drift back.
>
> **(b) `/talks/topics` IS NOT A PER-SUNDAY SUB-VIEW and has been removed from the counterpart
> column.** The row used to list it beside `/assignments` and `/prayers` as though the three were
> peers. They are not: `/talks/topics` is the ward-level TOPIC LIBRARY, and a slot's topic is
> chosen *on the assignment*, *from* that library. The prototype has **no topic library at all** —
> its topic field offers prefix-matched hints from past entries
> (`build-notes-raw.md` §`sacrament`). So it is a WLT-only supporting surface the hub **links to**
> and does not absorb. Re-skinning it is in scope; folding it into a Sunday card is not. Its page
> heading now reads *"Topic library"* for exactly this reason.
>
> **(c) THE PROTOTYPE'S "Topics" PILL MAPS TO `/assignments/[sunday_id]`, NOT TO
> `/talks/topics`.** In the prototype, *Topics* is the per-date editor holding the speaker-count
> stepper, the day-category selector and every talk slot — which is the page WLT already has.
> **This is the single most likely thing for an executing agent to get backwards**, because the
> two names are one word apart.
>
> **Built so far:** the hub itself (`p4-sacrament-a`, 2026-09-22) — `/sacrament`, a month of
> Sundays each carrying a pill row, every pill deep-linking to the module that owns it for that
> date. No new behaviour from the list below; those are slices `b`–`g`.
>
> **Slice `c` — References over pgvector (2026-09-23), migration 079.** Behaviour 1 in full, and
> behaviour 2's References link: a `Refs` pill directly after Topics opens a modal on the hub (the
> prototype's own navigation), one section per talk with a topic, semantic search through
> `retrieveChunks` under the ward's saved conference scope, manual entry beside it, and three
> recorded states — open, finalized, **skipped** — in two timestamp columns on `sundays`.
> References attach to the talk (`assignments` row), never a slot. **Two user decisions:** the
> editor is a modal on `/sacrament`, and a topic change un-finalizes References while leaving a
> skip standing. **One deliberate deviation:** adding a reference clears a skip, where the
> prototype leaves `Refs: skipped` over references that exist. Slice `f` reads
> `referencesDecisionOf(sunday) !== null` as its gate and `listReferencesForAssignments` for the
> to-do; nothing reads either yet.
>
> **Slice `f1` — Send asks, the answer on the to-do, the four-state Talks check (2026-09-24),
> migration 083.** Behaviours **3, 4, 5 and 6** are built, with four **deliberate departures**
> settled with the user (plans/sacrament-talk-asks-conductor-and-assistant.md, U1–U9):
> the asks go to the Sunday's **conducting** leader rather than to whoever finalized; an answered
> ask is **marked done, never deleted**; **visiting speakers are asked too**, marked "Not on the
> roster — no contact on file" (their answer is on the talk but not in speaker history, which holds
> members only); and "finalize Talks" became **Send asks**, which sends only the speakers not yet
> asked, while **a speaker change closes the old ask**. `declineHistory` (behaviour 5) is not a
> second array: `assignment_history` already held declines as their own rows, and it gained a
> `decline_reason` plus a "Talk" label on every row. The pill's four states come from the talks'
> outcomes and open asks, never from the pipeline stage. The 9-stage pipeline stays beside it (U5).
> **Still to come in slice `f`:** `f2` (the asks follow the conductor on a handover or a rotation
> re-shift) and `f3` (an assistant holding a mirrored copy of every open ask).
>
> **Reworked the same day after walking scenario 074 (user decisions):** references are
> **bishopric-only** — the pill is absent for everybody else and migration 080 narrows the read;
> **skipping is refused while references exist**; the modal shows only the chosen references, with
> **Search** and **Add manually** buttons on each talk's title row opening their own windows (search
> runs the topic on open, words editable, pick several at once); the topic's
> `suggested_scriptures` appear as one-tap picks in the search window; manual entry is **Scripture
> or General conference talk** only; Remove is a small icon. A **Search any topic** button above
> the talks opens the same window empty, with an "Add to" talk picker. The shared `Modal` now
> **fits its content** (a bottom sheet on phones) — every modal in the app changed with it. **Raised and NOT built:** the user
> wants scriptures and conference talks loaded once by an admin and shared by every ward — a
> change to rule 1 and to the per-ward corpus, needing its own plan.

1. **References pill + modal** — ranked keyword search over the conference-talk corpus and
   scripture volumes, with manual entry alongside. *WLT has real retrieval already* (pgvector,
   `retrieveChunks`), so this is a UI for something WLT can do better.
2. **A finalize chain with real gates** — Topics → References (finalized *or explicitly
   skipped*) → Talks → Prayers. `skipped` is a distinct recorded state, not an empty list.
3. **Finalize generates real to-dos**, one per roster-matched speaker, carrying phone, email,
   topic, date and the finalized references.
4. **Accept/decline happens on the to-do itself**, never elsewhere. Decline requires a reason
   type; free text is available for either reason.
5. **`declineHistory`** as its own array — a decline is not a talk that happened — surfaced in
   the person-history modal with a role label so "declines talks but accepts prayers" is
   visible.
6. **Four-state calendar pills** (dimmed-disabled → pending → accepted → declined).
7. **Extra musical numbers positioned relative to specific talks** (`afterTalkIndex`), defined
   from Topics, filled from Music.
8. **Day categories** — a growable ward-wide list, per-day with per-slot override, driving
   which roster list the speaker picker shows.
9. ~~**Conducting rotation** with weekly **and monthly** cadence and separate anchor shapes.~~
   **ALREADY BUILT — migration 024, `calendar-c-rotation-cadence`.** Not a new behaviour and not
   part of any P4 slice. See correction (a) above.

*Also:* household rotation with an anomaly badge and a defer snooze — WLT has speaker history
but not this rotation view.

### 2.2 Music — RESKIN+ (4 new)
1. **Draft → submit → approve workflow**, invisible to other modules until approved.
2. **A completion gate** — one shared `musicCompletionFor()` used by both the submit button and
   the list pill so they cannot disagree. Counts 3 hymns + chorister + accompanist + every
   extra slot.
3. **Auto-reopen** — adding an extra musical number reverts an approved submission to draft
   with a visible banner and a stored reason.
4. **Roster-derived defaults** — chorister and accompanist matched from real calling text.

### 2.3 Conducting Sheet — NEW
The run-of-show. Sections *and* standalone rows (invocation, benediction and each speaker are
individually placeable anywhere in the sequence — a box you can only reorder *within* cannot
represent a real meeting). Reflow text sizing in four steps via a root font-size driving rem
wrapping, **never a zoom transform**. Read-only in the meeting, deliberately — check-off is a
separate post-meeting flow. A post-meeting confirmation fires once the computed end time passes.
Template management is week-independent. **See [decisions.md](decisions.md) §6** — a real Church
conducting script is a richer object than this line-item model and that fork is undecided.

### 2.4 Program — RESKIN+ (3 new)
1. **Its own template**, deliberately separate from the Conducting Sheet's.
2. **A contacts list** (role/name/phone) as real editable data, not template line items.
3. **`?viewProgram=latest`** — one stable link always resolving to the most recently finalized
   program. *WLT's `/public/[slug]` is per-program; this is a different promise.*

### 2.5 Agendas — RESKIN+ (10 new)
WLT's Phase 9A (uncommitted) has the template, flagged items, carry-forward, builder, PDF and
publish. The prototype has a substantially larger module:
1. **Section sharing as a link table** — the same rows seen from two agendas, so `shared_write`
   is a live canvas with no sync code.
2. **Reserved sections** + a **generic routing** mechanic (always lands in Reserved).
3. **The bishopric → ward council shortcut** — the one direct-placement path, a snapshot that
   *radiates* (the source item stays put) carrying an `originLink` back.
4. **Auto-route rules**, configured only by the *receiving* side.
5. **Meeting instances + an event log** (`item_created`, `item_resolved`, `item_assigned`,
   `item_routed`, `section_shared`) — the ground a future "since last time" summary stands on.
6. **Check-in**, self and on-behalf, scoped to expected attendees.
7. **Delegate-to-absent-leader** — assigning someone not checked in auto-annotates their todo.
8. **A section-level checklist** independent of item status, plus **Finalize Meeting** as a
   signal (not a save) that names what was not covered and lets you proceed anyway.
9. **A Prayer Roll section** reading live from `agendaDestinations`, and a
   **Conducting & Presiding** section.
10. **A guest link** (`?viewAgenda=<id>`) that never shows the Prayer Roll. Plus **undo/redo**
    across both agendas on one shared stack.

### 2.6 Ward Calendar — NEW (the name collides, the feature does not)
WLT's `/calendar` is the **Sunday/sacrament calendar** with conducting rotation. The
prototype's is a **full ward event calendar**: month/week/day, creator-owns-edit with
notes-only for everyone else, a separate narrower marking authority for secretary/admin,
multi-org tagging (cross-posting, not duplication), **space reservation with soft same-day
conflict checks**, a `cancelsSacrament` flag that makes Sacrament's own calendar cell say "No
sacrament meeting", **recurring series with `patternHistory`** (each version effective-from, so
a past date keeps resolving against what was true then, and a change can be entered weeks
ahead), a **stable public series link**, and a read-only youth-activity overlay colored
home/away. Naming needs settling before either moves.

### 2.7 Prayer Roll — NEW
Three tiers (`stewardship` / `quiet` / `one_time`) each with its own expiry rule. Hard delete on
expiry with **no history**, but **private notes persist independently** so they resurface if the
person cycles back. Lightweight person records for free-text names, matched case-insensitively.
Whole-household add produces **one** entry labelled "[Lastname] Household", not one per member.
Attribution is hardwired for named tiers and a **choice (default anonymous)** for quiet. Quiet
names render lighter and drop into their own scrollable subsection on the agenda — acknowledged
as a group, not read one by one. Entries auto-tag to every agenda on creation. **A real Wake
Lock API toggle** — genuinely native, no backend.

### 2.8 Youth Support — RESKIN
The closest agreement of any module: a faithful port of WLT's own logic including the
load-bearing branch orders. Two adoptions, detailed in [decisions.md](decisions.md) §2.6:
- `authorLabel` from `confirmedAttendance` rather than `null`
- `youthStewardships` wired through `isInScope()`
Plus a **By-Youth roster view** (pick a person, see and edit everything they're connected to —
the opposite direction from the team view) and a **flagged filter with a live count on the tab
label**. ⚠️ **Do not port the prototype's date handling** — [decisions.md](decisions.md) §2.1.

### 2.9 Visits — RESKIN+ (3 new)
1. **Appointments with pending invites and accept/decline** — scheduling auto-confirms the
   scheduler and creates a real pending invite for a companion, never silently adding anyone.
2. **A schedule/log-contact panel** — tap-to-call from the real phone number, branching into
   logging an attempt (no answer / left a message / couldn't leave one) or scheduling.
3. **`wardVisitSettings` as a JSON blob with a partial-merge setter**, exercised correctly while
   it still holds one key.

### 2.10 To Do — NEW
Build this **early** — Sacrament's accept/decline, Agendas' delegation, My Appointments and the
Zoom referral flow all hang off it. Separate do-date and due-date. Steps with **computed**
progress (zero steps behaves as a plain item; the first step implicitly makes it a project, no
mode switch). One combined log timeline — automatic step lines interleaved with written notes by
time. **Two-key completion with agendas**: the agenda item is removed immediately either way,
but a linked todo is *flagged* rather than deleted, and the reverse direction only flags when a
link exists.

> **BUILT — P5, 2026-09-24.** Slice p5-a (the list, steps with computed progress, the one
> timeline), p5-b (the agenda link and two-key completion, migration 082) and p5-c ("Schedule
> this" on the ward's clock, and `/appointments` aggregating visits, scheduled to-dos and youth
> sign-ups through one pure `buildMyAppointments()`) are all built. **One departure from the prototype's wording:**
> completing an agenda item here does not *remove* it — WLT's agenda keeps completed items as the
> meeting's record — but the to-do side is exactly as specified: flagged, never deleted.
> Plan: [../todo-and-my-appointments.md](../todo-and-my-appointments.md).
> **Deferred by decision:** the Agendas assignee picker → P4's Agendas slice (P5 builds the link,
> not the picker); role-addressed meeting invites and the conflict check → P6; Google Calendar
> sync → out of scope. **A to-do is owner-only** — the prototype's own "settled" rule, and the
> bishop is not an exception.

### 2.11 Tithing Calc — RESKIN, with a deliberate exception
The prototype **kept its own navy/gold palette** (`--navy #1B3A6B`, `--gold #C8A951`) rather
than adopting the pine/rust/gold system, because fidelity to an already-approved standalone
build mattered more than template consistency. **Decide whether that exception survives** into
WLT. Also note the conflict in [decisions.md](decisions.md) §4.3: the prototype wants a
Sunday-night scheduled clear; CLAUDE.md §4.11 mandates 48 elapsed hours on a `timestamptz`.
Both cannot hold.

### 2.12 Access Control — RESKIN+
WLT has `/admin/users` with invites, roles and deactivation. New here: the **request → approve
flow** (ward admin requests role+module+level with a reason; super admin approves ward-scoped or
app-wide, or denies with a note, and **the requester can see the outcome**), the rule that
**app-wide grants never turn on silently** (an explicit off-override plus a notification with
one-tap opt-in), and the Roles / Users / Accesses browser tabs with the reverse lookup. Phase C.

### 2.13 Ward Import — RESKIN+
WLT has a full CSV import wizard. New here: **three-tier match confidence** on name + birth date
(ambiguous mediums fall through to "new" rather than guessing), four review buckets
(New/Changed **pre-checked**, Reactivate/Missing **deliberately unchecked**), **soft delete
only**, a **calling-text mismatch shown as a distinct integrity flag** rather than a routine
field diff (calling changes should originate in the app), a **corrections log** with a required
note, and **revert detection** — see [decisions.md](decisions.md) §3.

---

## 3. WLT modules the prototype has no counterpart for

Do not lose these in the re-skin. Each still needs a design.

| WLT | Note |
|---|---|
| `/roster`, `/roster/household/[id]`, `/roster/member/[id]` | The prototype has only Ward Import's flat table. Member notes, organizations and the speaker-history tab have no prototype design at all. |
| `/goals` | No prototype counterpart. |
| `/knowledge` — pgvector, chunking, retrieval filters | The prototype has three *source libraries* and a chat shell with no retrieval. WLT is far ahead. |
| `/ai-settings` — versioned prompts, preview, restore | No counterpart. |
| `/sacrament` — youth PIN ordinance assignments | Phase 10 in WLT, unstarted; the prototype has a `sacrament-ordinance-coordinator` role and nothing behind it. |
| Auth: login, invite, PIN, reset | The prototype has none. WLT's is real and shipped. |
| Audit log | Every WLT mutation writes one. The prototype has no concept. |
| Notifications | `emitNotification()` on every trigger. The prototype fakes this per module. |

---

## 4. The role mapping

26 of the prototype's 33 roles are already reachable in WLT's model — `users.role` +
`users.org_id` + `users.counselor_position` (which already exists, checked `in (1,2)`).

| Prototype | WLT today | New? |
|---|---|---|
| `bishopric-bishop` | `bishop` | — |
| `bishopric-1st/2nd-counselor` | `counselor` + `counselor_position` | — |
| `bishopric-secretary` | `executive_secretary` | — |
| `bishopric-ward-clerk` | `ward_secretary` | — |
| 20 × org president / 1st / 2nd counselor / secretary | `org_president` / `org_counselor` (+ position) / `org_secretary`, × `org_id` | — |
| `music-coordinator` | `music_coordinator` | — |
| `stake-president`, `stake-1st/2nd-counselor`, `stake-secretary` | — | **4 new** |
| `super-admin` | — | **1 new** |
| `resource-center-specialist` | — | **1 new** |
| `sacrament-ordinance-coordinator` | `sacrament_manager`? | **verify** |

✅ **The prototype's role list has no Young Men, AND THAT IS CORRECT — RESOLVED 2026-09-21.**
This row used to read "almost certainly an omission in the prototype, not a decision". It was
neither: it is the handbook. The user supplied `calling-hierarchy.json` (General Handbook,
December 2025), which says in as many words that **the bishopric IS the presidency of the Aaronic
Priesthood in the ward** and that **there is no separate ward Young Men president calling** — the
bishopric fills that role, with the bishop presiding over the priests quorum directly. Young Women
is different and does have its own ward presidency, which is why the prototype lists it.

So five org presidencies is the right number, and the matrix was treated as authoritative on this
point when it was re-derived in P2. What follows from it:

* `org_president` × `young_men` is a calling that **should not normally exist**. WLT still has a
  `young_men` organization TYPE and the youth module is built around one, so the permission matrix
  gives it the same grants as Young Women rather than refusing it — the handbook point is about
  which CALLING presides, not about whether the work exists.
* The bishopric holds `youth_activities.manage`, which is how the Aaronic Priesthood side is
  covered.

See `lib/auth/permissions.ts` §organizationYouthPermissions for the rule and its reasoning.

⚠️ **`ward_council_member`** exists in WLT and has no prototype equivalent. It is the role
CLAUDE.md calls "the widest role in the app" and "the role most likely to have no organization
at all", and several youth decisions turn on it. Do not drop it.

---

## 5. Counts

| | |
|---|---|
| RESKIN | 6 |
| RESKIN+ | 9 (carrying **~40 named new behaviours**) |
| NEW | 12 |
| STUB | 2 |
| CONFLICT with a v1 guardrail | 2 |
| WLT modules with no prototype design | 8 |

**The honest read:** about a third of this is re-skinning, and two thirds is new product. The
40 behaviours inside the RESKIN+ rows are the ones most likely to be mistaken for styling work,
which is exactly why they are enumerated here rather than discovered mid-slice.


---

## 6. Navigation shape — how each page is worked

**Added 2026-09-23, after `/music` was built with the wrong one.** §1 and §2 catalogue features.
This section catalogues **interaction**, because the two are independent: the Music row named four
new behaviours, all four were respected, and the page still came out wrong because nothing said it
was a collapsed list.

Read this alongside your module's row. If your module is not in §6.5, open the component in
`prototype/WLT.jsx` and add it **before planning** — the same rule §1 already applies to a missing
verdict row.

### 6.1 The shapes, and the one rule that separates them

The prototype uses exactly three list shapes, and which one a page gets is not arbitrary:

| Shape | State | Used by | When |
|---|---|---|---|
| **Single-open** | `openX` — one value or `null` | Music, Program, Ward Calendar | The page is a **jump target**: something deep-links you to one item |
| **Multi-expand** | `expandedIds` — a `Set` | Prayer Roll, Access Control, Ministering | You **browse and compare**; several open at once is the point |
| **Sub-view machine** | `view` / `tab` / `viewMode` | Sacrament, Youth Support, Visits, Receipts, Ward Import, Tithing, Zoom, Access Control | The module holds several genuinely different screens |

**THE RULE: single-open ⇔ jump target.** All three single-open pages initialise their open item
from an incoming jump (`openDateKey = jumpToDateKey`, `openEventId = initialOpenEventId`), and no
multi-expand page takes one. A page you can be deep-linked into opens **exactly one** thing and
the link chooses which; a page you browse opens as many as you like. Do not mix them: a `Set` on a
jump target loses the answer to "which one did I come here for", and a single value on a browse
list makes comparison impossible.

### 6.2 The per-date working module — Music and Program

The shape `/music` should have had, and the one `/program` will need. Verified in
`prototype/WLT.jsx` §`MusicPage` (~16851) and §`ProgramPage` (~17243); the build notes say the
pattern was **deliberately replicated** from Music into Program, so it is a convention and not a
one-off.

1. **A rolling list of the next 8 Sundays** from `nearestSunday(TODAY)`. **No month navigation.**
2. **One collapsed card per date**, the whole card clickable, carrying the date plus its status
   pills — for Music, `n/m picked` and `Draft` / `Pending approval` / `Approved`.
3. **One open at a time**, with an explicit **Collapse** button while open.
4. **A blocked prerequisite dims the card** (`opacity: 0.7`) and replaces both pills with a single
   `Topics pending`. The card stays clickable; it is dimmed, never disabled.
5. **A jump opens that date already expanded** — you never land on a list to search through.
6. **A jumped-to date outside the 8 weeks is INSERTED into the list in date order.**

**⚠6 IS THE PROTOTYPE'S OWN FIX FOR WLT DEFECT 072-D1** — a hub pill that could not reach a Sunday
beyond the horizon. WLT solved the same defect differently in `06910f8`, by replacing the horizon
with a month board and `MonthNavigation`. **The user reversed that on 2026-09-23** in favour of
this. The 8 is an arbitrary client-side constant and WLT is free to change it; keep it unless
there is a reason, since a jumped-to date is reachable either way.

**BUILT IN WLT — 2026-09-23** (`plans/music-collapsed-list-and-rolling-year.md`). Items 1, 2, 3,
5 and 6 are shipped: `lib/music/sundayWindow.ts` owns the 8 and the insert,
`app/(app)/music/MusicSundayList.tsx` owns the single `openSundayId`, and the Music pill carries
`?sunday=<id>&from=sacrament#sunday-<id>`.

**ITEM 4 IS NOW BUILT — 2026-09-23, P4 slice `b2`** (`plans/sacrament-topics-finalize-and-history.md`).
`sundays.topics_finalized_at` (migration 078) is the concept it was waiting for. A Sunday whose
topics nobody has finalized renders at `opacity-70` with its completion pill **REPLACED** by a
single `Topics pending` — not accompanied, which is the build note's own rule: a completion count
is *"premature before the conductor has actually decided the day's shape"*. **The card stays
clickable.** Dimmed, never disabled, and `app/(app)/music/SundayMusicCard.tsx` carries the
reasoning.

It is the COLUMN, never a derivation. `decisions.md` §1.15 is explicit that finalize is *"a
conductor's deliberate click, **not** derived from every slot happening to have a topic"*, so
inferring it from "this Sunday has topics assigned" would tell a coordinator the topics were
settled when nobody had said so. `lib/topics/finalize.ts` holds the rule that clears it again, and
the rule is about **what** changed rather than about **who** moved — advancing a speaker through
the pipeline leaves a finalized Sunday finalized.

**THE WORKFLOW PILL OF ITEM 2 IS STILL NOT BUILT, and it is not slice `b`'s.**
`Draft` / `Pending approval` / `Approved` reports the **programme's** state, not the topics', so it
belongs with the programme — module 6, or whichever slice next touches `/program`. Its absence on
the collapsed music card is correct rather than outstanding.

### 6.3 The contextual back link — ~17 pages, and WLT has sanctioned it but built none

Nearly every prototype page captures where you came from **once at mount** via
`useRef(previousPage)` and renders *"Back to {that page}"*, falling back to *"Back to Dashboard"*.
Music and Program show *"Back to Sacrament Calendar"* when reached from the hub.

**This is not a conflict with WLT's chrome bar, and the reasoning is already written down.**
`components/layout/ChromeBar.tsx` keeps its own back link **unconditionally `/dashboard`** because
the prototype's *global* dynamic one was genuinely broken — it tracked one step, overwrote it on
every navigation, and after a couple of hops lost the path home (build note
§`dashboard-back-link-regression-fix`, "a real design flaw, not an edge case"). That header then
says, in as many words, that **per-page contextual back links are safe precisely because the
chrome bar's is not**, captured once at mount so they cannot cycle — and that P3 built none of
them. So this is an unbuilt sanctioned behaviour, not a decision to revisit.

**THE FIRST ONE IS NOW BUILT — `components/layout/ContextualBackLink.tsx`, 2026-09-23.** It
departs from the prototype in **two** ways, both on purpose.

**The origin is a query parameter (`?from=`), not a ref captured at mount.** That is strictly
better here — it survives a refresh, a shared link and a restored tab, where a ref does not — and
it costs nothing, because the only links into these pages are ones WLT builds itself. `from` is
resolved through an **allowlist** and is never rendered or navigated to as free text.

**⚠️ THERE IS NO "Back to Dashboard" FALLBACK. No origin means NO LINK** — decided by the user on
2026-09-23 after the first build shipped with the prototype's fallback and scenario 072's walk
showed the result: WLT's chrome bar already carries an **unconditional** "← Dashboard" on every
page, so a page reached from the navigation rendered **two stacked back links to the same place**.
The prototype needs its fallback because its global link is broken; WLT's is not, which is the
same fact §6.3 opens with. **A later page copying the prototype's fallback would reintroduce the
duplication** — `tests/components/layout/ContextualBackLink.test.tsx` fails if it comes back.
Every later page should reuse this component rather than growing its own.

### 6.4 The module shortcut row — `.sac-nav`, a STANDING CONVENTION and a shared class

**Added 2026-09-23, found by the user on the deployed build and missed by the original harvest.**
§6.1–6.3 catalogue how a page's *list* is worked. This is about how a page links to **other
modules**, and the prototype has one answer for it that it states as a rule.

The Sacrament hub renders a row of **eight** shortcut buttons under its header
(`prototype/WLT.jsx` §`SacramentPage` ~5203, from the module-level `NAV_LINKS` ~4805):

| | | | | | | | |
|---|---|---|---|---|---|---|---|
| Ward List | Conducting | **Topics** | Music | Messages | Assignments | Program | To-Do |

Each is an icon plus a label, and **each icon is the destination's own Dashboard tile icon** —
deliberately, so the shortcut is recognisable rather than arbitrary.

**⚠️ THIS IS A STANDING CONVENTION, IN THE PROTOTYPE'S OWN WORDS.** Build note
§`global-stylesheet-nav-consistency` puts `.sac-nav` / `.sac-nav-link` in the *global* stylesheet
precisely so it is not re-invented per page, and says:

> "STANDING CONVENTION FOR FUTURE BUILDS: any page's row of nav links to other modules should use
> `.sac-nav`/`.sac-nav-link` from the global stylesheet, not a one-off `.btn` row or new CSS."

It is already used on **two** pages — Sacrament, and the Conducting Sheet, whose row is
Sacrament / Music / Program / Agendas / Ward Calendar (~12246). So in WLT this is a **shared
component**, not a per-page block: whichever slice builds the second row should extract it, and
`decisions.md` §1's *"generalize a component the second time it is needed, not the third"* already
names that moment.

**WHAT THIS SETTLES ABOUT `/talks/topics`.** §2.1 correction (b) established that the topic
library is a WLT-only supporting surface the hub **links to** and does not absorb — that stands,
and this is *where* the link goes. **Topics does not need a dashboard tile**: the user's decision,
2026-09-23, on seeing it deployed. It is bishopric-only, it is not a destination somebody opens
cold, and the prototype reaches it from exactly one place — this row.

**AND WHAT IT DOES NOT SETTLE.** The row is a set of LINKS. Moving the Topics entry point into it
does not decide what the topic page should *show* — the user's ask is a view of **topics used
recently and who spoke on them**, so a conductor planning a month can avoid repeating one. That is
a real change to the page behind the link and is scoped with it, not assumed by it.

**THE TRAP, and it is the reason this cannot be a one-line tile deletion.** `/talks/topics` is
also the only home for the **AI topic candidate queue** — generated topics a bishop accepts or
rejects. CLAUDE.md rule 3 forbids AI output reaching a row without explicit approval, so removing
the tile without rehoming that queue makes the approval step unreachable and quietly breaks the
rule. Name its new home in the plan.

**BUILT — 2026-09-23, P4 slice `b1`** (`plans/sacrament-topics-finalize-and-history.md`).
`components/layout/ModuleShortcutRow.tsx` is the shared component this section asked for, from the
day the first row shipped rather than the second — so the Conducting Sheet slice adds a caller
rather than a second block of markup.

**THE ROW IS DRIVEN FROM `NAVIGATION_ITEMS`, WHICH IS THE WHOLE POINT.** `NavigationItem` gained
`onDashboard?: boolean` (absent means true) and the Topics row carries `onDashboard: false` — so
the tile is withheld and **the entry survives**, carrying the label, the icon, the permission and
the `built` flag that a hardcoded shortcut would have re-typed and drifted from.
`shortcutNavigationItems(user, roleAccess, hrefs)` takes the hrefs the page wants and filters them
**built AND permitted**, which is the same rule the grid uses and the reason a
`music_coordinator` — who holds `talks.view` and not `topics.view` — is offered no Topics link at
all rather than one that refuses on arrival.

**THE ROW IS SHORT TODAY, AND THAT IS THE CONSTRAINT WORKING.** Of the prototype's eight, WLT has
a navigation row for four: **Ward List, Topics, Music, Program**. Conducting, Messages and To-Do
are unbuilt and `built: false` keeps them out with no edit to the hub. `/assignments` is absent
because `p4-sacrament-a` deliberately removed its row — and nothing became unreachable, because
every Sunday's Topics and Talks pills sit a few centimetres below the row and open
`/assignments/[id]` for that date.

**THE QUEUE KEPT ITS HOME.** The page was not deleted; only the tile was. `lib/auth/navigation.tsx`
says so at the Topics row, because the next reader will wonder whether rule 3 was considered.

### 6.5 The catalogue

| Prototype page | Shape | Jump target? | Contextual back link |
|---|---|---|---|
| Sacrament | Month calendar (`HomeCalendar`, `visibleMonths`) + sub-view machine | — | — |
| Music | Single-open date list (8 Sundays) | ✓ `jumpToDateKey` | ✓ **built** |
| Program | Single-open date list (8 Sundays) | ✓ `jumpToDateKey` | ✓ |
| Conducting | **Week offset**, not a list — a jump sets the offset | ✓ `jumpToDateKey` | ✓ |
| Ward Calendar | `viewMode` month/other + single-open event | ✓ `initialOpenEventId` | ✓ |
| Prayer Roll | Multi-expand `Set` | — | ✓ |
| Prayer Focus | Flat list | — | ✓ |
| Youth Support | Sub-view machine — **8 sub-views** | — | ✓ |
| Visits | Sub-view machine + form toggles | — | ✓ |
| To Do | Flat list + filters | — | ✓ |
| My Appointments | ~~Flat list + `showPast`~~ → **day-grouped, each day collapsible, Expand/Collapse all, `showPast`, remembered per user** — changed by the user walking scenario 077, 2026-09-24 | — | ✓ **built** |
| Receipts | Tabs (`submit`…) + `viewAs` | — | ✓ |
| Access Control | Tabs + multi-expand `Set` | — | — |
| Ministering | `viewMode` + multi-expand `Set` | — | ✓ |
| Ward Import | `viewMode` history/roster/corrections + selection `Set`s | — | — |
| Tithing Calc | Tabs (`entry`…) | — | ✓ |
| Zoom | Tabs (`recipients`…) | — | ✓ |
| Hymn Database | Flat list + search | — | — |
| Message, Account | Flat | — | ✓ |

**⚠ `Conducting` is the shape most likely to be mis-built**, because it is a jump target that is
**not** a collapsed list — the jump sets a week offset instead. Do not assume jump target implies
date list; §6.1's rule is about single-open, not about layout.
