# Module Map — prototype ↔ WLT

Built 2026-09-20 from the prototype's 23 dashboard tiles and its sub-pages, against WLT's
shipped routes.

**This file is the gate.** Nothing gets built until its module has a row here, because the
single largest risk in this effort is a "re-skin" quietly becoming a feature build. The
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
| Sacrament | `/assignments`, `/prayers`, `/talks/topics` | **RESKIN+** | 9 new behaviours — §2.1 |
| Music | `/music` | **RESKIN+** | 4 new behaviours — §2.2 |
| Conducting + Conducting Template | — | **NEW** | The run-of-show sheet — §2.3 |
| Program + Program Template | `/program`, `/public/[slug]` | **RESKIN+** | 3 new behaviours — §2.4 |
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

### 2.1 Sacrament — RESKIN+ (9 new)
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
9. **Conducting rotation** with weekly **and monthly** cadence and separate anchor shapes.

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

⚠️ **The prototype's role list has no Young Men.** Five org presidencies where
`organizations.type` has six. Almost certainly an omission in the prototype, not a decision —
confirm before treating the list as authoritative.

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
