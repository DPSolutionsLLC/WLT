-- Foundation B, migration 013: in-app notifications.

create table notifications (
  id                uuid primary key default gen_random_uuid(),
  ward_id           uuid not null references wards (id) on delete cascade,
  recipient_user_id uuid not null,
  trigger_key       text not null,
  title             text,
  body              text,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (recipient_user_id, ward_id) references users (id, ward_id) on delete cascade
);

-- One row per trigger key per ward. notification_settings is the source of truth for which
-- triggers exist; adding a trigger later is an insert here plus an emit call, with no schema
-- change (SPEC.md §Adding Triggers).
create table notification_settings (
  id                  uuid primary key default gen_random_uuid(),
  ward_id             uuid not null references wards (id) on delete cascade,
  trigger_key         text not null,
  default_roles       text[] not null default '{}',
  is_globally_enabled boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (ward_id, trigger_key)
);

create table notification_user_prefs (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  user_id     uuid not null,
  trigger_key text not null,
  is_enabled  boolean not null default true,
  unique (user_id, trigger_key),
  foreign key (user_id, ward_id) references users (id, ward_id) on delete cascade
);

comment on column notification_user_prefs.is_enabled is
  'User-level override. When false this user never receives the trigger, whatever their role default says.';
