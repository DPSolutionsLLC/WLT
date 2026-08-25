-- ============================================================================
-- 040 — the `programs` storage bucket behind programs.pdf_url
-- ============================================================================
--
-- NUMBERED 040, NOT 039. plans/program-d-pdf-and-distribution.md says 039; program-c had already
-- taken it (039_public_program_projection.sql). The digits before the first underscore are the
-- version `supabase db push` reads, so a duplicate is a collision, not a comment. The same
-- correction 039 itself had to make against 038.
--
-- `pdf_url` has existed and been unused since migration 007. This is what fills it.
--
-- ----------------------------------------------------------------------------
-- WHAT IS IN THE BUCKET, AND WHY IT IS NOT PUBLIC
-- ----------------------------------------------------------------------------
-- Rendered bifold sacrament programmes. A programme names, in full, every person taking part in
-- a ward's meeting, and the contacts panel carries LEADERSHIP PHONE NUMBERS — the array that
-- lib/program/publicProjection.ts omits from the public page entirely.
--
-- `public: false`, therefore. A public bucket would put every ward's programme at a guessable URL
-- ({ward_id}/{date}.pdf) with no policy in front of it, which is exactly the "quiet privacy
-- decision made by omission" this plan warns about. The public page links to a SIGNED URL with a
-- bounded lifetime instead (lib/program/storage.ts).

insert into storage.buckets (id, name, public)
values ('programs', 'programs', false)
on conflict (id) do nothing;


-- ============================================================================
-- Policies
-- ============================================================================
--
-- Objects are keyed `{ward_id}/{sunday_date}.pdf`, so the ward is the FIRST path segment and
-- (storage.foldername(name))[1] reads it — exactly as migration 032 does for knowledge documents.
-- A key written in any other shape is unreachable by its own uploader, which is the right failure.
--
-- public.current_ward_id() and public.current_user_role() are the SECURITY DEFINER helpers from
-- migration 019. They are SCHEMA-QUALIFIED because these policies are evaluated against
-- storage.objects, where `public` is not necessarily on the search_path.

-- READ IS WARD-WIDE, deliberately, and this is where it differs from migration 032.
--
-- A knowledge document is bishopric-only. A sacrament programme is read aloud on Sunday and handed
-- to everyone in the room — there is nothing in it the ward may not see. It matches the SELECT
-- policy on `programs` itself, which migration 037 left ward-wide for the same reason while
-- narrowing the writes.
create policy programs_ward_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'programs'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
  );

-- WRITE MATCHES MIGRATION 037's SHAPE — the three roles holding program.build, named as literals.
--
-- RLS cannot read a ward's wards.settings.role_access override, so this is the CODE default and
-- assertCan() in the route honours the ward's own configuration on top of it. The two together are
-- strictly narrower than either alone, which is the correct direction for a boundary to be wrong
-- in (migration 037's reasoning, unchanged).
create policy programs_builder_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'programs'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );

-- THERE IS NO UPDATE POLICY, following migration 032.
--
-- A regenerated programme REPLACES the object by delete-then-upload, which is why DELETE exists
-- and is granted to the same three roles. `upsert: true` on the client is therefore NOT an option
-- here — it issues an UPDATE, which no policy permits, and it would fail with a storage error that
-- reads like a permissions bug. lib/program/storage.ts removes then uploads, in that order.
create policy programs_builder_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'programs'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );

-- ANON GETS NO POLICY HERE, on purpose.
--
-- /public/[slug] is unauthenticated and links to the PDF. That link is a SIGNED URL minted at
-- generate time with a bounded lifetime (see lib/program/storage.ts), not an open bucket path.
-- Granting anon a select policy would make every ward's programme readable by anybody who could
-- guess a ward id and a date, forever, with nothing recording the decision.

comment on column programs.pdf_url is
  'A SIGNED Supabase Storage URL for the rendered bifold PDF, minted by POST '
  '/api/programs/[id]/generate-pdf with a bounded lifetime (PDF_SIGNED_URL_TTL_SECONDS in '
  'lib/program/storage.ts). NOT a storage key: /public/[slug] renders this value as an href '
  'directly. The bucket is private; do not make it public to avoid re-signing.';
