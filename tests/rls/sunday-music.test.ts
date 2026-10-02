// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures, type FixtureHandle } from "@/tests/helpers/seed";

// `sunday_music` (migration 089a) has a SELECT policy and NO WRITE POLICIES AT ALL.
//
// That absence is the enforcement: the music submission's status machine, and the rule that
// nobody approves their own submission (ITER-038 A3), hold because no authenticated client can
// write the row — only lib/music/* with the service role, behind a route's guard. So the suite
// refuses EVERY role on EVERY write verb, the bishop and the music coordinator included: they are
// the two roles whose routes write this table, and the table must still refuse them directly.
//
// THE REFUSAL SHAPES DIFFER AND BOTH ARE ASSERTED: a denied INSERT raises; a denied UPDATE or
// DELETE is a ZERO-ROW SUCCESS, so those re-read the row with the service client to prove nothing
// moved (plans/retros/foundation-c-services.md).

const WRITERS: readonly FixtureHandle[] = [
  "bishop",
  "counselor1",
  "musicCoordinator",
  "eqPresident",
  "wardBBishop",
];

describe("sunday_music RLS", () => {
  let fixtures: Fixtures;
  const clients = new Map<FixtureHandle, SupabaseClient>();
  const rows = { wardA: "", wardB: "" };
  const spare = { wardA: "", wardB: "" };

  async function seedSunday(wardId: string, date: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: wardId, date, type: "standard", speaking_slots: 3 })
      .select("id")
      .single();
    if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
    return data.id;
  }

  async function readRow(id: string) {
    const { data, error } = await fixtures.service
      .from("sunday_music")
      .select("id, status, chorister_name")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(WRITERS);
    for (const handle of WRITERS) {
      clients.set(handle, await asRole(fixtures, handle));
    }

    const sundayA = await seedSunday(fixtures.wardAId, "2027-12-05");
    const sundayB = await seedSunday(fixtures.wardBId, "2027-12-05");
    spare.wardA = await seedSunday(fixtures.wardAId, "2027-12-12");
    spare.wardB = await seedSunday(fixtures.wardBId, "2027-12-12");

    const { data, error } = await fixtures.service
      .from("sunday_music")
      .insert([
        { ward_id: fixtures.wardAId, sunday_id: sundayA, chorister_name: "Sister Ward A" },
        { ward_id: fixtures.wardBId, sunday_id: sundayB, chorister_name: "Sister Ward B" },
      ])
      .select("id, ward_id");
    if (error) throw new Error(`Could not seed sunday_music: ${error.message}`);

    rows.wardA = data.find((row) => row.ward_id === fixtures.wardAId)!.id;
    rows.wardB = data.find((row) => row.ward_id === fixtures.wardBId)!.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets a leader read their own ward's row", async () => {
    const { data, error } = await clients
      .get("musicCoordinator")!
      .from("sunday_music")
      .select("id, chorister_name")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: rows.wardA, chorister_name: "Sister Ward A" }]);
  });

  it("does not let ward A read ward B's row", async () => {
    const { data, error } = await clients
      .get("bishop")!
      .from("sunday_music")
      .select("id")
      .in("id", [rows.wardA, rows.wardB]);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([rows.wardA]);
  });

  it("lets ward B read its own and not ward A's", async () => {
    const { data, error } = await clients
      .get("wardBBishop")!
      .from("sunday_music")
      .select("id")
      .in("id", [rows.wardA, rows.wardB]);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([rows.wardB]);
  });

  describe.each(WRITERS)("as %s", (handle) => {
    // The row is VALID for the writer's own ward — its own Sunday, a status its CHECKs admit — so
    // the only thing that can refuse it is the policy, and 42501 proves that is what did.
    it("is refused an INSERT", async () => {
      const ownWard = handle === "wardBBishop" ? "wardB" : "wardA";
      const wardId = ownWard === "wardB" ? fixtures.wardBId : fixtures.wardAId;

      const { error } = await clients.get(handle)!.from("sunday_music").insert({
        ward_id: wardId,
        sunday_id: spare[ownWard],
        status: "approved",
        approved_at: new Date().toISOString(),
      });

      expect(error?.code).toBe("42501");

      const { data } = await fixtures.service
        .from("sunday_music")
        .select("id")
        .eq("sunday_id", spare[ownWard]);
      expect(data).toEqual([]);
    });

    it("is refused an UPDATE — a zero-row success that changes nothing", async () => {
      const target = handle === "wardBBishop" ? rows.wardB : rows.wardA;

      await clients
        .get(handle)!
        .from("sunday_music")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", target);

      expect(await readRow(target)).toMatchObject({ status: "draft" });
    });

    it("is refused a DELETE — a zero-row success that leaves the row", async () => {
      const target = handle === "wardBBishop" ? rows.wardB : rows.wardA;

      await clients.get(handle)!.from("sunday_music").delete().eq("id", target);

      expect(await readRow(target)).not.toBeNull();
    });
  });
});
