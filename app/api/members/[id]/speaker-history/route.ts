import { NextResponse } from "next/server";
import { z } from "zod";
import { listSpeakerHistory } from "@/lib/assignments/queries";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/errors";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Role } from "@/types/domain";

// A SEPARATE CALL, deliberately. Speaker history is never a field on `GET /api/members` or on the
// shared member type — a field on a shared type is one refactor away from a response a
// non-bishopric caller receives, which is the phase's stated pitfall and CLAUDE.md rule 9 in
// reverse. SPEC.md §API Routes records this route for the same reason talks-a recorded
// /api/assignment-comments: it is a route the spec did not list.
//
// THREE boundaries, in order of who really enforces what:
//   1. `assignment_history` is bishopric-only in migration 019. That is the real one — a
//      secretary who bypassed this handler entirely would still read zero rows.
//   2. talks.view is the module gate. music_coordinator and ward_secretary both hold it.
//   3. The bishopric check is the leak defence, and it is what turns a silent empty array into
//      an honest 403. Without it, a secretary asking this question would be told "no history"
//      rather than "not your question" — and an empty array reads as a member who has never
//      spoken.
//
// No audit row. writeAuditLog is for mutations (CLAUDE.md rule 6), and a read that logged would
// put every profile a bishop opened into a table the whole bishopric reads.

const memberIdSchema = z.uuid("That member id is not valid.");

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.view", roleAccess);

    // Not overridable by `wards.settings.role_access`, and that is on purpose. A ward can widen
    // talks.view; it cannot make somebody bishopric, because the RLS policy behind this data
    // asks `is_bishopric()` and no setting changes that answer.
    if (!isBishopric(user.role)) {
      throw new ForbiddenError("talks.view (bishopric only)");
    }

    const { id } = await params;
    const memberId = memberIdSchema.parse(id);

    const history = await listSpeakerHistory(user.wardId, memberId, supabase);

    return NextResponse.json({ history });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/members/[id]/speaker-history",
      fallbackMessage: "Could not load that speaking history. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
