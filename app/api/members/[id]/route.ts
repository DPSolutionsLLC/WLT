import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getMember, updateMember } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateMemberSchema } from "@/lib/validation/roster";

const memberIdSchema = z.uuid("That member id is not valid.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const { id } = await params;
    const memberId = memberIdSchema.parse(id);
    const changes = updateMemberSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();

    // Read first so the audit row can name the status transition. Marking someone moved_out is
    // the closest thing to a delete this app has (02-roster.md §Pitfalls: there is no delete),
    // and the trail should say so rather than recording an anonymous "member_updated".
    const before = await getMember(user.wardId, memberId, supabase);
    if (!before) {
      return NextResponse.json(
        { error: "That member is not in your ward." },
        { status: 404 },
      );
    }

    const member = await updateMember(user.wardId, memberId, changes, supabase);

    if (!member) {
      return NextResponse.json(
        { error: "That member is not in your ward." },
        { status: 404 },
      );
    }

    const statusTransition =
      before.status === member.status
        ? undefined
        : { from: before.status, to: member.status };

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "member_updated",
        module: "roster",
        detail: {
          memberId,
          changes,
          ...(statusTransition ? { statusTransition } : {}),
        },
      },
      supabase,
    );

    return NextResponse.json({ member });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/members/[id]",
      fallbackMessage: "Could not update the member. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
