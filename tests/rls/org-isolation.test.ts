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

  let eldersQuorumLogId: string;
  let reliefSocietyLogId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "rsPresident"], {
      crossOrgVisibility: false,
    });

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");

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
});
