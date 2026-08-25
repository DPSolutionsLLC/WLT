-- ============================================================================
-- 039 — the safe projection behind /public/[slug]
-- ============================================================================
--
-- Migration 019 shipped `public_program` exposing the slug, the date, the PDF link and the
-- distribution stamp, and left a comment saying phase 6 must define an explicit named projection
-- before the page could render a program body. This is that migration.
--
-- NUMBERED 039, NOT 038. plans/program-c-public-pages.md says 038; program-a had already taken it
-- (038_talks_view_read_scope.sql). The digits before the first underscore are the version
-- supabase db push reads, so a duplicate is a collision, not a comment.
--
-- ----------------------------------------------------------------------------
-- WHY A SEPARATE COLUMN AND NOT A jsonb PATH INTO draft_data
-- ----------------------------------------------------------------------------
-- draft_data holds full member surnames, leadership contacts WITH PHONE NUMBERS, and missionary
-- information. A view selecting `draft_data -> 'speakers'` would publish whatever a later phase
-- adds under that key, silently. public_data is a different column holding a different, narrower
-- object, computed by ONE tested function (lib/program/publicProjection.ts) at one moment (the
-- approve route). Nothing copies draft_data into it and nothing ever should.

alter table programs add column public_data jsonb;

comment on column programs.public_data is
  'The ONLY part of a program anon can read. Written by POST /api/programs/[id]/approve from '
  'lib/program/publicProjection.ts, and cleared to null whenever the program returns to draft. '
  'Never write to this column from a client, and never copy draft_data into it.';


-- ----------------------------------------------------------------------------
-- The view
-- ----------------------------------------------------------------------------
-- Dropped and recreated rather than altered: a view's column list cannot be changed in place, and
-- this one both gains columns (ward_name, public_data) and keeps the rest.
--
-- Nothing reads this view today, so the blast radius of the breaking change is zero. That is the
-- last moment it will be true.

drop view public_program;

-- security_invoker = false is the DEFAULT and is restated because it is load-bearing, exactly as
-- migration 019 does. The view runs with its owner's rights and is NOT re-filtered by the caller's
-- RLS, which is the whole design: the projection is the boundary. anon holds no grant on any base
-- table underneath it.
--
-- COLUMNS ARE NAMED EXPLICITLY. Never `select *` here — a column added to `programs`, `sundays` or
-- `wards` in a later phase would join the public surface with nobody deciding that it should.
create view public_program
  with (security_invoker = false)
as
  select
    page.slug,
    sunday.date          as sunday_date,
    ward.name            as ward_name,
    program.public_data,
    program.pdf_url,
    program.distributed_at
  from public_pages page
  join programs program
    on program.ward_id = page.ward_id
  join sundays sunday
    on sunday.id = program.sunday_id
   and sunday.ward_id = program.ward_id
  join wards ward
    on ward.id = page.ward_id
  where page.page_type = 'program'
    and page.is_active
    and program.status = 'distributed'
    and program.public_data is not null;

-- ----------------------------------------------------------------------------
-- WHY `status = 'distributed'` AND NOT `'approved'`
-- ----------------------------------------------------------------------------
-- FEATURES.md says the public page "always reflects the most current approved version", which
-- reads as though `approved` were the gate. It is not, and the tension is resolved deliberately:
-- DISTRIBUTION IS THE ACT OF PUBLISHING. A program that has been approved but not yet distributed
-- is a document the bishopric has signed off and not yet handed to anybody, and a QR code that
-- showed it would publish it before the ward had it.
--
-- Inherited from migration 019 rather than invented here. Changing it is one word and a product
-- decision, not a refactor.
--
-- `public_data is not null` is belt and braces. public_data and status move in the same UPDATE, so
-- a distributed program without a projection should be unreachable — and if it ever happens the
-- page goes dark rather than rendering a header with an empty program under it.

comment on view public_program is
  'Unauthenticated read surface. Exposes ONLY programs.public_data, the explicit projection built '
  'by lib/program/publicProjection.ts — never draft_data, which carries full surnames, leadership '
  'phone numbers and missionary information. Every column added here is a privacy decision.';

-- REQUIRED. Dropping a view drops its grants with it, and Supabase does not auto-expose new
-- objects to the Data API roles. Forgetting this line is a public page that 404s for every visitor
-- with nothing in any log to say why.
grant select on public_program to anon;
