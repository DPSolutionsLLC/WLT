// @vitest-environment node
//
// `ai_settings` is in migration 019's BISHOPRIC-ONLY loop: select, insert, update and delete are
// each gated on `ward_id = current_ward_id() and is_bishopric()`. That makes the policy the
// security boundary and the route merely convenient (CLAUDE.md rule 2), so this suite proves the
// policy directly rather than through a handler.
//
// What is at stake here is not only privacy. The ward's AI settings are the instructions every
// generated draft is written under — a ward that could write into another ward's row would be
// putting words in a bishopric's mouth.
//
// Every negative UPDATE and DELETE assertion RE-READS the row with the service client. An
// RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error; only INSERT raises
// (plans/retros/foundation-c-services.md).
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// `ai_settings.view` and `ai_settings.manage` are bishopric-only in lib/auth/permissions.ts, and
// the policy agrees. Both halves are asserted, because a matrix and a policy that disagree is how
// a route ends up being the only thing standing between a role and a table.
const REFUSED_HANDLES = [
  "wardSecretary",
  "executiveSecretary",
  "eqPresident",
  "musicCoordinator",
  "sacramentManager",
] as const;

describe("ai_settings access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let counselorA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardASettingsId = "";
  let wardBSettingsId = "";

  const seedSettings = async (wardId: string, tone: string) => {
    const { data, error } = await fixtures.service
      .from("ai_settings")
      .insert({ ward_id: wardId, tone_voice: `${tone} ${fixtures.runId}` })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed ai_settings: ${error.message}`);
    return data.id;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "wardSecretary",
      "executiveSecretary",
      "eqPresident",
      "musicCoordinator",
      "sacramentManager",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    counselorA = await asRole(fixtures, "counselor1");
    bishopB = await asRole(fixtures, "wardBBishop");

    wardASettingsId = await seedSettings(fixtures.wardAId, "Ward A tone");
    wardBSettingsId = await seedSettings(fixtures.wardBId, "Ward B tone");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("cross-ward isolation", () => {
    it("hides another ward's settings", async () => {
      const { data, error } = await bishopA
        .from("ai_settings")
        .select("id")
        .eq("ward_id", fixtures.wardBId);

      expect(error).toBeNull();
      expect(data, "ward A's bishop saw ward B's AI settings").toEqual([]);
    });

    it("lets each ward's own bishop read its own settings", async () => {
      const own = await bishopA.from("ai_settings").select("id").eq("id", wardASettingsId);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const theirs = await bishopB
        .from("ai_settings")
        .select("id")
        .eq("id", wardBSettingsId);
      expect(theirs.error).toBeNull();
      expect(theirs.data).toHaveLength(1);
    });

    it("refuses an insert naming another ward", async () => {
      const { error } = await bishopA
        .from("ai_settings")
        .insert({ ward_id: fixtures.wardBId, tone_voice: `Smuggled ${fixtures.runId}` })
        .select("id");

      // An INSERT that fails its WITH CHECK raises, unlike a filtered UPDATE.
      expect(error).not.toBeNull();
    });

    it("refuses an update into another ward's settings", async () => {
      const { data, error } = await bishopA
        .from("ai_settings")
        .update({ tone_voice: "written from ward A" })
        .eq("id", wardBSettingsId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: untouched } = await fixtures.service
        .from("ai_settings")
        .select("tone_voice")
        .eq("id", wardBSettingsId)
        .single();

      expect(untouched?.tone_voice).toBe(`Ward B tone ${fixtures.runId}`);
    });

    it("refuses a delete of another ward's settings", async () => {
      const { data, error } = await bishopA
        .from("ai_settings")
        .delete()
        .eq("id", wardBSettingsId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("ai_settings")
        .select("id")
        .eq("id", wardBSettingsId)
        .maybeSingle();

      expect(survivor?.id).toBe(wardBSettingsId);
    });
  });

  describe("roles inside the ward", () => {
    // CLAUDE.md §7: bishopric admin authority is SHARED. A counselor reads and writes exactly
    // what the bishop does.
    it("gives a counselor the same access as the bishop", async () => {
      const { data, error } = await counselorA
        .from("ai_settings")
        .select("id")
        .eq("id", wardASettingsId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: inserted, error: insertError } = await counselorA
        .from("ai_settings")
        .insert({ ward_id: fixtures.wardAId, tone_voice: `Counselor save ${fixtures.runId}` })
        .select("id")
        .single();

      expect(insertError).toBeNull();
      expect(inserted?.id).toBeTruthy();
    });

    it("hides the settings from every non-bishopric role", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("ai_settings")
          .select("id")
          .eq("ward_id", fixtures.wardAId);

        expect(error, `${handle} errored reading ai_settings`).toBeNull();
        expect(data, `${handle} could read ai_settings`).toEqual([]);
      }
    });

    it("refuses every non-bishopric role an insert", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { error } = await client
          .from("ai_settings")
          .insert({ ward_id: fixtures.wardAId, tone_voice: `Sneaked ${handle}` })
          .select("id");

        expect(error, `${handle} could insert ai_settings`).not.toBeNull();
      }
    });

    it("refuses every non-bishopric role an update to the ward's own settings", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("ai_settings")
          .update({ tone_voice: `Rewritten by ${handle}` })
          .eq("id", wardASettingsId)
          .select("id");

        expect(error, `${handle} errored updating ai_settings`).toBeNull();
        expect(data, `${handle} could update ai_settings`).toEqual([]);
      }

      const { data: untouched } = await fixtures.service
        .from("ai_settings")
        .select("tone_voice")
        .eq("id", wardASettingsId)
        .single();

      expect(untouched?.tone_voice).toBe(`Ward A tone ${fixtures.runId}`);
    });
  });
});
