import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  listMemberOrganizations,
  setMemberOrganizations,
} from "@/lib/roster/organizations";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { setMemberOrganizationsSchema } from "@/lib/validation/roster";

// requireSessionUser() sits OUTSIDE the try. It redirects by throwing an internal Next.js
// error, and catching that here would turn a redirect into a 500
// (plans/retros/auth-b-invites-admin.md).
//
// roster.manage, not RLS, is the boundary for these writes: migration 019's ward-scoped policy
// loop lets ANY authenticated member of the ward write member_organizations
// (plans/roster-a-data-and-pages.md Decision 3). This check can never be skipped.
//
// KNOWN GAP, deliberate. 02-roster.md §Step 5 also allows "the relevant org leader" to edit
// their own organization's membership. No permission in PERMISSIONS expresses "may edit
// membership of my own organization", and inventing one here would put a role decision in the
// wrong phase. Bishopric only for now; Phase 11 (plans/11-notifications-admin.md) owns the role
// access matrix and should decide.
const memberIdSchema = z.uuid("That member id is not valid.");

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const { id } = await params;
    const memberId = memberIdSchema.parse(id);
    const input = setMemberOrganizationsSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const result = await setMemberOrganizations(
      user.wardId,
      memberId,
      input.organizationIds,
      supabase,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // What actually changed, not what was submitted. A month from now the useful question is
    // "when did this member leave the elders quorum", and a record of the whole submitted set
    // cannot answer it.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "member_organizations_updated",
        module: "roster",
        detail: { memberId, added: result.added, removed: result.removed },
      },
      supabase,
    );

    const organizations = await listMemberOrganizations(
      user.wardId,
      memberId,
      supabase,
    );

    return NextResponse.json({
      organizations,
      added: result.added,
      removed: result.removed,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/members/[id]/organizations",
      fallbackMessage:
        "Could not update that member's organizations. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
