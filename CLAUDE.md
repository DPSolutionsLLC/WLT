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

- **An ICS import reads a floating time in the WARD's zone, and an all-day entry at ward midnight
  — DECIDED 2026-08-27.** `DTSTART:20270115T193000` carries no zone: half past seven in no
  particular place. Refusing such files was rejected — school feeds publish them routinely, and
  refusing would leave manual entry as the only path for exactly the wards this feature is for. So
  `wards.settings.timezone` gains its **first reader in the whole repo**
  (`lib/ward/wardTimezone.ts`); it has been seeded since Foundation B and two migrations refer to
  it in comments without anything reading it. There is still **no editing UI** for it — that is a
  Phase 11 admin screen, and `lib/ward/crossOrgVisibility.ts` is the pattern.
  The preview shows the resolved hour **and says per event that the file gave no zone**, so a
  leader reads "7:30pm" before confirming rather than after. An unresolvable `TZID` does the same
  and additionally names the zone it asked for: silently treating it as UTC would be the wrong
  hour with no trace, which is worse than a wrong hour somebody was shown.
  `activity_events.all_day` (migration 055) exists because without it every tournament weekend
  renders "12:00am", which on that screen is **indistinguishable from the off-by-N-hours bug this
  slice is most likely to produce** — the marker is what keeps a real bug legible.
  **`ICAL.Time.toJSDate()` is called nowhere.** It resolves a floating time against the *process's*
  zone — America/Denver locally, UTC on Vercel — so it is a bug that passes every test on the dev
  machine and ships wrong. `parseIcs.ts` carries a wall clock and a zone NAME; `resolveInstant.ts`
  is the one place they become an instant, it is pure, and it takes **two** offset-correction
  passes because one is wrong for an hour twice a year. `parseWardTimezone` also refuses a bare
  offset (`-07:00`) that `Intl` would happily accept: a fixed offset has no daylight saving, so it
  would put every summer game an hour out with nothing saying why.

- **An imported event that vanishes from a re-imported file is LEFT ALONE — DECIDED 2026-08-27.**
  The confirm performs **no deletes and no status changes**, ever, and the preview names the
  absent events so the guarantee is visible rather than theoretical. A feed that briefly publishes
  a short file must not be able to cancel a season, and a re-import must never destroy something a
  leader typed, corrected, or cancelled by hand. On a row that *did* match, only `title`,
  `location`, `event_date` and `all_day` are written: `status` and `event_type` are never touched,
  so a hand-cancelled game stays cancelled and slice C's home/away correction survives every future
  import. *The trap this avoids:* "absent from the file" is computed **within the window the file
  itself covers**, never against all time — recurrence is expanded only ~12 months ahead, so over
  all time every past game the feed ever produced would qualify.
  Idempotence lives in the DATABASE, not in TypeScript: migration 055's
  `(ward_id, calendar_id, source_uid, source_recurrence_id)` unique index carries **`nulls not
  distinct`** — without it two rows with a null `source_recurrence_id` would not conflict, the
  talks-d hole again — and a **partial `where`** that keeps hand-entered rows (null on both) out,
  since under `nulls not distinct` every one of them would otherwise collide with every other.
  `08-youth-activities.md`'s "match on UID where present, else title + date" is deliberately NOT
  implemented as two rules: a `VEVENT` with no `UID` gets a deterministic synthesised one
  (`wlt-synth-…`), so there is one match key and one code path.

- **An unmatched location is `tbd`, never `away` — DECIDED 2026-08-28.**
  `lib/youth/classifyLocation.ts` returns `home` or `tbd` and has no branch that can return
  `away`. Absence of a match is not evidence of an away game: "Lincoln HS Gymnasium", "Lincoln
  High — auxiliary gym" and a plain typo all fail to match a venue list holding
  "lincoln high school", and every one of them is a home game. An `away` event carries **no
  coverage expectation by design** (`08-youth-activities.md` §Step 4), so a wrong `away` guess
  silently removes the event from the coverage model — nobody is asked, nobody notices, and no
  badge anywhere says so. `tbd` is loud instead: it ranks second in `COVERAGE_STATES`, renders
  "Home or away?", and asks a person for the one fact only a person has. **`away` is always a
  human's word.** This is the kind of rule a later reader "improves" with fuzzy matching; the cost
  of reversing it is a game nobody is asked to attend. Matching is deliberately boring —
  lower-case, collapse whitespace, `includes()` — because a near-miss a clever matcher would catch
  is exactly the case where a person should be asked. `wards.settings.home_venues` normalises on
  write so the classifier normalises only the location side, and the **fallback is the empty
  list**: an unconfigured ward classifies nothing rather than guessing.
  Migration 056 also **drops `completed` from `activity_events.status`**, closing the question
  054c addressed to this slice by name — an event in the past is completed by the clock, and
  follow-up state is `activity_logs`' business in slice D. `activity_attendees` keeps migration
  019's ward-wide SELECT **untouched and load-bearing**: coverage is computed from an attendee
  count, so a narrower read would make the same event read covered to one leader and uncovered to
  another from the same data. Writes are narrowed to `is_bishopric() or user_id = auth.uid()` —
  never `assigned_by`, which is null on a self-add and would be the `talks-d` hole again.
- **A youth activity FOLLOW-UP is org-scoped, while the calendar stays ward-wide — DECIDED
  2026-08-28.** This is the one read Phase 8 narrows and it goes the opposite way from the entry
  above, deliberately. That entry says "do not re-propose making the read org-scoped for
  consistency — the asymmetry IS the feature", and it is about COORDINATION data. **A pastoral
  follow-up note is not coordination data.** 08-youth-activities.md §Step 5 asks for "the same
  shared/private split as Phase 7, with the same rules", and Phase 7's rule for `visit_logs` is
  `is_bishopric() or org_id = current_org_id() or ward_allows_cross_org_visibility()`. Migration
  057c gives `activity_logs` that shape plus `logged_by = auth.uid()`, resolved through the event's
  profile by a `security definer` helper — a LEFT JOIN with an explicit `profile.org_id is null`
  arm, because absent still means ward-wide and an inner join would hide such a log from everybody
  but the bishopric. **`youth_activity_profiles`, `activity_events` and `activity_attendees` keep
  their ward-wide SELECT untouched**; the calendar promise in FEATURES.md §Module 10 is kept in
  full, and `activity_attendees`' read stays load-bearing for coverage (056c).
  **The cost is named rather than discovered:** `ward_council_member` — the role most likely to
  have no organization at all, and one of the two this module was built for — sees only ward-wide
  follow-ups, its own, and everything when cross-org visibility is on. That is the price of the
  decision, **not** a bug to patch with an `if (role === 'ward_council_member')` branch, which
  would be rule 2 broken in the most literal way available. `/youth/feed` states which mode the
  ward is in **in words**, with its own labels rather than
  `CROSS_ORG_VISIBILITY_STATE_LABELS` (whose two sentences both say "visit reports" and neither of
  which mentions a calendar that stayed open). If a walk finds it too narrow the fix is a product
  decision about the setting, not a special case for one role.
  **A policy cannot express column immutability, and 057c tried.** Its UPDATE carried
  `with check (… and logged_by = auth.uid())`, meaning to stop reattribution while letting the
  bishopric clear a flag. WITH CHECK sees only the row that WOULD RESULT, never the row that was —
  so it locked the bishopric out of touching another author's follow-up at all, which is the one
  thing the USING clause had gone out of its way to allow. `tests/rls/activity-logs.test.ts` caught
  it on its first run and **migration 058** replaces the policy with one predicate on both halves,
  the shape `visit_logs_update` has. The author guarantee lives where
  `visit_logs.recorded_by`'s does: `updateActivityLogSchema` has no `loggedBy` field and
  `updateActivityLog()` never assigns the column. **There are no triggers anywhere in this repo**;
  do not add the first one for this.

- **Youth support is CONFIRMED attendance, HOME games only, over the whole profile — DECIDED
  2026-08-29.** `/youth` shows one card per YOUNG PERSON with one pill per activity, and the pill's
  percentage is the share of that activity's past home games where at least one leader actively
  said "I went". Three narrowings, each with its own reason: an **away** game carries no coverage
  expectation by design, so counting one manufactures alarm about a rule working correctly (it is
  the same `isExpectedPast()` the pastoral half already applies, reused rather than restated);
  being **down** for a game is a plan, not an attendance, and `confirmed_attendance` is
  `boolean | null` where null means NOBODY HAS SAID EITHER WAY; and there is **no season boundary
  in the schema** — `season_schedule` is free text, so the convention that a profile is created per
  activity per season is what makes "played" mean "played on this profile". (**Superseded
  2026-08-30 — see the `closed_at` entry below.** `season_schedule` is still free text and nothing
  computes against it; what changed is that a whole PROFILE can be closed and leave this
  computation.)
  **THE HORIZON IS EVERY PAST GAME PLUS THE NEXT ONE — not the whole season.** Decided 2026-08-29
  on the user's instruction after walking scenario 057: the number is *the history of support plus
  the plan of support for the next event*. Counting the whole remaining season would let an
  imported fixture list drag every percentage down for a reason nobody did anything about;
  counting only the past would make the number **unmovable**, since no action a leader could take
  today would change it. The next event is therefore judged on whether anybody is **signed up**,
  not on confirmed attendance — nobody can confirm a game not yet played — so this one metric asks
  two different questions of the same column on purpose, and `describeActivitySupport()` names the
  two halves in separate clauses rather than reporting one blended fraction.
  **A NULL PERCENTAGE SORTS LAST IN BOTH DIRECTIONS**, and that is the deliberate OPPOSITE of the
  sort it replaced: `nobody_all_season` sorted `lastAttendedOn: null` FIRST, because there null
  meant "nobody has ever been" — a real signal. Here it means no home game has been played, which
  is no data at all, and `VisitProgressTable.compareNullable()`'s rule applies instead. The two
  rules look identical and are opposite; `tests/lib/youthProfileNeed.test.ts` asserts both
  directions explicitly. It renders as an em dash, **never `0%`** — 0% would put the one person
  nobody could possibly have supported at the top of "least supported", which is `visits-f` exactly.
  **The number measures RECORDED support, not support**, which is why `POST /api/youth/logs` and
  `PATCH /api/youth/logs/[id]` now CREATE the attendee row when an author answers "I went" —
  **reversing youth-d**, whose "no attendee row, no such question to answer" was right until a
  metric started counting the answer. Only on `true`: a row created to record an ABSENCE would put
  somebody on the list the coverage badge counts. `assignedBy` stays **null** there — null means
  they added themselves, and stamping it would be the `talks-d` hole a fourth time.
  **A NULL IS NOW NARROWER THAN "NOTHING PLAYED":** an activity with a home game coming up has a
  real percentage before its season starts, and a next game with nobody down for it is a genuine
  **0%** that sorts first. Only "nothing played *and* nothing coming up" is the em dash.

- **"Did you go?" STAYS ASKED OF EVERYBODY, as an interim — DECIDED 2026-08-29, with the real rule
  written down.** Reviewing scenario 057 the user asked that this question have *specific triggers*
  rather than being put to every leader: the app must not "bug leaders for every single event", and
  the trigger they named is **a leader who had their own youth at the same event** — who should not
  be asked to record supporting their own child, but could be reminded they might support another
  youth who was there.
  **That trigger is not computable today, for two separate reasons, and BOTH must be solved before
  it can be built.** `users` and `members` are UNRELATED rows in this schema — there is no
  `users.member_id` — so the app cannot know which member is a leader's own child; and an
  `activity_events` row belongs to exactly ONE profile, so "another youth who was also there" has
  no answer until ITER-024's occasion link exists.
  Given that, the user chose to **leave the blanket ask in place** rather than revert to attendees
  only, on the ground that it never appears unprompted: it renders only inside the follow-up form,
  after a leader has deliberately pressed "Say how it went" on a past event. Reverting would have
  made the attendee-row-creating path unreachable and put the metric back to reporting neglect that
  did not happen. **This is an interim, not the destination.** When ITER-024 lands, revisit it —
  and do not invent a half-trigger that guesses in the meantime.

- **An occasion is an explicit, stored IDENTITY, and it is the only thing the link carries —
  DECIDED 2026-08-29.** `activity_events.profile_id` is a single foreign key, so an event belongs
  to exactly ONE young person; two team-mates at one game are two rows. Migration 059 adds
  `activity_occasions` — `id`, `ward_id`, `created_by`, `created_at` and **nothing else** — plus a
  nullable `activity_events.occasion_id`. **No name, no date, no place on the occasion**: all three
  already live on the rows, and a second copy could disagree with the first (ITER-024's first open
  question, answered as its own text recommends). Null means "this game is only this young
  person's", the same absent-means-default idiom as `household_stewardships` and 054a's `org_id`,
  with no sentinel occasion meaning "alone".
  **THE LINK IS NEVER INFERRED FROM A MATCHING TITLE AND DATE.** Two school feeds write one fixture
  as "Game against Roosevelt" and "Game vs Roosevelt"; a matcher that caught that would also join
  two different games at the same school on one evening. This is `classifyLocation.ts`'s refusal of
  near-miss matching, in a second place: a near-miss a clever matcher would catch is exactly the
  case where a person should be asked. The ROUTE does not even enforce the same-day rule — an
  all-day tournament entry and a 7:30pm game genuinely can be one occasion — and the picker narrows
  what is *offered* rather than second-guessing an answer somebody gave.
  **`activity_occasions` carries WARD-WIDE policies on all four verbs**, matching `activity_events`
  and pointedly NOT the profile's org-scoped writes (054d). A **cross-organization occasion is the
  point, not an edge case**: an occasion holds a Young Men row and a Young Women row, each leader
  writes about their own organization's young person, and a write policy comparing
  `current_org_id()` would make exactly that unwritable. The read must also be **uniformly
  evaluable** (056c's rule again) — "who else is at this game" cannot have two answers from the
  same data at the same instant, because the occasion's badge is computed from that list.
  **No fourth mirror is added to `lib/youth/activityOwnership.ts`**, which says deliberately that
  there is no `canManageActivityEvent()`: a helper would either restate `true` or invent a rule the
  policy does not enforce. The linking controls gate on `youth_activities.manage` and nothing else.
  **Merging two occasions is REFUSED**, with a sentence naming the alternative — absorbing one into
  the other would move rows nobody named and the audit row would call it an ordinary join
  (`visits-f`'s empty-bulk-replace precedent).
  **`/youth/calendar` MARKS, it does not COLLAPSE.** One card per young person still, with a quiet
  "+N others at this game" line linking to `/youth/events/[id]`. An occasion spans youth,
  organizations and activity types, so collapsing would leave all four of that page's filters
  without a single answer. **The count is computed from the UNFILTERED rows** — filter to Ethan and
  the honest answer is still "+2 others", not "+0" (`roster-b`, restated by `visits-b` and
  `visits-f`); `tests/components/youth/OccasionMarker.test.tsx` is the only place a test can catch
  that rather than a walk.
  **The ICS import does not create occasions**, handed forward from ITER-024 as answerable later.
  Do not build a matching key for it.

- **A SEASON CAN BE CLOSED, AND THAT REVERSES "there is no season boundary in the schema" —
  DECIDED 2026-08-30, BUILT.** The entry above says `season_schedule` is free text, that nothing
  can compute against it, and that a profile therefore *is* a season. The standing rule was to
  design a season model only once a ward was found reusing one profile across years. **That test
  was superseded by a direct product request** (ITER-028), which is a better reason than the one it
  was waiting for: a ward two years in was ranking its youth on games nobody remembers, because
  nothing ever left the support computation.
  Migration 060 adds `youth_activity_profiles.closed_at`, **a timestamp and never a boolean** —
  "when did this season end" is the question the history page asks, and the final percentage is
  **recomputed against that instant rather than stored** (`activitySupport(profile, events,
  new Date(closedAt))`). That is the stored-versus-computed argument this module has now had seven
  times, answered the same way: nothing in this project refreshes anything, so a number is frozen
  because its INPUT is frozen. **Nullable, so a mistake is reopenable** — the same route with
  `{ closed: false }` — and **never a delete**.
  **`closed_at` is the profile's boundary, not a date filtering events.** A closed season leaves
  the ranking WHOLE; `youthNeed()` partitions running from closed once, and the pills, the
  percentage, the badge, the sort and the "Nothing running" sentence all come out of that one pass
  (`youth-f`'s rule, sixth instance).
  **THE GROUPING ON `/youth` IS BUILT FROM EVERY PROFILE, CLOSED ONES INCLUDED, AND THAT IS THE ONE
  LINE THE ITEM TURNS ON.** Filter closed profiles out before `byMember` and a young person whose
  every season has finished produces no group and **vanishes from the ward** — which is exactly
  what ITER-028 says must not happen. They stay, with no pills, "Nothing running. 2 closed
  seasons." and a link to `/youth/history/[member_id]`; `lowestSupport` is already null there and
  `compareYouth` already sorts null **last in both directions**, so they sort last **with no branch
  added for it**. **The wording of that card was WRONG and the walk caught it** (2026-08-31, defect
  060-D1): a fully-closed card was the only one on the page **with no pills at all**, so beside its
  neighbours it read as data that had failed to load and never said *which* activity the young
  person does. **A finished season is now a PILL like any other** — dashed border, the word
  *Finished*, `YouthNeed.closedActivities` carrying the NAMES — and the status line is
  `describeNothingRunning()`'s "No activity running just now." with **no count in it**, because the
  pills name themselves and a number beside a list it duplicates is ITER-022 again. **The finished
  pill carries no percentage**, deliberately: putting a closed season's number back on `/youth` is
  exactly what this item removed. The expanded card's `profileIds` stay ALL of them: the ranking excludes a closed
  season, the schedule is a record of what happened and must not develop a hole.
  **`FollowUpPanel` is deliberately NOT modified** — a closed season's unwritten follow-ups still
  appear in *Waiting on your follow-up*. Closing ends the ranking, not the obligation, or Close
  becomes a way to dismiss work a leader committed to. **`carriesCoverageExpectation()` is
  deliberately NOT modified** either; that is ITER-030's single insertion point.
  **The horizon rule is UNCHANGED on a closed season, confirmed by the user 2026-08-31.** A finished
  season's frozen number still counts the game that was *next* at the closing instant — Ethan's
  track reads 33% and says "and nobody is down for the next one" on a page about finished seasons.
  That was put to the user as a product question and answered **keep it**: it is a faithful snapshot
  of the moment somebody said the season was over. The clause stays with it, because it is what
  explains the denominator — drop the clause and the counts on the card stop adding up. **The ward-wide
  historical overview is CUT** — per-youth history only, because nobody has named the question an
  overview answers.

- **`Remove` ON AN ACTIVITY CANNOT DESTROY A PASTORAL RECORD — DECIDED 2026-08-30.** It deleted
  unconditionally. Migration 009 cascades `youth_activity_profiles → activity_events →
  {activity_attendees, activity_logs → activity_private_notes}`, so one press took a season, every
  sign-up, every follow-up **and the private notes rule 5 calls private forever**; `2809aef` added
  a confirm dialog, and **a dialog that can be clicked through is not protection** (ITER-031).
  **Close is now the primary control and Remove is the exception.** `Remove` renders only when
  `profile.eventCount === 0` — a true embedded PostgREST count on the shared profile query, which
  `ActivityProfileList` predicted by name and deferred to this item. **That gate is EXACT, not a
  heuristic, and a later reader will assume otherwise:** `activity_logs.event_id` has been
  `NOT NULL` since migration 057a and references `activity_events`, so **no events implies no
  follow-ups**.
  **The server refuses independently** (rule 2): `DELETE /api/youth/profiles/[id]` answers **409**
  when any follow-up exists, with a sentence naming Close as the alternative — `visits-f`'s
  empty-bulk-replace precedent, refuse *and* name the way forward. **The count is not disclosed and
  neither is any content**, because `activity_logs` reads are org-scoped (057c) and the deleter may
  not be entitled to know whose follow-ups those are or how many (rule 5). **No audit row is
  written for the refusal** — a refused write is not a mutation, which scenario 049's walk
  established. On the path that *does* delete, the audit detail now carries `activityName` and
  `eventCount`; three bare ids was the other half of the defect.
- **A YOUNG PERSON CAN BE RECORDED AS NOT TAKING PART, AND THAT IS A FOURTH LINE IN
  `carriesCoverageExpectation()` — DECIDED 2026-08-31, BUILT.**
  **SUPERSEDED IN PART 2026-08-31 by `youth-j` — see the team-and-roster entry below.** Every
  RULE in this entry survives unchanged: the fourth exclusion, the three states,
  never-inferred, reversibility, "the prompt stops and the door stays open", the branch before
  the clock, and the re-import guarantee. What moved is the STORAGE and one consequence of it.
  `youth_attended` sat on `activity_events`, which was correct only while an event belonged to
  exactly ONE young person; a team's game serves a whole roster, so migration 062d moved the
  fact to `activity_event_participation` and migration 063 drops the column. Two sentences
  below are therefore no longer literally true and are kept for the record: the CHECK
  constraint is gone with the column (its successor is that `member_id` is `not null`), and the
  control is no longer a Yes/No pair on every card — reading as a standing question is exactly
  what raised ITER-033. The support percentage assumed the
  young person was *at* the game and **nothing in the schema could say they were not**, so a youth
  who broke an ankle in December was measured all winter on six games nobody could have attended
  them at. That function already excluded three categories for **one sentence** — *this game could
  not have been a chance to support them*: `away` (no coverage expectation by design), `cancelled`
  (it did not happen), `tbd` (not known to be a home game). ITER-030 found the fourth **missing
  from the list**, not a new idea, and migration 061 is the storage behind it.
  **THREE STATES, AND `null` MEANS NOBODY HAS SAID.** `activity_events.youth_attended` is
  `boolean | null` — the same absent-means-default idiom as `confirmed_attendance`, `closed_at`,
  `occasion_id` and 054a's `org_id`, with no sentinel meaning "present". A `not null default false`
  column would assert on every row a fact nobody stated. **NEVER INFERRED** — not from an empty
  attendee list, not from a cancelled sibling, not from a missing follow-up:
  `classifyLocation.ts`'s refusal of near-miss matching, in a **third** place. `true` is not a
  no-op even though it behaves like `null` in today's arithmetic; it is what gives the control a
  way back that is not a delete, and pressing the active answer again clears to `null` rather than
  to the other claim (060a's rule for `closed_at`, on a column with the same power to move a
  number).
  **A SEPARATE COLUMN, NOT A FOURTH `status` VALUE.** `status` answers *did this event happen*; a
  game the young person missed **still happened**, and under 059 it may share an occasion with rows
  entirely unaffected. The CHECK (`youth_attended is null or profile_id is not null`) is why this
  is a constraint and not a comment — a ward-wide event belongs to no young person, so the question
  has no referent, and `PATCH /api/youth/events/[id]` refuses it with a **400 and a sentence**
  first because a constraint violation is not something anybody can act on.
  **WARD-WIDE, ON `youth_activities.manage`, AND NO POLICY MOVED.** Writing it is an ordinary
  UPDATE under migration 019's ward-wide write policies — the same boundary `Cancel` already runs
  under. `lib/youth/activityOwnership.ts` still has **no `canManageActivityEvent()`** and should
  not grow one; narrowing `activity_events` needs a migration **first**. The control gates on the
  permission alone, so it is never hidden from somebody the API would allow (`youth-a-D1`'s mirror).
  **A MARKED EVENT LEAVES THREE THINGS AND STAYS VISIBLE.** The support number, the coverage badge
  (`not_expected` already ranks last and `CoverageBadge` already renders nothing for it) and the
  follow-up prompt. It stays listed everywhere, carrying a chip whose tone is deliberately **not**
  `Cancelled`'s `--warning` — two different facts must not read as one — and **`isFollowUpWritable()`
  is untouched**, so *the prompt stops and the door stays open*: a leader who turned up and found
  the young person absent is exactly the person whose account is worth having.
  **THE `FollowUpPanel` CONTRAST WITH `youth-h` IS THE POINT.** That slice deliberately left the
  panel alone so a **closed season's** unwritten follow-ups keep appearing — closing ends the
  ranking, not the obligation. Here the obligation **never existed**: nobody was expected to go.
  Same panel, opposite answers, different reasons. And a follow-up already **written** still reads
  `logged` — the branch sits *after* `hasLog`, because demoting a written pastoral note behind a
  fact recorded afterwards would hide the record.
  **BEFORE THE CLOCK, BESIDE `cancelled`.** The branch in `eventCoverage()` is tested before
  `new Date()` is called, so a marked game is `not_expected` at *every* distance — three days out
  and three days past — rather than correct today and wrong next week.
  **AN ICS RE-IMPORT NEVER CLEARS IT.** `youth_attended` joins `status` and `event_type` in what
  `ImportedEventPatch` never touches; `ActivityEvent` gains it as a **required** field, so every
  one of the five construction sites was a compile error until it supplied it (rule 9 enforced by
  the type checker). A profile whose every home game is marked lands on `countedCount === 0` →
  `supportedFraction === null` → **an em dash, never `0%`**, sorting **last in both directions**.

- **A TEAM HAS ONE SCHEDULE AND A ROSTER, AND THAT SUPERSEDES MIGRATION 061'S PLACEMENT —
  DECIDED 2026-08-31, BUILT.** There was no **team** in this app, only one young person's copy of
  one: `activity_events.profile_id` is a single FK, `activity_calendars.profile_id` is `NOT NULL`
  (055c), and the ICS import takes a `profileId` — so eight players on a twelve-game season was
  **eight profiles, eight imports of the same file and 96 rows for 12 real games**, with
  `activity_occasions` re-linking the duplicates one game at a time by hand. The user's model,
  in their words: *import once, assign each youth once, and everything after that is an exception*.
  Migration **062** adds `activity_roster (profile_id, member_id, started_on, ended_on)` and
  `activity_event_participation (event_id, member_id, taking_part)`; **063 is HELD BACK** and drops
  `youth_activity_profiles.member_id` and `activity_events.youth_attended` after the deploy.
  **`youth_activity_profiles` IS NOT RENAMED** — 191 references across 34 files make it churn that
  would bury the real change — but its MEANING is now a team, and every header on it says so.
  **EVERY EXISTING PROFILE BECAME A TEAM WITH A ROSTER OF EXACTLY ONE** (062b), which is lossless
  and moved no screen on the day it applied. **There is no merge path and that is deliberate:**
  collapsing a ward's existing duplicates would destroy one profile's events, sign-ups and
  follow-ups, which is what `youth-h` narrowed `Remove` to prevent and what `visits-f` refused for
  the empty bulk replace.
  **ONE WINDOW FUNCTION, THREE INPUTS, ONE ANSWER.** `memberIsExpectedAt(membership, closedAt,
  eventDate, wardZone)` folds *"the youth left"*, *"the youth joined late"* and *"the season was
  closed out"* into **one rule at one scale** — and that is what closes ITER-033's
  `ActivityCalendar` leak **by construction** rather than by remembering a fourth screen. That leak
  was real and verified: `ActivityCalendar.tsx` and `calendar/page.tsx` contained **no reference to
  `closedAt` at all**, so a closed team's future games raised "Nobody going" for ever. Neither file
  mentions it now either; the window owns the rule. A `date` column and a `timestamptz` are
  reconciled in the **ward's** zone through `wallClockToInstant`, never by
  `eventDate.slice(0, 10)`, which is UTC and puts a 7:30pm Friday game on Saturday.
  **THREE STATES, AND THE THIRD IS THE ABSENCE OF THE ROW.** `taking_part` is `NOT NULL` and that
  is the **contrast** with 061 rather than a departure: 061 needed a nullable column because the
  fact lived on a row that always exists; here the row is written only when somebody answers, so a
  nullable column would be a second spelling of one state. **Clearing DELETES the row, and that
  breaks no rule** — 060a's "never a delete" protects a record somebody *wrote*, and this row holds
  no text, no account and no author's words.
  **AN EMPTY ROSTER STAYS LOUD; A CLOSED SEASON GOES QUIET.** Both produce "zero young people
  expected", and `eventYouthAttendance()` returns a discriminated result so they cannot be
  collapsed by accident. A team nobody has been assigned to lands on `expected` with an **empty
  list** and keeps ordinary coverage — because that is a **normal** state in the user's own flow,
  and answering it "no expectation" would silently remove a freshly imported season from the
  coverage model with no badge anywhere saying so. That is `classifyLocation.ts`'s refusal of
  near-miss matching in a **fourth** place, and it is the branch a future tidy-up will invert;
  `tests/lib/youthRoster.test.ts` names it and scenario 063 walks it.
  **NO POLICY MOVED.** Both new tables carry ward-wide policies on all four verbs, matching
  `activity_events`, `activity_calendars` and `activity_occasions` — the organization is answered
  **once, on the profile** (054d), and 061 had already put `youth_attended` under ward-wide writes.
  The read must also be **uniformly evaluable** (056c's rule, third sighting): the roster decides a
  denominator, so if one reader could see a row another could not, the same game would read covered
  to one leader and uncovered to another from the same data.
  **`carriesCoverageExpectation()` IS NOT MODIFIED** — its four exclusions are `youth-i`'s exactly,
  and only the SOURCE of `youthAttended` moved. `activity_occasions` survives untouched for the one
  thing a roster cannot express: a Young Men game and a Young Women concert on the same evening.
  **The `Remove` on a roster row is UNCONDITIONAL, unlike `youth-h`'s on an activity**, and the
  reason is why it can be: follow-ups and private notes hang off **events**, not off a roster row,
  so it destroys nothing a person wrote. The UI still offers *"Left the team on…"* first, because
  recording a leaving date keeps the games they did play.
  **`?youth=` still names a PROFILE and now resolves to the FIRST young person on its roster** — a
  stated limitation rather than an oversight: a calendar card is a whole team's game and singles
  nobody out, so there is no better answer to give the link. `/youth/calendar`'s young-person
  filter became an **activity** filter and its label says so, because a control that cannot do what
  it says is worse than one that is merely coarse.
  **`lib/youth/policyRefusal.ts` is a new one-function module**, holding `isPolicyRefusal()` — it
  had to leave `queries.ts`, which now imports `rosterQueries.ts` to attach a roster in its mapper,
  and importing back would be a cycle. A second copy is how the two come to map different SQLSTATEs.

- **AN UPDATE NEEDS *BOTH* HALVES OF A POLICY, AND A MIRROR THAT COPIES ONLY `using` IS WRONG —
  DECIDED 2026-08-31 (defect 060-D2).** `youth_activity_profiles_update` carries
  `entered_by = auth.uid()` in **USING** and deliberately **not** in **WITH CHECK**, so that nobody
  can move a profile into another organization. That leaves exactly one divergent shape —
  **`org_id` = another organization AND `entered_by` = me**, which is what a release and a recall
  leave behind — where the row is admitted and the result is refused.
  **A failed WITH CHECK RAISES; a failed USING returns zero rows.** Every write in this codebase was
  built for the quiet one, so the loud one escaped as a **500** reading "Please try again", which
  was untrue. Two fixes, because the UI gate and the route are two expressions of one rule (rule 2):
  `canManageActivityProfile()` now mirrors **USING ∧ WITH CHECK** so the controls are **absent**
  there, and `isPolicyRefusal()` maps SQLSTATE **42501** onto the same `null` the zero-row refusal
  returns, so both kinds of "not yours" give the caller one sentence and a 404. It is applied to
  `closeActivityProfile()` **and** `updateActivityProfile()` — `PATCH /api/youth/profiles/[id]` had
  the identical hole since `youth-a`, and leaving one of two identical paths returning 500 is how it
  comes back. **The mapping is narrow on purpose:** only 42501, so "the policy said no" and "the
  database is broken" never become one message (rule 7).
  **The DELETE policy has no WITH CHECK**, so the database would still permit a delete on such a
  row while refusing an edit; hiding `Remove` there as well is deliberate and is the conservative
  direction — the UI declining what the API would allow is quiet and recoverable, the reverse is
  `youth-a-D1`. **Any future mirror of a policy with a WITH CHECK clause must copy both halves.**

  The refusal needs migration 060b's `activity_profile_followup_count`, a **`security definer`**
  function, for two reasons. **The DELETE policy and the log READ policy are scoped differently and
  they diverge today:** 054d admits a delete on `entered_by = auth.uid()`, and `entered_by` appears
  nowhere in 057c's SELECT — so a leader who created an activity and has since been recalled to
  another organization may delete it while being unable to read one follow-up on it, and a count
  through their own client would return zero. **And the refusal must be uniformly evaluable**
  (056c's rule, 059c's third reason): whether an activity may be destroyed is a fact about the
  ACTIVITY, not about who is looking, or the same DELETE succeeds for one leader and fails for
  another from the same data. The function is safe for three reasons that must all stay true:
  **it returns a COUNT and never a row**, it is **used only to refuse a write**, and
  `current_ward_id()` keeps it **ward-scoped**.
  **An activity with events but no follow-ups still deletes** — Close is advice, not a lock; only a
  written account is protected. **ITER-031's "unlink from the occasion" reading was NOT built**:
  `youth-g` already ships an unlink on `/youth/events/[id]`, and a second entry point would be a
  second meaning of the same word.

- **Phase 11 now inherits SIX clock-driven things, not five.** `youth_followup_prompt` joins
  `youth_event_uncovered`, the Monday away-digest, `visit_overdue`, `refresh_goal_status()` and ICS
  re-sync. It fires from the clock — "after an event passes" — and nothing in this project fires
  from a clock: `pg_cron` is not enabled, `supabase/functions/` does not exist, `vercel.json`
  declares no crons. So it is **computed on read and emitted nowhere**: `lib/youth/followUp.ts` is
  a pure function of `(eventDate, status, isAttendee, hasLog, confirmedAttendance, asOf)`, the
  third instance in this module of the rule that produced `coverage.ts`, `appointmentViewState()`
  and `householdVisitPriority()`. The alternative would be a notification emitted from a GET, which
  puts a write path outside a human confirm (rule 3). `youth-c` deliberately added no sixth; this
  slice does, and Phase 11 should settle the mechanism once for all six.

- **The return-and-report feed is REUSED, not forked — proved 2026-08-28.**
  `components/visits/ReportFeed.tsx` and `ReportTile.tsx` render both modules unchanged. Phase 8
  supplies only a mapper (`lib/youth/reportTiles.ts`) and a fetcher
  (`app/(app)/youth/feed/YouthReportFeed.tsx`, twelve lines), exactly as `visits-c` predicted. Two
  shared halves moved to make that true and both are behaviour-preserving: `toPreviewText` went to
  `lib/reports/preview.ts` so a `lib/youth/*` file need not import `lib/visits/*`, and the
  ward-council recipient resolution went to `lib/notifications/notifyWardCouncilFlag.ts` taking a
  `triggerKey` — `notifyOrgLeadership`'s precedent, and for its stated reason: the opt-out lookup
  inside `emitNotification` is keyed on the trigger, so a hardcoded key would deliver a youth
  follow-up to somebody who had switched visit flags off. `app/api/visits/[id]/route.ts` has **no
  diff at all**, which is how the extraction is shown to be safe rather than claimed to be.
  **ONE string in `ReportFeed` was not generic** — the filter's first option read "Every
  organization" hardcoded — and it became an `allContextsLabel` prop defaulted to that same string.
  Changing it in place is what 08-youth-activities.md §Step 6 authorises and §Pitfalls asks for by
  name; forking the component is the thing to refuse.
  **A youth tile's `authorLabel` is ALWAYS null**, and `lib/reports/types.ts` was amended in the
  same change to say so rather than left contradicting the code. `authorLabel` is WHO WENT, and
  `activity_logs` has no participants table at all — mapping `logged_by` onto it would put "who
  went" on one kind of tile and "who typed it" on the other under the same label.
  **The youth feed orders on `activity_logs.created_at`, not on the event's date**, because a
  log's event date lives on another table and PostgREST cannot order parent rows by an embedded
  column. The tile still DISPLAYS the event's date, in the **ward's** zone — never
  `.toISOString().slice(0, 10)`, which is UTC and puts a 7:30pm Friday game on Saturday. The
  cursor's `occurredOn` half therefore carries the LOG's date and must never be taken from
  `tile.occurredOn`.

- **EVERY DATE FORMATTER NAMES ITS ZONE, AND A TURN-UP-AT TIME IS THE WARD'S — DECIDED
  2026-08-29, REVERSING `visits-b`, `youth-a` AND `youth-c`.** Three files said in their headers
  that a `timestamptz` renders in **the reader's own zone**, because "a game — or an appointment —
  is a time somebody has to turn up at". The intent was right and the mechanism could not deliver
  it: a `"use client"` component is **server-rendered before it is hydrated**, and every one of
  these is seeded with real rows through `initialData`, so the server formats the dates first. On
  a server there is no reader. `undefined` resolved to the SERVER's zone — UTC on Vercel — and
  production served a 7:30pm Friday game as **"Sat, Jan 16, 2027, 2:30 AM"**: wrong day, seven
  hours out, surfacing as React error #418 and as a visible flash before hydration. It was
  invisible in dev, where both sides are `America/Denver` — §9's "passes every test on the dev
  machine and ships wrong", arriving through the RENDER path rather than through an ICS file, and
  **found by opening the deployed build for the first time** rather than by any of 3262 tests.
  The rule is now mechanical: **no `Intl.DateTimeFormat` or `toLocale*` call anywhere in `app/`,
  `components/` or `lib/` may omit an explicit `timeZone`**, enforced by
  `tests/lib/explicitTimeZone.test.ts`, which reads the source the way `tithingNoFloat.test.ts`
  does — no assertion about a formatted string can catch this, because a test process has one
  zone. It was proved able to fail against all seven pre-fix files before being believed.
  **Which** zone stays a per-case decision and the codebase already had both answers: a
  turn-up-at `timestamptz` is the **ward's** zone (`readWardTimezone`, resolved once per page
  beside `asOf` and handed down as a parameter), while a `date` column or a "when did this happen"
  stamp is **UTC** (`lib/calendar/dates.ts`, `VersionHistory`, `ContactStagePanel`). The ward's
  zone is not merely the deterministic choice, it is the better one: a ward is one geographic
  congregation, so for very nearly every reader it IS their zone, and the leader who is travelling
  wants "7:30pm" — the hour the game starts and the hour you would say aloud — not 9:30pm in their
  hotel. **No zone MARKER is rendered beside the time, and that was asked and answered rather than
  overlooked** (2026-08-30, confirming this reversal on the deployed build): "it is to be assumed
  that it is according to that ward's time zone". A marker is not owed and should not be added —
  the ward's clock is the assumption the whole rule rests on, and labelling it would suggest the
  reader might be looking at some other zone, which is exactly what this decision rules out. **`ActivityCalendar`'s "ZONE TRAP" survives intact**: its rule is that a card is bucketed
  into a day in the SAME zone its own time is printed in, and both halves moved together, so the
  invariant it protects is unchanged and only its premise did. `lib/ward/wardTimezone.ts` now
  answers what a floating imported time means AND what day a rendered card belongs to; it used to
  answer only the first. **Still unfixed and unrelated — and it is THREE links, not
  two:** the sidebar is gated on the **permission a reader holds, never on whether the page
  exists** (`lib/auth/navigation.ts`), so a bishop is offered `/agendas` and `/admin/audit-log`
  (both 404) plus `/sacrament`, which answers 307 and **silently returns them to `/dashboard`** —
  the click just does nothing. Phases 9, 10 and 11. **Left deliberately** on the user's instruction
  2026-08-30 ("expected, haven't gotten there yet"); the standing cost is two console errors on
  every page a bishop opens, because Next.js prefetches the two 404s. Any future phase that ships a
  permission before its page will repeat this.

- **Address geocoding.** The visit-tracker map needs lat/lng. No geocoding provider is
  chosen. Map view is optional — ship the list view first.
- **Google Calendar sync** for youth activities needs OAuth and token refresh. ICS
  upload is far simpler. **ICS shipped in `youth-b`**; Google sync stays cut, as
  `08-youth-activities.md`'s own Pitfalls section instructs ("Cut Google sync before cutting
  anything else here"). `ACTIVITY_SOURCE_TYPES` keeps its `google_sync` value and nothing writes
  it. Nor does anything fetch a `source_url`: an import is a file a person uploaded, and a
  server-side URL fetch would be SSRF surface for no gain the phase plan asks for.
  **No cron and no scheduled re-sync**, either. `activity_calendars.last_synced_at` records when a
  PERSON last imported, never when a machine did — automatic re-fetching would put a write path
  outside a human confirm, which is where rule 3 draws its line. This joins
  `youth_event_uncovered`, the Monday digest, `visit_overdue` and `refresh_goal_status()` as Phase
  11's one decision about a mechanism; that makes **five**. **`youth-c` deliberately added no
  sixth** — coverage is computed on read, and `youth_event_uncovered` is emitted nowhere.
  **`youth-d` added the sixth** (`youth_followup_prompt`) and says so below rather than quietly.
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
