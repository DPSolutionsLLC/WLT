-- Foundation B, migration 001: extensions.
--
-- pgvector backs knowledge-base retrieval at 1536 dimensions, matching OpenAI
-- text-embedding-3-small (CLAUDE.md §9). Changing the model later means a migration and a
-- full re-embed of the standard works, so the dimension is fixed here deliberately.
--
-- Both extensions are created in the `extensions` schema, which is Supabase's convention.
-- If an earlier install already placed one in `public`, IF NOT EXISTS leaves it there;
-- migration 014 resolves the `vector` type through search_path so either layout works.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
