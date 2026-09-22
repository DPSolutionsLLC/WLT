// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// `access_requests` (migration 073) has a SELECT policy and NO WRITE POLICIES AT ALL.
//
// THE SINGLE MOST IMPORTANT CASE IN THIS SUITE is that A WARD ADMIN CANNOT APPROVE THEIR OWN
// REQUEST — the whole point of a request is that somebody else answers it, and if the asker could
// approve it the ward would simply be granting itself the permission with paperwork around it.
//
// It is asserted at the DATABASE, not at the route, deliberately. A route check can be forgotten
// by the next person who adds an endpoint; the absence of a write policy cannot (CLAUDE.md
// rule 2). Every test below goes through an authenticated client to prove what RLS itself allows.
//
// THE REFUSAL SHAPES DIFFER AND BOTH ARE ASSERTED:
//   * a denied INSERT raises
//   * a denied UPDATE or DELETE is a ZERO-ROW SUCCESS, not an error
// so the update and delete cases re-read the row with the service client to prove nothing moved.
// Asserting only `error` on those two would pass against a policy that allows everything.

describe("access_requests RLS", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let bishopA: SupabaseClient;
  let bishopB: SupabaseClient;
  let superAdmin: SupabaseClient;
  let eqPresidentA: SupabaseClient;

  const rows = { wardA: "", wardB: "" };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardBBishop",
      "superAdmin",
      "eqPresident",
    ]);

    service = createServiceSupabaseClient();
    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");
    superAdmin = await asRole(fixtures, "superAdmin");
    eqPresidentA = await asRole(fixtures, "eqPresident");

    // Seeded with the service client, because there is no authenticated write path — which is
    // itself the thing under test below.
    const { data, error } = await service
      .from("access_requests")
      .insert([
        {
          ward_id: fixtures.wardAId,
          requested_by: fixtures.user("bishop").id,
          role: "org_president",
          module: "agendas",
          level: "F",
          reason: "Our organization presidents build the ward council agenda.",
        },
        {
          ward_id: fixtures.wardBId,
          requested_by: fixtures.user("wardBBishop").id,
          role: "org_secretary",
          module: "visits",
          level: "F",
          reason: "Our secretaries maintain the visit goals in practice.",
        },
      ])
      .select("id, ward_id");

    if (error) throw new Error(`Could not seed access requests: ${error.message}`);

    rows.wardA = data.find((row) => row.ward_id === fixtures.wardAId)!.id;
    rows.wardB = data.find((row) => row.ward_id === fixtures.wardBId)!.id;
  });

  afterAll(async () => {
    // Deleted explicitly rather than left to the ward cascade, so a failed cleanup shows up here
    // rather than as a mysterious extra row in somebody else's suite. The hosted project is
    // shared (CLAUDE.md §9).
    await service.from("access_requests").delete().in("id", [rows.wardA, rows.wardB]);
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // READING
  // ---------------------------------------------------------------------------

  it("lets a ward read its own request", async () => {
    const { data, error } = await bishopA
      .from("access_requests")
      .select("id, reason")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    // THE REQUESTER MUST BE ABLE TO READ THE OUTCOME, which starts with being able to read the
    // request at all. The prototype shipped this flow without outcome visibility and caught the
    // gap itself.
    expect(data?.[0].reason).toMatch(/ward council agenda/);
  });

  it("does not let a ward read another ward's request", async () => {
    const { data, error } = await bishopA
      .from("access_requests")
      .select("id")
      .eq("id", rows.wardB);

    // A read denied by policy is an empty result, never an error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // THE READ IS THE WHOLE WARD'S, not just the requester's own rows. Bishopric admin authority is
  // shared (CLAUDE.md §7), and scoping on `requested_by` would be the `talks-d` hole besides — a
  // nullable author column in a policy predicate.
  it("lets another leader in the same ward read what the bishop asked for", async () => {
    const { data, error } = await eqPresidentA
      .from("access_requests")
      .select("id")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  // THE SYMMETRY, asserted from the other side. Ward isolation that is only ever checked in one
  // direction can pass against a policy that happens to favour ward A.
  it("lets ward B read its own and not ward A's", async () => {
    const { data, error } = await bishopB
      .from("access_requests")
      .select("id")
      .in("id", [rows.wardA, rows.wardB]);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([rows.wardB]);
  });

  it("lets a super admin read every ward's requests", async () => {
    const { data, error } = await superAdmin
      .from("access_requests")
      .select("id")
      .in("id", [rows.wardA, rows.wardB]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // WRITING — THERE IS NO AUTHENTICATED WRITE PATH
  // ---------------------------------------------------------------------------

  // ⚠️ THE CASE THIS SUITE EXISTS FOR.
  it("does not let a ward admin approve their own request", async () => {
    const { error } = await bishopA
      .from("access_requests")
      .update({
        status: "approved_ward",
        decided_by: fixtures.user("bishop").id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", rows.wardA);

    // A denied UPDATE is a zero-row SUCCESS. The error being null proves nothing on its own,
    // which is exactly why the row is re-read below.
    expect(error).toBeNull();

    const { data } = await service
      .from("access_requests")
      .select("status, decided_by, decided_at")
      .eq("id", rows.wardA)
      .single();

    expect(data?.status).toBe("pending");
    expect(data?.decided_by).toBeNull();
    expect(data?.decided_at).toBeNull();
  });

  // A SUPER ADMIN CANNOT WRITE THROUGH THEIR OWN CLIENT EITHER, and that is not an oversight.
  // Deciding runs through the service-role client behind the route's own guard, exactly as
  // `units`, `unit_assignments` and `ward_role_assignments` do. A write policy nobody exercises
  // is the most dangerous thing in this phase (migration 065f's own reasoning).
  it("does not let even a super admin write through their own client", async () => {
    const { error } = await superAdmin
      .from("access_requests")
      .update({ status: "denied", decided_at: new Date().toISOString() })
      .eq("id", rows.wardA);

    expect(error).toBeNull();

    const { data } = await service
      .from("access_requests")
      .select("status")
      .eq("id", rows.wardA)
      .single();

    expect(data?.status).toBe("pending");
  });

  it("refuses an authenticated insert", async () => {
    const { error } = await bishopA.from("access_requests").insert({
      ward_id: fixtures.wardAId,
      requested_by: fixtures.user("bishop").id,
      role: "org_president",
      module: "knowledge",
      level: "F",
      reason: "Filed straight at the table, with no route in front of it.",
    });

    // An INSERT denied by policy RAISES, unlike an update or a delete.
    expect(error).not.toBeNull();
  });

  it("refuses an authenticated delete", async () => {
    const { error } = await bishopA
      .from("access_requests")
      .delete()
      .eq("id", rows.wardA);

    expect(error).toBeNull();

    const { count } = await service
      .from("access_requests")
      .select("id", { head: true, count: "exact" })
      .eq("id", rows.wardA);

    expect(count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // THE DECISION CONSTRAINT
  // ---------------------------------------------------------------------------

  // A decision has a decider and a time, or it is not a decision (migration 073a). A constraint
  // and not a comment, for migration 061's reason: nobody can act on a state the schema should
  // have refused in the first place.
  it("refuses a decided row with no decided_at, even from the service client", async () => {
    const { error } = await service
      .from("access_requests")
      .update({ status: "approved_ward", decided_by: fixtures.user("superAdmin").id })
      .eq("id", rows.wardA);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/access_requests_decision_complete/);
  });

  it("refuses a pending row that names a decider", async () => {
    const { error } = await service.from("access_requests").insert({
      ward_id: fixtures.wardAId,
      requested_by: fixtures.user("bishop").id,
      role: "org_president",
      module: "sacrament_talks",
      level: "F",
      reason: "Pending, and somehow already decided by somebody.",
      decided_by: fixtures.user("superAdmin").id,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/access_requests_decision_complete/);
  });
});
