-- ITER-052, migration 098: A DECLINE NOTE IS THE BISHOPRIC'S ALONE, ENFORCED BY THE DATABASE.
--
-- Slice z3b (plans/zoom-self-registration.md, addendum A1, the user's decision 2026-10-31).
--
-- When a member of the bishopric declines a public Zoom sign-up they may write a private note —
-- "Only the bishopric sees this". Migration 096 granted `decline_note` to `authenticated` in its
-- column grant, and `zoom_registrations_select` admits the ward clerk and the executive secretary as
-- well as the bishopric, so either of them could have read it by name. The sentence on the window
-- would have been false.
--
-- So `authenticated` loses the column. Nobody reads it through their own client any more, the
-- bishopric included: the Sign-ups tab reads the notes with the SERVICE ROLE, after
-- canManageInvitees(), keyed by the declined ids on the page (readDeclineNotes() in
-- lib/zoom/registrationApprovals.ts) — the Remote links tab's shape. It is written only by the
-- service role already (the table has no write policy), so nothing about the write changes.
--
-- The grant below is 096's column list minus `decline_note` (and still minus `status_token_hash`).
-- Nothing in the app selects `decline_note` (REGISTRATION_COLUMNS in lib/zoom/registrations.ts
-- does not name it), so no deployed build breaks and this needs no HELD_BACK_UNTIL_DEPLOYED entry.
-- Migration 096's own header is not edited: an applied migration is never rewritten.

revoke select on zoom_registrations from authenticated;

grant select (
  id, ward_id, display_name, phone, phone_digits, email, says_member, answers, status,
  held_reason, referral_code, referred_by_registration_id, member_id, matched_by, matched_at,
  decided_by, decided_at, invitee_id, created_at, updated_at
) on zoom_registrations to authenticated;

comment on column zoom_registrations.decline_note is
  'The bishopric''s private note on a decline (ITER-052). Not granted to authenticated '
  '(migration 098): read only with the service role after canManageInvitees().';
