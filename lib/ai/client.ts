import Anthropic from "@anthropic-ai/sdk";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk";
import { AiRequestError } from "@/lib/ai/errors";

// SERVER-ONLY. The same guard lib/supabase/service.ts uses, for the same reason: an accidental
// import into a client component must fail loudly at the boundary rather than ship a key to a
// browser (CLAUDE.md rule 4). tests/lib/aiClientKeys.test.ts asserts this guard exists.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/ai/client.ts was imported into browser code. ANTHROPIC_API_KEY must never reach the client.",
  );
}

// CLAUDE.md §3 overrides SPEC.md's `claude-sonnet-4-6`: same tier and price, current generation.
export const MODEL = "claude-sonnet-5";

// A confirmation text message is deliberately short; 4096 is a product decision, not a guess.
export const MESSAGE_MAX_TOKENS = 4096;

// Topic batches are long. Still well under the size at which the SDK requires streaming.
export const GENERATION_MAX_TOKENS = 16000;

// "medium" for message drafting, "high" for topic and scripture generation (CLAUDE.md §3).
//
// "low" was added by `ai-d` for ONE caller, and the distinction is worth keeping sharp: the
// filter resolver is vocabulary-matching a phrase against a fixed enum, not making a judgment
// about a ward. Nothing it produces reaches a person as prose, and the panel it feeds has to
// stay responsive under typing. Every call that WRITES something a human will read stays at
// medium or high — do not reach for "low" to make a drafting call cheaper.
export type AiEffort = "low" | "medium" | "high";

export type CallClaudeParams = {
  system: Anthropic.TextBlockParam[];
  userPrompt: string;
  effort: AiEffort;
  maxTokens: number;
};

export type ClaudeUsage = {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type ClaudeTextResult = ClaudeUsage & { text: string };

let cachedClient: Anthropic | null = null;

// Read explicitly rather than letting the SDK resolve it. The SDK's own error for an absent key
// is not something a bishop can act on, and this is the difference between "AI is not set up yet"
// and a stack trace. The key itself is never logged and never travels on an error `cause`.
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new AiRequestError("not_configured");
  }

  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

function readUsage(usage: Anthropic.Usage): ClaudeUsage {
  // The four counters exist so the caching pitfall is OBSERVABLE. `cacheReadTokens` staying 0
  // across calls with an identical stable prefix is the documented symptom of something volatile
  // sitting above the breakpoint — see lib/ai/systemPrompt.ts.
  return {
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

// `stop_details` is populated ONLY when stop_reason is "refusal" and is null for every other stop
// reason, so it is guarded rather than asserted. The category is logged server-side and never
// shown: it names a safety classifier, which tells a bishopric nothing useful and invites
// guesswork about what tripped it.
function assertUsableStop(response: Anthropic.Message): void {
  if (response.stop_reason === "refusal") {
    console.error(
      `Claude refused the request — category ${response.stop_details?.category ?? "unknown"}`,
    );
    throw new AiRequestError("refused");
  }

  // A truncated draft is worse than no draft: it LOOKS finished, and somebody sends it.
  if (response.stop_reason === "max_tokens") {
    throw new AiRequestError("truncated");
  }
}

// response.content is a discriminated union; narrowing on block.type is required before reading
// .text, not a style choice.
function readText(response: Anthropic.Message): string {
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (text.trim() === "") {
    throw new AiRequestError("invalid_request");
  }

  return text;
}

// Most specific first. Never string-match a message — the SDK exports typed classes for exactly
// this. The SDK ALREADY retries twice on 429/5xx/connection errors, so by the time a
// RateLimitError reaches here it has already backed off; do not add a retry loop on top.
//
// The unknown case is RETHROWN untouched. Folding it into `invalid_request` would tell the user
// "nothing was saved" without knowing whether that is true, and would hide a real bug behind a
// sentence that reads like a handled failure.
function translateError(error: unknown): never {
  if (error instanceof AiRequestError) throw error;

  if (error instanceof Anthropic.AuthenticationError) {
    throw new AiRequestError("not_configured", undefined, error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    throw new AiRequestError("rate_limited", undefined, error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    throw new AiRequestError("unavailable", undefined, error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    throw new AiRequestError("invalid_request", undefined, error);
  }
  if (error instanceof Anthropic.APIError) {
    throw new AiRequestError(
      error.status !== undefined && error.status >= 500 ? "unavailable" : "invalid_request",
      undefined,
      error,
    );
  }

  throw error;
}

// `thinking: { type: "adaptive" }` — budget_tokens is REMOVED on this model and sending it is a
// 400. `display` defaults to "omitted" here, which is what we want: this app never surfaces
// reasoning to a user.
//
// `effort` is nested inside `output_config`, never top-level.
//
// There is no assistant prefill anywhere in this file. It is a 400 on this model; output shape
// comes from the system prompt or from output_config.format.
export async function callClaude(params: CallClaudeParams): Promise<ClaudeTextResult> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: params.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: params.effort },
      system: params.system,
      messages: [{ role: "user", content: params.userPrompt }],
    });

    assertUsableStop(response);

    return { text: readText(response), ...readUsage(response.usage) };
  } catch (error) {
    translateError(error);
  }
}

// Nothing in ai-a calls this. It exists so ai-c inherits the same error contract rather than
// inventing a second one, and so the two functions cannot drift on which errors they translate.
export async function callClaudeStructured<Parsed>(
  params: CallClaudeParams & { format: AutoParseableOutputFormat<Parsed> },
): Promise<ClaudeUsage & { parsed: Parsed }> {
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: params.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: params.effort, format: params.format },
      system: params.system,
      messages: [{ role: "user", content: params.userPrompt }],
    });

    assertUsableStop(response);

    // parsed_output is NULL when parsing failed. A null parse is a schema mismatch, not an
    // answer, so it is guarded rather than asserted.
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new AiRequestError("invalid_request");
    }

    return { parsed: response.parsed_output, ...readUsage(response.usage) };
  } catch (error) {
    translateError(error);
  }
}
