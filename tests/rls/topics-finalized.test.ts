// @vitest-environment node
//
// `sundays.topics_finalized_at` (migration 078) — the column that says a Sunday's topics are
// decided.
//
// ---------------------------------------------------------------------------
// TWO BOUNDARIES, AND THIS SUITE ASSERTS BOTH BECAUSE THEY ARE NOT THE SAME ONE
// ---------------------------------------------------------------------------
// MIGRATION 078 ADDS NO POLICY, deliberately. `sundays` is in migration 019's ward-scoped policy
// loop, which grants UPDATE to every authenticated member of the ward — an org_secretary
// included. So RLS stops a CROSS-WARD write and nothing else.
//
// The ROLE boundary is `assertCan(user, "topics.manage")` in
// app/api/sundays/[id]/topics-finalized/route.ts. That is the same split `calendar.manage`
// already has on this exact table, which tests/rls/calendar-access.test.ts documents for the same
// reason: asserting a denial that does not exist would be worse than naming the gap.
//
// So the first half below asserts what the POLICY really does, and the second asserts what the
// ROUTE really does — through the real handler, against the hosted project, as a genuinely
// authenticated user.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9), so every fixture is
// deleted by id in afterAll.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const STAMP = "2027-02-01T12:00:00.000Z";

describe("topics finalized", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";

  const readStamp = async (sundayId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("topics_finalized_at")
      .eq("id", sundayId)
      .single();

    if (error) throw new Error(error.message);
    return data.topics_finalized_at;
  };

  const clearStamps = async () => {
    const { error } = await fixtures.service
      .from("sundays")
      .update({ topics_finalized_at: null })
      .in("id", [wardASundayId, wardBSundayId]);

    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "eqSecretary",
      "musicCoordinator",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");

    const seedSunday = async (wardId: string, date: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId, "2027-02-07");
    wardBSundayId = await seedSunday(fixtures.wardBId, "2027-02-07");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  // ---------------------------------------------------------------------------
  // WHAT THE POLICY REALLY DOES: WARD ISOLATION
  // ---------------------------------------------------------------------------
  describe("the policy", () => {
    it("lets a bishop read the column on their own ward's Sunday", async () => {
      const { data, error } = await bishopA
        .from("sundays")
        .select("id, topics_finalized_at")
        .eq("id", wardASundayId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.id).toBe(wardASundayId);
    });

    it("hides another ward's Sunday entirely", async () => {
      const { data, error } = await bishopA
        .from("sundays")
        .select("id, topics_finalized_at")
        .eq("id", wardBSundayId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    // ⚠️ ASSERTED BY RE-READING THE ROW WITH THE SERVICE CLIENT. An RLS-denied UPDATE is a
    // ZERO-ROW SUCCESS, not an error — only INSERT raises — so `error === null` here proves
    // nothing at all and the stamp is the only honest evidence (CLAUDE.md §8).
    it("refuses a cross-ward write, silently", async () => {
      await clearStamps();

      const { error } = await bishopA
        .from("sundays")
        .update({ topics_finalized_at: STAMP })
        .eq("id", wardBSundayId);

      expect(error).toBeNull();
      expect(await readStamp(wardBSundayId)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // WHAT THE ROUTE REALLY DOES: `topics.manage`
  // ---------------------------------------------------------------------------
  // The permission, not the policy. An org_secretary is in migration 019's UPDATE grant on
  // `sundays` and would succeed against the table directly — which is exactly why the route has
  // to be the thing that is asserted.
  describe("the route", () => {
    const callPatch = async (sundayId: string, finalized: boolean) => {
      const { PATCH } = await import(
        "@/app/api/sundays/[id]/topics-finalized/route"
      );

      return readResponse(
        await PATCH(
          jsonRequest(`http://localhost/api/sundays/${sundayId}/topics-finalized`, {
            method: "PATCH",
            body: { finalized },
          }),
          { params: Promise.resolve({ id: sundayId }) },
        ),
      );
    };

    it("lets a bishop finalize their own ward's Sunday", async () => {
      await clearStamps();
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(wardASundayId, true);

      expect(status).toBe(200);
      expect(await readStamp(wardASundayId)).not.toBeNull();
    });

    // CLAUDE.md §7: bishopric admin authority is SHARED. A counselor holds exactly what a bishop
    // holds, and a check that granted the bishop something a counselor lacked would be a bug.
    it("lets a counselor un-finalize what the bishop finalized", async () => {
      await actAs(fixtures, "counselor1");

      const { status } = await callPatch(wardASundayId, false);

      expect(status).toBe(200);
      expect(await readStamp(wardASundayId)).toBeNull();
    });

    it("refuses an org secretary, who CAN write the table directly", async () => {
      await clearStamps();
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPatch(wardASundayId, true);

      expect(status).toBe(403);
      expect(await readStamp(wardASundayId)).toBeNull();
    });

    // The role this signal is FOR, and it must not be able to set it. A music coordinator reads
    // "Topics pending" on /music; deciding that a Sunday is settled is the conductor's act.
    it("refuses a music coordinator", async () => {
      await clearStamps();
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callPatch(wardASundayId, true);

      expect(status).toBe(403);
      expect(await readStamp(wardASundayId)).toBeNull();
    });

    // 404 rather than 403: a Sunday in another ward and a Sunday RLS refused are indistinguishable
    // to this handler, and both mean "not yours".
    it("answers 404 for another ward's Sunday, even to a bishop", async () => {
      await clearStamps();
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(wardBSundayId, true);

      expect(status).toBe(404);
      expect(await readStamp(wardBSundayId)).toBeNull();
    });
  });
});
