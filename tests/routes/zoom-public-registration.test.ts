// @vitest-environment node
//
// THE PUBLIC ZOOM SIGN-UP ROUTE (ITER-052, z3a): POST /api/public/zoom-registrations. There is no
// session at all — the route uses the service role behind its own validation, honeypot and caps.
// The server client factory is still mocked (the route's imports reach it), but nothing here acts
// as anybody. Every negative-path body is otherwise VALID, so it is refused for the reason under
// test and not by an earlier check (the global rule).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { anonClient } from "@/tests/helpers/asRole";
import { jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import { createStatusToken } from "@/lib/zoom/registrationTokens";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL_BASE = "http://localhost/api/public/zoom-registrations";
const SECRET_NAME = "Quinn Marlowe-Testperson";
const SECRET_PHONE = "(555) 867-5309";
const SECRET_EMAIL = "quinn.private@example.org";
const SECRET_ANSWER = "Heard from my neighbour Bertha";

describe("POST /api/public/zoom-registrations", () => {
  let fixtures: Fixtures;
  const slug = `zoom-route-${crypto.randomUUID().slice(0, 8)}`;
  let questionId: string;
  let phoneCounter = 0;

  function uniquePhone(): string {
    phoneCounter += 1;
    return `555-${String(200 + phoneCounter).padStart(3, "0")}-${String(1000 + phoneCounter).slice(-4)}`;
  }

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      slug,
      displayName: "Avery Hart",
      phone: uniquePhone(),
      email: "",
      saysMember: false,
      answers: [{ questionId, answer: "A friend" }],
      website: "",
      ...overrides,
    };
  }

  async function submit(body: unknown) {
    const { POST } = await import("@/app/api/public/zoom-registrations/route");
    return readResponse(await POST(jsonRequest(URL_BASE, { method: "POST", body })));
  }

  async function setSettings(fields: { is_open?: boolean; auto_approve?: boolean }) {
    const { error } = await fixtures.service
      .from("zoom_registration_settings")
      .update(fields)
      .eq("ward_id", fixtures.wardAId);
    if (error) throw new Error(error.message);
  }

  async function fillPool(count: number) {
    if (count === 0) return;
    const { error } = await fixtures.service.from("zoom_join_links").insert(
      Array.from({ length: count }, (_unused, index) => ({
        ward_id: fixtures.wardAId,
        placeholder_name: `Guest ${String(index + 1).padStart(2, "0")}`,
        placeholder_email: `guest-${crypto.randomUUID().slice(0, 8)}@example.com`,
        join_url: `https://zoom.us/w/${crypto.randomUUID()}`,
      })),
    );
    if (error) throw new Error(error.message);
  }

  async function clearWard() {
    const service = fixtures.service;
    const wardId = fixtures.wardAId;
    await service.from("todos").delete().eq("ward_id", wardId).not("zoom_invitee_id", "is", null);
    await service.from("zoom_registrations").delete().eq("ward_id", wardId);
    await service.from("zoom_invitees").delete().eq("ward_id", wardId);
    await service.from("zoom_join_links").delete().eq("ward_id", wardId);
    await service.from("audit_log").delete().eq("ward_id", wardId).like("action", "zoom_registration%");
  }

  async function registrationFor(statusUrl: string) {
    const token = decodeURIComponent(statusUrl.split("/").pop() ?? "");
    const { data, error } = await anonClient().rpc("zoom_registration_status", { p_token: token });
    if (error) throw new Error(error.message);
    return data?.[0] ?? null;
  }

  async function seedRows(count: number, fields: Record<string, unknown>) {
    const rows = Array.from({ length: count }, (_unused, index) => ({
      ward_id: fixtures.wardAId,
      display_name: `Seeded ${index}`,
      phone: `555-0${String(index).padStart(2, "0")}-0000`,
      phone_digits: `5550${String(index).padStart(2, "0")}0000`,
      says_member: false,
      status_token_hash: createStatusToken().hash,
      referral_code: `Seed${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`,
      status: "pending",
      decided_at: null as string | null,
      decided_by: null,
      ...fields,
    }));
    const { error } = await fixtures.service.from("zoom_registrations").insert(rows);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    const service = fixtures.service;

    const page = await service
      .from("public_pages")
      .insert({ ward_id: fixtures.wardAId, page_type: "zoom_registration", slug, is_active: true });
    if (page.error) throw new Error(page.error.message);

    const settings = await service
      .from("zoom_registration_settings")
      .insert({ ward_id: fixtures.wardAId, is_open: true, auto_approve: true });
    if (settings.error) throw new Error(settings.error.message);

    const { data, error } = await service
      .from("zoom_registration_questions")
      .insert({
        ward_id: fixtures.wardAId,
        prompt: "How did you hear about us?",
        kind: "short_text",
        audience: "everyone",
        is_required: true,
        position: 1,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    questionId = data.id;
  });

  beforeEach(async () => {
    await clearWard();
    await setSettings({ is_open: true, auto_approve: true });
    await fillPool(2);
  });

  afterAll(async () => {
    if (!fixtures) return;
    await clearWard();
    await fixtures.service.from("zoom_registration_questions").delete().eq("ward_id", fixtures.wardAId);
    await fixtures.service.from("zoom_registration_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures.service.from("public_pages").delete().eq("slug", slug);
    await fixtures.cleanup();
  });

  it("approves automatically and gives a link the status page shows", async () => {
    const { status, body } = await submit(validBody());
    expect(status).toBe(201);
    expect(typeof body.statusUrl).toBe("string");
    expect(body.statusUrl as string).toContain(`/public/${slug}/status/`);

    const row = await registrationFor(body.statusUrl as string);
    expect(row).toMatchObject({ status: "approved", link_given: true, display_name: "Avery Hart" });
    expect(row?.join_url).toMatch(/^https:\/\/zoom\.us\/w\//);
  });

  it("holds every request while approvals are on", async () => {
    await setSettings({ auto_approve: false });
    const { status, body } = await submit(validBody());
    expect(status).toBe(201);

    const { data } = await fixtures.service
      .from("zoom_registrations")
      .select("status, held_reason")
      .eq("ward_id", fixtures.wardAId);
    expect(data).toEqual([{ status: "pending", held_reason: "approvals_on" }]);
    expect((await registrationFor(body.statusUrl as string))?.join_url).toBeNull();
  });

  it("holds a repeat phone rather than approving it", async () => {
    const phone = uniquePhone();
    expect((await submit(validBody({ phone }))).status).toBe(201);
    expect((await submit(validBody({ phone, displayName: "Second Try" }))).status).toBe(201);

    const { data } = await fixtures.service
      .from("zoom_registrations")
      .select("display_name, status, held_reason")
      .eq("ward_id", fixtures.wardAId)
      .eq("display_name", "Second Try")
      .single();
    expect(data).toEqual({ display_name: "Second Try", status: "pending", held_reason: "same_phone" });
  });

  it("holds a request once ten have been approved automatically today", async () => {
    await seedRows(10, { status: "approved", decided_at: new Date().toISOString() });
    const { status } = await submit(validBody({ displayName: "Eleventh" }));
    expect(status).toBe(201);

    const { data } = await fixtures.service
      .from("zoom_registrations")
      .select("status, held_reason")
      .eq("ward_id", fixtures.wardAId)
      .eq("display_name", "Eleventh")
      .single();
    expect(data).toEqual({ status: "pending", held_reason: "daily_limit" });
  });

  it("refuses a fully valid request once the ward has had 40 today", async () => {
    await seedRows(40, {});
    const { status, body } = await submit(validBody());
    expect(status).toBe(429);
    expect(body.error).toBe("Lots of people are signing up right now. Please try again tomorrow.");
  });

  it("approves with an empty pool and puts a waiting to-do on every bishopric member", async () => {
    await fixtures.service.from("zoom_join_links").delete().eq("ward_id", fixtures.wardAId);
    const { status, body } = await submit(validBody({ displayName: "Pool Empty" }));
    expect(status).toBe(201);

    const row = await registrationFor(body.statusUrl as string);
    expect(row).toMatchObject({ status: "approved", link_given: false, join_url: null });

    const { data: todos } = await fixtures.service
      .from("todos")
      .select("user_id, title")
      .eq("ward_id", fixtures.wardAId)
      .not("zoom_invitee_id", "is", null);
    expect(todos?.map((todo) => todo.user_id).sort()).toEqual(
      [fixtures.user("bishop").id, fixtures.user("counselor1").id, fixtures.user("counselor2").id].sort(),
    );
    expect(todos?.every((todo) => todo.title === "Give Pool Empty a Zoom link")).toBe(true);
  });

  it("records who referred them", async () => {
    const first = await submit(validBody({ displayName: "Referrer" }));
    const referrer = await registrationFor(first.body.statusUrl as string);

    expect((await submit(validBody({ displayName: "Friend", ref: referrer?.referral_code }))).status).toBe(201);

    const { data } = await fixtures.service
      .from("zoom_registrations")
      .select("referred_by_registration_id, referrer:zoom_registrations!zoom_registrations_referred_by_registration_id_ward_id_fkey (display_name)")
      .eq("ward_id", fixtures.wardAId)
      .eq("display_name", "Friend")
      .single();
    expect(data?.referred_by_registration_id).not.toBeNull();
  });

  it("records no referrer for an unknown code, and still accepts the request", async () => {
    const { status } = await submit(validBody({ displayName: "Unknown Ref", ref: "ZzZzZ99999" }));
    expect(status).toBe(201);
    const { data } = await fixtures.service
      .from("zoom_registrations")
      .select("referred_by_registration_id")
      .eq("display_name", "Unknown Ref")
      .single();
    expect(data?.referred_by_registration_id).toBeNull();
  });

  it("answers a filled honeypot like a success and writes nothing", async () => {
    const { status, body } = await submit(validBody({ website: "http://spam.example" }));
    expect(status).toBe(201);
    expect(body.statusUrl).toBeNull();

    const { count } = await fixtures.service
      .from("zoom_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    expect(count).toBe(0);
  });

  it("refuses a missing required answer with the question's words", async () => {
    const { status, body } = await submit(validBody({ answers: [] }));
    expect(status).toBe(400);
    expect(body.error).toBe("Please answer: How did you hear about us?");
  });

  // Migration 097. Both requests answer the required "How did you hear" question, so only the
  // follow-up rule can decide them.
  it("requires the address after Yes to the missionaries, and stores it beside its question", async () => {
    const service = fixtures.service;
    const { data: inserted, error } = await service
      .from("zoom_registration_questions")
      .insert({
        ward_id: fixtures.wardAId,
        prompt: "Would you welcome a visit from the missionaries?",
        kind: "yes_no",
        audience: "non_members",
        position: 2,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const missionaryId = inserted.id;

    const { data: followUp, error: followUpError } = await service
      .from("zoom_registration_questions")
      .insert({
        ward_id: fixtures.wardAId,
        prompt: "What's your address?",
        kind: "short_text",
        audience: "non_members",
        is_required: true,
        position: 3,
        shown_when_yes_to: missionaryId,
      })
      .select("id")
      .single();
    if (followUpError) throw new Error(followUpError.message);

    try {
      const heard = { questionId, answer: "A friend" };
      const withoutAddress = await submit(
        validBody({ answers: [heard, { questionId: missionaryId, answer: true }] }),
      );
      expect(withoutAddress.status).toBe(400);
      expect(withoutAddress.body.error).toBe("Please answer: What's your address?");

      const saidNo = await submit(
        validBody({
          displayName: "Said No",
          answers: [heard, { questionId: missionaryId, answer: false }, { questionId: followUp.id, answer: "Not asked" }],
        }),
      );
      expect(saidNo.status).toBe(201);

      const withAddress = await submit(
        validBody({
          displayName: "Said Yes",
          answers: [heard, { questionId: missionaryId, answer: true }, { questionId: followUp.id, answer: "12 Elm Street" }],
        }),
      );
      expect(withAddress.status).toBe(201);

      const { data: stored } = await service
        .from("zoom_registrations")
        .select("display_name, answers")
        .eq("ward_id", fixtures.wardAId)
        .in("display_name", ["Said No", "Said Yes"]);
      const answersOf = (name: string) =>
        (stored?.find((row) => row.display_name === name)?.answers as { prompt: string; answer: unknown }[]) ?? [];
      expect(answersOf("Said Yes").map((answer) => [answer.prompt, answer.answer])).toEqual([
        ["How did you hear about us?", "A friend"],
        ["Would you welcome a visit from the missionaries?", true],
        ["What's your address?", "12 Elm Street"],
      ]);
      expect(answersOf("Said No").map((answer) => answer.prompt)).not.toContain("What's your address?");
    } finally {
      await service.from("zoom_registration_questions").delete().in("id", [followUp.id, missionaryId]);
    }
  });

  it("answers a closed page and an unknown slug with the same 404", async () => {
    await setSettings({ is_open: false });
    const closed = await submit(validBody());
    const unknown = await submit(validBody({ slug: "zoom-nobody-made-this" }));

    expect(closed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(closed.body).toEqual(unknown.body);
    expect(closed.body.error).toBe("This sign-up page isn't available.");
  });

  it("writes an audit row with no user and none of the person's details", async () => {
    const { status } = await submit({
      slug,
      displayName: SECRET_NAME,
      phone: SECRET_PHONE,
      email: SECRET_EMAIL,
      saysMember: false,
      answers: [{ questionId, answer: SECRET_ANSWER }],
    });
    expect(status).toBe(201);

    const { data: registration } = await fixtures.service
      .from("zoom_registrations")
      .select("referral_code, status_token_hash")
      .eq("display_name", SECRET_NAME)
      .single();

    const { data: audits } = await fixtures.service
      .from("audit_log")
      .select("user_id, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_submitted");
    expect(audits).toHaveLength(1);
    expect(audits?.[0]?.user_id).toBeNull();

    const serialised = JSON.stringify(audits?.[0]?.detail);
    for (const secret of [
      SECRET_NAME,
      SECRET_PHONE,
      "5558675309",
      SECRET_EMAIL,
      SECRET_ANSWER,
      registration?.referral_code ?? "missing",
      registration?.status_token_hash ?? "missing",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });
});
