// @vitest-environment node
//
// `unit_ancestor_ids()` (migration 066a) — the walk that decides whether a ward sits under a
// stake somebody is assigned over, and therefore the walk that decides whether the switch is
// authorized at all.
//
// Exercised through the SERVICE client, because the question is about the FUNCTION rather than
// about who may see which unit. `tests/rls/unit-assignments.test.ts` covers the reads.
//
// THE CYCLE CASE IS THE REASON THIS FILE EXISTS. `units.parent_id` is a self-reference with no
// constraint preventing a cycle, and an unguarded recursive CTE inside a policy helper is an
// infinite loop inside EVERY QUERY ON THE SYSTEM — the database stops answering, not just this
// one call. A test that hangs is how that arrives here rather than in production.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

describe("unit_ancestor_ids", () => {
  let fixtures: Fixtures;
  let areaUnitId: string;
  let cycleAId: string;
  let cycleBId: string;
  let orphanWardId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);

    // A third level above the seeded stake, so the walk is proved over a genuine chain rather
    // than over one hop. An area officer would reach a ward through exactly this shape — which
    // is the generic model working without an area SCREEN existing.
    const { data: area, error: areaError } = await fixtures.service
      .from("units")
      .insert({ type: "area", name: `Ancestors area ${fixtures.runId}` })
      .select("id")
      .single();
    if (areaError) throw new Error(areaError.message);
    areaUnitId = area.id;

    const { error: reparentError } = await fixtures.service
      .from("units")
      .update({ parent_id: areaUnitId })
      .eq("id", fixtures.stakeUnitId);
    if (reparentError) throw new Error(reparentError.message);

    // Two units pointing at each other. Inserted with no parent and then joined up, because a
    // cycle cannot be created in one statement.
    const { data: pair, error: pairError } = await fixtures.service
      .from("units")
      .insert([
        { type: "stake", name: `Cycle A ${fixtures.runId}` },
        { type: "stake", name: `Cycle B ${fixtures.runId}` },
      ])
      .select("id, name");
    if (pairError) throw new Error(pairError.message);
    cycleAId = pair.find((row) => row.name.startsWith("Cycle A"))!.id;
    cycleBId = pair.find((row) => row.name.startsWith("Cycle B"))!.id;

    await fixtures.service.from("units").update({ parent_id: cycleBId }).eq("id", cycleAId);
    await fixtures.service.from("units").update({ parent_id: cycleAId }).eq("id", cycleBId);

    // A ward with NO unit — exactly what every ward looks like today, before proto-d's Stakes &
    // Wards screen places it.
    const { data: ward, error: wardError } = await fixtures.service
      .from("wards")
      .insert({ name: `${fixtures.runId} orphan ward`, settings: {} })
      .select("id")
      .single();
    if (wardError) throw new Error(wardError.message);
    orphanWardId = ward.id;
  });

  afterAll(async () => {
    // BREAK THE CYCLE FIRST. `units.parent_id` is `on delete restrict`, so neither half of a
    // mutual reference can be deleted while the other points at it.
    await fixtures.service.from("units").update({ parent_id: null }).eq("id", cycleAId);
    await fixtures.service.from("units").update({ parent_id: null }).eq("id", cycleBId);
    await fixtures.service.from("units").delete().in("id", [cycleAId, cycleBId]);

    // And detach the seeded stake from the area before deleting it, for the same reason.
    await fixtures.service
      .from("units")
      .update({ parent_id: null })
      .eq("id", fixtures.stakeUnitId);
    await fixtures.service.from("units").delete().eq("id", areaUnitId);

    await fixtures.service.from("wards").delete().eq("id", orphanWardId);

    await fixtures?.cleanup();
  });

  it("returns the unit and every ancestor of a three-level chain", async () => {
    const { data, error } = await fixtures.service.rpc("unit_ancestor_ids", {
      target_unit: fixtures.wardAUnitId,
    });

    expect(error).toBeNull();
    expect([...(data ?? [])].sort()).toEqual(
      [fixtures.wardAUnitId, fixtures.stakeUnitId, areaUnitId].sort(),
    );
  });

  it("returns just the unit itself when it has no parent", async () => {
    const { data, error } = await fixtures.service.rpc("unit_ancestor_ids", {
      target_unit: fixtures.outsideStakeUnitId,
    });

    expect(error).toBeNull();
    expect(data).toEqual([fixtures.outsideStakeUnitId]);
  });

  it("returns nothing for a unit that does not exist", async () => {
    const { data, error } = await fixtures.service.rpc("unit_ancestor_ids", {
      target_unit: "00000000-0000-4000-8000-0000000000ff",
    });

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  // THE GUARD. Without `depth < 10` this call never returns and the suite hangs rather than
  // failing — which is itself the symptom worth recognising if somebody ever removes it.
  it("terminates on a deliberately cyclic pair", async () => {
    const { data, error } = await fixtures.service.rpc("unit_ancestor_ids", {
      target_unit: cycleAId,
    });

    expect(error).toBeNull();
    expect(new Set(data ?? [])).toEqual(new Set([cycleAId, cycleBId]));
    // Eleven rows: the walk alternates between the two units until the depth guard stops it.
    // The exact number is not the point — that it is FINITE is.
    expect((data ?? []).length).toBeLessThanOrEqual(11);
  });

  // FAIL-CLOSED, BY CONSTRUCTION. A ward with no unit starts the walk from null, which returns
  // no rows, so no assignment can ever match it. That is why `wards.unit_id` could stay nullable
  // without opening anything.
  it("makes a ward with no unit unreachable by any assignment", async () => {
    const { data, error } = await fixtures.service.rpc("can_act_in_ward", {
      target_user: fixtures.user("bishop").id,
      target_ward: orphanWardId,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  // can_act_in_ward()'s first arm: your own ward is always yours, with no assignment needed.
  it("says a member may act in their own ward", async () => {
    const { data, error } = await fixtures.service.rpc("can_act_in_ward", {
      target_user: fixtures.user("bishop").id,
      target_ward: fixtures.wardAId,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("says an ordinary member may not act in another ward", async () => {
    const { data, error } = await fixtures.service.rpc("can_act_in_ward", {
      target_user: fixtures.user("bishop").id,
      target_ward: fixtures.wardBId,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});
