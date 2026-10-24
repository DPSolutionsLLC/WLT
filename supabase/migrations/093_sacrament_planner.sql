-- ITER-045, migration 093: THE SACRAMENT PLANNER'S STORE.
--
-- The bishopric's Sacrament Planner (plans/sacrament-planner-adapter.md) runs unchanged inside a
-- same-origin frame behind the Sacrament tile. It was written against a Firestore-like document
-- store with ten collections, and a TypeScript adapter (lib/sacramentPlanner/bridge.ts) fills
-- that doorway with this table. Its documents are kept exactly as the Planner wrote them, as
-- JSON, under their original ids. Nothing here is translated into the app's own sacrament tables:
-- the pipelines are deliberately unconnected (D1).
--
-- ---------------------------------------------------------------------------
-- planner_documents — one row per Planner document
-- ---------------------------------------------------------------------------
-- `layer` replaces the Planner's `t_` collections. A document the Planner writes to
-- `t_sundays` is stored as layer 'practice', collection 'sundays'. Practice is shared per ward,
-- exactly as the `t_` collections were, and "Clear test changes" clears all of it.
--
-- THE PRIMARY KEY IS A SURROGATE `id`, NOT THE DOCUMENT'S NATURAL KEY. Supabase Realtime sends a
-- DELETE to every subscriber of the table WITHOUT applying RLS, carrying only the primary key,
-- because Postgres cannot check access to a row that no longer exists. With
-- (ward_id, layer, collection, document_id) as the key, every Planner subscriber in every ward
-- would receive another ward's document ids on each delete. A random uuid tells them nothing. The
-- natural key stays unique, and the adapter upserts on it.
--
-- `updated_by` references users (id) alone, never a composite (ward-callings-model). It is null
-- only on rows the import script wrote with the service role, and every client write must name
-- the writer, which WITH CHECK enforces.
--
-- ---------------------------------------------------------------------------
-- BISHOPRIC ONLY, UNTIL ITER-046
-- ---------------------------------------------------------------------------
-- Every policy is `ward_id = current_ward_id() and is_bishopric()`. The app mirrors this in
-- lib/sacramentPlanner/access.ts (`planner.use` AND a bishopric role), so a super admin whose
-- calling in this ward is not bishopric is refused by both. ITER-046 replaces this predicate with
-- title-based access; this migration and access.ts are the two places that change lands.
--
-- UPDATE carries the predicate on BOTH halves, plus the author check in WITH CHECK. A policy
-- cannot express "the writer is whoever is writing now" in USING, because USING sees the old
-- row, whose author may be somebody else (CLAUDE.md §9, 060-D2).
--
-- ---------------------------------------------------------------------------
-- planner_history — read-only, written once by the import script
-- ---------------------------------------------------------------------------
-- The Planner's agenda history (922 talk and prayer lines from 205 agendas, the meetings and who
-- conducted) was built into the page at build time. It has members' names in it, so it cannot be
-- a static file. It is imported here and injected by an authenticated route where the page says
-- __DATA__. There is a SELECT policy and no write policy, so nobody but the service role can
-- change it — the bishop included.
--
-- ---------------------------------------------------------------------------
-- RELEASE AND REALTIME
-- ---------------------------------------------------------------------------
-- Both tables are the `sacrament` module's own (lib/access/releasedModules.ts), restricted in
-- 091's exact shape. Only planner_documents joins the publication: tests/rls/
-- realtime-isolation.test.ts is what earns it the entry. planner_history never changes after
-- import, so it has nothing to publish.

create table planner_documents (
  id           uuid        primary key default gen_random_uuid(),
  ward_id      uuid        not null references wards (id) on delete cascade,
  layer        text        not null check (layer in ('real', 'practice')),
  collection   text        not null check (collection in (
                             'sundays', 'deferrals', 'considers', 'nameFixes', 'rowFixes',
                             'goesBy', 'marks', 'holds', 'people', 'settings')),
  document_id  text        not null check (char_length(document_id) between 1 and 200),
  data         jsonb       not null check (jsonb_typeof(data) = 'object'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references users (id) on delete set null,
  constraint planner_documents_natural_key unique (ward_id, layer, collection, document_id)
);

comment on table planner_documents is
  'The Sacrament Planner''s documents, as JSON, keyed as the Planner keys them (ITER-045).';

alter table planner_documents enable row level security;

create policy planner_documents_select on planner_documents
  for select to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy planner_documents_insert on planner_documents
  for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric() and updated_by = auth.uid());

create policy planner_documents_update on planner_documents
  for update to authenticated
  using (ward_id = current_ward_id() and is_bishopric())
  with check (ward_id = current_ward_id() and is_bishopric() and updated_by = auth.uid());

create policy planner_documents_delete on planner_documents
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy planner_documents_module_released on planner_documents
  as restrictive for all to authenticated
  using ((select ward_module_released('sacrament')))
  with check ((select ward_module_released('sacrament')));


create table planner_history (
  ward_id      uuid        primary key references wards (id) on delete cascade,
  agenda_rows  jsonb       not null,
  meetings     jsonb       not null,
  conducting   jsonb       not null,
  imported_at  timestamptz not null default now()
);

comment on table planner_history is
  'The Sacrament Planner''s imported agenda history. Written only by the import script (ITER-045).';

alter table planner_history enable row level security;

create policy planner_history_select on planner_history
  for select to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy planner_history_module_released on planner_history
  as restrictive for all to authenticated
  using ((select ward_module_released('sacrament')))
  with check ((select ward_module_released('sacrament')));


-- Guarded per table, as migration 026 does, so a re-run is a no-op rather than an error.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'The supabase_realtime publication does not exist, so the Sacrament Planner cannot update '
      'live. Check that this is running against the linked project (npm run db:link).';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'planner_documents'
  ) then
    alter publication supabase_realtime add table planner_documents;
  end if;
end
$$;
