import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readVisitProgress } from "@/lib/visits/progress";
import type { Role } from "@/types/domain";

// The progress dashboard's read.
//
// NO AUDIT ROW. This is a read, and CLAUDE.md rule 6 asks for one on every mutation.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — see the header of
// app/api/visits/route.ts. The response is built from VisitProgress, which has no field a
// private note could occupy.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const querySchema = z.object({
  // Parsed with EXACTLY the name VisitProgressTable sends, checked against that file rather than
  // assumed. A parameter this schema does not carry gets no error, just a filter that is silently
  // ignored (plans/retros/roster-b-picker-and-orgs.md).
  orgId: z.uuid("That organization is not valid.").optional(),
});

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// A CALLER CANNOT NAME ANOTHER ORGANIZATION'S PROGRESS INTO EXISTENCE
// ---------------------------------------------------------------------------
// An org leader's `?orgId=` is IGNORED, not honoured and not refused: their own organization is
// the only one they have progress for. RLS would return no logs for anybody else's anyway, and a
// dashboard reading "0 of 12 visited" for the Relief Society is a confusing way for the Elders
// Quorum to be told "not yours" — it looks like a Relief Society that has done nothing.
//
// The bishopric may name any organization, because they configure every organization's goals
// (CLAUDE.md §7). They must name one: there is no ward-wide visit goal — migration 019 makes an
// `org_id = null` goal bishopric-only and FEATURES.md §Module 9 describes progress per
// organization — so a ward-level denominator would have to be invented.
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const query = querySchema.parse({ orgId: searchParams.get("orgId") ?? undefined });

    const orgId = isBishopric(user.role) ? query.orgId : user.orgId;

    if (!orgId) {
      return NextResponse.json(
        {
          error: isBishopric(user.role)
            ? "Say which organization's progress to load."
            : "Your account is not attached to an organization, so there is no visit goal to " +
              "measure against. Ask a member of the bishopric to set your organization.",
        },
        { status: 400 },
      );
    }

    // The clock enters ONCE and is handed down, so every household in one response is judged
    // against the same instant rather than against a fresh `new Date()` per row.
    const progress = await readVisitProgress(user.wardId, orgId, new Date(), supabase);

    return NextResponse.json({ progress });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visits/progress",
      fallbackMessage: "Could not load the visit progress. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
