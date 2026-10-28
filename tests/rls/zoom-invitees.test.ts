// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// THE ZOOM INVITEE LIST AT THE TABLE (ITER-053, migration 095).
//
// The bishopric, the ward clerk and the executive secretary read ward A's invitees — names and phone
// numbers of people who are often not members, so the reader set is deliberately narrow. Nobody
// else reads them, no ward reads another's, and no signed-in client writes the table at all: every
// write is the service role behind canManageInvitees(). Refused writes are asserted by RE-READING.

type Client = SupabaseClient<Database>;

const VIEWERS: FixtureHandle[] = [
  "bishop",
  "counselor1",
  "counselor2",
  "wardSecretary",
  "executiveSecretary",
];

describe("zoom_invitees RLS", () => {
  let fixtures: Fixtures;
  let service: Client;
  let inviteeId: string;
  const clients: Partial<Record<FixtureHandle, Client>> = {};

  beforeAll(async () => {
    fixtures = await seedFixtures([...VIEWERS, "eqPresident", "wardBBishop"]);
    service = fixtures.service;
    for (const handle of [...VIEWERS, "eqPresident", "wardBBishop"] as FixtureHandle[]) {
      clients[handle] = await asRole(fixtures, handle);
    }
    const { data, error } = await service
      .from("zoom_invitees")
      .insert({ ward_id: fixtures.wardAId, display_name: "Ward A Visitor", phone: "555-123-4567" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    inviteeId = data.id;
  });

  afterAll(async () => {
    await service?.from("zoom_invitees").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  async function storedRow() {
    const { data, error } = await service
      .from("zoom_invitees")
      .select("display_name, phone")
      .eq("id", inviteeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  it.each(VIEWERS)("lets %s read ward A's invitees", async (handle) => {
    const { data, error } = await (clients[handle] as Client)
      .from("zoom_invitees")
      .select("id, display_name, phone")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data?.map((row) => row.display_name)).toEqual(["Ward A Visitor"]);
  });

  it("shows an org president nothing", async () => {
    const { data, error } = await (clients.eqPresident as Client)
      .from("zoom_invitees")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows a ward B bishop nothing from ward A", async () => {
    const { data, error } = await (clients.wardBBishop as Client)
      .from("zoom_invitees")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses every signed-in INSERT, the bishop's included", async () => {
    const { error } = await (clients.bishop as Client)
      .from("zoom_invitees")
      .insert({ ward_id: fixtures.wardAId, display_name: "Inserted by a client" });
    expect(error?.code).toBe("42501");

    const { count } = await service
      .from("zoom_invitees")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    expect(count).toBe(1);
  });

  it.each(["bishop", "wardSecretary"] as FixtureHandle[])(
    "leaves the row unchanged when %s tries to UPDATE it",
    async (handle) => {
      await (clients[handle] as Client)
        .from("zoom_invitees")
        .update({ phone: "555-000-0000" })
        .eq("id", inviteeId);
      expect(await storedRow()).toEqual({ display_name: "Ward A Visitor", phone: "555-123-4567" });
    },
  );

  it("leaves the row in place when the bishop tries to DELETE it", async () => {
    await (clients.bishop as Client).from("zoom_invitees").delete().eq("id", inviteeId);
    expect(await storedRow()).not.toBeNull();
  });
});
