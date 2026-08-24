-- AI D, migration 033: conference metadata, and the filtered search function.
--
-- The `vector` type may live in `extensions` (Supabase convention, see migration 001) or in
-- `public` on an older install. Widening search_path resolves it either way, exactly as
-- migrations 014 and 031 do. Plain SET, not SET LOCAL: SET LOCAL is a no-op with a warning
-- outside an explicit transaction block.
set search_path = public, extensions;


-- ============================================================================
-- Metadata columns
-- ============================================================================
--
-- ALL THREE NULLABLE, AND NULLABLE IS LOAD-BEARING. Every document that exists today — the
-- entire standard works included — has none of them, and must keep retrieving exactly as it
-- does now. See the search function below, where that guarantee is actually enforced.
--
-- `conference_date` holds the FIRST DAY OF THE CONFERENCE MONTH (2026-04-01), not a timestamp
-- and not a year integer. A date sorts and compares with the same operators the rest of this
-- schema uses, and it survives a ward that later wants April told apart from October.
--
-- `speaker_role` IS THE ROLE HELD WHEN THE TALK WAS GIVEN, not the speaker's current calling.
-- A 2015 talk by a member of the Twelve who now presides is `apostle`, and stays `apostle`.
-- That is the only reading this column can answer on its own — "anyone who has ever been
-- President" needs a speaker-identity concept no table here holds. lib/ai/resolveFilter.ts
-- states the same rule to the model, and lib/knowledge/conferenceMetadata.ts states it to the
-- reader; all three have to agree or a filter means something different depending on where you
-- read it.

alter table knowledge_documents
  add column speaker      text,
  add column speaker_role text check (
    speaker_role in ('prophet', 'apostle', 'seventy', 'presiding_bishopric', 'auxiliary', 'other')
  ),
  add column conference_date date;

-- The composite the filter actually reads. `type_tag` is in it because the predicate below
-- branches on that column before it looks at anything else.
create index knowledge_documents_conference_idx
  on knowledge_documents (ward_id, type_tag, conference_date desc);

-- The datalist behind the speaker field reads DISTINCT speakers for one ward. Without this it
-- is a sequential scan over every document to populate a dropdown.
create index knowledge_documents_speaker_idx
  on knowledge_documents (ward_id, speaker)
  where speaker is not null;


-- ============================================================================
-- The filtered search function
-- ============================================================================
--
-- THIS IS THE MOST DANGEROUS CHANGE IN THIS MIGRATION, AND ITS BUG IS SILENT.
--
-- A naive `d.conference_date >= filter_since` removes every document whose conference_date is
-- null — which is the entire standard works. A ward sets "last two years" to narrow their
-- CONFERENCE TALKS and quietly loses the Book of Mormon from every suggestion it ever makes
-- again. Nothing errors. No test fails. The drafts just get worse, slowly, and nobody connects
-- it to a checkbox somebody ticked in a settings panel months earlier.
--
-- So: THE FILTER APPLIES TO general_conference DOCUMENTS AND TO NOTHING ELSE. Everything that
-- is not a conference talk passes the predicate untouched, whatever the filters say.
-- tests/db/retrieval-filters.test.ts asserts this from four directions.
--
-- `is distinct from` RATHER THAN `<>`. A null type_tag is an "other" document and must pass the
-- filter; `null <> 'general_conference'` evaluates to NULL, not true, which would fail the `or`
-- and silently drop every untagged document the moment any filter was set. This is the same
-- class of bug as the null conference_date above, one column over.
--
-- DROP BEFORE CREATE, deliberately. Adding parameters with defaults to the existing function
-- creates an OVERLOAD rather than replacing it, and the old three-argument call then becomes
-- ambiguous — PostgREST picks one by a rule nobody wants to reason about. Dropping also
-- discards migration 031's `grant execute`, which is re-issued below: a retrieval that starts
-- failing with a permission error after this ships is almost certainly a forgotten grant and
-- not a policy (plans/retros/foundation-b-schema.md).
--
-- SECURITY INVOKER STILL, for exactly the reason migration 031 spells out. The three new
-- parameters are three more things a caller could lie about, which makes the argument stronger
-- rather than weaker: RLS inside the function is the boundary, and these are all defence in
-- depth. tests/rls/retrieval-scoping.test.ts calls this with a foreign match_ward_id and
-- asserts it still returns nothing — that assertion must keep passing, unchanged.

drop function if exists match_document_chunks(vector, uuid, int);

create function match_document_chunks(
  query_embedding      vector(1536),
  match_ward_id        uuid,
  match_count          int,
  filter_since         date    default null,
  filter_speaker_roles text[]  default null,
  filter_speakers      text[]  default null
)
returns table (
  chunk_id    uuid,
  content     text,
  document_id uuid,
  title       text,
  type_tag    text,
  chunk_index integer,
  similarity  float
)
language sql
stable
as $$
  select c.id, c.content, c.document_id, d.title, d.type_tag, c.chunk_index,
         1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  join knowledge_documents d on d.id = c.document_id and d.ward_id = c.ward_id
  where c.ward_id = match_ward_id
    and d.status = 'active'
    and c.embedding is not null
    and (
      -- Not a conference talk: the filters do not apply. This is the standard-works exemption
      -- and it is the first branch on purpose — it is the one somebody removing "dead code"
      -- would delete.
      d.type_tag is distinct from 'general_conference'
      or (
        (filter_since is null or d.conference_date >= filter_since)
        and (filter_speaker_roles is null or d.speaker_role = any (filter_speaker_roles))
        and (filter_speakers is null or d.speaker = any (filter_speakers))
      )
    )
  order by c.embedding <=> query_embedding
  limit match_count
$$;

-- Migration 019's `alter default privileges` covers TABLES, not FUNCTIONS, and the drop above
-- took migration 031's grant with it. Without this every rpc() call fails with a permission
-- error that reads exactly like an RLS problem and is not.
grant execute on function match_document_chunks(vector, uuid, int, date, text[], text[])
  to authenticated, service_role;
