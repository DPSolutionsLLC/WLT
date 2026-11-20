-- ITER-058 slice cr4, migration 106: an invite names a person on the ward list
-- (plans/roster-decides-callings.md Task 14).
--
-- ---------------------------------------------------------------------------
-- WHY THE ROLE LEAVES THE INVITE
-- ---------------------------------------------------------------------------
-- An invite used to carry the role the sender picked from a list, and the server took it on trust
-- — including `super_admin`, which the role CHECK below still admits. From cr4 the sender picks the
-- PERSON, and the server derives the calling from that person's ward list callings
-- (lib/callings/lcrCallingMap.ts), both when the invite is made and again when it is redeemed, so a
-- calling that changed in between is refused rather than granted.
--
-- `role` stays, nullable as it has been since migration 002, so an invite created before this
-- deploy still redeems exactly as it did. The CHECK says every invite names one or the other.
--
-- `member_id` is tied to the invite's own ward by a composite key, so an invite can never name
-- somebody on another ward's list. Deleting the member deletes an unused invite naming them: it
-- could only ever have been refused.
--
-- No policy moves. `invites` keeps migration 019's bishopric-only policies.

alter table invites add column member_id uuid;

alter table invites
  add constraint invites_member_fkey
  foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade;

alter table invites
  add constraint invites_names_member_or_role
  check (member_id is not null or role is not null);

create index invites_member_id_idx on invites (member_id) where member_id is not null;
