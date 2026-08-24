-- AI B, migration 032: the storage bucket behind knowledge_documents.file_url.
--
-- `file_url` has existed and been unused since migration 014. This is what fills it.
--
-- WHAT THE ORIGINAL FILE IS FOR: provenance. The bishopric can re-download what they
-- uploaded, and a future re-chunk has a source to work from. IT IS NEVER READ AT QUERY TIME.
-- Retrieval reads document_chunks and nothing else — no whole document is ever sent to
-- Claude (05-ai-platform.md).

insert into storage.buckets (id, name, public)
values ('knowledge-documents', 'knowledge-documents', false)
on conflict (id) do nothing;


-- ============================================================================
-- Policies
-- ============================================================================
--
-- Objects are keyed `{ward_id}/{document_id}.{ext}`, so the ward is the FIRST path segment
-- and storage.foldername(name))[1] reads it. A key written in any other shape is unreachable
-- by its own uploader, which is the failure mode worth having.
--
-- public.current_ward_id() and public.is_bishopric() are the SECURITY DEFINER helpers from
-- migration 019. They are SCHEMA-QUALIFIED because these policies are evaluated against
-- storage.objects, where `public` is not necessarily on the search_path.
--
-- Bishopric-only, matching knowledge.view / knowledge.manage in lib/auth/permissions.ts. Note
-- this is STRICTER than the RLS on knowledge_documents itself, which migration 019 put in the
-- ward-scoped loop — the row is ward-readable, the uploaded file is not.
--
-- THERE IS NO UPDATE POLICY, on purpose. A document is replaced by deleting and re-uploading.
-- Overwriting a file in place would leave document_chunks describing text that no longer
-- exists in it, with nothing anywhere recording the divergence.

create policy knowledge_documents_bishopric_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.is_bishopric()
  );

create policy knowledge_documents_bishopric_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.is_bishopric()
  );

create policy knowledge_documents_bishopric_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.is_bishopric()
  );
