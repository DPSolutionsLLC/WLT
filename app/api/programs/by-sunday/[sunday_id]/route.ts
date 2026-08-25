import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getProgramBySunday } from "@/lib/program/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { programSundayIdSchema } from "@/lib/validation/program";

// The stored draft for one Sunday.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS SITS UNDER by-sunday/ AND NOT AT /api/programs/[sunday_id]
// ---------------------------------------------------------------------------------------------
// SPEC.md originally listed this route as GET /api/programs/[sunday_id], beside
// POST /api/programs/[id]/approve. Next.js refuses to build with two differently-named dynamic
// segments as siblings — "You cannot use different slug names for the same dynamic path
// ('id' !== 'sunday_id')" — so one of the two names had to move.
//
// A static `by-sunday` segment is legal beside `[id]`, and it says out loud which kind of id the
// handler takes. The alternative was to reuse `[id]` for both meanings, which would have left one
// folder name standing for a SUNDAY id here and a PROGRAM id in its sibling directories: a trap
// with nothing but a comment to catch it. SPEC.md §Programs records the path.
//
// ---------------------------------------------------------------------------------------------
// `missing` COMES FROM THE STORED DRAFT
// ---------------------------------------------------------------------------------------------
// Never from a fresh assembly. Recomputing it on read would make the snapshot a live view again
// through the back door — the program would quietly stop reporting a gap the moment somebody
// filled it upstream, without anybody choosing to take that change.
//
// ---------------------------------------------------------------------------------------------
// music_coordinator CANNOT REACH THIS ROUTE, AND THAT IS LEFT ALONE
// ---------------------------------------------------------------------------------------------
// 06-program-music.md lists this route's readers as "secretary + bishopric + music", but
// music_coordinator holds music.view and music.manage rather than program.view
// (lib/auth/permissions.ts). program.view is NOT widened to fix that: the music coordinator's
// screen is program-e's /music page, which shows Sundays, topics and hymn selections. Whether
// they also need the assembled program is a product question, not a matrix typo.

const NOT_FOUND = "There is no program for that Sunday yet.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sunday_id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { sunday_id: rawSundayId } = await params;
    const sundayId = programSundayIdSchema.parse(rawSundayId);

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "program.view", roleAccess);

    const program = await getProgramBySunday(user.wardId, sundayId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // draftError is surfaced rather than swallowed. A program whose stored jsonb no longer parses
    // is unusable, and reporting it as an empty draft would look like it was never built.
    return NextResponse.json({
      program,
      missing: program.draft?.missing ?? [],
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/programs/by-sunday/[sunday_id]",
      fallbackMessage: "Could not read that program. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
