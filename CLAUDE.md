# CLAUDE.md — Ward Leadership Tools (WLT)

Project instructions for AI assistants. Read this file first, every session.
For implementation work, load **only** the plan file for the phase you are working on
(see Progressive Disclosure below). Do not load all plan files at once.

---

## 1. What This Is

A mobile-first web app for LDS ward leadership to coordinate sacrament meeting
planning, visits, youth support, meeting agendas, and administration. Built for one
ward, architected for many.

- **Feature spec:** [FEATURES.md](FEATURES.md) — what each module does, in plain language
- **Technical spec:** [SPEC.md](SPEC.md) — database schema, API routes, component tree
- **Build plans:** [plans/INDEX.md](plans/INDEX.md) — phased implementation plan

These three files are the source of truth. If code disagrees with them, the specs win —
unless the spec is wrong, in which case flag it and update the spec in the same change.

---

## 2. Progressive Disclosure — Which Files to Load

**Always loaded:** this file (CLAUDE.md).

**Load on demand**, based on what you are building:

| Working on… | Load |
|---|---|
| Anything, first time in a session | [plans/INDEX.md](plans/INDEX.md) |
| Project setup, DB schema, RLS, seed data, cross-cutting services | [plans/00-foundation.md](plans/00-foundation.md) |
| Login, invites, youth PIN accounts, roles, route guards | [plans/01-auth-rbac.md](plans/01-auth-rbac.md) |
| Households, members, CSV import | [plans/02-roster.md](plans/02-roster.md) |
| Sunday calendar, conducting rotation | [plans/03-calendar.md](plans/03-calendar.md) |
| Talk pipeline, prayers, topics, speaker history, goals | [plans/04-talks-pipeline.md](plans/04-talks-pipeline.md) |
| Knowledge base, pgvector, AI settings, any Claude API call | [plans/05-ai-platform.md](plans/05-ai-platform.md) |
| Hymns, music coordinator, program builder, PDF, public pages | [plans/06-program-music.md](plans/06-program-music.md) |
| Visit tracker, return & report feed | [plans/07-visits.md](plans/07-visits.md) |
| Youth activity profiles, calendar import, coverage | [plans/08-youth-activities.md](plans/08-youth-activities.md) |
| Meeting agendas, PDF email, tithing calculator | [plans/09-meetings-tithing.md](plans/09-meetings-tithing.md) |
| Sacrament ordinance assignments, youth manager, public link | [plans/10-sacrament-admin.md](plans/10-sacrament-admin.md) |
| Notification UI, admin pages, audit viewer, dashboards | [plans/11-notifications-admin.md](plans/11-notifications-admin.md) |
| Theme polish, accessibility, multi-ward scaffolding | [plans/12-polish-multiward.md](plans/12-polish-multiward.md) |
| Hosting, environment variables, Supabase auth URLs, SMTP | [plans/deployment.md](plans/deployment.md) |
| Detailed code style, file naming, test patterns | [plans/conventions.md](plans/conventions.md) |

Never load more than **two** plan files at once. If a task spans more phases than that,
it is too large — split it.

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Server Components by default |
| Language | **TypeScript** | No `.js` source files. No `any` without a comment explaining why |
| Styling | Tailwind CSS | `dark:` variant; mobile-first breakpoints |
| Database | Supabase Postgres | RLS enabled on every table, no exceptions |
| Auth | Supabase Auth | Email/password + username/PIN for youth accounts |
| Realtime | Supabase Realtime | Notifications only in v1 |
| Storage | Supabase Storage | PDFs, uploaded documents, template images |
| Vector search | pgvector | 1536-dim embeddings |
| AI | Claude API — `claude-sonnet-5` | Server-side only. Adaptive thinking |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dims. Second vendor — see §9 |
| PDF | `@react-pdf/renderer` | Server-side render |
| Email | Resend | Agenda + program PDFs only |
| Data fetching | TanStack Query | Client components only |
| Hosting | Vercel | |

**Model note:** `claude-sonnet-5`, and SPEC.md now says so too (it named `claude-sonnet-4-6`
until `ai-a`). `thinking: { type: "adaptive" }` — `budget_tokens` is REMOVED on this model and
sending it is a 400. Use `output_config: { effort: "medium" }` for
message drafting and `"high"` for topic/scripture generation.

---

## 4. Non-Negotiable Rules

These override convenience. Violating one is a bug, not a style preference.

1. **Every table has `ward_id`.** Every query filters on it. Every insert sets it.
   No exceptions — not even for "single ward" tables like `hymns` (that one is the
   sole exception, documented in the schema).
2. **RLS is the security boundary, not the API route.** A route that forgets a check
   must still be safe because the policy blocked it. Write the policy first, then the route.
3. **No AI output reaches a human or a database row without explicit approval.**
   Every generated message, topic, or hymn suggestion is a *draft* the user accepts,
   edits, or rejects. There is no auto-send and no auto-save anywhere in this app.
4. **AI calls are server-side only.** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` never
   reach the browser. No `NEXT_PUBLIC_` prefix on either.
5. **Private notes are private forever.** `visit_private_notes` and
   `activity_private_notes` are readable only by `user_id = auth.uid()`. Not by the
   bishop. Not by an admin. Not by a support query. RLS enforces this.
6. **Every mutation writes an audit log row.** Every POST/PATCH/DELETE on a core table,
   plus login/logout. Use the shared `writeAuditLog()` helper — never inline the insert.
7. **No silent failures.** Every error is caught, logged, and surfaced to the user with
   something actionable. Never `catch {}`. Never swallow a Supabase error.
8. **No secrets in code.** Environment variables only. Never log a token, key, or PIN.
9. **When a server route writes a new field, update the TypeScript type in the same
   change.** Types live in `types/database.ts` (generated) and `types/domain.ts` (hand-written).
   A new column that the frontend model doesn't know about is silently dropped.
10. **Every permission check resolves the ward's role access.** `can()` and `assertCan()`
    take it as a required third argument; a missing one is a type error, on purpose. Resolve
    once per request into a local and pass it down — `cache()` does not dedupe it in a route
    handler. The ward's override is stored as add/remove deltas per role in
    `wards.settings.role_access`; `admin.*` and `sacrament.*` are not overridable in either
    direction, and bishop/counselor always resolve to one identical list.
11. **Tithing data never touches the members table.** No names, no member IDs, no
    linkage. It is a counting worksheet, not a record. Auto-deleted at midnight.

---

## 5. Directory Structure

```
/app                  Next.js App Router — see SPEC.md §Component Structure
  /api                Route handlers (server-only)
  /(auth)             Login, invite acceptance, PIN entry
  /(app)              Authenticated app shell — sidebar, nav, guards
  /public/[slug]      No-auth public pages (assignments, program)
/components
  /ui                 Primitives: Button, Card, Modal, Input, Badge…
  /layout             Sidebar, TopNav, NotificationBell, ThemeToggle
  /<module>           Module-scoped components (roster, assignments, visits…)
/lib
  /supabase           Client factories: browser, server, service-role
  /ai                 Claude client, system prompt assembly, retrieval
  /auth               Session, role resolution, permission checks
  /audit              writeAuditLog()
  /notifications      emitNotification()
  /pdf                Program + agenda renderers
  /validation         Zod schemas, shared between client and server
/types
  database.ts         Generated from Supabase — do not hand-edit
  domain.ts           Hand-written app types, enums, role definitions
/supabase
  /migrations         Numbered SQL migrations
  /seed               Hymns, base topics, notification triggers
/plans                Implementation plans (see §2)
/tests                Test suites mirroring /app and /lib
```

---

## 6. Code Style

Full detail in [plans/conventions.md](plans/conventions.md). The short version:

- **Named exports only.** No default exports, including pages (Next.js pages are the
  one forced exception).
- **Descriptive names, no abbreviations.** `conductingCounselorId`, not `condCounsId`.
- **Small, single-purpose functions.** If it needs a comment to explain what it does,
  split it.
- **No comments unless asked.** Exception: a comment explaining *why* a non-obvious
  constraint exists is welcome. Comments explaining *what* the next line does are not.
- **Server Components by default.** Add `"use client"` only when you need state,
  effects, or event handlers.
- **Zod at every boundary.** Validate request bodies in route handlers. Reuse the same
  schema in the form.
- **Dates are `date` (no time) for Sundays and visits; `timestamptz` for events.**
  Never store a local-time string.
- **snake_case in SQL, camelCase in TypeScript.** Map at the data-access layer, once.

---

## 7. Roles

Nine roles. The full access matrix lives in `types/domain.ts` and is enforced by RLS
plus `lib/auth/permissions.ts`.

`bishop` · `counselor` · `ward_secretary` · `executive_secretary` · `org_president` ·
`org_counselor` · `org_secretary` · `music_coordinator` · `ward_council_member`

Plus `sacrament_manager` — a youth account authenticated by username + PIN, with access
to exactly one module.

**Bishopric admin authority is shared.** Bishop and both counselors have identical admin
rights. Any admin change notifies the other two — this is a product requirement, not a
nicety. Never build a check that grants the bishop something a counselor lacks.

---

## 8. Testing

Tests accompany new code by default. Priority order when time is short:

1. **RLS policies** — the highest-value tests in this codebase. For each table, prove
   that a user of role X in ward A cannot read or write ward B, and cannot read another
   org's data. Use the service-role client to seed, the anon client to assert.
2. **Permission helpers** — table-driven tests over the role matrix.
3. **Pipeline state transitions** — the talk pipeline has 9 stages; test the legal
   transitions and that illegal ones are rejected.
4. **Rotation and calculation logic** — conducting rotation, sacrament rotation,
   tithing totals, visit-goal status. Pure functions, cheap to test.
5. **Route handlers** — happy path plus the auth-denied path.

AI generation is not unit-tested for output quality. Test that the route assembles the
right prompt, calls with the right params, and handles an API error.

### Route handler tests — how

**A route test does not need a server.** Six retros in a row recorded the opposite; it was never
true. A route handler is an exported async function taking a `Request` and returning a `Response`,
so calling it is an ordinary function call. The only obstacle is `createServerSupabaseClient()`
reading `next/headers`, and `tests/helpers/routeClient.ts` mocks exactly that module and nothing
else. Read its header comment before writing your first one — it documents the `vi.mock` hoisting
trap, which is the single most likely hour to lose.

```ts
// @vitest-environment node
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

await actAs(fixtures, "bishop");
const { GET } = await import("@/app/api/assignments/route");
const { status, body } = await readResponse(await GET(jsonRequest(url)));
```

- **Only the client factory is mocked.** Every query still runs against the hosted project as a
  genuinely authenticated user, so a passing route test proves the RLS policy allowed it. Mock the
  client itself and you get a suite that passes while the app leaks.
- **Seed exactly like an RLS suite** — `seedFixtures(handles)`, `fixtures.cleanup()` in `afterAll`.
  The obligations in §9 apply unchanged.
- **`params` is a Promise in Next 16:** `PATCH(request, { params: Promise.resolve({ id }) })`.
- **Assert a refused write by RE-READING the row** with the service client. An RLS-denied UPDATE or
  DELETE is a zero-row success, not an error — only INSERT raises.
- **Check the fixture's real permissions before asserting a 403.** `music_coordinator` holds
  `talks.view`; `org_president` does not. The permission matrix in `lib/auth/permissions.ts` is the
  source of truth, and it is not always the intuitive answer.
- **Covered so far:** the four assignment routes. The remaining 23 are a documented follow-up, not
  an oversight — the helper is what makes backfilling them cheap.

---

## 9. Known Risks & Open Decisions

Flag these when they become relevant; do not silently pick a side.

- **Local vs hosted database — DECIDED: hosted.** There is no local Docker stack. The dev
  machine is Windows 11 Home with 2 cores, 7.7 GB RAM, and ~10 GB free disk — not enough
  for Docker Desktop plus the ten containers `supabase start` runs. All `db:*` scripts
  target the linked hosted project `WLT` (`dtlvpeqirajfbqaydcgr`) via `--linked`. Do not
  re-propose `supabase start` or add `db:start`/`db:stop` back. Consequences: `npm run
  db:reset` **wipes the hosted database**, and RLS tests run over the network against a
  shared project, so they must clean up after themselves and cannot assume an empty table.
- **Second AI vendor — DECIDED.** Embeddings use OpenAI `text-embedding-3-small` (1536
  dims) alongside the Anthropic key. Two vendors is accepted. Do not re-propose Voyage AI
  or Supabase `gte-small`; switching later means a schema migration and a full re-embed
  of the standard works.
- **Native SMS handoff.** The app opens `sms:` links with a pre-filled body. Behavior
  differs across iOS/Android and long bodies get truncated. Test on real devices before
  relying on it. There is no delivery confirmation — the user taps "sent" manually.
- **Public pages leak surface.** `/public/[slug]` is unauthenticated. It must expose
  first name + last initial only, never phone numbers, addresses, or notes. Every field
  added to a public page is a privacy decision.
- **Address geocoding.** The visit-tracker map needs lat/lng. No geocoding provider is
  chosen. Map view is optional — ship the list view first.
- **Google Calendar sync** for youth activities needs OAuth and token refresh. ICS
  upload is far simpler. Ship ICS first, treat Google sync as a stretch goal.

---

## 10. Working Agreement

- **Before writing code:** restate the goal, check for existing patterns in the codebase,
  list the files you will touch. Wait for confirmation if it is more than one existing file.
- **Stay in scope.** Do not refactor adjacent code, restructure folders, add dependencies,
  or rename files without asking.
- **One problem at a time.** Do not chain unrelated fixes into one change.
- **Prefer boring.** A proven pattern already in this repo beats a cleverer new one.
- **When finished:** summarize what changed and why, then list specifically what to test
  or verify.
- **Never commit.** The user commits manually. Do not run `git commit`, `git push`,
  `git reset`, or any destructive git command.

---

## 11. Retro Context

If `plans/retros/INDEX.md` exists, scan it before planning work in an area and read any
relevant entries — they record what broke before and why. If it does not exist yet, that
is fine; the project has not been onboarded to retros.
