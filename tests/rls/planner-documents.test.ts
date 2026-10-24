// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// THE SACRAMENT PLANNER'S STORE AT THE TABLE (ITER-045, migration 093).
//
// Bishopric only, ward-scoped, and the writer is always the person writing. planner_history has
// no write policy at all — the import script is the only writer. Every refused UPDATE or DELETE is
// asserted by RE-READING with the service client, because RLS answers those with a zero-row
// success rather than an error.

type Client = SupabaseClient<Database>;

describe("planner_documents and planner_history RLS", () => {
  let fixtures: Fixtures;
  let service: Client;
  let bishop: Client;
  let counselor: Client;
  let music: Client;
  let wardBBishop: Client;
  let superAdmin: Client;

  const docId = (suffix: string) => `rls-${fixtures.runId}-${suffix}`;

  function insertAs(client: Client, wardId: string, userId: string, suffix: string) {
    return client.from("planner_documents").insert({
      ward_id: wardId,
      layer: "real",
      collection: "marks",
      document_id: docId(suffix),
      data: { name: "Doe, Jane", by: "Tester" },
      updated_by: userId,
    });
  }

  async function serviceRead(wardId: string, suffix: string) {
    const { data, error } = await service
      .from("planner_documents")
      .select("data, updated_by")
      .eq("ward_id", wardId)
      .eq("document_id", docId(suffix))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function seedDocument(wardId: string, suffix: string) {
    const { error } = await service.from("planner_documents").insert({
      ward_id: wardId,
      layer: "real",
      collection: "marks",
      document_id: docId(suffix),
      data: { name: "Seeded", by: "Service" },
    });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "musicCoordinator",
      "wardBBishop",
      "superAdmin",
    ]);
    service = fixtures.service;

    await seedDocument(fixtures.wardAId, "a-seeded");
    await seedDocument(fixtures.wardBId, "b-seeded");

    const { error } = await service.from("planner_history").insert({
      ward_id: fixtures.wardAId,
      agenda_rows: [["r1", "2026-01-04", "Regular", "Speaker", "Jane Doe"]],
      meetings: {},
      conducting: {},
    });
    if (error) throw new Error(error.message);

    bishop = await asRole(fixtures, "bishop");
    counselor = await asRole(fixtures, "counselor1");
    music = await asRole(fixtures, "musicCoordinator");
    wardBBishop = await asRole(fixtures, "wardBBishop");
    superAdmin = await asRole(fixtures, "superAdmin");
  });

  afterAll(async () => {
    await service?.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  it("lets the bishop and a counselor read their own ward's documents", async () => {
    for (const client of [bishop, counselor]) {
      const { data, error } = await client
        .from("planner_documents")
        .select("document_id")
        .eq("document_id", docId("a-seeded"));
      expect(error).toBeNull();
      expect(data).toEqual([{ document_id: docId("a-seeded") }]);
    }
  });

  it("lets the bishop and a counselor write as themselves", async () => {
    expect((await insertAs(bishop, fixtures.wardAId, fixtures.user("bishop").id, "bishop")).error)
      .toBeNull();
    expect(
      (await insertAs(counselor, fixtures.wardAId, fixtures.user("counselor1").id, "counselor"))
        .error,
    ).toBeNull();
    expect((await serviceRead(fixtures.wardAId, "counselor"))?.updated_by).toBe(
      fixtures.user("counselor1").id,
    );
  });

  it("refuses a write that names somebody else as the writer", async () => {
    const { error } = await insertAs(
      bishop,
      fixtures.wardAId,
      fixtures.user("counselor1").id,
      "impersonated",
    );
    expect(error?.code).toBe("42501");
    expect(await serviceRead(fixtures.wardAId, "impersonated")).toBeNull();
  });

  it("refuses an update that hands authorship to somebody else", async () => {
    await bishop
      .from("planner_documents")
      .update({ data: { name: "Changed", by: "X" }, updated_by: fixtures.user("counselor1").id })
      .eq("document_id", docId("bishop"));
    expect((await serviceRead(fixtures.wardAId, "bishop"))?.updated_by).toBe(
      fixtures.user("bishop").id,
    );
  });

  it("shows ward B nothing of ward A, and refuses ward B writing into ward A", async () => {
    const { data } = await wardBBishop
      .from("planner_documents")
      .select("document_id")
      .eq("document_id", docId("a-seeded"));
    expect(data).toEqual([]);

    const { error } = await insertAs(
      wardBBishop,
      fixtures.wardAId,
      fixtures.user("wardBBishop").id,
      "from-b",
    );
    expect(error?.code).toBe("42501");

    await wardBBishop.from("planner_documents").delete().eq("document_id", docId("a-seeded"));
    expect(await serviceRead(fixtures.wardAId, "a-seeded")).not.toBeNull();
  });

  it("gives the music coordinator nothing: no reads, no writes, no deletes", async () => {
    const { data } = await music.from("planner_documents").select("document_id");
    expect(data).toEqual([]);

    const { error } = await insertAs(
      music,
      fixtures.wardAId,
      fixtures.user("musicCoordinator").id,
      "music",
    );
    expect(error?.code).toBe("42501");

    await music.from("planner_documents").delete().eq("document_id", docId("a-seeded"));
    expect(await serviceRead(fixtures.wardAId, "a-seeded")).not.toBeNull();
  });

  it("refuses a super admin whose calling here is not bishopric", async () => {
    const { data } = await superAdmin.from("planner_documents").select("document_id");
    expect(data).toEqual([]);
    const { error } = await insertAs(
      superAdmin,
      fixtures.wardAId,
      fixtures.user("superAdmin").id,
      "super",
    );
    expect(error?.code).toBe("42501");
  });

  it("lets the bishopric read the history and nobody write it, the bishop included", async () => {
    const { data } = await bishop.from("planner_history").select("ward_id");
    expect(data).toEqual([{ ward_id: fixtures.wardAId }]);

    const { data: musicView } = await music.from("planner_history").select("ward_id");
    expect(musicView).toEqual([]);

    const { error: insertError } = await wardBBishop.from("planner_history").insert({
      ward_id: fixtures.wardBId,
      agenda_rows: [],
      meetings: {},
      conducting: {},
    });
    expect(insertError?.code).toBe("42501");

    await bishop
      .from("planner_history")
      .update({ agenda_rows: [] })
      .eq("ward_id", fixtures.wardAId);
    await bishop.from("planner_history").delete().eq("ward_id", fixtures.wardAId);

    const { data: after } = await service
      .from("planner_history")
      .select("agenda_rows")
      .eq("ward_id", fixtures.wardAId)
      .single();
    expect(after?.agenda_rows).toHaveLength(1);
  });

  // Last, because it narrows ward A. The same reads succeeded above, so the empty answer here is
  // the release list and nothing earlier.
  it("hides both tables in a ward that has not released Sacrament", async () => {
    const { error } = await service
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardAId, released_modules: ["tithing"] });
    if (error) throw new Error(error.message);

    const { data: documents } = await bishop
      .from("planner_documents")
      .select("document_id")
      .eq("document_id", docId("a-seeded"));
    expect(documents).toEqual([]);

    const { data: history } = await bishop.from("planner_history").select("ward_id");
    expect(history).toEqual([]);

    const { error: writeError } = await insertAs(
      bishop,
      fixtures.wardAId,
      fixtures.user("bishop").id,
      "unreleased",
    );
    expect(writeError?.code).toBe("42501");
  });
});
