# Implementation Plan — Index

**Restructured 2026-09-20**, when the design prototype became the source of truth. Phases 0–9
shipped under the original plan and stay exactly as they are. Phases 10–12 are retired, their
scope rewritten into a prototype-driven **P-track**.

**How to use this:** find your phase, open **only that file** (plus
[conventions.md](conventions.md) for code-style detail, and the relevant row of
[prototype/module-map.md](prototype/module-map.md) for anything from P1 on). Do not load the
whole plan set.

**Status is sourced from [retros/INDEX.md](retros/INDEX.md)**, not from checkboxes inside phase
files — those are ticked inconsistently and are not the signal.

---

## Read this first

The prototype (`prototype/WLT.jsx`, gitignored — it holds real member data) is now the design
authority. It has been harvested into [prototype/](prototype/):

| File | What it is |
|---|---|
| [prototype/INDEX.md](prototype/INDEX.md) | The integration plan and phase rationale |
| [prototype/decisions.md](prototype/decisions.md) | Durable rules, **the six conflicts with this codebase**, real-build requirements |
| [prototype/module-map.md](prototype/module-map.md) | Every module → verdict → the new behaviours it hides |
| [prototype/build-notes-raw.md](prototype/build-notes-raw.md) | All 82 build notes, verbatim |

**No slice starts before its module-map row exists.** See CLAUDE.md §12.

---

## Shipped — phases 0–9

Historical. Load one only to understand why existing code is the way it is, never to plan new
work. Every slice has a retro entry with a commit.

| # | Phase | File | Shipped |
|---|---|---|---|
| 0 | Foundation — setup, schema, RLS, cross-cutting services | [00-foundation.md](00-foundation.md) | ✅ |
| 1 | Auth & RBAC — login, invites, youth PIN, guards | [01-auth-rbac.md](01-auth-rbac.md) | ✅ |
| 2 | Roster — households, members, CSV import | [02-roster.md](02-roster.md) | ✅ |
| 3 | Sunday calendar & conducting rotation | [03-calendar.md](03-calendar.md) | ✅ |
| 4 | Talk pipeline, prayers, topics, goals | [04-talks-pipeline.md](04-talks-pipeline.md) | ✅ |
| 5 | AI platform — knowledge base, pgvector, settings | [05-ai-platform.md](05-ai-platform.md) | ✅ |
| 6 | Program builder, music, PDF, public pages | [06-program-music.md](06-program-music.md) | ✅ — M4 waits on a physical fold check |
| 7 | Visit tracker & return-and-report feed | [07-visits.md](07-visits.md) | ✅ 2026-08-26 |
| 8 | Youth activity support | [08-youth-activities.md](08-youth-activities.md) | ✅ — eleven slices, `youth-a`…`youth-j` |
| — | ITER-018 — visit cadence and priority | [visits-e-cadence-and-priority.md](visits-e-cadence-and-priority.md) | ✅ 2026-08-26 |
| 9 | Meeting agendas & tithing calculator | [09-meetings-tithing.md](09-meetings-tithing.md) | Part A built 2026-09-01 (migration 064); Part B shipped 2026-08-25 |
| — | Deployment — Vercel, env vars, auth URLs, SMTP | [deployment.md](deployment.md) | ✅ |
| — | Code conventions reference | [conventions.md](conventions.md) | Living |

**Phase 9's scheduled agenda email is deliberately not built** — it needs a scheduler this
project does not have. It moved to **P12** along with everything else clock-driven.

---

## Retired — phases 10–12

Superseded by the prototype. The files remain, each carrying a header pointing forward; their
scope lives on in the P-track.

| # | Was | Now |
|---|---|---|
| 10 | [10-sacrament-admin.md](10-sacrament-admin.md) | → **P11** |
| 11 | [11-notifications-admin.md](11-notifications-admin.md) | → **P12** |
| 12 | [12-polish-multiward.md](12-polish-multiward.md) | → **P2** (multi-ward) + **P13** (polish) |

---

## Ahead — the P-track

| # | Phase | File | Depends on | Size |
|---|---|---|---|---|
| ~~**P1**~~ | ~~Design system — tokens, fonts, primitives~~ | [P1-design-system.md](P1-design-system.md) | — | ✅ **Shipped 2026-09-20** |
| ~~**P2**~~ | ~~Unit hierarchy — stakes, super admin, ward switching~~ | [P2-unit-hierarchy.md](P2-unit-hierarchy.md) | — | ✅ **Shipped 2026-09-21** |
| ~~**P3**~~ | ~~Shell & IA — tile dashboard, chrome bar, sidebar deleted~~ | [P3-shell-and-ia.md](P3-shell-and-ia.md) | — | ✅ **Shipped 2026-09-22** |
| **P4** | Module re-skins — 9 modules, ~40 named behaviours | [P4-module-reskins.md](P4-module-reskins.md) | P3 | **Large** |
| **P5** | To Do & My Appointments | [P5-todo-and-appointments.md](P5-todo-and-appointments.md) | P3 | Medium |
| **P6** | Conducting Sheet & Ward Calendar | [P6-conducting-and-calendar.md](P6-conducting-and-calendar.md) | P4, P5 | Large |
| **P7** | Prayer Roll & Prayer Items | [P7-prayer.md](P7-prayer.md) | P4 | Medium |
| **P8** | Receipts · Account · Speaking History Admin | [P8-receipts-account-history.md](P8-receipts-account-history.md) | P3 | Medium |
| **P9** | Callings · Ministering · Calling Requests | [P9-sandboxes-and-requests.md](P9-sandboxes-and-requests.md) | P5 | Large |
| **P10** | Message & Zoom | [P10-message-and-zoom.md](P10-message-and-zoom.md) | P3 | Medium |
| **P11** | Sacrament administration | [P11-sacrament-admin.md](P11-sacrament-admin.md) | P3 | Medium |
| **P12** | Scheduler · notifications UI · audit viewer · dashboards | [P12-scheduler-and-admin.md](P12-scheduler-and-admin.md) | most | Medium |
| **P13** | Accessibility & theme polish | [P13-polish.md](P13-polish.md) | all | Small |

**P1–P4 are written in full. P5–P13 are stubs** carrying their module-map rows, their
dependencies and their known traps — each gets fleshed out by `/planning` as it is approached,
so it is written against what the code actually looks like by then rather than against a guess
made today.

### Why this order

**P1 first** because it is cheap, touches no data, and makes every existing page look right
while the deep work happens behind it. **P2 before P3** because the tile dashboard's visibility
rules are built against the access model, and building them twice is waste. **P4 before P6**
because the Conducting Sheet reads Sacrament's data and Ward Calendar collides with
`/calendar`'s name. **P5 early** because To Do is a spine — Sacrament's accept/decline,
Agendas' delegation, My Appointments and Zoom's referral flow all hang off it.

---

## Dependency graph

```
P1 Design system ──┐
                   ├── P3 Shell & IA ──┬── P4 Re-skins ──┬── P6 Conducting & Calendar
P2 Unit hierarchy ─┘                   │                 └── P7 Prayer
                                       ├── P5 To Do ─────┴── P9 Sandboxes
                                       ├── P8 Receipts/Account/History
                                       ├── P10 Message & Zoom
                                       └── P11 Sacrament Admin

                              (P12 Scheduler/Admin and P13 Polish come last)
```

**P5, P8, P10 and P11 are independent of P4.** After the shell lands, four tracks can run in
parallel. This is the main opportunity to work on more than one thing at a time.

---

## Definition of Done — every phase

- [ ] RLS policies exist for every new table and are **tested** — a user in ward A cannot read
      or write ward B; a user in org X cannot read org Y's private data
- [ ] **A user in ward A cannot reach ward B by switching** unless their unit assignment allows
      it (new, P2 onward)
- [ ] Every mutating route calls `writeAuditLog()`
- [ ] Every notification trigger emits via `emitNotification()`
- [ ] TypeScript types regenerated (`types/database.ts`) and domain types updated
- [ ] Every new/changed route validates its body with a Zod schema
- [ ] Errors surface to the user with an actionable message; nothing is swallowed
- [ ] Works at 375px width and in both light and dark mode
- [ ] **Every date formatter names its zone** (CLAUDE.md rule 12) — `explicitTimeZone.test.ts` green
- [ ] Tests written per CLAUDE.md §8 priority order
- [ ] Lint and typecheck pass clean

---

## Milestones

| Milestone | After | The ward can… |
|---|---|---|
| **M1 — Sign in** | 1 | ✅ Role-appropriate shell |
| **M2 — Data loaded** | 2 | ✅ Full roster imported |
| **M3 — Plan a month** | 4 | ✅ A month of speakers and prayers |
| **M4 — Print a program** | 6 | ✅ Real PDF with a public link |
| **M5 — Run the orgs** | 8 | ✅ Visits tracked, youth events covered |
| **M6 — Run the meetings** | 9 | Agendas built and carried forward |
| **M7 — Looks like the prototype** | P4 | Every existing module in the new design |
| **M8 — The work lands somewhere** | P5 | To Do and My Appointments close the loop on every assignment |
| **M9 — Feature complete** | P11 | Every prototype module live |
| **M10 — Shippable to a second ward** | P13 | Polished, accessible, multi-unit |

---

## Scope guardrails

Explicitly **out of scope** — do not build these:

- LCR API integration (CSV/manual import only, until the church offers one)
- Google Calendar sync (one-way ICS import only)
- Any public member portal beyond the existing `/public/[slug]` pages and the prototype's
  token links (receipts join, Zoom opt-out, Zoom referral, program, agenda guest, series)
- Area- and district-level admin **screens** — P2 builds the data shape only

**Three former guardrails were lifted 2026-09-20** and are now phases: multi-ward UI (**P2**),
in-app messaging (**P10**), and Zoom (**P10**). See CLAUDE.md §9.

If a task appears to require something still on this list, stop and flag it.
