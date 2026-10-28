// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";
import type { RemoteLinkPosition } from "@/types/domain";

// STREAM REMOTE LINKS AT THE TABLE (ITER-051, migration 094). Only the holder reads a link — the
// bishop included gets nothing for another position — and no client writes the table at all.
//
// Each refusal is paired with a control that passes every earlier check, so it is refused for the
// reason under test: the holder reads their own row before a change, and not after it.

type Client = SupabaseClient<Database>;

const HOLDERS: Record<RemoteLinkPosition, FixtureHandle> = {
  bishop: "bishop",
  counselor_1: "counselor1",
  counselor_2: "counselor2",
  ward_clerk: "wardSecretary",
  executive_secretary: "executiveSecretary",
};

const urlFor = (position: string) => `https://example.org/remote?position=${position}`;

describe("zoom_remote_links RLS", () => {
  let fixtures: Fixtures;
  let service: Client;
  const clients: Partial<Record<FixtureHandle, Client>> = {};
  const callingIds: Partial<Record<FixtureHandle, string>> = {};

  async function callingIdOf(handle: FixtureHandle): Promise<string> {
    const { data, error } = await service
      .from("ward_role_assignments")
      .select("id")
      .eq("user_id", fixtures.user(handle).id)
      .eq("ward_id", fixtures.user(handle).wardId)
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function seedLink(position: RemoteLinkPosition): Promise<void> {
    const handle = HOLDERS[position];
    const { error } = await service.from("zoom_remote_links").upsert(
      {
        ward_id: fixtures.wardAId,
        position,
        url: urlFor(position),
        holder_calling_id: callingIds[handle] as string,
        set_by: fixtures.user("bishop").id,
        deactivated_at: null,
        deactivated_reason: null,
        deactivated_by: null,
      },
      { onConflict: "ward_id,position" },
    );
    if (error) throw new Error(error.message);
  }

  async function readAs(handle: FixtureHandle, position: RemoteLinkPosition) {
    const { data, error } = await (clients[handle] as Client)
      .from("zoom_remote_links")
      .select("position, url")
      .eq("position", position);
    expect(error).toBeNull();
    return data ?? [];
  }

  async function setCalling(
    handle: FixtureHandle,
    values: { counselor_position?: number | null; is_active?: boolean },
  ) {
    const { error } = await service
      .from("ward_role_assignments")
      .update(values)
      .eq("id", callingIds[handle] as string);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "wardSecretary",
      "executiveSecretary",
      "wardBBishop",
    ]);
    service = fixtures.service;

    for (const handle of Object.values(HOLDERS)) {
      callingIds[handle] = await callingIdOf(handle);
    }
    for (const handle of [...Object.values(HOLDERS), "wardBBishop"] as FixtureHandle[]) {
      clients[handle] = await asRole(fixtures, handle);
    }
    for (const position of Object.keys(HOLDERS) as RemoteLinkPosition[]) {
      await seedLink(position);
    }
  });

  afterAll(async () => {
    await service?.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  it("lets the bishop read the bishop's link, url included", async () => {
    expect(await readAs("bishop", "bishop")).toEqual([
      { position: "bishop", url: urlFor("bishop") },
    ]);
  });

  it("does not let the bishop read the 1st counselor's link (no bishopric arm, D3)", async () => {
    expect(await readAs("bishop", "counselor_1")).toEqual([]);
  });

  it("lets the ward clerk read the ward clerk's link and not the bishop's", async () => {
    expect(await readAs("wardSecretary", "ward_clerk")).toHaveLength(1);
    expect(await readAs("wardSecretary", "bishop")).toEqual([]);
  });

  it("shows each counselor only their own row", async () => {
    const { data: first } = await (clients.counselor1 as Client)
      .from("zoom_remote_links")
      .select("position");
    const { data: second } = await (clients.counselor2 as Client)
      .from("zoom_remote_links")
      .select("position");
    expect(first).toEqual([{ position: "counselor_1" }]);
    expect(second).toEqual([{ position: "counselor_2" }]);
  });

  it("shows a ward B bishop nothing from ward A", async () => {
    const { data, error } = await (clients.wardBBishop as Client)
      .from("zoom_remote_links")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides a counselor's link once their position number changes, with no stamp written", async () => {
    expect(await readAs("counselor1", "counselor_1")).toHaveLength(1);
    try {
      await setCalling("counselor1", { counselor_position: null });
      expect(await readAs("counselor1", "counselor_1")).toEqual([]);
    } finally {
      await setCalling("counselor1", { counselor_position: 1 });
    }
    expect(await readAs("counselor1", "counselor_1")).toHaveLength(1);
  });

  it("hides the bishop's link while the bishop's calling is released", async () => {
    try {
      await setCalling("bishop", { is_active: false });
      expect(await readAs("bishop", "bishop")).toEqual([]);
      const { data } = await service
        .from("zoom_remote_links")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("position", "bishop");
      expect(data).toHaveLength(1);
    } finally {
      await setCalling("bishop", { is_active: true });
    }
  });

  it("does not return a turned-off row to its holder", async () => {
    expect(await readAs("executiveSecretary", "executive_secretary")).toHaveLength(1);
    const { error } = await service
      .from("zoom_remote_links")
      .update({
        url: null,
        deactivated_at: new Date().toISOString(),
        deactivated_reason: "turned_off",
      })
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "executive_secretary");
    expect(error).toBeNull();
    expect(await readAs("executiveSecretary", "executive_secretary")).toEqual([]);
    await seedLink("executive_secretary");
  });

  it("refuses an INSERT from the bishop", async () => {
    await service
      .from("zoom_remote_links")
      .delete()
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "ward_clerk");
    try {
      const { error } = await (clients.bishop as Client).from("zoom_remote_links").insert({
        ward_id: fixtures.wardAId,
        position: "ward_clerk",
        url: urlFor("ward_clerk"),
        holder_calling_id: callingIds.wardSecretary as string,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await seedLink("ward_clerk");
    }
  });

  it("makes an UPDATE and a DELETE from the bishop a zero-row no-op", async () => {
    await (clients.bishop as Client)
      .from("zoom_remote_links")
      .update({ url: "https://example.org/hijacked" })
      .eq("position", "bishop");
    await (clients.bishop as Client).from("zoom_remote_links").delete().eq("position", "bishop");

    const { data } = await service
      .from("zoom_remote_links")
      .select("url")
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "bishop")
      .single();
    expect(data?.url).toBe(urlFor("bishop"));
  });

  it("refuses an http:// link at the constraint", async () => {
    const { error } = await service
      .from("zoom_remote_links")
      .update({ url: "http://example.org/remote" })
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "counselor_2");
    expect(error?.code).toBe("23514");
  });

  it("refuses a turned-off row that still holds a url", async () => {
    const { error } = await service
      .from("zoom_remote_links")
      .update({ deactivated_at: new Date().toISOString(), deactivated_reason: "turned_off" })
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "counselor_2");
    expect(error?.code).toBe("23514");
  });

  it("hides the holder's link when the ward has not released Zoom", async () => {
    expect(await readAs("bishop", "bishop")).toHaveLength(1);
    const { error } = await service
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardAId, released_modules: ["tithing"] });
    if (error) throw new Error(error.message);
    try {
      expect(await readAs("bishop", "bishop")).toEqual([]);
    } finally {
      await service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    }
  });
});
