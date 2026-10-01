import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { loadSundayAsks } from "@/lib/sacrament/sundayAsks";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// A SUNDAY'S ASK STATE — Sacrament slice f1. GET is the same value the hub's Talks pill shows.
//
// There is NO POST any more (ITER-036). "Send asks" was replaced by finalizing the speakers, which
// is PATCH /api/sundays/[id]/speakers-finalized (lib/sacrament/finalizePeople.ts holds the body
// that used to live here).
//
// `talks.request`, which only the bishopric holds.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.request", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);

    const loaded = await loadSundayAsks(user.wardId, sundayId, supabase);
    if (loaded === null) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    return NextResponse.json({ ...loaded.stateInput, state: loaded.state });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays/[id]/asks",
      fallbackMessage: "Could not load this Sunday's asks. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
