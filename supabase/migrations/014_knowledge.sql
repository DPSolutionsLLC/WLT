-- Foundation B, migration 014: knowledge base and AI settings.

-- The `vector` type may live in `extensions` (Supabase convention, see migration 001) or in
-- `public` on an older install. Widening search_path for this migration resolves it either
-- way; once the column is created the type is pinned and search_path stops mattering.
-- Plain SET, not SET LOCAL: SET LOCAL is a no-op with a warning outside an explicit
-- transaction block, and whether the migration runner opens one is not worth depending on.
set search_path = public, extensions;

create table knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  title       text not null,
  type_tag    text check (type_tag in ('standard_works', 'general_conference', 'other')),
  file_url    text,
  status      text not null default 'active' check (status in ('active', 'inactive')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (uploaded_by, ward_id) references users (id, ward_id)
);

-- vector(1536) matches OpenAI text-embedding-3-small, decided in CLAUDE.md §9. Changing the
-- model means a migration here plus a full re-embed of the standard works.
--
-- The ivfflat index is deliberately NOT created here — see migration 018.
create table document_chunks (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  document_id uuid not null,
  content     text not null,
  embedding   vector(1536),
  chunk_index integer,
  created_at  timestamptz not null default now(),
  foreign key (document_id, ward_id) references knowledge_documents (id, ward_id) on delete cascade
);

-- Every save is kept; the row with the latest created_at is the active configuration.
create table ai_settings (
  id                     uuid primary key default gen_random_uuid(),
  ward_id                uuid not null references wards (id) on delete cascade,
  tone_voice             text,
  doctrinal_emphasis     text,
  scripture_preferences  jsonb,
  conference_preferences jsonb,
  topic_preferences      text,
  ward_context           text,
  thank_you_preferences  text,
  saved_by               uuid,
  created_at             timestamptz not null default now(),
  foreign key (saved_by, ward_id) references users (id, ward_id)
);
