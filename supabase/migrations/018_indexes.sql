-- Foundation B, migration 018: indexes.
--
-- Every RLS policy in migration 019 filters on ward_id. Without an index on that column,
-- every policy check is a sequential scan — on the hot path of literally every query in the
-- app. These are correctness-adjacent, not a nicety.
--
-- Columns already covered by a UNIQUE constraint (which creates its own index) are not
-- repeated here.

create index members_ward_id_idx on members (ward_id);
create index member_notes_ward_id_idx on member_notes (ward_id);
create index member_organizations_ward_id_idx on member_organizations (ward_id);
create index households_ward_id_idx on households (ward_id);
create index organizations_ward_id_idx on organizations (ward_id);
create index users_ward_id_idx on users (ward_id);
create index invites_ward_id_idx on invites (ward_id);
create index sundays_ward_id_idx on sundays (ward_id);
create index conducting_rotation_ward_id_idx on conducting_rotation (ward_id);
create index topics_ward_id_idx on topics (ward_id);
create index assignments_ward_id_idx on assignments (ward_id);
create index assignment_approvals_ward_id_idx on assignment_approvals (ward_id);
create index assignment_comments_ward_id_idx on assignment_comments (ward_id);
create index assignment_history_ward_id_idx on assignment_history (ward_id);
create index prayer_assignments_ward_id_idx on prayer_assignments (ward_id);
create index hymn_selections_ward_id_idx on hymn_selections (ward_id);
create index musical_numbers_ward_id_idx on musical_numbers (ward_id);
create index programs_ward_id_idx on programs (ward_id);
create index public_pages_ward_id_idx on public_pages (ward_id);
create index visit_goals_ward_id_idx on visit_goals (ward_id);
create index visit_logs_ward_id_idx on visit_logs (ward_id);
create index visit_private_notes_ward_id_idx on visit_private_notes (ward_id);
create index report_read_status_ward_id_idx on report_read_status (ward_id);
create index youth_activity_profiles_ward_id_idx on youth_activity_profiles (ward_id);
create index activity_calendars_ward_id_idx on activity_calendars (ward_id);
create index activity_events_ward_id_idx on activity_events (ward_id);
create index activity_attendees_ward_id_idx on activity_attendees (ward_id);
create index activity_logs_ward_id_idx on activity_logs (ward_id);
create index activity_private_notes_ward_id_idx on activity_private_notes (ward_id);
create index goals_ward_id_idx on goals (ward_id);
create index tithing_sessions_ward_id_idx on tithing_sessions (ward_id);
create index tithing_entries_ward_id_idx on tithing_entries (ward_id);
create index agendas_ward_id_idx on agendas (ward_id);
create index action_items_ward_id_idx on action_items (ward_id);
create index notifications_ward_id_idx on notifications (ward_id);
create index notification_user_prefs_ward_id_idx on notification_user_prefs (ward_id);
create index knowledge_documents_ward_id_idx on knowledge_documents (ward_id);
create index document_chunks_ward_id_idx on document_chunks (ward_id);
create index ai_settings_ward_id_idx on ai_settings (ward_id);
create index audit_log_ward_id_idx on audit_log (ward_id);
create index sacrament_rotation_pools_ward_id_idx on sacrament_rotation_pools (ward_id);
create index sacrament_assignment_managers_ward_id_idx on sacrament_assignment_managers (ward_id);
create index sacrament_assignments_ward_id_idx on sacrament_assignments (ward_id);
create index sacrament_send_log_ward_id_idx on sacrament_send_log (ward_id);
create index conversation_threads_ward_id_idx on conversation_threads (ward_id);
create index conversation_messages_ward_id_idx on conversation_messages (ward_id);

-- Query paths named in 00-foundation.md.
create index members_household_id_idx on members (household_id);
create index assignments_sunday_id_idx on assignments (sunday_id);
create index assignments_member_id_idx on assignments (member_id);
create index visit_logs_household_visit_date_idx on visit_logs (household_id, visit_date desc);
create index activity_events_event_date_idx on activity_events (event_date);
create index notifications_recipient_read_idx on notifications (recipient_user_id, read_at);
create index audit_log_ward_created_idx on audit_log (ward_id, created_at desc);

-- One topic per title per ward, case-insensitively. Also what makes the base-topic seed
-- idempotent: it re-runs on every db:reset and must not duplicate the library.
create unique index topics_ward_title_key on topics (ward_id, lower(title));

-- Exactly one active sacrament assignment manager per ward. Partial, so inactive historical
-- rows can accumulate without colliding.
create unique index sacrament_assignment_managers_one_active_idx
  on sacrament_assignment_managers (ward_id)
  where is_active;

-- The ivfflat index on document_chunks.embedding is deliberately NOT created here.
-- Its quality depends on the data already being present — building it on an empty table
-- produces useless lists. It belongs in phase 5 (plans/05-ai-platform.md), after the
-- standard works have been chunked and embedded.
