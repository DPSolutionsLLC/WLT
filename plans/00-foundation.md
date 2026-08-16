# Phase 0 — Foundation

Project scaffolding, the complete database schema, RLS policies, seed data, and the four
cross-cutting services every later phase depends on.

**Depends on:** nothing. **Unlocks:** everything.
**Reference:** [SPEC.md](../SPEC.md) §Database Schema, §RLS Policies.

> This phase builds **all** tables at once, not just the ones Phase 1 needs. A single
> schema pass is cheaper than 12 incremental migrations, and RLS policies are easier to
> reason about when the whole graph is visible.

---

## Goals

1. A running Next.js + Supabase project with typed database access
2. Every table from SPEC.md created, with RLS enabled and policies written
3. Seed data loaded: hymns, base topics, notification triggers, one ward, one bishop
4. Four shared services working and tested: ward scoping, permissions, audit, notifications

---

## Step 1 — Project Setup

```
npx create-next-app@latest . --typescript --tailwind --app --eslint
```

Add dependencies (ask before installing anything not on this list):

- `@supabase/supabase-js`, `@supabase/ssr`
- `@anthropic-ai/sdk`, `openai`
- `@tanstack/react-query`
- `zod`
- `@react-pdf/renderer`
- `resend`
- `date-fns`
- Dev: `vitest`, `@testing-library/react`, `dotenv`

**Files to create:**

| File | Purpose |
|---|---|
| `.env.local.example` | Every var from SPEC.md §Environment Variables, with empty values |
| `.env.local` | Gitignored. Real values |
| `lib/supabase/browser.ts` | `createBrowserClient()` — anon key |
| `lib/supabase/server.ts` | `createServerClient()` — cookie-based session |
| `lib/supabase/service.ts` | Service-role client. **Server-only.** Add a runtime guard that throws if imported client-side |
| `types/database.ts` | Generated: `supabase gen types typescript` |
| `types/domain.ts` | Roles, enums, permission matrix |
| `tailwind.config.ts` | `darkMode: 'class'`, mobile-first |

Configure dark mode via a `class` on `<html>` driven by `users.theme_preference`, with a
`system` option reading `prefers-color-scheme`.

---

## Step 2 — Database Schema

Create migrations in `supabase/migrations/`, numbered and ordered by dependency:

| # | Migration | Tables |
|---|---|---|
| 001 | `extensions` | `vector`, `pgcrypto` |
| 002 | `core` | `wards`, `organizations`, `users`, `invites` |
| 003 | `roster` | `households`, `members`, `member_organizations` |
| 004 | `calendar` | `sundays`, `conducting_rotation` |
| 005 | `talks` | `topics`, `assignments`, `assignment_approvals`, `assignment_comments`, `assignment_history`, `prayer_assignments` |
| 006 | `music` | `hymns`, `hymn_selections`, `musical_numbers` |
| 007 | `programs` | `programs`, `public_pages` |
| 008 | `visits` | `visit_goals`, `visit_logs`, `visit_private_notes`, `report_read_status` |
| 009 | `youth` | `youth_activity_profiles`, `activity_calendars`, `activity_events`, `activity_attendees`, `activity_logs`, `activity_private_notes` |
| 010 | `goals` | `goals` |
| 011 | `tithing` | `tithing_sessions`, `tithing_entries` |
| 012 | `agendas` | `agendas`, `action_items` |
| 013 | `notifications` | `notifications`, `notification_settings`, `notification_user_prefs` |
| 014 | `knowledge` | `knowledge_documents`, `document_chunks`, `ai_settings` |
| 015 | `audit` | `audit_log` |
| 016 | `sacrament` | `sacrament_rotation_pools`, `sacrament_assignment_managers`, `sacrament_assignments`, `sacrament_send_log` |
| 017 | `threads` | `conversation_threads`, `conversation_messages` — framework only, no UI in v1 |
| 018 | `indexes` | See below |
| 019 | `rls` | Enable RLS + all policies (Step 3) |

Column definitions come verbatim from [SPEC.md](../SPEC.md) §Database Schema. Deviations
from the spec, all deliberate:

- **`sundays.date UNIQUE` → `UNIQUE (ward_id, date)`.** The spec's plain `UNIQUE` would
  prevent a second ward from ever having a Sunday on the same date. This is a bug in the
  spec; fix it here and note it.
- **`goals.target_id` is polymorphic** with no FK. Add a `CHECK` constraint tying
  `target_type` to the expected table, and document that referential integrity is
  enforced in application code.
- **`report_read_status.report_id`** is likewise polymorphic. Add
  `UNIQUE (user_id, report_type, report_id)` so a read-marking upsert is safe.
- **`sacrament_assignment_managers`** — add a partial unique index enforcing
  "only one active manager per ward":
  `CREATE UNIQUE INDEX ... ON sacrament_assignment_managers (ward_id) WHERE is_active`.
- **`notification_user_prefs`** — add `UNIQUE (user_id, trigger_key)`.
- **`document_chunks.embedding`** — add an `ivfflat` index with `vector_cosine_ops`
  after seeding, not before (index quality depends on having rows).

**Indexes to create in 018:** every `ward_id` column; `assignments (sunday_id)`;
`assignments (member_id)`; `visit_logs (household_id, visit_date DESC)`;
`activity_events (event_date)`; `notifications (recipient_user_id, read_at)`;
`audit_log (ward_id, created_at DESC)`; `members (household_id)`.

---

## Step 3 — Row Level Security

**Enable RLS on every table.** A table without RLS is a data leak.

Write two SQL helper functions first — every policy uses them:

```sql
-- Current user's ward. STABLE so Postgres caches it per statement.
CREATE FUNCTION current_ward_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT ward_id FROM users WHERE id = auth.uid() $$;

CREATE FUNCTION current_user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT role FROM users WHERE id = auth.uid() $$;

CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT org_id FROM users WHERE id = auth.uid() $$;

CREATE FUNCTION is_bishopric() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT current_user_role() IN ('bishop', 'counselor') $$;
```

> `SECURITY DEFINER` is required — otherwise the function's own read of `users` is
> itself subject to RLS and recurses. Make sure the `users` policy does not call
> these functions on itself; use a direct `id = auth.uid()` predicate there.

Policy patterns, applied per SPEC.md §RLS Policies:

| Pattern | Applies to | Predicate |
|---|---|---|
| Ward scoping | Every table | `ward_id = current_ward_id()` |
| Bishopric-only | `tithing_*`, `assignments`, `topics`, `ai_settings`, `audit_log`, `members.notes` | `is_bishopric()` |
| Org scoping | `visit_goals`, `visit_logs`, `activity_*` | `is_bishopric() OR org_id = current_org_id()` |
| Private notes | `visit_private_notes`, `activity_private_notes` | `user_id = auth.uid()` — all operations, no bishopric override |
| Cross-org read | `visit_logs` SELECT | org predicate `OR (ward.settings->>'cross_org_visibility')::boolean` |
| Sacrament | `sacrament_assignments` | `is_bishopric()` for all; active manager gets SELECT + UPDATE only |
| Per-user | `notifications`, `report_read_status`, `notification_user_prefs` | `user_id = auth.uid()` |
| Public | `public_pages` and the rows they expose | Readable with the anon key; see the warning below |

**Public page policy — the risky one.** `/public/[slug]` runs unauthenticated, so the
anon role needs read access to *some* rows. Do **not** open `sacrament_assignments` or
`programs` to anon directly. Instead:

- Create SQL views `public_sacrament_assignments` and `public_program` that select only
  the safe columns (first name, last initial, hymn numbers, dates) joined through
  `public_pages` on `is_active = true`
- Grant `SELECT` on the **views only** to the `anon` role
- Keep base-table policies closed to anon

This makes the safe projection the only thing anon can reach, so a later column addition
cannot accidentally leak.

**Tests for this step are mandatory** — see Step 6.

---

## Step 4 — Seed Data

`supabase/seed/`:

| File | Contents |
|---|---|
| `hymns.sql` | All standard hymns: number, title, `topic_tags[]`. Source from a public hymn index; tag by theme for AI matching |
| `topics.sql` | ~40 evergreen gospel topics — title, category, description. No scriptures/talks yet; AI fills those later |
| `notification_triggers.sql` | One `notification_settings` row per trigger key in SPEC.md §Trigger Keys, with sensible `default_roles` |
| `ward.sql` | Dev-only: one ward, six organizations, one bishop user, a handful of households |

Seed script is idempotent (`ON CONFLICT DO NOTHING`) so it can re-run safely.

---

## Step 5 — Cross-Cutting Services

These four exist before any feature code. Every later phase uses them.

### 5.1 `lib/supabase/scoped.ts` — ward-scoped queries

A thin wrapper that reads `ward_id` from the session and applies it to every query. RLS
is the real boundary; this is defence in depth and removes a class of forgotten filters.

```ts
export async function scopedQuery(table: string) { /* returns builder pre-filtered */ }
```

### 5.2 `lib/auth/permissions.ts` — the role matrix

One exported constant mapping role → set of module permissions, plus:

```ts
export function can(user: SessionUser, permission: Permission): boolean
export function assertCan(user: SessionUser, permission: Permission): void  // throws 403
```

The matrix is derived from [FEATURES.md](../FEATURES.md) §User Roles. It is also the
data behind the admin Role Access page in Phase 11 — store it in the database
(`wards.settings.role_access`) with the code constant as the default, so bishopric can
edit it in-app later without a deploy.

**Bishop and counselor must resolve identically for every admin permission.**

### 5.3 `lib/audit/writeAuditLog.ts`

```ts
export async function writeAuditLog(params: {
  wardId: string; userId: string; action: string;
  module: string; detail?: Record<string, unknown>;
}): Promise<void>
```

Never throws — an audit failure must not fail the user's action. Log the failure to the
server console and continue. Called from every mutating route.

### 5.4 `lib/notifications/emitNotification.ts`

```ts
export async function emitNotification(params: {
  wardId: string; triggerKey: string;
  title: string; body: string;
  recipientUserIds?: string[];   // explicit override
}): Promise<void>
```

Resolution order when `recipientUserIds` is omitted:

1. Look up `notification_settings` for the trigger. If `is_globally_enabled` is false, stop.
2. Resolve `default_roles` to user IDs within the ward.
3. Remove anyone with a `notification_user_prefs` row where `is_enabled = false`.
4. Insert one `notifications` row per remaining recipient.

Also never throws. Realtime delivery is automatic — clients subscribe to the
`notifications` table filtered by `recipient_user_id` in Phase 11.

**Helper for the most common case:** `notifyOtherBishopric(actingUserId, description)` —
used by every admin change, per FEATURES.md §Module 15.

---

## Step 6 — Tests

The RLS tests are the most valuable in the project. Write them now, not later.

`tests/rls/`:

| Test file | Asserts |
|---|---|
| `ward-isolation.test.ts` | For every table: a user in ward A gets zero rows from ward B, on SELECT/INSERT/UPDATE/DELETE |
| `org-isolation.test.ts` | An EQ president cannot read Relief Society visit logs when cross-org visibility is off; can read shared notes when it is on; can never write them |
| `private-notes.test.ts` | The bishop cannot read a counselor's private visit note. Assert explicitly — this is the single most important test in the suite |
| `tithing-access.test.ts` | Only bishop/counselor reach tithing tables |
| `sacrament-access.test.ts` | The active manager can update assignments but not rotation pools; an inactive manager can do neither |
| `public-views.test.ts` | The anon role can read the two public views and **nothing else** — assert it gets zero rows from `members`, `visit_logs`, `programs` |

Pattern: seed with the service-role client, assert with a client authenticated as each
role. A helper `asRole(role, orgId?)` returning a scoped client keeps these readable.

Also test the four services: permission matrix (table-driven over all roles × permissions),
audit write, notification recipient resolution including the opt-out path.

---

## Definition of Done

- [ ] `npm run dev` serves a page; `npm run build` and typecheck pass
- [ ] All 19 migrations apply cleanly against a fresh database
- [ ] `types/database.ts` generated and committed
- [ ] RLS enabled on **every** table — verify with a query against `pg_tables`
- [ ] All six RLS test files pass
- [ ] Seed loads hymns, topics, notification triggers, and a dev ward
- [ ] `writeAuditLog`, `emitNotification`, `can`/`assertCan`, `scopedQuery` all exist and are tested
- [ ] `.env.local.example` lists every required variable
- [ ] Service-role client throws if imported into a client component

---

## Pitfalls

- **`SECURITY DEFINER` recursion.** If `current_ward_id()` reads `users` and the `users`
  policy calls `current_ward_id()`, you get infinite recursion. The `users` table's own
  policy must use `id = auth.uid()` or a direct ward comparison, never the helper.
- **RLS off by default on new tables.** Adding a table in a later phase without
  `ENABLE ROW LEVEL SECURITY` silently exposes it. Add a test that fails if any table
  in the schema lacks RLS.
- **`hymns` has no `ward_id`.** It is the one global reference table. Document the
  exception in the migration so the ward-isolation test can skip it deliberately rather
  than by accident.
- **Service-role client bypasses RLS entirely.** Use it only in seed scripts, migrations,
  and the two places that genuinely need it (public page rendering, cron jobs). Never in
  a user-facing route handler.
- **`vector(1536)` must match the embedding model.** Changing the embedding provider
  later means a migration and a full re-embed. Decide before Phase 5.
