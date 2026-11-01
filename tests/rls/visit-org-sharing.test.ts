// @vitest-environment node
//
// ITER-055 slice bv1, migration 099: EACH ORGANIZATION'S VISITS ARE ITS OWN UNTIL THE BISHOPRIC
// SHARES THEM, ORGANIZATION BY ORGANIZATION.
//
// All SIX tables whose SELECT policy now asks visit_org_visible_to_caller() are asserted here, on
// both sides of a grant — 053's header named four widened tables when there were six, and the two
// it missed (appointments, participants) were the two no test covered.
//
// Also asserted: a grant is ONE-DIRECTIONAL; a write is never widened by one; a private note never
// moves; the Bishopric's visits (stored with org_id = null) are reached through a grant on the
// ward's bishopric-typed organization; and visit_org_sharing itself has no write path for any
// authenticated client, the bishop included.
//
// A refused UPDATE is a zero-row SUCCESS, so every write refusal is proven by RE-READING the row
// with the service client. Runs over the network against the shared hosted project.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const SIX_TABLES = [
  "visit_logs",
  "visit_goals",
  "household_visit_cadences",
  "household_stewardships",
  "visit_appointments",
  "visit_participants",
] as const;
type SixTable = (typeof SIX_TABLES)[number];

const EQ_SHARED = "EQ shared: helped move the piano.";
const EQ_PRIVATE = "EQ private: never leaves the author.";
const BISHOPRIC_SHARED = "Bishopric shared: a good visit.";

describe("visit sharing between organizations (migration 099)", () => {
  let fixtures: Fixtures;
  let bishop: Client;
  let eqPresident: Client;
  let rsPresident: Client;
  let wardId: string;
  let bishopricOrgId: string;

  const eqRowIds: Partial<Record<SixTable, string>> = {};
  let bishopricLogId: string;

  const readIds = async (client: Client, table: SixTable): Promise<string[]> => {
    const { data, error } = await client.from(table).select("id").eq("ward_id", wardId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).map((row) => row.id);
  };

  const share = async (ownerOrgId: string, viewerOrgId: string): Promise<void> => {
    const { error } = await fixtures.service.from("visit_org_sharing").insert({
      ward_id: wardId,
      owner_org_id: ownerOrgId,
      viewer_org_id: viewerOrgId,
    });
    if (error) throw new Error(error.message);
  };

  const unshareAll = async (): Promise<void> => {
    const { error } = await fixtures.service
      .from("visit_org_sharing")
      .delete()
      .eq("ward_id", wardId);
    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident"]);
    wardId = fixtures.wardAId;
    bishop = await asRole(fixtures, "bishop");
    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");

    // The shared fixtures carry no Bishopric organization, and a real ward always has one
    // (lib/units/provisionWard.ts). Added here, for this suite only.
    const { data: bishopricOrg, error: orgError } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (orgError) throw new Error(orgError.message);
    bishopricOrgId = bishopricOrg.id;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Sharing ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const eq = fixtures.eldersQuorumId;

    const { data: log, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: wardId,
        org_id: eq,
        household_id: household.id,
        recorded_by: fixtures.user("eqPresident").id,
        visit_date: "2026-04-05",
        shared_notes: EQ_SHARED,
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);
    eqRowIds.visit_logs = log.id;

    const { error: noteError } = await eqPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: log.id,
      user_id: fixtures.user("eqPresident").id,
      notes: EQ_PRIVATE,
    });
    if (noteError) throw new Error(noteError.message);

    const inserts: [SixTable, Record<string, unknown>][] = [
      [
        "visit_goals",
        {
          ward_id: wardId,
          org_id: eq,
          title: "EQ goal",
          target_type: "all_households",
          cadence_amount: 1,
          cadence_unit: "year",
          notice_amount: 1,
          notice_unit: "month",
        },
      ],
      [
        "household_visit_cadences",
        {
          ward_id: wardId,
          org_id: eq,
          household_id: household.id,
          cadence_amount: 3,
          cadence_unit: "month",
        },
      ],
      ["household_stewardships", { ward_id: wardId, org_id: eq, household_id: household.id }],
      [
        "visit_appointments",
        {
          ward_id: wardId,
          org_id: eq,
          household_id: household.id,
          scheduled_for: "2026-05-01T01:30:00Z",
        },
      ],
      [
        "visit_participants",
        { ward_id: wardId, org_id: eq, visit_log_id: log.id, label: "A companion" },
      ],
    ];

    for (const [table, row] of inserts) {
      const { data, error } = await fixtures.service
        .from(table)
        .insert(row as never)
        .select("id")
        .single();
      if (error) throw new Error(`${table}: ${error.message}`);
      eqRowIds[table] = (data as { id: string }).id;
    }

    // A BISHOPRIC visit: org_id = null, exactly as POST /api/visits writes it.
    const { data: bishopricLog, error: bishopricLogError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: wardId,
        org_id: null,
        household_id: household.id,
        recorded_by: fixtures.user("bishop").id,
        visit_date: "2026-04-06",
        shared_notes: BISHOPRIC_SHARED,
      })
      .select("id")
      .single();
    if (bishopricLogError) throw new Error(bishopricLogError.message);
    bishopricLogId = bishopricLog.id;
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("with nothing shared", () => {
    beforeAll(unshareAll);

    it.each(SIX_TABLES)("hides the Elders Quorum's %s from the Relief Society", async (table) => {
      expect(await readIds(rsPresident, table)).not.toContain(eqRowIds[table]);
    });

    it.each(SIX_TABLES)("shows the Elders Quorum its own %s", async (table) => {
      expect(await readIds(eqPresident, table)).toContain(eqRowIds[table]);
    });

    it("hides the bishopric's visit from the Elders Quorum", async () => {
      expect(await readIds(eqPresident, "visit_logs")).not.toContain(bishopricLogId);
    });

    it("shows the bishop every row", async () => {
      const logs = await readIds(bishop, "visit_logs");
      expect(logs).toContain(eqRowIds.visit_logs);
      expect(logs).toContain(bishopricLogId);
    });
  });

  describe("with the Elders Quorum shared with the Relief Society", () => {
    beforeAll(async () => {
      await unshareAll();
      await share(fixtures.eldersQuorumId, fixtures.reliefSocietyId);
    });

    it.each(SIX_TABLES)("shows the Relief Society the Elders Quorum's %s", async (table) => {
      expect(await readIds(rsPresident, table)).toContain(eqRowIds[table]);
    });

    it("shows the Relief Society the shared report", async () => {
      const { data, error } = await rsPresident
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", eqRowIds.visit_logs!)
        .single();
      expect(error).toBeNull();
      expect(data?.shared_notes).toBe(EQ_SHARED);
    });

    it("never shows the Relief Society the Elders Quorum's private note", async () => {
      const { data, error } = await rsPresident
        .from("visit_private_notes")
        .select("notes")
        .eq("ward_id", wardId);
      expect(error).toBeNull();
      expect(JSON.stringify(data)).not.toContain(EQ_PRIVATE);
    });

    it("does not show the bishopric's visit, which was not shared", async () => {
      expect(await readIds(rsPresident, "visit_logs")).not.toContain(bishopricLogId);
    });

    it("lets the Relief Society write nothing of the Elders Quorum's", async () => {
      const { error: updateError } = await rsPresident
        .from("visit_logs")
        .update({ shared_notes: "overwritten" })
        .eq("id", eqRowIds.visit_logs!);
      expect(updateError).toBeNull();

      const { data } = await fixtures.service
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", eqRowIds.visit_logs!)
        .single();
      expect(data?.shared_notes).toBe(EQ_SHARED);

      const { error: insertError } = await rsPresident.from("visit_logs").insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_date: "2026-05-03",
        shared_notes: "should never exist",
      });
      expect(insertError).not.toBeNull();
    });
  });

  describe("a grant is one-directional", () => {
    let rsLogId: string;

    beforeAll(async () => {
      await unshareAll();
      await share(fixtures.eldersQuorumId, fixtures.reliefSocietyId);

      const { data, error } = await fixtures.service
        .from("visit_logs")
        .insert({
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          visit_date: "2026-04-07",
          shared_notes: "RS shared",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      rsLogId = data.id;
    });

    it("does not show the Elders Quorum the Relief Society's visits", async () => {
      expect(await readIds(eqPresident, "visit_logs")).not.toContain(rsLogId);
    });
  });

  describe("with the Bishopric shared with the Elders Quorum", () => {
    beforeAll(async () => {
      await unshareAll();
      await share(bishopricOrgId, fixtures.eldersQuorumId);
    });

    it("shows the Elders Quorum the bishopric's visit (stored with no organization)", async () => {
      expect(await readIds(eqPresident, "visit_logs")).toContain(bishopricLogId);
    });

    it("still hides it from the Relief Society", async () => {
      expect(await readIds(rsPresident, "visit_logs")).not.toContain(bishopricLogId);
    });

    it("lets the Elders Quorum change nothing of it", async () => {
      await eqPresident
        .from("visit_logs")
        .update({ shared_notes: "overwritten" })
        .eq("id", bishopricLogId);

      const { data } = await fixtures.service
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", bishopricLogId)
        .single();
      expect(data?.shared_notes).toBe(BISHOPRIC_SHARED);
    });
  });

  describe("visit_org_sharing itself", () => {
    beforeAll(async () => {
      await unshareAll();
      await share(fixtures.eldersQuorumId, fixtures.reliefSocietyId);
    });

    it("is readable ward-wide", async () => {
      const { data, error } = await eqPresident
        .from("visit_org_sharing")
        .select("owner_org_id, viewer_org_id")
        .eq("ward_id", wardId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("refuses an insert from the bishop — the route is the only writer", async () => {
      const { error } = await bishop.from("visit_org_sharing").insert({
        ward_id: wardId,
        owner_org_id: fixtures.reliefSocietyId,
        viewer_org_id: fixtures.eldersQuorumId,
      });
      expect(error).not.toBeNull();
    });

    it("changes nothing when the bishop deletes a grant", async () => {
      await bishop.from("visit_org_sharing").delete().eq("ward_id", wardId);

      const { data } = await fixtures.service
        .from("visit_org_sharing")
        .select("id")
        .eq("ward_id", wardId);
      expect(data).toHaveLength(1);
    });
  });
});
