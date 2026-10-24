// @vitest-environment node
//
// POST /api/sacrament-planner/draft — "Write it fresh with Claude" (ITER-045). Only the Anthropic
// call is mocked, as every AI route suite does; the session and access checks run for real.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRequestError } from "@/lib/ai/errors";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const callClaude = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: (...args: unknown[]) => callClaude(...args),
    callClaudeStructured: vi.fn(),
  };
});

const PROMPT = 'Write a short, warm text.\n\nFacts (JSON):\n{"to":"Music","date":"Sunday"}';

async function post(body: unknown) {
  const { POST } = await import("@/app/api/sacrament-planner/draft/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/sacrament-planner/draft", { body })),
  );
}

describe("POST /api/sacrament-planner/draft", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator"]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(() => {
    callClaude.mockReset();
  });

  it("sends the Planner's prompt unchanged at medium effort and returns the text", async () => {
    callClaude.mockResolvedValueOnce({
      text: "Dear music coordinator,",
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      inputTokens: 50,
      outputTokens: 12,
    });
    await actAs(fixtures, "bishop");

    const { status, body } = await post({ prompt: PROMPT });

    expect(status).toBe(200);
    expect(body).toEqual({ text: "Dear music coordinator," });
    expect(callClaude).toHaveBeenCalledTimes(1);
    const params = callClaude.mock.calls[0][0] as {
      userPrompt: string;
      effort: string;
      system: { text: string }[];
    };
    expect(params.userPrompt).toBe(PROMPT);
    expect(params.effort).toBe("medium");
    expect(params.system[0].text).toMatch(/ward bishopric/);
  });

  it("maps an AI failure to its own status and sentence", async () => {
    callClaude.mockRejectedValueOnce(new AiRequestError("rate_limited"));
    await actAs(fixtures, "bishop");

    const { status, body } = await post({ prompt: PROMPT });

    expect(status).toBe(429);
    expect(errorMessage(body)).toMatch(/busy/);
  });

  it("refuses an empty prompt before calling Claude", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await post({ prompt: "   " });
    expect(status).toBe(400);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("refuses the music coordinator without calling Claude", async () => {
    await actAs(fixtures, "musicCoordinator");
    const { status } = await post({ prompt: PROMPT });
    expect(status).toBe(403);
    expect(callClaude).not.toHaveBeenCalled();
  });
});
