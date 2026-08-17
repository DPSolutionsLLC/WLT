import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createMember, listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createMemberSchema, memberFiltersSchema } from "@/lib/validation/roster";

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.view");

    const searchParams = new URL(request.url).searchParams;
    const statuses = searchParams.getAll("status");

    // No status parameter means the data layer's default applies (active only). Substituting
    // one here would put the rule in two places and let them drift.
    const filters = memberFiltersSchema.parse({
      search: searchParams.get("search") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      organizationId: searchParams.get("organizationId") ?? undefined,
    });

    const supabase = await createServerSupabaseClient();
    const members = await listMembers(user.wardId, filters, supabase);

    return NextResponse.json({ members });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/members",
      fallbackMessage: "Could not load the ward's members. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// No notification trigger exists for a new member, and one is not invented here — an unknown
// trigger key fires into nothing and only warns (lib/notifications/emitNotification.ts).
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const input = createMemberSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const member = await createMember(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "member_created",
        module: "roster",
        detail: { memberId: member.id, householdId: member.householdId },
      },
      supabase,
    );

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/members",
      fallbackMessage: "Could not create the member. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
