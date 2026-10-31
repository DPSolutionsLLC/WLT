// @vitest-environment node
//
// THE ZOOM SIGN-UP SETTINGS AND QUESTIONS ROUTES (ITER-052, z3a): POST/PUT
// /api/zoom/registration-settings and POST/PATCH /api/zoom/registration-questions. Only the server
// client factory is mocked, so every query runs as the acting user. See tests/helpers/routeClient.ts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const SETTINGS_URL = "http://localhost/api/zoom/registration-settings";
const QUESTIONS_URL = "http://localhost/api/zoom/registration-questions";

async function setUp() {
  const { POST } = await import("@/app/api/zoom/registration-settings/route");
  return readResponse(await POST());
}

async function updateSettings(body: unknown) {
  const { PUT } = await import("@/app/api/zoom/registration-settings/route");
  return readResponse(await PUT(jsonRequest(SETTINGS_URL, { method: "PUT", body })));
}

async function addQuestion(body: unknown) {
  const { POST } = await import("@/app/api/zoom/registration-questions/route");
  return readResponse(await POST(jsonRequest(QUESTIONS_URL, { method: "POST", body })));
}

async function patchQuestion(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/zoom/registration-questions/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${QUESTIONS_URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

const QUESTION = { prompt: "How did you hear about us?", kind: "short_text", audience: "everyone" };

describe("the Zoom sign-up settings and questions routes", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary", "eqPresident"]);
  });

  afterAll(async () => {
    if (!fixtures) return;
    const service = fixtures.service;
    await service.from("zoom_registration_questions").delete().eq("ward_id", fixtures.wardAId);
    await service.from("zoom_registration_settings").delete().eq("ward_id", fixtures.wardAId);
    await service
      .from("public_pages")
      .delete()
      .eq("ward_id", fixtures.wardAId)
      .eq("page_type", "zoom_registration");
    await fixtures.cleanup();
  });

  it("refuses an org president both the settings and the questions", async () => {
    await actAs(fixtures, "eqPresident");
    expect((await setUp()).status).toBe(403);
    expect((await addQuestion(QUESTION)).status).toBe(403);
  });

  it("sets sign-ups up once, closed, with one slug, the missionary question and its address follow-up", async () => {
    await actAs(fixtures, "bishop");
    const first = await setUp();
    expect(first.status).toBe(201);
    expect(first.body.settings).toMatchObject({ isOpen: false, autoApprove: false });

    const second = await setUp();
    expect(second.status).toBe(200);

    const service = fixtures.service;
    const { count: settingsRows } = await service
      .from("zoom_registration_settings")
      .select("ward_id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    const { data: pages } = await service
      .from("public_pages")
      .select("slug")
      .eq("ward_id", fixtures.wardAId)
      .eq("page_type", "zoom_registration");
    const { data: questions } = await service
      .from("zoom_registration_questions")
      .select("id, prompt, kind, audience, is_required, shown_when_yes_to")
      .eq("ward_id", fixtures.wardAId)
      .order("position");

    expect(settingsRows).toBe(1);
    expect(pages).toHaveLength(1);
    expect(pages?.[0]?.slug).toMatch(/^zoom-[0-9a-f]{16}$/);
    expect(questions).toEqual([
      {
        id: expect.any(String),
        prompt: "Would you welcome a visit from the missionaries?",
        kind: "yes_no",
        audience: "non_members",
        is_required: false,
        shown_when_yes_to: null,
      },
      {
        id: expect.any(String),
        prompt: "What's your address?",
        kind: "short_text",
        audience: "non_members",
        is_required: true,
        shown_when_yes_to: questions?.[0]?.id,
      },
    ]);

    const { data: audits } = await service
      .from("audit_log")
      .select("action")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_set_up");
    expect(audits).toHaveLength(1);
  });

  it("lets a counselor change a switch, and audits the field name only", async () => {
    await actAs(fixtures, "counselor1");
    const { status, body } = await updateSettings({ isOpen: true });
    expect(status).toBe(200);
    expect(body.settings).toMatchObject({ isOpen: true });

    const { data: audits } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_settings_changed");
    expect(audits?.map((audit) => audit.detail)).toEqual([{ changedFields: ["isOpen"] }]);
  });

  it("refuses the clerk the settings but lets them add a question", async () => {
    await actAs(fixtures, "wardSecretary");
    expect((await updateSettings({ autoApprove: true })).status).toBe(403);

    const added = await addQuestion(QUESTION);
    expect(added.status).toBe(201);
    expect(added.body.question).toMatchObject({
      prompt: QUESTION.prompt,
      position: 3,
      isActive: true,
      shownWhenYesTo: null,
    });
  });

  it("refuses a ninth active question with a sentence naming the way forward", async () => {
    await actAs(fixtures, "bishop");
    for (let index = 0; index < 5; index += 1) {
      expect((await addQuestion({ ...QUESTION, prompt: `Question ${index}` })).status).toBe(201);
    }

    const ninth = await addQuestion({ ...QUESTION, prompt: "One too many" });
    expect(ninth.status).toBe(400);
    expect(ninth.body.error).toBe("A sign-up page can ask at most 8 questions. Turn one off first.");
  });

  it("turns a question off and on again, never deleting it", async () => {
    await actAs(fixtures, "wardSecretary");
    const { data: question } = await fixtures.service
      .from("zoom_registration_questions")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("prompt", "Question 0")
      .single();

    const off = await patchQuestion(question!.id, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.question).toMatchObject({ isActive: false });

    const on = await patchQuestion(question!.id, { isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.question).toMatchObject({ isActive: true });
  });

  it("moves a question by swapping it with its neighbour", async () => {
    await actAs(fixtures, "bishop");
    const { data: before } = await fixtures.service
      .from("zoom_registration_questions")
      .select("id, position")
      .eq("ward_id", fixtures.wardAId)
      .is("shown_when_yes_to", null)
      .order("position");
    const [firstQuestion, secondQuestion] = before!;

    const moved = await patchQuestion(secondQuestion.id, { move: "up" });
    expect(moved.status).toBe(200);
    expect(moved.body.question).toMatchObject({ position: firstQuestion.position });

    const { data: after } = await fixtures.service
      .from("zoom_registration_questions")
      .select("position")
      .eq("id", firstQuestion.id)
      .single();
    expect(after?.position).toBe(secondQuestion.position);
  });

  it("refuses to change a question's kind", async () => {
    await actAs(fixtures, "bishop");
    const { data: question } = await fixtures.service
      .from("zoom_registration_questions")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("prompt", "Question 1")
      .single();

    const { status, body } = await patchQuestion(question!.id, { kind: "yes_no" });
    expect(status).toBe(400);
    expect(body.error).toBe(
      "A question's kind can't be changed once it's made. Turn it off and add a new one.",
    );
  });

  // The follow-up checks run AFTER the eight-question cap, so two questions are turned off first: a
  // refusal must be for the follow-up rule, never because the page is full.
  it("checks a follow-up's question before saving it", async () => {
    await actAs(fixtures, "bishop");
    const service = fixtures.service;
    const { data: rows } = await service
      .from("zoom_registration_questions")
      .select("id, prompt")
      .eq("ward_id", fixtures.wardAId);
    const idOf = (prompt: string) => rows?.find((row) => row.prompt === prompt)?.id as string;

    expect((await patchQuestion(idOf("Question 3"), { isActive: false })).status).toBe(200);
    expect((await patchQuestion(idOf("Question 4"), { isActive: false })).status).toBe(200);

    const afterShortAnswer = await addQuestion({ ...QUESTION, prompt: "Which school?", shownWhenYesTo: idOf("Question 2") });
    expect(afterShortAnswer.status).toBe(400);
    expect(afterShortAnswer.body.error).toBe("A follow-up can only follow a yes/no question.");

    const missionaries = idOf("Would you welcome a visit from the missionaries?");
    const added = await addQuestion({
      prompt: "Is an evening visit best?",
      kind: "yes_no",
      audience: "non_members",
      shownWhenYesTo: missionaries,
    });
    expect(added.status).toBe(201);
    expect(added.body.question).toMatchObject({ shownWhenYesTo: missionaries });
    const addedId = (added.body.question as { id: string }).id;

    // A yes/no follow-up, so only the one-level rule can refuse it.
    const afterFollowUp = await addQuestion({ ...QUESTION, prompt: "Which evening?", shownWhenYesTo: addedId });
    expect(afterFollowUp.status).toBe(400);
    expect(afterFollowUp.body.error).toBe(
      "Follow-ups go one level deep: a follow-up can't have follow-ups of its own.",
    );

    const unlinked = await patchQuestion(addedId, { shownWhenYesTo: null });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.question).toMatchObject({ shownWhenYesTo: null });

    const { data: audits } = await service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_question_changed")
      .contains("detail", { questionId: addedId });
    expect(audits?.map((audit) => audit.detail)).toEqual([
      { questionId: addedId, changedFields: ["shownWhenYesTo"] },
    ]);
  });
});
