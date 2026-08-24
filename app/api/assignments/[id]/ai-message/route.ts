import { NextResponse } from "next/server";
import { MESSAGE_MAX_TOKENS, callClaude } from "@/lib/ai/client";
import { buildConfirmationPrompt, buildThankYouPrompt } from "@/lib/ai/messageDrafts";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { retrieveChunks } from "@/lib/ai/retrieve";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { getAssignment, listComments } from "@/lib/assignments/queries";
import { speakerFrom } from "@/lib/assignments/speaker";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { getMember } from "@/lib/roster/queries";
import { getTopic } from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aiMessageSchema, type AiMessageType } from "@/lib/validation/aiRequests";
import type { KnownPermission } from "@/lib/auth/permissions";

// Drafting a confirmation or thank-you message. THIS ROUTE WRITES NOTHING TO `assignments`.
//
// Not `notify_message`, not `thank_you_message`, not the stage. The draft is returned as plain
// text, it lands in the same textarea buildConfirmationMessage and buildThankYouMessage already
// fill, and the existing approve buttons remain the only thing that saves anything
// (CLAUDE.md rule 3). tests/routes/ai-message.test.ts re-reads both columns after a draft — and
// after one the user then abandons — to assert exactly that.
//
// params is a Promise in Next 16 (plans/retros/route-tests-and-realtime.md).

const NOT_FOUND = "That assignment is not in your ward.";

// ITER-004's entire point is that a waived speaker's contact stages are NOT outstanding work.
// The panel says so three inches from where this button would sit, and offering to draft a
// message for one contradicts it.
const WAIVED =
  "This speaker was invited outside the ward and is not being contacted.";

const NO_SUNDAY =
  "That assignment is not on a Sunday yet, so there is no date to write about.";

// A thank-you built from nothing is a form letter, and by the appreciate stage somebody has
// almost certainly thanked the speaker in person already — a generic text afterwards subtracts
// from that rather than adding to it. So this refuses rather than generating one.
//
// It also stops the spend. The panel does not offer the button in this state, and this is the
// same belt-and-braces the waiver above gets: the UI declining to show a control is not the same
// as the route declining to act on it.
const NOTHING_TO_SAY =
  "Nobody has recorded anything about this talk, so there is nothing specific to write. " +
  "Add a comment on the assignment first.";

// The permission for each draft matches the gate on the textarea it fills. ContactStagePanel
// shows the CONFIRM textarea behind `canConfirm` and the APPRECIATE one behind `canPlan`; gating
// the AI button any wider would let somebody who cannot approve a message still generate one —
// an outbound vendor call and a spend by a person with no authority over the result.
const PERMISSION_FOR: Record<AiMessageType, KnownPermission> = {
  confirmation: "talks.confirm",
  thank_you: "talks.plan",
};

const MODULE_FOR: Record<AiMessageType, "confirmation_message" | "thank_you_message"> = {
  confirmation: "confirmation_message",
  thank_you: "thank_you_message",
};

// Only a member has a first name on file. An external speaker's name is one typed string, so the
// first word is the best available answer — and speakerFrom() is the one place that decides which
// kind of speaker this is (lib/assignments/speaker.ts).
const RETRIEVAL_LIMIT = 6;

export type AiMessageRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: AiMessageRouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    const { id: assignmentId } = await context.params;
    const input = aiMessageSchema.parse(await readJsonBody(request));

    assertCan(user, PERMISSION_FOR[input.type], roleAccess);

    const assignment = await getAssignment(user.wardId, assignmentId, supabase);

    // An assignment in another ward and one RLS refused are indistinguishable here, and both
    // mean "not yours" (plans/retros/foundation-c-services.md).
    if (!assignment) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // 409, not 400 — the request was well formed; the assignment's STATE is what refuses. Placed
    // BEFORE anything is loaded or embedded so a waived assignment costs nothing.
    if (assignment.contactWaivedAt !== null) {
      return NextResponse.json({ error: WAIVED }, { status: 409 });
    }

    if (assignment.sundayId === null) {
      return NextResponse.json({ error: NO_SUNDAY }, { status: 409 });
    }

    const [settings, sunday] = await Promise.all([
      getActiveAiSettings(user.wardId, supabase),
      getSunday(user.wardId, assignment.sundayId, supabase),
    ]);

    if (!sunday) {
      return NextResponse.json({ error: NO_SUNDAY }, { status: 409 });
    }

    const speaker = speakerFrom(assignment);

    const speakerFirstName =
      speaker.kind === "member"
        ? ((await getMember(user.wardId, speaker.memberId, supabase))?.firstName ?? null)
        : speaker.kind === "external"
          ? (speaker.name.split(" ")[0] ?? null)
          : null;

    // Built as the SAME input object the template takes, so the two are interchangeable sources
    // for one textarea (lib/ai/messageDrafts.ts).
    let userPrompt: string;
    let retrievedChunks: Awaited<ReturnType<typeof retrieveChunks>> = [];

    if (input.type === "confirmation") {
      const topic =
        assignment.topicId === null
          ? null
          : await getTopic(user.wardId, assignment.topicId, supabase);

      const suggestedScriptures = topic?.suggestedScriptures ?? [];

      // Retrieval ONLY for a confirmation, and only when there is a topic. A confirmation naming
      // a scripture the speaker can prepare from is better with the corpus behind it; a thank-you
      // for a talk that already happened is about what the bishopric observed, and retrieved
      // doctrine makes it preachy.
      if (topic !== null) {
        retrievedChunks = await retrieveChunks(topic.title, user.wardId, {
          limit: RETRIEVAL_LIMIT,
          client: supabase,
        });
      }

      userPrompt = buildConfirmationPrompt({
        speakerFirstName,
        date: sunday.date,
        topicTitle: topic?.title ?? null,
        slotLengthMinutes: assignment.slotLengthMinutes,
        suggestedScriptures,
      });
    } else {
      // The assignment's own comment thread — where a bishopric member writes "he talked about
      // his mission and the room went completely quiet". Oldest first, which is the order
      // listComments returns, so the prompt reads chronologically.
      const comments = await listComments(
        user.wardId,
        { assignmentId: assignment.id },
        supabase,
      );

      const observations = comments
        .map((comment) => comment.comment.trim())
        .filter((comment) => comment !== "");

      // Refused BEFORE the outbound call, so an unwanted draft costs nothing.
      if (observations.length === 0) {
        return NextResponse.json({ error: NOTHING_TO_SAY }, { status: 409 });
      }

      userPrompt = buildThankYouPrompt({
        speakerFirstName,
        date: sunday.date,
        comments: observations,
      });
    }

    const system = buildSystemPrompt({
      settings,
      module: MODULE_FOR[input.type],
      retrievedChunks,
    });

    // No try/catch. An AiRequestError reaches respondToRouteError, which maps it to its own
    // status and its own written sentence — six distinguishable failures, not one.
    const result = await callClaude({
      system,
      userPrompt,
      effort: "medium",
      maxTokens: MESSAGE_MAX_TOKENS,
    });

    // Rule 6 is about mutations and this mutates nothing, but it is an outbound call to a vendor
    // on the ward's behalf and a spend with no record is not something an audit log should be
    // silent about. NEVER the message text and never the comments it was built from.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "ai_message_drafted",
        module: "talks",
        detail: {
          assignmentId: assignment.id,
          type: input.type,
          retrievedChunks: retrievedChunks.length,
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    return NextResponse.json({ draft: result.text });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/assignments/[id]/ai-message",
      fallbackMessage: "Could not draft that message. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
