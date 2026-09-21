# Prototype Integration — Index

Bringing the design prototype (`prototype/WLT.jsx`, 21,819 lines, gitignored) into WLT.

**The governing decision: the prototype is the specification, WLT stays the codebase.**

The prototype is a client-only React app — 622 `useState` hooks, zero `fetch`, zero
persistence, no auth, no router, no server. What it has that WLT does not is a coherent design
system, an information architecture the user drove themselves, and 23 modules' worth of
considered product design. What WLT has that the prototype does not is every expensive,
invisible half of an application: RLS as the security boundary, 64 migrations, auth, audit
logging, notifications, Zod validation, 222 test files including 37 RLS suites, an AI platform
on pgvector, PDF rendering, public pages, CSV import, and a live deployment.

Starting over would mean paying for the invisible half twice to keep the visible half.

**Two corollaries that do most of the work:**

1. **The prototype is a design source, not a code source.** Its pages are monolithic client
   components taking 25–30 props with every sub-view behind a `view` useState —
   `YouthSupportPage` alone holds `ranking | calendar | event | teams | teamDetail | history |
   feed | import`, which in WLT are already eight real routes. The JSX *inside* each view
   transfers. The wiring does not, and should not.

2. **Every module is split into "looks different" and "behaves differently" before anything is
   built.** This is the largest risk in the effort. [module-map.md](module-map.md) enumerates
   **~40 new behaviours** hiding inside rows that look like re-skins. Without that split, every
   re-skin quietly becomes a feature build and the estimate means nothing.

---

## Files in this directory

| File | What it is |
|---|---|
| [build-notes-raw.md](build-notes-raw.md) | The 82 prototype build notes, **verbatim**. The source. Names scrubbed. |
| [decisions.md](decisions.md) | The curated durable rules, the **conflicts with WLT**, and the real-build requirements. |
| [module-map.md](module-map.md) | Every prototype module → WLT counterpart → verdict → the new behaviours. **The gate.** |

---

## Decisions taken 2026-09-20

Three forks were put to the user and answered:

1. **Navigation: tiles only, drop the sidebar.** The tile dashboard is home; the chrome bar
   gets you back. This is the model the user designed and drove.
2. **Multi-ward: build the whole hierarchy now.** Stake tier, super admin, ward switching. This
   was flagged as the largest option and chosen deliberately. It reverses
   [../INDEX.md](../INDEX.md)'s "Multi-ward UI — do not build for v1" guardrail; that guardrail
   is now superseded and should be struck when Phase C lands.
3. **Design system first.** Every page gets the new look via the primitives before any module is
   touched individually.

---

## Phase map

| # | Phase | Slices | Depends on | Size | Status |
|---|---|---|---|---|---|
| A | Harvest | — | — | Small | **Mostly done** — see below |
| B | Design system | `proto-a` | A | Medium | Not started |
| C | The unit hierarchy | `proto-b`, `proto-c`, `proto-d` | A | **Large** | Not started |
| D | Shell & information architecture | `proto-e` | B, C | Medium | Not started |
| E | Module re-skins | one slice per module | D | Large | Not started |
| F | Net-new modules | one phase per module | D | **Very large** | Not started |

---

### Phase A — Harvest *(no code)*

- [x] `/prototype/` added to `.gitignore` — it holds **359 real member records** with names,
      phone numbers, street addresses and birth dates. One `git add .` would have made that
      permanent.
- [x] 82 build notes extracted verbatim to [build-notes-raw.md](build-notes-raw.md), with 10
      references to real ward members replaced by role descriptors.
- [x] Durable rules, conflicts and real-build requirements curated into
      [decisions.md](decisions.md).
- [x] [module-map.md](module-map.md) — 29 modules mapped, ~40 new behaviours named.
- [ ] Fix **two** corrupted access-matrix entries before anything reads them as data — in both,
      a build note was pasted in where an access level belongs:
      `stake-president.access.zoom` and `music-coordinator.access.music`, each starting `"F ..."`
      followed by paragraphs of prose. Both should be `"F"`.
- [ ] Confirm the **missing Young Men** presidency in the prototype's role list is an omission
      rather than a decision (module-map §4). Only `young-women-*` exists.

### Phase B — `proto-a`: the design system

The prototype defines its tokens in **27+ per-page `<style>` blocks** which have already
drifted — `--gold` is `#C9A24B` in one and `#A8791F` in another — and its own notes record that
biting it (tiles rendering with no card because one page's stylesheet lacked `.tile`). **Do not
port that approach.**

- One `app/globals.css` carrying `--pine` / `--rust` / `--gold` / `--ink` / `--ink-soft` /
  `--line` / `--surface`, both themes, measured for contrast the way the stage colours already
  were.
- Fraunces (display) + Inter (body) via `next/font`, not an `@import` in 27 places.
- Re-skin `components/ui/*`; add the primitives the prototype leans on that WLT lacks: **Pill,
  StatusTag, Chip, Tile, SearchBox, SectionHeader**, and the two-click `ConfirmDeleteButton`
  ([decisions.md](decisions.md) §1.5).
- No page edits. Every page changes appearance because the primitives did.
- **Open:** whether Tithing keeps its own navy/gold palette (module-map §2.11).

### Phase C — the unit hierarchy *(three slices, the deep work)*

The specification is [decisions.md](decisions.md) §5. Two findings make this far smaller than
"33 roles and 131 policies":

**26 of the 33 roles already exist** as `role` + `org_id` + `counselor_position` — that last
column is already in migration 002. Genuinely new: 4 stake roles, super admin, 2 specialists.

**The 173 `current_ward_id()` references sit behind one SQL function.** Change its semantics
and the 131 policies do not move:

```sql
current_ward_id()  →  coalesce(users.active_ward_id, users.ward_id)
```

A stake officer does not need cross-ward policies — they need an **authorized ward switch**,
after which every existing policy is already correct for the ward they are in. `current_org_id()`
and `is_bishopric()` need the same treatment and nothing else does.

- **`proto-b`** — generic `units` (type `area|stake|ward`, parent ref, **real church unit
  number**) above `wards`; `wards.stake_id`; the 7 new roles; `users.active_ward_id`; MRN on
  members. Schema only, **no behaviour change, no policy edits**.
- **`proto-c`** — the dangerous one. The three session helpers become active-ward-aware; the
  ward switcher; authorization for *may you switch to this ward*. Needs an RLS suite proving a
  stake officer reaches ward B **only** after an authorized switch, and that an ordinary ward
  member never can. Plus the **minimum-two-super-admin** rule and extra friction on assigning
  super admin ([decisions.md](decisions.md) §4.6).
- **`proto-d`** — super admin, stake roles, and the access-control matrix UI. Maps the
  prototype's F/R/Q onto WLT's existing `view`/`manage` + org scoping rather than inventing a
  parallel model ([decisions.md](decisions.md) §2.3). Includes the request → approve flow and
  the rule that app-wide grants never turn on silently.

> **Do not let the roster boundary leak.** [decisions.md](decisions.md) §5 asks that "get the
> current roster for this ward" be a single interface the rest of the app consumes, so a future
> real LCR integration replaces what is behind one boundary rather than something scattered
> through every module. Phase C is when that boundary is cheap to draw.

### Phase D — `proto-e`: shell and information architecture

- `NAVIGATION_ITEMS` gains `section`, `blurb`, `icon`, `accent` — additive, and the rule that
  "hiding a link is cosmetic, never a security boundary" survives untouched.
- The four-section tile dashboard replaces the thin one, which WLT's own code marks as a
  Phase 11 placeholder.
- Chrome bar: back-to-dashboard (**always static** — the prototype made it dynamic and got
  genuinely stuck in a two-page ping-pong; see `dashboard-back-link-regression-fix`), page
  title, theme, account, help, report-an-issue.
- Sub-dashboards, quick-link pinning. **Open:** per-user or per-device persistence.
- **The sidebar is deleted.**
- Comes after Phase C so tile visibility is built against the final access model once.

### Phase E — module re-skins

One slice per module, each with a browser walk and a retro, in the rhythm `youth-a…youth-j`
already established. **Each slice reads its [module-map.md](module-map.md) row first** and
builds the re-skin and the named new behaviours as separate commits.

Suggested order — design delta × how often it is used:

**Sacrament → Visits → Youth → Agendas → Music → Program → Tithing → Admin → Roster**

⚠️ **Youth carries a trap.** The prototype's tenth pass *removed* every explicit `timeZone` and
deleted its ward-zone machinery. That is correct for a client-only app and **wrong for WLT**,
where Server Components render first and Vercel's server is UTC. Porting it reintroduces the
React #418 / "Sat, Jan 16, 2027, 2:30 AM" bug. See [decisions.md](decisions.md) §2.1.

### Phase F — net-new modules

Twelve modules with no WLT counterpart. **Build To Do early** — Sacrament's accept/decline,
Agendas' delegation, My Appointments and the Zoom referral flow all hang off it.

Suggested grouping:

1. **To Do** (the spine) → **My Appointments**
2. **Conducting Sheet** + template (depends on Sacrament's re-skin)
3. **Ward Calendar** (settle the name collision with `/calendar` first)
4. **Prayer Roll** → **Prayer Items** (Prayer Items depends on the agenda item status field)
5. **Receipts**, **Account**, **Speaking History Admin**
6. **Callings sandbox**, **Ministering sandbox**, **Calling Requests**
7. **Message**, **Zoom** — both currently violate a v1 scope guardrail; decide before building

`plans/10-sacrament-admin.md`, `plans/11-notifications-admin.md` and
`plans/12-polish-multiward.md` get rewritten against this rather than against guesswork. The
prototype is a better roadmap than they are, because the user drove it.

---

## Things that must not be lost

- **Eight WLT modules have no prototype design at all** — roster pages, goals, the knowledge
  platform, AI settings, Phase 10's sacrament admin, auth, the audit log, notifications. See
  [module-map.md](module-map.md) §3.
- **`ward_council_member`** has no prototype equivalent and several shipped youth decisions turn
  on it. Do not drop it.
- **Phase 11 now inherits seven clock-driven things.** Nothing in this project fires from a
  clock. The prototype adds more candidates (auto-expiry, the tithing Sunday clear, the agenda
  "since last time" summary). Phase 11 should still settle the mechanism **once**, for all of
  them.
- **The tithing clear-window conflict.** The prototype wants a Sunday-night scheduled job;
  CLAUDE.md §4.11 mandates 48 elapsed hours on a `timestamptz`, written against a real defect.
  Both cannot hold ([decisions.md](decisions.md) §4.3).
