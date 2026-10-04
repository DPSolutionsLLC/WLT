import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { approveMusic, returnMusic } from "@/lib/music/musicReview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MusicLinkWriteError } from "@/lib/todos/musicLinks";
import { musicReviewSchema } from "@/lib/validation/music";

// THE CONDUCTOR'S DECISION ON SUBMITTED MUSIC — ITER-038 slice mb (lib/music/musicReview.ts).
//
// `topics.manage`, which only the bishopric holds — NOT "is the conductor". The review to-do is
// routed to the conductor, but bishopric authority is shared (CLAUDE.md §7: never grant the bishop
// something a counselor lacks), so any of the three may decide (plan A2). Nobody decides on music
// they submitted themselves (A3).
//
// Two audit actions, the topics-finalized precedent. A send-back records THAT a note was written,
// never the note — writeAuditLog() blanks any key containing "note", and the note's durable home is
// the coordinator's to-do timeline.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const PARTLY_APPROVED =
  "The music is approved, but the conductor's review to-do could not be closed. Press Approve again.";
const PARTLY_RETURNED =
  "The music was sent back and your note is on the Music page, but the coordinator's to-do could not be reopened. Let them know directly.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "topics.manage", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = musicReviewSchema.parse(await readJsonBody(request));
    const base = { wardId: user.wardId, sundayId, actingUserId: user.id, client: supabase };

    let outcome;
    try {
      outcome =
        input.decision === "approve"
          ? await approveMusic(base)
          : await returnMusic({ ...base, note: input.note });
    } catch (error) {
      if (!(error instanceof MusicLinkWriteError)) throw error;
      console.error("POST /api/sundays/[id]/music/review updated only some to-dos", {
        wardId: user.wardId,
        sundayId,
        decision: input.decision,
        cause: error.cause,
      });
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: input.decision === "approve" ? "sunday_music_approved" : "sunday_music_sent_back",
          module: "music",
          detail: {
            sundayId,
            todoIds: [...error.completedIds],
            incomplete: true,
            ...(input.decision === "return" ? { returnedWithMessage: true } : {}),
          },
        },
        supabase,
      );
      return NextResponse.json(
        { error: input.decision === "approve" ? PARTLY_APPROVED : PARTLY_RETURNED },
        { status: 500 },
      );
    }

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.decision === "approve" ? "sunday_music_approved" : "sunday_music_sent_back",
        module: "music",
        detail: {
          sundayId,
          date: outcome.sunday.date,
          todoIds: outcome.todoIds,
          ...(input.decision === "return" ? { returnedWithMessage: true } : {}),
        },
      },
      supabase,
    );

    return NextResponse.json({ sundayMusic: outcome.sundayMusic });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays/[id]/music/review",
      fallbackMessage: "Could not save your decision on the music. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
