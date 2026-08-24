import { NextResponse } from "next/server";
import { MESSAGE_MAX_TOKENS, callClaude } from "@/lib/ai/client";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { previewRequestSchema } from "@/lib/validation/aiSettings";
import type { AiSettings } from "@/types/domain";

// The feature the AI Settings panel exists for: it accepts DRAFT settings in the request body and
// WRITES NOTHING. A bishopric reads real Claude output in the tone they are considering, before
// committing to it.
//
// THIS ROUTE MUST NOT TOUCH `ai_settings`. No select, no insert. tests/routes/ai-settings.test.ts
// asserts that structurally by counting rows either side of a preview, including a preview that
// throws.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `.manage`, not `.view`. A preview spends money and sends ward text to a third-party vendor.
    // That is the authority to CHANGE the settings, not the authority to read them.
    assertCan(user, "ai_settings.manage", roleAccess);

    const input = previewRequestSchema.parse(await readJsonBody(request));

    // Shaped into an AiSettings-like object IN MEMORY ONLY. The sentinel id and empty createdAt
    // exist so nothing downstream can mistake this for a row that was saved.
    const draft: AiSettings = {
      ...input.settings,
      id: "draft",
      savedBy: null,
      createdAt: "",
    };

    // No retrievedChunks, so layer 3 is absent — a legitimate, testable state. `ai-b` is where a
    // preview starts retrieving; the branch and its interface already ship here.
    const system = buildSystemPrompt({ settings: draft, module: "settings_preview" });

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps it to
    // its own status and its own written sentence. Catching it here is how the silent-AI-failure
    // pitfall starts.
    const result = await callClaude({
      system,
      userPrompt: input.prompt,
      effort: "medium",
      maxTokens: MESSAGE_MAX_TOKENS,
    });

    // Rule 6 is about mutations, and this mutates nothing. It is logged anyway because it is an
    // outbound call to a vendor on the ward's behalf, and a spend with no record is not something
    // an audit log should be silent about. NEVER the prompt text and NEVER the output.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "ai_preview_run",
        module: "ai",
        detail: {
          promptLength: input.prompt.length,
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    // Usage is surfaced deliberately: this is the only place a human can watch the cache work.
    return NextResponse.json({
      draft: result.text,
      usage: {
        cacheReadTokens: result.cacheReadTokens,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/ai-settings/preview",
      fallbackMessage: "Could not run the preview. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
