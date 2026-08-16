# Plan: Foundation B — Schema, RLS, and Seed Data

**Created:** 2026-08-15
**Type:** feature
**Source:** [plans/00-foundation.md](00-foundation.md) Steps 2–4
**Structure:** Sequential — plan 2 of 3 (A → B → C)

> **Prerequisite:** [foundation-a-scaffold.md](foundation-a-scaffold.md) is complete and
> its Definition of Done passes. There is **no local database** — see CLAUDE.md §9.
> `npm run db:link` connects to the hosted project; every `db:*` script runs `--linked`.
> **`npm run db:reset` wipes that hosted database.**
> **Next:** [foundation-c-services.md](foundation-c-services.md).

---

## Overview

Build the entire database in one pass: 19 numbered migrations covering ~50 tables, RLS
enabled and policied on every one of them, two restricted public views, seed data, and
regenerated TypeScript types.

00-foundation.md's reasoning for doing it all at once holds — one schema pass is cheaper
than twelve incremental migrations, and RLS is far easier to reason about with the whole
graph visible.

**Success criteria**

- All 19 migrations apply cleanly to a fresh database (`npm run db:reset`)
- `SELECT` against `pg_tables` shows RLS enabled on **every** table in `public`
- `types/database.ts` is regenerated and `npm run typecheck` passes
- Seed loads hymns, base topics, notification triggers, and a dev ward idempotently
- The `anon` role can read the two public views and nothing else

---

## ✅ Spec conflicts — RESOLVED 2026-08-15

These were real contradictions between SPEC.md and CLAUDE.md. Per CLAUDE.md §1, the fix
lands in the spec in the same change. **All five are now decided — there is nothing left to
confirm before writing SQL.** Task 9 records each one back into SPEC.md.

### 1. Eleven tables have no `ward_id` (blocking)

CLAUDE.md rule 1 is unambiguous: *"Every table has `ward_id`… No exceptions — not even for
'single ward' tables like `hymns` (that one is the sole exception)."* SPEC.md's schema
omits it on eleven:

`member_organizations` · `assignment_approvals` · `assignment_comments` ·
`assignment_history` · `visit_private_notes` · `report_read_status` ·
`activity_attendees` · `activity_private_notes` · `notification_user_prefs` ·
`tithing_entries` · `conversation_messages`

**DECIDED: add `ward_id uuid NOT NULL REFERENCES wards(id)` to all eleven.**

Reasons, in order of weight:
- It is what the non-negotiable rule requires.
- Without it, every child-table RLS policy needs an `EXISTS` subquery joining to the
  parent. That is slower on every read and much easier to get subtly wrong — a missed
  join is a cross-ward leak with no error.
- Rule 1 also says *"Every query filters on it. Every insert sets it."* Child tables
  cannot honour that without the column.

Cost: a denormalised column that must stay consistent with the parent. Mitigate with a
composite FK where practical, e.g. on `visit_private_notes`:

```sql
FOREIGN KEY (visit_log_id, ward_id) REFERENCES visit_logs (id, ward_id)
```

which requires `UNIQUE (id, ward_id)` on the parent. Postgres then enforces the
consistency for you rather than trusting application code.

`hymns` remains the sole documented exception. Put a comment in migration 006 saying so,
so plan C's ward-isolation test skips it deliberately rather than by accident.

### 2. `users` cannot support youth PIN accounts

FEATURES.md §Module 17 defines youth accounts as **username + PIN, no email**. SPEC.md's
`users` table has neither column. Phase 1 ([01-auth-rbac.md](01-auth-rbac.md)) builds that
flow and would need its own migration.

**DECIDED:** add to migration 002, since this phase builds all tables at once:

```sql
username   text,
pin_hash   text,
```

plus `CREATE UNIQUE INDEX users_username_key ON users (ward_id, lower(username)) WHERE username IS NOT NULL;`

**Never store a raw PIN.** `pin_hash` only, and CLAUDE.md rule 8 forbids logging it
anywhere. Choosing the hash function is phase 1's decision — the column is all that is
needed now.

### 3. `users.role` omits `sacrament_manager`

SPEC.md's role comment lists nine roles; FEATURES.md defines ten. The `CHECK` constraint
in migration 002 must include `sacrament_manager`, matching `ROLES` in `types/domain.ts`
from plan A.

### 4. `members.notes` is bishopric-only, and RLS cannot restrict a column

FEATURES.md §Module 1 makes member notes visible to the bishopric only. An RLS policy grants
or denies a **row**, never a column — so a `notes` column on `members` cannot be protected by
the security boundary CLAUDE.md rule 2 requires.

**DECIDED (user, 2026-08-15): a separate `member_notes` table.**

```sql
CREATE TABLE member_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id    uuid NOT NULL REFERENCES wards(id),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- Lives in migration `003_roster.sql`, alongside `members`.
- Policy: `is_bishopric() AND ward_id = current_ward_id()`, separate per operation.
- `members` gets **no** `notes` column. The rejected alternative — keeping the column and
  never selecting it for non-bishopric roles — fails silently the first time anyone writes
  `select('*')`, and puts the boundary in application code instead of the database.
- This table is **not in SPEC.md**. Task 9 adds it.
- Plan C's ward-isolation test covers it like any other ward-scoped table; it is also worth
  an explicit "a non-bishopric role reads zero rows" case.

---

### 5. Already-approved deviations (from 00-foundation.md, no decision needed)

- `sundays.date UNIQUE` → **`UNIQUE (ward_id, date)`**. Plain `UNIQUE` would stop a second
  ward ever having a Sunday on the same date. Spec bug.
- `goals.target_id` is polymorphic — no FK; add a `CHECK` tying it to `target_type` and
  document that integrity is enforced in application code.
- `report_read_status` — add `UNIQUE (user_id, report_type, report_id)` so read-marking
  upserts are safe.
- `sacrament_assignment_managers` — partial unique index for one active manager per ward.
- `notification_user_prefs` — add `UNIQUE (user_id, trigger_key)`.
- `document_chunks.embedding` — build the `ivfflat` index **after** seeding, not before.

### 6. Minor, no action

FEATURES.md lists "Home address" on the member record; SPEC.md puts `address` on
`households`. SPEC.md is right — address is a household property. No change.

---

## Relevant Files

### Migrations — `supabase/migrations/`

| # | File | Tables |
|---|---|---|
| 001 | `001_extensions.sql` | `vector`, `pgcrypto` |
| 002 | `002_core.sql` | `wards`, `organizations`, `users`, `invites` |
| 003 | `003_roster.sql` | `households`, `members`, `member_organizations`, `member_notes` |
| 004 | `004_calendar.sql` | `sundays`, `conducting_rotation` |
| 005 | `005_talks.sql` | `topics`, `assignments`, `assignment_approvals`, `assignment_comments`, `assignment_history`, `prayer_assignments` |
| 006 | `006_music.sql` | `hymns`, `hymn_selections`, `musical_numbers` |
| 007 | `007_programs.sql` | `programs`, `public_pages` |
| 008 | `008_visits.sql` | `visit_goals`, `visit_logs`, `visit_private_notes`, `report_read_status` |
| 009 | `009_youth.sql` | `youth_activity_profiles`, `activity_calendars`, `activity_events`, `activity_attendees`, `activity_logs`, `activity_private_notes` |
| 010 | `010_goals.sql` | `goals` |
| 011 | `011_tithing.sql` | `tithing_sessions`, `tithing_entries` |
| 012 | `012_agendas.sql` | `agendas`, `action_items` |
| 013 | `013_notifications.sql` | `notifications`, `notification_settings`, `notification_user_prefs` |
| 014 | `014_knowledge.sql` | `knowledge_documents`, `document_chunks`, `ai_settings` |
| 015 | `015_audit.sql` | `audit_log` |
| 016 | `016_sacrament.sql` | `sacrament_rotation_pools`, `sacrament_assignment_managers`, `sacrament_assignments`, `sacrament_send_log` |
| 017 | `017_threads.sql` | `conversation_threads`, `conversation_messages` — framework only, no UI in v1 |
| 018 | `018_indexes.sql` | Indexes (see Task 3) |
| 019 | `019_rls.sql` | Helper functions, RLS enable, all policies, public views |

### Seed — `supabase/seed/`

| File | Contents |
|---|---|
| `hymns.sql` | Standard hymns: number, title, `topic_tags[]` |
| `topics.sql` | ~40 evergreen gospel topics |
| `notification_triggers.sql` | One row per trigger key in SPEC.md §Trigger Keys |
| `ward.sql` | Dev-only: one ward, six organisations, one bishop, a few households |

### Other

| File | Action | Purpose |
|---|---|---|
| `supabase/config.toml` | modify | `[db.seed].sql_paths` lists the four seed files in dependency order. Replaces the planned `supabase/seed.sql`: the seed runner executes plain SQL and does not support psql `\i` meta-commands, and `sql_paths` is already an ordered list |
| `types/database.ts` | modify | Regenerated — replaces plan A's stub |
| `SPEC.md` | modify | Record the four resolved conflicts above |

---

## Dependencies

No new packages. Uses the Supabase CLI (the `supabase` devDependency, v2.114) against the
**linked hosted project** from plan A. There is no local database — see CLAUDE.md §9.

Verified ready as of 2026-08-15: the CLI reaches the remote without prompting for a
password (credentials cached by `db:link`), and `supabase_migrations.schema_migrations` on
the remote is **empty** — this phase starts from a genuinely clean database.

Column definitions come **verbatim from [SPEC.md](../SPEC.md) §Database Schema**, except
where this plan's conflict section overrides them.

---

## Tasks

### Task 1: Migrations 001–017 — tables

**Files:** `supabase/migrations/001_extensions.sql` … `017_threads.sql` (create)
**Action:** One migration per row in the table above, in dependency order.

**Details:**
- 001 is `CREATE EXTENSION IF NOT EXISTS vector;` and `pgcrypto`.
- Copy column definitions from SPEC.md exactly. Apply the six approved deviations and the
  three conflict resolutions above.
- Add `ward_id uuid NOT NULL REFERENCES wards(id)` to the eleven tables listed. `hymns`
  is the only table without one — comment the exception inline.
- Use `CHECK` constraints for every text column SPEC.md documents as an enum, with values
  matching the `as const` arrays in `types/domain.ts` from plan A. If the two ever
  disagree, the database accepts a value the TypeScript union rejects.
- snake_case throughout (conventions.md).
- `date` for Sundays, visit dates, meeting dates, goal periods. `timestamptz` for events
  and timestamps. Never a local-time string.
- **Filenames:** `supabase db push` reads the version from the digits before the first
  underscore, so `001_extensions.sql` is a valid migration and applies in numeric order —
  verified against CLI 2.114, not assumed. Later phases that run `supabase migration new`
  get 14-digit timestamps, which sort after `019`. The two styles coexist correctly; do
  not renumber anything.
- **Apply with `npm run db:push` after each migration, not at the end.** A dependency-order
  mistake at 005 is trivial to find immediately and painful to find at 017. `db:push`
  applies only what the remote has not seen, so it is the cheap inner-loop command. Use
  `npx supabase db push --dry-run` first if you want to see what it would apply.
- **`npm run db:reset` is the ordering proof, and it wipes the hosted database.** Run it
  deliberately at the end of Task 1 and again after Task 7 — not as a fix-up between
  migrations. On hosted it is a full remote drop and re-apply, not a fast local rebuild.
- **Rolling back on hosted is manual.** There is no local database to throw away, so a bad
  migration that has already been pushed is fixed either by a corrective migration or by
  editing the file and paying for a full `db:reset`. Get each file right before pushing it.

---

### Task 2: Tithing schema — the privacy-critical one

**File:** `supabase/migrations/011_tithing.sql` (create)
**Action:** Build `tithing_sessions` and `tithing_entries` with no member linkage at all.

**Details:**
- CLAUDE.md rule 10: *"Tithing data never touches the members table. No names, no member
  IDs, no linkage."* No FK to `members`, no name column, no free-text notes field that
  could hold one.
- `checks jsonb` holds `{check_number, amount}` — **`amount` is integer cents**, per
  conventions.md §Money. Never a float. Add a `CHECK` that amounts are integers.
- `auto_clear_at` is always midnight of `session_date`. The cron that enforces it is a
  later phase; the column is set now.
- Add a SQL comment at the top of the file recording the rule, so nobody adds a
  `member_id` column in six months thinking it would be convenient.

---

### Task 3: Migration 018 — indexes

**File:** `supabase/migrations/018_indexes.sql` (create)

Per 00-foundation.md: every `ward_id` column; `assignments (sunday_id)`;
`assignments (member_id)`; `visit_logs (household_id, visit_date DESC)`;
`activity_events (event_date)`; `notifications (recipient_user_id, read_at)`;
`audit_log (ward_id, created_at DESC)`; `members (household_id)`.

**Details:**
- Every RLS policy filters on `ward_id`. Without those indexes every policy check is a
  sequential scan — this is a correctness-adjacent performance issue, not a nicety.
- **Do not** create the `ivfflat` index on `document_chunks.embedding` here. Its quality
  depends on having rows. It belongs in phase 5, after the standard works are embedded.
  Leave a note in the migration saying so.
- Add the unique indexes from the deviations list: `sacrament_assignment_managers`
  partial unique on `(ward_id) WHERE is_active`, `notification_user_prefs (user_id, trigger_key)`,
  `report_read_status (user_id, report_type, report_id)`.

---

### Task 4: Migration 019 — helper functions

**File:** `supabase/migrations/019_rls.sql` (create, part 1)

Write these four first — every policy uses them:

```sql
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

**Details:**
- `SECURITY DEFINER` is **required** — otherwise the function's own read of `users` is
  itself subject to RLS and recurses infinitely.
- `STABLE` lets Postgres cache the result per statement instead of re-running it per row.
- Add `SET search_path = public, pg_temp` to each function. A `SECURITY DEFINER` function
  without a pinned `search_path` is a privilege-escalation vector — Supabase's linter
  flags this, and it is a genuine hole, not a style warning.
- **The `users` policy must NOT call these functions.** Use a direct `id = auth.uid()`
  predicate there, or you recreate the recursion you just avoided. This is pitfall #1 in
  00-foundation.md.

---

### Task 5: Migration 019 — enable RLS and write policies

**File:** `supabase/migrations/019_rls.sql` (create, part 2)

`ALTER TABLE … ENABLE ROW LEVEL SECURITY;` on **every** table. A table without RLS is a
data leak, and Postgres defaults it off.

| Pattern | Applies to | Predicate |
|---|---|---|
| Ward scoping | Every table except `hymns` | `ward_id = current_ward_id()` |
| Bishopric-only | `tithing_*`, `assignments`, `topics`, `ai_settings`, `audit_log` | `is_bishopric()` |
| Org scoping | `visit_goals`, `visit_logs`, `activity_*` | `is_bishopric() OR org_id = current_org_id()` |
| Private notes | `visit_private_notes`, `activity_private_notes` | `user_id = auth.uid()` — every operation, **no bishopric override** |
| Cross-org read | `visit_logs` SELECT | org predicate `OR (ward.settings->>'cross_org_visibility')::boolean` |
| Sacrament | `sacrament_assignments` | `is_bishopric()` full; active manager SELECT + UPDATE only |
| Per-user | `notifications`, `report_read_status`, `notification_user_prefs` | `user_id = auth.uid()` |

**Details:**
- Write **separate policies per operation** (SELECT / INSERT / UPDATE / DELETE) rather than
  one `FOR ALL`. `FOR ALL` with a `USING` clause and no `WITH CHECK` lets a user update a
  row *into* another ward. Every INSERT and UPDATE policy needs an explicit `WITH CHECK`.
- **`member_notes` is bishopric-only** — see conflict 4 above, already decided. Policies are
  `is_bishopric() AND ward_id = current_ward_id()`, written per operation. `members` itself
  has no `notes` column, so no non-bishopric query can reach the data by any path.
- The private-notes policy has **no bishopric branch**. Not for the bishop, not for an
  admin, not for a support query (CLAUDE.md rule 5). Plan C asserts this explicitly.
- `hymns` gets a simple "authenticated users can read" policy — no ward predicate.

---

### Task 6: Migration 019 — public views

**File:** `supabase/migrations/019_rls.sql` (create, part 3)
**Action:** The unauthenticated read path. This is the riskiest surface in the app.

Do **not** grant `anon` access to `sacrament_assignments` or `programs` directly. Instead:

1. Create `public_sacrament_assignments` and `public_program` views selecting **only** safe
   columns — first name, last initial, hymn numbers, dates — joined through `public_pages`
   on `is_active = true`
2. `GRANT SELECT` on the **views only** to `anon`
3. Leave base-table policies closed to `anon`

**Details:**
- Create the views with `security_invoker = false` (the default for views) so they are not
  re-filtered by the caller's RLS — that is the point of the projection. Verify the base
  tables remain unreachable directly.
- **Never expose** phone numbers, addresses, notes, or full last names (CLAUDE.md §9,
  FEATURES.md §Module 17). Last initial only.
- Compute the last initial **in the view** (`left(last_name, 1)`), not in the application.
  A view that never selects `last_name` cannot leak it, no matter what the frontend does.
- This projection is the security boundary: a column added to `members` later cannot leak
  through a view that names its columns explicitly. Never write `SELECT *` in these views.

---

### Task 7: Seed data

**Files:** `supabase/seed/*.sql`, `supabase/seed.sql` (create)

| File | Notes |
|---|---|
| `hymns.sql` | Number, title, `topic_tags[]` for the standard hymnbook. **Data-sourcing task** — see below |
| `topics.sql` | ~40 evergreen topics: title, category, description. No scriptures or talks; AI fills those in phase 5 |
| `notification_triggers.sql` | One `notification_settings` row per trigger key in SPEC.md §Trigger Keys, with sensible `default_roles` |
| `ward.sql` | **Dev only.** One ward, six organisations, one bishop, a handful of households |

**Details:**
- **Every seed statement is idempotent** — `ON CONFLICT DO NOTHING`. `db:reset` runs them
  on every schema change.
- **`db:push` does not run seeds; `db:reset` does.** `supabase/config.toml` already has
  `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, and `db reset --linked`
  honours it (verified — there is a `--no-seed` flag to opt out). To load seeds without a
  full wipe, run `npx supabase db push --include-seed`. Idempotency is what makes that safe
  to repeat.
- **Hymns — DECIDED (user, 2026-08-15): seed a verified subset now, source the full 341
  before phase 6.** Do not invent numbers or titles; a wrong hymn number prints on a real
  program that a congregation sings from. Seed only hymns whose number and title are known
  with confidence, and put a header comment in `hymns.sql` stating plainly that the list is
  **partial** and must be completed before [06-program-music.md](06-program-music.md) ships
  hymn selection. Flag the gap in the handoff too — a partial seed that looks complete is
  worse than an obviously empty one.
- `topic_tags` drives AI hymn matching in phase 6. Rough tags are fine to start.
- Trigger keys must match SPEC.md §Trigger Keys **exactly** — `emitNotification()` in plan
  C looks them up by string, and a typo means a notification that silently never fires.
- `ward.sql` is development data. Keep it clearly separated so it never runs in production.

---

### Task 8: Regenerate types

**File:** `types/database.ts` (modify — overwrites plan A's stub)

```bash
npm run db:types
```

**Details:**
- **Never hand-edit this file** (conventions.md). Regenerate it after every migration.
- `npm run typecheck` must pass afterwards. The clients in `lib/supabase/*` are typed with
  `Database`, so a schema mismatch surfaces here rather than at runtime.
- Commit it — the Definition of Done requires it checked in.

---

### Task 9: Record the resolved conflicts in SPEC.md

**File:** `SPEC.md` (modify)
**Action:** Update the schema so it stops contradicting CLAUDE.md.

1. Add `ward_id` to the eleven table definitions.
2. Add `username` and `pin_hash` to `users`.
3. Add `sacrament_manager` to the `users.role` comment.
4. Change `sundays.date UNIQUE` to `UNIQUE (ward_id, date)`.
5. Add the `member_notes` table, and remove `notes` from `members` — conflict 4 above.

Keep it surgical — schema corrections only, no rewrite. SPEC.md is a source-of-truth
document; leaving it wrong means the next phase re-derives the same bug.

---

## Testing Strategy

The RLS test suite is plan C. This plan ships two structural checks that must not wait:

| File | Cases |
|---|---|
| `tests/db/rls-enabled.test.ts` | Query `pg_tables` joined to `pg_class.relrowsecurity`; **fail if any table in `public` lacks RLS** |
| `tests/db/migrations.test.ts` | Every file in `supabase/migrations/` appears in `supabase_migrations.schema_migrations` on the remote — catches a migration written but never pushed |

The first is the highest-leverage test in the phase: 00-foundation.md's pitfall list notes
that a table added later without `ENABLE ROW LEVEL SECURITY` is silently exposed. This test
catches that for every future phase, permanently.

**Both tests run over the network against the shared hosted project** (CLAUDE.md §9). Both
are strictly read-only, which is what makes them safe to run repeatedly. They use the
service-role client — they inspect catalog tables, they do not test RLS behaviour.

Note the shape of the second test changed because of the hosted decision: *"all 19
migrations apply to an empty database"* cannot be a vitest test here, because a test run
must never wipe a shared database. That check is `npm run db:reset`, run deliberately by a
human — it lives in Validation Commands below, not in the suite.

## Test Scenarios (Harness)

**Defer.** The harness seeds application state through the UI or API, and neither exists
yet. Bootstrap it with `/init-testing` after plan C, when there are services and a login.
Worth noting in the handoff so it is not forgotten.

---

## Validation Commands

```bash
# Inner loop while writing migrations — applies only what the remote lacks
npm run db:push

# Full rebuild from scratch — the real test of migration ordering.
# ⚠️ WIPES THE HOSTED DATABASE. Deliberate, end-of-task command; not a fix-up.
npm run db:reset

# Regenerate and verify types
npm run db:types
npm run typecheck

# Structural checks
npm test

npm run lint
npm run build
```

Manual verification — run these in the Supabase dashboard SQL editor:

```sql
-- Must return zero rows
SELECT tablename FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE t.schemaname = 'public' AND NOT c.relrowsecurity;

-- Must list only the two public views
SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'anon';
```

---

## Integration Notes

- **Depends on** plan A: `supabase/config.toml`, a linked hosted project, the `db:*` scripts.
- **Hands off to** plan C: a complete schema for the four cross-cutting services to write
  against, and the RLS policies its six test files assert.
- **Breaking change:** `types/database.ts` goes from stub to real. Anything typed against
  the stub starts type-checking properly — that is the point, but expect `typecheck` to
  surface errors in `lib/supabase/*` on first run.
- **Do not** write route handlers, services, or UI here. Schema and seed only.
- **Do not commit.** The user commits manually.

---

## Pitfalls

- **`SECURITY DEFINER` recursion.** If `current_ward_id()` reads `users` and the `users`
  policy calls `current_ward_id()`, you get infinite recursion. The `users` policy uses
  `id = auth.uid()`. Nothing else.
- **`SECURITY DEFINER` without `SET search_path`** is a privilege-escalation hole.
- **RLS is off by default on new tables.** The `rls-enabled` test exists for this.
- **`FOR ALL` policies without `WITH CHECK`** let a user move a row into another ward.
  Separate policies per operation.
- **`SELECT *` in a public view** turns every future column addition into a potential
  privacy incident. Name the columns.
- **The service-role client bypasses RLS entirely.** Seeding uses it. Never let that habit
  leak into a route handler.
- **`vector(1536)` must match the embedding model.** OpenAI `text-embedding-3-small` is
  decided (CLAUDE.md §9). Changing it later means a migration and a full re-embed of the
  standard works.
- **Don't invent hymn data.** A wrong number prints on a program a congregation sings from.
