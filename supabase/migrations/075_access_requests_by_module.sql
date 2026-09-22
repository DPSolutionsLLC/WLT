-- Phase 2, migration 075: A WARD ASKS FOR A MODULE, NOT FOR A PERMISSION.
--
-- Decided by the user 2026-09-22, walking scenario 067.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN CHANGES
-- ---------------------------------------------------------------------------
-- Migration 073 stored `permission`, and the picker in front of it offered 39 raw keys —
-- `topics.manage`, `calendar.manage_org_conducting` — beside a humanised role name. The
-- prototype's own role-access management page never worked that way: it asks for a MODULE with a
-- real descriptor and a LEVEL, and its request rows read "Relief Society President — Sacrament —
-- Talks (Full)".
--
-- THE WALK FOUND WHY THAT MATTERS BEYOND WORDING. It approved `topics.manage` for
-- `org_president`; the delta landed correctly; the topic library was still refused, because
-- `/talks/topics` gates on `topics.view` and nobody thought to ask for it. The card meanwhile read
-- "This is now turned on for your ward", which was false. A MODULE expands to a coherent set whose
-- `full` always contains its own `read`, so a grant can no longer arrive inert.
--
-- `level` finally means something, too. It was stored by 073 and read by nothing.
--
-- ---------------------------------------------------------------------------
-- A CLEAN SWAP IS SAFE HERE, AND THAT IS A FACT ABOUT THIS DEPLOY, NOT A HABIT
-- ---------------------------------------------------------------------------
-- `permission` is DROPPED rather than kept alongside. The rule that would normally forbid that —
-- expand, deploy, contract — exists because a running build selecting a missing column gets a 400
-- from PostgREST on every read (migration 063's header, learned the hard way).
--
-- IT DOES NOT APPLY: `origin/main` is at 071. `access_requests` does not exist in any deployed
-- build, so there is no reader anywhere to break. Verified before writing this file, not assumed.
-- If that ever stops being true for a similar change, hold the drop back.
--
-- No entry in HELD_BACK_UNTIL_DEPLOYED, and none should be added.
--
-- EXISTING ROWS ARE DISCARDED, deliberately. The only rows are harness walk data in a shared dev
-- project; there is no ward's real request to migrate, and mapping a permission back to whichever
-- module happens to contain it would invent a fact nobody recorded.

-- Nothing in production, and the seeded walk rows carry no decision anybody needs.
delete from access_requests;

alter table access_requests drop column permission;

-- Plain `text`, and deliberately NOT a CHECK against the module list. ACCESS_MODULES lives in
-- lib/access/accessModules.ts and grows with the app; a CHECK here would be a second copy of it,
-- free to disagree — the `notification-trigger-drift` shape (ITER-023). The Zod schema validates
-- against the real constant, which cannot drift from itself, and lib/access/requests.ts throws on
-- a value it cannot map rather than rendering a request nobody can act on.
alter table access_requests add column module text not null;

comment on column access_requests.module is
  'An ACCESS_MODULES key (lib/access/accessModules.ts), not a permission. With `level` it expands to the permissions an approval writes.';

comment on column access_requests.level is
  'F (full) or R (read only). Q is not offered: the prototype''s "their own organization only" is what RLS already does through current_org_id().';
