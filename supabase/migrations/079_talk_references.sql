-- P4 module 1 (Sacrament), slice c, migration 079: THE REFERENCES A TALK IS GIVEN, AND WHETHER A
-- SUNDAY'S REFERENCES ARE READY.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one new table, two nullable
-- columns on `sundays` with no default, and a CHECK that every existing row satisfies (both
-- columns start null). No existing policy moves and no existing constraint narrows, so every
-- existing Sunday reads "references open" — which is honest, because nobody has decided.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. See 078's header.
--
-- ---------------------------------------------------------------------------
-- TWO TIMESTAMPS, NOT A STATUS COLUMN
-- ---------------------------------------------------------------------------
-- `closed_at`'s rule (060) and `topics_finalized_at`'s (078): "WHEN did somebody decide this" is
-- what a card asks, and null is how reopening works without a delete.
--
-- `skipped` is a RECORDED decision ("not giving references this round"), never an empty list
-- (module-map §2.1 item 2). A Sunday with no references and no decision is open; a Sunday with no
-- references and a skip is complete. The two must stay distinguishable, which a count cannot do.
--
-- The CHECK is what makes "finalized and skipped at once" unrepresentable rather than merely
-- unlikely. lib/calendar/queries.ts's setReferencesDecision() writes both columns in one UPDATE
-- for the same reason.
--
-- ---------------------------------------------------------------------------
-- A REFERENCE BELONGS TO THE TALK, NOT TO A SLOT NUMBER
-- ---------------------------------------------------------------------------
-- `assignments.slot_number` can move — it is a deliberately non-triggering field in
-- topicShapeChanged() (lib/topics/finalize.ts) — and a scripture chosen for a talk goes with the
-- talk. So the key is the assignment row.
--
-- NO `sunday_id` COPY. The Sunday is reached through the assignment, and a second copy could
-- disagree with the first.
--
-- `on delete cascade` FROM assignments is safe TODAY because no path in the app deletes an
-- assignment row (lib/assignments/queries.ts has no such function). If one is ever added it must
-- decide what happens to references first — decisions.md §1.1, never destroy what somebody chose.
--
-- `on delete set null (document_id)`: deleting a knowledge document keeps the citation a person
-- chose, and loses only the link back to the source. Precedent: 047, 054, 059.
--
-- The CHECK on `source`: a MANUAL reference never claims a document. Only a tapped search result
-- carries one.
--
-- ---------------------------------------------------------------------------
-- ⚠️ THERE IS DELIBERATELY NO `created_by`
-- ---------------------------------------------------------------------------
-- 078's header gives the whole argument: a user column on a ward-scoped table carried a composite
-- `(user, ward_id)` key, and migration 069 narrowed forty-eight of them because a cross-ward
-- leader fails one as SQLSTATE 23503 — a 500, not a refusal. The audit row is where "who" lives.
--
-- ---------------------------------------------------------------------------
-- POLICIES
-- ---------------------------------------------------------------------------
-- READ follows the talk pipeline (`can_view_talks()`, migration 038) — a music coordinator can
-- see what a talk is built on. WRITE is the bishopric, which is `talks.plan`.
--
-- THE SELECT POLICY ADMITS EVERY WRITER (is_bishopric() ⊂ can_view_talks()), and that is
-- load-bearing: `.insert().select()` applies the SELECT policy to RETURNING
-- (plans/retros/p3-shell-and-tile-dashboard.md). Narrowing the read below the write would turn
-- every add into a refusal.
--
-- NO UPDATE POLICY, because there is no edit path — a reference is removed and re-added. Absence
-- is the boundary, as it is on `access_requests` (073).
--
-- THE `sundays` COLUMNS NEED NO POLICY CHANGE. Migration 019 lets the ward update `sundays`; the
-- route's `assertCan(user, "talks.plan")` is the role boundary — the same split 078 documents for
-- `topics.manage`.

alter table sundays
  add column references_finalized_at timestamptz,
  add column references_skipped_at timestamptz,
  add constraint sundays_references_one_decision
    check (references_finalized_at is null or references_skipped_at is null);

comment on column sundays.references_finalized_at is
  'When a member of the bishopric said this Sunday''s references are ready. Null means not '
  'finalized. Cleared when the day''s topics change (lib/topics/finalize.ts) and when a '
  'reference is added or removed (lib/references/finalize.ts). Never both this and '
  'references_skipped_at.';

comment on column sundays.references_skipped_at is
  'When a member of the bishopric said no references are being given this round. A recorded '
  'decision, never an empty list. Survives a topic change; cleared when a reference is added.';

create table talk_references (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  assignment_id uuid not null,
  kind          text not null check (kind in ('scripture', 'talk', 'other')),
  citation      text not null check (char_length(btrim(citation)) between 1 and 300),
  document_id   uuid,
  source        text not null check (source in ('search', 'manual')),
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (assignment_id, ward_id) references assignments (id, ward_id) on delete cascade,
  foreign key (document_id, ward_id) references knowledge_documents (id, ward_id)
    on delete set null (document_id),
  check (source = 'search' or document_id is null)
);

comment on table talk_references is
  'Scriptures and talks a member of the bishopric chose for one talk, from a search of the '
  'ward''s own library or typed by hand. Nothing here is generated.';

create index talk_references_ward_assignment_idx on talk_references (ward_id, assignment_id);

alter table talk_references enable row level security;

create policy talk_references_select on talk_references
  for select to authenticated
  using (ward_id = current_ward_id() and can_view_talks());

create policy talk_references_insert on talk_references
  for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric());

create policy talk_references_delete on talk_references
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());
