// @vitest-environment node
//
// Phase 5 test **ai-error-handling**. The phase plan's stated pitfall is a silent AI failure, so
// the thing under test is that EVERY way a Claude call can go wrong produces a distinct,
// actionable sentence — and that an unknown failure is rethrown rather than dressed up as one.
//
// `messages.create` is driven directly. The SDK's typed error classes are real (they are what
// lib/ai/client.ts narrows on); only the transport is replaced.

import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERROR_KINDS, isAiRequestError, type AiErrorKind } from "@/lib/ai/errors";

const create = vi.fn();
const parse = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>(
    "@anthropic-ai/sdk",
  );

  // Subclassing the real default export keeps every typed error class (RateLimitError,
  // APIConnectionError, …) intact — string-matching a message would defeat the purpose.
  class MockAnthropic extends actual.default {
    constructor(options?: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      Object.defineProperty(this, "messages", {
        value: { create, parse },
        configurable: true,
      });
    }
  }

  return { ...actual, default: MockAnthropic };
});

const SYSTEM = [{ type: "text" as const, text: "system" }];

async function callWithMockedSdk() {
  const { callClaude } = await import("@/lib/ai/client");
  return callClaude({
    system: SYSTEM,
    userPrompt: "Draft something.",
    effort: "medium",
    maxTokens: 512,
  });
}

function textResponse(text: string, stopReason: Anthropic.Message["stop_reason"] = "end_turn") {
  return {
    content: text === "" ? [] : [{ type: "text", text }],
    stop_reason: stopReason,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

async function kindOf(promise: Promise<unknown>): Promise<{ kind: AiErrorKind; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (isAiRequestError(error)) return { kind: error.kind, message: error.message };
    throw error;
  }
  throw new Error("Expected the call to throw an AiRequestError, but it resolved.");
}

describe("callClaude error translation", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-one";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns the text and the four usage counters on success", async () => {
    create.mockResolvedValue(textResponse("Here is a draft."));

    const result = await callWithMockedSdk();

    expect(result.text).toBe("Here is a draft.");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it("sends adaptive thinking, nested effort, and no budget_tokens", async () => {
    create.mockResolvedValue(textResponse("Draft."));

    await callWithMockedSdk();

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.thinking).toEqual({ type: "adaptive" });
    // budget_tokens is REMOVED on this model — sending it is a 400.
    expect(params.thinking).not.toHaveProperty("budget_tokens");
    // effort is nested inside output_config, never top-level.
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params).not.toHaveProperty("effort");
    // No assistant prefill: it is a 400 on this model.
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe("user");
  });

  it("maps a missing key to not_configured before any network call", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { kind } = await kindOf(callWithMockedSdk());

    expect(kind).toBe("not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("maps an empty key to not_configured", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";

    const { kind } = await kindOf(callWithMockedSdk());

    expect(kind).toBe("not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("maps each SDK error class to its own kind", async () => {
    const cases: Array<{ error: unknown; expected: AiErrorKind }> = [
      {
        error: new Anthropic.AuthenticationError(401, undefined, "unauthorized", new Headers()),
        expected: "not_configured",
      },
      {
        error: new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()),
        expected: "rate_limited",
      },
      { error: new Anthropic.APIConnectionError({}), expected: "unavailable" },
      {
        error: new Anthropic.BadRequestError(400, undefined, "bad request", new Headers()),
        expected: "invalid_request",
      },
      {
        error: new Anthropic.InternalServerError(503, undefined, "upstream", new Headers()),
        expected: "unavailable",
      },
    ];

    for (const { error, expected } of cases) {
      create.mockReset();
      create.mockRejectedValue(error);
      const { kind } = await kindOf(callWithMockedSdk());
      expect(kind).toBe(expected);
    }
  });

  it("maps a refusal, keeping the category out of the user's message", async () => {
    create.mockResolvedValue({
      ...textResponse("", "refusal"),
      stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
    });

    const { kind, message } = await kindOf(callWithMockedSdk());

    expect(kind).toBe("refused");
    expect(message).not.toContain("cyber");
  });

  it("maps a max_tokens stop to truncated rather than returning a partial draft", async () => {
    create.mockResolvedValue(textResponse("Half a sen", "max_tokens"));

    const { kind } = await kindOf(callWithMockedSdk());

    expect(kind).toBe("truncated");
  });

  it("refuses an empty response instead of returning an empty draft", async () => {
    create.mockResolvedValue(textResponse("   "));

    const { kind } = await kindOf(callWithMockedSdk());

    expect(kind).toBe("invalid_request");
  });

  // Swallowing this into invalid_request would tell the user "nothing was saved" without knowing
  // whether that is true, and would hide a real bug behind a handled-looking sentence.
  it("rethrows an unknown error unchanged", async () => {
    const unknown = new TypeError("someArray.map is not a function");
    create.mockRejectedValue(unknown);

    await expect(callWithMockedSdk()).rejects.toBe(unknown);
  });

  // Six kinds, six DISTINCT sentences. A future copy-paste that duplicates a message fails here
  // rather than quietly collapsing two failures a bishop needs to tell apart.
  it("gives all six kinds a distinct message", async () => {
    const { AI_ERROR_MESSAGES } = await import("@/lib/ai/errors");
    const messages = AI_ERROR_KINDS.map((kind) => AI_ERROR_MESSAGES[kind]);

    expect(AI_ERROR_KINDS).toHaveLength(6);
    expect(new Set(messages).size).toBe(6);
    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("callClaudeStructured", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-one";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  async function callStructured() {
    const { callClaudeStructured } = await import("@/lib/ai/client");
    return callClaudeStructured({
      system: SYSTEM,
      userPrompt: "Suggest topics.",
      effort: "high",
      maxTokens: 512,
      // The format object is opaque to the client — it is handed to the SDK untouched.
      format: { type: "json_schema" } as never,
    });
  }

  it("returns parsed_output when the schema matched", async () => {
    parse.mockResolvedValue({ ...textResponse("ignored"), parsed_output: { topics: ["Faith"] } });

    const result = await callStructured();

    expect(result.parsed).toEqual({ topics: ["Faith"] });
    expect(result.outputTokens).toBe(20);
  });

  // A null parse is a schema mismatch, not an answer.
  it("refuses a null parsed_output", async () => {
    parse.mockResolvedValue({ ...textResponse("ignored"), parsed_output: null });

    const { kind } = await kindOf(callStructured());

    expect(kind).toBe("invalid_request");
  });

  it("shares the same error contract as callClaude", async () => {
    parse.mockRejectedValue(new Anthropic.RateLimitError(429, undefined, "slow", new Headers()));

    const { kind } = await kindOf(callStructured());

    expect(kind).toBe("rate_limited");
  });
});
