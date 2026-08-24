-- AI B, migration 031: the vector search function and the index behind it.
--
-- The `vector` type may live in `extensions` (Supabase convention, see migration 001) or in
-- `public` on an older install. Widening search_path for this migration resolves it either
-- way, exactly as migration 014 does. Plain SET, not SET LOCAL: SET LOCAL is a no-op with a
-- warning outside an explicit transaction block, and whether the migration runner opens one
-- is not worth depending on.
set search_path = public, extensions;


-- ============================================================================
-- Capability check — HNSW needs pgvector >= 0.5.0
-- ============================================================================
--
-- Checked by ACCESS METHOD rather than by comparing extversion strings: '0.10.0' sorts
-- before '0.5.0' lexically, and the thing actually depended on below is the access method,
-- not a number. pgvector registers `hnsw` in 0.5.0 and never removed it.
--
-- Raising here rather than letting `create index` fail means the message names the fallback
-- instead of reporting an unrecognised access method three lines further down.

do $$
begin
  if not exists (select 1 from pg_am where amname = 'hnsw') then
    raise exception
      'pgvector on this database has no hnsw access method (needs >= 0.5.0). '
      'Fall back to ivfflat and build the index AFTER the standard works are ingested — '
      'ivfflat trains its centroids on the data present at build time.';
  end if;
end $$;


-- ============================================================================
-- The search function
-- ============================================================================
--
-- SECURITY INVOKER (the default for `language sql`) IS LOAD-BEARING. RLS applies inside the
-- function, so `document_chunks_ward_select` from migration 019 is the real boundary and
-- `match_ward_id` is defence in depth. A later "optimisation" to SECURITY DEFINER would turn
-- that parameter into the ONLY thing standing between two wards' corpora.
-- tests/rls/retrieval-scoping.test.ts calls this with another ward's uuid and asserts it
-- still returns nothing; that assertion is why the default must stay.
--
-- `c.embedding is not null` is not a tidiness filter. A chunk whose embedding failed is still
-- INSERTED (lib/knowledge/ingest.ts) so its text is not lost, and `null <=> vector` sorts
-- FIRST — without this line every failed chunk would rank as maximally similar to everything.
--
-- The join carries `and d.ward_id = c.ward_id` because the foreign key is composite
-- (migration 014). Joining on document_id alone would work today and drift the first time a
-- document id is reused across wards.
--
-- STABLE, not IMMUTABLE: it reads tables.

create function match_document_chunks(
  query_embedding vector(1536),
  match_ward_id   uuid,
  match_count     int
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
  order by c.embedding <=> query_embedding
  limit match_count
$$;

-- Migration 019's `alter default privileges` covers TABLES, not FUNCTIONS. Without this
-- grant every rpc() call fails with a permission error that reads exactly like an RLS
-- problem and is not (plans/retros/foundation-b-schema.md).
grant execute on function match_document_chunks(vector, uuid, int) to authenticated, service_role;


-- ============================================================================
-- Indexes
-- ============================================================================
--
-- HNSW, DELIBERATELY NOT the ivfflat that 05-ai-platform.md specifies.
--
-- ivfflat trains list centroids on whatever rows exist when the index is built, so it must be
-- created AFTER ingestion and rebuilt if the corpus changes shape — an instruction somebody
-- eventually forgets, leaving a worthless index nobody notices. HNSW has no training step: it
-- is correct on an empty table, stays correct as rows arrive, and has better recall at the
-- same query cost. The cost is a slower build and more memory during it, which at this scale
-- (tens of thousands of chunks for one ward) is seconds.
--
-- vector_cosine_ops matches the `<=>` operator the function orders by. An index built for a
-- different operator class is simply not used, silently.
create index document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- Every retrieval filters on exactly this pair through the join above.
-- document_chunks_ward_id_idx and knowledge_documents_ward_id_idx already exist in
-- migration 018; this is the composite neither of them covers.
create index knowledge_documents_ward_status_idx
  on knowledge_documents (ward_id, status);

-- listDocuments() counts chunks per document, and the ingest script inserts them in batches
-- keyed the same way.
create index document_chunks_document_id_idx
  on document_chunks (document_id, ward_id);
