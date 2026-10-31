// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStatusToken } from "@/lib/zoom/registrationTokens";
import { anonClient, asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// THE ZOOM SIGN-UP FUNCTIONS (ITER-052, migration 096), called the way the public pages call them:
// through the ANON key. A dropped or recreated function loses its grants (program-c), so these are
// what prove the grants exist after `db:push` — and that the two write functions are NOT callable
// by anon or a signed-in client.
//
// The status token is hashed in Node (lib/zoom/registrationTokens.ts) and in SQL
// (extensions.digest); a status page found by its token is what proves the two agree.

type Client = SupabaseClient<Database>;

describe("zoom sign-up functions", () => {
  let fixtures: Fixtures;
  let service: Client;
  const slug = `zoom-test-${crypto.randomUUID().slice(0, 8)}`;
  const programSlug = `program-test-${crypto.randomUUID().slice(0, 8)}`;
  const inactiveSlug = `zoom-off-${crypto.randomUUID().slice(0, 8)}`;
  const pending = createStatusToken();
  const declined = createStatusToken();
  let pendingId: string;

  async function insertRegistration(name: string, hash: string, status: "pending" | "declined", code: string) {
    const { data, error } = await service
      .from("zoom_registrations")
      .insert({
        ward_id: fixtures.wardAId,
        display_name: name,
        phone: "555-123-4567",
        phone_digits: "5551234567",
        says_member: false,
        status,
        decided_at: status === "pending" ? null : new Date().toISOString(),
        status_token_hash: hash,
        referral_code: code,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    service = fixtures.service;
    const wardId = fixtures.wardAId;

    const pages = await service.from("public_pages").insert([
      { ward_id: wardId, page_type: "zoom_registration", slug, is_active: true },
      { ward_id: wardId, page_type: "program", slug: programSlug, is_active: true },
      { ward_id: fixtures.wardBId, page_type: "zoom_registration", slug: inactiveSlug, is_active: false },
    ]);
    if (pages.error) throw new Error(pages.error.message);

    const settings = await service
      .from("zoom_registration_settings")
      .insert({ ward_id: wardId, is_open: true, auto_approve: true });
    if (settings.error) throw new Error(settings.error.message);

    const questions = await service.from("zoom_registration_questions").insert([
      { ward_id: wardId, prompt: "Second asked", kind: "short_text", audience: "everyone", position: 2, is_active: true },
      { ward_id: wardId, prompt: "First asked", kind: "yes_no", audience: "non_members", position: 1, is_active: true },
      { ward_id: wardId, prompt: "Turned off", kind: "yes_no", audience: "everyone", position: 3, is_active: false },
    ]);
    if (questions.error) throw new Error(questions.error.message);

    const links = await service.from("zoom_join_links").insert({
      ward_id: wardId,
      placeholder_name: "Guest 01",
      placeholder_email: `guest01-${crypto.randomUUID().slice(0, 8)}@example.com`,
      join_url: `https://zoom.us/w/${crypto.randomUUID()}`,
    });
    if (links.error) throw new Error(links.error.message);

    pendingId = await insertRegistration("Pending Person", pending.hash, "pending", "PendIng123");
    await insertRegistration("Declined Person", declined.hash, "declined", "DeclIned12");
  });

  afterAll(async () => {
    const wardIds = [fixtures.wardAId, fixtures.wardBId];
    await service?.from("ward_release_settings").delete().in("ward_id", wardIds);
    await service?.from("zoom_registrations").delete().in("ward_id", wardIds);
    await service?.from("zoom_invitees").delete().in("ward_id", wardIds);
    await service?.from("zoom_join_links").delete().in("ward_id", wardIds);
    await service?.from("zoom_registration_questions").delete().in("ward_id", wardIds);
    await service?.from("zoom_registration_settings").delete().in("ward_id", wardIds);
    await service?.from("public_pages").delete().in("slug", [slug, programSlug, inactiveSlug]);
    await fixtures?.cleanup();
  });

  describe("zoom_registration_form", () => {
    it("answers anon for an active sign-up slug, with the active questions in order", async () => {
      const { data, error } = await anonClient().rpc("zoom_registration_form", { p_slug: slug });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0];
      expect(row.is_open).toBe(true);
      expect(row.ward_name).toBeTruthy();
      const prompts = (row.questions as { prompt: string }[]).map((question) => question.prompt);
      expect(prompts).toEqual(["First asked", "Second asked"]);
      // Migration 097: every question says whether it is a follow-up; null = an ordinary question.
      for (const question of row.questions as Record<string, unknown>[]) {
        expect(question).toHaveProperty("shown_when_yes_to", null);
      }
    });

    it.each([
      ["a program slug", () => programSlug],
      ["an inactive slug", () => inactiveSlug],
      ["an unknown slug", () => "zoom-nobody-made-this"],
    ])("returns nothing for %s", async (_label, slugFor) => {
      const { data, error } = await anonClient().rpc("zoom_registration_form", { p_slug: slugFor() });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("says closed when the ward has closed sign-ups", async () => {
      await service.from("zoom_registration_settings").update({ is_open: false }).eq("ward_id", fixtures.wardAId);
      try {
        const { data } = await anonClient().rpc("zoom_registration_form", { p_slug: slug });
        expect(data?.[0]?.is_open).toBe(false);
      } finally {
        await service.from("zoom_registration_settings").update({ is_open: true }).eq("ward_id", fixtures.wardAId);
      }
    });

    it("says closed when the ward has not released Zoom", async () => {
      const { error } = await service
        .from("ward_release_settings")
        .upsert({ ward_id: fixtures.wardAId, released_modules: ["roster"] });
      if (error) throw new Error(error.message);
      try {
        const { data } = await anonClient().rpc("zoom_registration_form", { p_slug: slug });
        expect(data?.[0]?.is_open).toBe(false);
      } finally {
        await service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
      }
    });
  });

  describe("zoom_registration_status", () => {
    it("finds a registrant by the token Node hashed, and gives no link while pending", async () => {
      const { data, error } = await anonClient().rpc("zoom_registration_status", { p_token: pending.token });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({
        slug,
        display_name: "Pending Person",
        status: "pending",
        link_given: false,
        join_url: null,
        referral_code: "PendIng123",
      });
    });

    it("gives a declined registrant no link", async () => {
      const { data } = await anonClient().rpc("zoom_registration_status", { p_token: declined.token });
      expect(data?.[0]).toMatchObject({ status: "declined", join_url: null });
    });

    it("returns nothing for a wrong token or a malformed one", async () => {
      for (const token of [createStatusToken().token, "short", `${pending.token}x`, pending.hash]) {
        const { data, error } = await anonClient().rpc("zoom_registration_status", { p_token: token });
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    });
  });

  describe("the write functions", () => {
    it("cannot be called by anon", async () => {
      const approve = await anonClient().rpc("approve_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_decided_by: fixtures.user("bishop").id,
      });
      expect(approve.error?.code).toBe("42501");

      const respond = await anonClient().rpc("respond_to_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_user_id: fixtures.user("bishop").id,
        p_response: "approve",
      });
      expect(respond.error?.code).toBe("42501");
    });

    it("cannot be called by a signed-in bishop", async () => {
      const bishop = await asRole(fixtures, "bishop");
      const approve = await bishop.rpc("approve_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_decided_by: fixtures.user("bishop").id,
      });
      expect(approve.error?.code).toBe("42501");

      const respond = await bishop.rpc("respond_to_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_user_id: fixtures.user("bishop").id,
        p_response: "approve",
      });
      expect(respond.error?.code).toBe("42501");
    });

    it("approves once: one invitee, one link, and the status page then shows it", async () => {
      const first = await service.rpc("approve_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_decided_by: null as unknown as string,
      });
      expect(first.error).toBeNull();
      expect(first.data).toHaveLength(1);
      expect(first.data![0].join_link_id).not.toBeNull();

      const again = await service.rpc("approve_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: pendingId,
        p_decided_by: null as unknown as string,
      });
      expect(again.error).toBeNull();
      expect(again.data).toEqual([]);

      const { data: invitees } = await service
        .from("zoom_invitees")
        .select("id, source, assigned_by, display_name")
        .eq("ward_id", fixtures.wardAId);
      expect(invitees).toEqual([
        expect.objectContaining({ source: "self_registration", assigned_by: null, display_name: "Pending Person" }),
      ]);

      const { data: status } = await anonClient().rpc("zoom_registration_status", { p_token: pending.token });
      expect(status?.[0]).toMatchObject({ status: "approved", link_given: true });
      expect(status?.[0]?.join_url).toMatch(/^https:\/\/zoom\.us\/w\//);
    });

    it("approves with an empty pool and leaves the person waiting for a link", async () => {
      const waiting = createStatusToken();
      const registrationId = await insertRegistration("Waiting Person", waiting.hash, "pending", "WaitIng123");

      const { data, error } = await service.rpc("approve_zoom_registration", {
        p_ward_id: fixtures.wardAId,
        p_registration_id: registrationId,
        p_decided_by: fixtures.user("bishop").id,
      });
      expect(error).toBeNull();
      expect(data?.[0]?.join_link_id).toBeNull();

      const { data: status } = await anonClient().rpc("zoom_registration_status", { p_token: waiting.token });
      expect(status?.[0]).toMatchObject({ status: "approved", link_given: false, join_url: null });
    });
  });
});
