# Implementation Plan — Index

Ward Leadership Tools, built in 13 phases. Each phase is a self-contained plan file.

**How to use this:** Find your phase below, open **only that file** (plus
[conventions.md](conventions.md) if you need code-style detail). Do not load the whole
plan set — each file is written to be sufficient on its own.

---

## Phase Map

**Status is sourced from [retros/INDEX.md](retros/INDEX.md)**, not from the checkboxes in each
phase file — those are ticked inconsistently and are not the signal. A phase is shipped when every
one of its slices has a retro entry with a commit.

| # | Phase | File | Depends on | Est. | Status |
|---|---|---|---|---|---|
| 0 | Foundation — setup, schema, RLS, cross-cutting services | [00-foundation.md](00-foundation.md) | — | Large | Shipped |
| 1 | Auth & RBAC — login, invites, youth PIN, guards | [01-auth-rbac.md](01-auth-rbac.md) | 0 | Medium | Shipped |
| 2 | Roster — households, members, CSV import | [02-roster.md](02-roster.md) | 1 | Medium | Shipped |
| 3 | Sunday calendar & conducting rotation | [03-calendar.md](03-calendar.md) | 2 | Small | Shipped |
| 4 | Talk pipeline, prayers, topics, goals | [04-talks-pipeline.md](04-talks-pipeline.md) | 3 | Large | Shipped |
| 5 | AI platform — knowledge base, pgvector, settings | [05-ai-platform.md](05-ai-platform.md) | 4 | Large | Shipped |
| 6 | Program builder, music, PDF, public pages | [06-program-music.md](06-program-music.md) | 5 | Large | Shipped — M4 waits on a physical fold check (scenarios 034/035) |
| 7 | Visit tracker & return-and-report feed | [07-visits.md](07-visits.md) | 2 | Medium | **Shipped 2026-08-26** — see the Definition of Done in the phase file for what it deliberately does not close |
| 8 | Youth activity support | [08-youth-activities.md](08-youth-activities.md) | 7 | Medium | Next — ITER-018 is done, so the blocker is cleared |
| — | ITER-018 — visit cadence and the priority scale | [visits-e-cadence-and-priority.md](visits-e-cadence-and-priority.md) | 7 | Medium | **Built 2026-08-26** — migration 051 waits for the deploy |
| 9 | Meeting agendas & tithing calculator | [09-meetings-tithing.md](09-meetings-tithing.md) | 1 | Medium | Started — tithing worksheet only |
| 10 | Sacrament administration & public assignments | [10-sacrament-admin.md](10-sacrament-admin.md) | 3 | Medium | Not started |
| 11 | Notification UI, admin pages, audit viewer, dashboards | [11-notifications-admin.md](11-notifications-admin.md) | all | Medium | Not started |
| 12 | Theme polish, accessibility, multi-ward scaffolding | [12-polish-multiward.md](12-polish-multiward.md) | all | Small | Not started |
| — | Deployment — Vercel, env vars, auth URLs, SMTP | [deployment.md](deployment.md) | 1 | Small | Shipped |
| — | Code conventions reference | [conventions.md](conventions.md) | — | — | Living |

**Phase 8 was blocked on ITER-018, and no longer is.** The visit goal is now a rolling cadence
rather than a dated period, and Phase 8's youth-activity coverage was documented to reuse
`householdVisitStatus` (`visits-b` §Integration Notes) — landing that redesign after Phase 8 would
have left that module built on a model already known to be wrong.

What Phase 8 should import rather than re-derive: `lib/visits/cadence.ts` (`addCadence`,
`subtractCadence`, `compareCadences`, `describeCadence`) and `householdVisitPriority()`. Neither
names anything visit-specific in its parameters — `lastCompletedOn`, not `lastVisitedOn` — for
exactly this reason. If a third module wants them, that is the moment to lift `cadence.ts` out of
`lib/visits/`; not before.

**Deployment is unnumbered on purpose.** It is not a phase after 12. It depends only on Phase 1
and is *required* by Phase 6, whose public program pages are meaningless without a URL a ward
member can open. Doing it early also makes every "test on a real phone" step in the harness a
real test rather than an approximation.

---

## Dependency Graph

```
                        ┌── 3 Calendar ──┬── 4 Talks ── 5 AI ── 6 Program/Music
0 Foundation ── 1 Auth ──┤                └── 10 Sacrament Admin
                        ├── 2 Roster ── 7 Visits ── 8 Youth Activities
                        └── 9 Meetings & Tithing

                        (11 Notifications/Admin and 12 Polish come last)
```

**Phases 7–9 are independent of 4–6.** After Roster and Auth land, visits, meetings,
and tithing can be built in parallel with the talk pipeline. Phase 10 needs only the
calendar. This is the main opportunity to work on two tracks at once.

---

## Why This Order Differs From SPEC.md

SPEC.md's "Build Order" puts notifications at #16 and the audit log at #17. Both are
**cross-cutting write paths** — every module emits notifications and writes audit rows
from its first commit. Retrofitting them across 15 modules would mean touching every
route twice.

**Moved into Phase 0:** the notification *emit* path, the audit *write* path, the
permission-check helper, and the ward-scoping query helper. What stays late is only the
**UI** for reading notifications, browsing the audit log, and managing settings — those
genuinely can wait, and they are Phase 11.

Everything else follows SPEC.md's ordering.

---

## Definition of Done — Every Phase

A phase is not complete until all of these hold:

- [ ] RLS policies exist for every new table and are **tested** — a user in ward A
      cannot read or write ward B; a user in org X cannot read org Y's private data
- [ ] Every mutating route calls `writeAuditLog()`
- [ ] Every notification trigger listed for the phase emits via `emitNotification()`
- [ ] TypeScript types regenerated (`types/database.ts`) and domain types updated
- [ ] Every new/changed route validates its body with a Zod schema
- [ ] Errors surface to the user with an actionable message; nothing is swallowed
- [ ] Works at 375px width and in both light and dark mode
- [ ] Tests written per CLAUDE.md §8 priority order
- [ ] Lint and typecheck pass clean

---

## Milestones

Useful checkpoints for "is this usable yet?"

| Milestone | After phase | The ward can… |
|---|---|---|
| **M1 — Sign in** | 1 | Bishopric and org leaders log in and see a role-appropriate shell |
| **M2 — Data loaded** | 2 | Full roster imported from LCR; households browsable |
| **M3 — Plan a month** | 4 | Plan, approve, request, and confirm a month of speakers and prayers |
| **M4 — Print a program** | 6 | Produce and distribute a real sacrament program PDF with a public link |
| **M5 — Run the orgs** | 8 | Every organization tracks visits; youth events get covered |
| **M6 — Run the meetings** | 9 | Ward council and bishopric agendas built, emailed, and carried forward |
| **M7 — Feature complete** | 11 | All 17 modules live, notifications tuned, audit log browsable |
| **M8 — Shippable** | 12 | Polished, accessible, and safe to onboard a second ward |

---

## Scope Guardrails

Explicitly **out of scope for v1** — do not build these, even if they seem small:

- Email or push notifications (in-app only; the two exceptions are agenda and
  program PDF distribution via Resend)
- Two-way SMS tracking or delivery receipts
- LCR API integration (CSV import only)
- Multi-ward **UI** — the data model supports it, the interface does not
- Any public member portal beyond `/public/[slug]` assignments and program pages
- Calendar sync with external apps (beyond one-way ICS import for youth activities)
- Org discussion threads — build the two tables in Phase 0, ship no UI

If a task appears to require one of these, stop and flag it rather than expanding scope.
