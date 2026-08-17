// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can, type KnownPermission } from "@/lib/auth/permissions";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";
import type { SessionUser } from "@/types/domain";

// tests/rls/sacrament-access.test.ts covers what a sacrament manager CAN do. This file covers
// everything a youth account must not reach — and its most important finding is that RLS is
// not the whole boundary.
//
// The ward-scoped policies generated in migration 019 admit ANY authenticated member of the
// ward to `members`, `households`, `sundays`, and `agendas`. A youth account is a member of
// the ward, so the database hands it those rows. What keeps a teenager out of the roster is
// SACRAMENT_MANAGER_PERMISSIONS plus the separate shell in app/(youth)/ — not a policy. That
// asymmetry is the strongest argument for the separate shell, and it is asserted below rather
// than left as a comment, so a later change that assumes RLS is doing the work fails here.
//
// Tables run by the bishopric-only loop (`invites`, `topics`, `tithing_entries`) and
// `audit_log` are the opposite case: there the database genuinely is the boundary.

const YOUTH_SESSION_USER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000000",
  wardId: "00000000-0000-4000-8000-000000000001",
  role: "sacrament_manager",
  orgId: null,
  counselorPosition: null,
  firstName: "Youth",
  lastName: "Fixture",
  username: "jsmith",
  themePreference: "system",
  isActive: true,
};

// Every permission guarding a page whose tables a policy would happily serve rows for.
const PERMISSIONS_RLS_DOES_NOT_ENFORCE: KnownPermission[] = [
  "roster.view",
  "roster.manage",
  "calendar.view",
  "calendar.manage",
  "visits.view",
  "visits.create",
  "agendas.view",
  "agendas.manage",
  "talks.view",
  "goals.view",
  "notifications.view",
  "admin.view",
  "audit.view",
];

describe("youth account isolation", () => {
  let fixtures: Fixtures;
  let youth: SupabaseClient<Database>;

  let sundayId: string;
  let householdId: string;
  let agendaId: string;
  let assignmentId: string;
  let poolId: string;
  let topicId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "sacramentManager"]);
    youth = await asRole(fixtures, "sacramentManager");

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: fixtures.wardAId, date: "2026-04-05" })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: `Fixture${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    householdId = household.id;

    const { data: agenda, error: agendaError } = await fixtures.service
      .from("agendas")
      .insert({
        ward_id: fixtures.wardAId,
        meeting_type: "bishopric",
        meeting_date: "2026-04-05",
      })
      .select("id")
      .single();
    if (agendaError) throw new Error(agendaError.message);
    agendaId = agenda.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("sacrament_assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        assignment_type: "bread_blessing",
        member_ids: [],
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;

    const { data: pool, error: poolError } = await fixtures.service
      .from("sacrament_rotation_pools")
      .insert({
        ward_id: fixtures.wardAId,
        assignment_type: "bread_blessing",
        member_ids: [],
      })
      .select("id")
      .single();
    if (poolError) throw new Error(poolError.message);
    poolId = pool.id;

    const { error: managerError } = await fixtures.service
      .from("sacrament_assignment_managers")
      .insert({
        ward_id: fixtures.wardAId,
        user_id: fixtures.user("sacramentManager").id,
        is_active: true,
      });
    if (managerError) throw new Error(managerError.message);

    const { data: topic, error: topicError } = await fixtures.service
      .from("topics")
      .insert({
        ward_id: fixtures.wardAId,
        title: `wlt-test topic ${fixtures.runId}`,
        category: "doctrinal",
        source: "manual",
        status: "active",
      })
      .select("id")
      .single();
    if (topicError) throw new Error(topicError.message);
    topicId = topic.id;

    const { error: inviteError } = await fixtures.service.from("invites").insert({
      ward_id: fixtures.wardAId,
      email: `wlt-test-${fixtures.runId}-youth-isolation@wardleadershiptools.test`,
      role: "ward_council_member",
      invited_by: fixtures.user("bishop").id,
      token: `wlt-test-token-${fixtures.runId}-youth-isolation`,
    });
    if (inviteError) throw new Error(inviteError.message);

    const { error: auditError } = await fixtures.service.from("audit_log").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("bishop").id,
      action: "login",
      module: "auth",
    });
    if (auditError) throw new Error(auditError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the permission matrix, not RLS, is what closes the rest of the app", () => {
    it.each(PERMISSIONS_RLS_DOES_NOT_ENFORCE)("refuses %s", (permission) => {
      expect(can(YOUTH_SESSION_USER, permission)).toBe(false);
    });

    it("grants exactly the three sacrament permissions and nothing else", () => {
      expect(can(YOUTH_SESSION_USER, "sacrament.view_assignments")).toBe(true);
      expect(can(YOUTH_SESSION_USER, "sacrament.update_assignments")).toBe(true);
      expect(can(YOUTH_SESSION_USER, "sacrament.mark_sent")).toBe(true);
      expect(can(YOUTH_SESSION_USER, "sacrament.manage_pools")).toBe(false);
      expect(can(YOUTH_SESSION_USER, "sacrament.manage_manager")).toBe(false);
      expect(can(YOUTH_SESSION_USER, "admin.manage_users")).toBe(false);
    });

    // The uncomfortable half of the finding, asserted so nobody later mistakes the separate
    // shell for belt-and-braces. If one of these ever starts failing because a policy was
    // tightened, that is good news — but it should be a decision, not a surprise.
    it("still receives calendar rows from the database", async () => {
      const { data, error } = await youth.from("sundays").select("id").eq("id", sundayId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([sundayId]);
    });

    it("still receives roster rows from the database", async () => {
      const { data, error } = await youth
        .from("households")
        .select("id")
        .eq("id", householdId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([householdId]);
    });

    it("still receives agenda rows from the database", async () => {
      const { data, error } = await youth.from("agendas").select("id").eq("id", agendaId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([agendaId]);
    });
  });

  describe("tables where RLS genuinely is the boundary", () => {
    it("reads zero audit log rows", async () => {
      const { data, error } = await youth.from("audit_log").select("id");

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("reads zero invites", async () => {
      const { data, error } = await youth.from("invites").select("id");

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("reads zero topics", async () => {
      const { data, error } = await youth.from("topics").select("id").eq("id", topicId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("reads zero tithing entries", async () => {
      const { data, error } = await youth.from("tithing_entries").select("id");

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("reads zero sacrament rotation pools", async () => {
      const { data, error } = await youth
        .from("sacrament_rotation_pools")
        .select("id")
        .eq("id", poolId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // Not a youth-specific rule: visit_logs is org-scoped, and a sacrament_manager has no
    // org_id. Worth pinning anyway, because the plan for this file assumed it behaved like
    // the ward-scoped tables above and it does not.
    it("reads zero visit logs, because it belongs to no organization", async () => {
      const { data, error } = await youth.from("visit_logs").select("id");

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  });

  // The manager's exact capability: adjust the assignments that exist, create none.
  describe("the one module it does reach", () => {
    it("updates an existing sacrament assignment", async () => {
      const { data, error } = await youth
        .from("sacrament_assignments")
        .update({ override_reason: "swapped at short notice" })
        .eq("id", assignmentId)
        .select("id");

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([assignmentId]);
    });

    it("cannot create a sacrament assignment", async () => {
      const { error } = await youth.from("sacrament_assignments").insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        assignment_type: "water_blessing",
        member_ids: [],
      });

      expect(error).not.toBeNull();
    });
  });

  // youth_login_attempts has RLS enabled and no policies at all (migration 021). A
  // failed-attempt count is not something any ward member needs to see, including the account
  // it is about — and an account that could delete its own row could bypass the lockout.
  describe("the lockout table", () => {
    it("is unreadable by an authenticated account", async () => {
      const { data, error } = await youth.from("youth_login_attempts").select("id");

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("cannot be written by an authenticated account", async () => {
      const { error } = await youth.from("youth_login_attempts").insert({
        ward_id: fixtures.wardAId,
        username: `wlt-test-${fixtures.runId}-forged`,
        failed_count: 0,
      });

      expect(error).not.toBeNull();
    });
  });
});
