// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// RELEASED MODULES AT THE TABLE (ITER-041, migration 091). The database refuses a module's OWN
// tables in a ward that has not released it, for everybody but the super admin — and nobody but
// the service role writes the list.
//
// Ward A carries the list `[tithing]`; ward B has none, which means everything. Every refusal
// below is paired with a control that passes every earlier check, so it is refused for the reason
// under test (the negative-path rule): the same agenda insert succeeds in ward B, and the bishop
// reads the agenda once the list is lifted.

const TODAY = new Date().toISOString().slice(0, 10);

describe("released modules RLS", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient<Database>;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;
  let superAdmin: SupabaseClient<Database>;
  let agendaAId: string;
  let tithingAId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "superAdmin", "wardBBishop"]);
    service = fixtures.service;

    const { data: agenda, error: agendaError } = await service
      .from("agendas")
      .insert({ ward_id: fixtures.wardAId, meeting_date: TODAY })
      .select("id")
      .single();
    if (agendaError) throw new Error(agendaError.message);
    agendaAId = agenda.id;

    const { data: tithing, error: tithingError } = await service
      .from("tithing_sessions")
      .insert({ ward_id: fixtures.wardAId, session_date: TODAY })
      .select("id")
      .single();
    if (tithingError) throw new Error(tithingError.message);
    tithingAId = tithing.id;

    const { error: listError } = await service
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardAId, released_modules: ["tithing"] });
    if (listError) throw new Error(listError.message);

    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");
    superAdmin = await asRole(fixtures, "superAdmin");
  });

  afterAll(async () => {
    // The row cascades from ward A anyway; removing it first means a failed cleanup never leaves a
    // narrowed ward behind on the shared project.
    await service?.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  it("hides an unreleased module's rows from the bishop", async () => {
    const { data, error } = await bishopA.from("agendas").select("id").eq("id", agendaAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses the bishop inserting into an unreleased module's table", async () => {
    const { error } = await bishopA
      .from("agendas")
      .insert({ ward_id: fixtures.wardAId, meeting_date: TODAY });
    expect(error?.code).toBe("42501");
  });

  it("lets the same insert through in a ward with no list (the control)", async () => {
    const { data, error } = await bishopB
      .from("agendas")
      .insert({ ward_id: fixtures.wardBId, meeting_date: TODAY })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("still serves a released module's rows", async () => {
    const { data } = await bishopA.from("tithing_sessions").select("id").eq("id", tithingAId);
    expect(data).toEqual([{ id: tithingAId }]);
  });

  it("serves everything to the super admin acting in the narrowed ward", async () => {
    const { data } = await superAdmin.from("agendas").select("id").eq("id", agendaAId);
    expect(data).toEqual([{ id: agendaAId }]);
  });

  it("refuses the bishop writing the list itself, in every verb", async () => {
    const { error: insertError } = await bishopB
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardBId, released_modules: [] });
    expect(insertError?.code).toBe("42501");

    // An RLS-refused UPDATE or DELETE is a zero-row success, so the row is re-read.
    await bishopA
      .from("ward_release_settings")
      .update({ released_modules: ["tithing", "agendas"] })
      .eq("ward_id", fixtures.wardAId);
    await bishopA.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);

    const { data } = await service
      .from("ward_release_settings")
      .select("released_modules")
      .eq("ward_id", fixtures.wardAId)
      .single();
    expect(data?.released_modules).toEqual(["tithing"]);
  });

  it("lets the bishop read their own ward's list, and not another's", async () => {
    const { data: own } = await bishopA.from("ward_release_settings").select("ward_id");
    expect(own).toEqual([{ ward_id: fixtures.wardAId }]);

    const { data: other } = await bishopB
      .from("ward_release_settings")
      .select("ward_id")
      .eq("ward_id", fixtures.wardAId);
    expect(other).toEqual([]);
  });

  it("carries the list and the super-admin flag in session_context()", async () => {
    const { data: bishopContext } = await bishopA.rpc("session_context").single();
    expect(bishopContext?.released_modules).toEqual(["tithing"]);
    expect(bishopContext?.is_super_admin).toBe(false);

    const { data: adminContext } = await superAdmin.rpc("session_context").single();
    expect(adminContext?.released_modules).toEqual(["tithing"]);
    expect(adminContext?.is_super_admin).toBe(true);

    const { data: wardBContext } = await bishopB.rpc("session_context").single();
    expect(wardBContext?.released_modules).toBeNull();
    expect(wardBContext?.is_super_admin).toBe(false);
  });

  // Last, because it lifts the list: the hidden agenda was there all along.
  it("serves the agenda again once the list is lifted", async () => {
    await service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    const { data } = await bishopA.from("agendas").select("id").eq("id", agendaAId);
    expect(data).toEqual([{ id: agendaAId }]);
  });
});
