// @vitest-environment node
//
// Phase 5 tests **settings-versioning** and **no-autosave**, over the five /api/ai-settings
// routes. Two claims:
//
//   SAVING APPENDS. Restoring appends. NOTHING in this feature can destroy a version.
//   A PREVIEW WRITES NOTHING — not on success, and not when the AI call fails.
//
// Every claim is checked by RE-READING with the service client rather than trusting the JSON a
// route handed back: a route can report a row it did not write, and a route that wrote two would
// report one.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

// The ONLY thing stubbed beyond the client factory. Calling the real Claude API from a test would
// spend money on every run and make the suite fail when a network is unavailable — and the
// preview route's contract here is what it does to the DATABASE, which is nothing.
//
// callClaudeStructured is stubbed too so the module's shape stays honest; nothing calls it yet.
const callClaude = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: (...args: unknown[]) => callClaude(...args),
    callClaudeStructured: vi.fn(),
  };
});

const CLAUDE_RESULT = {
  text: "A short sample draft.",
  cacheReadTokens: 0,
  cacheCreationTokens: 512,
  inputTokens: 900,
  outputTokens: 40,
};

function settingsBody(overrides: Record<string, unknown> = {}) {
  return {
    toneVoice: "Warm and brief.",
    doctrinalEmphasis: null,
    scripturePreferences: {
      canonPriority: ["book_of_mormon"],
      maxReferences: 2,
      relevanceNotes: null,
    },
    conferencePreferences: { maxYearsOld: null, maxTalks: 1, preferKnowledgeBase: true },
    topicPreferences: null,
    wardContext: null,
    thankYouPreferences: null,
    ...overrides,
  };
}

async function callGet() {
  const { GET } = await import("@/app/api/ai-settings/route");
  return readResponse(await GET());
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/ai-settings/route");
  const request = jsonRequest("http://localhost/api/ai-settings", { method: "POST", body });
  return readResponse(await POST(request));
}

async function callHistory() {
  const { GET } = await import("@/app/api/ai-settings/history/route");
  return readResponse(await GET());
}

async function callRestore(id: string) {
  const { POST } = await import("@/app/api/ai-settings/restore/[id]/route");
  const request = jsonRequest(`http://localhost/api/ai-settings/restore/${id}`, {
    method: "POST",
  });
  // params is a Promise in Next 16.
  return readResponse(await POST(request, { params: Promise.resolve({ id }) }));
}

async function callPreview(body: unknown) {
  const { POST } = await import("@/app/api/ai-settings/preview/route");
  const request = jsonRequest("http://localhost/api/ai-settings/preview", {
    method: "POST",
    body,
  });
  return readResponse(await POST(request));
}

describe("/api/ai-settings", () => {
  let fixtures: Fixtures;

  async function countSettings(wardId: string): Promise<number> {
    const { count, error } = await fixtures.service
      .from("ai_settings")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);

    if (error) throw new Error(`Could not count ai_settings: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary", "wardBBishop"]);
    callClaude.mockResolvedValue(CLAUDE_RESULT);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("versioning", () => {
    it("appends a version on every save and keeps both readable", async () => {
      await actAs(fixtures, "bishop");

      const first = await callPost(settingsBody({ toneVoice: "First tone." }));
      expect(first.status).toBe(200);

      const second = await callPost(settingsBody({ toneVoice: "Second tone." }));
      expect(second.status).toBe(200);

      const history = await callHistory();
      expect(history.status).toBe(200);

      const versions = history.body.versions as Array<Record<string, unknown>>;
      expect(versions).toHaveLength(2);
      // Newest first.
      expect(versions[0].toneVoice).toBe("Second tone.");
      expect(versions[1].toneVoice).toBe("First tone.");
      expect(versions[0].savedByName).toBeTruthy();

      // The ACTIVE version is the latest — and the id tie-break matters, because these two saves
      // can land inside the same second.
      const active = await callGet();
      expect(active.status).toBe(200);
      expect((active.body.settings as Record<string, unknown>).toneVoice).toBe("Second tone.");
    });

    // The "history is never destroyed" assertion. Restore APPENDS a third row rather than
    // deleting the second.
    it("restores by appending, leaving the newer version in place", async () => {
      await actAs(fixtures, "bishop");
      const history = await callHistory();
      const versions = history.body.versions as Array<Record<string, unknown>>;
      const oldest = versions[versions.length - 1];

      const before = await countSettings(fixtures.wardAId);

      // A counselor restores what the bishop saved: bishopric authority is shared (CLAUDE.md §7).
      await actAs(fixtures, "counselor1");
      const restored = await callRestore(oldest.id as string);
      expect(restored.status).toBe(200);

      expect(await countSettings(fixtures.wardAId)).toBe(before + 1);

      const after = await callHistory();
      const afterVersions = after.body.versions as Array<Record<string, unknown>>;

      expect(afterVersions).toHaveLength(before + 1);
      // Newest matches the restored version's CONTENT but is a different row, saved by whoever
      // pressed restore.
      expect(afterVersions[0].toneVoice).toBe(oldest.toneVoice);
      expect(afterVersions[0].id).not.toBe(oldest.id);
      expect(afterVersions[0].savedBy).toBe(fixtures.user("counselor1").id);
      // The version that was active before the restore is still there.
      expect(
        afterVersions.some((version) => version.id === versions[0].id),
        "restoring destroyed the version it replaced",
      ).toBe(true);
    });

    it("returns null settings for a ward that has never saved", async () => {
      await actAs(fixtures, "wardBBishop");

      const { status, body } = await callGet();

      expect(status).toBe(200);
      expect(body.settings).toBeNull();
    });

    it("refuses to restore a version from another ward and writes nothing", async () => {
      const { data: foreign, error } = await fixtures.service
        .from("ai_settings")
        .insert({ ward_id: fixtures.wardBId, tone_voice: `Ward B ${fixtures.runId}` })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await actAs(fixtures, "bishop");
      const before = await countSettings(fixtures.wardAId);

      const { status, body } = await callRestore(foreign.id);

      expect(status).toBe(404);
      // Never leak whether the id exists somewhere else.
      expect(errorMessage(body)).toBe("That version is not in your ward.");
      expect(await countSettings(fixtures.wardAId)).toBe(before);
    });

    it("refuses a save that fails validation, with the schema's own sentence", async () => {
      await actAs(fixtures, "bishop");
      const before = await countSettings(fixtures.wardAId);

      const { status, body } = await callPost(
        settingsBody({
          scripturePreferences: {
            canonPriority: ["book_of_mormon", "book_of_mormon"],
            maxReferences: 2,
            relevanceNotes: null,
          },
        }),
      );

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("List each book of scripture only once.");
      expect(await countSettings(fixtures.wardAId)).toBe(before);
    });
  });

  describe("permissions", () => {
    // ai_settings.* is bishopric-only in lib/auth/permissions.ts — checked against the matrix, not
    // assumed. ward_secretary holds calendar.manage and agendas.publish but nothing here.
    it("refuses ward_secretary on GET, POST and preview", async () => {
      // Cleared rather than relying on test order: the "no spend" assertion below is only
      // meaningful about THIS request.
      callClaude.mockClear();
      await actAs(fixtures, "wardSecretary");

      const read = await callGet();
      expect(read.status).toBe(403);

      const write = await callPost(settingsBody());
      expect(write.status).toBe(403);

      const preview = await callPreview({ settings: settingsBody(), prompt: "Hello." });
      expect(preview.status).toBe(403);
      // The refusal happened before any spend.
      expect(callClaude).not.toHaveBeenCalled();
    });

    it("refuses ward_secretary the history", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status } = await callHistory();

      expect(status).toBe(403);
    });
  });

  describe("preview", () => {
    // NO-AUTOSAVE. The whole point of the panel is that it runs against unsaved settings, so the
    // route must not write one — on success or on failure.
    it("writes nothing to ai_settings on a successful preview", async () => {
      callClaude.mockReset();
      callClaude.mockResolvedValue(CLAUDE_RESULT);

      await actAs(fixtures, "bishop");
      const before = await countSettings(fixtures.wardAId);

      const { status, body } = await callPreview({
        settings: settingsBody({ toneVoice: "Never saved anywhere." }),
        prompt: "Ask a member to speak about faith.",
      });

      expect(status).toBe(200);
      expect(body.draft).toBe(CLAUDE_RESULT.text);
      expect(body.usage).toEqual({
        cacheReadTokens: 0,
        inputTokens: 900,
        outputTokens: 40,
      });

      expect(await countSettings(fixtures.wardAId)).toBe(before);

      // And the draft never reached the database in any form.
      const { data } = await fixtures.service
        .from("ai_settings")
        .select("tone_voice")
        .eq("ward_id", fixtures.wardAId)
        .eq("tone_voice", "Never saved anywhere.");

      expect(data).toEqual([]);
    });

    it("builds the system prompt from the DRAFT in the body, not from the saved row", async () => {
      callClaude.mockReset();
      callClaude.mockResolvedValue(CLAUDE_RESULT);

      await actAs(fixtures, "bishop");

      await callPreview({
        settings: settingsBody({ toneVoice: "A tone that exists only in this request." }),
        prompt: "Say hello.",
      });

      const params = callClaude.mock.calls[0][0] as {
        system: Array<{ text: string; cache_control?: unknown }>;
        effort: string;
      };

      expect(params.effort).toBe("medium");
      expect(params.system[0].text).toContain("only in this request");
      // Two blocks: no retrieved chunks in ai-a, and the breakpoint is on the last one.
      expect(params.system).toHaveLength(2);
      expect(params.system[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("writes nothing when the AI call fails, and surfaces the written message", async () => {
      const { AiRequestError } = await import("@/lib/ai/errors");

      callClaude.mockReset();
      callClaude.mockRejectedValue(new AiRequestError("rate_limited"));

      await actAs(fixtures, "bishop");
      const before = await countSettings(fixtures.wardAId);

      const { status, body } = await callPreview({
        settings: settingsBody(),
        prompt: "Ask a member to speak.",
      });

      // 429, from AiRequestError's own status table — not the 500 fallback.
      expect(status).toBe(429);
      expect(errorMessage(body)).toContain("nothing was lost");
      expect(await countSettings(fixtures.wardAId)).toBe(before);
    });

    it("maps a missing key to its own status and its own sentence", async () => {
      const { AiRequestError } = await import("@/lib/ai/errors");

      callClaude.mockReset();
      callClaude.mockRejectedValue(new AiRequestError("not_configured"));

      await actAs(fixtures, "bishop");

      const { status, body } = await callPreview({
        settings: settingsBody(),
        prompt: "Ask a member to speak.",
      });

      expect(status).toBe(503);
      expect(errorMessage(body)).toContain("Anthropic API key");
    });

    it("refuses an empty prompt before spending anything", async () => {
      callClaude.mockReset();
      callClaude.mockResolvedValue(CLAUDE_RESULT);

      await actAs(fixtures, "bishop");

      const { status, body } = await callPreview({ settings: settingsBody(), prompt: "  " });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Type something for the preview to respond to.");
      expect(callClaude).not.toHaveBeenCalled();
    });
  });
});
