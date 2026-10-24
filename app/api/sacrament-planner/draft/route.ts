import { NextResponse } from "next/server";
import { z } from "zod";
import { MESSAGE_MAX_TOKENS, callClaude } from "@/lib/ai/client";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assertPlannerAccess } from "@/lib/sacramentPlanner/access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// "Write it fresh with Claude" in the Sacrament Planner (ITER-045). The prompt is built by the
// Planner, unchanged — it carries its own instructions and the facts as JSON.
//
// RULE 3 HOLDS. The text comes back into a textarea the person edits and copies themselves.
// Nothing is stored and nothing is sent; the draft never touches a row.

const draftRequestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "There is nothing to write about yet.")
    .max(8000, "That request is too long to send to Claude."),
});

const DRAFT_SYSTEM_PROMPT =
  "You write messages for a ward bishopric. Return only the message text.";

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertPlannerAccess(user, roleAccess);

    const input = draftRequestSchema.parse(await readJsonBody(request));

    // No try/catch: an AiRequestError reaches respondToRouteError with its own status and sentence.
    const result = await callClaude({
      system: [{ type: "text", text: DRAFT_SYSTEM_PROMPT }],
      userPrompt: input.prompt,
      effort: "medium",
      maxTokens: MESSAGE_MAX_TOKENS,
    });

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "planner.draft_written",
        module: "sacrament",
        detail: { outputTokens: result.outputTokens },
      },
      supabase,
    );

    return NextResponse.json({ text: result.text });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sacrament-planner/draft",
      fallbackMessage: "Could not write that message. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
