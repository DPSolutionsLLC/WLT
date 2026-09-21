-- Phase 9 slice A: the two things migration 012 left out.
--
-- ---------------------------------------------------------------------------------------------
-- NO POLICY ON `agendas` OR `action_items` MOVES, AND NONE NEEDS TO
-- ---------------------------------------------------------------------------------------------
-- Migration 019 already generated ward-wide policies on all four verbs for both tables, in the
-- loop that covers twenty-four tables at once. That is the right boundary here for the reason
-- 054d gives for `activity_events`: an agenda belongs to the WARD, not to an organization — a
-- ward council agenda is the one document whose whole purpose is to cross organizations, and a
-- policy comparing `current_org_id()` would make exactly that unwritable.
--
-- WHO may build and publish is answered by `agendas.manage` and `agendas.publish` in
-- lib/auth/permissions.ts, checked with assertCan() in each route. RLS is the floor; the
-- permission is the gate. Both together are strictly narrower than either alone, which is the
-- correct direction for a boundary to be wrong in (migration 037's reasoning).


-- ============================================================================
-- 064a — `email_sent_at`, so a send cannot happen twice
-- ============================================================================
--
-- 09-meetings-tithing.md §Step A4 asks for this column by name and says why: "Mark the agenda as
-- sent so a cron re-run does not double-send. This is the classic cron bug — make the send
-- idempotent with an `email_sent_at` column."
--
-- ---------------------------------------------------------------------------------------------
-- THERE IS NO CRON, AND THE COLUMN IS STILL LOAD-BEARING
-- ---------------------------------------------------------------------------------------------
-- The phase plan specifies a Supabase Edge Function on cron. CLAUDE.md §9 is explicit that
-- `supabase/functions/` does not exist, `pg_cron` is not enabled and `vercel.json` declares no
-- crons, and that Phase 11 owns that decision for SIX already-queued clock-driven things. Slice A
-- does not invent a seventh mechanism: sending is a DELIBERATE HUMAN ACTION on its own route,
-- exactly as programme distribution already is (app/api/programs/[id]/distribute/route.ts), which
-- is also the shape rule 3's "no auto-send anywhere in this app" asks for.
--
-- So the double-send this guards against is not a cron re-run but a DOUBLE CLICK, or two
-- secretaries pressing Send within a second of each other. The guard is the same and the reason
-- it matters is the same: an email that has gone cannot be recalled.
--
-- NULLABLE, and null means nobody has sent it — the same absent-means-default idiom as
-- `closed_at` (060a), `occasion_id` (059b) and `org_id` (054a). A `not null default` would assert
-- on every existing row a fact nobody stated.
alter table agendas add column email_sent_at timestamptz;

-- The recipients an actual send reached, kept beside the timestamp so "who got this?" is
-- answerable months later from the row rather than from a mail provider's dashboard. A COUNT and
-- not a list of addresses: an agenda row is ward-readable (019), and a list of every leader's
-- email address in a ward-readable row is a disclosure nobody asked for (rule 8's spirit, and the
-- reason lib/program/distribution.ts keeps its recipient resolution server-side).
alter table agendas add column email_recipient_count integer;

alter table agendas
  add constraint agendas_email_count_needs_send
  check (email_recipient_count is null or email_sent_at is not null);


-- ============================================================================
-- 064b — the storage bucket for rendered agenda PDFs
-- ============================================================================
--
-- PRIVATE, like `programs` (040) and `knowledge` (032). An agenda is a working document of the
-- bishopric and ward council: it names families raised for discussion, and §Step A2 is emphatic
-- that only one-liners reach it precisely because it leaves the app. A public bucket would put
-- that at a guessable URL with no policy in front of it.
insert into storage.buckets (id, name, public)
values ('agendas', 'agendas', false)
on conflict (id) do nothing;


-- Objects are keyed `{ward_id}/{agenda_id}.pdf`, so the ward is the FIRST path segment and
-- (storage.foldername(name))[1] reads it — the same shape migrations 032 and 040 use. A key built
-- any other way is unreachable by its own uploader, which is the right failure.
--
-- THE AGENDA ID rather than the meeting date, which is where this differs from `programs`. A ward
-- holds at most one programme per Sunday, so 040 could key on the date; a ward can hold a
-- bishopric meeting and a ward council meeting on the SAME DAY, and keying on the date would make
-- the second overwrite the first.
--
-- public.current_ward_id() and public.current_user_role() are the SECURITY DEFINER helpers from
-- migration 019, SCHEMA-QUALIFIED because these policies are evaluated against storage.objects
-- where `public` is not necessarily on the search_path.

-- READ IS NARROWER THAN `programs`, AND THAT IS THE POINT.
--
-- 040 made programme objects ward-readable because a programme is handed to everyone in the room.
-- An agenda is not: it carries flagged families and the bishopric's action items. The four roles
-- named here are the ones holding `agendas.view` in lib/auth/permissions.ts.
--
-- RLS cannot read a ward's `wards.settings.role_access` override, so this is the CODE default and
-- assertCan() in the route honours the ward's own configuration on top of it.
create policy agendas_leadership_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'agendas'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.current_user_role() in (
      'bishop', 'counselor', 'ward_secretary', 'executive_secretary', 'ward_council_member'
    )
  );

-- WRITE IS NARROWER STILL — the roles holding `agendas.publish`. A ward council member may read
-- the agenda they are going to sit in; they may not render one.
create policy agendas_publisher_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'agendas'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.current_user_role() in (
      'bishop', 'counselor', 'ward_secretary', 'executive_secretary'
    )
  );

-- THERE IS NO UPDATE POLICY, following 032 and 040. Re-rendering REPLACES the object by
-- delete-then-upload, which is why DELETE exists and is granted to the same roles. `upsert: true`
-- is therefore not an option on the client — it issues an UPDATE, which no policy permits, and it
-- fails with a storage error that reads like a permissions bug. lib/agendas/storage.ts removes
-- then uploads, in that order.
create policy agendas_publisher_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'agendas'
    and (storage.foldername(name))[1] = public.current_ward_id()::text
    and public.current_user_role() in (
      'bishop', 'counselor', 'ward_secretary', 'executive_secretary'
    )
  );
