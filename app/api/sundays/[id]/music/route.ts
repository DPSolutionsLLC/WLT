import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { reopenMusicAfterWrite } from "@/lib/music/musicReview";
import { getSundayMusic, upsertSundayMusicPeople } from "@/lib/music/sundayMusic";
import { getMember } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sundayMusicPeopleSchema } from "@/lib/validation/music";
import { holdsSacramentMeeting } from "@/types/domain";

// A SUNDAY'S CHORISTER AND ORGANIST — ITER-038 slice ma, migration 089a.
//
// `music.manage`, the same boundary every other music write sits behind. The table has no write
// policy, so the write itself is the service role (lib/music/sundayMusic.ts) — which makes the
// checks below the WHOLE guard rather than a courtesy in front of RLS:
//
//   - the Sunday is read through the CALLER's client, so a Sunday in another ward is a 404;
//   - a member id is read through the caller's client too, so a member of another ward is a 400.
//     That is the subject check CLAUDE.md §7 asks for ("an author is not a subject"): the id comes
//     from a request body, and the composite key would only turn a stranger into a 500.
//
// The audit row says WHICH people changed, never their names (CLAUDE.md rule 8's instinct, as
// musical_number_logged does).

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NOT_ON_ROSTER = "That person isn't on your ward's roster.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "music.manage", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = sundayMusicPeopleSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, sundayId, supabase);
    if (sunday === null) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    if (!holdsSacramentMeeting(sunday.type)) {
      return NextResponse.json(
        { error: "That Sunday holds no sacrament meeting, so there is no music to lead." },
        { status: 422 },
      );
    }

    const memberIds = [input.chorister, input.organist].flatMap((person) =>
      person !== null && person !== undefined && "memberId" in person ? [person.memberId] : [],
    );
    const members = await Promise.all(
      memberIds.map((memberId) => getMember(user.wardId, memberId, supabase)),
    );
    if (members.some((member) => member === null)) {
      return NextResponse.json({ error: NOT_ON_ROSTER }, { status: 400 });
    }

    const sundayMusic = await upsertSundayMusicPeople({
      wardId: user.wardId,
      sundayId,
      chorister: input.chorister,
      organist: input.organist,
    });

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "sunday_music_people_updated",
        module: "music",
        detail: {
          sundayId,
          date: sunday.date,
          changedFields: [
            ...(input.chorister !== undefined ? ["chorister"] : []),
            ...(input.organist !== undefined ? ["organist"] : []),
          ],
        },
      },
      supabase,
    );

    // A SUBMITTED OR APPROVED SUNDAY GOES BACK TO DRAFT (ITER-038 mb), and the answer carries the
    // row as it is after that, so the card shows the reopened state.
    const reopen = await reopenMusicAfterWrite({ wardId: user.wardId, sundayId });
    const current = reopen.reopened
      ? await getSundayMusic(user.wardId, sundayId, supabase)
      : sundayMusic;
    return NextResponse.json({ sundayMusic: current, ...reopen });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/music",
      fallbackMessage: "Could not save the chorister or organist. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
