-- Talks C, migration 028: the AI-topic accept/reject queue.
--
-- Numbered 028, not the plan's 027. `plans/sunday-types-meeting-split.md` shipped first and took
-- 027 for the Sunday meeting types. Two migrations with the same number is a conflict the CLI
-- resolves by filename order, silently — so the number moves here rather than being discovered
-- during a push.
--
-- Phase 5 writes candidates here; a bishopric member accepts each one before it becomes a row in
-- `topics`. This table exists so there is NOWHERE for a generated topic to land except a queue
-- (CLAUDE.md rule 3: no AI output reaches a human or a database row without explicit approval).

create table topic_candidates (
  id                   uuid primary key default gen_random_uuid(),
  ward_id              uuid not null references wards (id) on delete cascade,
  title                text not null,
  category             text check (category in ('doctrinal','scriptural','conference_talk','seasonal','custom')),
  description          text,
  suggested_scriptures jsonb,
  suggested_talks      jsonb,
  status               text not null default 'pending' check (status in ('pending','accepted','rejected')),
  accepted_topic_id    uuid,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (accepted_topic_id, ward_id) references topics (id, ward_id) on delete set null,
  foreign key (reviewed_by, ward_id) references users (id, ward_id),
  -- A reviewed candidate always names WHO reviewed it and WHEN. Rule 3 is only meaningful if the
  -- accept is attributable, so a status of 'accepted' with a null reviewer is unrepresentable
  -- rather than merely discouraged.
  constraint topic_candidates_review_pair check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

alter table topic_candidates enable row level security;

-- Bishopric-only, matching `topics` and `assignments` rather than migration 019's ward-wide loop.
create policy topic_candidates_select on topic_candidates
  for select to authenticated using (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_insert on topic_candidates
  for insert to authenticated with check (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_update on topic_candidates
  for update to authenticated
  using (ward_id = current_ward_id() and is_bishopric())
  with check (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_delete on topic_candidates
  for delete to authenticated using (ward_id = current_ward_id() and is_bishopric());

create index topic_candidates_ward_status_idx on topic_candidates (ward_id, status, created_at);

-- The last-prayed lookup reads every `done` prayer for a set of members in one query, so the
-- picker annotates a whole roster without one round trip per name.
create index prayer_assignments_member_idx on prayer_assignments (ward_id, member_id, stage);

-- listTopics() orders by last_assigned_at NULLS FIRST inside one ward and status.
create index topics_ward_status_idx on topics (ward_id, status, last_assigned_at);

-- One invocation and one benediction per Sunday, enforced by the database rather than by the
-- upsert that relies on it. Without this a double-submit inserts a second invocation and the
-- Sunday quietly has two people assigned to the same prayer.
create unique index prayer_assignments_sunday_type_idx
  on prayer_assignments (ward_id, sunday_id, prayer_type);
