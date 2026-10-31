// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// THE ZOOM SIGN-UP TABLES AT THE TABLE (ITER-052, migration 096).
//
// The bishopric, the ward clerk and the executive secretary read ward A's sign-ups, settings,
// questions and responses — names, phone numbers and answers from members of the public, so the
// reader set is deliberately narrow. Nobody else reads them, no ward reads another's, anon reads
// none of them, and no signed-in client writes any of them: every write is the service role behind
// a route. `status_token_hash` is hidden by a column grant. Refused writes are asserted by RE-READING.

type Client = SupabaseClient<Database>;

const VIEWERS: FixtureHandle[] = [
  "bishop",
  "counselor1",
  "counselor2",
  "wardSecretary",
  "executiveSecretary",
];

const TABLES = [
  "zoom_registration_settings",
  "zoom_registration_questions",
  "zoom_registrations",
  "zoom_registration_responses",
] as const;

// Named columns: `select("*")` on zoom_registrations is a 42501 by design.
const READ_COLUMNS: Record<(typeof TABLES)[number], string> = {
  zoom_registration_settings: "ward_id",
  zoom_registration_questions: "ward_id",
  zoom_registrations: "ward_id",
  zoom_registration_responses: "ward_id",
};

const HASH = "a".repeat(64);

describe("zoom sign-up tables RLS", () => {
  let fixtures: Fixtures;
  let service: Client;
  let registrationId: string;
  const clients: Partial<Record<FixtureHandle, Client>> = {};

  beforeAll(async () => {
    fixtures = await seedFixtures([...VIEWERS, "eqPresident", "wardBBishop"]);
    service = fixtures.service;
    for (const handle of [...VIEWERS, "eqPresident", "wardBBishop"] as FixtureHandle[]) {
      clients[handle] = await asRole(fixtures, handle);
    }

    const wardId = fixtures.wardAId;
    const settings = await service.from("zoom_registration_settings").insert({ ward_id: wardId });
    if (settings.error) throw new Error(settings.error.message);

    const question = await service.from("zoom_registration_questions").insert({
      ward_id: wardId,
      prompt: "How did you hear about us?",
      kind: "short_text",
      audience: "everyone",
      position: 1,
    });
    if (question.error) throw new Error(question.error.message);

    const { data, error } = await service
      .from("zoom_registrations")
      .insert({
        ward_id: wardId,
        display_name: "Ward A Sign-up",
        phone: "555-123-4567",
        phone_digits: "5551234567",
        says_member: false,
        status_token_hash: HASH,
        referral_code: "AbCdE12345",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    registrationId = data.id;

    const response = await service.from("zoom_registration_responses").insert({
      registration_id: registrationId,
      ward_id: wardId,
      user_id: fixtures.user("bishop").id,
      response: "approve",
    });
    if (response.error) throw new Error(response.error.message);
  });

  afterAll(async () => {
    await service?.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await service?.from("zoom_registrations").delete().eq("ward_id", fixtures.wardAId);
    await service?.from("zoom_registration_questions").delete().eq("ward_id", fixtures.wardAId);
    await service?.from("zoom_registration_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  async function storedName() {
    const { data, error } = await service
      .from("zoom_registrations")
      .select("display_name, status")
      .eq("id", registrationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  describe.each(TABLES)("%s", (table) => {
    it.each(VIEWERS)("lets %s read ward A's rows", async (handle) => {
      const { data, error } = await (clients[handle] as Client)
        .from(table)
        .select(READ_COLUMNS[table])
        .eq("ward_id", fixtures.wardAId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("shows an org president nothing", async () => {
      const { data, error } = await (clients.eqPresident as Client)
        .from(table)
        .select(READ_COLUMNS[table])
        .eq("ward_id", fixtures.wardAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("shows a ward B bishop nothing from ward A", async () => {
      const { data, error } = await (clients.wardBBishop as Client)
        .from(table)
        .select(READ_COLUMNS[table])
        .eq("ward_id", fixtures.wardAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("lets anon read nothing at all", async () => {
      const { data, error } = await anonClient()
        .from(table)
        .select(READ_COLUMNS[table])
        .eq("ward_id", fixtures.wardAId);
      // A revoked grant answers with an error; either way, no row.
      expect(data ?? []).toEqual([]);
      if (error) expect(error.code).toBe("42501");
    });
  });

  it("hides the status token hash from the bishop: select('*') is a permission error", async () => {
    const { error } = await (clients.bishop as Client)
      .from("zoom_registrations")
      .select("*")
      .eq("id", registrationId);
    expect(error?.code).toBe("42501");
  });

  it("refuses the status token hash even when asked for by name", async () => {
    const { error } = await (clients.bishop as Client)
      .from("zoom_registrations")
      .select("status_token_hash")
      .eq("id", registrationId);
    expect(error?.code).toBe("42501");
  });

  it("lets the bishop read every other column by name", async () => {
    const { data, error } = await (clients.bishop as Client)
      .from("zoom_registrations")
      .select("id, display_name, phone, referral_code, answers, decline_note")
      .eq("id", registrationId)
      .single();
    expect(error).toBeNull();
    expect(data?.display_name).toBe("Ward A Sign-up");
  });

  // The Sign-ups tab's own query, with its embeds (member, referrer, decider, invitee → pool link,
  // responders). Run as the clerk, the narrowest reader, so a column grant or a policy on any
  // embedded table that refused them would fail here rather than on the page.
  it("lets the clerk read the Sign-ups list with every embed", async () => {
    const referred = await service
      .from("zoom_registrations")
      .insert({
        ward_id: fixtures.wardAId,
        display_name: "Referred Friend",
        phone: "555-765-4321",
        phone_digits: "5557654321",
        says_member: false,
        status_token_hash: "c".repeat(64),
        referral_code: "QwErT67890",
        referred_by_registration_id: registrationId,
      })
      .select("id")
      .single();
    if (referred.error) throw new Error(referred.error.message);

    try {
      const { listRegistrations } = await import("@/lib/zoom/registrations");
      const list = await listRegistrations(fixtures.wardAId, clients.wardSecretary as Client);
      expect(list).toHaveLength(2);
      expect(list.find((row) => row.id === registrationId)).toMatchObject({
        displayName: "Ward A Sign-up",
        status: "pending",
        linkGiven: false,
        referrerName: null,
        responses: [{ userId: fixtures.user("bishop").id, response: "approve" }],
      });
      expect(list.find((row) => row.id === referred.data.id)?.referrerName).toBe("Ward A Sign-up");
    } finally {
      await service.from("zoom_registrations").delete().eq("id", referred.data.id);
    }
  });

  it("refuses every signed-in INSERT, the bishop's included", async () => {
    const { error } = await (clients.bishop as Client).from("zoom_registrations").insert({
      ward_id: fixtures.wardAId,
      display_name: "Inserted by a client",
      phone: "555-000-0000",
      phone_digits: "5550000000",
      says_member: false,
      status_token_hash: "b".repeat(64),
      referral_code: "ZyXwV98765",
    });
    expect(error?.code).toBe("42501");

    const { error: questionError } = await (clients.wardSecretary as Client)
      .from("zoom_registration_questions")
      .insert({ ward_id: fixtures.wardAId, prompt: "Sneaky?", kind: "yes_no", audience: "everyone", position: 9 });
    expect(questionError?.code).toBe("42501");

    const { count } = await service
      .from("zoom_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    expect(count).toBe(1);
  });

  it.each(["bishop", "wardSecretary"] as FixtureHandle[])(
    "leaves the request unchanged when %s tries to UPDATE it",
    async (handle) => {
      await (clients[handle] as Client)
        .from("zoom_registrations")
        .update({ display_name: "Changed", status: "declined" })
        .eq("id", registrationId);
      expect(await storedName()).toEqual({ display_name: "Ward A Sign-up", status: "pending" });
    },
  );

  it("leaves the settings closed when the bishop tries to open them directly", async () => {
    await (clients.bishop as Client)
      .from("zoom_registration_settings")
      .update({ is_open: true })
      .eq("ward_id", fixtures.wardAId);
    const { data } = await service
      .from("zoom_registration_settings")
      .select("is_open")
      .eq("ward_id", fixtures.wardAId)
      .single();
    expect(data?.is_open).toBe(false);
  });

  it("leaves the request in place when the bishop tries to DELETE it", async () => {
    await (clients.bishop as Client).from("zoom_registrations").delete().eq("id", registrationId);
    await (clients.bishop as Client)
      .from("zoom_registration_responses")
      .delete()
      .eq("registration_id", registrationId);
    expect(await storedName()).not.toBeNull();
    const { count } = await service
      .from("zoom_registration_responses")
      .select("user_id", { count: "exact", head: true })
      .eq("registration_id", registrationId);
    expect(count).toBe(1);
  });

  it("shows the bishop nothing once the ward has not released Zoom", async () => {
    const { error } = await service
      .from("ward_release_settings")
      .upsert({ ward_id: fixtures.wardAId, released_modules: ["roster"] });
    if (error) throw new Error(error.message);

    try {
      for (const table of TABLES) {
        const { data, error: readError } = await (clients.bishop as Client)
          .from(table)
          .select(READ_COLUMNS[table])
          .eq("ward_id", fixtures.wardAId);
        expect(readError).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      await service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    }
  });
});
