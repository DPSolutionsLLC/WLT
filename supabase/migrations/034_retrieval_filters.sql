-- AI D, migration 034: saved retrieval filters, and the suggestion log behind ITER-012.

set search_path = public;


-- ============================================================================
-- retrieval_filters — a filter a ward taught the app once and reuses
-- ============================================================================
--
-- `source_phrase` KEEPS WHAT THE USER TYPED, and it is not decoration. Six months on,
-- "Prophets, last 5 years" is a checkbox somebody has to reverse-engineer from three columns;
-- the sentence that produced it is the explanation. It is the user's own words about their own
-- corpus — not generated content and not a member's private business — so storing it is fine.
--
-- `unique (ward_id, label)` because two filters called the same thing in one checkbox list is a
-- bug report waiting to happen. app/api/knowledge/filters/route.ts turns the constraint
-- violation into a sentence rather than a 500.
--
-- Composite `unique (id, ward_id)` plus the composite FK to users (id, ward_id) matches
-- migration 014's pattern, and is what makes a cross-ward created_by unrepresentable rather
-- than merely unlikely.
--
-- NULL MEANS "THIS AXIS IS NOT FILTERED" on all three filter columns, never an empty array.
-- An empty array through `= any ('{}')` matches NOTHING, so a filter saved with `{}` would
-- silently match zero documents while looking exactly like one that matches everything. The
-- CHECK constraints below make that state unrepresentable instead of leaving it to the route.

create table retrieval_filters (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  label         text not null,
  source_phrase text not null,
  speaker_roles text[] check (speaker_roles is null or array_length(speaker_roles, 1) > 0),
  speakers      text[] check (speakers is null or array_length(speakers, 1) > 0),
  since         date,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  unique (ward_id, label),
  foreign key (created_by, ward_id) references users (id, ward_id),
  -- A filter that narrows nothing is not a filter. It would sit in the checkbox list doing
  -- visibly nothing, which is worse than being refused at save time.
  constraint retrieval_filters_narrows_something check (
    speaker_roles is not null or speakers is not null or since is not null
  )
);


-- ============================================================================
-- retrieval_suggestions — which documents retrieval actually surfaced
-- ============================================================================
--
-- ITER-012's DISPLAY IS NOT IN THIS PLAN. This table and its writes are, because telemetry
-- cannot be backfilled: every week without the write is a week permanently missing from the
-- denominator of "appeared in 8 of your last 20 generations".
--
-- `run_id` is generated ONCE per retrieveChunks call and shared by every document that call
-- returned. It is the whole reason the percentage is answerable — without it you can count
-- appearances but you have nothing to divide by.
--
-- THIS TABLE STORES DOCUMENT IDS AND TIMESTAMPS. IT NEVER STORES THE QUERY, THE PROMPT, OR THE
-- GENERATED TEXT. A bishop's retrieval query can name a specific member or describe a situation
-- that member would not want written down — the same rule lib/ai/retrieve.ts applies to its
-- console logging and `ai-c` applies to its audit rows.
--
-- `on delete cascade` through the composite FK: deleting a document takes its suggestion
-- history with it. The alternative is a log referencing documents nobody can look up.

create table retrieval_suggestions (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  run_id      uuid not null,
  module      text not null,
  document_id uuid not null,
  created_at  timestamptz not null default now(),
  foreign key (document_id, ward_id) references knowledge_documents (id, ward_id) on delete cascade
);

-- "How often has THIS document been suggested lately" — the ITER-012 read, newest first.
create index retrieval_suggestions_document_idx
  on retrieval_suggestions (ward_id, document_id, created_at desc);

-- "How many runs were there to divide by" — counting distinct run_id for a ward.
create index retrieval_suggestions_run_idx
  on retrieval_suggestions (ward_id, run_id);


-- ============================================================================
-- Row level security
-- ============================================================================
--
-- Follows migration 019's shapes rather than inventing new ones.
--
-- SELECT IS WARD-SCOPED ON BOTH, NOT BISHOPRIC-ONLY, and that is a deliberate difference from
-- `ai_settings`. lib/ai/retrieve.ts resolves a ward's saved filters on every retrieval, and it
-- runs as whoever is drafting. Today every caller happens to be bishopric, but a scope that
-- silently stopped applying the moment a non-bishopric role retrieved would be a filter that
-- works in testing and not in the app. Neither table holds anything private: a filter is a
-- ward's own words about its own corpus, and a suggestion row is a document id.
--
-- WRITES TO retrieval_filters ARE BISHOPRIC-ONLY, matching `knowledge.manage` in
-- lib/auth/permissions.ts. There is no UPDATE policy: a filter is created and deleted, never
-- edited, because editing one silently changes what every past run meant.
--
-- retrieval_suggestions TAKES INSERTS FROM ANY WARD MEMBER and has no update or delete policy.
-- It is an append-only log; a row that can be edited is not a log.

alter table retrieval_filters enable row level security;
alter table retrieval_suggestions enable row level security;

create policy retrieval_filters_ward_select on retrieval_filters
  for select to authenticated
  using (ward_id = current_ward_id());

create policy retrieval_filters_bishopric_insert on retrieval_filters
  for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric());

create policy retrieval_filters_bishopric_delete on retrieval_filters
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy retrieval_suggestions_ward_select on retrieval_suggestions
  for select to authenticated
  using (ward_id = current_ward_id());

create policy retrieval_suggestions_ward_insert on retrieval_suggestions
  for insert to authenticated
  with check (ward_id = current_ward_id());
