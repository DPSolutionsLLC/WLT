// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// THE ZOOM JOIN-LINK POOL AT THE TABLE (ITER-053, migration 095).
//
// The bishopric, the ward clerk and the executive secretary read the pool's placeholder names; NOBODY
// through their own client reads a `join_url` — the bishop included — because the column grant leaves
// it out. No client writes either table, and the two functions run only as the service role.
//
// Each refusal is paired with a control that passes every earlier check, so it is refused for the
// reason under test.

type Client = SupabaseClient<Database>;

const VIEWERS: FixtureHandle[] = [
  "bishop",
  "counselor1",
  "counselor2",
  "wardSecretary",
  "executiveSecretary",
];

const urlFor = (label: string) => `https://example.org/j/${label}`;

describe("zoom_join_links RLS and functions", () => {
  let fixtures: Fixtures;
  let service: Client;
  const clients: Partial<Record<FixtureHandle, Client>> = {};

  async function seedLink(wardId: string, label: string): Promise<string> {
    const { data, error } = await service
      .from("zoom_join_links")
      .insert({
        ward_id: wardId,
        placeholder_name: `Guest ${label}`,
        placeholder_email: `sacrament+${label}@example.org`,
        join_url: urlFor(label),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function seedInvitee(wardId: string, name: string): Promise<string> {
    const { data, error } = await service
      .from("zoom_invitees")
      .insert({ ward_id: wardId, display_name: name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function clearWard(wardId: string): Promise<void> {
    await service.from("zoom_invitees").delete().eq("ward_id", wardId);
    await service.from("zoom_join_links").delete().eq("ward_id", wardId);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([...VIEWERS, "eqPresident", "wardBBishop"]);
    service = fixtures.service;
    for (const handle of [...VIEWERS, "eqPresident", "wardBBishop"] as FixtureHandle[]) {
      clients[handle] = await asRole(fixtures, handle);
    }
    await seedLink(fixtures.wardAId, "a01");
  });

  afterAll(async () => {
    await service?.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  it.each(VIEWERS)("lets %s read ward A's pool by its granted columns", async (handle) => {
    const { data, error } = await (clients[handle] as Client)
      .from("zoom_join_links")
      .select("id, placeholder_name, placeholder_email")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data?.map((row) => row.placeholder_name)).toContain("Guest a01");
  });

  it.each(VIEWERS)("refuses %s the join_url column (42501)", async (handle) => {
    const { data, error } = await (clients[handle] as Client)
      .from("zoom_join_links")
      .select("id, join_url")
      .eq("ward_id", fixtures.wardAId);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("refuses select('*') for the bishop, for the same reason", async () => {
    const { error } = await (clients.bishop as Client).from("zoom_join_links").select("*");
    expect(error?.code).toBe("42501");
  });

  it("shows an org president nothing", async () => {
    const { data, error } = await (clients.eqPresident as Client)
      .from("zoom_join_links")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows a ward B bishop nothing from ward A", async () => {
    const { data, error } = await (clients.wardBBishop as Client)
      .from("zoom_join_links")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides the pool when the ward has not released Zoom", async () => {
    const { error } = await service
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardAId, released_modules: ["tithing"] });
    if (error) throw new Error(error.message);
    try {
      const { data } = await (clients.bishop as Client)
        .from("zoom_join_links")
        .select("id")
        .eq("ward_id", fixtures.wardAId);
      expect(data).toEqual([]);
    } finally {
      await service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    }
  });

  it("refuses an INSERT from the bishop", async () => {
    const { error } = await (clients.bishop as Client).from("zoom_join_links").insert({
      ward_id: fixtures.wardAId,
      placeholder_name: "Guest hijack",
      placeholder_email: "hijack@example.org",
      join_url: urlFor("hijack"),
    });
    expect(error?.code).toBe("42501");
  });

  it("makes an UPDATE and a DELETE from the bishop a zero-row no-op", async () => {
    await (clients.bishop as Client)
      .from("zoom_join_links")
      .update({ placeholder_name: "Renamed" })
      .eq("ward_id", fixtures.wardAId);
    await (clients.bishop as Client).from("zoom_join_links").delete().eq("ward_id", fixtures.wardAId);

    const { data } = await service
      .from("zoom_join_links")
      .select("placeholder_name")
      .eq("ward_id", fixtures.wardAId)
      .eq("placeholder_email", "sacrament+a01@example.org")
      .single();
    expect(data?.placeholder_name).toBe("Guest a01");
  });

  it("refuses both functions to an authenticated client", async () => {
    const inviteeId = await seedInvitee(fixtures.wardAId, "Function probe");
    const assign = await (clients.bishop as Client).rpc("assign_next_zoom_link", {
      p_ward_id: fixtures.wardAId,
      p_invitee_id: inviteeId,
    });
    expect(assign.error?.code).toBe("42501");

    const { data: link } = await service
      .from("zoom_join_links")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .limit(1)
      .single();
    const remove = await (clients.bishop as Client).rpc("remove_unassigned_zoom_link", {
      p_ward_id: fixtures.wardAId,
      p_link_id: link?.id as string,
    });
    expect(remove.error?.code).toBe("42501");

    const { data: invitee } = await service
      .from("zoom_invitees")
      .select("join_link_id")
      .eq("id", inviteeId)
      .single();
    expect(invitee?.join_link_id).toBeNull();
    await service.from("zoom_invitees").delete().eq("id", inviteeId);
  });

  describe("assign_next_zoom_link", () => {
    it("gives one free link to exactly one of two invitees", async () => {
      await clearWard(fixtures.wardAId);
      const onlyLink = await seedLink(fixtures.wardAId, "solo");
      const first = await seedInvitee(fixtures.wardAId, "First");
      const second = await seedInvitee(fixtures.wardAId, "Second");

      const [a, b] = await Promise.all([
        service.rpc("assign_next_zoom_link", { p_ward_id: fixtures.wardAId, p_invitee_id: first }),
        service.rpc("assign_next_zoom_link", { p_ward_id: fixtures.wardAId, p_invitee_id: second }),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      expect([a.data, b.data].filter((value) => value !== null)).toEqual([onlyLink]);
    });

    it("does not take a second link for an invitee who already holds one", async () => {
      await clearWard(fixtures.wardAId);
      await seedLink(fixtures.wardAId, "one");
      await seedLink(fixtures.wardAId, "two");
      const invitee = await seedInvitee(fixtures.wardAId, "Holder");

      const firstCall = await service.rpc("assign_next_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_invitee_id: invitee,
      });
      expect(firstCall.data).not.toBeNull();
      const secondCall = await service.rpc("assign_next_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_invitee_id: invitee,
      });
      expect(secondCall.error).toBeNull();
      expect(secondCall.data).toBeNull();

      const { count } = await service
        .from("zoom_invitees")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId)
        .not("join_link_id", "is", null);
      expect(count).toBe(1);
    });

    it("gives the oldest free link first", async () => {
      await clearWard(fixtures.wardAId);
      const older = await seedLink(fixtures.wardAId, "older");
      await seedLink(fixtures.wardAId, "newer");
      const invitee = await seedInvitee(fixtures.wardAId, "Next in line");
      const { data } = await service.rpc("assign_next_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_invitee_id: invitee,
      });
      expect(data).toBe(older);
    });

    it("never gives a ward A link to a ward B invitee", async () => {
      await clearWard(fixtures.wardAId);
      await seedLink(fixtures.wardAId, "wardonly");
      const wardBInvitee = await seedInvitee(fixtures.wardBId, "Ward B person");

      const { data, error } = await service.rpc("assign_next_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_invitee_id: wardBInvitee,
      });
      expect(error).toBeNull();
      expect(data).toBeNull();

      const { data: row } = await service
        .from("zoom_invitees")
        .select("join_link_id")
        .eq("id", wardBInvitee)
        .single();
      expect(row?.join_link_id).toBeNull();
      await clearWard(fixtures.wardBId);
    });
  });

  describe("remove_unassigned_zoom_link", () => {
    it("removes a free link and refuses a given one", async () => {
      await clearWard(fixtures.wardAId);
      const free = await seedLink(fixtures.wardAId, "free");
      const given = await seedLink(fixtures.wardAId, "given");
      const holder = await seedInvitee(fixtures.wardAId, "Holder");
      const { error: giveError } = await service
        .from("zoom_invitees")
        .update({ join_link_id: given, link_given_at: new Date().toISOString() })
        .eq("id", holder);
      if (giveError) throw new Error(giveError.message);

      const removedFree = await service.rpc("remove_unassigned_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_link_id: free,
      });
      expect(removedFree.data).toBe(true);

      const removedGiven = await service.rpc("remove_unassigned_zoom_link", {
        p_ward_id: fixtures.wardAId,
        p_link_id: given,
      });
      expect(removedGiven.error).toBeNull();
      expect(removedGiven.data).toBe(false);

      const { data: remaining } = await service
        .from("zoom_join_links")
        .select("id")
        .eq("ward_id", fixtures.wardAId);
      expect(remaining?.map((row) => row.id)).toEqual([given]);
    });
  });
});
