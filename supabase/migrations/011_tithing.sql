-- Foundation B, migration 011: tithing counting worksheet.
--
-- ============================================================================
-- CLAUDE.md rule 10: TITHING DATA NEVER TOUCHES THE MEMBERS TABLE.
--
-- No foreign key to members. No member_id. No donor name. No free-text notes column that
-- could hold one. This is a counting worksheet, not a financial record — the ward clerk
-- counts cash and cheques into it, reads the totals, and it is deleted at midnight.
--
-- If you are here to add "just a name field so we know whose envelope this was": don't.
-- That single column turns a disposable worksheet into a permanent record of who paid what,
-- which is precisely what this design exists to prevent.
-- ============================================================================

-- Cheque amounts are integer cents (conventions.md §Money). A float amount silently loses
-- precision when totalled, and these totals get reconciled against a real deposit slip.
-- A CHECK constraint cannot contain a subquery, so the per-element test lives in an
-- IMMUTABLE function that the constraint calls.
create function tithing_checks_are_integer_cents(checks jsonb)
  returns boolean
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select checks is null
      or (
        jsonb_typeof(checks) = 'array'
        and not exists (
          select 1
          from jsonb_array_elements(checks) as entry
          where jsonb_typeof(entry -> 'amount') is distinct from 'number'
             or (entry ->> 'amount') !~ '^-?[0-9]+$'
        )
      );
$$;

create table tithing_sessions (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  session_date  date not null,
  created_by    uuid,
  auto_clear_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (created_by, ward_id) references users (id, ward_id)
);

create table tithing_entries (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  session_id    uuid not null,
  entry_number  integer not null,
  checks        jsonb,
  bills_100     integer not null default 0 check (bills_100 >= 0),
  bills_50      integer not null default 0 check (bills_50 >= 0),
  bills_20      integer not null default 0 check (bills_20 >= 0),
  bills_10      integer not null default 0 check (bills_10 >= 0),
  bills_5       integer not null default 0 check (bills_5 >= 0),
  bills_2       integer not null default 0 check (bills_2 >= 0),
  bills_1       integer not null default 0 check (bills_1 >= 0),
  coins_dollar  integer not null default 0 check (coins_dollar >= 0),
  coins_half    integer not null default 0 check (coins_half >= 0),
  coins_quarter integer not null default 0 check (coins_quarter >= 0),
  coins_dime    integer not null default 0 check (coins_dime >= 0),
  coins_nickel  integer not null default 0 check (coins_nickel >= 0),
  coins_penny   integer not null default 0 check (coins_penny >= 0),
  created_at    timestamptz not null default now(),
  unique (session_id, entry_number),
  constraint tithing_entries_checks_integer_cents check (tithing_checks_are_integer_cents(checks)),
  foreign key (session_id, ward_id) references tithing_sessions (id, ward_id) on delete cascade
);

comment on table tithing_entries is
  'Counting worksheet only. No member linkage of any kind — see CLAUDE.md rule 10.';

-- auto_clear_at is always midnight of session_date in the ward timezone. The cron that
-- enforces the delete is a later phase (SPEC.md §Tithing Auto-Clear); the column is set now
-- so no session is ever written without an expiry.
comment on column tithing_sessions.auto_clear_at is
  'Midnight of session_date, ward-local. Enforced by a scheduled delete in a later phase.';
