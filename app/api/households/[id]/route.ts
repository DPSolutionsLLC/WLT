import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { updateHousehold } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateHouseholdSchema } from "@/lib/validation/roster";

const householdIdSchema = z.uuid("That household id is not valid.");

// Route params are a Promise in Next 16, typed explicitly rather than with the generated
// PageProps/RouteContext helpers — those only exist after a build and break a clean typecheck
// (plans/retros/foundation-a-scaffold.md).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const { id } = await params;
    const householdId = householdIdSchema.parse(id);
    const changes = updateHouseholdSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const household = await updateHousehold(user.wardId, householdId, changes, supabase);

    // A zero-row update means the household is not in this ward, or RLS refused it. Both are
    // "not yours", which is a 404 rather than a 500 (plans/retros/foundation-c-services.md).
    if (!household) {
      return NextResponse.json(
        { error: "That household is not in your ward." },
        { status: 404 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "household_updated",
        module: "roster",
        detail: { householdId, changes },
      },
      supabase,
    );

    return NextResponse.json({ household });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/households/[id]",
      fallbackMessage: "Could not update the household. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
