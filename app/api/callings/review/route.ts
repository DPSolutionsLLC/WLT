import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { applyCallingReview } from "@/lib/callings/applyCallingReview";
import { canManageMemberLinks } from "@/lib/callings/linkAccess";
import { loadCallingReview } from "@/lib/callings/loadCallingReview";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { applyCallingReviewSchema } from "@/lib/validation/callingReview";

// THE CALLING REVIEW (ITER-058 cr2): the ward list against the app, for every linked account.
//
// canManageMemberLinks() — `admin.manage_users` AND a bishopric calling, or the super admin — is the
// boundary for both verbs. `ward_role_assignments` has no write policy (068c), so the writes run on
// the service role behind this check, and so does the read: a super admin acting under a
// `super_admin` calling is not admitted to the ward's links by 105a's policy.
//
// GET returns the rows; POST takes only the ticked ids and recomputes before applying anything.
// The audit rows and the one notification are written by applyCallingReview(), per applied row.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageMemberLinks(user, roleAccess)) throw new ForbiddenError("admin.manage_users");

    const { rows } = await loadCallingReview(user.wardId, createServiceSupabaseClient());
    return NextResponse.json({ rows });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/callings/review",
      fallbackMessage: "Could not read the calling review. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageMemberLinks(user, roleAccess)) throw new ForbiddenError("admin.manage_users");

    const input = applyCallingReviewSchema.parse(await readJsonBody(request));

    const result = await applyCallingReview(
      { actor: user, wardId: user.wardId, selectedIds: input.selectedIds },
      createServiceSupabaseClient(),
    );

    return NextResponse.json(result);
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/callings/review",
      fallbackMessage: "Could not apply the calling changes. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
