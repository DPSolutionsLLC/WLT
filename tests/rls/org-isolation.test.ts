// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, setCrossOrgVisibility, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("organization isolation", () => {
  let fixtures: Fixtures;
  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let eldersQuorumLogId: string;
  let reliefSocietyLogId: string;

  let eldersQuorumMemberId: string;
  let reliefSocietyMemberId: string;
  let wardBMemberId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "rsPresident", "wardBBishop"], {
      crossOrgVisibility: false,
    });

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");
    wardBBishop = await asRole(fixtures, "wardBBishop");

    const { data, error } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          visit_date: "2026-03-01",
          shared_notes: `EQ ${fixtures.runId}`,
        },
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          visit_date: "2026-03-08",
          shared_notes: `RS ${fixtures.runId}`,
        },
      ])
      .select("id, org_id");

    if (error) throw new Error(error.message);

    eldersQuorumLogId = data.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    reliefSocietyLogId = data.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    const insertMember = async (wardId: string, lastName: string) => {
      const { data: row, error: memberError } = await fixtures.service
        .from("members")
        .insert({
          ward_id: wardId,
          first_name: "Org",
          last_name: `${lastName} ${fixtures.runId}`,
          category: "adult",
          status: "active",
        })
        .select("id")
        .single();
      if (memberError) throw new Error(memberError.message);
      return row.id;
    };

    eldersQuorumMemberId = await insertMember(fixtures.wardAId, "Quorum");
    reliefSocietyMemberId = await insertMember(fixtures.wardAId, "Society");
    wardBMemberId = await insertMember(fixtures.wardBId, "WardB");

    const { error: membershipError } = await fixtures.service
      .from("member_organizations")
      .insert([
        {
          ward_id: fixtures.wardAId,
          member_id: eldersQuorumMemberId,
          org_id: fixtures.eldersQuorumId,
        },
        {
          ward_id: fixtures.wardAId,
          member_id: reliefSocietyMemberId,
          org_id: fixtures.reliefSocietyId,
        },
        {
          ward_id: fixtures.wardBId,
          member_id: wardBMemberId,
          org_id: fixtures.wardBOrgId,
        },
      ]);

    if (membershipError) throw new Error(membershipError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("with cross-org visibility off", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(fixtures, false);
    });

    it("hides another organization's visit logs", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("id")
        .eq("id", reliefSocietyLogId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("still shows the reader's own organization", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("id")
        .eq("id", eldersQuorumLogId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eldersQuorumLogId]);
    });
  });

  describe("with cross-org visibility on", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(fixtures, true);
    });

    it("shows another organization's shared notes", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("id, shared_notes")
        .eq("id", reliefSocietyLogId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([reliefSocietyLogId]);
      expect(data?.[0]?.shared_notes).toBe(`RS ${fixtures.runId}`);
    });

    // The setting widens reads only. This is the assertion that keeps a future "make
    // cross-org visibility fully symmetric" change from quietly granting write access.
    it("still refuses a write to another organization's log", async () => {
      const { data: updated, error } = await eqPresident
        .from("visit_logs")
        .update({ shared_notes: "tampered" })
        .eq("id", reliefSocietyLogId)
        .select("id");

      expect(error).toBeNull();
      expect(updated ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", reliefSocietyLogId)
        .single();

      expect(after?.shared_notes).toBe(`RS ${fixtures.runId}`);
    });

    it("still refuses an insert addressed to another organization", async () => {
      const { error } = await eqPresident.from("visit_logs").insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.reliefSocietyId,
        visit_date: "2026-03-15",
        shared_notes: "cross-org write",
      });

      expect(error).not.toBeNull();
    });

    it("still refuses a delete of another organization's log", async () => {
      const { data: deleted, error } = await eqPresident
        .from("visit_logs")
        .delete()
        .eq("id", reliefSocietyLogId)
        .select("id");

      expect(error).toBeNull();
      expect(deleted ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("visit_logs")
        .select("id")
        .eq("id", reliefSocietyLogId)
        .maybeSingle();

      expect(after?.id).toBe(reliefSocietyLogId);
    });

    it("lets the owning organization write its own log", async () => {
      const { data: updated, error } = await rsPresident
        .from("visit_logs")
        .update({ shared_notes: `RS updated ${fixtures.runId}` })
        .eq("id", reliefSocietyLogId)
        .select("id");

      expect(error).toBeNull();
      expect(updated?.map((row) => row.id)).toEqual([reliefSocietyLogId]);
    });
  });

  // member_organizations is in migration 019's WARD-scoped policy loop, not the org-scoped one.
  // That makes its isolation story deliberately different from visit_logs above, and the
  // difference is the whole reason roster-b's organization default is described as a
  // convenience rather than a boundary.
  describe("member_organizations", () => {
    it("hides another ward's memberships entirely", async () => {
      const { data, error } = await eqPresident
        .from("member_organizations")
        .select("id")
        .eq("member_id", wardBMemberId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("hides this ward's memberships from another ward", async () => {
      const { data, error } = await wardBBishop
        .from("member_organizations")
        .select("id")
        .eq("member_id", eldersQuorumMemberId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // THE UNCOMFORTABLE HALF, asserted on purpose — the way tests/rls/youth-isolation.test.ts
    // asserts its own. An org president CAN read another organization's memberships, because
    // the table is ward-scoped. Nothing is broken; this is what the policy says. A later reader
    // must not mistake lib/roster/organizationScope.ts for a security boundary, and this test is
    // where they will find out.
    it("lets an org president read another organization's memberships", async () => {
      const { data, error } = await eqPresident
        .from("member_organizations")
        .select("id, org_id")
        .eq("member_id", reliefSocietyMemberId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.org_id)).toEqual([fixtures.reliefSocietyId]);
    });

    // What makes bulk assign idempotent: re-assigning a member who is already there is a
    // no-op under ON CONFLICT DO NOTHING rather than an error the user has to interpret.
    it("rejects a duplicate (member_id, org_id)", async () => {
      const { error } = await fixtures.service.from("member_organizations").insert({
        ward_id: fixtures.wardAId,
        member_id: eldersQuorumMemberId,
        org_id: fixtures.eldersQuorumId,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("refuses a cross-ward insert", async () => {
      const { error } = await eqPresident.from("member_organizations").insert({
        ward_id: fixtures.wardBId,
        member_id: wardBMemberId,
        org_id: fixtures.wardBOrgId,
      });

      expect(error).not.toBeNull();
    });
  });
});
