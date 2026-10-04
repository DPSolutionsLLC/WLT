import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { submitMusic } from "@/lib/music/musicReview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MusicLinkWriteError } from "@/lib/todos/musicLinks";

// SUBMITTING A SUNDAY'S MUSIC FOR REVIEW — ITER-038 slice mb (lib/music/musicReview.ts holds the
// rules). `music.manage`, the boundary every music write sits behind. No body: what is submitted is
// the music as it stands.
//
// The conductor gets "Review the music for …" on their To Do, and every open "Choose the music"
// closes. Pressing it again on submitted music finishes a half-run and tells nobody twice.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const PARTLY_SENT =
  "The music could not be sent to the conductor in full. Press Submit again — nothing will be sent twice.";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "music.manage", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);

    let outcome;
    try {
      outcome = await submitMusic({
        wardId: user.wardId,
        sundayId,
        actingUserId: user.id,
        client: supabase,
      });
    } catch (error) {
      if (!(error instanceof MusicLinkWriteError)) throw error;
      console.error("POST /api/sundays/[id]/music/submit wrote only some to-dos", {
        wardId: user.wardId,
        sundayId,
        cause: error.cause,
      });
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_music_submitted",
          module: "music",
          detail: { sundayId, todoIds: [...error.completedIds], incomplete: true },
        },
        supabase,
      );
      return NextResponse.json({ error: PARTLY_SENT }, { status: 500 });
    }

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    if (!outcome.alreadySubmitted) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_music_submitted",
          module: "music",
          detail: {
            sundayId,
            date: outcome.sunday.date,
            reviewTodoId: outcome.reviewTodoId,
            completedTodoIds: outcome.completedChooseIds,
          },
        },
        supabase,
      );
    }

    return NextResponse.json({
      sundayMusic: outcome.sundayMusic,
      conductorName: outcome.conductorName,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays/[id]/music/submit",
      fallbackMessage: "Could not submit the music. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
