import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emitNotification";
import {
  createHousehold,
  listHouseholds,
  ROSTER_BROWSE_STATUSES,
} from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createHouseholdSchema } from "@/lib/validation/roster";

// requireSessionUser() sits OUTSIDE the try in every handler here. It redirects by throwing an
// internal Next.js error, and a catch-all around it turns that redirect into a 500
// (plans/retros/auth-b-invites-admin.md).

// No audit row: a read is not a mutation (CLAUDE.md rule 6 covers POST/PATCH/DELETE).
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.view");

    const search = new URL(request.url).searchParams.get("search") ?? undefined;

    const supabase = await createServerSupabaseClient();
    const households = await listHouseholds(
      user.wardId,
      { search, statuses: ROSTER_BROWSE_STATUSES },
      supabase,
    );

    return NextResponse.json({ households });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/households",
      fallbackMessage: "Could not load the ward's households. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// roster.manage, not RLS, is the effective write boundary here. Migration 019 grants INSERT on
// households to every authenticated member of the ward, so this check is what actually stops an
// org secretary creating one. It can never be skipped.
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const input = createHouseholdSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const household = await createHousehold(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "household_created",
        module: "roster",
        detail: { householdId: household.id },
      },
      supabase,
    );

    await emitNotification({
      wardId: user.wardId,
      triggerKey: "new_household_added",
      title: "New household added",
      body: `${household.familyName} was added to the ward roster.`,
    });

    return NextResponse.json({ household }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/households",
      fallbackMessage: "Could not create the household. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
