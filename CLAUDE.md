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
    linkage. It is a counting worksheet, not a record — one shared worksheet per ward,
    auto-deleted 48 hours after its first entry. The window is elapsed time on a
    `timestamptz`, never a local midnight, and the read path filters on it so an expired
    worksheet stays invisible even if the sweep has not run.

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
  /supabase           Client factories: browser, server, service-role, anon (public pages)
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
- **Vector index — DECIDED: HNSW, not ivfflat.** `05-ai-platform.md` specified ivfflat and said
  to build it after ingestion, because ivfflat trains its centroids on the data present at build
  time. Migration 031 uses HNSW instead: no training step, correct on an empty table, correct as
  rows arrive, better recall at the same query cost. The "build it afterwards" instruction becomes
  unnecessary rather than forgotten. Do not re-propose ivfflat. The migration refuses to apply on
  a database with no `hnsw` access method (pgvector < 0.5.0).
- **PDF text extraction — `unpdf`.** A third-party dependency with zero runtime dependencies,
  built for serverless, bundling its own PDF.js so there is no worker to configure on Vercel.
  Chosen over `pdf-parse` (unmaintained; reads a test fixture from disk at import time, which
  breaks when bundled) and raw `pdfjs-dist` (worker plumbing that differs between dev and Vercel).
  **Extraction is lossy on multi-column and heavily formatted layouts.** A conference talk usually
  extracts cleanly; a formatted newsletter may not. `parseDocument()` refuses anything under ~200
  characters with a message naming the likely cause, so a scan fails at upload rather than becoming
  a document with zero useful passages.
- **`lib/knowledge/queries.ts` imports the server client DYNAMICALLY**, unlike every other
  queries module. `supabase/scripts/ingestStandardWorks.ts` runs under plain Node, where
  `next/headers` cannot be imported at all — a static import would make the module unloadable
  from the script that shares its pipeline. That script also needs
  `supabase/scripts/register.mjs`, a ~20-line resolver hook teaching Node the `@/*` alias.
- **Native SMS handoff.** The app opens `sms:` links with a pre-filled body. Behavior
  differs across iOS/Android and long bodies get truncated. Test on real devices before
  relying on it. There is no delivery confirmation — the user taps "sent" manually.
- **Public pages leak surface — the boundary is `lib/program/publicProjection.ts`.**
  `/public/[slug]` is unauthenticated and the app is live, so a page is public the moment it
  deploys. **Names are published IN FULL — first and last, everybody, the same on the paper and on
  the web.** That reverses the original "first name + last initial" rule, by a product decision on
  2026-08-24: shortening only the ward members while naming a visiting speaker in full read as a
  bug rather than as a rule, and a sacrament programme names the people taking part. What is
  **never** published is a phone number, a street address, an email, a member or user id, the
  leadership contacts array or the missionary block — those fields are ABSENT from `PublicProgram`,
  not nulled, so publishing one is a type error rather than a review miss. The page is served
  `noindex` (`app/public/layout.tsx`) so a ward roster of full names is reachable by anyone holding
  the link without being gathered into a search index; that is a smaller promise than the
  shortening was, and it is deliberate. `programs.public_data` holds nothing but
  `toPublicProgram()`'s output, is written only by the approve route, and is cleared to null
  whenever a program returns to draft. Every field added to a public page is a privacy decision.
  **Phase 10's `public_sacrament_assignments` view still shortens to a last initial**
  (`left(last_name, 1)` in migration 019) — it was not touched here, and whether the two public
  pages should agree is Phase 10's question to settle.
- **Visit goals — DECIDED: a rolling cadence, no period.** A goal is "visit every household once
  every X", where X is an amount plus a unit (`day`/`week`/`month`/`year`), and progress is measured
  from **each household's own last completed visit**. There is no `goal_period_start`/`_end`; the
  optional `deadline` is presentation only and drives no arithmetic. This replaced a dated-period
  model that produced a row reading "✓ Visited" directly above a banner counting it as unvisited —
  both numbers correct, disagreeing, at the start of every period. Do not re-propose a period.
  The five status buckets are gone with it: four bands (`never_visited` > `overdue` > `approaching`
  > `on_track`) plus a fraction-of-interval-elapsed, and `attempted_never_reached` is expressed as
  a mark beside the band rather than as a band, because it was a *reason* occupying a *position*.
  `lib/visits/cadence.ts` and `householdVisitPriority()` are deliberately not visit-specific in
  their parameters — Phase 8's youth-activity coverage should import them. Migration 051 (the
  column drops) is applied **after** the deploy, never before.
- **A household's cadence override is a join table, not a column — DECIDED, after a reversal.**
  `household_visit_cadences (household_id, org_id)` unique. The same family can be on a 3-month
  cadence for the Elders Quorum and a 12-month one for the Relief Society at the same time, which a
  `households` column could not express — the second organization would silently overwrite the
  first. `org_id` is `NOT NULL` there, unlike `visit_goals.org_id`: a null-org row would be
  invisible to its own author under `org_id = current_org_id()`. Written under
  `visits.manage_goals` on its own route, **not** under `roster.manage` — an org president owns
  that decision and does not own the roster.
- **`households.do_not_contact` is a separate axis from `members.status`.** The member status
  answers "may we call this person"; the household flag answers "may we call on this family at
  all". A do-not-contact household stays on the roster, stays **visible and marked** on the visit
  dashboard, and is counted in **nothing**. Do not fold it into `isVisitableHousehold()` — that
  would make the household vanish, which is exactly what the decision refused, and the record of
  what happened before the decision is what the next presidency needs.
- **Per-organization stewardship — DECIDED: one table, and absent means the whole ward.**
  `household_stewardships (household_id, org_id)` unique, answering "are they ours to visit at
  all". **Zero rows for an organization means every visitable household**, so no ward's numbers
  move on the day it ships — the same absent-means-default idiom as `household_visit_cadences`.
  That gives **three** distinct reasons a household is not counted, and they must stay distinct:
  no active members (absent from the page), do-not-contact (**shown, marked**, counted in nothing),
  and outside the stewardship (**absent from that organization's page entirely**). Collapsing any
  two loses what a presidency needs. `lib/visits/progress.ts`'s `describeHouseholdForVisits()` is
  the single place that rule lives, so the picker and the denominator cannot drift; the picker is
  deliberately a **superset** of the denominator and marks the difference, because a leader who
  visited a family anyway must be able to record it.
  **The empty bulk replace is REFUSED**, with a sentence naming the alternative: with one table,
  "narrowed to nothing" and "not narrowed" are the same zero rows, and silently choosing the second
  would widen an organization back to the whole ward. If a ward ever genuinely needs an empty
  stewardship the fix is an org-level flag column, not a workaround.
  `lib/visits/stewardshipScope.ts` is **subject-agnostic** (`subjectId`, never `householdId`) so
  Phase 8's youth coverage imports it rather than writing a second meaning of the word.
  **Open, and worth settling before the all-organizations view is relied on:** only the *Bishopric*
  is excluded from claiming, so Young Men, Young Women and Sunday School each claim every household
  and make "unclaimed" permanently false. Deciding it by "has a visit goal" does **not** work —
  goals are not readable across organizations, so the answer would differ per reader.
- **Cross-org visibility widens an organization's whole PROGRESS — DECIDED 2026-08-27, REVERSING
  ITER-018.** `ward_allows_cross_org_visibility()` now appears in **four** SELECT policies:
  `visit_logs_select` (019), `household_stewardships_select` (052), and — added by migration 053 —
  `visit_goals_select` and `household_visit_cadences_select`.
  It previously appeared in only the first two, and the contrast was itself the decision ("facts
  are shared, judgements are not"). That was reversed after walking scenario 048: an org leader saw
  the other organizations' chips on the all-organizations view but no **bands**, and the page had
  to explain per chip that the number was being withheld. A ward turning this setting on is asking
  for that number. **The cadence had to follow the goal** — a band prefers the per-household
  override, so widening the goal alone would have rendered a pill computed from the wrong interval,
  and a number that is visible and wrong is worse than one withheld.
  **What did not move: every WRITE policy, and `visit_private_notes`.** Wider reads on shared work
  do not widen a private note by one row (rule 5). `tests/rls/visit-cross-org.test.ts` asserts all
  four tables on **both** sides of the setting, and the reversal is written there as an inversion
  rather than a rewrite so it reads as a decision. No `if (isBishopric)` decides what is readable
  anywhere (rule 2).
- **An organization claims households only if it has a visit goal — DECIDED 2026-08-27.** This
  replaced a hardcoded "not the Bishopric" exclusion in `lib/visits/allOrgProgress.ts`, which was a
  special case standing in for the general rule it could not express: a ward has seven
  organizations, so Young Men, Young Women and Sunday School each claimed **every** household
  (absent means everything) and made "unclaimed" impossible to reach in any real ward. The rule
  is only safe because it is **uniformly evaluable** — the all-organizations page is reachable only
  by the bishopric or with cross-org visibility on, and migration 053 makes every goal readable in
  both cases. **If that widening is ever reversed, this rule becomes reader-dependent** — two
  people would see different unclaimed counts from the same data — and must be reconsidered with it.
- **Youth activities: reads are ward-wide, writes are org-scoped — DECIDED 2026-08-27.** Migration
  019 left a note addressed to Phase 8 asking whether youth activity coordination is genuinely
  org-private. **It is not.** FEATURES.md §Module 10 and `08-youth-activities.md` both give the ward
  council the *full* calendar, because seeing across the organizations is the entire reason a ward
  council exists. What is private is the WRITING: an Elders Quorum president entering an activity
  "for the Young Women" is not coordination, it is somebody believing they did something they did
  not. So migration 054 leaves `youth_activity_profiles_ward_select` **untouched** and replaces only
  the three write policies, and the contrast is the decision. `org_id` goes on
  `youth_activity_profiles` **alone** and is nullable — **null means ward-wide**, the same
  absent-means-default idiom as `household_stewardships` and `household_visit_cadences`, with no
  sentinel row meaning "everybody". Events, attendees and logs inherit their organization through
  the profile; a second copy of the answer could disagree with the first. Every write policy carries
  an explicit `org_id is null` branch, because `org_id = current_org_id()` is NULL rather than true
  when both sides are null and `ward_council_member` — the widest role in the app — is the role most
  likely to have no organization at all. Consequently `POST /api/youth/profiles` **departs from
  `visit-goals`**: a null-org author gets a 201 and a ward-wide row, not the 409 a goal gets. A goal
  with no org is invisible to its author; a profile with no org is visible to everybody. Do not
  re-propose making the read org-scoped "for consistency" — the asymmetry *is* the feature.

- **Youth event coverage is computed on read; `covered`/`uncovered` are gone from the column —
  DECIDED 2026-08-27.** Migration 054c narrows `activity_events.status` to
  `upcoming | cancelled | completed`. Coverage is a pure function of `(event_date, event_type,
  attendee count, now)`, exactly as `appointmentViewState()` computes "missed" and
  `householdVisitPriority()` computes "overdue" — and a stored value the clock decides goes stale
  the moment nobody refreshes it. **Nothing in this project refreshes anything:** `pg_cron` is not
  enabled, `supabase/functions/` does not exist, and `vercel.json` declares no crons.
  `youth_event_uncovered` and the Monday away-digest therefore join `visit_overdue` and
  `refresh_goal_status()` as **Phase 11's** decision — that is now four things that are computable
  and fire from nothing, and Phase 11 should settle the mechanism once for all of them.
  `cancelled` is a deliberate addition to SPEC.md's four values: a called-off game is a fact a
  person knows and nothing else can express, and without it the only way off the list is a delete
  that loses the record it was ever scheduled. Slice C should revisit whether `completed` earns its
  place — an event in the past is completed by the clock too.

- **Address geocoding.** The visit-tracker map needs lat/lng. No geocoding provider is
  chosen. Map view is optional — ship the list view first.
- **Google Calendar sync** for youth activities needs OAuth and token refresh. ICS
  upload is far simpler. Ship ICS first, treat Google sync as a stretch goal.
- **Conference talk corpus scope — DECIDED: curated, not exhaustive.** The standard works are
  ingested in full via `knowledge:ingest`. General Conference is ingested **forward from now,
  plus roughly the last two years** — do not backfill decades. Two reasons, and the second is the
  one that matters: the manual cost is real (conference talks go through the per-file upload path,
  not the scripture corpus script), but more importantly `retrieveChunks` returns only 6–8 chunks
  across the *entire* corpus, so every talk added competes with the Book of Mormon for those slots.
  Tens of thousands of chunks of doctrinally excellent, semantically near-identical material will
  crowd scripture out of the top 8 on almost every query, and the 0.3 similarity floor will not
  save you — those are not weak matches, they are good ones. More corpus is not monotonically
  better here. Do not re-propose replacing the corpus with the API's web search tool: it returns
  whole pages (violating `ai-b`'s "no whole document is ever sent to Claude"), it is
  non-deterministic run to run, and it makes the ward's Conference Talk Preferences meaningless.
  If open-web research is ever wanted it is a **separate, explicitly labelled mode**, never mixed
  into the retrieval that feeds approved drafts.
- **Conference talk acquisition — human-triggered only.** There is no official API for conference
  talks, so any bulk ingest means fetching from `churchofjesuschrist.org`. That content is
  copyrighted by Intellectual Reserve, and automated bulk downloading is governed by that site's
  terms of use and `robots.txt` — **read them before building any fetching step**, and check
  whether a sanctioned bulk or export source exists first. Independent of that: no scheduled
  scraper. It would break silently when markup changes, and it would break between conferences,
  so the failure surfaces exactly when the corpus is needed. More to the point, a cron job writing
  35 documents into the corpus unattended is the one place rule §4.3 would not be holding. The
  sanctioned shape is `npm run knowledge:ingest-conference` — a person runs it twice a year, it
  reports what it found, and it waits for a confirm.

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
