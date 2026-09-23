-- P4 module 1 (Sacrament), slice b2, migration 078: WHEN THE CONDUCTOR SAID A SUNDAY'S TOPICS
-- ARE DECIDED.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one nullable column with no
-- default, no CHECK, no policy change and no grant change. It sets nothing NOT NULL on existing
-- data, narrows no existing constraint and tightens no policy — every existing row reads null,
-- which is exactly "nobody has finalized this yet".
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. See 073's and 077's headers.
--
-- ---------------------------------------------------------------------------
-- A TIMESTAMP, NEVER A BOOLEAN
-- ---------------------------------------------------------------------------
-- youth_activity_profiles.closed_at's rule (migration 060), and for its two reasons.
--
-- "WHEN did somebody decide this" is the question the card actually asks, and a boolean throws
-- that away for nothing — there is no cheaper column than the one that also answers it.
--
-- And NULL IS HOW UN-FINALIZING WORKS WITHOUT A DELETE. A Sunday whose topics change after being
-- finalized goes back to null, which is the same state it started in, so the auto-unfinalize rule
-- needs no second column to say "it was finalized once and then it wasn't".
--
-- ---------------------------------------------------------------------------
-- ⚠️ THERE IS DELIBERATELY NO `topics_finalized_by`
-- ---------------------------------------------------------------------------
-- The instinct is to record who clicked it, and the instinct is wrong HERE in a way that is not
-- obvious. A user column on a ward-scoped table in this schema carried a COMPOSITE foreign key —
-- `(topics_finalized_by, ward_id) -> users (id, ward_id)` — asserting that whoever wrote the row
-- belongs to that row's ward. Migration 069 narrowed all FORTY-EIGHT of those, because under the
-- multi-ward model (migrations 068-071) a leader legitimately writes in a ward their ACCOUNT does
-- not live in, and the composite key fails that as SQLSTATE 23503: a 500, not a refusal.
--
-- So a new user column here would either re-create a key 069 spent a whole migration removing, or
-- be an unconstrained uuid that proves nothing. CLAUDE.md rule 6 already requires an audit row on
-- every mutation, and `audit_log` is where "who" lives — with a real user reference and, since
-- migration 067, one that works across wards.
--
-- ---------------------------------------------------------------------------
-- NO POLICY CHANGE, AND THE ROUTE IS THE REAL BOUNDARY FOR `topics.manage`
-- ---------------------------------------------------------------------------
-- `sundays` already carries ward-scoped policies on all four verbs from migration 019, and
-- migration 019 grants UPDATE on it to every authenticated member of the ward. So RLS stops a
-- cross-WARD write and nothing else, and `assertCan(user, "topics.manage", ...)` in
-- app/api/sundays/[id]/topics-finalized/route.ts is what stops an org secretary finalizing the
-- bishopric's topics.
--
-- That is the SAME split `calendar.manage` already has on this exact table — PATCH
-- /api/sundays/[id] asserts it in the route and migration 019 does not — and
-- tests/rls/calendar-access.test.ts documents it. Narrowing `sundays_update` to the bishopric
-- would break the conducting and prayer paths that legitimately write it, so the split is
-- deliberate rather than an omission. tests/rls/topics-finalized.test.ts asserts BOTH halves: the
-- ward isolation the policy really does provide, and the role refusal the route really does
-- provide.

alter table sundays add column topics_finalized_at timestamptz;

comment on column sundays.topics_finalized_at is
  'When a member of the bishopric said this Sunday''s topics are decided. Null means not '
  'finalized — the starting state, and the state a real change to the day''s topics returns it '
  'to (lib/topics/finalize.ts). Never derived from every slot happening to have a topic: a '
  'conductor filling slots in one at a time while still deciding must not read as done. No '
  'companion `_by` column — migration 069 is why, and the audit row is where "who" lives.';
