-- Phase 3, migration 076: SOMEBODY TELLS US SOMETHING IS WRONG, AND THE APP REMEMBERS WHERE THEY WERE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one new table, its policies and
-- one index. It sets nothing NOT NULL on an existing table, narrows no CHECK and tightens no
-- policy, so there is no row that exists today which it could fail on.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added — 073's header carries the argument: that allowlist is for the contract half of an
-- expand-and-contract pair, and an entry that is not needed HIDES a real migration from the
-- assertion that everything on disk has been applied.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- The whole value is in what the REPORTER does not have to type. `page_path`, `role` and
-- `calling_id` are taken from the session, so a report says where the person was and what they
-- were acting as without anybody re-explaining it after the fact — which is precisely the
-- information that goes missing when a leader reports a bug by text message a day later.
--
-- CAPTURE ONLY. Nothing in the app READS this table; the review screen is P12's. That is not an
-- oversight — a place to put a defect while P4–P13 are being walked is worth having on its own,
-- and building a queue nobody is yet assigned to read would be building the wrong half first.
--
-- Structure:
--   076a  the table
--   076b  policies: any member of the ward may report, the ward's admins may read, nobody edits
--   076c  index


-- ---------------------------------------------------------------------------
-- 076a. The table
-- ---------------------------------------------------------------------------
--
-- `ward_id` IS NOT NULL — CLAUDE.md rule 1. There are four documented exceptions and this is not
-- one: a report is made inside exactly one ward, by somebody acting under a calling there.
--
-- `body` IS NOT NULL and the app refuses an empty one at the boundary too
-- (lib/validation/issueReport.ts). A report with no words is not a report — the same argument
-- `access_requests.reason` carries, and the column is what makes it true of every row however it
-- got there.
--
-- `reported_by` IS NULLABLE ONLY SO `on delete set null` CAN FIRE, and it MUST NEVER APPEAR IN A
-- POLICY PREDICATE. That is the `talks-d` hole, now seven sightings in this repo: a null author
-- column makes a predicate NULL rather than false, and the row becomes invisible to the person
-- who needs it. A report must outlive the account that made it — a leader released and
-- deactivated does not un-report the bug they found.
--
-- THE FOREIGN KEYS ON `reported_by` AND `calling_id` ARE SINGLE-COLUMN, NOT COMPOSITE WITH
-- `ward_id`. Migration 069 narrowed 48 of those precisely because a person may now write in a
-- ward their account does not belong to — a counselor whose account lives elsewhere holds a real
-- calling here. `(reported_by, ward_id) -> users (id, ward_id)` would assert something that is
-- legitimately false and fail as SQLSTATE 23503, which is a 500 rather than a refusal.
-- tests/db/user-author-fks.test.ts fails if one is ever reintroduced.
--
-- `role` IS PLAIN text, NOT A CHECK AGAINST A LIST. ROLES is a TypeScript constant that grows
-- every phase and a CHECK here would be another copy to keep in step (`notification-trigger-drift`).
-- lib/validation/issueReport.ts validates it at the boundary against the real constant, which
-- cannot drift from itself.
create table issue_reports (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,

  reported_by uuid references users (id) on delete set null,

  -- WHERE THEY WERE. The pathname of the page the modal was opened from, never /dashboard by
  -- default — a report tagged with the wrong page is worse than one tagged with none.
  page_path   text not null,

  -- WHAT THEY WERE ACTING AS. Both come from the SESSION, never from the request body: a
  -- client-supplied role would be a claim rather than a fact, and the fact is the whole point.
  role        text not null,
  calling_id  uuid references ward_role_assignments (id) on delete set null,

  body        text not null,

  created_at  timestamptz not null default now()
);

comment on table issue_reports is
  'A leader reporting that something is wrong, tagged automatically with the page and the calling they were acting under. Capture only until P12 builds the review screen.';


-- ---------------------------------------------------------------------------
-- 076b. Policies
-- ---------------------------------------------------------------------------
--
-- INSERT IS OPEN TO ANY AUTHENTICATED MEMBER OF THE WARD, AND THAT IS THE FEATURE. There is no
-- `issues.*` permission and there must not be one: reporting a problem is not a ward-configurable
-- privilege, and putting it in PERMISSIONS would let `wards.settings.role_access` take it away
-- from the very role most likely to hit a bug. So the route carries no assertCan() and RLS is the
-- only boundary (CLAUDE.md rule 2).
--
-- `reported_by = auth.uid()` in the WITH CHECK is what stops somebody filing a report in another
-- person's name. It is safe to read `reported_by` HERE, on an INSERT, because the value being
-- checked is the one being written and is never null on this path — the null-author hole is a
-- problem for SELECT predicates, which is why the read below does not mention the column.
--
-- SELECT IS THE WARD'S ADMINS. `is_bishopric()` plus the ward secretary and executive secretary,
-- which is the shape this ward's other admin-read tables use. A super admin reads all of them,
-- as they do on access_requests, because P12's review screen is app-wide.
--
-- NO UPDATE AND NO DELETE POLICY, SO RLS DENIES BOTH BY DEFAULT. A report is a record of what
-- somebody said. Nothing in this phase edits one, and an editable bug report is one somebody can
-- quietly soften.
alter table issue_reports enable row level security;

create policy issue_reports_insert on issue_reports
  for insert to authenticated
  with check (ward_id = current_ward_id() and reported_by = auth.uid());

create policy issue_reports_select on issue_reports
  for select to authenticated
  using (
    is_super_admin()
    or (
      ward_id = current_ward_id()
      and (
        is_bishopric()
        or current_user_role() in ('ward_secretary', 'executive_secretary')
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 076c. Index
-- ---------------------------------------------------------------------------
--
-- One access pattern until P12: this ward's reports, newest first.
create index issue_reports_ward_created_idx
  on issue_reports (ward_id, created_at desc);
