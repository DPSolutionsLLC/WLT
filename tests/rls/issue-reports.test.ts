// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// `issue_reports` (migration 076) is the one table in this app whose INSERT is open to ANY
// authenticated member of the ward, and that is the feature rather than an oversight: there is no
// `issues.*` permission and there must not be one, because `wards.settings.role_access` could
// take it away from the role most likely to hit a bug.
//
// So this suite asserts the two halves that matter:
//   * ANY ward member may insert — an Elders Quorum president, a music coordinator, anybody
//   * only the ward's ADMINS may read, and never across a ward boundary
//
// THE REFUSAL SHAPES DIFFER AND BOTH ARE ASSERTED: a denied INSERT raises, while a denied UPDATE
// or DELETE is a ZERO-ROW SUCCESS rather than an error — so those two re-read the row with the
// service client to prove nothing moved. Asserting only `error` there would pass against a policy
// that allows everything.

describe("issue_reports RLS", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let bishopA: SupabaseClient;
  let bishopB: SupabaseClient;
  let wardSecretaryA: SupabaseClient;
  let eqPresidentA: SupabaseClient;
  let musicCoordinatorA: SupabaseClient;

  const rows = { wardA: "", wardB: "" };
  const created: string[] = [];

  // Generated up front rather than read back, for the reason the RETURNING test below states.
  const eqPresidentReportId = crypto.randomUUID();
  const musicCoordinatorReportId = crypto.randomUUID();

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardBBishop",
      "wardSecretary",
      "eqPresident",
      "musicCoordinator",
    ]);

    service = createServiceSupabaseClient();
    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");
    wardSecretaryA = await asRole(fixtures, "wardSecretary");
    eqPresidentA = await asRole(fixtures, "eqPresident");
    musicCoordinatorA = await asRole(fixtures, "musicCoordinator");

    const { data, error } = await service
      .from("issue_reports")
      .insert([
        {
          ward_id: fixtures.wardAId,
          reported_by: fixtures.user("bishop").id,
          page_path: "/visits",
          role: "bishop",
          body: "The overdue count on the visits page looks wrong.",
        },
        {
          ward_id: fixtures.wardBId,
          reported_by: fixtures.user("wardBBishop").id,
          page_path: "/program",
          role: "bishop",
          body: "The programme PDF is missing the closing hymn.",
        },
      ])
      .select("id, ward_id");

    if (error) throw new Error(`Could not seed issue reports: ${error.message}`);

    rows.wardA = data.find((row) => row.ward_id === fixtures.wardAId)!.id;
    rows.wardB = data.find((row) => row.ward_id === fixtures.wardBId)!.id;
  });

  afterAll(async () => {
    // Deleted explicitly rather than left to the ward cascade, so a failed cleanup shows up here
    // rather than as a mysterious extra row in somebody else's suite. The hosted project is
    // shared (CLAUDE.md §9).
    await service
      .from("issue_reports")
      .delete()
      .in("id", [rows.wardA, rows.wardB, ...created]);
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // WRITING — the point of the feature
  // ---------------------------------------------------------------------------

  // THE INSERTS BELOW DELIBERATELY DO NOT `.select()`, AND THAT IS THE POINT OF THE NEXT TEST.
  // The row is confirmed with the SERVICE client instead, because the author cannot read it.
  it("lets any member of the ward file a report", async () => {
    const { error } = await eqPresidentA.from("issue_reports").insert({
      id: eqPresidentReportId,
      ward_id: fixtures.wardAId,
      reported_by: fixtures.user("eqPresident").id,
      page_path: "/youth",
      role: "org_president",
      body: "The support percentage is an em dash and I expected a number.",
    });

    expect(error).toBeNull();
    created.push(eqPresidentReportId);

    const { data } = await service
      .from("issue_reports")
      .select("id, page_path")
      .eq("id", eqPresidentReportId)
      .single();

    expect(data?.page_path).toBe("/youth");
  });

  // ⚠️ THE TRAP THIS TABLE SETS, PINNED. PostgreSQL applies the SELECT policy to a RETURNING
  // clause, so `.insert(...).select(...)` — the idiom every other writer in this codebase uses —
  // raises 42501 here for an author who may not READ what they just wrote. It surfaces as "new
  // row violates row-level security policy", which reads as the INSERT having been refused when
  // it was not. lib/issues/writeIssueReport.ts therefore generates the id and never reads back;
  // if somebody "tidies" it into the usual idiom, this test is what says why they must not.
  it("refuses to RETURN the row to the author who just wrote it", async () => {
    const { error } = await eqPresidentA
      .from("issue_reports")
      .insert({
        ward_id: fixtures.wardAId,
        reported_by: fixtures.user("eqPresident").id,
        page_path: "/youth",
        role: "org_president",
        body: "Written with a RETURNING clause on purpose.",
      })
      .select("id")
      .single();

    expect(error?.code).toBe("42501");
  });

  // The role most likely to be narrowed by a ward override, reporting anyway. There is no
  // `issues.*` permission for `role_access` to remove.
  it("lets a music coordinator file a report", async () => {
    const { error } = await musicCoordinatorA.from("issue_reports").insert({
      id: musicCoordinatorReportId,
      ward_id: fixtures.wardAId,
      reported_by: fixtures.user("musicCoordinator").id,
      page_path: "/music",
      role: "music_coordinator",
      body: "Choosing a hymn clears the one I picked for the week before.",
    });

    expect(error).toBeNull();
    created.push(musicCoordinatorReportId);
  });

  it("refuses a report filed into another ward", async () => {
    const { error } = await eqPresidentA.from("issue_reports").insert({
      ward_id: fixtures.wardBId,
      reported_by: fixtures.user("eqPresident").id,
      page_path: "/visits",
      role: "org_president",
      body: "Filed into the wrong ward on purpose.",
    });

    // A denied INSERT raises.
    expect(error).not.toBeNull();
  });

  it("refuses a report filed in somebody else's name", async () => {
    const { error } = await eqPresidentA.from("issue_reports").insert({
      ward_id: fixtures.wardAId,
      reported_by: fixtures.user("bishop").id,
      page_path: "/visits",
      role: "bishop",
      body: "Filed as the bishop on purpose.",
    });

    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // READING
  // ---------------------------------------------------------------------------

  it("lets the ward's bishop read its own reports", async () => {
    const { data, error } = await bishopA
      .from("issue_reports")
      .select("id, body")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].body).toMatch(/overdue count/);
  });

  it("lets the ward secretary read them too", async () => {
    const { data, error } = await wardSecretaryA
      .from("issue_reports")
      .select("id")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  // A report may name a colleague, a household or a member by accident — the reporter is typing
  // freely. So the read is the ward's ADMINS, not every leader who may write one.
  it("does not let an ordinary leader read the ward's reports", async () => {
    const { data, error } = await eqPresidentA
      .from("issue_reports")
      .select("id")
      .eq("id", rows.wardA);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let ward A's bishop read ward B's report", async () => {
    const { data, error } = await bishopA
      .from("issue_reports")
      .select("id")
      .eq("id", rows.wardB);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // The symmetry, asserted from the other side. Ward isolation checked in only one direction can
  // pass against a policy that happens to favour ward A.
  it("lets ward B read its own and not ward A's", async () => {
    const { data, error } = await bishopB
      .from("issue_reports")
      .select("id")
      .in("id", [rows.wardA, rows.wardB]);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([rows.wardB]);
  });

  // ---------------------------------------------------------------------------
  // A REPORT IS A RECORD OF WHAT SOMEBODY SAID
  // ---------------------------------------------------------------------------
  // No UPDATE and no DELETE policy exists, so RLS denies both by default. An editable bug report
  // is one somebody can quietly soften.

  it("does not let even the bishop edit a report", async () => {
    const { error } = await bishopA
      .from("issue_reports")
      .update({ body: "Actually it was fine." })
      .eq("id", rows.wardA);

    // A denied UPDATE is a zero-row SUCCESS, so the row is re-read to prove nothing moved.
    expect(error).toBeNull();

    const { data } = await service
      .from("issue_reports")
      .select("body")
      .eq("id", rows.wardA)
      .single();

    expect(data?.body).toMatch(/overdue count/);
  });

  it("does not let even the bishop delete a report", async () => {
    const { error } = await bishopA.from("issue_reports").delete().eq("id", rows.wardA);

    expect(error).toBeNull();

    const { data } = await service
      .from("issue_reports")
      .select("id")
      .eq("id", rows.wardA);

    expect(data).toHaveLength(1);
  });
});
